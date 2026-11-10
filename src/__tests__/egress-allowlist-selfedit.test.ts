// EGRESSSELFEDIT824: a sub-agent may not edit the egress allowlist that gates it, and every
// change to the file -- by whatever route -- is recorded and reported.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision, allowlistBashSegmentAllowed, globHitsAllowlist, DECISION_BUDGET_MS } from '../../scripts/self-pace-gate.mjs'
import { agentGetsGovernanceGates, ensureGovernanceGateCommands, injectSelfPaceGate } from '../web/agent-scaffold.js'
import { initDatabase, getPendingMessages } from '../db.js'
import {
  checkEgressAllowlistBaseline,
  describeAllowlistChange,
  watchEgressAllowlistBaseline,
  queueAllowlistReport,
  HISTORY_DIRNAME,
  baselineMemoryFile,
  statMoved,
} from '../web/egress-allowlist-baseline.js'
import { MAIN_AGENT_ID } from '../config.js'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, statSync, utimesSync } from 'node:fs'
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

describe('gate: rm / rmdir / mv of a directory that holds the allowlist objects (didi 55350 L2, marveen 55375)', () => {
  const ancestorDenied = [
    'rm -rf store',
    'rm -r store/',
    'rm -rf -- store',
    '/bin/rm -rf ./store',
    'rmdir store',
    'mv store store2',
    'mv -t /tmp store',
    'rm -rf .',
    'rm -rf ~/.marveen',
    'rm -rf $HOME/.marveen',
    'mv ~/.marveen /tmp/x',
    'cd store && rm -rf ..',
    "rm -rf 'store'",
    '(rm -rf store)',
  ]
  it.each(ancestorDenied)('denies: %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('denies the install root by its absolute path, and a symlink that resolves to store/', () => {
    expect(decide('Bash', { command: `rm -rf ${root}` })).toEqual({ deny: true, reason: 'egress-allowlist' })
    symlinkSync(store, join(root, 'lnk'))
    expect(decide('Bash', { command: 'rm -rf lnk/' })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  // POSITIVE CONTROL: below store/, beside it, and a destination that is a parent stay allowed.
  const stillAllowed = [
    'rm -rf store/scratch-x',
    'mv store/a.txt store/b.txt',
    'rmdir store/emptydir',
    'mv /tmp/x .',
    'mv /tmp/x store',
    'mv /tmp/x.json store/',
    'rm -rf /tmp/other',
    'rm -rf ~/.marveen-other',
    'ls store',
  ]
  it.each(stillAllowed)('allows: %s', (command) => {
    expect(decide('Bash', { command }).deny).toBe(false)
  })
  // didi 55396: a runner prefix (K2), a glued redirect (K3), trash (K4), VAR= and $PWD (K5).
  const wrappedDenied = [
    '\\rm -rf store',
    'command rm -rf store',
    'env rm -rf store',
    'env FOO=1 rm -rf store',
    'nohup rm -rf store',
    'sudo rm -rf store',
    'sudo -u isti rm -rf store',
    'time rm -rf store',
    'nice -n 5 rm -rf store',
    // didi 55399 L1: the value-taking options are per runner, an unknown option is read both ways
    'time -p rm -rf store',
    'sudo -n rm -rf store',
    'sudo -nu isti rm -rf store',
    'sudo -uisti rm -rf store',
    'sudo --user isti rm -rf store',
    'sudo --user=isti rm -rf store',
    'sudo --preserve-env rm -rf store',
    'sudo -Z rm -rf store',
    'sudo -- rm -rf store',
    'time -o /tmp/t rm -rf store',
    'exec -a x rm -rf store',
    'nice -5 rm -rf store',
    "env -S 'rm -rf store'",
    // didi 55404 M1/M2: an unknown option keeps the runner's option list going, read both ways
    'sudo --login -u root rm -rf store',
    'sudo --preserve-env -u isti rm -rf store',
    'sudo -B -u root rm -rf store',
    'sudo -Bu root rm -rf store',
    'sudo -Nu isti rm -rf store',
    'sudo -h host rm -rf store',
    'sudo -Z val rm -rf store',
    'sudo -Zu root rm -rf store',
    'sudo -u root -n rm -rf store',
    'sudo -u root --login rm -rf store',
    'sudo -Z -Y -X -W -V -u root rm -rf store',
    // each (runner, word) state once: 30 unknown options are 30 states, not 2^30 readings
    `sudo ${'-Z '.repeat(30)}rm -rf store`,
    'rm -rf store>/dev/null',
    'rm -rf store 2>/dev/null',
    'rm -rf store > /tmp/log',
    'trash store',
    'FOO=1 rm -rf store',
    'rm -rf $PWD/store',
    'rm -rf ${PWD}',
  ]
  it.each(wrappedDenied)('denies: %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  // Without the visited set 34 unknown options took 2.9 s here and 40 crashed node; with it, 1 ms.
  // A hook that a crafted command can stall blocks the agent, so the cost itself is pinned.
  it('an unknown-option chain costs one state per word, not one per reading', () => {
    const started = performance.now()
    expect(decide('Bash', { command: `sudo ${'-Z '.repeat(34)}rm -rf store` }).deny).toBe(true)
    expect(performance.now() - started).toBeLessThan(1000)
  })
  // Card 9534dd10: one stack frame per option word threw RangeError at ~12 000 options, and the
  // hook let the crafted command through. A runner chain (sudo sudo ...) took the same road.
  it.each([
    ['20 000 unknown options', `sudo ${'-Z '.repeat(20000)}rm -rf store`],
    ['20 000 chained runners', `${'sudo '.repeat(20000)}rm -rf store`],
  ])('%s are still read to the command word, without a stack overflow', (_name, command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  const wrappedAllowed = [
    'sudo -u isti ls store',
    'sudo -u rm ls store',
    'time -o store/t.txt ls',
    // didi 55399 L2: a separate redirect word and its target are not the mv destination
    'mv /tmp/x store > /tmp/log',
    'env rm -rf /tmp/x',
    'nohup rm -rf store/scratch-x',
    'rm -rf /tmp/x > store/log.txt',
    'rm -rf store2>/dev/null',
    // a redirect word is not the mv destination: else store becomes a source
    'mv /tmp/x store 2>/dev/null',
    'trash store/scratch-x',
    'FOO=store rm -rf /tmp/x',
  ]
  it.each(wrappedAllowed)('allows: %s', (command) => {
    expect(decide('Bash', { command }).deny).toBe(false)
  })
  // K1: on a case-insensitive volume STORE IS store/; on a case-sensitive one it is another name.
  it('a differently cased name is denied exactly when the volume says it is the same directory', () => {
    const same = existsSync(join(root, 'STORE'))
    for (const command of ['rm -rf STORE', 'mv Store s2', 'find STORE -delete']) {
      expect(decide('Bash', { command }).deny, command).toBe(same)
    }
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
  // Card 9534dd10: the crash was a hook exit 1 with no output, which lets the command through.
  it('20 000 unknown runner options: the hook exits 0 with a deny, not a crash', () => {
    const store = join(__dirname, '..', '..', 'store')
    const r = run({ tool_name: 'Bash', tool_input: { command: `sudo ${'-Z '.repeat(20000)}rm -rf ${store}` }, cwd: root })
    expect(r.stderr).not.toContain('RangeError')
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })
  // didi 57405 F10: the decision runs in a worker; a relative operand resolves against the
  // PAYLOAD cwd, not the cwd the hook process happens to start in.
  it('the payload cwd reaches the decision: a relative removal of the store is denied from the repo root', () => {
    const repo = join(__dirname, '..', '..')
    const hookIn = (cwd: string) => spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf store' }, cwd }), encoding: 'utf-8', cwd: root,
    })
    expect(JSON.parse(hookIn(repo).stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    // POSITIVE CONTROL: the same command from a directory whose store is not the gate's is allowed
    expect(hookIn(root).stdout).toBe('')
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

// Card bcc323dc (didi 57308, marveen 57313): the harness lets a command through when the hook
// throws or runs past its 10 s timeout. So the gate is FAIL-CLOSED: the decision runs in a worker
// under DECISION_BUDGET_MS, and a throw, a silent worker exit or a slow decision is a deny whose
// message says the gate did NOT decide (not a policy deny). The tests run MUTATED COPIES of the
// script, the way a real bug would reach the hook.
describe('gate: fail-closed when the decision does not finish (bcc323dc)', () => {
  const hook = join(__dirname, '..', '..', 'scripts', 'self-pace-gate.mjs')
  const source = readFileSync(hook, 'utf-8')
  const DECL = 'export function gateDecision(toolName, toolInput, opts = {}) {'
  const mutant = (edit: (s: string) => string) => {
    const dir = mkTmp('self-pace-mutant-')
    const p = join(dir, 'self-pace-gate.mjs')
    const text = edit(source)
    expect(text).not.toBe(source) // the mutation landed
    writeFileSync(p, text)
    return p
  }
  const runHook = (script: string, command = 'ls') => {
    const started = performance.now()
    const r = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }), encoding: 'utf-8', timeout: 30000,
    })
    return { ...r, ms: performance.now() - started }
  }
  const undecided = (r: { status: number | null; stdout: string }) => {
    expect(r.status).toBe(0)
    const reason = JSON.parse(r.stdout).hookSpecificOutput
    expect(reason.permissionDecision).toBe('deny')
    // distinct from a policy deny, so the agent rewords instead of looking for a way around
    expect(reason.permissionDecisionReason).toContain('NEM TUDOTT DONTENI')
    expect(reason.permissionDecisionReason).toContain('nem azt jelenti, hogy a parancs tiltott')
    expect(reason.permissionDecisionReason).not.toMatch(/^Self-pace TILTOTT/)
    return reason.permissionDecisionReason as string
  }

  it('POSITIVE CONTROL: the unmutated script allows a plain command and denies a scheduler', () => {
    expect(runHook(hook, 'ls').stdout).toBe('')
    expect(JSON.parse(runHook(hook, 'crontab -e').stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/^Self-pace TILTOTT/)
  })
  it('a decision that throws is a deny that names the throw', () => {
    const p = mutant((s) => s.replace(DECL, `${DECL}\n  throw new TypeError('mutant boom')`))
    expect(undecided(runHook(p))).toContain('hibat dobott: TypeError mutant boom')
  })
  it('a decision slower than the budget is a deny, and it comes when the budget fires', () => {
    const p = mutant((s) => s
      .replace(DECL, `${DECL}\n  for (;;) {}`)
      .replace(/export const DECISION_BUDGET_MS = \d+/, 'export const DECISION_BUDGET_MS = 300'))
    const r = runHook(p)
    expect(undecided(r)).toContain('300 ms alatt nem keszult el')
    expect(r.ms).toBeLessThan(5000)
  })
  it('a worker that ends without an answer is a deny', () => {
    const p = mutant((s) => s.replace(DECL, `${DECL}\n  process.exit(0)`))
    expect(undecided(runHook(p))).toContain('valasz nelkul ert veget')
  })
  // didi 57405 item 3: a malformed answer used to throw on the MAIN thread (exit 1 = pass)
  it.each([['undefined', 'undefined'], ['null', 'null'], ['a non-boolean deny', `{ deny: 'yes' }`]])(
    'a decision that returns %s is a deny, not a crash', (_name, value) => {
      const p = mutant((s) => s.replace(DECL, `${DECL}\n  return ${value}`))
      expect(undecided(runHook(p))).toContain('nem szabalyos valaszt adott')
    })
  it('a throw on the main thread after the answer is a deny, not a crash', () => {
    const p = mutant((s) => s.replace(/(\n {4})allow\(\)(\n {2}\}\)\n {2}worker\.once\('error')/, `$1throw new RangeError('main boom')$2`))
    expect(undecided(runHook(p))).toContain('fo szala hibat dobott: RangeError main boom')
  })
  // didi 57405 F4: nothing killed a worker start failure that lets the command through
  it('a worker that cannot start is a deny', () => {
    const p = mutant((s) => s.replace('worker = new Worker(', `worker = new (class { constructor() { throw new Error('mutant start') } })(`))
    expect(undecided(runHook(p))).toContain('nem indult el: mutant start')
  })
  // marveen 57408 decision 2 PIN: ssh/script nesting may stay exponential, but it never leaves
  // the gate undecided: the budget turns it into the could-not-decide deny.
  // 16 sudo/ssh pairs: ~9 s at 12 pairs in-process (measured 2026-11-10), far past the budget.
  it('16 nested sudo/ssh pairs end in the could-not-decide deny inside the budget (accepted design, 57408)', () => {
    const r = runHook(hook, `${'sudo -Z ssh -Z '.repeat(16)}ls`)
    expect(undecided(r)).toContain(`${DECISION_BUDGET_MS} ms alatt nem keszult el`)
    expect(r.ms).toBeLessThan(DECISION_BUDGET_MS + 3000)
  }, 20000)
  it('the budget fires well inside the harness hook timeout, which itself lets the command through', () => {
    const settings: Record<string, unknown> = {}
    injectSelfPaceGate(settings)
    const entry = (settings.hooks as { PreToolUse: Array<{ hooks: Array<{ command: string; timeout: number }> }> })
      .PreToolUse.find((e) => JSON.stringify(e).includes('self-pace-gate.mjs'))!
    const hookTimeoutMs = entry.hooks[0].timeout * 1000
    // node startup + module load + worker start come on top of the budget, on a loaded machine
    expect(hookTimeoutMs - DECISION_BUDGET_MS).toBeGreaterThanOrEqual(5000)
    // floor: the slowest of 2 940 real fleet Bash commands decided in 12 ms (bcc323dc comment)
    expect(DECISION_BUDGET_MS).toBeGreaterThanOrEqual(1000)
  })
})

// Card bcc323dc E: the wrapper reading is linear, so a long but harmless command is decided
// on its merits instead of by the budget. didi 57308: 22 pairs took 21 s, the command ran.
describe('gate: nested wrappers cost one state per word (bcc323dc)', () => {
  // The long inputs are decided in a child with a hard cap: a backtracking regression is
  // synchronous, vitest's timeout cannot stop it in-process, and the suite would hang instead
  // of failing (bcc323dc mutant M4 did exactly that). ms is the decision alone, not node startup.
  const gateUrl = new URL('../../scripts/self-pace-gate.mjs', import.meta.url).href
  const decideCapped = (command: string) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', [
      `const { gateDecision } = await import(process.env.GATE_URL)`,
      `const t = performance.now()`,
      `const d = gateDecision('Bash', { command: process.env.GATE_CMD }, { allowlistPath: process.env.GATE_ALLOWLIST, cwd: process.env.GATE_CWD })`,
      `process.stdout.write(JSON.stringify({ d, ms: performance.now() - t }))`,
    ].join('\n')], {
      env: { ...process.env, GATE_URL: gateUrl, GATE_CMD: command, GATE_ALLOWLIST: allowlist, GATE_CWD: root },
      encoding: 'utf-8', timeout: 10000, killSignal: 'SIGKILL',
    })
    expect(r.signal, 'the decision did not finish in 10 s: the wrapper reading is no longer linear').toBeNull()
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(r.stdout) as { d: { deny: boolean; reason?: string }; ms: number }
  }
  it.each([
    ['sudo -Z pairs, scheduler', `${'sudo -Z '.repeat(2000)}crontab -e`, 'os-scheduler'],
    ['env -u env pairs, scheduler', `${'env -u env '.repeat(2000)}crontab -e`, 'os-scheduler'],
    // VAR=x, a reserved word and `command` after a flag: one reading (the argument), not two
    ['sudo -u X=1 pairs, scheduler', `${'sudo -u X=1 '.repeat(2000)}crontab -e`, 'os-scheduler'],
    ['env -u command pairs, scheduler', `${'env -u command '.repeat(2000)}crontab -e`, 'os-scheduler'],
    ['sudo -p then pairs, scheduler', `${'sudo -p then '.repeat(2000)}crontab -e`, 'os-scheduler'],
    ['sudo -Z pairs, removal', `${'sudo -Z '.repeat(2000)}rm -rf store`, 'egress-allowlist'],
    ['sudo -Z rm chain, removal', `${'sudo -Z rm '.repeat(2000)}-rf store`, 'egress-allowlist'],
  ])('2000 %s: denied for its reason in under 500 ms', (_name, command, reason) => {
    const { d, ms } = decideCapped(command)
    expect(d).toEqual({ deny: true, reason })
    expect(ms).toBeLessThan(500)
  })
  it.each([
    ['env -u env pairs', `${'env -u env '.repeat(2000)}ls`],
    ['sudo -Z pairs', `${'sudo -Z '.repeat(2000)}ls`],
    // every rm here is a command start: each later word is resolved once per segment, not per start
    ['sudo -Z rm links (500)', `${'sudo -Z rm '.repeat(500)}x`],
    ['sudo -u X=1 pairs', `${'sudo -u X=1 '.repeat(2000)}ls`],
    ['env -u command pairs', `${'env -u command '.repeat(2000)}ls`],
    // a lookbehind per position made long prose quadratic: a real 31 KB report heredoc took > 60 s
    ['prose lines in a text heredoc (200)', "cat > /tmp/r.txt <<'E'\n" +
      'A-F1 (MEDIUM; scope) the fix does not deliver the stated contract "same scope", ask only X (contacts:read) and run -v if needed.\n'.repeat(200) + 'E'],
  ])('2000 %s around a harmless command: allowed in under 500 ms', (_name, command) => {
    const { d, ms } = decideCapped(command)
    expect(d.deny).toBe(false)
    expect(ms).toBeLessThan(500)
  })
  // A wrapper word in a flag-argument slot is read as the wrapper: the scheduler behind it
  // is still found. `command -v` is a lookup and stays allowed behind any wrapper.
  it.each([
    'sudo -u command crontab -e',
    'sudo -u env crontab -e',
    'sudo -u nice -n 5 crontab -e',
    'env -u env sudo -u root crontab -e',
    'sudo -u then crontab -e',
    'sudo -u X=1 crontab -e',
    'command -p command crontab -e',
    'command -p if crontab -e',
  ])('still denied: %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'os-scheduler' })
  })
  it.each([
    'sudo -u root command -v crontab',
    'command -v crontab',
  ])('still allowed (a lookup): %s', (command) => {
    expect(decide('Bash', { command }).deny).toBe(false)
  })
  // After a flag word the gate cannot know whether the flag takes a value, so `command` there is
  // read as its argument and `-v` as the next flag: a lookup behind `--user=x` is a FALSE deny.
  // Denied on the live gate before this card too (1344c1ad5); the price of not losing
  // `env -u command -i crontab -e` (didi 10012859).
  it.each([
    'sudo --user=x command -v crontab',
    'env -u X sudo --user=x command -v crontab',
  ])('denied as on the live gate (accepted false deny): %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'os-scheduler' })
  })
  // didi 10012859 / 57405 item 1: after a value flag, `command`, a reserved word or VAR=x is the
  // flag's ARGUMENT, and what follows still runs (env -u NAME unsets NAME and runs the rest).
  // ssh/timeout take any flag argument: a wrapper word there is not the next wrapper.
  const SCHEDULERS = ['crontab -e', 'crontab mycron.txt', 'launchctl load x', 'at now', 'batch -f job', 'systemd-run x']
  const ARG_SHAPES = [
    'env -u command -i', 'env -u if -i', 'env -u X=1 -i', 'exec -a command -l', '/usr/bin/time -o command -l',
    'sudo -p command -n', 'stdbuf -o command -e', 'sudo -p then -E', 'nice -n X=1 -5',
    'ssh -i env host', 'ssh -l sudo host', 'timeout -s env 5',
  ]
  it.each(ARG_SHAPES.flatMap((shape) => SCHEDULERS.flatMap((tail) =>
    ['', 'true; ', 'echo a | ', 'true && '].map((before) => `${before}${shape} ${tail}`))))('denied: %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'os-scheduler' })
  })
  // didi 57494: a VAR=x word after a value flag, where x is a path ending in a generic wrapper's
  // name, had NO reading on 3fdc9dd4d (the path prefix spanned `X=/usr/bin/`, FLAG_NEEDS_ARG dropped
  // the no-argument reading), so the scheduler behind it passed. Denied on the live gate.
  const VAR_PATH_SHAPES = [
    'env -i X=/usr/bin/env', 'sudo -E HOME=/home/env', 'env -i PATH=/usr/local/bin:/opt/env',
    'time -p X=/usr/bin/time', 'nohup -x X=/usr/bin/env', 'env -i X=/a/b/sudo', 'env -i X=./nice',
    'nice -n X=/bin/nice', 'env -i -- X=/usr/bin/env', 'sudo -u root -E X=/usr/bin/sudo',
    // didi 57708: the VAR name class keeps a leading underscore and a digit after the first letter
    'env -i _X=/usr/bin/env', 'env -i X1=/usr/bin/env', 'env -i x1_y=/usr/bin/env',
  ]
  it.each(VAR_PATH_SHAPES.flatMap((shape) => SCHEDULERS.flatMap((tail) =>
    ['', 'true && '].map((before) => `${before}${shape} ${tail}`))))('denied (VAR=path after a flag): %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'os-scheduler' })
  })
  // A VAR=x word keeps exactly one reading, and a path word with `=` in a directory (not VAR=x) too:
  // excluding `=` from the path prefix instead gave `/a=b/sudo` two readings, 15.7 s at 24 repeats.
  it('a path word with = after a flag stays linear: (sudo -Z /a=b/sudo) x24 ls', () => {
    const started = performance.now()
    expect(decide('Bash', { command: 'sudo -Z /a=b/sudo '.repeat(24) + 'ls' }).deny).toBe(false)
    expect(performance.now() - started).toBeLessThan(1000)
  })
  it.each(['env -i X=/usr/bin/env ls', 'env -i X=/usr/bin/env', 'sudo -E HOME=/home/env make'])('POSITIVE CONTROL, allowed: %s', (command) => {
    expect(decide('Bash', { command }).deny).toBe(false)
  })
  it.each([
    'echo f | xargs env -u command -i crontab',
    'echo f | xargs env -i X=/usr/bin/env crontab -e',
    "bash -c 'command -p X=1 launchctl load x'",
    'find . -exec command crontab -e \\;',
  ])('denied (indirect): %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'os-scheduler-indirect' })
  })
  // didi 57405 item 2, marveen 57408 decision 1: a bare `--` ends a wrapper's options, and the
  // scheduler behind it runs. It was allowed for every wrapper (live since the gate exists).
  it.each([
    'env --', 'sudo --', 'nice --', 'exec --', 'command --', 'command -p --', 'nohup --', 'time --', 'env -i --',
    'sudo -u root --', 'nice -n 5 --', 'doas --', 'stdbuf -o L --', 'caffeinate --', 'timeout -- 5', 'ssh -- host',
    '/usr/bin/env --', 'env -- X=1',
  ].flatMap((w) => SCHEDULERS.map((tail) => `${w} ${tail}`)))('denied behind a bare --: %s', (command) => {
    expect(decide('Bash', { command })).toEqual({ deny: true, reason: 'os-scheduler' })
  })
  it.each(['env -- ls', 'sudo -- ls -la', 'nice -- make', 'command -- ls'])('POSITIVE CONTROL, allowed: %s', (command) => {
    expect(decide('Bash', { command }).deny).toBe(false)
  })
  // didi 57405 F12: the visited key must hold the runner KIND (time's -p takes no value, sudo's does)
  it('a removal behind two runners whose option tables differ is denied: time -Z sudo -p rm -rf store', () => {
    expect(decide('Bash', { command: 'time -Z sudo -p rm -rf store' })).toEqual({ deny: true, reason: 'egress-allowlist' })
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
    // the last recorded sha survives a restart: the memory file is passed (50862 W2)
    expect(src.slice(call, call + 120)).toContain('watchEgressAllowlistBaseline(STORE_DIR, queueAllowlistReport, 5000, baselineMemoryFile(STORE_DIR))')
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

// didi 6525aba3 50862: the history is gated like the file, the record survives a restart, a
// ctime-only rewrite is seen, and the glob routes that still walked past are closed.
describe('50862 N1: native file tools on the history and the baseline record', () => {
  const historyDir = () => join(store, HISTORY_DIRNAME)
  beforeEach(() => { checkEgressAllowlistBaseline(store, () => {}) })

  it.each(['Write', 'Edit', 'MultiEdit'])('%s on a history entry and on history.log is denied', (tool) => {
    const entry = readdirSync(historyDir()).find((n) => n.endsWith('.json'))!
    expect(decide(tool, { file_path: join(historyDir(), entry), content: '{}' })).toEqual({ deny: true, reason: 'egress-allowlist' })
    expect(decide(tool, { file_path: join(historyDir(), 'history.log'), content: '' })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('NotebookEdit into the history (notebook_path) and a relative path are denied', () => {
    expect(decide('NotebookEdit', { notebook_path: join(historyDir(), 'x.ipynb') }).deny).toBe(true)
    expect(decide('Write', { file_path: 'store/egress-allowlist.history/new.json', content: '{}' }).deny).toBe(true)
  })
  it('a new file through a symlinked alias of the history directory is denied (real path of its directory)', () => {
    symlinkSync(historyDir(), join(root, 'h'))
    expect(decide('Write', { file_path: join(root, 'h', 'new.json'), content: '{}' })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('the baseline record outside store/ is denied by its name', () => {
    expect(decide('Write', { file_path: baselineMemoryFile(store, root), content: 'x' })).toEqual({ deny: true, reason: 'egress-allowlist' })
  })
  it('POSITIVE CONTROL: the baseline source, a doc about it and another store file stay writable', () => {
    for (const fp of [join(root, 'src', 'web', 'egress-allowlist-baseline.ts'), join(root, 'docs', 'egress-allowlist-notes.md'), join(store, 'other.json')]) {
      expect(decide('Write', { file_path: fp, content: 'x' }).deny).toBe(false)
    }
  })
  it('NotebookEdit names the schedule store in notebook_path, and that is read too (A6b)', () => {
    expect(decide('NotebookEdit', { notebook_path: join(root, 'scheduled_tasks.json') })).toEqual({ deny: true, reason: 'store-write' })
  })
})

describe('50862 glob gaps: $PWD, subshell, group, cd --, find', () => {
  beforeEach(() => { checkEgressAllowlistBaseline(store, () => {}) })
  const bash = (command: string) => decide('Bash', { command })

  it.each([
    'rm $PWD/store/e*',
    'rm ${PWD}/store/e*',
    'rm "$(pwd)"/store/e*',
    'rm `pwd`/store/*.history',
    '(cd store && rm e*)',
    '{ cd store; rm e*; }',
    'cd -- store && rm e*',
    "find store -name 'egress*' -delete",
    "find . -name '*.json' -delete",
    'find store -exec rm {} +',
    "find store ! -name '*.db' -delete",
    "find store -iname 'EGRESS*' -delete",
    "find store -path '*x*' -delete",
    "find store/egress-allowlist.history -type f -delete",
    "find $PWD/store -name '2026*' -delete",
    'find store -type f -exec chmod 644 {} +',
  ])('DENY: %s', (command) => {
    expect(bash(command)).toEqual({ deny: true, reason: 'egress-allowlist' })
  })

  it.each([
    "find store -name '*.db-wal' -delete",
    "find /tmp -name '*.json' -delete",
    "find store -name 'egress*'",
    '(cd /tmp && rm e*)',
    'cat $PWD/store/other.json',
    'rm $PWD/tmp/*.json',
    '(cat store/e*-allowlist.json)',
    'find . -type f -exec grep -l needle {} +',
    'find store -type f -exec /usr/bin/wc -c {} +',
  ])('ALLOW: %s', (command) => {
    expect(bash(command).deny).toBe(false)
  })

  // didi 51495: A4-1 the naive split cut a find at `\;`, so a reader -exec made the first half a
  // read and the acting rest stood alone; A4-2 `cd` into $PWD/... was not resolved; A4-3 the
  // baseline record under ~/.marveen was reachable by a glob or a find (the gate's own home).
  it.each([
    String.raw`find store -name 'egress*' -exec cat {} \; -delete`,
    String.raw`find store -name 'egress*' -exec grep -q . {} \; -exec rm {} \;`,
    "find store -name 'egress*' -exec cat {} ';' -delete",
    'cd "$PWD/store" && rm e*',
    'cd $(pwd)/store && rm e*',
    'cd ${PWD}/store && rm e*',
    'rm ~/.marveen/*.sha',
    'rm $HOME/.marveen/egress*',
    'cp x ~/.marveen/*.sha',
    "find ~/.marveen -name '*.sha' -delete",
    'find $HOME/.marveen -delete',
  ])('DENY (51495): %s', (command) => {
    expect(bash(command)).toEqual({ deny: true, reason: 'egress-allowlist' })
  })

  // didi 51654: L1 the terminator mask ran on any `\;` / ';' / ";" text, so a real separator glued
  // to it vanished and the rm became an echo argument (base DENY, 58080e315 ALLOW; bash and zsh run
  // the rm). L3 K3: the ";" form had no case; K8: a cd into $HOME was not pinned; K14: the gate's
  // record key must be the baseline's (12 hex), a find naming the exact record proves it.
  it.each([
    String.raw`echo x\; rm store/egress-allowlist.json`,
    "echo 'a';'rm' store/egress-allowlist.json",
    'echo "a";"rm" -f store/egress-allowlist.json',
    // didi 55350 L1: a space before the closing quote satisfies the lookbehind, so only the
    // lookahead (the word must END after the terminator) keeps the rm visible; bash runs it.
    "echo 'a ';'rm' store/egress-allowlist.json",
    'echo "a ";"rm" -f store/egress-allowlist.json',
    String.raw`find store -name 'x' -exec cat {} \;; rm store/egress-allowlist.json`,
    'find store -name \'egress*\' -exec cat {} ";" -delete',
    'cd $HOME/.marveen && rm *.sha',
    'cd ${HOME}/.marveen && rm egress*',
  ])('DENY (51654): %s', (command) => {
    expect(bash(command)).toEqual({ deny: true, reason: 'egress-allowlist' })
  })

  it('DENY (51654 K14): a glob that spells only the record\'s LENGTH hits it, so the gate keys it as the baseline does', () => {
    // Its name is denied by itself, whatever the key; a `?` glob names nothing, so only the
    // gate's own record path (key length included) can make it a hit.
    const stem = baselineMemoryFile(store).split('/').pop()!.slice(0, -'.sha'.length)
    expect(bash(`rm ~/.marveen/${'?'.repeat(stem.length)}.sha`)).toEqual({ deny: true, reason: 'egress-allowlist' })
    // CONTROL: one `?` more matches no record, and an rm under ~/.marveen is otherwise allowed
    expect(bash(`rm ~/.marveen/${'?'.repeat(stem.length + 1)}.sha`).deny).toBe(false)
  })

  it.each([
    String.raw`echo x \; rm store/egress-allowlist.json`,
    'cd $HOME/.marveen && ls *.sha',
  ])('ALLOW (51654 controls: a lone \\; is an argument, a read stays a read): %s', (command) => {
    expect(bash(command).deny).toBe(false)
  })

  it.each([
    String.raw`find store -name 'egress*' -exec cat {} \;`,
    String.raw`find . -name '*.ts' -exec grep -l needle {} \;`,
    'cd "$PWD/store" && ls e*',
    'cd /tmp && rm e*',
    'ls ~/.marveen/*.sha',
    "find ~/.marveen -name 'cache*' -delete",
    'rm ~/.marveen/skill/*.json',
  ])('ALLOW (51495 controls): %s', (command) => {
    expect(bash(command).deny).toBe(false)
  })

  it('a find whose root is a symlinked alias INSIDE the history is denied though no word names it (F6)', () => {
    symlinkSync(join(store, HISTORY_DIRNAME), join(root, 'h'))
    expect(bash('find h -type f -delete')).toEqual({ deny: true, reason: 'egress-allowlist' })
    expect(bash("find h -name '*.json' -delete")).toEqual({ deny: true, reason: 'egress-allowlist' })
  })

  it('a scheduler under find -exec keeps its own reason, though the find would also reach the allowlist', () => {
    expect(bash('find . -exec at now +').reason).toMatch(/^os-scheduler/)
  })

  it('the default allowlist path is this install\'s store/ (A18): a glob from the repo root hits it, from elsewhere not', () => {
    const repoRoot = join(__dirname, '..', '..')
    expect(globHitsAllowlist('store/e*-allowlist.json', undefined, repoRoot)).toBe(true)
    expect(globHitsAllowlist('store/e*-allowlist.json', undefined, root)).toBe(false)
  })
})

describe('50862 baseline: memory, a failed report, ctime, a restart', () => {
  const reports: string[] = []
  const notify = (r: string) => { reports.push(r) }
  beforeEach(() => { reports.length = 0 })

  it('an unchanged check teaches a fresh memory the sha, so a later wipe is REPORTED (M9a)', () => {
    checkEgressAllowlistBaseline(store, notify)
    const memory = { sha: null as string | null }
    const r = checkEgressAllowlistBaseline(store, notify, new Date(), memory)
    expect(r.recorded).toBe(false)
    expect(memory.sha).toBe(r.sha)
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    writeFileSync(allowlist, JSON.stringify({ domains: ['evil.example'] }))
    checkEgressAllowlistBaseline(store, notify, new Date(), memory)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('REMOVED')
  })

  it('a throwing report on the rewritten-history path does not throw, and the record stands (M10a)', () => {
    const memory = { sha: null as string | null }
    checkEgressAllowlistBaseline(store, notify, new Date('2026-10-03T08:00:00.000Z'), memory)
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    const r = checkEgressAllowlistBaseline(store, () => { throw new Error('queue down') }, new Date('2026-10-03T08:00:01.000Z'), memory)
    expect(r.recorded).toBe(true)
    expect(r.report).toContain('REMOVED')
    expect(readdirSync(join(store, HISTORY_DIRNAME)).filter((n) => n !== 'history.log')).toHaveLength(1)
  })

  it('statMoved: each of ctime, mtime, inode and size alone counts, an identical stat does not (W1b, M7a, M7b)', () => {
    const base = { ctimeMs: 1000, mtimeMs: 900, ino: 42, size: 10 }
    expect(statMoved({ ...base }, base)).toBe(false)
    for (const k of ['ctimeMs', 'mtimeMs', 'ino', 'size'] as const) {
      expect(statMoved({ ...base, [k]: base[k] + 1 }, base)).toBe(true)
    }
  })

  it('the watcher reports a same-bytes rewrite whose mtime was put back (touch -r: same inode and size, only ctime moved)', async () => {
    // a whole-second mtime, so putting it back is exact (a Date drops the sub-millisecond part)
    utimesSync(allowlist, 1_700_000_000, 1_700_000_000)
    const stop = watchEgressAllowlistBaseline(store, notify, 20)
    const before = statSync(allowlist)
    try {
      await new Promise((r) => setTimeout(r, 60))
      writeFileSync(allowlist, readFileSync(allowlist))
      utimesSync(allowlist, 1_700_000_000, 1_700_000_000)
      const after = statSync(allowlist)
      expect([after.ino, after.size, after.mtimeMs]).toEqual([before.ino, before.size, before.mtimeMs])
      const deadline = Date.now() + 3000
      while (!reports.some((x) => x.includes('REWRITTEN')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    } finally { stop() }
    expect(reports.some((x) => x.includes('REWRITTEN with its previous bytes'))).toBe(true)
  })

  it('a history wiped while the dashboard was down is REPORTED at the next boot through the memory file (W2)', () => {
    const mem = baselineMemoryFile(store, root)
    watchEgressAllowlistBaseline(store, notify, 60_000, mem)()
    expect(readFileSync(mem, 'utf-8').trim()).toMatch(/^[0-9a-f]{64}$/)
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    writeFileSync(allowlist, JSON.stringify({ domains: ['while-down.example'] }))
    watchEgressAllowlistBaseline(store, notify, 60_000, mem)()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain('REMOVED')
  })

  it('POSITIVE CONTROL: the same restart without a memory file is a quiet first run, as before', () => {
    watchEgressAllowlistBaseline(store, notify, 60_000)()
    rmSync(join(store, HISTORY_DIRNAME), { recursive: true, force: true })
    writeFileSync(allowlist, JSON.stringify({ domains: ['while-down.example'] }))
    watchEgressAllowlistBaseline(store, notify, 60_000)()
    expect(reports).toEqual([])
  })

  it('a boot that finds a history but no record REPORTS the missing record (51495 A4-3: rm the record, then rewrite the history)', () => {
    const mem = baselineMemoryFile(store, root)
    watchEgressAllowlistBaseline(store, notify, 60_000, mem)()
    rmSync(mem)
    watchEgressAllowlistBaseline(store, notify, 60_000, mem)()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain(`the baseline record ${mem} is missing or unreadable`)
  })

  it('POSITIVE CONTROL: a first boot with neither history nor record, and a reboot with both, stay quiet', () => {
    const mem = baselineMemoryFile(store, root)
    watchEgressAllowlistBaseline(store, notify, 60_000, mem)()
    watchEgressAllowlistBaseline(store, notify, 60_000, mem)()
    expect(reports).toEqual([])
  })

  it('baselineMemoryFile lies outside store/, under <home>/.marveen, and differs per store', () => {
    const a = baselineMemoryFile(store, root)
    expect(a.startsWith(join(root, '.marveen') + '/')).toBe(true)
    expect(a.startsWith(store)).toBe(false)
    expect(a).not.toBe(baselineMemoryFile(join(root, 'other-store'), root))
  })
})

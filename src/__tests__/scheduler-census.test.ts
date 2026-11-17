// Card fe838f28: the scheduler-entry census. Every control runs on a sandbox HOME and a sandbox
// repo with an injected exec -- never on the live crontab, at queue or LaunchAgents.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

vi.mock('../db.js', () => ({ createAgentMessage: vi.fn() }))
vi.mock('../web/front-desk-route.js', () => ({
  resolveMachineNoticeRecipient: vi.fn(() => ({ to: 'jarvis', rerouted: true, why: 'front-desk' })),
}))

const { createAgentMessage } = await import('../db.js')
const { resolveMachineNoticeRecipient } = await import('../web/front-desk-route.js')
const {
  deriveKnownGood, diffCensus, readCronFile, buildCensusReport,
  STORE_CRONTAB, STORE_AT, STORE_LAUNCH_AGENTS, STORE_SCHEDULED_TASKS,
} = await import('../scheduler-census.js')
const { runSchedulerCensusOnce, sendToFrontDesk, SCHEDULER_CENSUS_SUBJECT } = await import('../web/scheduler-census-watcher.js')
type Deps = import('../web/scheduler-census-watcher.js').SchedulerCensusDeps
type ExecResult = import('../scheduler-census.js').ExecResult

const mkTmp = tmpDirs()
const REAL_REPO = join(__dirname, '..', '..')

interface Sandbox {
  home: string
  repo: string
  agentDir: string
  la: string
  tasks: string
  cronFile: string
  crontab: ExecResult
  atq: ExecResult
  sent: string[]
  sendOk: boolean
  deps: Deps
}

function sandbox(): Sandbox {
  const home = mkTmp('census-home-')
  const repo = mkTmp('census-repo-')
  const agentDir = join(mkTmp('census-agents-'), 'someagent')
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  // What the repo installs: one template unit, one heredoc LABEL unit, two SERVICE_ID units.
  writeFileSync(join(repo, 'scripts', 'com.marveen.tmpl-unit.plist.template'), '<plist/>')
  writeFileSync(join(repo, 'scripts', 'install-heredoc-unit.sh'), '#!/bin/bash\nLABEL="com.marveen.heredoc-unit"\n')
  writeFileSync(join(repo, 'install-macos.sh'), 'D="com.${SERVICE_ID}.dashboard"\nC=com.$SERVICE_ID.channels\n')
  mkdirSync(join(repo, 'scheduled-tasks', 'seed-a'), { recursive: true })
  mkdirSync(join(repo, 'seed-scheduled-tasks', 'seed-b'), { recursive: true })
  // The live side, holding exactly the installed set.
  const la = join(home, 'Library', 'LaunchAgents')
  mkdirSync(la, { recursive: true })
  for (const l of ['com.marveen.tmpl-unit', 'com.marveen.heredoc-unit', 'com.svc.dashboard', 'com.svc.channels', 'com.svc.app']) {
    writeFileSync(join(la, `${l}.plist`), '<plist/>')
  }
  writeFileSync(join(la, '.DS_Store'), '')
  const tasks = join(home, '.claude', 'scheduled-tasks')
  mkdirSync(join(tasks, 'seed-a'), { recursive: true })
  mkdirSync(join(tasks, 'seed-b'), { recursive: true })
  writeFileSync(join(tasks, '.removed-defaults'), 'x\n')
  mkdirSync(join(agentDir, '.claude'), { recursive: true })
  const s: Sandbox = {
    home, repo, agentDir, la, tasks,
    cronFile: join(agentDir, '.claude', 'scheduled_tasks.json'),
    crontab: { status: 1, stdout: '', stderr: 'crontab: no crontab for tester\n' },
    atq: { status: 0, stdout: '', stderr: '' },
    sent: [],
    sendOk: true,
    deps: undefined as unknown as Deps,
  }
  s.deps = {
    home, repoRoot: repo, serviceId: 'svc', extraLabels: ['com.svc.app'], projectDirs: [agentDir],
    exec: (cmd) => (cmd === 'crontab' ? s.crontab : cmd === 'atq' ? s.atq : { status: 127, stdout: '', stderr: 'no such cmd' }),
    statePath: join(home, 'state.json'),
    send: (t) => { if (s.sendOk) s.sent.push(t); return s.sendOk },
    nowIso: () => '2026-11-12T04:00:00.000Z',
  }
  return s
}

function plantOnePerStore(s: Sandbox): void {
  s.crontab = { status: 0, stdout: 'MAILTO=x\n# comment\n*/5 * * * * /bin/sh /tmp/x.sh\n', stderr: '' }
  s.atq = { status: 0, stdout: '7\tThu Nov 12 05:00:00 2026 a tester\n', stderr: '' }
  writeFileSync(join(s.la, 'com.planted.agent.plist'), '<plist/>')
  mkdirSync(join(s.tasks, 'planted-task'))
  writeFileSync(s.cronFile, JSON.stringify([{ id: 'cron-1', cron: '*/10 * * * *', prompt: 'wake me' }]))
}

beforeEach(() => {
  vi.mocked(createAgentMessage).mockClear()
})

describe('negative control: the installed set reports nothing', () => {
  it('a sandbox holding exactly what the repo installs gives zero entries, no report, and writes state', () => {
    const s = sandbox()
    const { round, reported } = runSchedulerCensusOnce(s.deps)
    expect(round.newEntries).toEqual([])
    expect(round.unreached).toEqual([])
    expect(reported).toBe(false)
    expect(s.sent).toEqual([])
    expect(JSON.parse(readFileSync(s.deps.statePath, 'utf-8'))).toMatchObject({ v: 1, seen: {}, unreached: {} })
  })

  it('the REAL repo: every template label and installer LABEL is known, and the seed task names too', () => {
    const known = deriveKnownGood(REAL_REPO, 'marveen', [])
    expect(known.ok).toBe(true)
    if (!known.ok) return
    for (const l of ['com.marveen.dashboard', 'com.marveen.channels', 'com.marveen.channel-coordinator',
      'com.marveen.main-inbox-observer', 'com.marveen.telegram-progress-watchdog', 'com.marveen.installed-drift']) {
      expect(known.launchAgentLabels.has(l), l).toBe(true)
    }
    expect(known.scheduledTaskNames.has('reggeli-napindito')).toBe(true)
    expect(known.scheduledTaskNames.has('auto-update')).toBe(true)
    // No unresolved template variable leaks into the set as a label.
    for (const l of known.launchAgentLabels) expect(l.includes('$'), l).toBe(false)
  })
})

describe('positive control: one planted entry per store, each reported exactly once', () => {
  it('reports all five, then stays silent on the next round', () => {
    const s = sandbox()
    runSchedulerCensusOnce(s.deps) // baseline of the clean sandbox: nothing
    plantOnePerStore(s)
    const second = runSchedulerCensusOnce(s.deps)
    expect(second.reported).toBe(true)
    expect(second.round.newEntries.map((e) => [e.store, e.label]).sort()).toEqual([
      [STORE_AT, '7\tThu Nov 12 05:00:00 2026 a tester'],
      [STORE_SCHEDULED_TASKS, 'planted-task'],
      [STORE_CRONTAB, '*/5 * * * * /bin/sh /tmp/x.sh'],
      [`claude-cron-file:${s.cronFile}`, 'cron-1 */10 * * * * wake me'],
      [STORE_LAUNCH_AGENTS, 'com.planted.agent.plist'],
    ].sort())
    expect(s.sent).toHaveLength(1)
    const text = s.sent[0]
    for (const want of ['com.planted.agent.plist', 'planted-task', '/tmp/x.sh', 'cron-1', '7\tThu Nov 12']) expect(text).toContain(want)
    expect(text).toContain('first seen 2026-11-12T04:00:00.000Z')
    expect(text).toMatch(/com\.planted\.agent\.plist \(created \d{4}-/)
    expect(text).not.toContain('com.marveen.tmpl-unit')

    const third = runSchedulerCensusOnce(s.deps)
    expect(third.round.newEntries).toEqual([])
    expect(third.reported).toBe(false)
    expect(s.sent).toHaveLength(1)
  })

  it('a non-.plist file next to an installed one is reported (a backup is not the installed unit)', () => {
    const s = sandbox()
    writeFileSync(join(s.la, 'com.marveen.tmpl-unit.plist.bak'), '<plist/>')
    const { round } = runSchedulerCensusOnce(s.deps)
    expect(round.newEntries.map((e) => e.label)).toEqual(['com.marveen.tmpl-unit.plist.bak'])
  })

  it('the first round of an install is a baseline: entries already there are listed once, marked as such', () => {
    const s = sandbox()
    plantOnePerStore(s)
    const first = runSchedulerCensusOnce(s.deps)
    expect(first.round.baseline).toBe(true)
    expect(first.round.newEntries).toHaveLength(5)
    expect(s.sent[0]).toMatch(/^\[SCHEDULER-CENSUS\] First census on this install: 5 /)
    expect(runSchedulerCensusOnce(s.deps).reported).toBe(false)
  })

  it('an entry that disappears and comes back is a new appearance and is reported again', () => {
    const s = sandbox()
    runSchedulerCensusOnce(s.deps)
    mkdirSync(join(s.tasks, 'flip'))
    expect(runSchedulerCensusOnce(s.deps).round.newEntries.map((e) => e.label)).toEqual(['flip'])
    // remove, one silent round, put back
    rmSync(join(s.tasks, 'flip'), { recursive: true })
    expect(runSchedulerCensusOnce(s.deps).round.newEntries).toEqual([])
    mkdirSync(join(s.tasks, 'flip'))
    expect(runSchedulerCensusOnce(s.deps).round.newEntries.map((e) => e.label)).toEqual(['flip'])
  })
})

describe('an edited entry is reported once (didi 59440 L2), and a lookalike under an installer name (L3)', () => {
  it('an unknown task whose prompt is edited after it was reported: changed, once', () => {
    const s = sandbox()
    runSchedulerCensusOnce(s.deps)
    mkdirSync(join(s.tasks, 'mine'))
    writeFileSync(join(s.tasks, 'mine', 'SKILL.md'), '---\nname: mine\n---\n\nsay hi\n')
    expect(runSchedulerCensusOnce(s.deps).round.newEntries.map((e) => e.label)).toEqual(['mine'])
    writeFileSync(join(s.tasks, 'mine', 'SKILL.md'), '---\nname: mine\n---\n\nwork all night\n')
    const r = runSchedulerCensusOnce(s.deps)
    expect(r.round.newEntries).toEqual([])
    expect(r.round.changedEntries.map((e) => [e.store, e.label, e.kind])).toEqual([[STORE_SCHEDULED_TASKS, 'mine', 'changed']])
    expect(r.reported).toBe(true)
    expect(s.sent.at(-1)).toMatch(/^\[SCHEDULER-CENSUS\] No new scheduler entries; 1 changed/)
    expect(s.sent.at(-1)).toContain(`- ${STORE_SCHEDULED_TASKS}: mine (content changed`)
    expect(runSchedulerCensusOnce(s.deps).reported).toBe(false)
  })

  it('a SEEDED task (known name, never reported) whose task-config.json is rewritten: changed', () => {
    const s = sandbox()
    writeFileSync(join(s.tasks, 'seed-a', 'task-config.json'), '{"schedule":"0 9 * * *","agent":"marveen"}')
    runSchedulerCensusOnce(s.deps)
    writeFileSync(join(s.tasks, 'seed-a', 'task-config.json'), '{"schedule":"*/5 * * * *","agent":"dexter"}')
    const r = runSchedulerCensusOnce(s.deps)
    expect(r.round.changedEntries.map((e) => [e.label, e.kind])).toEqual([['seed-a', 'changed']])
    expect(r.round.newEntries).toEqual([])
  })

  it('an installed plist rewritten in place, and a cron-file item edited under the same id: changed', () => {
    const s = sandbox()
    writeFileSync(s.cronFile, JSON.stringify([{ id: 'cron-1', cron: '0 * * * *', prompt: 'a' }]))
    runSchedulerCensusOnce(s.deps)
    writeFileSync(join(s.la, 'com.marveen.tmpl-unit.plist'), '<plist><string>/tmp/other.sh</string></plist>')
    writeFileSync(s.cronFile, JSON.stringify([{ id: 'cron-1', cron: '* * * * *', prompt: 'a' }]))
    const r = runSchedulerCensusOnce(s.deps)
    expect(r.round.changedEntries.map((e) => [e.store, e.kind]).sort()).toEqual([
      [STORE_LAUNCH_AGENTS, 'changed'],
      [`claude-cron-file:${s.cronFile}`, 'changed'],
    ].sort())
    expect(r.round.newEntries).toEqual([])
  })

  it('a plist appearing later under a name our installers use is reported, the baseline ones are not', () => {
    const s = sandbox()
    rmSync(join(s.la, 'com.marveen.heredoc-unit.plist'))
    const first = runSchedulerCensusOnce(s.deps)
    expect(first.round.changedEntries).toEqual([])
    expect(first.reported).toBe(false)
    writeFileSync(join(s.la, 'com.marveen.heredoc-unit.plist'), '<plist/>')
    const r = runSchedulerCensusOnce(s.deps)
    expect(r.round.changedEntries.map((e) => [e.label, e.kind])).toEqual([['com.marveen.heredoc-unit.plist', 'known-appeared']])
    expect(s.sent.at(-1)).toContain("com.marveen.heredoc-unit.plist (appeared under an installer's name: check it is ours)")
    expect(runSchedulerCensusOnce(s.deps).reported).toBe(false)
  })

  it('a state written before digests existed: that round records them silently, no flood', () => {
    const s = sandbox()
    writeFileSync(s.deps.statePath, JSON.stringify({ v: 1, seen: {}, unreached: {} }))
    const r = runSchedulerCensusOnce(s.deps)
    expect(r.round.changedEntries).toEqual([])
    expect(r.reported).toBe(false)
    expect(Object.keys(JSON.parse(readFileSync(s.deps.statePath, 'utf-8')).content).length).toBeGreaterThan(0)
  })

  it('a store NOT REACHED keeps its digests: reading it again reports no change', () => {
    const s = sandbox()
    runSchedulerCensusOnce(s.deps)
    chmodSync(s.tasks, 0o000)
    try {
      runSchedulerCensusOnce(s.deps)
    } finally {
      chmodSync(s.tasks, 0o755)
    }
    expect(runSchedulerCensusOnce(s.deps).round.changedEntries).toEqual([])
  })
})

describe('a store the census cannot read is NOT REACHED with the reason, never empty', () => {
  it('each store, once per reason; the entries it had are not re-reported when it is read again', () => {
    const s = sandbox()
    plantOnePerStore(s)
    runSchedulerCensusOnce(s.deps) // baseline: the five planted ones are now seen
    s.sent.length = 0

    s.crontab = { status: 1, stdout: '', stderr: 'crontab: tmp/tmp.123: Permission denied\n' }
    s.atq = { status: null, stdout: '', stderr: '', error: 'ENOENT' }
    chmodSync(s.la, 0o000)
    chmodSync(s.tasks, 0o000)
    writeFileSync(s.cronFile, '{not json')
    let r
    try {
      r = runSchedulerCensusOnce(s.deps)
    } finally {
      chmodSync(s.la, 0o755)
      chmodSync(s.tasks, 0o755)
    }
    const why = Object.fromEntries(r.round.unreached.map((u) => [u.store, u.reason]))
    expect(why[STORE_CRONTAB]).toBe('crontab -l exit 1: crontab: tmp/tmp.123: Permission denied')
    expect(why[STORE_AT]).toBe('atq could not run: ENOENT')
    expect(why[STORE_LAUNCH_AGENTS]).toMatch(/EACCES/)
    expect(why[STORE_SCHEDULED_TASKS]).toMatch(/EACCES/)
    expect(why[`claude-cron-file:${s.cronFile}`]).toMatch(/not JSON/)
    expect(r.round.newEntries).toEqual([])
    expect(s.sent[0]).toContain('NOT REACHED (could not be read; this is not an empty store):')

    // Same reasons on the next round: silent for crontab and the cron file (both still failing).
    writeFileSync(s.cronFile, '{not json')
    s.atq = { status: 0, stdout: '7\tThu Nov 12 05:00:00 2026 a tester\n', stderr: '' }
    const again = runSchedulerCensusOnce(s.deps)
    expect(again.round.unreached.map((u) => u.store)).toEqual([])
    // Read again: the stores recovered and NOTHING already reported comes back as new.
    expect(again.round.recovered.sort()).toEqual([STORE_AT, STORE_LAUNCH_AGENTS, STORE_SCHEDULED_TASKS].sort())
    expect(again.round.newEntries).toEqual([])
  })

  it('a cron file of unknown shape is NOT REACHED, not an empty store', () => {
    const s = sandbox()
    writeFileSync(s.cronFile, JSON.stringify({ jobs: [{ cron: '* * * * *' }] }))
    const r = readCronFile(s.cronFile)
    expect(r.reached).toBe(false)
    if (!r.reached) expect(r.reason).toContain('unknown shape (object with keys [jobs])')
  })

  it('an object with a tasks array is read', () => {
    const s = sandbox()
    writeFileSync(s.cronFile, JSON.stringify({ tasks: [{ cron: '0 * * * *', prompt: 'p' }] }))
    const r = readCronFile(s.cronFile)
    expect(r.reached && r.entries.length).toBe(1)
  })

  it('a known-good set that cannot be derived makes the judged stores NOT REACHED, not a flood', () => {
    const s = sandbox()
    rmSync(join(s.repo, 'scripts', 'com.marveen.tmpl-unit.plist.template'))
    const { round } = runSchedulerCensusOnce(s.deps)
    expect(round.newEntries).toEqual([])
    const stores = round.unreached.map((u) => u.store).sort()
    expect(stores).toEqual([STORE_LAUNCH_AGENTS, STORE_SCHEDULED_TASKS].sort())
    expect(round.unreached[0].reason).toMatch(/known-good set not derivable: .*no com\.\*\.plist\.template/)
  })
})

describe('delivery', () => {
  it('a failed send does not advance the state: the next round reports the same entry again', () => {
    const s = sandbox()
    runSchedulerCensusOnce(s.deps)
    mkdirSync(join(s.tasks, 'late'))
    s.sendOk = false
    expect(runSchedulerCensusOnce(s.deps).reported).toBe(false)
    s.sendOk = true
    const r = runSchedulerCensusOnce(s.deps)
    expect(r.reported).toBe(true)
    expect(r.round.newEntries.map((e) => e.label)).toEqual(['late'])
  })

  it('the default send routes through the front desk with a scheduler-census header', () => {
    expect(sendToFrontDesk('[SCHEDULER-CENSUS] body')).toBe(true)
    expect(resolveMachineNoticeRecipient).toHaveBeenCalledWith([SCHEDULER_CENSUS_SUBJECT])
    expect(SCHEDULER_CENSUS_SUBJECT).not.toBe('')
    const [from, to, content] = vi.mocked(createAgentMessage).mock.calls[0]
    expect([from, to]).toEqual(['system', 'jarvis'])
    const [header, body] = String(content).split('\n')
    expect(JSON.parse(header.replace(/^\[FRONT-DESK\] /, ''))).toMatchObject({ type: 'scheduler-census', subjects: ['scheduler-census'] })
    expect(body).toBe('[SCHEDULER-CENSUS] body')
  })

  it('report text: nothing to say gives null', () => {
    const round = diffCensus([], { ok: true, launchAgentLabels: new Set(), scheduledTaskNames: new Set() }, { v: 1, seen: {}, unreached: {} }, 'now')
    expect(buildCensusReport(round, '/x')).toBeNull()
  })
})

describe('wiring', () => {
  it('web.ts starts the watcher outside web-only mode and clears it on shutdown', () => {
    const src = readFileSync(join(REAL_REPO, 'src', 'web.ts'), 'utf-8')
    expect(src).toMatch(/const schedulerCensusInterval = webOnly \? undefined : startSchedulerCensusWatcher\(\)/)
    expect(src).toMatch(/if \(schedulerCensusInterval\) clearInterval\(schedulerCensusInterval\)/)
    expect(existsSync(join(REAL_REPO, 'src', 'web', 'scheduler-census-watcher.ts'))).toBe(true)
  })
})

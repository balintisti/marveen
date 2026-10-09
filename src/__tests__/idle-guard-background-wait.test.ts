// BACKGROUND WAIT IS WORKING, NOT IDLE -- card 53bcfe74 (cards 53521828 / 3c27105f in the background).
//
// Measured 2026-10-09 07:21-09:55: nine false idle-guard alerts (mandark x4, friday x2, computress
// x3, didi x2) for agents whose main prompt was empty while their own background work ran, and every
// one cost a full paid turn ("N minutes idle ... ALREADY WOKEN"). Recognised background work is
// `Waiting for N background agents to finish`, a timed sub-agent row under the footer, and the
// shells / monitors the footer counts. It means no wake, no repeat and no coordinator notice; the
// 2 h hold of the base branch is gone from the watcher's thresholds.
//
// The fixtures are REAL pane text (the guard's own store/context-guard-last-pane-*.txt, live
// tmux captures, and the verbatim capture in card 53521828 comment 31745). The two exceptions
// are marked RECONSTRUCTED. The decision under test is the watcher's own tick(), with the REAL
// detectPaneState and the real decideIdleAlert: only tmux, the database and the logger are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { tmpDirs } from './helpers/tmp-dirs.js'

const hoisted = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  return { root: mkdtempSync(join(tmpdir(), 'idle-bgwait-')) }
})
tmpDirs().adopt(hoisted.root)
const debug = vi.fn()
const panes = new Map<string, string | null>()
const messages: Array<{ from: string; to: string; content: string }> = []
const ownerAlerts: string[] = []
let cardRows: Array<Record<string, unknown>> = []

vi.mock('../logger.js', () => ({
  logger: { debug: (...a: unknown[]) => debug(...a), info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, PROJECT_ROOT: hoisted.root }
})
vi.mock('../web/agent-process.js', () => ({
  capturePane: (session: string) => (panes.has(session) ? panes.get(session) : null),
  isAgentRunning: () => true,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => join(hoisted.root, 'agents', a),
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: (t: string) => { ownerAlerts.push(t) } }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  listKanbanCards: () => cardRows,
  getLabelsForAllCards: () => new Map(),
  getLastOutboundMessageAt: () => null,
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (from: string, to: string, content: string) => { messages.push({ from, to, content }); return { id: messages.length } },
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => null,
}))

// NOT mocked: detectPaneState, busyEvidence, runningBackgroundWork -- the classification is the point.
const { detectPaneState, runningBackgroundWork, runningSubagentCount } = await import('../pane-state.js')
let { tick } = await import('../web/idle-agent-watcher.js')
const { MAIN_AGENT_ID } = await import('../config.js')

// --- REAL panes --------------------------------------------------------------------------------
// friday 08:25: the waiting line, 1 footer shell, one sub-agent row (store/context-guard-last-pane-friday.txt).
// mandark 08:55: waiting line + one row, footer without a shell count (the 4 mandark alerts of the morning).
// didi 08:50: 3 shells and five rows, one of them `idle` (a finished teammate, not work).
// computress / didi LIVE: tmux capture-pane 2026-10-09 ~11:55, the footer shapes `2 shells` and `1 shell, 1 monitor`.
const FRIDAY_0825 = `  kell, hány beolvasztás készült el a 31931aa74e után, és a hiányzókat újra kell
  csinálni. A 11:55-ös ébresztő időzítő is leáll, újra kell indítani. A teljes
  állapot a HANDOFF.md-ben van, kártya-azonosítókkal és fájl-utakkal.

✻ Waiting for 1 background agent to finish

─────────────────────────────────────────────────────────────────────── Friday ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 1 shell · ↓ to manage

  ⏺ main
  ◯ general-purpose  Running secret-gate.py on range   5m 22s · ↓ 80.5k tokens`

const MANDARK_0855 = `
⏺ API Error: Connection lost mid-response. The response above may be 
  incomplete.

✻ Waiting for 1 background agent to finish

────────────────────────────────────────────────────────────────────── Mandark ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage

  ⏺ main
  ◯ general-purpose  Checking trial daysLeft calcul… 25m 53s · ↓ 202.2k tokens`

const DIDI_0850 = `───────────────────────────────────────────────────────────────────────── Didi ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 3 shells · ↓ to manage

  ⏺ main
  ◯ didi-rfe4    rfe4 collector: 4 FE re-reviews  1h 27m 44s · ↓ 133.5k tokens
  ◯ didi-rbb97   rbb97 collector: bb977db1 review    27m 57s · ↓ 136.8k tokens
  ◯ didi-rA      rA: 71160513 + c94752fd re-revi…                         idle
  ◯ didi-rB      rB: e43527d0 + 3e0807da review   1h 27m 22s · ↓ 237.8k tokens
  ◯ didi-rC      rC: 94df2903 re-verdict          1h 27m 15s · ↓ 188.2k tokens`

const COMPUTRESS_LIVE = `  kiértékelem.

─────────────────────────────────────────────────────────────────── Computress ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 2 shells · ↓ to manage`

const DIDI_LIVE = `───────────────────────────────────────────────────────────────────────── Didi ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 1 shell, 1 monitor · ↓ to manage

  ⏺ main
  ◯ didi-rC     Continue r94df tenant delete      1h 13m 16s · ↓ 148.8k tokens
  ◯ didi-r0428  Continue r0428 branch routing      1h 13m 8s · ↓ 196.8k tokens`


// dexter, card 53521828 comment 31745, VERBATIM (the capture-pane tail the coordinator pasted).
const DEXTER_31745 = `     fb-856c-5e4e07d86b72/tasks/b0t1umzd1.output | tail -4; cat
     /private/tmp/claude-501/-Users-Shared-marveen-dexter/770a5907-16a8-40fb-856
     c-5e4e07d86b72/tasks/b0n6p7ese.output 2>/dev/null | tail -4

✶ Fluttering… (41s · ↓ 2.1k tokens · thought for 1s)

─────────────────────────────────────────────────────────────────────── Dexter ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 3 shells, 2 monitors · esc to interrupt · ↓ to m…

  ⏺ main
  ◯ m6f70b  Finish 6f704873 half-done merge          27m 25s · ↓ 169.8k tokens
  ◯ r3e08   Fix 3e0807da red gate                    27m 11s · ↓ 115.4k tokens`

// RECONSTRUCTED from comment 31701 (it describes the capture, it does not paste it): didi 04:48,
// `Cultivating... (19s)` with NO token counter on the spinner line, `esc to interrupt` in the footer,
// three agent-tree rows under it (`◯ r7116 ... 18m 40s`). The footer is cut at `↓ to m…` like dexter's.
// Row labels are invented; the shape is the measured one. Before the fix: `unknown`.
const DIDI_31701_RECONSTRUCTED = `  workflow-n lefutott, a verdikt a kartyan van.

✢ Cultivating… (19s)

───────────────────────────────────────────────────────────────────────── Didi ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 3 shells, 1 monitor · esc to interrupt · ↓ to m…

  ⏺ main
  ◯ r7116   Run the e2e base suite                   18m 40s · ↓ 120.4k tokens
  ◯ r0428   Branch routing review                    18m 12s · ↓ 98.0k tokens
  ◯ r94df   Tenant delete re-verdict                 17m 55s · ↓ 77.3k tokens`

// RECONSTRUCTED from comment 31745's first line: `Fluttering... (41s` with the counter cut off, same
// footer, FOUR rows (the window of five lines then holds no footer at all).
const DEXTER_CUT_COUNTER_RECONSTRUCTED = DEXTER_31745
  .replace('✶ Fluttering… (41s · ↓ 2.1k tokens · thought for 1s)', '✶ Fluttering… (41s')
  .concat('\n  ◯ b0t1um   Poll the base run                       12m 3s · ↓ 40.1k tokens\n  ◯ b0n6p7   Poll the second run                     12m 1s · ↓ 38.9k tokens')

// The coordinator's own pane in these tests: mid-turn (spinner with the token counter, `esc to interrupt`).
const COORDINATOR_BUSY = `· Wrangling… (17s · ↓ 768 tokens)

────────────────────────────────────────────────────────────────────── Marveen ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt`

// A truly empty pane: prompt empty, no waiting line, no rows, no shells (jarvis-shaped footer).
const EMPTY = `  Kész, minden kártya a helyén.

✻ Worked for 1m 5s · done 3:45

─────────────────────────────────────────────────────────────────────── Jarvis ─
❯ 
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)`

// Positive fixtures: [name, pane, why it is background work]
const POSITIVES: Array<[string, string]> = [
  ['friday 08:25 (waiting line + 1 shell + row)', FRIDAY_0825],
  ['mandark 08:55 (waiting line + row, no shell count)', MANDARK_0855],
  ['didi 08:50 (3 shells + four live rows + one idle row)', DIDI_0850],
  ['computress live (2 shells, nothing else)', COMPUTRESS_LIVE],
  ['didi live (1 shell, 1 monitor + two rows)', DIDI_LIVE],
  ['dexter 31745 verbatim (spinner + esc to interrupt + 2 rows)', DEXTER_31745],
  ['didi 31701 reconstructed (Cultivating, 3 rows, cut footer)', DIDI_31701_RECONSTRUCTED],
  ['dexter, counter cut + 4 rows reconstructed', DEXTER_CUT_COUNTER_RECONSTRUCTED],
]

// --- the unit view: what the classifier makes of the pane --------------------------------------
describe('the pane reads as background work', () => {
  it.each(POSITIVES)('%s -> runningBackgroundWork > 0', (_n, p) => {
    expect(runningBackgroundWork(p)).toBeGreaterThan(0)
  })

  it('exact counts (sub-agents + footer shells + footer monitors)', () => {
    expect(runningBackgroundWork(FRIDAY_0825)).toBe(1 + 1)       // max(1 row, waiting 1) + 1 shell
    expect(runningBackgroundWork(MANDARK_0855)).toBe(1)
    expect(runningBackgroundWork(DIDI_0850)).toBe(4 + 3)         // the `idle` row is not a live agent
    expect(runningBackgroundWork(COMPUTRESS_LIVE)).toBe(2)
    expect(runningBackgroundWork(DIDI_LIVE)).toBe(2 + 1 + 1)
    expect(runningBackgroundWork(DEXTER_31745)).toBe(2 + 3 + 2)
  })

  it('cards 31701 / 31745: a working pane with agent-tree rows is `busy`, not `unknown`', () => {
    for (const p of [DEXTER_31745, DIDI_31701_RECONSTRUCTED, DEXTER_CUT_COUNTER_RECONSTRUCTED]) {
      expect(detectPaneState(p)).toBe('busy')
    }
  })

  it('CONTROL: the truncated footer is NOT an idle verdict (pane-state.test.ts rule): without a busy signal it stays `unknown`, and the rows still count', () => {
    const notBusy = DEXTER_31745
      .replace('✶ Fluttering… (41s · ↓ 2.1k tokens · thought for 1s)', '')
      .replace(' · esc to interrupt', '')
    expect(detectPaneState(notBusy)).toBe('unknown')
    expect(runningBackgroundWork(notBusy)).toBe(2 + 3 + 2)
  })

  it('a free prompt with background work stays `idle` for the classifier (the prompt IS free); only the guard reads it as work', () => {
    expect(detectPaneState(FRIDAY_0825)).toBe('idle')
    expect(detectPaneState(COMPUTRESS_LIVE)).toBe('idle')
  })

  it('a duration with no seconds (`1h 2m`) is still a timed live row (card 53bcfe74 (b))', () => {
    const p = FRIDAY_0825.replace('5m 22s · ↓ 80.5k tokens', '1h 2m · ↓ 260k tokens')
    expect(runningSubagentCount(p)).toBe(1)
    expect(runningSubagentCount(p.replace('1h 2m · ↓ 260k tokens', '1h 2m 29s · ↓ 260.3k tokens'))).toBe(1)
  })

  it('CONTROL: the truly empty pane is 0, and so is the idle teammate row alone', () => {
    expect(runningBackgroundWork(EMPTY)).toBe(0)
    expect(runningBackgroundWork(DIDI_0850.replace(/\n {2}◯ didi-r(?:fe4|bb97|B|C) [^\n]*/g, '').replace('3 shells', 'no shells'))).toBe(0)
  })

  // A pane that only QUOTES the markers in its scrollback is not working. Each marker is anchored:
  // the waiting line to column 0 with the spinner glyph just above the input box, the rows to the
  // region under the footer, the shell / monitor counts to the footer line itself.
  it('ordinary chat text quoting the markers does not count (scrollback, indented, assistant line, quoted row/footer)', () => {
    const quoted = [
      '⏺ Waiting for 2 background agents to finish, then I merge.',
      '  The footer said "Waiting for 2 background agents to finish" and "3 shells, 2 monitors".',
      '  Waiting for 2 background agents to finish',
      '  ◯ general-purpose  Quoted row from an old capture   5m 22s · ↓ 80.5k tokens',
      '  ⏵⏵ bypass permissions on · 3 shells, 2 monitors · ↓ to manage',
      '  Run `claude` with 4 shells and 1 monitor open.',
    ].join('\n')
    const p = quoted + '\n\n' + EMPTY
    expect(runningBackgroundWork(p)).toBe(0)
    // the same quotes with the real marker lines added are counted: the quotes are the only difference
    expect(runningBackgroundWork(p.replace('(shift+tab to cycle)', '(shift+tab to cycle)\n\n  ⏺ main\n  ◯ general-purpose  Real   5m 22s · ↓ 80.5k tokens'))).toBe(1)
  })

  it('prose quoting the waiting line RIGHT above the box (indented, or led by the assistant marker) does not count; the glyph line does', () => {
    const tailOf = (line: string) => `  Kész.\n${line}\n\n` + EMPTY.split('\n').slice(-4).join('\n')
    expect(runningBackgroundWork(tailOf('  Waiting for 2 background agents to finish'))).toBe(0)
    expect(runningBackgroundWork(tailOf('⏺ Waiting for 2 background agents to finish'))).toBe(0)
    expect(runningBackgroundWork(tailOf('✻ Waiting for 2 background agents to finish'))).toBe(2)   // POSITIVE CONTROL: same text, the real marker
  })

  it('the panel hidden or cut off: the waiting line alone is counted; a footer with only monitors is counted', () => {
    const waitingOnly = FRIDAY_0825.split('\n').slice(0, -3).join('\n').replace(' · 1 shell', '')
    expect(waitingOnly).not.toContain('◯')
    expect(runningBackgroundWork(waitingOnly)).toBe(1)
    expect(runningBackgroundWork(EMPTY.replace('(shift+tab to cycle)', '· 2 monitors · ↓ to manage'))).toBe(2)
    expect(runningBackgroundWork(EMPTY.replace('(shift+tab to cycle)', '· 1 shell · ↓ to manage'))).toBe(1)
  })

  it('the waiting line is not read from the scrollback above the box: a glyph-led line twelve lines up does not count', () => {
    const far = ['✻ Waiting for 2 background agents to finish', ...Array(8).fill('  text'), '', EMPTY].join('\n')
    expect(runningBackgroundWork(far)).toBe(0)
  })
})

// --- the decision view: the watcher's tick() ---------------------------------------------------
describe('tick() -- background work is working: no wake, no repeat, no coordinator notice', () => {
  const NOW = new Date('2026-10-09T10:00:00Z').getTime()
  const SPELL_MIN = 180
  const workcheck = (agent: string, kind: string) => {
    const dir = agent === MAIN_AGENT_ID ? hoisted.root : join(hoisted.root, 'agents', agent)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workcheck.json'), JSON.stringify({ kind }))
  }
  const assignedCards = () => {
    cardRows = ['a', 'b'].map((n) => ({
      id: `card-${n}`, title: `t-${n}`, status: 'in_progress', assignee: 'x', priority: 'normal',
      archived_at: null, updated_at: Math.floor(NOW / 1000), due_date: null,
    }))
  }

  beforeEach(async () => {
    vi.resetModules()
    ;({ tick } = await import('../web/idle-agent-watcher.js'))
    rmSync(join(hoisted.root, 'store'), { recursive: true, force: true })
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    debug.mockReset(); panes.clear(); messages.length = 0; ownerAlerts.length = 0; cardRows = []
    workcheck(MAIN_AGENT_ID, 'none')
    // The watcher visits the coordinator too; a busy pane keeps its own verdict out of the counts.
    panes.set(`agent-${MAIN_AGENT_ID}`, COORDINATOR_BUSY)
  })
  afterEach(() => { vi.useRealTimers() })

  /** Tick every 3 minutes (the watcher's own interval) and return the reasons seen, per tick. */
  const runSpell = (paneAt: (minute: number) => string, minutes = SPELL_MIN): string[] => {
    const reasons: string[] = []
    for (let m = 0; m <= minutes; m += 3) {
      panes.set('agent-x', paneAt(m))
      vi.setSystemTime(NOW + m * 60_000)
      tick()
      const calls = debug.mock.calls.filter(c => (c[0] as { agent?: string })?.agent === 'x')
      reasons.push(String((calls.at(-1)?.[0] as { reason?: string } | undefined)?.reason))
    }
    return reasons
  }
  const noise = () => messages.filter(m => m.to === MAIN_AGENT_ID || m.to === 'x').length + ownerAlerts.length

  describe.each([
    ['2 assigned cards', true],
    ['NOTHING assigned (didi: her work arrives as review messages)', false],
  ])('agent with %s', (_label, withCards) => {
    it.each(POSITIVES)('%s: three hours, zero wakes, zero repeats, zero notices', (_n, p) => {
      workcheck('x', 'assigned_open_cards'); if (withCards) assignedCards()
      const reasons = runSpell(() => p)
      expect(new Set(reasons)).toEqual(new Set(['subagents-running']))
      expect(noise()).toBe(0)
    })

    it('CONTROL: the same agent on a truly empty pane IS reported', () => {
      workcheck('x', 'assigned_open_cards'); if (withCards) assignedCards()
      const reasons = runSpell(() => EMPTY)
      expect(reasons).not.toContain('subagents-running')
      expect(noise()).toBeGreaterThan(0)
      if (withCards) {
        expect(messages.some(m => m.to === 'x' && m.content.includes('perce'))).toBe(true)                  // the wake
        expect(messages.some(m => m.to === MAIN_AGENT_ID && m.content.includes('FELEBRESZTETTEM'))).toBe(true) // stage 2
      } else {
        expect(messages.some(m => m.to === MAIN_AGENT_ID && m.content.includes('NINCS RA KIOSZTVA'))).toBe(true)
      }
    })
  })

  it('didi 26649 shape: shells + monitor in the footer and NO row at all, nothing assigned -> not idle', () => {
    workcheck('x', 'assigned_open_cards')
    const p = DIDI_LIVE.split('\n').slice(0, 4).join('\n')          // box + `1 shell, 1 monitor` footer, no panel
    expect(runningSubagentCount(p)).toBe(0)
    expect(new Set(runSpell(() => p))).toEqual(new Set(['subagents-running']))
    expect(noise()).toBe(0)
  })

  it('CONTROL: a sub-agent that FINISHED (row gone) is reported after the normal threshold, not before', () => {
    workcheck('x', 'assigned_open_cards'); assignedCards()
    const GONE = 60
    let before = -1
    const reasons = runSpell(m => {
      if (m === GONE) before = messages.length                     // everything sent while the row was still there
      return m < GONE ? MANDARK_0855 : EMPTY
    }, GONE + 45)
    expect(before).toBe(0)
    expect(reasons.slice(0, GONE / 3)).toEqual(Array(GONE / 3).fill('subagents-running'))
    expect(messages[0].to).toBe('x')                                // the first thing sent is the wake
    const wakeIdx = reasons.findIndex(r => r === 'wake-agent')
    expect(wakeIdx * 3).toBeGreaterThanOrEqual(GONE + 12)           // sustainedMs = 12 min counted from the row disappearing
    expect(wakeIdx * 3).toBeLessThanOrEqual(GONE + 21)
  })

  it('a pane that only QUOTES the waiting line in chat is still reported', () => {
    workcheck('x', 'assigned_open_cards'); assignedCards()
    const quoting = `  Az előző ébresztő: "Waiting for 2 background agents to finish" volt a lábléc.\n  3 shells, 2 monitors, ◯ general-purpose X   5m 22s · ↓ 80.5k tokens\n\n` + EMPTY
    const reasons = runSpell(() => quoting)
    expect(reasons).not.toContain('subagents-running')
    expect(messages.some(m => m.to === 'x')).toBe(true)
  })

  it('the 2 h hold is gone from the watcher: five hours of rows with no outgoing trace still hold', () => {
    workcheck('x', 'assigned_open_cards'); assignedCards()
    const reasons = runSpell(() => FRIDAY_0825, 5 * 60)
    expect(new Set(reasons)).toEqual(new Set(['subagents-running']))
    expect(noise()).toBe(0)
  })
})

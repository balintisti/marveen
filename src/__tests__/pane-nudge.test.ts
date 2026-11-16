// pane-nudge -- card 3cf0019f.
//
// The routine types one line into another agent's pane. Its tests therefore weigh REFUSALS more
// than the happy path: every refusal asserts that nothing was typed and no Enter was pressed.
// Fixture shapes come from parked-pane-remedy.test.ts (live captures, 2026-09-03 and 2026-09-05)
// and pane-state-mid-turn-api-error.test.ts (live capture, 2026-10-16).
import { describe, it, expect } from 'vitest'
import {
  NUDGE_EXIT,
  decidePaneNudge,
  exitCodeForRefusal,
  nudgePane,
  nudgeTextProblem,
  type NudgeDeps,
} from '../pane-nudge.js'

const FOOTER = '⏵⏵ bypass permissions on (shift+tab to cycle)'
const RULE = '─'.repeat(60)

const IDLE = ['scrollback a', RULE, '❯ ', RULE, FOOTER].join('\n')
const WORKING = ['✻ Thinking… (12s · ↓ 3.1k tokens · esc to interrupt)', RULE, '❯ ', RULE, FOOTER].join('\n')
const PERMISSION = [
  ' │ a Read() deny rule is configured; only you can approve running it anyway.',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n')
const PARKED = ['scrollback a', RULE, '❯ [inbox-wakeup] pending inter-agent messages', RULE, FOOTER].join('\n')
const USAGE_LIMIT = ['scrollback a', "You've hit your session limit. Your limit will reset at 7pm", RULE, '❯ ', RULE, FOOTER].join('\n')
// The shape this tool exists for: the turn died on an API error and the agent sits at an empty box.
const API_ERROR_IDLE = [
  '⏺ API Error: Connection lost mid-response. The response above may be ',
  '  incomplete.',
  '',
  RULE,
  '❯ ',
  RULE,
  FOOTER,
].join('\n')

describe('decidePaneNudge: go only on a provably stopped pane', () => {
  it('an idle pane with an empty visible box is go', () => {
    const d = decidePaneNudge(IDLE)
    expect(d.go).toBe(true)
    expect(d.refusal).toBeNull()
  })

  it('the mid-turn API error pane is go, and says so', () => {
    const d = decidePaneNudge(API_ERROR_IDLE)
    expect(d.go).toBe(true)
    expect(d.apiErrorAtTail).toBe(true)
  })

  it('a working pane is refused as working', () => {
    expect(decidePaneNudge(WORKING).refusal).toBe('working')
  })

  it('a permission prompt is refused as a dialog: the Enter would be a Yes', () => {
    expect(decidePaneNudge(PERMISSION).refusal).toBe('dialog')
  })

  it('text parked in the box is refused: not ours to overwrite', () => {
    expect(decidePaneNudge(PARKED).refusal).toBe('parked-input')
  })

  it('a reached usage limit is refused', () => {
    expect(decidePaneNudge(USAGE_LIMIT).refusal).toBe('usage-limit')
  })

  it('no capture, or a blank one, is unreadable and never go', () => {
    expect(decidePaneNudge(null).refusal).toBe('unreadable')
    expect(decidePaneNudge('  \n ').refusal).toBe('unreadable')
  })

  it('a pane that is not a known shape is unreadable, not go', () => {
    const d = decidePaneNudge('some unrelated shell output\n$ ')
    expect(d.go).toBe(false)
    expect(d.refusal).toBe('unreadable')
  })

  it('every refusal has its own non-zero exit code', () => {
    const codes = (['working', 'dialog', 'parked-input', 'unreadable', 'usage-limit'] as const).map(exitCodeForRefusal)
    expect(new Set(codes).size).toBe(5)
    expect(codes.every(c => c !== 0)).toBe(true)
  })
})

describe('nudgeTextProblem', () => {
  it('allows one short plain line', () => {
    expect(nudgeTextProblem('continue where you stopped')).toBeNull()
    expect(nudgeTextProblem('x'.repeat(300))).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['leading space', ' go'],
    ['trailing space', 'go '],
    ['too long', 'x'.repeat(301)],
    ['newline', 'two\nlines'],
    ['tab', 'a\tb'],
    ['escape', 'a\u001bb'],
    ['slash command', '/clear'],
    ['bash mode', '!rm x'],
    ['memory shortcut', '#note'],
    ['tmux flag', '-s flag'],
  ])('refuses %s', (_name, text) => {
    expect(nudgeTextProblem(text)).not.toBeNull()
  })
})

interface Fake {
  deps: NudgeDeps
  typed: string[]
  enters: { n: number }
  delays: number[]
  reads: { n: number }
}

/** A fake pane: captures come from `frames` in order, the last one repeats. Nothing is real. */
function fake(frames: Array<string | null>, onEnter?: (f: Fake) => void): Fake {
  const f: Fake = { typed: [], enters: { n: 0 }, delays: [], reads: { n: 0 }, deps: null as unknown as NudgeDeps }
  f.deps = {
    capture: () => frames[Math.min(f.reads.n++, frames.length - 1)],
    typeLiteral: (t: string) => { f.typed.push(t) },
    pressEnter: () => { f.enters.n++; onEnter?.(f) },
    delay: async (ms: number) => { f.delays.push(ms) },
  }
  return f
}

const FAST = { settleMs: 0, watchMs: 2000, pollMs: 500 }

function expectUntouched(f: Fake): void {
  expect(f.typed).toEqual([])
  expect(f.enters.n).toBe(0)
}

describe('nudgePane: refusals type nothing', () => {
  it('refuses on the first read of a working pane', async () => {
    const f = fake([WORKING])
    const o = await nudgePane(f.deps, 'continue', FAST)
    expect(o).toMatchObject({ kind: 'refused', stage: 'first-read', exit: NUDGE_EXIT.WORKING })
    expectUntouched(f)
  })

  it('refuses when the SECOND read flips to busy', async () => {
    const f = fake([IDLE, WORKING])
    const o = await nudgePane(f.deps, 'continue', FAST)
    expect(o).toMatchObject({ kind: 'refused', stage: 'second-read', exit: NUDGE_EXIT.WORKING })
    expect(f.reads.n).toBe(2)
    expectUntouched(f)
  })

  it('refuses when the second read shows a permission prompt', async () => {
    const f = fake([IDLE, PERMISSION])
    const o = await nudgePane(f.deps, 'continue', FAST)
    expect(o).toMatchObject({ kind: 'refused', stage: 'second-read', exit: NUDGE_EXIT.DIALOG })
    expectUntouched(f)
  })

  it('refuses when the second read shows text parked in the box', async () => {
    const f = fake([IDLE, PARKED])
    const o = await nudgePane(f.deps, 'continue', FAST)
    expect(o).toMatchObject({ kind: 'refused', exit: NUDGE_EXIT.PARKED })
    expectUntouched(f)
  })

  it.each([
    ['permission', PERMISSION, NUDGE_EXIT.DIALOG],
    ['parked', PARKED, NUDGE_EXIT.PARKED],
    ['usage limit', USAGE_LIMIT, NUDGE_EXIT.USAGE_LIMIT],
    ['failed capture', null, NUDGE_EXIT.UNREADABLE],
  ])('refuses a %s pane on the first read', async (_n, pane, exit) => {
    const f = fake([pane])
    const o = await nudgePane(f.deps, 'continue', FAST)
    expect(o).toMatchObject({ kind: 'refused', exit })
    expectUntouched(f)
  })

  it('waits settleMs between the two reads', async () => {
    const f = fake([WORKING])
    await nudgePane(f.deps, 'continue', { ...FAST, settleMs: 1000 })
    // first read refused: no wait yet
    expect(f.delays).toEqual([])
    const g = fake([IDLE, WORKING])
    await nudgePane(g.deps, 'continue', { ...FAST, settleMs: 1000 })
    expect(g.delays[0]).toBe(1000)
  })
})

describe('nudgePane: dry run, start, and not-started', () => {
  it('a dry run decides go and types nothing', async () => {
    const f = fake([IDLE, IDLE])
    const o = await nudgePane(f.deps, 'continue', { ...FAST, dryRun: true })
    expect(o).toMatchObject({ kind: 'dry-run', exit: 0 })
    expect(f.reads.n).toBe(2)
    expectUntouched(f)
  })

  it('types the line once, presses Enter once, and reports started on a busy footer', async () => {
    const f = fake([IDLE, IDLE], fr => {
      fr.deps.capture = () => WORKING
    })
    const o = await nudgePane(f.deps, 'continue where you stopped', FAST)
    expect(o).toMatchObject({ kind: 'started', exit: 0, extraEnters: 0 })
    expect(f.typed).toEqual(['continue where you stopped'])
    expect(f.enters.n).toBe(1)
  })

  it('a line that stays parked gets plain Enters, then is reported as not started (exit 8)', async () => {
    const text = 'continue where you stopped'
    const parked = ['scrollback', RULE, `❯ ${text}`, RULE, FOOTER].join('\n')
    const f = fake([IDLE, IDLE, parked])
    const o = await nudgePane(f.deps, text, { ...FAST, maxExtraEnters: 2, watchMs: 5000 })
    expect(o).toMatchObject({ kind: 'not-started', parked: true, exit: NUDGE_EXIT.NOT_STARTED, extraEnters: 2 })
    expect(f.typed).toEqual([text])
    expect(f.enters.n).toBe(3)
  })

  it('a retry Enter that lands is reported as started', async () => {
    const text = 'continue where you stopped'
    const parked = ['scrollback', RULE, `❯ ${text}`, RULE, FOOTER].join('\n')
    let enters = 0
    const f = fake([IDLE, IDLE])
    f.deps.pressEnter = () => {
      enters++
      f.enters.n++
      if (enters === 2) f.deps.capture = () => WORKING
    }
    f.deps.capture = (() => {
      let n = 0
      return () => (n++ < 2 ? IDLE : parked)
    })()
    const o = await nudgePane(f.deps, text, { ...FAST, maxExtraEnters: 2, watchMs: 5000 })
    expect(o).toMatchObject({ kind: 'started', extraEnters: 1 })
    expect(f.typed).toEqual([text])
    expect(f.enters.n).toBe(2)
  })

  it('an empty box and no turn is exit 8 and not parked', async () => {
    const f = fake([IDLE])
    const o = await nudgePane(f.deps, 'continue', { ...FAST, watchMs: 1000 })
    expect(o).toMatchObject({ kind: 'not-started', parked: false, exit: NUDGE_EXIT.NOT_STARTED })
    expect(f.typed).toEqual(['continue'])
  })

  it('a failed capture while watching is never read as started', async () => {
    let n = 0
    const f = fake([IDLE])
    f.deps.capture = () => (n++ < 2 ? IDLE : null)
    const o = await nudgePane(f.deps, 'continue', { ...FAST, watchMs: 1000 })
    expect(o.kind).toBe('not-started')
  })
})

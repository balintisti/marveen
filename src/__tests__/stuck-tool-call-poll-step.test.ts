import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Card 0fc42aaa, didi 31905: the decisive behaviour is the POLL STEP, not the pure
// helpers. Drive checkSession() across the freeze threshold with a stale footer
// and watch whether resumeMarveenSession() is called.
const h = vi.hoisted(() => ({ pane: '' as string | null, resume: vi.fn(async () => true) }))

vi.mock('../web/agent-process.js', () => ({ capturePane: () => h.pane }))
vi.mock('../web/channel-monitor.js', () => ({
  resumeMarveenSession: h.resume,
  sendAlert: vi.fn(),
  lastMainRespawnAt: () => 0,
  MARVEEN_POST_RESPAWN_GRACE_MS: 1,
}))
vi.mock('../web/routine-alert.js', () => ({ sendRoutineAlert: vi.fn() }))
vi.mock('../web/active-model.js', () => ({ readTranscriptMtimeFromProjectDir: () => null }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))
// CPU sample: an idle wedge profile (tmux pane pid, then ps %cpu).
vi.mock('node:child_process', () => ({
  execFileSync: (cmd: string) => (String(cmd).endsWith('ps') ? '0.5\n' : '12345\n'),
}))

import { checkSession } from '../web/stuck-tool-call-watcher.js'

const SEP = '─'.repeat(80)
const pane = (counter: string) => [
  '✻ Baked for 33s',
  '',
  '⏺ Bash(python3 scripts/dev-gc.py --apply-worktrees)',
  '  ⎿  Running…',
  '',
  `✻ Imagining… (${counter} · ↓ 733 tokens)`,
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt',
].join('\n')

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)

async function run(session: string, counterAt: (poll: number) => string, polls = 12) {
  for (let i = 0; i < polls; i++) {
    h.pane = pane(counterAt(i))
    await checkSession('main', session)
    vi.advanceTimersByTime(30_000)
  }
}

describe('stuck-tool-call poll step (card 0fc42aaa)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T00:20:00+02:00'))
    h.resume.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('stale footer + MOVING live spinner across the freeze threshold -> no respawn (10-16 00:28 shape)', async () => {
    await run('s-moving', i => fmt(43 + i * 30))
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('a spinner-shaped line in the scrollback does not mask the live one (last match wins)', async () => {
    // Seen 2026-10-17: a tool output that quoted an earlier pane capture.
    const quoted = '  ⎿  ✻ Imagining… (16s · ↓ 733 tokens · thought for 9s)'
    for (let i = 0; i < 12; i++) {
      h.pane = quoted + '\n' + pane(fmt(43 + i * 30))
      await checkSession('main', 's-quoted')
      vi.advanceTimersByTime(30_000)
    }
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('positive control: stale footer + FROZEN live spinner -> respawn', async () => {
    await run('s-frozen', () => '43s')
    expect(h.resume).toHaveBeenCalledTimes(1)
  })

  it('positive control: no spinner at all (2026-06-02 shape) -> respawn', async () => {
    for (let i = 0; i < 12; i++) {
      h.pane = ['✻ Worked for 31s', '', '❯ Maradjon, jó így.'].join('\n')
      await checkSession('main', 's-nospinner')
      vi.advanceTimersByTime(30_000)
    }
    expect(h.resume).toHaveBeenCalledTimes(1)
  })

  it('the spinner is tracked per session: another session moving does not veto a frozen one', async () => {
    for (let i = 0; i < 12; i++) {
      h.pane = pane(fmt(43 + i * 30))
      await checkSession('main', 's-other')
      h.pane = pane('43s')
      await checkSession('main', 's-frozen-2')
      vi.advanceTimersByTime(30_000)
    }
    expect(h.resume).toHaveBeenCalledTimes(1)
  })
})

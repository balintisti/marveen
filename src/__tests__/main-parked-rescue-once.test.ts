import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Card 1c7bd03d (2026-10-28 08:39-08:48): the main box held a line the clear
// could not remove. Past MAIN_PARKED_RESCUE_AFTER every 30 s round reached
// 'rescue-and-clear' again, so the owner got 17 identical "KIMENTETTUK es a
// mezot kitisztitottuk" messages for a box that was never cleared, and the pane
// got a fresh Escape + clear burst each time. One episode must give ONE rescue,
// at most ONE message per outcome, and a bounded number of clear attempts.

const h = vi.hoisted(() => {
  const SEP = '─'.repeat(80)
  const FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
  const PARKED = ['', SEP, '❯ Igen, írd meg Baloghnak a választ', SEP, FOOTER].join('\n')
  const EMPTY = ['', SEP, '❯ ', SEP, FOOTER].join('\n')
  return { PARKED, EMPTY, calls: [] as string[][], clearWorks: false, cleared: false }
})

vi.mock('node:child_process', async (orig) => ({
  ...(await orig() as object),
  execFileSync: vi.fn((_file: string, args?: string[]) => {
    if (Array.isArray(args)) {
      h.calls.push(args)
      if (args.includes('send-keys') && h.clearWorks && (args.includes('C-u') || args.includes('C-k'))) h.cleared = true
      if (args.includes('capture-pane')) return h.cleared ? h.EMPTY : h.PARKED
    }
    return ''
  }),
}))
vi.mock('../notify.js', () => ({ alertIsRedirected: () => false, notifyChannel: vi.fn(async () => {}), notifyTelegram: vi.fn(async () => {}), notifyOwner: vi.fn(async () => {}) }))

import {
  clearStaleParkedInput,
  mainParkedClearDue,
  PARKED_RESCUE_DIR,
  MAIN_PARKED_RESCUE_AFTER,
  MAIN_PARKED_CLEAR_MAX_TRIES,
  MAIN_PARKED_CLEAR_RETRY_EVERY,
  MAIN_PARKED_EPISODE_GAP_MS,
} from '../web/agent-process.js'
import { notifyChannel } from '../notify.js'
import { MAIN_CHANNELS_SESSION } from '../web/main-agent.js'

let clock = 5_000_000
const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
// Past UNWEDGE_COOLDOWN_MS, so every call is a new round of the same episode.
const COOLDOWN = 31_000

function rescueFiles(): string[] {
  try { return readdirSync(PARKED_RESCUE_DIR).filter(f => f.startsWith(`${MAIN_CHANNELS_SESSION}-`)) } catch { return [] }
}
function hasClearKeys(calls: string[][]): boolean {
  return calls.some(a => a.includes('send-keys') && (a.includes('C-u') || a.includes('C-k')))
}
function messages(): string[] {
  return vi.mocked(notifyChannel).mock.calls.map(c => String(c[0]))
}

// One router round. The 2 s stable-confirm and the clear settle delays are
// setTimeout-based; fake timers keep 50 rounds from costing 100 s of wall time.
async function round(): Promise<boolean> {
  const p = clearStaleParkedInput(MAIN_CHANNELS_SESSION)
  await vi.runAllTimersAsync()
  const r = await p
  clock += COOLDOWN
  return r
}

let before: Set<string>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  h.calls.length = 0
  h.clearWorks = false
  h.cleared = false
  vi.mocked(notifyChannel).mockClear()
  before = new Set(rescueFiles())
  clock += MAIN_PARKED_EPISODE_GAP_MS + COOLDOWN // a new episode for the same text
})
afterEach(() => {
  vi.useRealTimers()
  for (const f of rescueFiles()) if (!before.has(f)) rmSync(join(PARKED_RESCUE_DIR, f), { force: true })
})
afterAll(() => { nowSpy.mockRestore() })

describe('mainParkedClearDue (pure)', () => {
  it('first attempt at the rescue threshold, retries spaced, none past the cap', () => {
    expect(mainParkedClearDue(MAIN_PARKED_RESCUE_AFTER - 1, 0)).toBe(false)
    expect(mainParkedClearDue(MAIN_PARKED_RESCUE_AFTER, 0)).toBe(true)
    expect(mainParkedClearDue(MAIN_PARKED_RESCUE_AFTER + 1, 1)).toBe(false)
    expect(mainParkedClearDue(MAIN_PARKED_RESCUE_AFTER + MAIN_PARKED_CLEAR_RETRY_EVERY, 1)).toBe(true)
    expect(mainParkedClearDue(10_000, MAIN_PARKED_CLEAR_MAX_TRIES)).toBe(false)
  })
})

describe('main box: a clear that keeps failing (the 2026-10-28 loop)', () => {
  it('rescues once, sends one "clear failed" message, and stops sending keys after the cap', async () => {
    const extra = (MAIN_PARKED_CLEAR_MAX_TRIES + 2) * MAIN_PARKED_CLEAR_RETRY_EVERY
    const clearRounds: number[] = []
    for (let i = 1; i <= MAIN_PARKED_RESCUE_AFTER + extra; i++) {
      const start = h.calls.length
      await round()
      if (hasClearKeys(h.calls.slice(start))) clearRounds.push(i)
    }
    // The text never changed, so it is ONE episode: one file on disk.
    const created = rescueFiles().filter(f => !before.has(f))
    expect(created).toHaveLength(1)
    // Clear attempts: at the threshold, then spaced retries, then nothing.
    const expected = Array.from({ length: MAIN_PARKED_CLEAR_MAX_TRIES }, (_, k) => MAIN_PARKED_RESCUE_AFTER + k * MAIN_PARKED_CLEAR_RETRY_EVERY)
    expect(clearRounds).toEqual(expected)
    // Messages: the owner stage (manual fix) and ONE "clear failed" message.
    // None of them may claim the box was cleared: it never was.
    const msgs = messages()
    expect(msgs).toHaveLength(2)
    expect(msgs.some(m => m.includes('kitisztitottuk'))).toBe(false)
    const failed = msgs.filter(m => m.includes('NEM sikerult'))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain(join(PARKED_RESCUE_DIR, created[0]!))
    expect(failed[0]).toContain(`tmux attach -t ${MAIN_CHANNELS_SESSION}`)
  }, 60_000)
})

describe('main box: a clear that works', () => {
  // Runs after the failing-clear test on the SAME text with its record spent
  // (clearTries at the cap). The beforeEach gap is past MAIN_PARKED_EPISODE_GAP_MS,
  // so this is a new episode, as when the same scheduled prompt parks again later.
  it('rescues once and reports the cleared box only after the clear is verified', async () => {
    h.clearWorks = true
    let cleared = false
    for (let i = 1; i <= MAIN_PARKED_RESCUE_AFTER; i++) cleared = await round()
    expect(cleared).toBe(true)
    expect(rescueFiles().filter(f => !before.has(f))).toHaveLength(1)
    const ok = messages().filter(m => m.includes('kitisztitottuk'))
    expect(ok).toHaveLength(1)
    expect(messages().some(m => m.includes('NEM sikerult'))).toBe(false)
  }, 60_000)
})

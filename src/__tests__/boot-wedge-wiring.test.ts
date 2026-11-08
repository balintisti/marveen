/**
 * Card b1f0011b: the two call sites the unit tests cannot see, driven through the REAL
 * agent-process with `node:child_process` stubbed (same harness as
 * live-turn-placeholder-resend.test.ts), so every tmux call is seen.
 *
 *  1. clearInputBuffer, when the box will not empty, raises the boot-wedge signal
 *     (and only then).
 *  2. sendPromptToSession's follow-up passes the TAIL of the prompt too: a long
 *     prompt whose head scrolled out of a wrapped box is named, not read as landed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  pane: ((_sentEnter: boolean) => '') as (sentEnter: boolean) => string,
  keys: [] as string[][],
}))
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: () => log }))

vi.mock('../logger.js', () => ({ logger: log }))
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => (String(cmd).startsWith('which ') ? '/usr/bin/stub\n' : '')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
  execFileSync: vi.fn((_file: string, args: string[]) => {
    const a = args.map(String)
    const sentEnter = h.keys.some((k) => k[k.length - 1] === 'Enter')
    if (a.includes('capture-pane')) return h.pane(sentEnter)
    if (a.includes('send-keys')) h.keys.push(a.slice(a.indexOf('send-keys') + 1))
    return ''
  }),
}))

const { clearInputBuffer, sendPromptToSession } = await import('../web/agent-process.js')
const { setInputNotEmptiedHandler } = await import('../web/boot-wedge-rescue.js')

const SEP = '─'.repeat(80)
const FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
const EMPTY_IDLE = ['', SEP, '❯ ', SEP, FOOTER].join('\n')
const PARKED = ['', SEP, '❯ a fragment the clear cannot remove from this box', SEP, FOOTER].join('\n')

// didi's 2026-11-08 22:01 box (submit-followup-wrapped-box.test.ts has the provenance)
const DIDI_BOX_ROWS = [
  '❯ 400-at kap -- az ilyen tételt PUT /api/messages/<id>',
  '  {"status":"done","result":"[RESTART-ABLAK] felvéve a friss',
  '  sessionben","notify":false} zárja, ez a nyoma. KORLÁT: a futó prod fán (a',
  '  repo fő checkoutján) NE válts ágat, NE commitolj és NE nyiss belőle PR-t --',
  '  ha repo-munka kell, használj worktree-t (git worktree add). Röviden jelezz a',
  '  csatornádon, hogy friss kontextussal folytatod.',
]
const DIDI_PANE = ['', SEP, ...DIDI_BOX_ROWS, '', SEP, FOOTER].join('\n')
const VISIBLE = DIDI_BOX_ROWS.map((r) => r.replace(/^❯ /, '').trim()).join(' ')
const PROMPT = '[CONTEXT-GUARD] Friss kontextussal indultál. KIVÉTEL: a "system" feladó nem ágens, neki küldött nyugta ' + VISIBLE

const flush = () => new Promise((r) => setImmediate(r))
const warned = (text: string) => log.warn.mock.calls.filter((c) => String(c[1]).includes(text))

describe('boot-wedge wiring through the real agent-process', () => {
  const handler = vi.fn()
  beforeEach(() => {
    h.keys.length = 0
    log.warn.mockClear()
    log.error.mockClear()
    handler.mockClear()
    setInputNotEmptiedHandler(handler)
  })
  afterEach(() => setInputNotEmptiedHandler(null))

  it('clearInputBuffer: a box that will not empty raises the signal, with the agent name', async () => {
    h.pane = () => PARKED
    expect(await clearInputBuffer('agent-didi')).toBe(false)
    expect(log.error.mock.calls.some((c) => String(c[1]).includes('could not be emptied'))).toBe(true)
    await flush()
    expect(handler.mock.calls).toEqual([['didi']])
  })

  it('CONTROL: a box that empties raises nothing', async () => {
    let clears = 0
    h.pane = () => (h.keys.length > clears ? EMPTY_IDLE : PARKED)
    clears = 0
    expect(await clearInputBuffer('agent-didi')).toBe(true)
    await flush()
    expect(handler).not.toHaveBeenCalled()
  })

  it('sendPromptToSession: a long prompt parked in a wrapped box is named parked-multirow, and no key follows the submit', async () => {
    h.pane = (sentEnter) => (sentEnter ? DIDI_PANE : EMPTY_IDLE)
    expect(await sendPromptToSession('agent-didi', PROMPT, null, { waitForIdle: false, survival: 'lost', survivalReason: 'test' })).toBe('sent')
    expect(warned('left to the stuck-input recovery')).toHaveLength(1)
    const afterSubmit = h.keys.slice(h.keys.findIndex((k) => k[k.length - 1] === 'Enter') + 1)
    expect(afterSubmit).toEqual([])
  })
})

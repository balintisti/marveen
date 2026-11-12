import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unlockInputState, reloadPluginsAfterAbsent } from '../web/channel-plugin-unlock.js'
import { mainInputBoxProvenEmpty, sendGaveUpReloadIfIdle } from '../web/channel-monitor.js'
import { logger } from '../logger.js'

// Ported from upstream 058ad0901e (#2501), card 09861207. Both /reload-plugins
// senders may only type into a pane PROVEN back at an empty idle prompt: typed into
// a parked draft the command is appended to it and Enter submits both; typed into a
// still-open /mcp menu level it lands in the menu. Upstream proves it with
// unlockPaneInputIdle; this tree already proves the end of every unlock round with
// unlockInputState / finishUnlockRound (MCPDUP806), so the absent-branch reload is
// gated on that measured end state instead.

const SEP = '─'.repeat(80)
const FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`
const pane = (input: string) => ['', SEP, input, SEP, FOOTER].join('\n')
const MENU = ['Manage MCP servers', '❯ plugin:google-workspace', '  Esc to go back'].join('\n')

const WEB = join(__dirname, '..', 'web')
const src = (f: string) => readFileSync(join(WEB, f), 'utf-8')

afterEach(() => { vi.restoreAllMocks() })

describe('the unlock round end state the absent-branch reload is gated on', () => {
  it('an empty idle prompt is idle', () => {
    expect(unlockInputState(pane('❯ '))).toBe('idle')
  })

  it('a DIM placeholder in an empty box is still idle', () => {
    expect(unlockInputState(pane(`❯ ${DIM('Try refactor src/utils.ts to use the new API')}`))).toBe('idle')
  })

  it('NEGATIVE CONTROL: real parked text is NOT idle', () => {
    expect(unlockInputState(pane('❯ half-written draft for the owner'))).not.toBe('idle')
  })

  it('a pane without the idle prompt (eg a menu still open) is NOT idle', () => {
    expect(unlockInputState(MENU)).not.toBe('idle')
  })
})

describe('reloadPluginsAfterAbsent (RELOADPLUGINSABSENT1032)', () => {
  it('a proven-empty line: /reload-plugins is typed once', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const send = vi.fn()
    expect(reloadPluginsAfterAbsent('s', 'telegram', 'idle', send)).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('s')
  })

  it.each(['parked:half-written draft', 'busy', 'unverifiable', 'typing'])('end state %s: nothing is typed', (endState) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const send = vi.fn()
    expect(reloadPluginsAfterAbsent('s', 'telegram', endState, send)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(warn.mock.calls.map((c) => c[1])).toEqual([expect.stringContaining('skipping /reload-plugins')])
  })

  it('a failed send is logged with its site and the tmux stderr, never the error object', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
    const send = vi.fn(() => { throw Object.assign(new Error('tmux gone'), { stderr: 'no server running', stdout: 'SECRET=1' }) })
    expect(reloadPluginsAfterAbsent('s', 'telegram', 'idle', send)).toBe(false)
    const fields = error.mock.calls[0]![0] as Record<string, unknown>
    expect(fields.site).toBe('channel-plugin-unlock.reloadAfterAbsent')
    expect(fields).not.toHaveProperty('err')
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET=1')
  })

  it('wiring: only an absent row reloads, after finishUnlockRound measured the end state, inside the lane', () => {
    const s = src('channel-plugin-unlock.ts')
    const round = s.slice(s.indexOf('const rowState = sendUnlockKeystrokes('), s.indexOf('releaseLane()'))
    const end = round.indexOf('const endState = finishUnlockRound(state.session)')
    const reload = round.indexOf("if (rowState === 'absent') reloadPluginsAfterAbsent(state.session, state.provider, endState)")
    expect(end).toBeGreaterThan(0)
    expect(reload).toBeGreaterThan(end)
    // The only reload in the round: none may be typed before the end state is proven.
    expect(round.split('reloadPluginsAfterAbsent(').length - 1).toBe(1)
  })
})

describe('the give-up stage reload (GAVEUPRELOAD1033)', () => {
  it('mainInputBoxProvenEmpty: an idle box yes; parked text, a menu or an unreadable pane no', () => {
    expect(mainInputBoxProvenEmpty(pane('❯ '), null)).toBe(true)
    expect(mainInputBoxProvenEmpty(pane('❯ half-written draft'), pane('❯ half-written draft'))).toBe(false)
    expect(mainInputBoxProvenEmpty(MENU, null)).toBe(false)
    expect(mainInputBoxProvenEmpty(null, null)).toBe(false)
  })

  it('sends only into a box proven empty', () => {
    const send = vi.fn()
    expect(sendGaveUpReloadIfIdle({ plain: () => pane('❯ '), parked: () => null }, send)).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('an empty box with a dim placeholder: the plain capture reads as typing, the dim-stripped view proves it empty', () => {
    const send = vi.fn()
    const parked = vi.fn(() => pane('❯ '))
    const plain = pane('❯ Try refactor src/utils.ts to use the new API')
    expect(sendGaveUpReloadIfIdle({ plain: () => plain, parked }, send)).toBe('sent')
    expect(parked).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['parked text', pane('❯ half-written draft'), pane('❯ half-written draft')],
    ['a menu', MENU, null],
    ['an unreadable pane', null, null],
  ])('%s: not idle, nothing typed', (_label, plain, parked) => {
    const send = vi.fn()
    expect(sendGaveUpReloadIfIdle({ plain: () => plain, parked: () => parked }, send)).toBe('not-idle')
    expect(send).not.toHaveBeenCalled()
  })

  it('wiring: the give-up stage runs it inside the send lane', () => {
    expect(src('channel-monitor.ts')).toContain("withSessionSendLock(MAIN_CHANNELS_SESSION, null, 'recover', async () => sendGaveUpReloadIfIdle())")
  })
})

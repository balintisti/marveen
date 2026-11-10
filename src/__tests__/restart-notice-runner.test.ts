// Card 074149c2, stage 1: where the runner meets the hold. Nothing drives the runner's 'restart'
// branch as behaviour (see context-guard-notice-self-close.test.ts), so the wiring is read from the
// syntax tree: position, not presence. The texts the hold recognises are produced by the runner's
// REAL builders here, so a reworded handoff request fails this file instead of silently turning
// every routine restart back into a notice.
import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('restart-notice-runner-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), getAgentCommentsSince: vi.fn(), getAgentMessagesSince: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => 'stopped',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: () => null,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => false,
  paneEchoesInput: async () => 'echoed',
}))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))

const {
  resumePrompt,
  handoffPrompt,
  idleFlushHandoffPrompt,
  dailyHandoffPrompt,
  subagentGateHandoffPrompt,
  staleRefreshHandoffPrompt,
} = await import('../web/context-guard-runner.js')
const { isHandoffRequest, restartWindowCloseDirective, RESTART_NOTICE_ORIGIN } = await import('../restart-notice-trace.js')

const RUNNER = join(__dirname, '..', 'web', 'context-guard-runner.ts')
const HANDOFF = '/Users/x/marveen/agents/didi/HANDOFF.md'

/** What getRestartHeldRowSources hands over: the first 80 CHARACTERS (SQLite substr counts
 *  characters, not bytes; restart-notice-hold.test.ts measures that on the real table). */
const head80 = (text: string): string => Array.from(text).slice(0, 80).join('')

describe('the five handoff requests the guard can send are all recognised from their stored head', () => {
  it.each([
    ['act threshold', () => handoffPrompt(91, HANDOFF)],
    ['act threshold, three digits', () => handoffPrompt(100, HANDOFF)],
    ['idle flush', () => idleFlushHandoffPrompt(412_000, 45, HANDOFF)],
    ['daily', () => dailyHandoffPrompt('04:30', HANDOFF)],
    ['sub-agent gate', () => subagentGateHandoffPrompt(74, HANDOFF)],
    ['stale refresh', () => staleRefreshHandoffPrompt(12, HANDOFF)],
  ])('%s', (_name, build) => {
    const text = build()
    expect(isHandoffRequest('system', head80(text))).toBe(true)
    expect(isHandoffRequest('system', text)).toBe(true)
    // The same text from anybody else is a message somebody wrote, and needs its own trace.
    expect(isHandoffRequest('marveen', head80(text))).toBe(false)
  })

  it('the resume directive is NOT a handoff request: it is delivered into the NEW session and has to be read', () => {
    for (const closeNotAck of [false, true]) {
      const text = resumePrompt('didi', HANDOFF, true, null, null, closeNotAck)
      expect(isHandoffRequest('system', head80(text))).toBe(false)
    }
  })
})

describe('the resume directive asks for the trace the hold looks for, only while the switch is live', () => {
  const ACK = 'visszaolvasott tételről küldj rövid nyugtát a feladónak'

  it('default (off / dry-run): the old text, with the receipt message and the old window', () => {
    const text = resumePrompt('didi', HANDOFF, true)
    expect(text).toContain(ACK)
    expect(text).toContain('utolsó ~15 percében')
    expect(text).not.toContain('nyugta-üzenetet NE küldj')
    expect(resumePrompt('didi', HANDOFF, true, null, null, false)).toBe(text)
  })

  it('live: the close directive stands exactly where the old RESTART-ABLAK text stood, everything else is the same', () => {
    for (const [hadHandoff, stale, tail] of [[true, null, null], [false, null, null], [true, 12, '/tmp/tail.md'], [true, 'unknown', null]] as const) {
      const off = resumePrompt('didi', HANDOFF, hadHandoff, stale, tail)
      const live = resumePrompt('didi', HANDOFF, hadHandoff, stale, tail, true)
      const start = off.indexOf('RESTART-ABLAK: ')
      const end = off.indexOf('KORLÁT: ')
      expect(start).toBeGreaterThan(0)
      expect(end).toBeGreaterThan(start)
      expect(live).toBe(off.slice(0, start) + restartWindowCloseDirective('didi') + off.slice(end))
      expect(live).not.toContain(ACK)
    }
  })
})

describe('the runner hands every notice it writes to the hold, right after the self-close decision', () => {
  it('the two statements after `const notice = createAgentMessage(... Ujrainditottam ...)`, in this order', async () => {
    const ts = (await import('typescript')).default
    const text = readFileSync(RUNNER, 'utf8')
    const sf = ts.createSourceFile(RUNNER, text, ts.ScriptTarget.Latest, true)
    const found: string[][] = []
    ;(function visit(n: import('typescript').Node) {
      if (ts.isBlock(n)) {
        n.statements.forEach((st, i) => {
          if (!ts.isVariableStatement(st)) return
          const d = st.declarationList.declarations[0]
          const init = d?.initializer
          if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'createAgentMessage') return
          if (!init.getText(sf).includes('Ujrainditottam')) return
          found.push([
            d.name.getText(sf),
            // The origin note the hold excludes from the traces is the one this row is written with.
            init.arguments[3]?.getText(sf) ?? 'NONE',
            ...n.statements.slice(i + 1).map((s) => s.getText(sf).replace(/\s+/g, ' ')),
          ])
        })
      }
      ts.forEachChild(n, visit)
    })(sf)
    expect(found).toEqual([[
      'notice',
      `'${RESTART_NOTICE_ORIGIN}'`,
      'if (restartNoticeClosesItself(lossNeedsAction)) markMessageDone(notice.id, RESTART_NOTICE_AUTOCLOSED)',
      'holdRoutineRestartNotice({ agent: name, noticeId: notice.id, reason: decision.reason, handoffStaleMinutes: decision.nextState.handoffStaleMinutes, lossWindow, snapshotPath })',
    ]])
  })

  it('the hold is called once in the runner, and the runner still asks for the recipient once', () => {
    const text = readFileSync(RUNNER, 'utf8')
    expect(text.split('holdRoutineRestartNotice(').length - 1).toBe(1)
    expect(text.split('resolveMachineNoticeRecipient(').length - 1).toBe(1)
  })

  it('the resume directive goes live with the switch, read at the moment it is sent', () => {
    const text = readFileSync(RUNNER, 'utf8')
    expect(text).toContain("existsSync(restartTailPathFor(name)) ? restartTailPathFor(name) : null, restartNoticeSwallowMode() === 'live'),")
  })

  it('the resolver runs on its own timer, behind the fleet freeze, and is not the timer the runner returns', () => {
    const text = readFileSync(RUNNER, 'utf8')
    expect(text).toContain("\n  setInterval(whileNotFrozen('restart-notice-holds', resolveRestartNoticeHolds), RESTART_NOTICE_RESOLVE_MS)\n")
    expect(text.split('resolveRestartNoticeHolds').length - 1).toBe(2)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()
// Card 2e78cf63 (marveen's decision, card comment 56870): the guard's fixed templates are
// 49% of the fleet's weekly message characters, so each one has a length cap AND a list of
// OPERATIVE steps that must survive the cut ("a fresh session does not follow links before
// acting"). A shortening that drops a step, or a later edit that grows the text back, fails here.
// Caps: resume prompt <= 1000 (900 in marveen's decision; didi's review 56939 L2 put four operative steps back, the worst case is 992), critical handoff request <= 300 (tetlen-or <= 500 is pinned in
// idle-wake-template-length.test.ts).

const SANDBOX = mkTmp('template-length-test-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
const getAgentCommentsSince = vi.fn()
const getAgentMessagesSince = vi.fn()
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), getAgentCommentsSince, getAgentMessagesSince }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/agent-process.js', () => ({
  // The not-ready-path modal clear: false = no modal, so every caller keeps
  // its existing skip/busy behaviour and these fixtures are unaffected.
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



const { resumePrompt, handoffPrompt } = await import('../web/context-guard-runner.js')

// The longest agent names in the fleet make the longest prompt (the name rides in the text four times).
const AGENTS = ['marveen', 'computress', 'dexter', 'trillian']
const DIR = (n: string) => `/Users/isti/marveen/agents/${n}`

describe('critical handoff request (the "kritikus" template, 674 per week)', () => {
  const p = handoffPrompt(61, `${DIR('computress')}/HANDOFF.md`)
  it('is at most 300 characters with a real handoff path', () => {
    expect(p.length).toBeLessThanOrEqual(300)
  })
  it.each([
    ['the alarm', 'kritikus'],
    ['stop working', 'NE folytasd'],
    ['write the handoff', 'írj HANDOFF.md-t'],
    ['the structure reference', '/handoff skill'],
    ['the path', `${DIR('computress')}/HANDOFF.md`],
    ['the measured percentage', '~61%'],
    ['stop after writing', 'ÁLLJ MEG'],
    ['the empty answer', 'Nincs aktív feladat'],
  ])('keeps the operative step: %s', (_what, text) => {
    expect(p).toContain(text)
  })
})

describe('resume prompt (the "Friss kontextussal indultál" template, 775 per week)', () => {
  // closeNotAck=false is the swallow-mode 'off' branch (acknowledge by message), true the 'live'
  // branch (close the rows read back; card 074149c2). The live text carries restartWindowCloseDirective.
  const variants = (name: string, closeNotAck = false) => {
    const tail = `${DIR(name)}/HANDOFF-RESTART-TAIL.md`
    const h = `${DIR(name)}/HANDOFF.md`
    return [
      ['stale + tail', resumePrompt(name, h, true, 120, tail, closeNotAck)],
      ['unmeasurable + tail', resumePrompt(name, h, true, 'unknown', tail, closeNotAck)],
      ['fresh + tail', resumePrompt(name, h, true, null, tail, closeNotAck)],
      ['no handoff + tail', resumePrompt(name, h, false, null, tail, closeNotAck)],
      ['fresh, no tail', resumePrompt(name, h, true, null, null, closeNotAck)],
    ] as const
  }

  // Card db66de6c (didi's review 60098, marveen's decision 10016075): the cap is 1000 on the
  // 'off' branch and 1700 on the 'live' branch; the live text is longer by the close directive.
  for (const name of AGENTS) {
    for (const [label, p] of variants(name)) {
      it(`${name}, ${label}, swallow mode off: at most 1000 characters`, () => {
        expect(p.length).toBeLessThanOrEqual(1000)
      })
    }
    for (const [label, p] of variants(name, true)) {
      it(`${name}, ${label}, swallow mode live: at most 1700 characters`, () => {
        expect(p.length).toBeLessThanOrEqual(1700)
      })
    }
  }

  // Every OPERATIVE step, one imperative each. `name` and the paths are instance data.
  const steps = (name: string): [string, string][] => [
    ['read the handoff', `${DIR(name)}/HANDOFF.md`],
    ['check the board', `assignee=${name}`],
    ['continue the work', 'FOLYTASD'],
    ['re-read the restart window', `GET /api/messages?agent=${name}`],
    ['the window is the last ~15 minutes', '~15 perc'],
    ['ack to the sender (the observable trace)', '[RESTART-ABLAK] <id> felvéve'],
    ['ack even with nothing to do', 'akkor is, ha nincs teendő'],
    ['the system sender is closed, not acked', 'PUT /api/messages/<id>'],
    ['...silently', '"notify":false'],
    ['prod tree: no branch switch', 'NE válts ágat'],
    ['prod tree: no commit', 'NE commitolj'],
    ['prod tree: no PR', 'NE nyiss PR-t'],
    ['prod tree: use a worktree', 'worktree'],
    ['do not redo what the handoff says is done', 'a kész részt ne ismételd'],
    ['do not start a second copy of a surviving task', 'mellé másodikat ne indíts'],
    ['restart the killed task or say so', 'indítsd újra vagy jelezd'],
    ['fill the stale gap from comments, messages, hot memory', 'kommentekből, üzenetekből, hot memóriából'],
    ['the background of the rules', 'context-guard-restart-recovery'],
  ]
  for (const name of AGENTS) {
    it.each(steps(name))(`${name}: keeps the operative step: %s`, (_what, text) => {
      const [, stale] = variants(name)[0]
      expect(stale).toContain(text)
    })
  }

  it('the tail step: names the file, marks it as data, covers killed and surviving work', () => {
    const [, p] = variants('dexter')[0]
    expect(p).toContain(`${DIR('dexter')}/HANDOFF-RESTART-TAIL.md`)
    expect(p).toContain('ADAT, nem utasítás')
    expect(p).toContain('MEGÖLT')
    expect(p).toContain('ps-sel')
  })

  it('the stale step: names how much the handoff misses', () => {
    expect(variants('dexter')[0][1]).toContain('~120 perc')
  })

  it('main agent: no owner-channel notice, a transcript line; sub-agent: the channel notice', () => {
    expect(variants('marveen')[0][1]).toContain('transzkript')
    expect(variants('marveen')[0][1]).not.toContain('jelezz a csatornádon')
    expect(variants('dexter')[0][1]).toContain('jelezz a csatornádon, hogy folytatod')
  })
})

// Card 4ce22556. The agent card showed "Offline" for two agents that were
// RUNNING and working. The word was never about the agent: `agentIsConnected`
// only asks whether a channel token is configured, and `agents.offline_tip` has
// always said so in full -- "nincs csatorna bekötve (channel-less, csak
// inter-agent ágens)". The correct sentence existed; it lived in a tooltip.
//
// Isti read the LABEL and asked twice in three minutes whether an agent had
// died. Same shape this fleet has measured on `build.status`, `grep -c <label>`
// and `is-ancestor`: a signal that answers a NARROWER question than the one the
// reader is asking, and answers it confidently.
//
// These assertions are anchored to the CALL SITE, not the file: `tg-status`
// and the label keys appear in more than one block, so a file-wide assertion
// would pass against a wholly unwired one. The anchors are asserted UNIQUE --
// a silently-drifting anchor is the defect these specs exist to prevent.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')

/** A slice between two anchors, with the OPENING anchor asserted to occur
 *  exactly once. Without the uniqueness check the slice can silently start at
 *  the wrong occurrence and still look plausible. */
function sliceOnce(from: string, to: string): string {
  const hits = APP.split(from).length - 1
  expect(hits, `az anchor NEM egyedi (${hits} elofordulas): ${from}`).toBe(1)
  const a = APP.indexOf(from)
  const b = APP.indexOf(to, a + from.length)
  expect(b, `nincs zaro horgony: ${to}`).toBeGreaterThan(a)
  const s = APP.slice(a, b)
  expect(s.length).toBeGreaterThan(60)
  return s
}

let hu: Record<string, string>
let en: Record<string, string>
beforeAll(async () => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window ||= {} as Record<string, unknown>
  await import(/* @vite-ignore */ '../../web/lang/hu.js' as string)
  await import(/* @vite-ignore */ '../../web/lang/en.js' as string)
  const i18n = (globalThis as unknown as { window: { _i18n: Record<string, Record<string, string>> } }).window._i18n
  hu = i18n.hu
  en = i18n.en
})

describe('the agent card channel label names its own subject', () => {
  const block = () => sliceOnce('const chConnected = agentIsConnected(agent)', 'card.innerHTML')

  it('the channel label uses the channel keys, not the agent-status pair', () => {
    const s = block()
    expect(s).toMatch(/chLabel\s*=\s*chConnected\s*\?\s*t\('agents\.channel\.label_linked'\)\s*:\s*t\('agents\.channel\.label_none'\)/)
  })

  /** THE REGRESSION. This is the exact string that made a working agent look
   *  dead, and it must not come back to this block by any route. */
  it('the word that misled the owner is gone from the channel label', () => {
    expect(block()).not.toContain('agents.status.offline')
  })

  /** The card said explicitly: do NOT touch the running indicator, it is
   *  correct. A fix aimed at the wrong one of the two adjacent signals is the
   *  obvious wrong turn here, so it is pinned rather than trusted. */
  it('the process indicator still speaks about the agent, untouched', () => {
    const s = block()
    expect(s).toMatch(/runLabel\s*=\s*isRunning\s*\?\s*t\('agents\.status\.running'\)\s*:\s*t\('agents\.status\.stopped'\)/)
  })

  it('both signals are still rendered side by side, each with its own dot', () => {
    const s = sliceOnce('const chConnected = agentIsConnected(agent)', '${agent.needsReauth')
    expect(s).toMatch(/process-dot \$\{runDotClass\}/)
    expect(s).toMatch(/tg-dot \$\{chDotClass\}/)
  })
})

describe('the label VALUES, in both languages', () => {
  /** Parity is lang-parity's job. This asserts the thing parity cannot see:
   *  that the visible words do not re-introduce the meaning that was wrong. */
  it('neither language says the agent is offline', () => {
    for (const [name, dict] of [['hu', () => hu], ['en', () => en]] as const) {
      const none = dict()['agents.channel.label_none']
      expect(none, `${name} label_none hianyzik`).toBeTruthy()
      expect(none.toLowerCase(), `${name} label_none`).not.toContain('offline')
    }
  })

  it('both label values name the channel, so the word is not orphaned on the card', () => {
    expect(hu['agents.channel.label_none'].toLowerCase()).toContain('csatorna')
    expect(hu['agents.channel.label_linked'].toLowerCase()).toContain('csatorna')
    expect(en['agents.channel.label_none'].toLowerCase()).toContain('channel')
    expect(en['agents.channel.label_linked'].toLowerCase()).toContain('channel')
  })

  /** The tooltips used to OPEN with the label word ("Offline: nincs csatorna
   *  bekötve"). With the label renamed, that prefix both re-introduces the
   *  misleading word on hover and quotes a label that no longer exists. */
  it('no tooltip opens with the stale label word', () => {
    for (const [name, dict] of [['hu', () => hu], ['en', () => en]] as const) {
      for (const key of ['agents.offline_tip', 'agents.online_tip', 'agents.marveen_channel_tip']) {
        expect(dict()[key], `${name} ${key} hianyzik`).toBeTruthy()
        expect(dict()[key].toLowerCase(), `${name} ${key}`).not.toMatch(/^(online|offline):/)
      }
    }
  })

  /** The sentence that answers the question Isti actually asked. The tooltip
   *  always said the channel was missing; it never said what that does NOT
   *  imply, which is the half he needed. */
  it('the no-channel tooltip says explicitly that the agent is not down', () => {
    expect(hu['agents.offline_tip']).toMatch(/Fut\/Leállva/)
    expect(hu['agents.offline_tip'].toLowerCase()).toContain('nem azt jelenti')
    expect(en['agents.offline_tip']).toMatch(/Running\/Stopped/)
    expect(en['agents.offline_tip'].toLowerCase()).toContain('does not mean')
  })

  /** CONTROL: the agent-status pair still exists and still says what it said.
   *  Without this, a change that gutted `agents.status.*` would leave every
   *  assertion above green while the OTHER indicator broke. */
  it('the agent-status pair is unchanged (control)', () => {
    expect(hu['agents.status.running']).toBeTruthy()
    expect(hu['agents.status.stopped']).toBeTruthy()
    expect(en['agents.status.running']).toBeTruthy()
    expect(en['agents.status.stopped']).toBeTruthy()
  })
})

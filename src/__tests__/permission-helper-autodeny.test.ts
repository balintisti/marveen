import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearPermissionPromptAlert,
  decideHelperAutoDeny,
  parseHelperAutoDenyMin,
  permissionPromptHelper,
  permissionPromptIdentity,
  resetPermissionPromptAlerts,
  runPermissionPromptPass,
  DEFAULT_PERMISSION_HELPER_AUTODENY_MIN,
} from '../web/permission-prompt-alert.js'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'pane', name), 'utf-8')

const MIN = 60 * 1000
const AFTER = 30 * MIN

// A helper's card: "Bash command · from the general-purpose agent" (live capture).
const HELPER_PANE = fixture('permission-prompt-bash-grep.txt')
// The main agent's own Bash card (CLI 2.1.303): header "Bash command", no suffix.
const MAIN_PANE = fixture('permission-prompt-bash-main-2.1.303.txt')

// The main card with a command that says "· from the general-purpose agent".
// Built from the fixture's own card line, so only the command text differs.
const MAIN_WITH_SUFFIX_IN_COMMAND = (() => {
  const lines = MAIN_PANE.split('\n')
  const idx = lines.findIndex((l) => l.startsWith(' │ printf'))
  if (idx < 0) throw new Error('fixture shape changed: no command line on the card')
  lines[idx] += ' · from the general-purpose agent'
  return lines.join('\n')
})()

// The helper's card with its header scrolled off the visible pane.
const HELPER_HEADER_SCROLLED = HELPER_PANE.split('\n').filter((l) => !l.includes('· from the general-purpose agent')).join('\n')

// A different helper prompt: the same card, another command (a new question).
const HELPER_OTHER_COMMAND = HELPER_PANE.replace('firstSymbol', 'otherSymbol')

function harness(opts: {
  pane: string
  deep?: string | null
  recaptured?: string | null
  isMainAgent?: boolean
  afterMs?: number
  /** The first N sendEscape calls throw (a tmux error); later calls succeed. */
  escapeFails?: number
}) {
  const escapes: string[] = []
  const sent: string[] = []
  let current: string | null = opts.deep === undefined ? opts.pane : opts.deep
  let failsLeft = opts.escapeFails ?? 0
  const deps = {
    captureWithHistory: () => current,
    send: (text: string) => { sent.push(text) },
    isMainAgent: opts.isMainAgent ?? true,
    helperAutoDenyAfterMs: opts.afterMs ?? AFTER,
    recapture: () => (opts.recaptured === undefined ? current : opts.recaptured),
    sendEscape: (session: string) => {
      if (failsLeft > 0) { failsLeft--; throw new Error('tmux: no server running') }
      escapes.push(session)
    },
  }
  // pass(minute, pane): the visible pane and its scrollback for this tick. A
  // different pane (a new question) brings its own scrollback.
  const pass = (minute: number, pane: string = opts.pane) => {
    current = pane === opts.pane ? (opts.deep === undefined ? opts.pane : opts.deep) : pane
    return runPermissionPromptPass('Dexter', 'main-channels', pane, deps, minute * MIN)
  }
  return { escapes, sent, pass }
}

describe('permissionPromptHelper: whose card is on the pane', () => {
  beforeEach(() => resetPermissionPromptAlerts())

  it('a sub-agent card names its agent type', () => {
    expect(permissionPromptHelper(HELPER_PANE)).toBe('general-purpose')
  })

  it('the main agent own card has no suffix, so no helper', () => {
    expect(permissionPromptHelper(MAIN_PANE)).toBeNull()
  })

  it('a main card whose COMMAND says "· from the x agent" is not a helper (the header decides)', () => {
    expect(MAIN_WITH_SUFFIX_IN_COMMAND).toContain('· from the general-purpose agent')
    expect(permissionPromptHelper(MAIN_WITH_SUFFIX_IN_COMMAND)).toBeNull()
  })

  it('a helper header scrolled off the visible pane, with no scrollback: null (no key)', () => {
    expect(permissionPromptHelper(HELPER_HEADER_SCROLLED)).toBeNull()
  })

  it('the same helper header found in the scrollback is a helper', () => {
    expect(permissionPromptHelper(HELPER_HEADER_SCROLLED, HELPER_PANE)).toBe('general-purpose')
  })

  it('a pane with no permission card: null', () => {
    expect(permissionPromptHelper('❯ \n')).toBeNull()
    expect(permissionPromptHelper(null)).toBeNull()
  })
})

describe('parseHelperAutoDenyMin: PERMISSION_HELPER_AUTODENY_MIN', () => {
  it('the default is 30 minutes, empty means the default, and it is not an error', () => {
    expect(DEFAULT_PERMISSION_HELPER_AUTODENY_MIN).toBe(30)
    expect(parseHelperAutoDenyMin('')).toEqual({ minutes: 30, valid: true })
    expect(parseHelperAutoDenyMin(undefined)).toEqual({ minutes: 30, valid: true })
  })

  it('0 is off and is valid', () => {
    expect(parseHelperAutoDenyMin('0')).toEqual({ minutes: 0, valid: true })
  })

  it('whole minutes are read as given', () => {
    expect(parseHelperAutoDenyMin(' 45 ')).toEqual({ minutes: 45, valid: true })
  })

  it('anything else falls back to the default and is flagged, never read as a huge or negative delay', () => {
    for (const bad of ['abc', '-5', '1.5', '30m', '99999', '10081']) {
      expect(parseHelperAutoDenyMin(bad)).toEqual({ minutes: 30, valid: false })
    }
  })
})

describe('decideHelperAutoDeny: the pure decision', () => {
  const base = { isMainAgent: true, helper: 'general-purpose', firstSeenAt: 0, now: AFTER, afterMs: AFTER, alreadyDeniedId: null, id: 'q1' }

  it('a helper prompt at the mark: deny', () => {
    expect(decideHelperAutoDeny(base)).toBe('deny')
  })

  it('a second before the mark: wait', () => {
    expect(decideHelperAutoDeny({ ...base, now: AFTER - 1000 })).toBe('wait')
  })

  it('off (0): none, whatever the age', () => {
    expect(decideHelperAutoDeny({ ...base, afterMs: 0, now: 10 * AFTER })).toBe('none')
  })

  it('another agent pane: none', () => {
    expect(decideHelperAutoDeny({ ...base, isMainAgent: false })).toBe('none')
  })

  it('no helper (main card, or unreadable header): none', () => {
    expect(decideHelperAutoDeny({ ...base, helper: null })).toBe('none')
  })

  it('an identity already denied: none (one Escape per identity)', () => {
    expect(decideHelperAutoDeny({ ...base, alreadyDeniedId: 'q1' })).toBe('none')
  })

  it('an empty identity (nothing readable): none', () => {
    expect(decideHelperAutoDeny({ ...base, id: '' })).toBe('none')
  })
})

describe('runPermissionPromptPass: the helper auto-deny, end to end through the pass', () => {
  beforeEach(() => resetPermissionPromptAlerts())

  it('(a) a helper prompt past 30 min gets exactly ONE Escape, though the pass runs on again after the mark', () => {
    const h = harness({ pane: HELPER_PANE })
    const actions: string[] = []
    for (let m = 0; m <= 60; m += 5) actions.push(h.pass(m))
    expect(h.escapes).toEqual(['main-channels'])
    expect(actions.filter((a) => a === 'auto-deny')).toHaveLength(1)
    // passes at minutes 0, 5, ..., 30: the 7th one (index 6) is the mark
    expect(actions.indexOf('auto-deny')).toBe(6)
  })

  it('(a) running the pass twice past the mark still sends one Escape and one owner line', () => {
    const h = harness({ pane: HELPER_PANE })
    // The monitor's alert ticks: the 15 min owner mark is one of them.
    h.pass(0)
    h.pass(15)
    h.pass(30)
    h.pass(35)
    h.pass(40)
    expect(h.escapes).toHaveLength(1)
    // The owner hears the existing 15 min mark, then the one denial line.
    expect(h.sent).toHaveLength(2)
    expect(h.sent.filter((t) => t.includes('NEM-et nyomtam (Escape)'))).toHaveLength(1)
  })

  it('(b) a helper prompt at 29 min: nothing sent, nothing pressed', () => {
    const h = harness({ pane: HELPER_PANE })
    expect(h.pass(0)).not.toBe('auto-deny')
    expect(h.pass(25)).not.toBe('auto-deny')
    expect(h.pass(29)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(c) the main agent own prompt: nothing, however long it stands', () => {
    const h = harness({ pane: MAIN_PANE })
    for (let m = 0; m <= 90; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(c) a main card whose command quotes "· from the x agent": nothing', () => {
    const h = harness({ pane: MAIN_WITH_SUFFIX_IN_COMMAND })
    for (let m = 0; m <= 60; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(c) a helper header scrolled out of the capture and not in the scrollback: nothing', () => {
    const h = harness({ pane: HELPER_HEADER_SCROLLED, deep: HELPER_HEADER_SCROLLED })
    for (let m = 0; m <= 60; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('a helper header that is only in the scrollback still counts: Escape at 30 min', () => {
    const h = harness({ pane: HELPER_HEADER_SCROLLED, deep: HELPER_PANE })
    for (let m = 0; m <= 35; m += 5) h.pass(m)
    expect(h.escapes).toHaveLength(1)
  })

  it('(d) the prompt is gone at the re-capture: nothing pressed, the alert path continues', () => {
    const h = harness({ pane: HELPER_PANE, recaptured: null })
    for (let m = 0; m <= 35; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(d) a DIFFERENT prompt at the re-capture: nothing pressed', () => {
    const h = harness({ pane: HELPER_PANE, recaptured: HELPER_OTHER_COMMAND })
    for (let m = 0; m <= 35; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(d) the re-capture is the main agent own prompt now: nothing pressed', () => {
    const h = harness({ pane: HELPER_PANE, recaptured: MAIN_PANE })
    for (let m = 0; m <= 35; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(e) another agent pane: nothing pressed, and its owner alerts are exactly those without the feature', () => {
    // Two runs on the same session key share the module's alert state, so the
    // second run starts from a clean slate (a reset between them).
    const withFeature = harness({ pane: HELPER_PANE, isMainAgent: false })
    for (let m = 0; m <= 60; m += 5) withFeature.pass(m)
    resetPermissionPromptAlerts()
    const withoutFeature = harness({ pane: HELPER_PANE, isMainAgent: false, afterMs: 0 })
    for (let m = 0; m <= 60; m += 5) withoutFeature.pass(m)
    expect(withFeature.escapes).toHaveLength(0)
    expect(withFeature.sent.length).toBeGreaterThan(0)
    expect(withFeature.sent).toEqual(withoutFeature.sent)
  })

  it('(f) disabled (0): nothing pressed on a helper prompt at any age', () => {
    const h = harness({ pane: HELPER_PANE, afterMs: 0 })
    for (let m = 0; m <= 180; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('the owner line says which helper, what was asked, that NO was pressed, and never quotes the command', () => {
    const h = harness({ pane: HELPER_PANE })
    for (let m = 0; m <= 35; m += 5) h.pass(m)
    const text = h.sent[h.sent.length - 1]
    expect(h.sent).toHaveLength(2)
    expect(text).toContain('general-purpose')
    expect(text).toContain('Bash command')
    expect(text).toContain('NEM-et nyomtam (Escape)')
    expect(text).toContain('30 perce')
    expect(text).not.toContain('grep')
    expect(text).not.toContain('firstSymbol')
    expect(text).not.toContain('ExampleController')
  })

  it('a different helper prompt after the denial starts its own clock: no second Escape before its own mark', () => {
    const h = harness({ pane: HELPER_PANE })
    for (let m = 0; m <= 30; m += 5) h.pass(m)
    expect(h.escapes).toHaveLength(1)
    // The question changes (a new command) at 31 min: a new identity, a new clock.
    h.pass(31, HELPER_OTHER_COMMAND)
    h.pass(35, HELPER_OTHER_COMMAND)
    h.pass(60, HELPER_OTHER_COMMAND)
    expect(h.escapes).toHaveLength(1)
    h.pass(61, HELPER_OTHER_COMMAND)
    expect(h.escapes).toHaveLength(2)
  })

  it('the identity of the denied prompt is the one the pass compared (sanity)', () => {
    expect(permissionPromptIdentity(HELPER_PANE)).not.toBe('')
  })
})

// FIX ROUND 1 (didi, card 2e0b6280 comment 67524): the four mutants that
// survived the first suite. Each case below is the one that kills one of them.
describe('fix round 1: the cases the first suite did not kill', () => {
  beforeEach(() => resetPermissionPromptAlerts())

  // D6: the same identity, but the re-capture is the MAIN card. The identity is
  // the LAST PERMISSION_IDENTITY_MAX letters and digits of the card body, so a
  // body longer than that drops the header (and its "from the ... agent" suffix)
  // out of the identity. Only the helper check stops the key here.
  const LONG_HELPER_PANE = (() => {
    const lines = HELPER_PANE.split('\n')
    const q = lines.findIndex((l) => /Do you want to proceed\?/.test(l))
    if (q < 0) throw new Error('fixture shape changed: no question line')
    const filler = Array.from({ length: 40 }, (_, i) => `   │ filler${i} ${'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2)}`)
    lines.splice(q, 0, ...filler)
    return lines.join('\n')
  })()
  const LONG_MAIN_PANE = LONG_HELPER_PANE.replace('· from the general-purpose agent', '')

  it('(d) same identity, the re-capture is the main agent own card (suffix only in a dropped header): no Escape', () => {
    // Preconditions: the identity really is the same, and the helper really differs.
    expect(permissionPromptIdentity(LONG_MAIN_PANE, LONG_MAIN_PANE)).toBe(permissionPromptIdentity(LONG_HELPER_PANE, LONG_HELPER_PANE))
    expect(permissionPromptHelper(LONG_HELPER_PANE)).toBe('general-purpose')
    expect(permissionPromptHelper(LONG_MAIN_PANE)).toBeNull()
    const h = harness({ pane: LONG_HELPER_PANE, recaptured: LONG_MAIN_PANE })
    for (let m = 0; m <= 35; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(d control) the same long helper card re-captured as itself still gets its one Escape at 30 min', () => {
    const h = harness({ pane: LONG_HELPER_PANE })
    for (let m = 0; m <= 30; m += 5) h.pass(m)
    expect(h.escapes).toHaveLength(1)
  })

  // D11: a helper is read from the header only. With no header in the capture,
  // a "from the ... agent" text in the pane (a command, or an older card) must
  // not make the card a helper's.
  it('(c) the suffix only in the COMMAND of a card whose header is not in the capture: no helper, no key', () => {
    const pane = MAIN_WITH_SUFFIX_IN_COMMAND.split('\n').filter((l) => l.trim() !== 'Bash command').join('\n')
    expect(pane).toContain('· from the general-purpose agent')
    expect(permissionPromptHelper(pane)).toBeNull()
    const h = harness({ pane })
    for (let m = 0; m <= 35; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  it('(c) an OLDER helper card above a header-less main card: the older suffix is not this card, no key', () => {
    const headerless = MAIN_PANE.split('\n').filter((l) => l.trim() !== 'Bash command').join('\n')
    const pane = `${HELPER_PANE}\n${headerless}`
    expect(pane).toContain('· from the general-purpose agent')
    expect(permissionPromptHelper(pane)).toBeNull()
    const h = harness({ pane })
    for (let m = 0; m <= 35; m += 5) expect(h.pass(m)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
  })

  // D3: the denied identity is forgotten when the menu episode ends, so the same
  // question in a NEW episode gets its own Escape at its own mark.
  it('a denied prompt whose episode ends and comes back as the SAME question gets its own Escape', () => {
    const h = harness({ pane: HELPER_PANE })
    for (let m = 0; m <= 30; m += 5) h.pass(m)
    expect(h.escapes).toHaveLength(1)
    clearPermissionPromptAlert('main-channels')
    for (let m = 100; m <= 130; m += 5) h.pass(m)
    expect(h.escapes).toHaveLength(2)
  })

  // D9: the identity is remembered only after a key really went out. A tmux
  // error at the mark is retried on the next alert tick, not swallowed.
  it('a sendEscape that throws at the mark is retried on the next tick, and the Escape then lands once', () => {
    const h = harness({ pane: HELPER_PANE, escapeFails: 1 })
    for (let m = 0; m <= 25; m += 5) h.pass(m)
    expect(h.pass(30)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(0)
    expect(h.pass(35)).toBe('auto-deny')
    expect(h.escapes).toHaveLength(1)
    expect(h.pass(40)).not.toBe('auto-deny')
    expect(h.escapes).toHaveLength(1)
  })
})

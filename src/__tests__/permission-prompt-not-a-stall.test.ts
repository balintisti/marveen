import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectsPermissionDialog, permissionPromptSummary } from '../pane-state.js'
import { formatStuckSessionAlert } from '../web/message-router.js'

// Real panes, captured while a general-purpose sub-agent's Bash call waited for
// consent (paths and symbol names anonymised, layout untouched). Two of them
// differ in the REASON wording, which is why nothing here keys on that wording;
// the third has the prompt in the UPPER half with a blank tail, the shape a
// fresh session shows when its first tool call needs consent.
const load = (n: string) => readFileSync(join(__dirname, `fixtures/pane/${n}.txt`), 'utf8')
const PANE_GREP = load('permission-prompt-bash-grep')
const PANE_CD = load('permission-prompt-compound-cd')
const PANE_UPPER = load('permission-prompt-upper-half')

describe('the fixtures are real permission prompts', () => {
  it('are all recognised by the shared detector', () => {
    // detectsPermissionDialog lands on develop (PR #1190). These fixtures are
    // kept because they come from live sessions and the summary below is
    // measured against them, not because the detector needs re-testing here.
    expect(detectsPermissionDialog(PANE_GREP)).toBe(true)
    expect(detectsPermissionDialog(PANE_CD)).toBe(true)
    expect(detectsPermissionDialog(PANE_UPPER)).toBe(true)
  })

  it('share no reason wording, so a wording-anchored reader would miss one', () => {
    expect(PANE_GREP).toContain('deny rule is configured')
    expect(PANE_CD).toContain('Compound command contains cd')
  })
})

describe('what the prompt is asking, so the alert needs no pane visit', () => {
  it('extracts the tool card title and the full reason from every live capture', () => {
    const a = permissionPromptSummary(PANE_GREP)!
    expect(a.title).toBe('Bash command · from the general-purpose agent')
    // The pane hard-wraps the reason; the first line alone would read just
    // "grep on", so the block has to be rejoined to be useful.
    expect(a.reason).toContain('a Read() deny rule is configured')
    expect(a.reason).not.toBe('grep on')

    const b = permissionPromptSummary(PANE_CD)!
    expect(b.reason).toBe('Compound command contains cd with a relative file read while a Read() deny rule exists')

    // The upper-half shape must work too: that is the case where the operator
    // is least likely to have the pane open already.
    const c = permissionPromptSummary(PANE_UPPER)!
    expect(c.title).toBe('Bash command · from the general-purpose agent')
    expect(c.reason).toContain('Compound command contains cd')
  })

  it('returns null rather than half a question', () => {
    expect(permissionPromptSummary('')).toBeNull()
    expect(permissionPromptSummary('Do you want to proceed?\n 1. Yes')).toBeNull()
  })

  it('caps a long reason instead of flooding the alert', () => {
    const long = PANE_GREP.replace('deny rule is configured', 'deny rule is configured ' + 'x'.repeat(400))
    const s = permissionPromptSummary(long)!
    expect(s.reason.length).toBeLessThanOrEqual(220)
    expect(s.reason.endsWith('…')).toBe(true)
  })
})

// ADAPTED IN THE 88c366f2 MERGE. Both sides built "a permission prompt is not a stall" into the
// stuck-session alert; OURS is kept (marveen's (B) decision 2026-09-03: its own [approval-needed]
// tag, pane-driven via paneRemedy/describePermissionPrompt, pinned by router-stuck-alert.test.ts).
// Upstream's formatter took (awaitingPermission, permissionAsk) and reported under [session-stuck];
// these cases keep upstream's INTENT -- answer, do not restart; quote the question; never alert the
// main agent about itself -- against our signature, on upstream's three LIVE captures. That makes
// this block a cross-check of OUR detector on panes it was never tuned on.
describe('stuck-session alert for a permission prompt (our [approval-needed] API)', () => {
  const alertFor = (pane: string | null) =>
    formatStuckSessionAlert('voicedev', 'jarvis', 'agent-voicedev', 11 * 60 * 1000, 1, 'unknown', pane)

  it.each([
    ['bash-grep', PANE_GREP],
    ['compound-cd', PANE_CD],
    ['upper-half', PANE_UPPER],
  ])('%s: tagged [approval-needed], tells the reader to answer and NOT to restart', (_n, pane) => {
    const alert = alertFor(pane)!
    expect(alert.startsWith('[approval-needed]')).toBe(true)
    expect(alert).toContain('TOOL-PERMISSION prompt')
    expect(alert).toMatch(/Do NOT restart/)
    expect(alert).not.toMatch(/restart the agent if it is wedged/)
  })

  it('quotes the question so the pane does not have to be opened', () => {
    const alert = alertFor(PANE_GREP)!
    expect(alert).toContain('It is asking:')
    expect(alert).toMatch(/Do you want to [^"]*\?/)
  })

  it('control: without a pane there is no approval verdict (the null path is allowed and pinned)', () => {
    expect(alertFor(null)!.startsWith('[approval-needed]')).toBe(false)
  })

  it('still never alerts the main agent about itself', () => {
    expect(formatStuckSessionAlert('jarvis', 'jarvis', 'x', 1, 1, 'unknown', PANE_GREP)).toBeNull()
  })
})

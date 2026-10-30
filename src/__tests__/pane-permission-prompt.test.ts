import { describe, it, expect } from 'vitest'
import {
  detectsPermissionPrompt, detectsBlockingMenu, detectPaneState,
  detectsModelConsentDialog, detectsFirstRunGate,
} from '../pane-state.js'
import { formatStuckSessionAlert } from '../web/message-router.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Card b5a9f60a / 296277e8.
// Every pane below except the two clearly-marked CONSTRUCTED ones is a VERBATIM
// `tmux capture-pane -p` taken from a live fleet session on 2026-09-03. The
// permission prompt is the one that was cancelled out from under agent-dexter
// by the menu-recovery Escape at 07:26:45 while nobody answered it.

// LIVE: agent-dexter, 2026-09-03 07:24. A configured deny rule + an
// unresolvable cwd after a `cd`, so the CLI asked for a decision.
const PERMISSION_PROMPT_PANE = [
  "   │ open(p,'w',encoding='utf-8').write(s)",
  "   │ print(\"automations: 2 subjects + 2 bodies patched;",
  "   │ checklist/notification sites deliberately untouched\")",
  "   │ PY",
  "   │ cd \"$API\" && npx tsc -b 2>&1 | tail -3; echo \"tsc rc=$?\"",
  "   │ echo \"=== the six sites, verified ===\"",
  "   │ grep -c 'escapeHtml: true' src/forms/submission.service.ts",
  "   │ src/email-sequences/email-sequence-executor.service.ts",
  "   │ src/automations/automation-executor.service.ts",
  "   │ echo \"=== textBody must remain UNescaped ===\"",
  "   │ grep -n -A2 'template.textBody' src/forms/submission.service.ts | head",
  "   │ -4",
  "   │ Patch only the two automation email subjects and bodies, verify textBody",
  "   │ untouched",
  "",
  " │ grep on 'src/forms/submission.service.ts' after a cd would search a",
  " │ directory that cannot be determined here, and a Read() deny rule is",
  " │ configured; only you can approve running it anyway.",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. No",
  "",
  " Esc to cancel · Tab to amend",
].join('\n')

// LIVE: agent-jarvis, same minute -- healthy, at the prompt.
const IDLE_PANE = [
  "  felismerhetőség elvesztése nélkül, azt jelezni kell, nem csonkítani. Előbb",
  "  száraz futás.",
  "",
  "  Ran 1 shell command",
  "",
  "⏺ A száraz futás megdönti a mechanikus vágást: kilencből ötnél a prefix (cím +",
  "  fájlnév) egyedül 89-109 bájt, tehát 40 alatt marad a horgonyra. Megnézem a",
  "  teljes sorokat, és kézzel ítélek.",
  "",
  "  Ran 1 shell command",
  "",
  "⏺ Kézzel ítélve: négyet lehet veszteség nélkül vágni, ötöt nem -- azoknál a",
  "  prefix (cím+fájlnév) 101-109 bájt, tehát a névben van a költség, nem a",
  "  horogban.",
  "",
  "  Ran 1 shell command",
  "  ⎿  Interrupted · What should Claude do instead?",
  "",
  "✻ Cogitated for 1m 39s · done 7:20",
  "",
  "─────────────────────────────────────────────────────────────────────── Jarvis ─",
  "❯ ",
  "────────────────────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents",
].join('\n')

// LIVE: agent-dexter minutes later, mid-turn.
const BUSY_PANE = [
  "   - if it happens twice on the same command, say so rather than working",
  "  around it.  IT IS FAIL-CLOSED -- Escape denies, never approves -- so nothing",
  "  was approved on anyone's behalf and there is no hole. The cost is silent",
  "  denial and wasted retries.  friday holds the fix (296277e8, urgent): a",
  "  targeted detector so permission prompts are excluded from the Escape branch,",
  "  plus an alert to me instead of a keystroke. Until it lands, this keeps",
  "  happening.  I resolved three of these by hand tonight; the only thing missing",
  "  was knowing they existed.  [KULDVE: 2026-09-03 07:33 CEST | sor: 0 | kuldo:",
  "  marveen] </trusted-peer>",
  "",
  "⏺ That explains three \"interruptions\" I took as user signals today — and in one",
  "  case I did exactly what you warn against: after the tsc --listFiles call died",
  "  I dropped the measurement and fell back to quoting CLAUDE.md instead. That",
  "  claim then went into commit 79af3677's message, which can't be corrected.",
  "  Running the measurement I abandoned:",
  "",
  "⏺ Running 1 shell command…",
  "",
  "✽ Jitterbugging… (30s · ↓ 1.1k tokens)",
  "",
  "─────────────────────────────────────────────────────────────────────── Dexter ─",
  "❯ ",
  "────────────────────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for ag…",
].join('\n')

// The usage-credit model-switch dialog (fable-overage-consent.test.ts fixture).
const CONSENT_DIALOG_PANE = [
  '  Fable 5 now uses usage credits',
  '  Fable 5 runs on usage credits, purchased separately from your plan.',
  '    1. Continue with Fable 5',
  '  \u276f 2. Switch to Sonnet 5 and continue',
  '  Enter to confirm \u00b7 Esc to cancel',
].join('\n')

// The first-run folder-trust gate (pane-first-run-gate.test.ts fixture). It
// also renders a numbered "1. Yes", which is why it is excluded explicitly.
const TRUST_GATE_PANE = [
  '\u2502 Do you trust the files in this folder?           \u2502',
  '\u2502 /home/gabor/marveen/agents/nova                  \u2502',
  '\u2502 \u276f 1. Yes, proceed                                \u2502',
  '\u2502   2. No, exit                                    \u2502',
  '   Enter to confirm \u00b7 Esc to exit',
].join('\n')

// MUTATION RESULT, MEASURED 2026-09-03 -- READ THIS BEFORE TRUSTING THE GREEN.
//
// Harness control first: replacing the whole return with `return false` turns
// the positive test RED (1 failed / 8 passed). So the mutations below do reach
// live code and the suite can fail.
//
// With that established, SEVEN separate guard mutations ALL SURVIVED:
//   idle-footer guard removed .......... green
//   first-run-gate guard removed ....... green
//   model-consent guard removed ........ green
//   busy guards removed ................ green
//   YES matcher forced true ............ green
//   ASK matcher forced true ............ green
//   CANCEL matcher forced true ......... green
//
// That is NOT dead code and NOT an unreached mutation. It is redundancy: every
// negative fixture here is rejected by SEVERAL conditions at once, so removing
// any single one changes no outcome. The footer-scoped cancel hint does most of
// the work -- e.g. the "quoted in a live idle pane" case is excluded because the
// quote puts `Esc to cancel` outside the live footer region, NOT because of the
// idle-footer guard it appears to be testing.
//
// So what these tests actually pin is: the positive case, the mutual exclusion
// against both sibling dialogs on their REAL fixtures, and the detectsBlockingMenu
// shadowing. They do NOT pin the individual guards. Manufacturing a fixture that
// isolates each one would mean building panes that cannot occur in the wild (a
// first-run gate that also asks "Do you want to proceed?"), and a fixture that
// invents a coincidence production never produces is worse than an honest gap.
//
// THE GAP THAT IS WORTH KNOWING, since it is the likely future regression: this
// detector requires NO idle footer, because the live prompt renders without one
// (measured on the real capture: detectPaneState = 'unknown'). If a future
// Claude Code renders the footer beneath the dialog, this goes silently false
// and the blind Escape returns. That constraint is shared with
// detectsModelConsentDialog and detectsFirstRunGate, so it is a property of the
// file, not of this function -- but it is the thing to re-measure on a CLI upgrade.

describe('detectsPermissionPrompt', () => {
  it('detects the live tool-permission prompt', () => {
    expect(detectsPermissionPrompt(PERMISSION_PROMPT_PANE)).toBe(true)
  })

  // THE HAZARD ANCHOR, same shape as the FABLEFALL1 regression test one dialog
  // over: this pane ALSO satisfies the generic stuck-menu detector, so any
  // recovery branch keyed on detectsBlockingMenu alone reaches it with a blind
  // Escape -- which on this dialog means "cancel", i.e. denying the tool call
  // on the agent's behalf. If this ever fails because detectsBlockingMenu
  // stopped matching, the ordering guard downstream is no longer load-bearing
  // and whoever changed it needs to know.
  it('is ALSO matched by detectsBlockingMenu -- that is the whole problem', () => {
    expect(detectsBlockingMenu(PERMISSION_PROMPT_PANE)).toBe(true)
  })

  // Documents that the hot path is unchanged: the router/scheduler still see
  // 'unknown' and still refuse to deliver. This detector adds recognition, not
  // a new delivery state.
  it('leaves detectPaneState alone', () => {
    expect(detectPaneState(PERMISSION_PROMPT_PANE)).toBe('unknown')
  })

  it('says no to a healthy idle pane', () => {
    expect(detectsPermissionPrompt(IDLE_PANE)).toBe(false)
  })

  it('says no to a busy pane mid-turn', () => {
    expect(detectsPermissionPrompt(BUSY_PANE)).toBe(false)
  })

  // The two siblings that share the shape and have their own handling.
  it('says no to the model-consent dialog', () => {
    expect(detectsModelConsentDialog(CONSENT_DIALOG_PANE)).toBe(true)
    expect(detectsPermissionPrompt(CONSENT_DIALOG_PANE)).toBe(false)
  })

  it('says no to the first-run trust gate', () => {
    expect(detectsFirstRunGate(TRUST_GATE_PANE)).not.toBeNull()
    expect(detectsPermissionPrompt(TRUST_GATE_PANE)).toBe(false)
  })

  // CONSTRUCTED: a healthy session whose scrollback QUOTES the dialog -- which
  // is exactly what happened to the consent detector the day it shipped. The
  // live idle footer is the discriminator.
  it('says no when the dialog text is merely quoted in a live idle pane', () => {
    // Built by PREPENDING the dialog text to the scrollback of a real idle
    // pane, so the live idle footer stays where it is. No fragile anchor: the
    // first draft of this control used a .replace() whose target never matched,
    // so it asserted on an unmodified pane and proved nothing.
    const quoted = [
      'Do you want to proceed?',
      ' \u276f 1. Yes',
      '   2. No',
      ' Esc to cancel \u00b7 Tab to amend',
      IDLE_PANE,
    ].join('\n')
    expect(detectsPermissionPrompt(quoted)).toBe(false)
  })

  it('says no to an empty pane', () => {
    expect(detectsPermissionPrompt('')).toBe(false)
    expect(detectsPermissionPrompt('   \n  ')).toBe(false)
  })
})

// Card b5a9f60a, marveen's (B) decision 2026-09-03 14:46: the alert must NAME
// what is being asked. Reclassifying without quoting still makes the reader
// open the pane, which is the cost the reclassification exists to remove.
//
// CHANGED BY card fa6535bb (baabe0ba F7), coordinator decision: no command text
// in the stuck-session alert. This block used to pin describePermissionPrompt,
// which quoted the block above the question -- on a Bash card without a reason
// block that is the command box, and a token in argv went into agent_messages.
// The alert now carries the SAME summary as the other permission alerts
// (permissionPromptAsk: card header + the reason Claude gives, a path on a file
// card, the header alone otherwise). The pins below hold the alert to that.
describe('the stuck-session alert names what is asked, and never quotes the command box', () => {
  const alertFor = (pane: string | null) =>
    formatStuckSessionAlert('dexter', 'marveen', 'agent-dexter', 12 * 60 * 1000, 1, null, pane)!
  const asking = (alert: string) => /It is asking: "([^"]*)"/.exec(alert)?.[1] ?? null
  const GREP_CARD = readFileSync(join(__dirname, 'fixtures/pane/permission-prompt-bash-grep.txt'), 'utf8')

  it('quotes the card header and the reason from the live capture, not the command', () => {
    const alert = alertFor(GREP_CARD)
    expect(alert.startsWith('[approval-needed]')).toBe(true)
    const quoted = asking(alert)!
    expect(quoted).toContain('Bash command')
    expect(quoted).toContain('deny rule is configured')
    // the command box of the same card, line by line: none of it is in the alert
    expect(alert).not.toContain('OPERATOR')
    expect(alert).not.toContain('firstSymbol')
    expect(alert).not.toContain('Locate the functions')
  })

  it('on the headless live capture (command box + reason, no card header) nothing of the box is quoted', () => {
    // The capture the old pin was written on. It has no header to name the tool,
    // so there is nothing safe to quote: the alert still says what KIND of thing
    // waits (a tool-permission prompt) and carries no excerpt.
    const alert = alertFor(PERMISSION_PROMPT_PANE)
    expect(alert.startsWith('[approval-needed]')).toBe(true)
    expect(alert).toContain('TOOL-PERMISSION prompt')
    expect(asking(alert)).toBeNull()
    for (const fragment of ['tsc -b', 'escapeHtml', 'textBody', 'submission.service', 'open(p,']) {
      expect(alert).not.toContain(fragment)
    }
    // CONTROL: the fragments really are in the pane, so the absence is the code's doing
    for (const fragment of ['tsc -b', 'escapeHtml', 'textBody', 'submission.service', 'open(p,']) {
      expect(PERMISSION_PROMPT_PANE).toContain(fragment)
    }
  })

  it('returns ONE line, so it cannot imitate the framing of the message carrying it', () => {
    // Pane content is not ours. A reason that kept its control characters could
    // forge a header inside the inter-agent message that carries it. The fixture
    // carries them on purpose (an assertion on the clean capture cannot tell a
    // sanitiser from none): a CR, a tab, an ESC and a BEL inside the reason.
    const dirty = GREP_CARD.replace('a Read()\n │ deny rule', 'a Read()\u000d\u0009\u001b[2J\u0007\n │ deny rule')
    expect(dirty).not.toBe(GREP_CARD)
    const alert = alertFor(dirty)
    const quoted = asking(alert)!
    expect(quoted).toContain('deny rule is configured')
    expect(quoted).not.toMatch(/[\u0000-\u001f\u007f]/)
    expect(alert).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/)
    // CONTROL: the clean capture quotes the same words
    expect(asking(alertFor(GREP_CARD))).toContain('deny rule is configured')
  })

  it('caps the excerpt, however long the reason is', () => {
    const long = GREP_CARD.replace('deny rule is configured', `deny rule is configured ${'x'.repeat(900)}`)
    const quoted = asking(alertFor(long))!
    expect(quoted.length).toBeLessThanOrEqual(260)
    expect(quoted.endsWith('…')).toBe(true)
    // CONTROL: the uncapped one is genuinely shorter
    expect(asking(alertFor(GREP_CARD))!.length).toBeLessThan(260)
  })

  it('still alerts when the prompt renders no explanation block: no excerpt, the verdict stands', () => {
    const bare = [
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      '',
      ' Esc to cancel · Tab to amend',
    ].join('\n')
    const alert = alertFor(bare)
    expect(alert.startsWith('[approval-needed]')).toBe(true)
    expect(asking(alert)).toBeNull()
  })

  it('says nothing about panes that are not a permission prompt', () => {
    // The negative half: without this, a function that always returned the same
    // sentence would pass every test above. The QUOTING pane is the one that
    // matters (an agent that merely PASTES the dialog into its scrollback
    // contains the question and the options, and must not be described as a
    // live prompt).
    const quotingIdlePane = [
      'Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      ' Esc to cancel · Tab to amend',
      IDLE_PANE,
    ].join('\n')
    for (const pane of [quotingIdlePane, IDLE_PANE, BUSY_PANE, CONSENT_DIALOG_PANE, TRUST_GATE_PANE, '']) {
      const alert = alertFor(pane)
      expect(alert.startsWith('[approval-needed]')).toBe(false)
      expect(asking(alert)).toBeNull()
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  detectsPermissionPrompt, detectsBlockingMenu, detectPaneState,
  detectsModelConsentDialog, detectsFirstRunGate, describePermissionPrompt,
} from '../pane-state.js'

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
describe('describePermissionPrompt', () => {
  it('quotes the explanation block AND the question from the live capture', () => {
    const quoted = describePermissionPrompt(PERMISSION_PROMPT_PANE)!
    expect(quoted).toContain('Do you want to proceed?')
    // The block above the question is what names the command and the reason.
    expect(quoted).toContain('deny rule is configured')
    expect(quoted).toContain('submission.service.ts')
  })

  it('returns ONE line, so it cannot imitate the framing of the message carrying it', () => {
    // Pane content is not ours. An excerpt that kept its control characters
    // could forge a header inside the inter-agent message that carries it.
    //
    // THE FIXTURE CARRIES THE CONTROL CHARACTERS ON PURPOSE, and that is a
    // correction: the first version of this test asserted on the clean live
    // capture, and the mutation that REMOVED the sanitiser stayed green -- the
    // fixture could not express the state the assertion was about. A pane with
    // a CR and a tab in the quoted block can.
    const dirty = PERMISSION_PROMPT_PANE.replace(
      'a Read() deny rule is',
      'a Read()\u000d\u0009deny\u0009rule  is',
    )
    const quoted = describePermissionPrompt(dirty)!
    expect(quoted).not.toContain('\n')
    expect(quoted).not.toMatch(/[\u0000-\u001f]/)
    // Collapsed, not merely stripped: the words survive with single spaces.
    expect(quoted).toContain('Read() deny rule is configured')
    // CONTROL: the same assertions on the clean capture, so a function that
    // returned an empty string would not pass this test.
    const clean = describePermissionPrompt(PERMISSION_PROMPT_PANE)!
    expect(clean).toContain('deny rule is configured')
  })

  it('caps the excerpt, however long the pane line is', () => {
    const long = PERMISSION_PROMPT_PANE.replace(
      ' │ grep on ',
      ` │ ${'x'.repeat(900)} grep on `,
    )
    const quoted = describePermissionPrompt(long)!
    expect(quoted.length).toBeLessThanOrEqual(220)
    expect(quoted.endsWith('...')).toBe(true)
    // CONTROL: the uncapped one is genuinely shorter, so the cap is not simply
    // truncating every input to the same string.
    expect(describePermissionPrompt(PERMISSION_PROMPT_PANE)!.length).toBeLessThan(220)
  })

  it('still answers when the prompt renders no explanation block', () => {
    // Not every prompt has one; the question alone is a valid answer, and the
    // walk must not require a box to return something.
    const bare = [
      ' Do you want to make this edit to config.ts?',
      ' ❯ 1. Yes',
      '   2. No',
      '',
      ' Esc to cancel · Tab to amend',
    ].join('\n')
    expect(describePermissionPrompt(bare)).toBe('Do you want to make this edit to config.ts?')
  })

  it('says nothing about panes that are not a permission prompt', () => {
    // The negative half: without this, a function that always returned the same
    // sentence would pass every test above.
    //
    // THE QUOTING PANE IS THE ONE THAT MATTERS, and it was added after a
    // mutation SURVIVED: dropping the detectsPermissionPrompt() guard left all
    // of the panes below returning null anyway, because none of them contains
    // the question at all -- so they proved nothing about the guard. An agent
    // that merely PASTES the dialog into its scrollback does contain it, and
    // without the guard that pane would be described as a live prompt.
    const quotingIdlePane = [
      'Do you want to proceed?',
      ' \u276f 1. Yes',
      '   2. No',
      ' Esc to cancel \u00b7 Tab to amend',
      IDLE_PANE,
    ].join('\n')
    expect(describePermissionPrompt(quotingIdlePane)).toBeNull()
    expect(describePermissionPrompt(IDLE_PANE)).toBeNull()
    expect(describePermissionPrompt(BUSY_PANE)).toBeNull()
    expect(describePermissionPrompt(CONSENT_DIALOG_PANE)).toBeNull()
    expect(describePermissionPrompt(TRUST_GATE_PANE)).toBeNull()
    expect(describePermissionPrompt('')).toBeNull()
  })
})

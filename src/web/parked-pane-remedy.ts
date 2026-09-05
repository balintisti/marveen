/**
 * WHAT SHOULD THE READER OF A STUCK-SESSION ALERT ACTUALLY DO?
 *
 * The alert layer is where BOTH known misreadings live, and they point in
 * OPPOSITE directions -- which is why one predicate belongs here rather than a
 * sixth state in `pane-state.ts` (marveen's decision, card cb062949):
 *
 *   PARKED reported as idle   -> the notice says "nothing assigned"; waking it
 *                                changes nothing and the queue keeps growing.
 *                                Measured 2026-09-05: computress sat 90 minutes
 *                                with an un-submitted injected message, six
 *                                notices, pending 0 -> 2. The fix was ONE Enter.
 *   WORKING reported as parked -> the notice says "answer the prompt"; acting on
 *                                it types into a LIVE turn. Measured the same
 *                                day 15:46: didi reported "parked on a
 *                                TOOL-PERMISSION prompt" while the spinner was
 *                                up and tokens went 70.5k -> 71.4k in 17s.
 *
 * A sixth PaneState would have fixed neither: the second one is not a state the
 * detector got wrong, it is a REMEDY the alert got wrong. And a new enum member
 * changes the contract for all three consumers of the pane signal (idle-guard,
 * router, context-guard), whose INTERSECTION is where this fleet's decision-tree
 * bugs have actually landed. A caller-side predicate has one consumer, so its
 * intersection set has one element.
 *
 * === WHY THIS DOES NOT SIMPLY ASK `parkedInputText()`
 *
 * Because that is blind in exactly the cases that produced the card. The box
 * scan in `detectPaneState` needs BOTH rules of the input box inside the
 * capture; with fewer than two it never runs the parked check and falls through
 * to `idle`. Measured 2026-09-05 against a 25-line window (the width of all
 * nine live panes that day), varying only how many lines the parked message
 * wraps to:
 *
 *     wrap 10 lines -> 2 rules -> 'typing', parkedInputText = the message
 *     wrap 20 lines -> 2 rules -> 'typing', parkedInputText = the message
 *     wrap 22 lines -> 1 rule  -> **'idle'**, parkedInputText = **null**
 *     wrap 30 lines -> 1 rule  -> **'idle'**, parkedInputText = **null**
 *
 * So the misclassification gets MORE likely the longer the parked message is --
 * and long is what an injected inter-agent message is. A predicate built on
 * `parkedInputText()` alone would report "not parked" for precisely the panes
 * this card is about, in the flattering direction, silently. That is the
 * guard-shares-a-dependency-with-the-danger shape `busyEvidence`'s own comment
 * already records (jarvis, 2026-08-22).
 *
 * The independent signal is a CONTRADICTION: a prompt line carrying text while
 * the box-scoped reader says there is none. Two exported signals that cannot
 * both be right. We do not resolve it -- we report that it cannot be resolved.
 *
 * === A THIRD DEFECT THIS DOES *NOT* FIX, NAMED SO NOBODY READS IT AS COVERED
 *
 * `busyEvidence` separates 'footer' (`esc to interrupt`, written only during a
 * live turn) from 'counter' (a spinner/token line Claude Code does not always
 * overwrite when a turn ENDS). A stale counter left above a genuinely PARKED
 * box is therefore possible, and it is the card's harm with a different cause:
 * nobody presses the Enter, because the pane reports as working.
 *
 * We do not detect it here, and the reason is structural rather than an
 * oversight. Measured 2026-09-05: a counter in the live region makes
 * `detectPaneState` return 'busy', and `parkedInputText` returns null unless the
 * state is 'typing' -- so "a counter AND parked text" is UNREACHABLE through
 * these two primitives. A first draft of this file branched on that pair; the
 * branch could not fire. Upstream of us the alert also short-circuits on
 * `paneState === 'busy'` before reaching this predicate at all.
 *
 * Catching it needs a raw-signal read that overrides the busy branch, which is a
 * change to the FIRST thing the alert decides and belongs in its own review, not
 * smuggled into this one. Card raised separately.
 *
 * === WHAT THIS CANNOT SEE, STATED SO NOBODY READS THE 'none' VERDICT AS PROOF
 *
 * When the parked message wraps past the whole capture window, the ❯ line
 * scrolls off too. Then no signal survives in the capture at all and this
 * returns 'none' -- indistinguishable from a genuinely empty box. Widening the
 * capture is the only fix for that, and it is not this predicate's to make.
 */
import { busyEvidence, detectsPermissionPrompt, parkedInputText } from '../pane-state.js'

export type PaneRemedy =
  /** A turn is in flight. Any intervention lands inside it. */
  | 'leave-it'
  /** Parked on a permission prompt with nothing running: a person decides. */
  | 'answer-it'
  /** Text sitting un-submitted in a VISIBLE input box. One Enter, not a restart. */
  | 'press-enter'
  /** The signals disagree, or the box is not visible. Do not act on the alert. */
  | 'read-the-pane'
  /** Box visible and empty, nothing running: this alert carries no remedy. */
  | 'none'

export interface PaneRemedyVerdict {
  remedy: PaneRemedy
  /** The un-submitted text, when we could actually read it. */
  parkedText: string | null
  /** Why this verdict -- goes into the alert so the reader can check it. */
  why: string
}

// Input-box rules, same glyph class `pane-state.ts` uses. Duplicated rather
// than imported because `liveInputBox` is module-private there; if that ever
// changes, import it and delete these two.
const BOX_RULE_RX = /^─{10,}/
const PROMPT_WITH_TEXT_RX = /❯[^\S\r\n]+\S/

// The inner lines of the live input box: between the last two rules above the
// idle footer. Returns null when the box is not fully in the capture. Mirrors
// `liveInputBox` in pane-state.ts, which is module-private there.
function liveBoxInnerLines(lines: string[]): string[] | null {
  const footerIdx = lines.findIndex(l => /(?:[A-Za-z][\w-]* ){1,3}on(?: \(shift\+tab to cycle\)| · )|\? for shortcuts/.test(l))
  if (footerIdx < 0) return null
  let bottom = -1
  for (let i = footerIdx - 1; i >= 0; i--) { if (BOX_RULE_RX.test(lines[i])) { bottom = i; break } }
  if (bottom <= 0) return null
  let top = -1
  for (let i = bottom - 1; i >= 0; i--) { if (BOX_RULE_RX.test(lines[i])) { top = i; break } }
  if (top < 0) return null
  return lines.slice(top + 1, bottom)
}

export function paneRemedy(pane: string | null): PaneRemedyVerdict {
  if (pane == null || pane.trim() === '') {
    return { remedy: 'read-the-pane', parkedText: null, why: 'no pane capture was available' }
  }

  const evidence = busyEvidence(pane)
  const parked = parkedInputText(pane)

  // Either strength means leave it alone. They are NOT equally strong (see the
  // third-defect note above), but they are not distinguishable here: a counter
  // forces state 'busy', which forces `parkedInputText` to null, so no
  // contradiction between the two can be observed from this vantage point.
  if (evidence != null) {
    const why = evidence === 'footer'
      ? 'the footer shows a turn in flight'
      : 'a spinner/token line is up'
    return { remedy: 'leave-it', parkedText: null, why }
  }

  if (detectsPermissionPrompt(pane)) {
    return { remedy: 'answer-it', parkedText: null, why: 'a permission prompt is open and nothing is running' }
  }

  if (parked != null) {
    return { remedy: 'press-enter', parkedText: parked, why: 'text is sitting un-submitted in the live input box' }
  }

  // TWO WAYS AN OVERFULL BOX HIDES ITS OWN CONTENT, and they need different
  // reads. Both end at `idle` with parkedInputText null, which is why neither
  // can be answered by the box-scoped reader alone.
  const lines = pane.split('\n')
  const rules = lines.reduce((n, l) => (BOX_RULE_RX.test(l) ? n + 1 : n), 0)

  // (a) The box's TOP RULE scrolled off. The prompt line survives, so the
  //     contradiction is visible: a ❯ carrying text while the box reader says
  //     there is none.
  if (rules < 2 && lines.some(l => PROMPT_WITH_TEXT_RX.test(l))) {
    return {
      remedy: 'read-the-pane',
      parkedText: null,
      why: 'a prompt line carries text but the input box is not fully inside the capture, so the pane reads idle when it is actually parked',
    }
  }

  // (b) The box's HEAD was dropped: both rules are drawn, but the TUI discarded
  //     the leading rows, taking the ❯ glyph with them. `pane-state.ts:1557`
  //     records this on a LIVE main pane (2026-08-01) whose box began
  //     mid-sentence -- so unlike (a) this shape has a real capture behind it.
  //     A live box ALWAYS renders `❯ ` when it is empty, so box content with no
  //     ❯ anywhere in it is not an empty box: it is a box that lost its head.
  //     Found by jarvis's intersection check on card cb062949; the first version
  //     of this file went blind exactly here, which is the shape jarvis warned
  //     the new predicate would inherit.
  const inner = liveBoxInnerLines(lines)
  if (inner != null && inner.some(l => l.trim() !== '') && !inner.some(l => l.includes('❯'))) {
    return {
      remedy: 'read-the-pane',
      parkedText: null,
      why: 'the input box holds text but its head (including the prompt glyph) was dropped by the TUI, so the pane reads idle when it is actually parked',
    }
  }

  return { remedy: 'none', parkedText: null, why: 'the input box is visible and empty and nothing is running' }
}

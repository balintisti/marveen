/**
 * pane-nudge: the decision and the send-and-verify loop behind `scripts/pane-nudge.sh`
 * (card 3cf0019f, Isti's yes TG 9841).
 *
 * WHAT IT IS FOR. A turn that died on "API Error: Connection lost mid-response" leaves the
 * agent sitting at an empty prompt. Nothing wakes it, and a person types one line to restart
 * it: read the pane, check it really is stopped, type, Enter, look whether a turn began. This
 * file is that routine, with the refusals written down. It is a MANUAL tool: nothing here runs
 * on a timer (that is card bd1f7b2c's root fix), and it never answers a prompt.
 *
 * WHY IT SENDS NOTHING UNLESS THE PANE IS PROVABLY STOPPED. Typing into a pane is the one
 * action here that cannot be taken back, and the two ways to get it wrong point in opposite
 * directions (see web/parked-pane-remedy.ts, measured 2026-09-05):
 *   - a WORKING pane read as stopped: the line lands inside a live turn;
 *   - a pane on a PERMISSION prompt read as stopped: the Enter is a "Yes". That decision is
 *     the owner's (card 68cb6715, cold 3279: the coordinator once pressed Yes twice, wrongly).
 * So the pane has to pass the repo's own detectors, twice, a second apart, and every other
 * shape is a NAMED refusal with its own exit code. No hand regex lives here: the verdict is
 * `mayActOnPane`, `busyEvidence`, `paneRemedy` and the dialog detectors, the same ones the
 * idle-guard and the router use.
 *
 * WHAT "OK" MEANS. Not "the keys were sent": a turn STARTED (`busyEvidence` on a later
 * capture). A line that was typed but is still parked in the box is reported as such, with the
 * pane left as it is.
 */
import {
  busyEvidence,
  decideSubmitFollowup,
  detectPaneState,
  detectsBlockingMenu,
  detectsFeedbackDraftModal,
  detectsFirstRunGate,
  detectsModelConsentDialog,
  detectsPermissionDialog,
  detectsPermissionPrompt,
  detectsUsageLimitReached,
  mayActOnPane,
  midTurnApiErrorAtTail,
  parkedInputText,
} from './pane-state.js'
import { paneRemedy } from './web/parked-pane-remedy.js'

/** Exit codes of the CLI. 0 is the only success; every refusal has its own number. */
export const NUDGE_EXIT = {
  /** A turn started after the nudge (or, with --dry-run, the pane would have been nudged). */
  OK: 0,
  /** Usage error: bad arguments or text that is not allowed. */
  USAGE: 2,
  /** The tmux session does not exist (or tmux could not be read). */
  NO_SESSION: 3,
  /** The agent is working: nothing was typed. */
  WORKING: 4,
  /** A permission prompt or another dialog is open: its answer is the owner's. Nothing typed. */
  DIALOG: 5,
  /** Text is parked in the input box already: not ours to overwrite. Nothing typed. */
  PARKED: 6,
  /** The pane could not be read as idle (unknown shape, banner, box off-screen). Nothing typed. */
  UNREADABLE: 7,
  /** The line was typed and submitted but no turn was seen to start. */
  NOT_STARTED: 8,
  /** The usage limit is reached: a nudge cannot help. Nothing typed. */
  USAGE_LIMIT: 9,
} as const

export type NudgeRefusal =
  | 'working'
  | 'dialog'
  | 'parked-input'
  | 'unreadable'
  | 'usage-limit'

export interface NudgeDecision {
  go: boolean
  refusal: NudgeRefusal | null
  /** One line saying why: goes to the operator so the verdict can be checked against the pane. */
  why: string
  /** Was the pane's tail a mid-turn API error? Information only: it never changes `go`.
   *  null = could not be told (box not fully in the capture). */
  apiErrorAtTail: boolean | null
}

const REFUSAL_EXIT: Record<NudgeRefusal, number> = {
  working: NUDGE_EXIT.WORKING,
  dialog: NUDGE_EXIT.DIALOG,
  'parked-input': NUDGE_EXIT.PARKED,
  unreadable: NUDGE_EXIT.UNREADABLE,
  'usage-limit': NUDGE_EXIT.USAGE_LIMIT,
}

export function exitCodeForRefusal(refusal: NudgeRefusal): number {
  return REFUSAL_EXIT[refusal]
}

function refuse(refusal: NudgeRefusal, why: string, apiErrorAtTail: boolean | null): NudgeDecision {
  return { go: false, refusal, why, apiErrorAtTail }
}

/** Does any dialog that is not the plain input box own this pane? One named reason, or null. */
function dialogOwning(pane: string): string | null {
  if (detectsPermissionPrompt(pane)) return 'a permission prompt is open'
  if (detectsPermissionDialog(pane)) return 'a permission dialog is open'
  if (detectsModelConsentDialog(pane)) return 'a model consent dialog is open'
  if (detectsFeedbackDraftModal(pane)) return 'a feedback dialog is open'
  const gate = detectsFirstRunGate(pane)
  if (gate != null) return `a first-run gate (${gate}) is open`
  if (detectsBlockingMenu(pane)) return 'a blocking menu is open'
  return null
}

/**
 * May a line be typed into this pane? Pure: a capture in, a verdict out.
 *
 * The order matters, and each step answers a question the next one cannot:
 * a working pane first (so a spinner never reads as anything else), then any dialog (an Enter
 * there is an answer), then the usage limit, then text already in the box, and only then the
 * positive test. `go` needs ALL of: the state is idle, the limit is not reached, the box is
 * visible and empty. Everything else is refused, including "I cannot tell".
 */
export function decidePaneNudge(pane: string | null): NudgeDecision {
  if (pane == null || pane.trim() === '') {
    return refuse('unreadable', 'no pane capture was available', null)
  }
  const apiErrorAtTail = midTurnApiErrorAtTail(pane)

  const evidence = busyEvidence(pane)
  if (evidence != null) {
    return refuse('working', evidence === 'footer' ? 'the footer shows a turn in flight' : 'a spinner/token line is up', apiErrorAtTail)
  }
  const dialog = dialogOwning(pane)
  if (dialog != null) {
    return refuse('dialog', `${dialog}: the answer is the owner's, not ours`, apiErrorAtTail)
  }
  if (detectsUsageLimitReached(pane)) {
    return refuse('usage-limit', 'the usage limit is reached: a nudge cannot start a turn', apiErrorAtTail)
  }
  const remedy = paneRemedy(pane)
  if (remedy.remedy === 'press-enter' || parkedInputText(pane) != null) {
    return refuse('parked-input', 'text is already parked in the input box: it is not ours to overwrite or submit', apiErrorAtTail)
  }
  if (remedy.remedy === 'read-the-pane') {
    return refuse('unreadable', remedy.why, apiErrorAtTail)
  }
  if (!mayActOnPane(pane)) {
    return refuse('unreadable', `the pane does not read as idle (state: ${detectPaneState(pane)})`, apiErrorAtTail)
  }
  return { go: true, refusal: null, why: 'the pane is idle, the input box is visible and empty', apiErrorAtTail }
}

const MAX_NUDGE_CHARS = 300
// A first character that changes what the TUI does with the line: `/` is a slash command, `!`
// opens bash mode, `#` is the memory shortcut, `-` is read by tmux as a flag.
const FORBIDDEN_FIRST_CHARS = ['/', '!', '#', '-']

/** Null when the text may be typed, otherwise the reason it may not. */
export function nudgeTextProblem(text: string): string | null {
  if (text.trim() === '') return 'the text is empty'
  if (text !== text.trim()) return 'the text has leading or trailing whitespace'
  if (text.length > MAX_NUDGE_CHARS) return `the text is ${text.length} characters; the limit is ${MAX_NUDGE_CHARS} (a nudge is one short line)`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return 'the text has a control character or a line break (a newline would submit early)'
  if (FORBIDDEN_FIRST_CHARS.includes(text[0])) {
    return `the text may not start with "${text[0]}": the TUI (or tmux) would read it as a command, not as a line`
  }
  return null
}

export type NudgeOutcome =
  | { kind: 'refused'; decision: NudgeDecision; exit: number; stage: 'first-read' | 'second-read' }
  | { kind: 'dry-run'; decision: NudgeDecision; exit: 0 }
  | { kind: 'started'; evidence: 'footer' | 'counter'; extraEnters: number; exit: 0 }
  | { kind: 'not-started'; reason: string; parked: boolean; extraEnters: number; exit: number }

export interface NudgeDeps {
  /** The pane as the detectors read it (colour stripped, banner removed). null = capture failed. */
  capture: () => string | null
  typeLiteral: (text: string) => void
  pressEnter: () => void
  delay: (ms: number) => Promise<void>
}

export interface NudgeOptions {
  dryRun?: boolean
  /** The gap between the two reads that must both say "idle". */
  settleMs?: number
  /** How long to watch for the turn to start, and how often to look. */
  watchMs?: number
  pollMs?: number
  /** Retry Enters for a line that stays parked after the first one. */
  maxExtraEnters?: number
}

/**
 * Read twice, type, submit, and watch for the turn to start.
 *
 * Two reads, `settleMs` apart, both have to say go: a frame caught between two renders reads
 * idle for one capture, and the cost of a wrong "go" is a keystroke into a live turn. The text
 * is typed ONCE; if it is still parked after the Enter, only a plain Enter is repeated (the
 * single-row case `decideSubmitFollowup` names), and a multi-row box or a placeholder is left
 * alone and reported, because no key fits there (see decideSubmitFollowup).
 */
export async function nudgePane(deps: NudgeDeps, text: string, opts: NudgeOptions = {}): Promise<NudgeOutcome> {
  const settleMs = opts.settleMs ?? 1000
  const watchMs = opts.watchMs ?? 12000
  const pollMs = opts.pollMs ?? 500
  const maxExtraEnters = opts.maxExtraEnters ?? 2

  const first = decidePaneNudge(deps.capture())
  if (!first.go) {
    return { kind: 'refused', decision: first, exit: exitCodeForRefusal(first.refusal as NudgeRefusal), stage: 'first-read' }
  }
  await deps.delay(settleMs)
  const second = decidePaneNudge(deps.capture())
  if (!second.go) {
    return { kind: 'refused', decision: second, exit: exitCodeForRefusal(second.refusal as NudgeRefusal), stage: 'second-read' }
  }
  if (opts.dryRun) return { kind: 'dry-run', decision: second, exit: 0 }

  deps.typeLiteral(text)
  await deps.delay(300)
  deps.pressEnter()

  const hints = [text.slice(0, 96), text.slice(-96)]
  let extraEnters = 0
  let parked = false
  let last: string | null = null
  const polls = Math.max(1, Math.ceil(watchMs / pollMs))
  for (let i = 0; i < polls; i++) {
    await deps.delay(pollMs)
    last = deps.capture()
    const evidence = last == null ? null : busyEvidence(last)
    if (evidence != null) return { kind: 'started', evidence, extraEnters, exit: 0 }
    const follow = decideSubmitFollowup(last, hints, extraEnters, maxExtraEnters)
    if (follow === 'retry-enter') {
      deps.pressEnter()
      extraEnters++
      continue
    }
    if (follow === 'clear-and-resend' || follow === 'parked-multirow') {
      return {
        kind: 'not-started',
        reason: follow === 'parked-multirow'
          ? 'the line sits in a multi-row input box, where Enter adds a newline: left as it is'
          : 'the line was folded into a pasted-text placeholder: left as it is',
        parked: true,
        extraEnters,
        exit: NUDGE_EXIT.NOT_STARTED,
      }
    }
    if (follow === 'give-up') {
      parked = true
      break
    }
  }
  return {
    kind: 'not-started',
    reason: parked
      ? `the line is still parked in the input box after ${extraEnters} extra Enter(s): left as it is`
      : `no running turn was seen within ${watchMs} ms and the line is not parked: look at the pane`,
    parked,
    extraEnters,
    exit: NUDGE_EXIT.NOT_STARTED,
  }
}

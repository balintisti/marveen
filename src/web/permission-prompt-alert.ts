import { PERMISSION_ALERT_MARKS, PERMISSION_HELPER_AUTODENY_MIN } from '../config.js'
import { logger } from '../logger.js'
import { isPermissionFileCardTitle, permissionPromptSummary } from '../pane-state.js'
import type { AlertMeta } from '../notify.js'
import { escalatePermissionPrompt, type PermPromptAction, type PermPromptEscalationState } from './permission-prompt-escalation.js'

// PERMFLOOD1012: an unanswered tool-permission prompt is ONE open question, so
// it gets one message and then thinning reminders -- not one message per
// dedup window.
//
// PERMDENY905 stopped the monitor from Escaping a permission prompt (Escape
// there is NO) and made it alert instead. But the alert rode the menu pass's
// dedup window, which was sized for retrying an Escape: 5 minutes. With no
// Escape to end the spell, the alert simply repeats for as long as nobody
// answers. Measured on a live install, 2026-09-28: one Edit prompt on a skill
// file under ~/.claude, raised at 04:18 by a scheduled task, stood until 12:14
// -- 95 identical messages, none of which said WHAT was being asked.
//
// Two changes, both here so they are testable without tmux or a channel:
//   - the alert quotes the question, so the owner can decide from the message;
//   - a prompt that is still the SAME question is announced at fixed marks of
//     its age, widening to one a day. A DIFFERENT question starts its own clock.

/**
 * How old an unanswered prompt is when a message goes out. The last mark is
 * also the repeat period: with the default it is one message a day for as long
 * as the prompt stands. Configurable as PERMISSION_ALERT_MARKS (settings
 * registry, module "channels").
 *
 * The first mark is deliberately not zero. Most prompts are answered by an
 * owner who is at the pane already (a supervised batch of skill edits is a
 * prompt every few minutes), and a message about a question they are looking
 * at is noise. On a sub-agent's pane the first mark is also the main agent's
 * head start (card 68cb6715, permission-prompt-escalation.ts): it is told at
 * first sight, the owner 15 minutes later if nobody answered.
 */
export const DEFAULT_PERMISSION_ALERT_MARKS = '15m,30m,1h,2h,8h,24h'
const MAX_MARK_MS = 30 * 24 * 60 * 60 * 1000
const MARK_UNIT_MS: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }

/**
 * "10m, 30m, 1h, 1d" -> milliseconds, ascending, duplicates dropped.
 *
 * The same spelling the /model hold already takes (main-model.ts parseHold:
 * '4h' | '30m' | bare number = minutes), widened with s and d. Any unreadable
 * entry rejects the WHOLE value: a half-applied schedule is harder to notice
 * than the default. 0 is allowed as a first mark ("speak on first sight").
 */
export function parsePermissionAlertMarks(raw: string | null | undefined): { marks: number[], valid: boolean } {
  const read = (text: string): number[] | null => {
    const parts = text.toLowerCase().split(/[\s,;]+/).filter(Boolean)
    if (parts.length === 0) return null
    const marks: number[] = []
    for (const part of parts) {
      const m = /^(\d{1,6})([smhd])?$/.exec(part)
      if (!m) return null
      const ms = Number(m[1]) * MARK_UNIT_MS[m[2] ?? 'm']
      if (ms > MAX_MARK_MS) return null
      marks.push(ms)
    }
    const sorted = [...new Set(marks)].sort((x, y) => x - y)
    // The last mark is the repeat period, so it cannot be zero.
    return sorted[sorted.length - 1] > 0 ? sorted : null
  }
  const text = (raw ?? '').trim()
  const parsed = text ? read(text) : null
  if (parsed) return { marks: parsed, valid: true }
  return { marks: read(DEFAULT_PERMISSION_ALERT_MARKS) as number[], valid: text === '' }
}

export const DEFAULT_PERMISSION_REMINDER_MARKS_MS: readonly number[] = parsePermissionAlertMarks(DEFAULT_PERMISSION_ALERT_MARKS).marks

// Same anchor family as PERMISSION_SUMMARY_QUESTION_RX in pane-state.ts, but
// this one captures the whole question, and it is matched from the BOTTOM: with
// scrollback in the capture, an earlier line of the transcript may quote the
// same words.
const PERMISSION_QUESTION_LINE_RX = /\bDo you want to [^?\n]{1,200}\?/i
const PERMISSION_CARD_RULE_RX = /^─{8,}\s*$/
const PERMISSION_CARD_DASH_RX = /^\s*[╌┄-]{8,}\s*$/
// "Edit file", "Write file", "Bash command": a short capitalised label, with
// the suffix a sub-agent's card carries ("Bash command · from the
// general-purpose agent", both live Bash captures). The shape guard matters
// because the capture may reach past the card, where the nearest rule above
// the question belongs to something else entirely.
const PERMISSION_CARD_TITLE_RX = /^[A-Z][A-Za-z]+(?: [A-Za-z]+){0,3}(?: · from the \S+(?: \S+){0,3} agent)?$/
// The agent type a sub-agent's card carries in its title suffix. Only ever read
// from the TITLE (the header line), never from the command under it: a main
// agent's Bash card whose command happens to say "· from the x agent" has no
// suffix on its header, so it is not a helper's card.
const PERMISSION_CARD_HELPER_RX = / · from the (\S+(?: \S+){0,3}) agent$/
// Only on a "<Verb> file" card (isPermissionFileCardTitle, pane-state.ts) is
// the line under the header quoted: it is a path. On every other card -- a
// Bash card above all -- that line is the COMMAND, and a command line can
// carry a literal token (`curl -H "Authorization: Bearer ..."`); the alert
// goes out to a chat channel and has never carried command text. Review of
// #1907 fed this module exactly such a card and got the token back in the ask.
// An allowlist, not a redaction pass: what is never quoted cannot leak in a
// shape nobody thought to redact. The card summary (step 1 below) applies the
// same rule to its reason block, in pane-state.ts, so that every message built
// from it -- not only this one -- gets it.
// A sub-agent's card draws its subject quoted ("   │ ~/.claude/..."); the
// quote bar is layout, not part of the path.
const PERMISSION_SUBJECT_QUOTE_RX = /^│\s?/
const PERMISSION_ASK_MAX = 260
const PERMISSION_IDENTITY_MAX = 1500

interface PermissionCard {
  question: string
  /** Card header, e.g. "Edit file" -- null when the header scrolled out of the capture. */
  title: string | null
  /** The line under the header: the path of an edit, the command of a Bash card. */
  subject: string | null
  /** Everything from the header to the question, for telling two prompts apart. */
  body: string
  /** The sub-agent type from the header's suffix ("general-purpose"); null on the main agent's own card. */
  helper: string | null
}

// The measured shape (CLI 2.1.110, an Edit on a file under ~/.claude):
//
//    ────────────────────────────────────────────
//     Edit file
//     ../.claude/scheduled-tasks/dream-engine/SKILL.md
//    ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//      <the diff, as long as the edit is>
//    ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//     Do you want to make this edit to SKILL.md?
//
// The question names only the basename -- on a fleet where a dozen skills are
// all called SKILL.md that says nothing -- and the path sits ABOVE the diff,
// which pushes it off the visible pane for any edit longer than a screen. Hence
// the capture with scrollback.
function readPermissionCard(pane: string): PermissionCard | null {
  const lines = pane.split('\n')
  let questionIdx = -1
  let question = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = PERMISSION_QUESTION_LINE_RX.exec(lines[i])
    if (m) { questionIdx = i; question = m[0].trim(); break }
  }
  if (questionIdx < 0) return null
  let ruleIdx = -1
  for (let i = questionIdx - 1; i >= 0; i--) {
    if (PERMISSION_CARD_RULE_RX.test(lines[i])) { ruleIdx = i; break }
  }
  let title: string | null = null
  let subject: string | null = null
  if (ruleIdx >= 0) {
    const head = lines.slice(ruleIdx + 1, questionIdx).map((l) => l.trim()).filter(Boolean)
    if (head.length >= 2 && PERMISSION_CARD_TITLE_RX.test(head[0]) && !PERMISSION_CARD_DASH_RX.test(head[1])) {
      title = head[0]
      subject = head[1].replace(PERMISSION_SUBJECT_QUOTE_RX, '').trim() || null
    }
  }
  const helper = title != null ? (PERMISSION_CARD_HELPER_RX.exec(title)?.[1] ?? null) : null
  const from = title != null ? ruleIdx + 1 : Math.max(0, questionIdx - 40)
  const body = lines.slice(from, questionIdx + 1).map((l) => l.trim()).filter(Boolean).join('\n')
  return { question, title, subject, body, helper }
}

function capAsk(text: string): string {
  // Control characters go first (an ESC or a BEL survives a plain \s collapse):
  // pane content is not ours, and this string is pasted into a message. The
  // stuck-session alert's old quoting did the same (card fa6535bb).
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > PERMISSION_ASK_MAX ? flat.slice(0, PERMISSION_ASK_MAX - 1).trimEnd() + '…' : flat
}

/**
 * One line saying what the prompt asks, or null when nothing readable is on
 * the pane. In order of how much each says:
 *   1. the tool card summary (title + the reason Claude gives), when the card
 *      has a reason block that permissionPromptSummary can tell apart from
 *      the command echo (on a reason-less card the last quoted block IS the
 *      command, so there is no summary and this step is skipped);
 *   2. on a file card, the header and the path ("Edit file: <path>"), which
 *      needs `deepPane` whenever the edit is longer than the screen;
 *   3. on any other card, the header alone ("Bash command") -- never the line
 *      under it, which is the command;
 *   4. the question line itself, when no header is readable.
 */
export function permissionPromptAsk(pane: string | null | undefined, deepPane: string | null | undefined = pane): string | null {
  if (!pane && !deepPane) return null
  const summary = pane ? permissionPromptSummary(pane) : null
  if (summary) return capAsk(`${summary.title} -- ${summary.reason}`)
  const card = readPermissionCard(deepPane || pane || '')
  if (!card) return null
  if (card.title && card.subject && isPermissionFileCardTitle(card.title)) {
    return capAsk(`${card.title}: ${card.subject}`)
  }
  // Any other card with a readable header: the header alone ("Bash command").
  // It tells the owner what KIND of thing waits, and nothing that was typed.
  if (card.title) return capAsk(card.title)
  // "Do you want to proceed?" alone says nothing the alert does not already.
  if (/^Do you want to proceed\?$/i.test(card.question)) return null
  return capAsk(card.question)
}

/**
 * What makes this prompt THIS prompt. Not the ask alone: two consecutive edits
 * of one file ask the same one-liner, and if the owner answers the first and
 * the second appears before the monitor's next look, the monitor never sees
 * the gap. The card body (the diff, the command) tells them apart, so the
 * second one gets its own clock instead of inheriting the first one's.
 *
 * Only letters and digits count, and only the tail of them. Measured on the
 * first live run (2026-10-12): the owner attached to the pane from a wider
 * terminal to answer, tmux resized the window, the diff re-wrapped (the
 * continuation of a wrapped diff line repeats its +/- marker), and the SAME
 * prompt read as a new question -- one more alert, sent at the very moment
 * the owner was looking at the dialog. Layout must not be part of identity.
 */
export function permissionPromptIdentity(pane: string | null | undefined, deepPane: string | null | undefined = pane): string {
  const card = readPermissionCard(deepPane || pane || '')
  if (!card) return ''
  return card.body.replace(/[^\p{L}\p{N}]/gu, '').slice(-PERMISSION_IDENTITY_MAX)
}

/**
 * The sub-agent type whose tool-permission prompt is on this pane, or null.
 * Only a card whose header was found (title != null) and carries the
 * "· from the <type> agent" suffix is a helper's. A main agent's own card, a
 * header scrolled out of the capture, or a card whose header is not readable
 * all give null: the caller must then leave the prompt alone.
 */
export function permissionPromptHelper(pane: string | null | undefined, deepPane: string | null | undefined = pane): string | null {
  return readPermissionCard(deepPane || pane || '')?.helper ?? null
}

export const DEFAULT_PERMISSION_HELPER_AUTODENY_MIN = 30
const PERMISSION_HELPER_AUTODENY_MAX_MIN = 10080

/** PERMISSION_HELPER_AUTODENY_MIN: whole minutes; empty means the default, 0 means off. */
export function parseHelperAutoDenyMin(raw: string | null | undefined): { minutes: number, valid: boolean } {
  const text = (raw ?? '').trim()
  if (text === '') return { minutes: DEFAULT_PERMISSION_HELPER_AUTODENY_MIN, valid: true }
  if (!/^\d{1,5}$/.test(text)) return { minutes: DEFAULT_PERMISSION_HELPER_AUTODENY_MIN, valid: false }
  const minutes = Number(text)
  if (minutes > PERMISSION_HELPER_AUTODENY_MAX_MIN) return { minutes: DEFAULT_PERMISSION_HELPER_AUTODENY_MIN, valid: false }
  return { minutes, valid: true }
}

export type HelperAutoDenyDecision = 'deny' | 'wait' | 'none'

/**
 * Pure: should the monitor send Escape (NO) to a helper's prompt that has stood
 * for afterMs? Only on the MAIN agent's pane, only for a helper's card, never
 * for an identity already denied once, and never when afterMs is 0 (off).
 * `firstSeenAt` is the reminder clock of this question (the same one the owner
 * marks use), so there is one clock, not two.
 */
export function decideHelperAutoDeny(input: {
  isMainAgent: boolean
  helper: string | null
  firstSeenAt: number
  now: number
  afterMs: number
  alreadyDeniedId: string | null
  id: string
}): HelperAutoDenyDecision {
  if (input.afterMs <= 0) return 'none'
  if (!input.isMainAgent || input.helper == null || input.id === '') return 'none'
  if (input.alreadyDeniedId === input.id) return 'none'
  return input.now - input.firstSeenAt >= input.afterMs ? 'deny' : 'wait'
}

export function formatHelperAutoDenyAlert(label: string, session: string, helper: string, ask: string | null, waitingMs: number): string {
  const asks = ask ? ` Ezt kérdezte: „${ask}”.` : ''
  return `🔐 A(z) ${label} session egy segédügynökének (${helper}) engedélykérése ${humanWaitHu(waitingMs)} vár válaszra, ezért NEM-et nyomtam (Escape).${asks} Ha ez a munkának kellett volna: tmux attach -t ${session}`
}

export interface PermissionReminderState {
  /** Identity of the open question ('' when the pane gave nothing readable). */
  id: string
  /** When the monitor first reported this question to this module. */
  firstSeenAt: number
  /** Marks already announced (0 = nothing sent yet). */
  sent: number
}

export type PermissionReminderDecision =
  | { send: false, next: PermissionReminderState }
  | { send: true, next: PermissionReminderState, waitingMs: number, nextGapMs: number }

/** Age at which message number `n` (1-based) is due. */
export function permissionReminderDueAt(n: number, marks: readonly number[] = DEFAULT_PERMISSION_REMINDER_MARKS_MS): number {
  if (n <= marks.length) return marks[Math.max(n, 1) - 1]
  const last = marks[marks.length - 1]
  return last + (n - marks.length) * last
}

/**
 * Pure decision half: given what is on record for this session and what the
 * pane asks now, should a message go out?
 *
 * A question seen for the first time starts its clock (and, unless the first
 * mark is 0, sends nothing yet). If several marks
 * passed since the last look (the monitor was down, the host slept), ONE
 * message goes out and the skipped marks are counted as sent -- catching up
 * with a burst would be the flood again.
 */
export function decidePermissionReminder(
  prev: PermissionReminderState | undefined,
  id: string,
  now: number,
  marks: readonly number[] = DEFAULT_PERMISSION_REMINDER_MARKS_MS,
): PermissionReminderDecision {
  // New question, or a clock stepped backwards (NTP, suspend): a stored time in
  // the future would hold every mark off indefinitely. Either way, start over.
  const state = !prev || prev.id !== id || now < prev.firstSeenAt ? { id, firstSeenAt: now, sent: 0 } : prev
  const age = now - state.firstSeenAt
  let sent = state.sent
  while (age >= permissionReminderDueAt(sent + 1, marks)) sent++
  if (sent === state.sent) return { send: false, next: state }
  const next = { ...state, sent }
  return { send: true, next, waitingMs: age, nextGapMs: permissionReminderDueAt(sent + 1, marks) - permissionReminderDueAt(sent, marks) }
}

/** "45 perce", "2 órája", "1 óra 30 perce" -- rounded to the minute. */
export function humanWaitHu(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} perce`
  if (m === 0) return `${h} órája`
  return `${h} óra ${m} perce`
}

function humanGapHu(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60000))
  return totalMin % 60 === 0 ? `${totalMin / 60} óra` : `${totalMin} perc`
}

export function formatPermissionPromptAlert(
  label: string,
  session: string,
  ask: string | null,
  waitingMs: number,
  nextGapMs: number,
): string {
  const asks = ask ? ` Ezt kérdezi: „${ask}”` : ''
  const head = `🔐 A(z) ${label} session egy engedélykérésen vár, és NEM nyomtam meg semmit: ott az Escape NEM-et jelentene.${asks} Döntsd el te: tmux attach -t ${session}`
  const waited = waitingMs >= 60000 ? `${humanWaitHu(waitingMs)} vár válaszra. ` : ''
  return `${head}\n\n(${waited}Ha nem kap választ, ${humanGapHu(nextGapMs)} múlva szólok újra.)`
}

const states = new Map<string, PermissionReminderState>()

const configured = parsePermissionAlertMarks(PERMISSION_ALERT_MARKS)
if (!configured.valid) {
  logger.warn({ value: PERMISSION_ALERT_MARKS, using: DEFAULT_PERMISSION_ALERT_MARKS }, 'PERMISSION_ALERT_MARKS is not a list of durations (10m, 1h, 1d...) -- using the default schedule')
}

/** The helper auto-deny delay the monitor passes in (0 = off). */
export const PERMISSION_HELPER_AUTODENY_AFTER_MS = (() => {
  const parsed = parseHelperAutoDenyMin(PERMISSION_HELPER_AUTODENY_MIN)
  if (!parsed.valid) {
    logger.warn({ value: PERMISSION_HELPER_AUTODENY_MIN, using: DEFAULT_PERMISSION_HELPER_AUTODENY_MIN }, 'PERMISSION_HELPER_AUTODENY_MIN is not a whole number of minutes (0 = off) -- using the default')
  }
  return parsed.minutes * 60 * 1000
})()

/** Per session: the identity of the prompt already denied (exactly one Escape per identity). */
const deniedIds = new Map<string, string>()

/**
 * Stateful half for the monitor: returns the text to send, or null when this
 * session's open question has not reached its next mark. `deepPane`
 * is the same pane captured with scrollback (see readPermissionCard).
 */
export function nextPermissionPromptAlert(
  label: string,
  session: string,
  pane: string | null | undefined,
  deepPane: string | null | undefined = pane,
  now: number = Date.now(),
  marks: readonly number[] = configured.marks,
): string | null {
  const ask = permissionPromptAsk(pane, deepPane)
  const decision = decidePermissionReminder(states.get(session), permissionPromptIdentity(pane, deepPane), now, marks)
  states.set(session, decision.next)
  if (!decision.send) return null
  return formatPermissionPromptAlert(label, session, ask, decision.waitingMs, decision.nextGapMs)
}

export interface PermissionPromptPassDeps {
  /** The same pane with scrollback (agent-process capturePaneWithHistory). */
  captureWithHistory: (session: string) => string | null
  /** The owner alert (channel-monitor sendAlert). */
  send: (text: string, meta: AlertMeta) => void
  /**
   * The main agent, told first on a sub-agent's prompt (card 68cb6715): enqueues
   * an inter-agent message, throws when it cannot. Without it (and on the main
   * agent's own pane) only the owner is told, at the marks.
   */
  messageMainAgent?: (text: string) => void
  /** This session is the main agent's own. */
  isMainAgent?: boolean
  /** Who was told about which prompt, per session; dropped with the menu spell. */
  escalation?: Map<string, PermPromptEscalationState>
  /**
   * A helper's prompt on the MAIN agent's pane stood this long: Escape (NO) is
   * sent. 0 or absent = off. PERMISSION_HELPER_AUTODENY_MIN, read by the monitor.
   */
  helperAutoDenyAfterMs?: number
  /** The same pane with scrollback, freshly captured, just before the key. */
  recapture?: (session: string) => string | null
  /** Sends Escape (NO) to the session's pane. */
  sendEscape?: (session: string) => void
}

const ownEscalation = new Map<string, PermPromptEscalationState>()

/**
 * The auto-deny step of the pass. Sends Escape only when the decision is
 * `deny` AND the same question (same identity, still a helper's card) is on the
 * pane at the moment of the key. Returns true when Escape was sent.
 */
function tryHelperAutoDeny(label: string, session: string, pane: string | null | undefined, deep: string | null | undefined, deps: PermissionPromptPassDeps, now: number): boolean {
  const state = states.get(session)
  if (!state) return false
  const helper = permissionPromptHelper(pane, deep)
  const decision = decideHelperAutoDeny({
    isMainAgent: deps.isMainAgent === true,
    helper,
    firstSeenAt: state.firstSeenAt,
    now,
    afterMs: deps.helperAutoDenyAfterMs ?? 0,
    alreadyDeniedId: deniedIds.get(session) ?? null,
    id: state.id,
  })
  if (decision !== 'deny' || helper == null || !deps.recapture || !deps.sendEscape) return false
  const again = deps.recapture(session)
  if (!again || permissionPromptIdentity(again, again) !== state.id || permissionPromptHelper(again, again) !== helper) {
    logger.info({ session, agent: label, helper }, 'helper permission prompt changed before the auto-deny -- nothing sent, the alert continues')
    return false
  }
  try {
    deps.sendEscape(session)
  } catch (err) {
    logger.warn({ err, session, agent: label }, 'helper auto-deny: Escape failed -- the prompt stands, retried on the next alert tick')
    return false
  }
  deniedIds.set(session, state.id)
  const waitingMs = now - state.firstSeenAt
  logger.warn({ session, agent: label, helper, waitingMs }, 'helper permission prompt stood past PERMISSION_HELPER_AUTODENY_MIN -- sent Escape (NO) to the main agent pane')
  deps.send(formatHelperAutoDenyAlert(label, session, helper, permissionPromptAsk(pane, deep), waitingMs), { agent: label, kind: 'permission-prompt' })
  return true
}

/**
 * Everything the menu pass does for a session parked on a permission prompt,
 * apart from the keystrokes it does not send: read the card with scrollback,
 * decide, tell the main agent on a new round, and alert the owner when a mark
 * is reached. Returns who was told on this pass.
 *
 * It lives here rather than inline in channel-monitor.ts so that its behaviour
 * is under test: review of #1907 showed that with the logic at the call site,
 * silencing the alert, alerting on every pass, or reading only the visible
 * pane each left the whole suite green.
 */
export function runPermissionPromptPass(
  label: string,
  session: string,
  pane: string | null | undefined,
  deps: PermissionPromptPassDeps,
  now: number = Date.now(),
  marks: readonly number[] = configured.marks,
): PermPromptAction {
  const deep = deps.captureWithHistory(session) ?? pane
  const ownerText = nextPermissionPromptAlert(label, session, pane, deep, now, marks)
  const ask = permissionPromptAsk(pane, deep)
  const state = states.get(session) as PermissionReminderState
  const age = now - state.firstSeenAt
  // A helper's prompt past its mark is answered NO here, and that answer is the
  // one owner message for it: the owner marks below would describe a prompt
  // that no longer stands ("NEM nyomtam meg semmit"), so they are skipped.
  if (tryHelperAutoDeny(label, session, pane, deep, deps, now)) return 'auto-deny'
  return escalatePermissionPrompt(deps.escalation ?? ownEscalation, {
    session,
    label,
    isMainAgent: deps.isMainAgent === true || deps.messageMainAgent == null,
    ask,
    signature: state.id,
    now,
    ownerText,
    fallbackOwnerText: formatPermissionPromptAlert(label, session, ask, age, permissionReminderDueAt(state.sent + 1, marks) - age),
    ownerAfterMs: marks[0],
  }, {
    messageMainAgent: (text) => { deps.messageMainAgent?.(text) },
    alertOwner: (text, meta) => { deps.send(text, meta) },
  })
}

/** The prompt is gone (answered, or the session left the menu): forget it. */
export function clearPermissionPromptAlert(session: string): void {
  states.delete(session)
  ownEscalation.delete(session)
  deniedIds.delete(session)
}

export function resetPermissionPromptAlerts(): void {
  states.clear()
  ownEscalation.clear()
  deniedIds.clear()
}

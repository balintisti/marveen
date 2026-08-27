// Inbox-nudge watcher: the "engine" behind the main agent's autonomous
// inter-agent (and federated) mail processing.
//
// The main agent's ONLY inbound delivery path is the UserPromptSubmit hook
// (scripts/hooks/inbox-drain.py -> POST /api/agents/<main>/drain-inbox): the
// message router deliberately skips the main agent (PULL model -- a past
// tmux-inject into the perpetually-busy channels session wedged delivery for
// ~1h). Consequence before this watcher: mail addressed to the main agent sat
// pending until a HUMAN happened to prompt it. This watcher closes that gap:
// when the main agent has pending inbox mail AND its channels session is
// GENUINELY idle, it types one tiny static nudge line into the session; the
// submit fires the drain hook, which claims and prepends the wrapped messages.
//
// Why this does NOT reintroduce the old race (adversarially reviewed):
//   - The nudge fires only on double-capture-confirmed idle
//     (isSessionReadyForPrompt) and the send itself ABORTS instead of
//     best-effort-typing when the pane turns busy in the gap
//     (sendPromptToSession onBusyTimeout:'abort') -- zero keystrokes reach a
//     busy pane.
//   - The nudge text is a SINGLE visual row (<=70 chars, unit-tested): the
//     headless channels pane is tmux-default 80 columns (channels.sh
//     new-session has no -x), and MAIN's only parked-plain-text recovery is
//     the stuck-input watcher's bare-Enter branch, which submits single-row
//     text but permanently HOLDS multi-row text (pane-state.ts
//     decideStuckInputAction default branch; clearStaleParkedInput never
//     touches MAIN). Single-row is the only self-recoverable shape.
//   - One nudge consumes the wall-clock-global debounce whether or not it
//     lands; a nudge that provably did not lead to a claim (same oldest id
//     still pending) escalates through a 5-min cooldown, then STOPS after
//     MAX_STALE_NUDGES and alerts the owner ONCE (broken drain hook / wedged
//     session -- infinite paid Claude turns against a broken hook would be
//     worse than the status quo).
//   - A rolling hourly budget caps autonomous turn generation even under a
//     steady message stream; budget exhaustion degrades to today's baseline
//     (the next human/scheduled prompt drains the inbox), never to loss.
//   - The channel plugin remains an independent in-process writer no idle
//     check can exclude; the residual overlap is one short static line whose
//     merged submit still just fires the drain hook (benign).
//
// The predicate is getPendingMessages(MAIN_AGENT_ID) -- to_agent = MAIN
// exactly. Queued OUTBOUND federated rows (to_agent 'peer/agent', pending up
// to the abandon window while a peer is down) never match, so a down peer
// cannot nudge the main agent about mail it cannot act on.
//
// Decision logic is pure (decideNudgePreflight/recordNudge) with a thin IO
// shell, mirroring decideStuckInputRecovery.
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { getPendingMessages } from '../db.js'
import { getEffectiveSettingValue } from '../settings-store.js'
import { MAIN_CHANNELS_SESSION } from './main-agent.js'
import { capturePane, isSessionReadyForPrompt, sendPromptToSession, sessionExistsOnHost } from './agent-process.js'
import { promptAlreadyQueued } from '../pane-state.js'
import { sendAlert } from './channel-monitor.js'

export const INBOX_NUDGE_INITIAL_DELAY_MS = 55_000 // free slot (taken: 5/10/20/25/30/35/40/45/50/90s)
export const INBOX_NUDGE_INTERVAL_MS = 20_000
// A message younger than this is left alone: a concurrently-starting turn (or
// the send that just created it) may claim it in seconds anyway.
export const MIN_PENDING_AGE_MS = 10_000
// Wall-clock-global floor between nudges. Deliberately NOT reset when the
// inbox empties: nudge -> drain empties the inbox on the next tick, so a full
// state reset would let a message stream re-nudge every ~20-30s.
export const NUDGE_DEBOUNCE_MS = 60_000
// Re-nudging the SAME oldest message means the previous nudge did not lead to
// a claim (hook broken, session wedged, prompt lost): slow down hard, and
// after MAX_STALE_NUDGES stop and alert the owner once per spell.
export const STALE_NUDGE_COOLDOWN_MS = 5 * 60_000
export const MAX_STALE_NUDGES = 3
// Rolling hourly cap on autonomous turn generation (each nudge is a paid
// Claude turn). Exhaustion degrades to the baseline drain cadence (next
// human/scheduled prompt), never to message loss.
export const MAX_NUDGES_PER_HOUR = 10
const NUDGE_BUDGET_WINDOW_MS = 60 * 60_000
// Rate limit for the "pending mail is waiting but the session stays busy"
// visibility log -- distinguishes a long busy spell from a dead watcher.
const BUSY_WAIT_LOG_INTERVAL_MS = 10 * 60_000

// Single visual row on the 80-col headless channels pane (see header). Both
// variants MUST stay <= NUDGE_MAX_CHARS (unit-tested). Conditional wording on
// purpose: the drain fires on EVERY main-agent prompt, so a competing prompt
// may have already claimed everything by the time this line submits -- the
// text must not assert that blocks exist above it. Accent-less Hungarian for
// tmux send-keys (channel-monitor precedent); each drained block carries its
// own security preamble, which stays the authoritative framing.
export const NUDGE_MAX_CHARS = 70
export function nudgeText(lang: 'hu' | 'en'): string {
  return lang === 'en'
    ? '[Inbox] If new inbound blocks appear above, process them; else skip.'
    : '[Inbox] Ha fent uj bejovo blokk van, dolgozd fel; ha nincs, hagyd.'
}

// ---------------------------------------------------------------------------
// BUSY BRANCH (card 835384e6)
//
// Until 2026-08-27 there were TWO writers nudging this one pane. This watcher,
// which abstains when the pane is busy, and the message router's main-agent
// wakeup, which did not consult the idle gate at all (`waitForIdle: false`) and
// re-typed `[inbox-wakeup: ...]` every 45s. Measured over 290,5 hours of
// store/dashboard.log: the router fired 5 908 times for 1 286 distinct
// messages, and in 855 of this watcher's 883 busy abstentions (96,8%) the
// router typed anyway within 30s. Every brake in this module was decorative.
//
// The router block is gone. Its ONE genuine job moves here, because nothing
// else does it: reaching a main agent that is mid-turn. The nudge aborts on
// busy, and the */25 memoria-heartbeat carries skipIfBusy:true -- with the
// router removed and no busy branch, a message arriving during a long turn
// would wait for a human.
//
// The defect was never "it types into a busy pane". That is the one thing worth
// doing. The defect was typing AGAIN while the previous copy still sat unread
// in the queue: each copy costs a full turn when the pane finally drains.
// So the busy branch types at most ONE unconsumed line at a time, which makes
// it self-limiting -- one per drain cycle, no budget needed.
//
// FAILURE DIRECTION: SEND. Suppression is bounded by a failsafe and never
// permanent, because MEASURED (nudge-stale-backstop.test.ts) there is no
// guaranteed backstop behind it: once staleNudges hits MAX_STALE_NUDGES on an
// unchanging oldest id, the idle branch stops for good -- the spell clears only
// on an empty inbox, which needs the claim the stop prevented. A false "already
// queued" reading must therefore cost a delay, never silence.
export const BUSY_WAKEUP_DEBOUNCE_MS = 60_000
// How long a suppression may last before we type again regardless. Longer than
// a normal turn, shorter than an abandonment: the observed pathological turn in
// the 2026-08-04 capture was 32 minutes and a genuine queue drains at its end,
// so anything past this is far more likely a misread pane than a live queue.
export const BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS = 15 * 60_000
// Deliberately the SAME text the router used: single visual row (46 chars, well
// under NUDGE_MAX_CHARS), which is the only shape the stuck-input bare-Enter
// branch can recover on the MAIN pane. It is also what queuedPromptLines has to
// match, so the two must not drift apart.
export const BUSY_WAKEUP_TEXT = '[inbox-wakeup: pending inter-agent messages]'

export interface NudgeState {
  lastNudgeAt: number
  lastNudgeOldestId: number | null
  staleNudges: number // nudges sent while the oldest pending id stayed unchanged
  staleAlerted: boolean
  recentNudges: number[] // send timestamps within the rolling budget window
  budgetLogged: boolean
  lastBusyLogAt: number
  absenceLogged: boolean
  // Busy branch. `busySuppressedSince` is 0 when we are not suppressing; while
  // non-zero it dates the suppression so the failsafe can end it.
  lastBusyWakeupAt: number
  busySuppressedSince: number
}

export const INITIAL_NUDGE_STATE: NudgeState = Object.freeze({
  lastNudgeAt: 0,
  lastNudgeOldestId: null,
  staleNudges: 0,
  staleAlerted: false,
  recentNudges: [],
  budgetLogged: false,
  lastBusyLogAt: 0,
  absenceLogged: false,
  lastBusyWakeupAt: 0,
  busySuppressedSince: 0,
})

export type NudgePreflight =
  | { proceed: false; state: NudgeState; staleAlert?: boolean; budgetLog?: boolean }
  | { proceed: true; state: NudgeState }

/** Pure cheap-checks stage: everything decidable from the DB row + clock,
 *  BEFORE any tmux IO. Returns the next state; the shell only touches tmux
 *  when proceed is true. */
export function decideNudgePreflight(
  input: { now: number; oldestId: number | null; oldestAgeMs: number },
  state: NudgeState,
): NudgePreflight {
  const { now, oldestId, oldestAgeMs } = input
  if (oldestId === null) {
    // Inbox empty: end the spell. lastNudgeAt and the budget window survive
    // (global debounce floor); spell-scoped fields reset.
    if (state.lastNudgeOldestId === null && !state.absenceLogged && state.lastBusyLogAt === 0
      && !state.staleAlerted && state.staleNudges === 0) {
      return { proceed: false, state }
    }
    return {
      proceed: false,
      state: { ...state, lastNudgeOldestId: null, staleNudges: 0, staleAlerted: false, lastBusyLogAt: 0, absenceLogged: false },
    }
  }
  if (oldestAgeMs < MIN_PENDING_AGE_MS) return { proceed: false, state }
  if (now - state.lastNudgeAt < NUDGE_DEBOUNCE_MS) return { proceed: false, state }

  // Stale spell: the previous nudge targeted this same oldest message and it
  // is STILL pending -> the drain did not claim it.
  if (state.lastNudgeOldestId === oldestId && state.staleNudges > 0) {
    if (state.staleNudges >= MAX_STALE_NUDGES) {
      if (!state.staleAlerted) {
        return { proceed: false, staleAlert: true, state: { ...state, staleAlerted: true } }
      }
      return { proceed: false, state }
    }
    if (now - state.lastNudgeAt < STALE_NUDGE_COOLDOWN_MS) return { proceed: false, state }
  }

  // Rolling hourly budget.
  const recent = state.recentNudges.filter((t) => now - t < NUDGE_BUDGET_WINDOW_MS)
  if (recent.length >= MAX_NUDGES_PER_HOUR) {
    if (!state.budgetLogged) {
      return { proceed: false, budgetLog: true, state: { ...state, recentNudges: recent, budgetLogged: true } }
    }
    return { proceed: false, state: { ...state, recentNudges: recent } }
  }
  return { proceed: true, state: { ...state, recentNudges: recent, budgetLogged: false } }
}

export type BusyWakeupDecision =
  | { send: false; state: NudgeState; reason: 'no-mail' | 'too-soon' | 'already-queued' }
  | { send: true; state: NudgeState; reason: 'nothing-queued' | 'failsafe' }

/**
 * Should we type a wakeup into a BUSY main pane?
 *
 * `alreadyQueued` comes from queuedPromptLines(capture) -- "is a copy of our
 * line already sitting unread above the input box". That is the whole question
 * the router never asked, and asking it is what turns 4,6 wakeups per message
 * into one per drain cycle.
 *
 * Every branch that returns send:false must be BOUNDED. `already-queued` is the
 * only suppressing branch, and the failsafe caps it: nothing behind this is
 * guaranteed to fire later (see nudge-stale-backstop.test.ts), so a misread
 * pane may delay a message but must never strand it.
 */
export function decideBusyWakeup(
  input: { now: number; oldestId: number | null; oldestAgeMs: number; alreadyQueued: boolean },
  state: NudgeState,
): BusyWakeupDecision {
  const { now, oldestId, oldestAgeMs, alreadyQueued } = input
  if (oldestId === null) {
    // No mail: clear the suppression clock so the next spell starts fresh.
    return { send: false, reason: 'no-mail', state: state.busySuppressedSince === 0 ? state : { ...state, busySuppressedSince: 0 } }
  }
  // Same grace as the idle branch: a message seconds old may be claimed by a
  // turn that is already starting.
  if (oldestAgeMs < MIN_PENDING_AGE_MS) return { send: false, reason: 'too-soon', state }
  if (now - state.lastBusyWakeupAt < BUSY_WAKEUP_DEBOUNCE_MS) return { send: false, reason: 'too-soon', state }

  if (!alreadyQueued) {
    return { send: true, reason: 'nothing-queued', state: { ...state, lastBusyWakeupAt: now, busySuppressedSince: 0 } }
  }
  // A copy is waiting. Suppress -- but start (or check) the clock, because a
  // pane we misread would otherwise suppress forever.
  if (state.busySuppressedSince === 0) {
    return { send: false, reason: 'already-queued', state: { ...state, busySuppressedSince: now } }
  }
  if (now - state.busySuppressedSince >= BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS) {
    return { send: true, reason: 'failsafe', state: { ...state, lastBusyWakeupAt: now, busySuppressedSince: now } }
  }
  return { send: false, reason: 'already-queued', state }
}

/** Pure state advance for a nudge attempt. Called BEFORE the send so a send
 *  that THROWS still consumes the debounce (no 20s-tick retry storm); the
 *  shell restores the previous state only on a clean 'aborted-busy'. */
export function recordNudge(state: NudgeState, now: number, oldestId: number): NudgeState {
  return {
    ...state,
    lastNudgeAt: now,
    staleNudges: state.lastNudgeOldestId === oldestId ? state.staleNudges + 1 : 1,
    staleAlerted: state.lastNudgeOldestId === oldestId ? state.staleAlerted : false,
    lastNudgeOldestId: oldestId,
    recentNudges: [...state.recentNudges.filter((t) => now - t < NUDGE_BUDGET_WINDOW_MS), now],
  }
}

function resolveLang(): 'hu' | 'en' {
  try {
    return getEffectiveSettingValue('DASHBOARD_LANG') === 'en' ? 'en' : 'hu'
  } catch {
    return 'hu'
  }
}

let state: NudgeState = { ...INITIAL_NUDGE_STATE }

/** Test seam. */
export function _resetNudgeStateForTest(): void {
  state = { ...INITIAL_NUDGE_STATE }
}

/** IO shell for the busy branch: read the pane, ask the pure decision, type at
 *  most one unconsumed line. Kept separate so tick() stays readable and the
 *  decision stays testable without tmux. */
async function runBusyWakeup(now: number, pendingCount: number, oldest: { id: number; created_at: number }): Promise<void> {
  // Cannot read the pane -> cannot prove a copy is queued. FAIL OPEN: a null
  // capture counts as nothing-queued, because the failure we must not have is
  // silence (capturePane already swallows the tmux error and returns null).
  const capture = capturePane(MAIN_CHANNELS_SESSION, null)
  if (capture == null) {
    logger.warn({ session: MAIN_CHANNELS_SESSION }, 'inbox wakeup: pane capture failed; assuming nothing queued')
  }
  const alreadyQueued = capture != null && promptAlreadyQueued(capture, BUSY_WAKEUP_TEXT)
  const d = decideBusyWakeup(
    { now, oldestId: oldest.id, oldestAgeMs: now - oldest.created_at * 1000, alreadyQueued },
    state,
  )
  state = d.state
  if (!d.send) return

  const prev = state
  try {
    // waitForIdle:false ON PURPOSE, and it is the only caller entitled to it
    // here: the pane IS busy, and queueing one line for the next turn boundary
    // is precisely the job. What made the old router path wrong was doing this
    // again every 45s; decideBusyWakeup is the brake that was missing.
    const result = await sendPromptToSession(MAIN_CHANNELS_SESSION, BUSY_WAKEUP_TEXT, null, { waitForIdle: false })
    if (result !== 'sent') {
      state = prev
      logger.info({ inboxWakeupSkipped: result, pending: pendingCount }, 'inbox wakeup: nothing typed; will retry')
      return
    }
  } catch (err) {
    state = prev
    logger.warn({ err, pending: pendingCount }, 'inbox wakeup: send threw; nothing typed, state restored')
    return
  }
  logger.info(
    { inboxWakeup: true, pending: pendingCount, oldestId: oldest.id, reason: d.reason },
    d.reason === 'failsafe'
      ? 'inbox wakeup: queued line looked stuck past the failsafe; typed again'
      : 'inbox wakeup: queued one line into the busy main pane',
  )
}

async function tick(): Promise<void> {
  // The whole body is fenced: sendPromptToSession/tmux helpers throw on tmux
  // failure, this is a setInterval callback (fired via a void wrapper), and an
  // escaped throw/rejection would otherwise reach the uncaughtException handler
  // and take the dashboard down.
  try {
    const now = Date.now()
    const pending = getPendingMessages(MAIN_AGENT_ID)
    const oldest = pending[0]
    const pre = decideNudgePreflight(
      { now, oldestId: oldest ? oldest.id : null, oldestAgeMs: oldest ? now - oldest.created_at * 1000 : 0 },
      state,
    )
    state = pre.state
    if (!pre.proceed) {
      if (pre.staleAlert) {
        // WHAT WAS MEASURED, NOT WHY (card 835384e6, 2026-08-27). This alert
        // used to name causes -- "the drain hook is not wired", "install path
        // mismatch", "the session is wedged" -- none of which the watcher can
        // observe. On 2026-08-04 it escalated exactly this way while nothing
        // was broken: the main agent was in a single 32-minute turn and three
        // nudges had simply queued unread. An alert that names a cause it did
        // not measure is worse than a silent one: the operator starts looking
        // in the wrong place. Report the observation and let a human diagnose.
        const staleAgeMin = oldest ? Math.round((now - oldest.created_at * 1000) / 60_000) : null
        logger.warn(
          { inboxNudge: true, oldestId: oldest?.id, staleNudges: MAX_STALE_NUDGES, oldestAgeMin: staleAgeMin },
          'inbox nudge: message still pending after repeated nudges; pausing the idle branch',
        )
        sendAlert(
          `⚠️ A fő-ügynök #${oldest?.id} üzenete ${MAX_STALE_NUDGES} noszogatás után is függőben van` +
          (staleAgeMin != null ? ` (${staleAgeMin} perce érkezett)` : '') + '. ' +
          'Ezt mértem, okot nem: a noszogatás elment, az átvétel nem történt meg. ' +
          'A tétlen-ág szünetel, amíg ez az üzenet függőben van; a foglalt-ág (egy sorba tett ébresztés) tovább fut. ' +
          'Kézi ellenőrzés kell.',
        )
      }
      if (pre.budgetLog) {
        logger.warn({ inboxNudge: true, pending: pending.length, budget: MAX_NUDGES_PER_HOUR }, 'inbox nudge: hourly budget exhausted; falling back to baseline drain cadence')
      }
      // NOT an early return any more. The idle branch is done for this tick,
      // but the BUSY branch must still run: the two brakes that stopped us here
      // (stale spell, hourly budget) are exactly the ones measured to be able
      // to silence delivery permanently, and the busy branch is what remains
      // when the pane is mid-turn. It has its own debounce and its own bound.
    }

    if (!sessionExistsOnHost(null, MAIN_CHANNELS_SESSION)) {
      // Smoke/staging instances (RESPAWN_ENABLED=0, sdk backend) never have a
      // channels session -- log once per absence spell, not per tick.
      if (!state.absenceLogged) {
        logger.info({ inboxNudge: true, session: MAIN_CHANNELS_SESSION, pending: pending.length }, 'inbox nudge: channels session absent; mail waits for the next main-agent turn')
        state = { ...state, absenceLogged: true }
      }
      return
    }
    if (state.absenceLogged) state = { ...state, absenceLogged: false }

    if (!(await isSessionReadyForPrompt(MAIN_CHANNELS_SESSION, null))) {
      // Busy is the NORMAL skip path for the NUDGE (silent); surface a long
      // busy-wait spell at a slow rate so it is distinguishable from a dead
      // watcher.
      if (now - state.lastBusyLogAt > BUSY_WAIT_LOG_INTERVAL_MS) {
        logger.info({ inboxNudgeWaiting: true, pending: pending.length, oldestAgeMs: now - oldest.created_at * 1000 }, 'inbox nudge: pending mail waiting; main session busy')
        state = { ...state, lastBusyLogAt: now }
      }
      await runBusyWakeup(now, pending.length, oldest)
      return
    }
    // Reaching the idle path means nothing of ours can be queued any more.
    if (state.busySuppressedSince !== 0) state = { ...state, busySuppressedSince: 0 }
    if (!pre.proceed) return

    const prev = state
    state = recordNudge(state, now, oldest.id)
    let result: 'sent' | 'aborted-busy' | 'skipped-locked'
    try {
      result = await sendPromptToSession(MAIN_CHANNELS_SESSION, nudgeText(resolveLang()), null, {
        onBusyTimeout: 'abort',
        idleTimeoutMs: 2_000,
      })
    } catch (err) {
      // A tmux throw means NOTHING was typed -- same as aborted-busy. Restore
      // the pre-send state so a transient send failure does NOT inflate the
      // stale-nudge counter and mis-fire the "drain hook broken" owner alert
      // (which would misdirect the operator; the real cause is send-side).
      state = prev
      logger.warn({ err, pending: pending.length }, 'inbox nudge: send threw; nothing typed, state restored')
      return
    }
    if (result === 'aborted-busy' || result === 'skipped-locked') {
      // Nothing was typed: either the pane turned busy in the check->send gap
      // (aborted-busy), or a delivery held the per-pane lock (skipped-locked --
      // this is a deliver-mode call so it fails open rather than skipping, but
      // handle it for completeness). Undo the debounce so the cadence retries.
      state = prev
      logger.info({ inboxNudgeSkipped: result, pending: pending.length }, 'inbox nudge: nothing typed before send; skipped')
      return
    }
    logger.info(
      { inboxNudge: true, pending: pending.length, oldestId: oldest.id, nudgesInLastHour: state.recentNudges.length },
      'inbox nudge: prompted the main agent to drain its inbox',
    )
  } catch (err) {
    logger.warn({ err }, 'inbox nudge: tick error')
  }
}

export function startInboxNudgeWatcher(): NodeJS.Timeout {
  setTimeout(() => { void tick() }, INBOX_NUDGE_INITIAL_DELAY_MS).unref()
  return setInterval(() => { void tick() }, INBOX_NUDGE_INTERVAL_MS)
}

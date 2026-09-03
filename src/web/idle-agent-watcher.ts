import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { listAgentNames, agentDir, readAgentRemoteHost, readAgentProjects } from './agent-config.js'
import { isAgentRunning, capturePane } from './agent-process.js'
import { resolveAgentSession } from './channel-mcp-reconnect.js'
import { sendAlert } from './channel-monitor.js'
import { busyEvidence, detectPaneState } from '../pane-state.js'
import { getPendingMessages, listKanbanCards, getLabelsForAllCards, getDb, createAgentMessage, saveIdleGuardState, loadIdleGuardState } from '../db.js'
import {
  decideIdleAlert,
  parseWorkCheck,
  selectDeclaredWork,
  buildNoWorkNotice,
  orphanPullList,
  laneFilteredPullList,
  topOfPullList,
  buildPullNotice,
  stalePendingBySender,
  buildPendingStillWaitingNotice,
  type PendingRow,
  buildWakeMessage,
  buildFleetAlert,
  type FleetAlert,
  NO_IDLE_STATE,
  type IdleAgentState,
  type IdleAgentThresholds,
  type WorkCheck,
} from '../idle-agent.js'

// The guard for the agent that HAS work and is not doing it.
//
// Every other watcher in this directory hunts the STUCK agent, and
// stuck-input-watcher explicitly skips a pane sitting at an idle prompt (that is the
// healthy shape for its purposes). Correct for them, and it left a real hole: on
// 2026-08-20 one agent stood for 126 minutes and later the same day for another 65,
// with a perfectly healthy pane and 66 cards waiting. Nothing looked wrong anywhere,
// because nothing was wrong -- it just was not working.
//
// The decision logic lives in ../idle-agent.ts and is unit-tested without tmux or a
// database; this module is only I/O and the per-agent state map, mirroring
// stuck-input-watcher.ts.
//
// The declaration file is agents/<name>/workcheck.json, e.g. {"kind":"none"} for an
// agent with no queue in this system. See idle-agent.ts for why an absent file is
// reported as a config gap rather than quietly treated as either answer.

const THRESHOLDS: IdleAgentThresholds = {
  // Long enough that the gap between two turns, a compaction, or a slow tool call
  // never trips it; short enough that a stalled hour cannot pass unnoticed.
  sustainedMs: 12 * 60_000,
  // A genuinely parked agent is worth one reminder every half hour, not every tick.
  realertMs: 30 * 60_000,
  // The router injects into an IDLE pane almost immediately, so a wake that is going to
  // work has worked long before this. What this window really buys is the difference
  // between "not yet" and "did not take" -- and only the second is worth a human.
  wakeGraceMs: 15 * 60_000,
  // Floor between two wakes of the same agent. An agent finishing short turns ends a
  // spell every time it goes busy, so without this the wake would follow every turn.
  wakeCooldownMs: 30 * 60_000,
  // A repeated identical list is not news -- but after four hours, "nobody has touched
  // this" is. Without this the suppression is permanent on a stable queue.
  wakeStaleRearmMs: 4 * 60 * 60_000,
}

const INITIAL_DELAY_MS = 90_000
const INTERVAL_MS = 3 * 60_000

// HOW OLD A STORED `idleSinceMs` MAY BE AND STILL BE BELIEVED (card 60060415).
// Two ticks. A restart takes seconds, so the row is fresh and the 12-minute
// sustained window CONTINUES across it -- which is the whole point. An hour of
// downtime leaves a stale row, and then the agent starts a fresh window rather
// than inheriting an idle span nobody observed.
// The suppressors (`lastAlertAt`, `lastWakeAt`) are NOT age-limited: they can
// only delay an alert, never cause one. See loadIdleGuardState.
const MAX_IDLE_AGE_MS = 2 * INTERVAL_MS

// In-process cache only. The truth lives in the database (card 60060415): this
// Map used to BE the state, so every deploy erased it -- and two of that day's
// watcher processes lived 8m12s and 2m28s, both under `sustainedMs`. A guard
// that cannot fire during a deploy sequence, and says nothing about it.
const watchState = new Map<string, IdleAgentState>()

// Message ids the sender has already been told about (card 979283a9). A message
// still stuck an hour later must not produce a second notice every sweep -- the
// guard would be loudest exactly when it is least useful. In memory on purpose:
// the worst a restart costs is one repeated notice, and a table for it would be
// state to maintain for a message that is by then already delivered.
const pendingNoticed = new Set<number>()

/** The sender-side queue sweep. Separated so the tick stays readable and this can
 *  be exercised on its own. */
function sweepStalePending(): void {
  const rows = getDb()
    .prepare("SELECT id, from_agent, to_agent, created_at FROM agent_messages WHERE status = 'pending'")
    .all() as PendingRow[]
  // Forget ids that are no longer pending, so the set cannot grow without bound
  // and a message that queues again later is reported again.
  const live = new Set(rows.map((r) => r.id))
  for (const id of pendingNoticed) if (!live.has(id)) pendingNoticed.delete(id)

  const now = Date.now()
  for (const [sender, msgs] of stalePendingBySender(rows, now, pendingNoticed)) {
    // 'system' is not an agent anyone can read a notice as; skip it rather than
    // send into a void.
    if (sender === 'system') continue
    try {
      createAgentMessage('system', sender, buildPendingStillWaitingNotice(sender, msgs, now))
      for (const m of msgs) pendingNoticed.add(m.id)
      logger.info({ idleGuard: true, sender, count: msgs.length }, 'message queue: told the SENDER their message is still pending')
    } catch (err) {
      logger.warn({ err, sender }, 'message queue: could not tell the sender about a stale pending message')
    }
  }
}

function readWorkCheckRaw(agent: string): string | null {
  try {
    return readFileSync(join(agentDir(agent), 'workcheck.json'), 'utf8')
  } catch {
    return null
  }
}

/** card id -> (author -> the time of that author's LATEST comment on the card).
 *
 *  The timestamp is the point: a reviewer's queue asks whether their review still
 *  covers the card's current state, not whether one ever happened. Without the time
 *  the first comment retires a card forever -- and the guard then falls silent exactly
 *  when the reviewer has caught up. */
function lastCommentAtByCard(): Map<string, Map<string, number>> {
  const rows = getDb()
    .prepare('SELECT card_id, author, MAX(created_at) AS at FROM kanban_comments GROUP BY card_id, author')
    .all() as { card_id: string; author: string; at: number }[]
  const map = new Map<string, Map<string, number>>()
  for (const row of rows) {
    let inner = map.get(row.card_id)
    if (!inner) {
      inner = new Map()
      map.set(row.card_id, inner)
    }
    inner.set(row.author, row.at)
  }
  return map
}

/** null = could not tell (no session, capture failed, unknown pane). NOT the same as
 *  "busy". Folding an unreadable pane into "busy" silently switches the guard off for
 *  that agent -- a failure that looks exactly like health, which is the one shape this
 *  whole guard exists to avoid. Didi spotted it on my own code; the rule "not measured
 *  is not passing" applies here too, and here it means: say so, do not assume. */
// EXPORTALVA A BEKOTES MERHETOSEGEERT (kartya b5bff340, didi merese 2026-08-27).
// A ket VEG kulon-kulon vedve volt -- a `busyEvidence` a pane-state.test.ts-ben, a
// dontesi oldal az idle-agent.test.ts-ben, KEZZEL adott `staleCounterOnly: true`-val --,
// a KOZTUK LEVO BEKOTES viszont sehol. Merve: a `staleCounterOnly` szamitasat elvagva
// mind a 3803 teszt ZOLD maradt.
// Ez nem viselkedes-valtozas: csak lathatova teszi a fuggvenyt a tesztnek.
export function readPane(agent: string): { idle: boolean | null; staleCounterOnly: boolean } {
  const session = resolveAgentSession(agent)
  if (!session) return { idle: null, staleCounterOnly: false }
  const pane = capturePane(session, readAgentRemoteHost(agent))
  if (!pane) return { idle: null, staleCounterOnly: false }
  const state = detectPaneState(pane)
  if (state === 'unknown') return { idle: null, staleCounterOnly: false }
  return { idle: state === 'idle', staleCounterOnly: busyEvidence(pane) === 'counter' }
}

// EXPORTALVA A NAPLOZAS MERHETOSEGEERT (kartya 60060415). A `readPane`-nel ugyanez a
// dontes all: a kartya allitasa az, hogy MINDEN dontes naplozodik -- ezt csak ugy lehet
// megmerni, ha a kort le lehet futtatni. Viselkedes nem mozdul, csak lathatosag.
export function tick(): void {
  try {
    const agents = listAgentNames()
    if (agents.length === 0) return

    // The sender-side queue check rides this same 3-minute tick: it asks about
    // MESSAGES, not agents, so it runs once and not per agent (card 979283a9).
    sweepStalePending()

    // Loaded once per tick, not once per agent: the board is the same for everyone,
    // and re-reading it per agent turned a cheap tick into N table scans.
    // LABELS ARE A SEPARATE TABLE, and leaving them out is a SILENT failure rather than a
    // missing feature: every label test then reads `undefined` and answers "no", so the
    // owner-decision list is always empty and EVERY testing card looks untriaged.
    // `listKanbanCards()` alone is `SELECT * FROM kanban_cards`, and that table has no
    // labels column -- the kanban route does this same join. Measured by jarvis
    // 2026-08-24, on code already written and tested: the functions were right and
    // NOTHING reached them.
    const labelsByCard = getLabelsForAllCards()
    const cards = listKanbanCards().map((c) => ({ ...c, labels: labelsByCard.get(c.id) ?? [] }))
    const comments = lastCommentAtByCard()
    const now = Date.now()

    // Alerts are COLLECTED here and sent once at the end of the sweep. Sending inside
    // the loop turned one situation ("the fleet is standing") into one Telegram message
    // per agent -- eight of them between 04:58 and 05:28 on 2026-08-22, while the owner
    // slept. Per-agent rate limiting cannot fix that: the limit is per agent, so more
    // agents means more copies of the same news.
    const alerts: FleetAlert[] = []

    for (const agent of agents) {
      const running = isAgentRunning(agent)
      const check = parseWorkCheck(readWorkCheckRaw(agent))
      // MAIN_AGENT_ID is passed so the coordinator's own comments are not mistaken for
      // a reviewer's unanswered finding -- see selectDeclaredWork for the measurement.
      // nowSec: the due_date column is in epoch SECONDS while this loop's `now` is in
      // milliseconds. Passing the wrong unit would make every future date look long past
      // (or never reached) -- silently, since the filter would simply never fire.
      const nowSec = Math.floor(now / 1000)
      // ONE selection, then the count AND the ids come out of it. Two calls are two
      // chances to disagree, and the repeat-suppression compares ids against what the
      // last wake NAMED -- a count from a different list could suppress a wake for work
      // the agent was never shown.
      const ownItems = check ? selectDeclaredWork(check, agent, cards, comments, MAIN_AGENT_ID, nowSec) : null
      const ownWorkCount = ownItems ? ownItems.length : null

      // One capture per agent per tick: the evidence strength comes from the same read
      // as the idle verdict, so the two can never disagree about what was on screen.
      const paneRead = running
        ? readPane(agent)
        : { idle: false as boolean | null, staleCounterOnly: false }

      // Memory first, then the database: after a restart the Map is empty and the
      // row carries what this agent was doing before we deployed.
      let state = watchState.get(agent)
      if (!state) {
        const stored = loadIdleGuardState(agent, MAX_IDLE_AGE_MS, now)
        if (stored?.staleIdleDropped) {
          // A DISCARDED idle span leaves a line, or the next verdict lies by
          // omission: `not-sustained` on a fresh window looks identical whether
          // the agent just went idle or whether we threw away an hour of it.
          logger.debug(
            { idleGuard: true, agent, storedAgeMs: now - stored.updatedAt, maxIdleAgeMs: MAX_IDLE_AGE_MS },
            `idle guard: ${agent} -> stored idle span discarded as stale, window restarts`,
          )
        }
        state = stored
          ? { idleSinceMs: stored.idleSinceMs, lastAlertAt: stored.lastAlertAt, lastWakeAt: stored.lastWakeAt }
          : NO_IDLE_STATE
      }
      const { decision, next } = decideIdleAlert(
        {
          agent,
          running,
          // Only pay for the tmux capture when the cheap checks have not already
          // settled it -- a running fleet ticks this every three minutes.
          paneIdle: running ? paneRead.idle : false,
          staleCounterOnly: running ? paneRead.staleCounterOnly : false,
          pendingMessages: running ? getPendingMessages(agent).length : 0,
          ownWorkCount,
          // Without this the repeat-suppression never fires -- it is skipped whenever the
          // ids are absent, deliberately, because "unchanged" must be measured.
          ownWorkIds: ownItems ? ownItems.map((c) => c.id) : undefined,
          workCheckKind: (check as WorkCheck | null)?.kind ?? null,
        },
        state,
        THRESHOLDS,
        now,
      )
      watchState.set(agent, next)
      try {
        saveIdleGuardState(agent, next, now)
      } catch (err) {
        // Never fatal to the sweep: a guard that stops guarding because it could
        // not write a row would trade a diagnosability problem for a real one.
        logger.warn({ err, agent }, 'idle guard: could not persist state')
      }

      // EVERY DECISION IS LOGGED, INCLUDING THE EIGHT THAT DO NOTHING (card 60060415).
      //
      // This line is unconditional and stands BEFORE the branches on purpose. The
      // eight "nothing to do" reasons used to fall off the `continue` below with no
      // output at all, and that is what made last night undiagnosable: the guard sent
      // 10-12 messages about ONE agent while three others stood five hours, and
      // nothing recorded whether their chain reached a verdict or stopped earlier.
      //
      // WHY IT SPREADS `decision` INSTEAD OF NAMING REASONS: a reason added later is
      // logged without anyone remembering to come back here. A list would have to be
      // maintained, and the failure mode of a stale list is exactly this silence.
      //
      // WHY `debug` AND NOT `info` (marveen's number, and it is the argument that
      // belongs beside every "let us log everything"): six agents every three minutes
      // is 120 lines an hour. At info that buries the real signals.
      logger.debug(
        {
          idleGuard: true,
          agent,
          ...decision,
          idleForMs: next.idleSinceMs !== null ? now - next.idleSinceMs : null,
          sinceLastWakeMs: state.lastWakeAt !== null ? now - state.lastWakeAt : null,
          sinceLastAlertMs: state.lastAlertAt !== null ? now - state.lastAlertAt : null,
          pendingMessages: running ? getPendingMessages(agent).length : 0,
          ownWorkCount,
        },
        `idle guard: ${agent} -> ${decision.reason}`,
      )

      if (!decision.alert) continue

      if (decision.reason === 'pane-unreadable') {
        alerts.push({ kind: 'pane-unreadable', agent })
        logger.warn({ idleGuard: true, agent }, 'idle guard: pane unreadable, guard blind for this agent')
        continue
      }

      if (decision.reason === 'no-work-check-declared') {
        alerts.push({ kind: 'no-work-check', agent })
        logger.warn({ idleGuard: true, agent }, 'idle guard: agent has no declared work check')
        continue
      }

      if (decision.reason === 'idle-no-work') {
        const minutes = Math.round(decision.idleForMs / 60_000)
        // The board may hold work nobody owns. Before telling the coordinator to
        // push a card, look at the pull-list the rulebook points the agent at --
        // and if it has something, tell the AGENT instead (card 4cbc8af9).
        // Lane filter (card e4a1ff49): the offer is the one moment an idle agent gets work
        // without asking, and a pool the agent will never pick from wastes it. An agent that
        // declares no lane is filtered by NOTHING -- see laneFilteredPullList; that default
        // is deliberate and must not be tightened.
        const pull = topOfPullList(
          laneFilteredPullList(orphanPullList(cards, Date.now()), readAgentProjects(agent)),
        )
        // LOGGED ON EVALUATION, NOT ONLY ON FIRING (marveen, card 4cbc8af9). Zero orphans is
        // the EXPECTED case, so silence here used to mean two different things -- "evaluated,
        // found none" and "this code was never deployed" -- and the old build logged the
        // coordinator line either way, byte-identical. That is the indistinguishability that
        // made the behavioural half of the closing condition unfalsifiable rather than merely
        // unmeasured.
        //
        // The PAIRING is what makes deployment readable: the new build always emits this line
        // before the branch, so a 'told the coordinator' line with no 'evaluated' line above it
        // is the old code. And K/J falls out of one field -- K = lines with orphanCount,
        // J = lines with orphanCount > 0.
        //
        // APPLY THE PAIRING ONLY TO LINES AFTER THE BUILD -- didi measured why (card 4cbc8af9,
        // comment 8), and without this the rule gives the WRONG answer on its first use. When
        // this shipped, the running log already held 100 'told the coordinator' lines and ZERO
        // 'evaluated' lines, all from the previous build. Applied to the whole log the rule finds
        // a hundred unpaired lines and reads them as "the build never landed" -- exactly
        // backwards, and most convincing right after a successful deploy.
        //
        //   ANCHOR ON THE PID, NOT ON THE CLOCK. Every line carries the process id
        //     (`[06:31:22.123] INFO (2413): ...`) and it changes on every restart, so it cannot
        //     be broken by midnight, a timezone, or a missing date.
        //   THREE STRINGS ON THIS PATH, NOT TWO -- didi, card comment 13. The rule as I first
        //     wrote it named only 'evaluated' and 'told the coordinator', and MISSED the one
        //     that matters most: when ownerless cards DO exist this logs 'named the ownerless
        //     pull-list' and `continue`s, so 'told the coordinator' below is unreachable
        //     (control flow, not inference -- the `continue` is right there). A reader checking
        //     only the two original strings after a SUCCESSFUL fire sees zero 'told' lines and
        //     concludes "not measurable yet" while the fix has in fact fired. The most
        //     informative outcome was the one the rule could not see, and it fails toward
        //     "it never ran" -- the discouraging direction, which nobody double-checks.
        //
        //     'named' present ............ the fix RUNS and FIRED -- the strongest evidence
        //     'evaluated' + 'told' ....... the fix runs, there were no ownerless cards
        //     'told' with no 'evaluated' . the OLD build
        //   with no line of either kind from that pid yet, the honest answer is NOT MEASURABLE
        //     YET. A third state, not a failure. (Control: count ALL lines from that pid first
        //     -- a zero there means the anchor is wrong, not that the guard is silent.)
        //   AND A SECOND CONTROL THAT SEPARATES THE TWO SILENCES: look for ANY 'idle guard' line
        //     from that pid. One from a different path -- a wake, say -- proves the guard is
        //     RUNNING under this build, so a missing 'evaluated' means the branch was not
        //     reached. Without it, "the branch did not run" and "the guard is dead" are the same
        //     zero. Measured 06:41 on pid 2413: 128 lines, 1 idle-guard line (a stage-1 wake at
        //     06:38:01), 0 told-the-coordinator, 0 evaluated -- alive, branch not reached.
        //     COUNT ENTRIES, NOT LINES: didi and I published 250 and 128 for the same thing at
        //     the same moment. Neither meter was wrong -- a stateful matcher counts LINES
        //     (676, of which 467 are continuation lines carrying no pid), a literal one counts
        //     ENTRIES (209). Ratio ~3.2x. Harmless for a non-zero control, and off by 3x for
        //     anything else: a number needs its UNIT, not just its command.
        //
        // THE TIMESTAMP ANCHOR THIS COMMENT FIRST PRESCRIBED DOES NOT WORK ON THIS LOG, and the
        // version of it I committed was worse than useless (didi measured both, card 4cbc8af9):
        //   - the lines carry NO DATE, only a time -- `grep -cE '^\[[0-9]{4}-'` is 0 -- so in a
        //     9 MB log spanning days, today's [03:07:18] and Tuesday's are indistinguishable.
        //     A time-only prefix structurally cannot express "after the build".
        //   - and I asserted the clock was UTC. It is LOCAL: last line [06:41:02] against local
        //     06:41:14. I had inferred UTC from a single old timestamp that looked too old to be
        //     recent -- a story fitted to one point, written down as a fact. A reader converting
        //     UTC to local would shift the anchor two hours EARLIER and count pre-build lines as
        //     post-build: exactly the backwards answer the anchor exists to prevent.
        // Both of our first attempts at the anchored read failed the same way and in opposite
        // directions -- a timestamp pattern that matched nothing put every line on one side
        // (mine: all "after", a confident 100) or the other (didi's: all "before", a confident
        // 0, agreeing with what we expected, which is the more dangerous half).
        logger.info(
          { idleGuard: true, agent, orphanCount: pull.length },
          'idle guard: evaluated the ownerless pull-list',
        )
        if (pull.length > 0) {
          try {
            createAgentMessage('system', agent, buildPullNotice(agent, minutes, pull))
            logger.info(
              { idleGuard: true, agent, orphanCount: pull.length, top: pull[0]?.id },
              'idle guard: agent idle with nothing assigned -- named the ownerless pull-list',
            )
          } catch (err) {
            logger.warn({ err, agent }, 'idle guard: could not name the pull-list to the agent')
          }
          continue
        }
        try {
          createAgentMessage('system', MAIN_AGENT_ID, buildNoWorkNotice(agent, minutes))
          logger.info(
            { idleGuard: true, agent, idleForMs: decision.idleForMs },
            'idle guard: agent idle with nothing assigned -- told the coordinator',
          )
        } catch (err) {
          logger.warn({ err, agent }, 'idle guard: could not tell the coordinator about an unassigned idle agent')
        }
        continue
      }

      if (decision.reason === 'wake-agent') {
        const items = ownItems ?? []
        const minutes = Math.round(decision.idleForMs / 60_000)
        try {
          createAgentMessage('system', agent, buildWakeMessage(agent, minutes, decision.workCount, items, (check as WorkCheck).kind))
          logger.info(
            { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
            'idle guard: woke the agent (stage 1) -- no human told yet',
          )
        } catch (err) {
          // A failed enqueue must not look like a successful wake: stage 2 would then
          // wait out its grace window for a message that was never sent.
          logger.warn({ err, agent }, 'idle guard: could not enqueue the wake message')
          alerts.push({
            kind: 'wake-enqueue-failed',
            agent,
            minutes,
            workCount: decision.workCount,
          })
        }
        continue
      }

      const minutes = Math.round(decision.idleForMs / 60_000)
      alerts.push({ kind: 'still-idle', agent, minutes, workCount: decision.workCount })
      logger.warn(
        { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
        'idle guard: agent still idle AFTER a wake (stage 2) -- human alerted',
      )
    }

    // One message for the whole sweep, or none at all -- but SPLIT BY AUDIENCE.
    //
    // Only 'still-idle' is a fleet event the OWNER can act on: an agent got a wake and did not
    // move. The other three are the guard reporting on ITSELF -- a pane it could not read (it is
    // BLIND, which says nothing about the agent), a missing work-check (a config gap), and a wake
    // it could not enqueue (a delivery failure). All three are the coordinator's to fix.
    //
    // Measured 2026-09-03: of four alerts that reached the owner's phone, THREE were
    // 'pane-unreadable' -- and all three panes read fine when checked seconds later. The one true
    // row arrived buried among the guard's own instrument failures. Nothing is silenced here:
    // every kind is still reported, to whoever can act on it.
    const ownerFacing = alerts.filter((a) => a.kind === 'still-idle')
    const coordinatorFacing = alerts.filter((a) => a.kind !== 'still-idle')

    if (ownerFacing.length > 0) sendAlert(buildFleetAlert(ownerFacing))
    if (coordinatorFacing.length > 0) {
      try {
        createAgentMessage('system', MAIN_AGENT_ID, buildFleetAlert(coordinatorFacing))
      } catch (err) {
        // A coordinator alert that cannot be enqueued must not vanish. Falling back to the owner
        // is noisier than the old behaviour for one tick, and that is the correct trade: a
        // silently dropped guard-failure is the exact shape this routing change exists to remove.
        logger.warn({ err }, 'idle guard: could not tell the coordinator -- falling back to the owner')
        sendAlert(buildFleetAlert(coordinatorFacing))
      }
    }
  } catch (err) {
    logger.warn({ err }, 'idle guard: tick error')
  }
}

export function startIdleAgentWatcher(): NodeJS.Timeout {
  setTimeout(() => { tick() }, INITIAL_DELAY_MS).unref()
  return setInterval(() => { tick() }, INTERVAL_MS)
}


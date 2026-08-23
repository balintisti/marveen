import type { RecipientQueueState } from '../db.js'
import type { AgentRunState } from './ssh-tmux.js'

/**
 * WHAT THE QUEUE NUMBER MEANS DEPENDS ON WHETHER THE RECIPIENT IS THERE.
 *
 * Card bbb8557c. `queueDepth` alone is AMBIGUOUS, and the two readings call
 * for opposite actions:
 *
 *   the recipient is RUNNING  -> those messages are a backlog. It drains at the
 *                                rate their turns end. Wait, and put the next
 *                                thing on the card instead of sending it.
 *   the recipient is STOPPED  -> those messages are not a backlog at all. None
 *                                of them will be delivered, and the router
 *                                abandons each one when it has been pending for
 *                                the retry window. Sending more is pointless;
 *                                the work needs another route entirely.
 *
 * A sender shown only "queue=4" reads the first meaning, because that is what a
 * queue normally means. The second is the one that costs a night.
 *
 * MEASURED, NOT INFERRED FROM AGE. The tempting shortcut is "older than N hours
 * = dead", and it is wrong: it is an arbitrary threshold that throws away live
 * messages on a slow day, exactly when the queue matters most. The question is
 * whether the tmux session the message is addressed to EXISTS, and that is
 * answerable directly.
 *
 * AND `unreachable` IS A THIRD ANSWER, NOT A SYNONYM FOR STOPPED. It means the
 * host could not be asked (ssh down, laptop asleep), so we do not know whether
 * the agent is there. Reporting that as "stopped" would state a fact we do not
 * have, and the sender would abandon a route that may be perfectly alive. It
 * says "could not tell", which is the true answer.
 */

/** How many pending messages make a live recipient's queue worth mentioning. */
export const QUEUE_ADVICE_THRESHOLD = 3

export interface RecipientAdvice {
  /** Whether the recipient's session exists right now. */
  presence: AgentRunState
  /**
   * One or two lines for the sender, or null when there is nothing worth
   * saying. Written HERE and not in the shell helper so the wording and the
   * threshold live in one place: the same rule stated twice drifts, and the
   * copy nobody edits is the one that ends up lying.
   */
  advice: string | null
}

/**
 * @param abandonWindowMin The router's retry window, in minutes -- how long a
 *   message to an absent session waits before it is abandoned. Passed in
 *   rather than imported so this stays a pure function of its inputs, and so
 *   the caller cannot quietly disagree with the router about the number.
 */
export function adviseSender(
  queue: RecipientQueueState,
  presence: AgentRunState,
  abandonWindowMin: number,
): RecipientAdvice {
  if (presence === 'stopped') {
    const waiting = queue.queueDepth === 1
      ? 'Ez az üzenet'
      : `Ez az üzenet és a másik ${queue.queueDepth - 1} a sorában`
    return {
      presence,
      advice:
        `FIGYELEM: a címzett nem fut (nincs tmux session). ${waiting} NEM lesz kézbesítve: ` +
        `a router ${abandonWindowMin} perc után lezárja őket. A sorszám itt NEM torlódás.\n` +
        '  Ne küldj továbbit -- írd a kártyára, vagy kérd a címzett elindítását.',
    }
  }

  if (presence === 'unreachable') {
    return {
      presence,
      advice:
        'FIGYELEM: a címzett gépét nem sikerült megkérdezni, ezért NEM tudni, fut-e. ' +
        'A sorszám ilyenkor nem mond semmit arról, hogy az üzenet megérkezik-e.\n' +
        '  Ha számít, ellenőrizd külön, mielőtt továbbit küldesz.',
    }
  }

  if (queue.queueDepth >= QUEUE_ADVICE_THRESHOLD) {
    const delay = queue.estimatedDelaySec === null
      ? ''
      : `, a mérés szerint ~${Math.max(1, Math.round(queue.estimatedDelaySec / 60))} perc a késés`
    return {
      presence,
      advice:
        `FIGYELEM: ${queue.queueDepth} üzenet vár a címzett sorában${delay}.\n` +
        '  A következőt NE üzenetben küldd -- írd a kártyára kommentként. Az üzenet tol, a kártya húzat.',
    }
  }

  return { presence, advice: null }
}

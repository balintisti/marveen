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
/**
 * PULL-modellel kiszolgalt cimzett-e. Ma egyedul a fougynok ilyen.
 *
 * MIERT KULON, EXPORTALT FUGGVENY (didi lelete, 2026-08-23). A feltetel elobb
 * inline allt a hivoban (`storedTo === MAIN_AGENT_ID`), es a bekotes-tesztje a
 * MAIN_AGENT_ID TOKEN jelenletet rogzitette -- nem az osszehasonlitas IRANYAT.
 * Didi megmerte: `===` -> `!==` cserevel MIND A 18 TESZT ZOLD MARADT.
 * Elesben ez a legrosszabb inverzio: minden SUB-agens elvesziti a valodi
 * "nem fut" figyelmeztetest, a fougynok pedig visszakapja a hamisat -- vagyis
 * a javitas pontosan az ellenkezojere fordul, csendben.
 *
 * Fuggvenykent az IRANY viselkedessel merheto, nem szoveggel.
 */
export function isPullModelRecipient(recipient: string, mainAgentId: string): boolean {
  return recipient === mainAgentId
}

export function adviseSender(
  queue: RecipientQueueState,
  presence: AgentRunState,
  abandonWindowMin: number,
  /**
   * A cimzettet PULL-modell szolgalja ki: nem a router injektal a paneljebe,
   * hanem o maga uriti a postaladajat minden fordulo elejen. Ma egyedul a
   * fougynok ilyen.
   *
   * MIERT KELL EZ A PARAMETER (mert defektus, 2026-08-23). Az `agentRunState()`
   * az `agent-<nev>` sessiont keresi, a fougynok viszont `<nev>-channels`-ben
   * fut -- ezt a `message-router.ts:515` sajat kommentje mondja ki. A jelenlet
   * tehat a fougynokre MINDIG 'stopped'-nak latszik, es a tanacs azt allitotta,
   * hogy az uzenet NEM lesz kezbesitve. Merve: a `marveen-channels` session
   * letezett es futott, mikozben a figyelmeztetes tuzelt.
   * ES A MASODIK OK, ami akkor is allna, ha a nevfeloldas jo lenne: a fougynok
   * fele a `pending` NEM torlodas es nem elveszes -- a kovetkezo fordulojaban
   * o maga veszi at. A "nem lesz kezbesitve" mondat itt szerkezetileg hamis.
   *
   * A hiba iranya a legrosszabb, amit egy ilyen tanacs felvehet: eppen a
   * KOORDINATORNAK szolo jelentesrol beszeli le a kuldot.
   */
  pullModel = false,
): RecipientAdvice {
  if (presence === 'stopped' && !pullModel) {
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

  if (presence === 'unreachable' && !pullModel) {
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

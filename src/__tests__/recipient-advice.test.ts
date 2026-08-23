/**
 * THE SAME NUMBER, TWO OPPOSITE MEANINGS -- card bbb8557c.
 *
 * `queue=4` behind a RUNNING agent is a backlog: wait, and put the next thing
 * on the card. `queue=4` behind a STOPPED one is not a backlog at all -- none
 * of those four will ever be delivered, the router abandons each after the
 * retry window, and sending more is pointless. The sender's next move is the
 * opposite in the two cases, and until now they were shown the same digit.
 *
 * The measurement this replaces was ALSO wrong, and that is worth recording so
 * nobody re-derives it: the reported finding was that messages to a dead
 * session stay `pending` FOREVER and inflate the depth with corpses. Measured
 * against the live database, the nine example rows were all `failed`
 * ("Abandoned: target session absent for full retry window") a day earlier, and
 * `getRecipientQueueState` counts `status = 'pending'` only, so a closed row
 * cannot inflate anything. The real defect is smaller and sharper: for the hour
 * before they are abandoned those messages DO count, and the number says
 * nothing about which of the two situations the sender is in.
 */
import { describe, it, expect } from 'vitest'
import { adviseSender, QUEUE_ADVICE_THRESHOLD } from '../web/recipient-advice.js'
import type { RecipientQueueState } from '../db.js'

// A HELPER TELJES, ES EZ NEM FORMASAG (friday, a koteg-feloldasnal 2026-08-23).
// A `RecipientQueueState` kozben negy KOTELEZO mezot kapott (pendingChars,
// recentChars, recentSenders, recentWindowMin -- kartya 0e3959e4). A kezenfekvo
// javitas az lett volna, hogy a tipusban opcionalissa tesszuk oket, hogy ez a
// helper leforduljon. AZ ROSSZ IRANY: a termelo (db.ts) MINDIG kitolti mind a
// negyet, tehat a `?` nem egy valodi allapotot irna le, hanem megengedne, hogy
// egy jovobeli termelo NEMAN kihagyja azt, amire a fogyaszto szamit.
// Egy tipus, amit a teszt kenyelmeert lazitunk, mar nem a rendszert irja le.
const queue = (over: Partial<RecipientQueueState> = {}): RecipientQueueState => ({
  queueDepth: 1,
  oldestPendingSec: 0,
  estimatedDelaySec: null,
  // "Meg semmit nem mertunk" alapertek. A nulla itt MERT nulla: ures sor, ures
  // ablak -- nem hianyzo adat. Ahol a kulonbseg szamit, az adott teszt felulirja.
  pendingChars: 0,
  recentChars: 0,
  recentSenders: 0,
  recentWindowMin: 60,
  ...over,
})

const ABANDON_MIN = 60

describe('adviseSender', () => {
  describe('the recipient is running', () => {
    it('says nothing about a short queue', () => {
      // Advice on every single send is advice nobody reads by the third day.
      const { advice } = adviseSender(queue({ queueDepth: 1 }), 'running', ABANDON_MIN)
      expect(advice).toBeNull()
    })

    it('stays silent at TWO waiting, and speaks at THREE', () => {
      // THE LITERALS ARE THE POINT, and the first version of this test got it
      // wrong: it asked with `QUEUE_ADVICE_THRESHOLD` itself, so the number
      // moved with the constant and a change from 3 to 4 left the suite green.
      // A test written in terms of the thing it is meant to pin cannot pin it.
      // Three is the fleet rule ("3+ pending -> put it on the card"), so three
      // is what is written here.
      expect(adviseSender(queue({ queueDepth: 2 }), 'running', ABANDON_MIN).advice).toBeNull()
      expect(adviseSender(queue({ queueDepth: 3 }), 'running', ABANDON_MIN).advice)
        .toContain('kártyára')
    })

    it('exports that same three, so a change to it is deliberate', () => {
      expect(QUEUE_ADVICE_THRESHOLD).toBe(3)
    })

    it('names the measured delay when there is one to name', () => {
      const { advice } = adviseSender(
        queue({ queueDepth: 4, estimatedDelaySec: 300 }), 'running', ABANDON_MIN)
      expect(advice).toContain('~5 perc')
    })

    it('says no delay at all rather than a made-up zero', () => {
      // estimatedDelaySec === null means "no delivery history yet", which is
      // the opposite of "arrives instantly". Printing 0 would be a claim.
      const { advice } = adviseSender(
        queue({ queueDepth: 4, estimatedDelaySec: null }), 'running', ABANDON_MIN)
      expect(advice).not.toContain('perc a késés')
      expect(advice).not.toContain('~0')
    })
  })

  describe('the recipient is not running', () => {
    it('warns even when only ONE message is waiting', () => {
      // This is the whole point. A depth of 1 is silent for a live agent and
      // must not be silent here: nobody is listening, and the sender is about
      // to walk away believing the message landed.
      const { advice } = adviseSender(queue({ queueDepth: 1 }), 'stopped', ABANDON_MIN)
      expect(advice).toContain('nem fut')
    })

    it('says the message will NOT be delivered, and by when it dies', () => {
      const { advice } = adviseSender(queue({ queueDepth: 1 }), 'stopped', ABANDON_MIN)
      expect(advice).toContain('NEM lesz kézbesítve')
      expect(advice).toContain('60 perc')
    })

    it('takes the retry window from the caller, not from a second copy of it', () => {
      // The router owns that number. A duplicate here would drift, and the
      // sender would be told a deadline the router does not honour.
      const { advice } = adviseSender(queue(), 'stopped', 15)
      expect(advice).toContain('15 perc')
    })

    it('says the number is NOT a backlog, which is how it reads by default', () => {
      const { advice } = adviseSender(queue({ queueDepth: 4 }), 'stopped', ABANDON_MIN)
      expect(advice).toContain('NEM torlódás')
    })

    it('counts the others correctly, and does not say "and the other 0"', () => {
      const one = adviseSender(queue({ queueDepth: 1 }), 'stopped', ABANDON_MIN).advice
      expect(one).not.toContain('másik 0')
      const three = adviseSender(queue({ queueDepth: 3 }), 'stopped', ABANDON_MIN).advice
      expect(three).toContain('másik 2')
    })
  })

  describe('the recipient could not be asked', () => {
    it('says it does not know, instead of guessing "stopped"', () => {
      // `unreachable` is ssh being down, not the agent being gone. Reporting it
      // as stopped would state a fact we do not have, and the sender would
      // abandon a route that is probably alive.
      const { advice } = adviseSender(queue({ queueDepth: 1 }), 'unreachable', ABANDON_MIN)
      expect(advice).toContain('NEM tudni')
      expect(advice).not.toContain('nem fut')
    })

    it('does not claim the message will be abandoned either', () => {
      const { advice } = adviseSender(queue({ queueDepth: 1 }), 'unreachable', ABANDON_MIN)
      expect(advice).not.toContain('NEM lesz kézbesítve')
    })
  })

  it('always reports the presence it was given, advice or not', () => {
    // The machine-readable half: a caller that wants to branch on presence must
    // not have to parse Hungarian prose to do it.
    expect(adviseSender(queue(), 'running', ABANDON_MIN).presence).toBe('running')
    expect(adviseSender(queue(), 'stopped', ABANDON_MIN).presence).toBe('stopped')
    expect(adviseSender(queue(), 'unreachable', ABANDON_MIN).presence).toBe('unreachable')
  })
})

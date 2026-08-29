import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  markRestartStarted, clearRestart, isRestartInFlight, resetRestartInFlight,
  RESTART_INFLIGHT_MAX_MS,
} from '../web/restart-inflight.js'

// Card f65bc6ef. A saturation restart came back with `--continue` -- the guard asked for
// `{ fresh: true }`, and a DIFFERENT starter won the race: restartAgentProcess stops
// first, and in that window the channel-monitor reconciler started the agent with no
// options at all. Measured live on computress, 2026-08-29 03:07, three consecutive log
// lines 0.6 seconds apart.

beforeEach(() => resetRestartInFlight())

describe('the in-flight registry', () => {
  it('reports an agent as in flight between mark and clear', () => {
    expect(isRestartInFlight('computress')).toBe(false)
    markRestartStarted('computress')
    expect(isRestartInFlight('computress')).toBe(true)
    clearRestart('computress')
    expect(isRestartInFlight('computress')).toBe(false)
  })

  // NEGATIVE CONTROL: marking one agent must not answer for another, or the reconciler
  // would stop rescuing the whole fleet the moment anyone restarts.
  it('answers per agent, not globally', () => {
    markRestartStarted('computress')
    expect(isRestartInFlight('dexter')).toBe(false)
  })

  // THE FAILURE DIRECTION. A leaked mark -- a crash between mark and clear -- must not
  // make the reconciler refuse forever; that would turn a half-second race into an
  // outage. The literal is deliberate: computing it from the constant would move with it
  // and pin nothing (that mutation survived on another card tonight).
  it('expires a leaked mark instead of latching', () => {
    const t0 = 1_800_000_000_000
    markRestartStarted('computress', t0)
    expect(isRestartInFlight('computress', t0 + 119_000)).toBe(true)
    expect(isRestartInFlight('computress', t0 + 121_000)).toBe(false)
    expect(RESTART_INFLIGHT_MAX_MS).toBe(2 * 60_000)
  })

  // OVERLAPPING RESTARTS. The guard and an API call can restart the same agent at once;
  // an unconditional clear would let the FIRST finally open the window while the SECOND is
  // still stopped -- the same defect, reached from inside the fix.
  it('stays in flight until the LAST overlapping restart clears', () => {
    markRestartStarted('computress')
    markRestartStarted('computress')
    clearRestart('computress')
    expect(isRestartInFlight('computress')).toBe(true)
    clearRestart('computress')
    expect(isRestartInFlight('computress')).toBe(false)
  })

  // NEGATIVE CONTROL for the refcount: a clear with nothing in flight must not underflow
  // into a state that swallows the next real mark.
  it('a stray clear does not poison the next restart', () => {
    clearRestart('computress')
    markRestartStarted('computress')
    expect(isRestartInFlight('computress')).toBe(true)
  })

  it('forgets the expired entry rather than re-answering it every tick', () => {
    const t0 = 1_800_000_000_000
    markRestartStarted('computress', t0)
    expect(isRestartInFlight('computress', t0 + 121_000)).toBe(false)
    // Back inside the window in wall-clock terms, but the entry is gone: an expiry that
    // left the row would flip back to true and read as a second restart.
    expect(isRestartInFlight('computress', t0 + 1_000)).toBe(false)
  })
})

// STRUCTURAL, and it says so. The two call sites are what the fix consists of, and
// neither is reachable from a test: restartAgentProcess drives tmux, and the reconciler
// is not exported. Nothing in the suite would notice either one being removed -- measured
// on a different card tonight, where a reverted call site passed all 4637 tests.
//
// READ FROM COMMENT-STRIPPED SOURCE. didi mutated the two assertions bb5d8db added and
// BOTH survived a second time (card comment 19, probes P1 and P4), by the same one cause:
// these assertions locate code by TEXT POSITION, and a comment is text. P1 moved the mark
// below the stop and left `// markRestartStarted(name) is called once the process is
// actually down.` above it -- indexOf found the name in the prose, markAt < stopAt held,
// and the 446 ms window was fully back at 8/8 green. P4 deleted the `continue` and left
// `// mid-restart: the restarter owns it, so we do not continue past it here` -- a comment
// documenting the OPPOSITE of what the code now does, and `toContain('continue')` matched
// the word inside it. Both are the shape a tidy-up takes, in a file this densely commented.
//
// The repo already had the answer and nobody wired it in: helpers/strip-comments.ts, whose
// own docblock describes this exact failure (didi, card 0114968c, 2026-08-23). Reproduced
// both probes here before fixing; both went green on ad43df4.
// ONE PASS OVER FOUR STATES: code, line comment, block comment, string/template.
// Comments and literal CONTENTS are blanked to spaces; length and newlines are preserved.
//
// THIS IS THE THIRD ROUND OF ONE FAMILY, AND THE FIRST FIX AIMED AT THE FAMILY. The guard
// read comments as code (0d6a00a), then string literals as code (8ed2544), and each was
// patched with its own helper -- stripComments for the first, blankLiterals for the second,
// run in sequence. That sequence CANNOT be right, and the measurement that showed it:
//
//   `continue   // the restarter's job`   -> RED, "could not read the in-flight branch"
//   `continue   // explain why`           -> RED, "the reconciler must SKIP, not merely log"
//
// Both are CORRECT code. The shared helpers/strip-comments.ts strips WHOLE-LINE comments
// only -- which its own docblock states, correctly, for its own purpose -- so a trailing
// comment survived into the slice. Then the apostrophe in it opened a string that never
// closed (first case), or the comment text sat between `continue` and the end of line and
// broke the statement-shaped match (second case). Everyday English comments carry
// apostrophes, and THE MEASURED SLICE ALREADY CONTAINS A TRAILING COMMENT today
// (`// Commit 3 v1: safe-mode / memory gate`) -- inert only because it holds no quote.
//
// The two concerns cannot be separated into two passes in either order: comments contain
// quotes, and strings contain `//`. Strip comments first and an apostrophe in a comment is
// gone but a `//` inside a string becomes a comment; blank strings first and the apostrophe
// in the comment opens a literal. One pass, four states, is the only version that is right.
//
// NOT CHANGING THE SHARED HELPER: other specs depend on its documented bounds, and this is
// a different contract, not a better version of the same one. Two implementations with two
// stated purposes, rather than one silently widened under its other callers.
//
// LENGTH IS PRESERVED because the anchors are found in the RAW text -- `Desired agent not
// running` is itself a string literal -- and then indexed into this one.
//
// KNOWN RESIDUAL, measured by didi (card comment 30) and deliberately left: a REGEX LITERAL
// carrying a quote (`name.replace(/'/g, '')`) still desynchronises this scanner. Recognising
// regex literals without a real parser needs the preceding token, which is where a hand
// scanner stops being small. It fails in the good direction -- a false FAILURE, fail-closed,
// with a message that says the guard could not READ rather than accusing the code -- and
// there is no instance in the slice today.
function codeOnly(src: string): string {
  const out = src.split('')
  let state: 'code' | 'line' | 'block' | 'str' = 'code'
  let quote = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { out[i] = ' '; out[i + 1] = ' '; state = 'line'; i += 2; continue }
      if (c === '/' && d === '*') { out[i] = ' '; out[i + 1] = ' '; state = 'block'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { state = 'str'; quote = c; i++; continue }
      i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; i++; continue }
      out[i] = ' '; i++; continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { out[i] = ' '; out[i + 1] = ' '; state = 'code'; i += 2; continue }
      if (c !== '\n') out[i] = ' '
      i++; continue
    }
    if (c === '\\') { out[i] = ' '; if (src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue }
    if (c === quote) { state = 'code'; i++; continue }
    if (c !== '\n') out[i] = ' '
    i++; continue
  }
  return out.join('')
}

// End of the STATEMENT that starts at `from`: the first `;` or newline at depth 0. Depth-aware
// because the statement being read is a call -- `logger.info({ agent: name }, '...')` -- whose
// own punctuation must not terminate it. No quote or comment handling: the input is already
// reduced to code, and a second copy of that logic here would be one more thing to drift.
function endOfStatement(s: string, from: number): number {
  let depth = 0
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && (c === ';' || c === '\n')) return i
  }
  return s.length
}

describe('both ends are wired (structural)', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '..', 'web', p), 'utf8')

  it('restartAgentProcess marks and clears around the stop/start window', () => {
    const body = codeOnly(src('agent-process.ts'))
    const start = body.indexOf('export async function restartAgentProcess')
    expect(start, 'restartAgentProcess not found').toBeGreaterThan(-1)
    // To the next top-level declaration, not a fixed number of characters: the first
    // version sliced 1200 chars and went red when a COMMENT was added above the clear.
    // A test that fails on a comment is noise, and noise is how a guard gets deleted.
    const end = body.indexOf('\nexport ', start + 10)
    const fn = body.slice(start, end === -1 ? undefined : end)
    expect(fn).toContain('markRestartStarted(name)')
    expect(fn).toContain('finally')
    expect(fn).toContain('clearRestart(name)')
    // The await is load-bearing: without it the finally clears the mark before the start
    // finishes, and most of the window reopens while the fix still reads as present.
    expect(fn).toContain('return await startAgentProcess(name, opts)')
    // ORDER, not just presence. The mark has to come BEFORE the stop; moved below it the
    // 446 ms window reopens and every assertion above still passes. `toContain` cannot see
    // position, and position is the entire point of this call.
    const markAt = fn.indexOf('markRestartStarted(name)')
    const stopAt = fn.indexOf('stopAgentProcess(name)')
    expect(stopAt, 'stopAgentProcess not found in restartAgentProcess').toBeGreaterThan(-1)
    expect(markAt, 'the mark must be set BEFORE the stop opens the window').toBeLessThan(stopAt)
  })

  it('the reconciler consults it AND skips -- the log line alone is a false success', () => {
    const body = src('channel-monitor.ts')
    // STRUCTURE is read from `code`, MESSAGE CONTENT from `body`. Same length, so an index
    // from one addresses the other. The split is the point: braces and the `continue`
    // statement are code and must not be found inside a string; `mid-restart` lives inside
    // a string ON PURPOSE and must not be blanked away.
    const code = codeOnly(body)
    // From the function, not a 1500-character window: stripping comments shortens the file
    // by however much prose sits above the branch, so a fixed window is measuring the
    // comment density, not the code.
    // THE ANCHOR CARRIES ITS OPEN PAREN, AND IT IS CHECKED FOR UNIQUENESS (didi, card comment
    // 37). `indexOf` returns the FIRST match, so a SIBLING sharing the prefix -- and
    // `reconcileDesiredAgentsForOrg` beside `reconcileDesiredAgents` is an ordinary name for a
    // scoped variant -- silently moves every assertion onto the sibling. didi measured the
    // consequence: a sibling with a correct-looking branch placed first, and the REAL reconciler
    // stripped of its `continue`, goes 8/8 GREEN. That is a FALSE PASS on the original defect
    // this whole card exists for: the guard checks a stage set while the running path is broken.
    // Reproduced here before fixing.
    //
    // The `(` alone closes it. The COUNT is the general form, and it is the control that caught
    // my own mutation harness tonight: an anchor that matches more than once has picked one
    // arbitrarily, and the honest response is to fail rather than to choose. Same family as the
    // `indexOf('{')` finding that started this -- a text locator landing on the wrong instance,
    // one level up, on the function instead of the brace.
    const ANCHOR = 'async function reconcileDesiredAgents('
    const anchorHits = body.split(ANCHOR).length - 1
    expect(anchorHits, `the reconciler anchor must match exactly once, found ${anchorHits} -- 0 means it moved or was renamed, more than 1 means this guard would pick an instance at random`)
      .toBe(1)
    const fnStart = body.indexOf(ANCHOR)
    expect(fnStart, 'reconcileDesiredAgents not found -- did codeOnly eat it?')
      .toBeGreaterThan(-1)
    // The SECOND anchor gets the same control -- didi named it as unmeasured. It is a log
    // string, so a duplicate is less likely than a sibling function, but "less likely" is not
    // a measurement and the check costs one line.
    const END_ANCHOR = 'Desired agent not running'
    // COUNTED OVER THE SEARCH RANGE, NOT THE WHOLE FILE. My first version counted every
    // occurrence in the file and FALSE-ALARMED on correct code: this anchor is resolved with
    // `indexOf(END_ANCHOR, fnStart)`, so a mention ANYWHERE EARLIER is not an ambiguity for
    // this lookup at all. Measured -- an unrelated line carrying the same text above the
    // function turned the guard red while the real resolution was still exact.
    // I shipped that in the same commit where I argued a guard must reject the sibling-shaped
    // LIE without rejecting the sibling. A control has to be held to the standard it enforces,
    // and the false-alarm direction is the half I had not measured on my own check.
    // Measured in all four directions: a duplicate BEFORE the function head is correct code and
    // passes; a duplicate inside the range, before OR after the real one, is genuine ambiguity
    // and fails; the anchor's removal fails with `found 0`.
    const endHits = body.slice(fnStart).split(END_ANCHOR).length - 1
    expect(endHits, `the loop-end anchor must match exactly once after the function head, found ${endHits} -- 0 means it moved, more than 1 means the loop end is ambiguous`)
      .toBe(1)
    const autoStartAt = body.indexOf(END_ANCHOR, fnStart)
    expect(autoStartAt, 'the options-less reconcile start not found after the function head')
      .toBeGreaterThan(fnStart)
    const loop = body.slice(fnStart, autoStartAt)
    const codeLoop = code.slice(fnStart, autoStartAt)

    const IF = 'if (isRestartInFlight(name))'
    const ifAt = loop.indexOf(IF)
    expect(ifAt, 'the reconciler must ask isRestartInFlight before it starts anything')
      .toBeGreaterThan(-1)

    // READ THIS BRANCH, WHATEVER SHAPE IT TAKES. The previous version did
    // `loop.indexOf('{', callAt)` and brace-matched from there -- which takes the next
    // brace ANYWHERE, and with no block of its own that is the object literal in
    // `logger.info({ agent: name }, ...)`. didi's P2/P3: the braceless form -- the style of
    // the guards on either side of it (`if (isAgentRunning(name)) continue`) -- made this
    // read `'{ agent: name '` as "the branch". P2 failed with `expected '{ agent: name ' to
    // contain 'mid-restart'`: a guard whose message sends the reader to fix the log when
    // the log is not the problem. P3, the braceless DEFECT, was caught by the same accident
    // -- a right answer for the wrong reason, which is not an answer. And with no `{` at
    // all, indexOf returns -1 and the matcher counted braces from the START of the slice,
    // so `could not read the in-flight branch` could never fire where it was meant to.
    const rest = loop.slice(ifAt + IF.length)
    const restCode = codeLoop.slice(ifAt + IF.length)
    const lead = rest.search(/\S/)
    let branch: string
    let branchCode: string
    let form: string
    if (rest[lead] === '{') {
      form = 'block'
      let depth = 0
      let end = -1
      for (let i = lead; i < restCode.length; i++) {
        if (restCode[i] === '{') depth++
        else if (restCode[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      expect(end, 'could not read the in-flight branch: its block never closes').toBeGreaterThan(lead)
      branch = rest.slice(lead, end)
      branchCode = restCode.slice(lead, end)
    } else {
      // Braceless: the branch is the ONE statement that follows -- and END OF LINE IS NOT
      // END OF STATEMENT. didi, card comment 22: reading to the newline swallowed a second
      // statement sharing the line, and one such line went 8/8 green here:
      //   if (isRestartInFlight(name)) logger.info({...}, '...mid-restart...'); continue
      // A braceless `if` takes exactly one statement -- the logger.info. The `; continue`
      // is SEPARATE and UNCONDITIONAL, so the loop skips every iteration and the reconciler
      // never starts any desired agent again. Controlled by execution, not by reading:
      // three items, one in flight, real control flow -> started []. That is the outcome
      // the timestamped expiry exists to prevent (a leaked mark refusing one agent
      // forever), except every agent, permanently, with no expiry -- and the guard called
      // it success.
      form = 'braceless'
      const stop = endOfStatement(restCode, lead)
      branch = rest.slice(lead, stop)
      branchCode = restCode.slice(lead, stop)
      // AND THE MERGED PAIR IS ITSELF THE SIGNAL. Reading short only ever produces false
      // failures; this is the one that reads LONG, so say so rather than quietly trimming.
      if (restCode[stop] === ';') {
        const eol = restCode.indexOf('\n', stop)
        const trailer = restCode.slice(stop + 1, eol === -1 ? undefined : eol).trim()
        expect(trailer, 'a second statement shares the line with the braceless branch -- a braceless `if` takes exactly ONE statement, so this one runs on every iteration')
          .toBe('')
      }
    }
    // CONTROL on the locator, and it is the mutation my first attempt survived: if the
    // branch we read runs into the guards BELOW it, their `continue` answers for this one.
    expect(branchCode, `the located ${form} branch ran past the in-flight check into the later guards`)
      .not.toContain('AGENT_RESTART_GRACE_MS')

    // IT MUST ACT ON THE ANSWER. didi mutated away the `continue`, leaving the check and
    // the log in place, and bb5d8db's test stayed green. That is the worse survivor: the
    // log is the ONLY thing separating "the race happened and the mark caught it" from
    // "the race did not happen", so after that mutation it PRINTS while the reconciler
    // starts the agent anyway -- it would report success at the moment the defect runs.
    // Statement-shaped, not `toContain`: `// continue is handled below` is not a skip.
    expect(branchCode, `the reconciler must SKIP, not merely log (read the ${form} branch)`)
      .toMatch(/(^|[;{}\n])\s*continue\s*(;|$)/m)
    // AND IT MUST SAY SO. Deliberate, and it is why the braceless
    // `if (isRestartInFlight(name)) continue` does NOT satisfy this guard: that form is
    // correct about the race and silent about it, and the two processes meeting is
    // otherwise unobservable -- nothing else distinguishes "the mark caught a real race"
    // from "the race did not recur".
    // AND NOTE WHAT IS DELIBERATELY *NOT* WRITTEN HERE: where this log line sits in the
    // card's closing condition. That fact churns. It was the closing condition, was demoted
    // to an auxiliary hint at 04:48 (comment 20, `SEGEDJEL`) after didi's M2, and was
    // promoted back to a closing condition at 05:22 by marveen's explicit decision
    // (comment 23) -- three states in 34 minutes. I pinned an assertion to it twice and it
    // was stale both times, the second time within two minutes of the commit, in the
    // OPPOSITE direction from the first.
    // didi's rule was right -- an assertion string is the most expensive place for a
    // sentence that has gone stale, because it is what you read when the guard goes red.
    // But keeping such a sentence CURRENT is not the fix, because the fact underneath it
    // moves faster than the file: a status is not a mechanism. So the reason above is the
    // mechanism, which does not move -- a silent skip is unobservable no matter how the
    // card classifies it -- and the classification lives on the card, which is where it
    // can be edited. Requiring the log is still a judgement; argue with it on the card.
    // (marveen settled it at 05:22: the requirement stays, and they widened their own
    // written condition to match rather than claim it had always said so.)
    expect(branchCode, `the in-flight skip must be observable -- otherwise nothing shows the two processes met (read the ${form} branch)`)
      .toContain('logger.')
    expect(branch.slice(branch.indexOf('logger.')), 'the log must name the reason: mid-restart')
      .toContain('mid-restart')
  })
})

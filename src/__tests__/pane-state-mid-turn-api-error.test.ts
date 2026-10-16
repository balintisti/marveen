// detectsMidTurnApiError -- card 843a9ab6.
//
// Measured 2026-10-16: nine times in a day, across six agents, a turn died with the pane's last
// block `⏺ API Error: Connection lost mid-response. The response above may be incomplete.` and the
// agent stayed at an empty prompt. The fixture MANDARK_0855 is the shape of the real capture
// (also in idle-guard-background-wait.test.ts); the others are the same pane with ONE thing changed.
import { describe, it, expect } from 'vitest'
import { detectPaneState, detectsMidTurnApiError, detectsThinkingBlockError } from '../pane-state.js'

const SEP = '─'.repeat(80)
const BOX = (name: string) => `${'─'.repeat(70)} ${name} ─\n❯ \n${SEP}`
const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'

// The captured shape: ⏺ glyph, no code, the text wrapped onto a second line, then the box.
const REAL = `
  Kész a javítás, indítom a tesztet.

⏺ API Error: Connection lost mid-response. The response above may be 
  incomplete.

${BOX('Friday')}
${FOOT}`

// Verbatim shape of MANDARK_0855: the background-wait status line sits between error and box.
const WITH_WAITING_LINE = `
⏺ API Error: Connection lost mid-response. The response above may be 
  incomplete.

✻ Waiting for 1 background agent to finish

${BOX('Mandark')}
${FOOT}

  ⏺ main
  ◯ general-purpose  Checking trial daysLeft calcul… 25m 53s · ↓ 202.2k tokens`

// Verbatim from ford's live pane, 2026-10-16 22:4x (card 843a9ab6, round 2): the guard did not fire
// on this. The turn summary line sits between the error and the box.
const WITH_TURN_SUMMARY = `
⏺ Migrations are already current on my disposable database, so I can run the
  calendar-sync e2e now.

  Searched for 1 pattern, ran 15 shell commands

⏺ API Error: Connection lost mid-response. The response above may be
  incomplete.

✻ Worked for 4m 36s · done 22:42

${BOX('Ford')}
  ⏵⏵ bypass permissions on (shift+tab to cycle)`

const RESULT_GLYPH = `
⏺ Bash(npm test)
  ⎿  API Error: Connection lost mid-response.

${BOX('Didi')}
${FOOT}`

const WITH_CODE = `
⏺ API Error: 529 {"type":"overloaded_error","message":"Overloaded"}

${BOX('Dexter')}
${FOOT}`

describe('detectsMidTurnApiError -- positives', () => {
  it('the real capture shape (⏺, no code, wrapped)', () => {
    expect(detectsMidTurnApiError(REAL)).toBe(true)
  })
  it('with the background-wait status line between the error and the box', () => {
    expect(detectsMidTurnApiError(WITH_WAITING_LINE)).toBe(true)
  })
  it('with the turn summary line between the error and the box (ford, live)', () => {
    expect(detectsMidTurnApiError(WITH_TURN_SUMMARY)).toBe(true)
  })
  it('the turn summary in its other measured spellings', () => {
    for (const line of ['✻ Cogitated for 12s · done 22:43', '✻ Crunched for 5m 7s · done 22:32', '✻ Worked for 1h 2m 3s', '✻ Brewed for 45s'])
      expect(detectsMidTurnApiError(WITH_TURN_SUMMARY.replace('✻ Worked for 4m 36s · done 22:42', line))).toBe(true)
  })
  it('an accented verb and trailing segments after done (zara, live, 2026-10-16)', () => {
    for (const line of ['✻ Sautéed for 1h 9m 35s · done 22:33 · 3 shells still running', '✻ Sautéed for 12s', '✻ Worked for 3s · 1 shell still running'])
      expect(detectsMidTurnApiError(WITH_TURN_SUMMARY.replace('✻ Worked for 4m 36s · done 22:42', line))).toBe(true)
  })
  it('the ⎿ result-glyph variant', () => {
    expect(detectsMidTurnApiError(RESULT_GLYPH)).toBe(true)
  })
  it('an error with a numeric code', () => {
    expect(detectsMidTurnApiError(WITH_CODE)).toBe(true)
  })
  it('the error is on the last line above the box (no blank line)', () => {
    expect(detectsMidTurnApiError(REAL.replace('incomplete.\n\n', 'incomplete.\n'))).toBe(true)
  })
})

describe('detectsMidTurnApiError -- negatives', () => {
  it('an OLD error followed by later output (a new reply block) does not match', () => {
    const later = REAL.replace(`\n${BOX('Friday')}`, `\n⏺ Folytatom: a teszt lefutott, 12 passed.\n\n${BOX('Friday')}`)
    expect(later).toContain('API Error')
    expect(detectsMidTurnApiError(later)).toBe(false)
  })
  it('an old error followed by a user prompt echo and a reply does not match', () => {
    const later = REAL.replace(`\n${BOX('Friday')}`, `\n❯ folytasd\n\n⏺ Rendben.\n\n${BOX('Friday')}`)
    expect(detectsMidTurnApiError(later)).toBe(false)
  })
  it('an old error followed by a wrapped reply with no blank line does not match', () => {
    const later = REAL.replace(`\n${BOX('Friday')}`, `\n⏺ Folytatom, a teszt\n  lefutott.\n\n${BOX('Friday')}`)
    expect(detectsMidTurnApiError(later)).toBe(false)
  })
  it('an old error followed by a tool-result line does not match', () => {
    const later = REAL.replace(`\n${BOX('Friday')}`, `\n⏺ Bash(ls)\n  ⎿  a.txt\n\n${BOX('Friday')}`)
    expect(detectsMidTurnApiError(later)).toBe(false)
  })
  it('a normal reply followed by the turn summary does not match', () => {
    const idle = `\n⏺ Kész, minden zöld.\n\n✻ Worked for 2m 1s · done 22:50\n\n${BOX('Friday')}\n${FOOT}`
    expect(detectsMidTurnApiError(idle)).toBe(false)
  })
  it('an old error, a later reply, then the turn summary does not match', () => {
    const later = WITH_TURN_SUMMARY.replace('\n✻ Worked', '\n⏺ Folytatom: 12 passed.\n\n✻ Worked')
    expect(detectsMidTurnApiError(later)).toBe(false)
  })
  it('a ✻ line that is not a turn summary still ends the walk', () => {
    for (const line of ['✻ Worked for the customer', '✻ Thinking…', '✻ Worked for 4m 36s and then more text', '✻ sautéed for 12s', '✻ Worked for 12s done 22:33'])
      expect(detectsMidTurnApiError(WITH_TURN_SUMMARY.replace('✻ Worked for 4m 36s · done 22:42', line))).toBe(false)
  })
  it('a normal idle pane does not match', () => {
    const idle = `\n⏺ Kész, minden zöld.\n\n${BOX('Friday')}\n${FOOT}`
    expect(detectsMidTurnApiError(idle)).toBe(false)
  })
  it('prose quoting the error text mid-sentence does not match', () => {
    const quoted = `\n⏺ A hiba így nézett ki: API Error: Connection lost.\n\n${BOX('Friday')}\n${FOOT}`
    expect(detectsMidTurnApiError(quoted)).toBe(false)
  })
  it('a pane with no input box, an empty pane and an empty string do not match', () => {
    expect(detectsMidTurnApiError('⏺ API Error: Connection lost mid-response.')).toBe(false)
    expect(detectsMidTurnApiError('')).toBe(false)
    expect(detectsMidTurnApiError('\n\n')).toBe(false)
  })
})

describe('the existing classification is untouched', () => {
  // The thinking-block class keeps its own detector and its own numeric-code anchor.
  const THINKING = `
⏺ Bash(x)
  ⎿  API Error: 400 {"error":{"message":"messages.1.content.0: thinking blocks cannot be modified"}}

${BOX('Friday')}
${FOOT}`
  it('the numeric-code thinking-block error is still detected by its own detector', () => {
    expect(detectsThinkingBlockError(THINKING)).toBe(true)
  })
  it('the mid-turn pane is still plain idle for detectPaneState: no new state value', () => {
    expect(detectPaneState(REAL)).toBe('idle')
    expect(detectPaneState(WITH_WAITING_LINE)).toBe('idle')
    expect(detectPaneState(WITH_TURN_SUMMARY)).toBe('idle')
  })
  it('the code-less ⏺ error is NOT a thinking-block error', () => {
    expect(detectsThinkingBlockError(REAL)).toBe(false)
  })
})

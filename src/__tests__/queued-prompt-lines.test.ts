// Which prompts are ALREADY waiting in a busy pane -- the question the router's
// main-agent wakeup never asked.
//
// The 2026-08-04 work (queued-messages-not-idle.test.ts) taught the pane to say
// "this session is BUSY, not idle" when Claude Code is holding queued prompts.
// Every writer that consults the idle gate was fixed by it. The router's
// main-agent wakeup was not, because it does not consult the idle gate at all
// (`waitForIdle: false`) -- so it kept re-typing the same line every 45s while
// the previous copy sat unread three rows above the box.
//
// Measured 2026-08-27 over store/dashboard.log (117 358 lines, 290,5 hours):
//   router wakeup fired ........ 5 908
//   distinct messages .......... 1 286   -> 4,6 wakeups per message
//   redundant, if one is legit .. 78,1%
// Each redundant copy is a full agent turn when the pane finally drains.
//
// `paneLooksIdle` answers "may I type?". This answers "would I be typing the
// same thing twice?" -- and only the second question can stop the loop, because
// the busy pane is exactly where this writer is SUPPOSED to type (it is the one
// path that reaches a working main agent; the nudge watcher and the scheduled
// heartbeat both abstain when busy).
//
// Fixtures are the real captures from the 2026-08-04 incident.

import { describe, it, expect } from 'vitest'
import { queuedPromptLines, promptAlreadyQueued, paneLooksIdle } from '../pane-state.js'

const WAKEUP = '[inbox-wakeup: pending inter-agent messages]'

// A live 32-minute turn with one queued message. The spinner is pushed up by
// the queued block -- which is why the busy-spinner check alone missed this.
const QUEUED_WHILE_BUSY = [
  '           őségét mérlegelnéd. Amit így kaptam: 25 nyitott Lieferschein',
  '',
  `❯ ${WAKEUP}`,
  '',
  '  Running 1 shell command…',
  '',
  '✳ Forming… (32m 37s · ↓ 76.1k tokens)',
  '  ⎿  Tip: Use /clear to start fresh when switching topics and free up context',
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ Press up to edit queued messages',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5 · ctx 406k/1.0M · 41%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n')

// Same shape with the spinner scrolled out of the live window entirely.
const QUEUED_NO_SPINNER = [
  '  ⎿  … tool output …',
  '',
  `❯ ${WAKEUP}`,
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ Press up to edit queued messages',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5 · ctx 406k/1.0M · 41%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n')

// The loop as it actually looked: three copies, five minutes apart, all unread.
const THREE_QUEUED = [
  '  ⎿  … tool output …',
  '',
  `❯ ${WAKEUP}`,
  '',
  `❯ ${WAKEUP}`,
  '',
  '❯ [Kanban feladat #a1b2c3d4]',
  '',
  '✳ Forming… (37m 02s · ↓ 91.4k tokens)',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ Press up to edit queued messages',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5 · ctx 406k/1.0M · 41%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n')

const GENUINELY_IDLE = [
  '  ⎿  … tool output …',
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5 · ctx 406k/1.0M · 41%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n')

// SELF-CONTAMINATION control. This very file, an incident report, or a chat log
// quoting both the hint AND the wakeup line lands in some agent's scrollback.
// That pane is IDLE and has nothing queued: inventing a queue here would make
// the writer suppress a wakeup that was never sent, and the message would sit
// pending until a human noticed. Silent, and in the losing direction.
const IDLE_WITH_BOTH_QUOTED_IN_SCROLLBACK = [
  '  ⎿  jelentes: a doboz ilyenkor a "Press up to edit queued messages"',
  `  ⎿  sort mutatja, felette meg a sorban allo ❯ ${WAKEUP}`,
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5 · ctx 406k/1.0M · 41%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n')

// The SHARPER self-contamination control. The fixture above is quoted mid-line
// (`⎿  ... ❯ [inbox-wakeup...]`), and a line-start anchor alone already rejects
// it -- so it passes for a reason that has nothing to do with the queue gate.
// Measured 2026-08-27: deleting the queued-hint check left every test green
// until this fixture existed. Here the quoted line sits at COLUMN ZERO, exactly
// as it does when an agent cats a pane capture, an incident report, or this
// very test file into its own terminal. Only the "hint inside the live input
// box" gate can tell this pane from a real queue.
const IDLE_WITH_CAPTURE_PASTED_AT_COLUMN_ZERO = [
  '  ⎿  cat src/__tests__/queued-prompt-lines.test.ts',
  '',
  `❯ ${WAKEUP}`,
  '',
  '  Running 1 shell command…',
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────────────────────',
  '  Opus 5 · ctx 406k/1.0M · 41%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n')

describe('queuedPromptLines: what is already waiting in the pane', () => {
  it('returns the queued line from the real 32-minute-turn capture', () => {
    expect(queuedPromptLines(QUEUED_WHILE_BUSY)).toEqual([WAKEUP])
  })

  it('finds it with the spinner scrolled out of the live window', () => {
    // The spinner-based busy check misses this shape; the queue hint does not.
    expect(queuedPromptLines(QUEUED_NO_SPINNER)).toEqual([WAKEUP])
  })

  it('returns every queued line, in render order, duplicates included', () => {
    // The duplicate is the defect made visible: two identical copies waiting,
    // each of which will cost a full turn.
    expect(queuedPromptLines(THREE_QUEUED)).toEqual([WAKEUP, WAKEUP, '[Kanban feladat #a1b2c3d4]'])
  })

  it('returns [] on a genuinely idle pane', () => {
    expect(queuedPromptLines(GENUINELY_IDLE)).toEqual([])
  })

  it('returns [] when the hint and the line are only quoted in scrollback', () => {
    // The gate is the hint INSIDE the live input box, not anywhere in the pane.
    expect(paneLooksIdle(IDLE_WITH_BOTH_QUOTED_IN_SCROLLBACK)).toBe(true)
    expect(queuedPromptLines(IDLE_WITH_BOTH_QUOTED_IN_SCROLLBACK)).toEqual([])
  })

  it('returns [] when a pane capture is pasted into an IDLE pane at column zero', () => {
    // The box holds no queue hint, so there is no queue -- whatever the
    // scrollback happens to contain. Without this gate the writer would
    // suppress a wakeup it never sent, and the message would wait for a human.
    expect(queuedPromptLines(IDLE_WITH_CAPTURE_PASTED_AT_COLUMN_ZERO)).toEqual([])
    expect(promptAlreadyQueued(IDLE_WITH_CAPTURE_PASTED_AT_COLUMN_ZERO, WAKEUP)).toBe(false)
  })

  it('returns [] on empty or structureless input rather than throwing', () => {
    expect(queuedPromptLines('')).toEqual([])
    expect(queuedPromptLines('nincs itt semmilyen panel')).toEqual([])
  })
})

describe('promptAlreadyQueued: the question a repeating writer must ask', () => {
  it('is true for a line that is already waiting unread', () => {
    expect(promptAlreadyQueued(QUEUED_WHILE_BUSY, WAKEUP)).toBe(true)
  })

  it('is false for a DIFFERENT line, so an unrelated prompt is never suppressed', () => {
    // Suppressing the wrong line would be the losing direction: a message that
    // was never signalled, waiting for a human to notice.
    expect(promptAlreadyQueued(QUEUED_WHILE_BUSY, '[Kanban feladat #deadbeef]')).toBe(false)
  })

  it('is false on an idle pane -- nothing is queued, so send', () => {
    expect(promptAlreadyQueued(GENUINELY_IDLE, WAKEUP)).toBe(false)
  })

  it('is false for empty text rather than matching everything', () => {
    expect(promptAlreadyQueued(QUEUED_WHILE_BUSY, '')).toBe(false)
  })

  it('ignores surrounding whitespace on both sides of the comparison', () => {
    expect(promptAlreadyQueued(QUEUED_WHILE_BUSY, `  ${WAKEUP}  `)).toBe(true)
  })
})

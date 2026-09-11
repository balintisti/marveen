import { describe, it, expect } from 'vitest'
import { anchorOnce, anchorNth } from './anchor-once.js'

/**
 * A helper whose whole job is to fail is worth little until the failure has
 * been seen. Every case below asserts the THROW, not just a happy path.
 */

const SRC = [
  'line zero',
  'if (task.forceSend) {',      // 1st
  '  body a',
  'unique marker here',
  '      if (task.forceSend) {', // 2nd, contains the 1st as a substring
  '  body b',
].join('\n')

describe('anchorOnce', () => {
  it('returns the index of a marker that occurs exactly once', () => {
    expect(anchorOnce(SRC, 'unique marker here')).toBe(SRC.indexOf('unique marker here'))
  })

  it('throws when the marker has gone stale (zero matches), and says so', () => {
    expect(() => anchorOnce(SRC, 'no such text')).toThrow(/found 0/)
    expect(() => anchorOnce(SRC, 'no such text')).toThrow(/renamed, reformatted or removed/)
  })

  it('throws when a second occurrence has appeared -- the case this exists for', () => {
    expect(() => anchorOnce(SRC, 'if (task.forceSend) {')).toThrow(/found 2/)
  })

  it('names the marker in the failure so the reader is not left hunting', () => {
    expect(() => anchorOnce(SRC, 'if (task.forceSend) {')).toThrow(/task\.forceSend/)
  })

  it('accepts a label and uses it in the message', () => {
    expect(() => anchorOnce(SRC, 'nope', 'the cron loop')).toThrow(/the cron loop/)
  })

  it('rejects an empty marker rather than matching everywhere', () => {
    expect(() => anchorOnce(SRC, '')).toThrow(/must not be empty/)
  })

  // Overlap matters: a naive counter that advances by 1 instead of by the
  // marker length double-counts repeated characters and would report a unique
  // anchor as ambiguous -- a false failure, the worst kind for a guard.
  it('counts overlapping-looking runs by marker length, not by character', () => {
    expect(anchorOnce('aaa-xx-aaa'.replace('-xx-', '|'), '|')).toBe(3)
    expect(() => anchorOnce('aaaa', 'aa')).toThrow(/found 2/)
  })
})

describe('anchorNth', () => {
  it('returns the nth occurrence when the declared count is right', () => {
    const first = anchorNth(SRC, 'if (task.forceSend) {', { nth: 1, of: 2 })
    const second = anchorNth(SRC, 'if (task.forceSend) {', { nth: 2, of: 2 })
    expect(first).toBe(SRC.indexOf('if (task.forceSend) {'))
    expect(second).toBeGreaterThan(first)
    expect(SRC.slice(second)).toMatch(/^if \(task\.forceSend\) \{\n {2}body b/)
  })

  it('nth: 1 of the declared count matches plain indexOf -- behaviour is preserved', () => {
    expect(anchorNth(SRC, 'if (task.forceSend) {', { nth: 1, of: 2 }))
      .toBe(SRC.indexOf('if (task.forceSend) {'))
  })

  // The point of requiring `of`: the COUNT is the thing that goes stale.
  it('throws when the population moved, in either direction', () => {
    expect(() => anchorNth(SRC, 'if (task.forceSend) {', { nth: 1, of: 1 })).toThrow(/found 2/)
    expect(() => anchorNth(SRC, 'if (task.forceSend) {', { nth: 1, of: 3 })).toThrow(/found 2/)
  })

  it('refuses an nth beyond the declared count', () => {
    expect(() => anchorNth(SRC, 'x', { nth: 3, of: 2 })).toThrow(/nth cannot exceed of/)
  })

  it('refuses non-positive or non-integer arguments instead of silently flooring them', () => {
    expect(() => anchorNth(SRC, 'x', { nth: 0, of: 2 })).toThrow(/nth must be a positive integer/)
    expect(() => anchorNth(SRC, 'x', { nth: 1.5, of: 2 })).toThrow(/nth must be a positive integer/)
    expect(() => anchorNth(SRC, 'x', { nth: 1, of: 0 })).toThrow(/of must be a positive integer/)
  })
})

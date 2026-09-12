import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  withRetry, isTransientExecFailure, PROBE_ATTEMPTS, probeRetryDelayMs,
  type Probe,
} from '../web/uptime-alert-watcher.js'

// Neither poller retried, so each notice asserted from n=1 -- and the fault it
// was reporting is transient (card 213abf0d). Measured three independent ways
// before this code existed: gcloud n=40 across two load states, ZERO samples
// above 15 s; n=8 inside the SERVICE's own environment, 0.33-0.66 s; and the
// token refresh caught mid-batch at 0.66 s, which kills "it landed on a
// refresh" as an explanation for a 15-second overrun. Plus the shape: five
// blind ticks in one day, NONE carrying the STILL BLIND marker, so five
// separate spells each shorter than the 2-minute interval.
//
// The error direction is what makes it worth code: a single sample lies toward
// the ALARM, which is the `ls-remote` shape this fleet already pays for.
//
// TWO CLAIMS ARE PINNED SEPARATELY HERE, because a retry that retries the
// WRONG things is worse than none: (1) a transient failure is attempted again,
// (2) a REFUSAL is not -- and the attempt count reaches the reader either way.

beforeEach(() => { process.env.UPTIME_PROBE_RETRY_DELAY_MS = '0' })
afterEach(() => { delete process.env.UPTIME_PROBE_RETRY_DELAY_MS })

const fail = (reason: string, transient?: boolean): Probe<string> =>
  ({ ok: false, reason, ...(transient === undefined ? {} : { transient }) })

describe('isTransientExecFailure: which gcloud failures deserve a second look', () => {
  it('our own expired budget is transient', () => {
    expect(isTransientExecFailure({ code: 'ETIMEDOUT', signal: 'SIGTERM' })).toBe(true)
  })
  it('an external signal is transient', () => {
    expect(isTransientExecFailure({ code: undefined, signal: 'SIGTERM' })).toBe(true)
  })
  it('ENOENT is NOT: gcloud is absent, and retrying only delays an accurate notice', () => {
    expect(isTransientExecFailure({ code: 'ENOENT', signal: null })).toBe(false)
  })
  it('a plain non-zero exit is NOT: that is gcloud SAYING no', () => {
    expect(isTransientExecFailure({ code: undefined, signal: null, status: 3 })).toBe(false)
  })
  it('CONTROL: the classifier can answer both ways on this very set', () => {
    const verdicts = [
      { code: 'ETIMEDOUT' }, { signal: 'SIGTERM' }, { code: 'ENOENT' }, { status: 1 },
    ].map(isTransientExecFailure)
    expect(new Set(verdicts).size).toBe(2)
  })
})

describe('withRetry', () => {
  it('a probe that succeeds is attempted exactly once', async () => {
    const attempt = vi.fn(async (): Promise<Probe<string>> => ({ ok: true, value: 'tok' }))
    await expect(withRetry(attempt)).resolves.toEqual({ ok: true, value: 'tok' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('THE CASE THIS EXISTS FOR: transient, then success -> the blip never reaches the user', async () => {
    let n = 0
    const attempt = vi.fn(async (): Promise<Probe<string>> => {
      n += 1
      return n === 1 ? fail('gcloud timed out after 15000 ms', true) : { ok: true, value: 'tok' }
    })
    await expect(withRetry(attempt)).resolves.toEqual({ ok: true, value: 'tok' })
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('a standing transient failure still reports, and SAYS how many attempts it survived', async () => {
    const attempt = vi.fn(async () => fail('gcloud timed out after 15000 ms', true))
    const got = await withRetry(attempt)
    expect(attempt).toHaveBeenCalledTimes(PROBE_ATTEMPTS)
    expect(got.ok).toBe(false)
    // The count is the CONTROL the reader gets: a notice that survived two
    // attempts is a different claim from one that did not.
    // The suffix DENIES the inference the bare count invited: two attempts are
    // 15 s + 1 s apart, inside a single blind spell, so surviving both is not
    // evidence of persistence (mandark, 2026-09-12). It claims no duration either.
    expect(!got.ok && got.reason).toBe(
      `gcloud timed out after 15000 ms (${PROBE_ATTEMPTS} attempts -- transient vs persistent NOT determined)`)
  })

  it('LOAD-BEARING NEGATIVE: a refusal is attempted ONCE and its reason is left alone', async () => {
    const attempt = vi.fn(async () => fail('gcloud exited 1: not authenticated', false))
    const got = await withRetry(attempt)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(!got.ok && got.reason).toBe('gcloud exited 1: not authenticated')
  })

  it('an UNMARKED failure is treated as a refusal, not as a blip', async () => {
    // Default-deny: a probe that forgot to classify itself must not be retried
    // forever. The absent flag reads as "not transient".
    const attempt = vi.fn(async () => fail('something else'))
    await withRetry(attempt)
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})

describe('probeRetryDelayMs', () => {
  it('reads the env override, so the suite does not sleep', () => {
    process.env.UPTIME_PROBE_RETRY_DELAY_MS = '0'
    expect(probeRetryDelayMs()).toBe(0)
  })
  it('CONTROL: falls back to a real pause when the override is absent or junk', () => {
    delete process.env.UPTIME_PROBE_RETRY_DELAY_MS
    expect(probeRetryDelayMs()).toBeGreaterThan(0)
    process.env.UPTIME_PROBE_RETRY_DELAY_MS = 'nonsense'
    expect(probeRetryDelayMs()).toBeGreaterThan(0)
  })
})

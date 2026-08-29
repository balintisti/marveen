// THE LOG PREFIX MUST CARRY A DATE, AND A LOCAL ONE (card 10ba8fd4).
//
// Without a date the prefix is `[06:41:02.123]`, and in a multi-day log that cannot express
// "after X" at all -- today's [03:07:18] and Tuesday's are byte-identical. In one night that
// produced five false readings across three agents, four of them giving the expected answer.
//
// This test exists because the FIX has a trap of its own: in pino-pretty a bare format string
// is UTC and only a `SYS:` prefix means system-local time. Losing the prefix would shift every
// line two hours against the wall clock -- a new instance of the very defect being removed,
// and silent, because a plausible-looking timestamp is exactly what nobody re-checks.
//
// Behavioural, not structural: it renders a KNOWN epoch through the configured format and
// reads the result, rather than asserting that a string appears in the source.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG = readFileSync(join(import.meta.dirname, '..', 'logger.ts'), 'utf8')

/** The translateTime value the logger actually configures -- read, not assumed. */
function configuredFormat(): string {
  const m = CONFIG.match(/translateTime:\s*'([^']+)'/)
  expect(m, 'logger.ts must configure translateTime -- without it the prefix has no date').not.toBeNull()
  return m![1]
}

function render(epochMs: number, translateTime: string): string {
  const line = JSON.stringify({ level: 30, time: epochMs, pid: 1, msg: 'probe' })
  return execFileSync('npx', ['pino-pretty', '--colorize=false', '--translateTime', translateTime], {
    input: line, encoding: 'utf8', timeout: 60_000,
  })
}

describe('the log prefix carries a date, in local time (10ba8fd4)', () => {
  // A fixed instant, so the assertion cannot drift with the clock.
  const EPOCH = Date.UTC(2026, 7, 29, 5, 32, 42, 549)   // 2026-08-29 05:32:42.549 UTC

  it('configures translateTime with the SYS: prefix', () => {
    // The prefix is the difference between local and UTC. Asserted on its own so a failure
    // says WHICH half broke.
    expect(configuredFormat(), 'a bare format string renders UTC -- `SYS:` means system-local')
      .toMatch(/^SYS:/)
  })

  it('renders a DATE, not just a time of day', () => {
    const out = render(EPOCH, configuredFormat())
    expect(out, 'the prefix must carry a date, or a multi-day log cannot express "after X"')
      .toMatch(/\[\d{4}-\d{2}-\d{2}[ T]/)
  })

  it('renders LOCAL time, not UTC -- the trap this test exists for', () => {
    const local = render(EPOCH, configuredFormat())
    const utc = render(EPOCH, configuredFormat().replace(/^SYS:/, ''))
    // NEGATIVE CONTROL: dropping the prefix must actually change the output. If these ever
    // match, the test proves nothing -- it would pass on a UTC config too.
    expect(local, 'dropping SYS: must change the rendering, or this test is vacuous')
      .not.toBe(utc)
    // And the local rendering must agree with this machine's own view of that instant.
    const hh = String(new Date(EPOCH).getHours()).padStart(2, '0')
    expect(local, `local rendering must show this machine's hour (${hh}) for the fixed epoch`)
      .toContain(`${hh}:32:42`)
  })
})

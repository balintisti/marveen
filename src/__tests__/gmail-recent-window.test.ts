import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// THE BUG (measured 2026-08-22). gmail-recent.py asked IMAP for `SINCE <today>`
// and then filtered the results on --minutes. IMAP SINCE is day-granular, so
// the search could never return a message older than local midnight -- NO
// MATTER HOW LARGE --minutes WAS. The morning briefing runs at 07:30 with
// --minutes 720, which means more than half of its window is yesterday, and
// every message in that half was dropped.
//
// What made it dangerous is the shape of the failure: the script answered
// `{"ok":true,"messages":[]}`. Not an error, not a timeout -- a successful
// answer that reads as "quiet mailbox". Every guard this script carries (exit
// 0, ok:false on failure, name the config path) was working; the window itself
// was wrong, and a wrong window has no error path.
//
// Mechanism control on the live server, before the fix: [Gmail]/Kuka returned
// 0 messages for SINCE today and 9 for SINCE today-2, and all 9 fell inside a
// --minutes 4320 window.
//
// Tested through the real function rather than by grepping the source: the
// expression was lifted out of main() precisely so a test could reach it.

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'gmail-recent.py')

/** Call imap_since() in the real script, for a fixed local wall-clock time. */
function imapSince(iso: string, minutes: number): string {
  const py = `
import importlib.util, datetime
spec = importlib.util.spec_from_file_location('gr', ${JSON.stringify(SCRIPT)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(m.imap_since(datetime.datetime.fromisoformat(${JSON.stringify(iso)}), ${minutes}))
`
  return execFileSync('python3', ['-c', py], { encoding: 'utf-8', timeout: 30_000 }).trim()
}

describe('gmail-recent.py -- the IMAP SINCE window', () => {
  it('reaches back to YESTERDAY for the 07:30 briefing (the measured case)', () => {
    // The exact call the morning briefing makes. Before the fix this was
    // '22-Aug-2026' and the 19:30..24:00 half of the window was invisible.
    expect(imapSince('2026-08-22T07:30:00', 720)).toBe('21-Aug-2026')
  })

  it('stays on today when the whole window is today', () => {
    // The fix must not widen every query: a 2-hour window at 07:30 has no
    // business scanning yesterday. This is the NOT-list half of the check.
    expect(imapSince('2026-08-22T07:30:00', 120)).toBe('22-Aug-2026')
  })

  it('crosses midnight for a short window just after it', () => {
    // 00:10 with a 30-minute window: 29 of those minutes are yesterday.
    expect(imapSince('2026-08-22T00:10:00', 30)).toBe('21-Aug-2026')
  })

  it('spans months and years, not just days', () => {
    // 24h back from 00:30 on New Year's Day lands on 31 December, the year before.
    expect(imapSince('2026-01-01T00:30:00', 1440)).toBe('31-Dec-2025')
  })

  it('anchors on the WINDOW START, so a wide window really is wide', () => {
    // A month-long window has to ask for a month. The old code answered
    // today's date here and then reported one day's mail as thirty days'.
    expect(imapSince('2026-08-22T12:00:00', 43_200)).toBe('23-Jul-2026')
  })
})

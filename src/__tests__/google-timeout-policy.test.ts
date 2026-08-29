import { describe, it, expect } from 'vitest'
import { timeoutForUrl } from '../google-api.js'
import { TOOL_TIMEOUTS } from '../tool-timeouts.js'

// WHY THIS EXISTS (card f4c59571, measured 2026-08-24). The deadline used to be
// a DEFAULT PARAMETER on httpsRequest, set to the calendar's 5s. A caller that
// omitted the argument silently got a calendar budget -- and two callers did.
// Drive was fixed in 2026-08-20 by passing the argument; the OAuth token
// exchange was still doing it on 2026-08-24, so a slow token round trip made
// EVERY leg report that the calendar had timed out. The Drive leg said
// "timed out after 5000ms" while budgeting 60s, which is what pinned the blame
// on the shared auth step.
//
// The endpoint now decides, so a caller cannot forget a value it never supplies.
describe('timeoutForUrl -- the endpoint decides, not the caller', () => {
  it('gives the AUTH budget to the token exchange, and it is NOT the calendar budget', () => {
    // The regression in one line: this used to be TOOL_TIMEOUTS['google-calendar'].
    expect(timeoutForUrl('https://oauth2.googleapis.com/token')).toBe(TOOL_TIMEOUTS['google-auth'])
    expect(timeoutForUrl('https://oauth2.googleapis.com/token')).not.toBe(TOOL_TIMEOUTS['google-calendar'])
  })

  it('honours a token_uri override pointing somewhere else', () => {
    // Google ships token_uri in the key JSON and the module uses it; a private
    // endpoint must still be treated as auth, not as a calendar call.
    expect(timeoutForUrl('https://oauth2.example.test/token')).toBe(TOOL_TIMEOUTS['google-auth'])
  })

  it.each([
    ['drive list', 'https://www.googleapis.com/drive/v3/files?q=x'],
    ['drive read', 'https://www.googleapis.com/drive/v3/files/abc?alt=media'],
    ['drive export', 'https://www.googleapis.com/drive/v3/files/abc/export?mimeType=text%2Fplain'],
    ['drive upload', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id'],
  ])('keeps the Drive budget for %s', (_n, url) => {
    expect(timeoutForUrl(url)).toBe(TOOL_TIMEOUTS['google-drive'])
  })

  it.each([
    ['events', 'https://www.googleapis.com/calendar/v3/calendars/x%40y.com/events?timeMin=1'],
    ['calendar list', 'https://www.googleapis.com/calendar/v3/users/me/calendarList'],
  ])('leaves the calendar on its own budget for %s', (_n, url) => {
    expect(timeoutForUrl(url)).toBe(TOOL_TIMEOUTS['google-calendar'])
  })

  it('matches on the PATH, not anywhere in the string -- a query value cannot buy the auth budget', () => {
    // The discriminating case, and it took a mutation to find an honest one.
    // My first attempt put "/token" in the CALENDAR ID -- but the id is
    // encodeURIComponent'd, so the slash becomes %2F and even a naive
    // `includes('/token')` would have passed. That test asserted nothing.
    // A QUERY VALUE is not escaped that way, so this is the case that separates
    // the two implementations: substring-matching hands a 15s AUTH budget to a
    // calendar read, path-matching does not.
    const url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?pageToken=/token'
    expect(timeoutForUrl(url)).toBe(TOOL_TIMEOUTS['google-calendar'])
  })

  it('falls back to the calendar budget for something unparseable, instead of throwing', () => {
    // A deadline is not the place to raise a new error class.
    expect(timeoutForUrl('not a url at all')).toBe(TOOL_TIMEOUTS['google-calendar'])
  })

  it('the three budgets are actually different -- otherwise every test above is vacuous', () => {
    const { 'google-auth': a, 'google-drive': d, 'google-calendar': c } = TOOL_TIMEOUTS
    expect(new Set([a, d, c]).size).toBe(3)
  })
})

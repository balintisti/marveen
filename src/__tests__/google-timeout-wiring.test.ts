import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { TOOL_TIMEOUTS } from '../tool-timeouts.js'

// The WIRING of timeoutForUrl into httpsRequest, and the host in the timeout
// message (card a65a61c1, didi's measurement on commit 2069995).
//
// timeoutForUrl itself is well covered -- eleven assertions, including a
// blindness control. What nothing asserted was that anything CALLS it. Didi
// mutated the default parameter back to `TOOL_TIMEOUTS['google-calendar']` and
// the whole 4470-test suite stayed green: the function would sit there,
// exported and tested, while every request inherited the calendar's 5s again
// and the token exchange died at 5s exactly as before the fix. The card's
// defect restores byte for byte with nothing to announce it.
//
// The second mutation removed the HOST from the timeout error and also
// survived. That is not cosmetic here: the repo's CLAUDE.md tells agents that
// "a timeout around 5000 ms is ALMOST CERTAINLY the token exchange, not the
// calendar". That sentence exists BECAUSE the message did not say. If the
// message silently loses the host again, the advice stays on the page and the
// two together describe a system that no longer exists.
//
// So these assert the CALL SITE, not the pure function: the value handed to
// req.setTimeout, and the text of the error it raises.

const setTimeoutCalls: Array<{ url: string; ms: number; handler: () => void }> = []
let lastDestroyError: Error | null = null

vi.mock('node:https', () => {
  const request = (url: string, _options: unknown, cb?: (res: unknown) => void) => {
    const req = {
      setTimeout: (ms: number, handler: () => void) => {
        setTimeoutCalls.push({ url: String(url), ms, handler })
      },
      destroy: (err: Error) => { lastDestroyError = err },
      on: () => req,
      write: () => true,
      end: () => {
        // Answer immediately with a token payload so the promise settles and
        // the call under test completes.
        const res = {
          statusCode: 200,
          on: (ev: string, fn: (arg?: unknown) => void) => {
            if (ev === 'data') fn(Buffer.from(JSON.stringify({ access_token: 'fresh', expires_in: 3600 })))
            if (ev === 'end') fn()
            return res
          },
        }
        cb?.(res)
      },
    }
    return req
  }
  return { default: { request }, request }
})

const TOKENS = { normal: { access_token: 'stale', refresh_token: 'r', expiry_date: 0 } }
const CREDS = { installed: { client_id: 'cid', client_secret: 'secret' } }

// A real key, because buildServiceAccountJwt signs with it. Generated once per
// run rather than checked in: a private key literal in the repo is the very
// thing the secret gate exists to stop.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const SERVICE_ACCOUNT = { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey }

/** Which of the two token paths getValidAccessToken will take. */
let serviceAccountPresent = false

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    // No service-account key: the OAuth path is the one under test. Every other
    // stat keeps the real implementation.
    statSync: (p: unknown, ...rest: unknown[]) => {
      const s = String(p)
      if (s.endsWith('google-service-account.json')) {
        if (!serviceAccountPresent) throw new Error('ENOENT')
        return { mtimeMs: 1 } as never
      }
      if (s.endsWith('tokens.json') || s.endsWith('gcp-oauth.keys.json')) return { mtimeMs: 1 } as never
      return (actual.statSync as (...a: unknown[]) => unknown)(p, ...rest) as never
    },
    readFileSync: (p: unknown, ...rest: unknown[]) => {
      const s = String(p)
      if (s.endsWith('google-service-account.json')) return JSON.stringify(SERVICE_ACCOUNT)
      if (s.endsWith('tokens.json')) return JSON.stringify(TOKENS)
      if (s.endsWith('gcp-oauth.keys.json')) return JSON.stringify(CREDS)
      return (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest) as never
    },
    writeFileSync: () => {},
  }
})

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

function tokenCall() {
  return setTimeoutCalls.find((c) => c.url.includes('oauth2.googleapis.com'))
}

describe.each([
  ['OAuth refresh', false],
  ['service account', true],
])('the endpoint budget reaches req.setTimeout -- %s path', (_label, saPresent) => {
  beforeEach(() => {
    setTimeoutCalls.length = 0
    lastDestroyError = null
    serviceAccountPresent = saPresent as boolean
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the token exchange gets the AUTH budget, not the calendar one', async () => {
    const { listCalendars } = await import('../google-api.js')
    await listCalendars().catch(() => { /* the calendar leg may fail; the token leg already ran */ })

    const call = tokenCall()
    expect(call, 'no request was made to the token endpoint').toBeDefined()
    expect(call?.ms).toBe(TOOL_TIMEOUTS['google-auth'])
    // The regression this guards: inheriting the calendar's budget is what
    // capped the token step at 5s and made every leg blame the Calendar API.
    expect(call?.ms).not.toBe(TOOL_TIMEOUTS['google-calendar'])
  })

  it('the timeout error NAMES the host, so the reader is not sent to the wrong API', async () => {
    const { listCalendars } = await import('../google-api.js')
    await listCalendars().catch(() => { /* as above */ })

    const call = tokenCall()
    expect(call).toBeDefined()
    call?.handler()

    expect(lastDestroyError).toBeInstanceOf(Error)
    expect(lastDestroyError?.message).toContain('oauth2.googleapis.com')
    expect(lastDestroyError?.message).toContain(String(TOOL_TIMEOUTS['google-auth']))
  })
})

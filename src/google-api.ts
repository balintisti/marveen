import https from 'node:https'
import { createSign } from 'node:crypto'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from './logger.js'
import { TOOL_TIMEOUTS } from './tool-timeouts.js'

const TOKENS_PATH = join(homedir(), '.config', 'google-calendar-mcp', 'tokens.json')
const CLIENT_CREDS_PATH = join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json')

// Service-account credentials. WHY this exists alongside the OAuth path
// (2026-08-20): the OAuth app is in Google's "Testing" state, where a refresh
// token dies after 7 DAYS -- the owner would have to re-consent every week,
// forever. Publishing the app would end that, but the app asks for
// `gmail.modify` and `drive.readonly`, which Google classes as RESTRICTED and
// gates behind verification plus a security audit.
//
// A service account sidesteps the whole problem for Calendar and Drive: it is
// a machine identity with its own address, no consent screen, and no expiry.
// The owner SHARES the calendar / Drive folders with that address, which is
// the same act they were going to perform anyway. Gmail is the one thing it
// cannot do -- a service account cannot read a consumer gmail.com mailbox
// without Workspace domain-wide delegation -- so the OAuth path below stays
// as the Gmail route and as the fallback wherever no key file is installed.
const SERVICE_ACCOUNT_PATH = join(homedir(), '.config', 'marveen', 'google-service-account.json')

// One token covers both APIs: Google accepts a space-separated scope claim in
// the JWT, so we do not need a token per API.
//
// READ and WRITE are deliberately SEPARATE tokens with different scopes. A
// service account can mint any scope it likes without asking anyone, which is
// exactly why the read path must not carry write rights: a bug in a read call
// then cannot damage anything, no matter what it does.
//
// The write scope is `drive.file`, NOT `drive`: it covers only files this
// application itself created, so it cannot touch the owner's existing
// documents even by mistake. Editing a file the owner made would need the full
// `drive` scope -- if that is ever genuinely required, it should be a
// deliberate, separately reasoned change, not a widening slipped in here.
const SERVICE_ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ')

/** Write scope: only files this application created. See the note above. */
const SERVICE_ACCOUNT_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

interface TokenData {
  access_token: string
  refresh_token: string
  expiry_date: number
  token_type: string
  scope: string
}

interface ClientCredentials {
  installed: {
    client_id: string
    client_secret: string
    token_uri: string
  }
}

interface CalendarEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  status?: string
  location?: string
  description?: string
  attendees?: Array<{ email: string; responseStatus?: string; displayName?: string }>
}

interface CalendarListResponse {
  items?: CalendarEvent[]
}

interface CalendarSummary {
  id: string
  summary?: string
  primary?: boolean
  accessRole?: string
}

interface CalendarListEntries {
  items?: CalendarSummary[]
}

// Token cache + mtime-invalidation. The cache spares us a JSON parse on
// every calendar fetch, but a stale cache kills the heartbeat after
// an out-of-process re-auth (the OAuth-mcp `auth` subcommand writes a fresh
// tokens.json from a separate process, our cache never re-reads it). Track
// the file's mtime alongside the parsed payload; re-read whenever the mtime
// advances. 2026-06-02 14:30 incident: after Szabi re-authed at 16:26 the
// dashboard kept dropping `Google token refresh failed` until a manual
// process restart, because cachedTokens held the pre-re-auth (88-day-old,
// already-revoked) refresh_token.
let cachedTokens: { normal: TokenData; mtimeMs: number } | null = null
let cachedClient: { value: ClientCredentials; mtimeMs: number } | null = null

function loadTokens(): TokenData {
  let currentMtime = 0
  try { currentMtime = statSync(TOKENS_PATH).mtimeMs } catch { /* file missing -- fall through to readFileSync error */ }
  if (!cachedTokens || cachedTokens.mtimeMs !== currentMtime) {
    const parsed = JSON.parse(readFileSync(TOKENS_PATH, 'utf-8'))
    cachedTokens = { normal: parsed.normal, mtimeMs: currentMtime }
  }
  return cachedTokens.normal
}

function saveTokens(tokens: TokenData): void {
  writeFileSync(TOKENS_PATH, JSON.stringify({ normal: tokens }, null, 2))
  // Re-stat AFTER write so the next loadTokens() sees the matching mtime
  // and uses the freshly-written content from cache rather than triggering
  // an extra re-read on the very next call.
  let mtimeMs = 0
  try { mtimeMs = statSync(TOKENS_PATH).mtimeMs } catch { /* unlikely right after writeFileSync */ }
  cachedTokens = { normal: tokens, mtimeMs }
}

function loadClientCredentials(): ClientCredentials {
  // mtime-invalidated like loadTokens above. Client credentials rotate rarely,
  // but a bare `if (!cachedClient)` would hold a stale payload forever after an
  // out-of-process credentials rewrite. Re-read whenever the file's mtime advances.
  let currentMtime = 0
  try { currentMtime = statSync(CLIENT_CREDS_PATH).mtimeMs } catch { /* missing -- fall through to readFileSync error */ }
  if (!cachedClient || cachedClient.mtimeMs !== currentMtime) {
    cachedClient = { value: JSON.parse(readFileSync(CLIENT_CREDS_PATH, 'utf-8')), mtimeMs: currentMtime }
  }
  return cachedClient.value
}

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

let cachedServiceAccount: { value: ServiceAccountKey; mtimeMs: number } | null = null

/** True when a service-account key is installed. Cheap enough to call per request. */
export function hasServiceAccount(): boolean {
  try {
    statSync(SERVICE_ACCOUNT_PATH)
    return true
  } catch {
    return false
  }
}

function loadServiceAccount(): ServiceAccountKey {
  // Same mtime-invalidation contract as loadTokens: a key rotated by another
  // process must not be masked by our in-memory copy.
  let currentMtime = 0
  try { currentMtime = statSync(SERVICE_ACCOUNT_PATH).mtimeMs } catch { /* fall through to readFileSync error */ }
  if (!cachedServiceAccount || cachedServiceAccount.mtimeMs !== currentMtime) {
    const parsed = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8')) as ServiceAccountKey
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Service-account key is missing client_email or private_key')
    }
    cachedServiceAccount = { value: parsed, mtimeMs: currentMtime }
  }
  return cachedServiceAccount.value
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Build the RS256-signed assertion Google exchanges for an access token.
 *
 * Exported for tests: the claims are the whole contract here, and they are
 * checkable without a network call. `iat` is backdated by 10s because Google
 * rejects an assertion whose `iat` is in the future, and small clock skew
 * between this machine and Google is normal.
 */
export function buildServiceAccountJwt(
  sa: ServiceAccountKey,
  scopes: string,
  nowMs: number,
): string {
  const iat = Math.floor(nowMs / 1000) - 10
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: scopes,
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }))
  const signingInput = `${header}.${claims}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key)
  return `${signingInput}.${base64url(signature)}`
}

// Access tokens live an hour; cache until 5 minutes before expiry so a burst
// of calls costs one token exchange, not one per call. Keyed BY SCOPE: a single
// cache would hand a read caller whichever token happened to be minted last,
// which is the one way the read/write split above could quietly stop holding.
const cachedSaTokens = new Map<string, { token: string; expiresAtMs: number }>()

async function getServiceAccountAccessToken(forceNew = false, scopes = SERVICE_ACCOUNT_SCOPES): Promise<string> {
  const cached = cachedSaTokens.get(scopes)
  if (!forceNew && cached && Date.now() < cached.expiresAtMs - 5 * 60 * 1000) {
    return cached.token
  }
  const sa = loadServiceAccount()
  const assertion = buildServiceAccountJwt(sa, scopes, Date.now())
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })
  const { status, data } = await httpsRequest(
    sa.token_uri || 'https://oauth2.googleapis.com/token',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    params.toString(),
  )
  if (status !== 200) {
    // Do NOT keep a stale token around after a failed exchange -- a revoked
    // key must surface as an error, not as a silently reused old token.
    cachedSaTokens.delete(scopes)
    logger.error({ status, body: data }, 'Google service-account token exchange failed')
    throw new Error(`Service-account token exchange failed: ${status}`)
  }
  const parsed = JSON.parse(data) as { access_token: string; expires_in: number }
  const entry = {
    token: parsed.access_token,
    expiresAtMs: Date.now() + parsed.expires_in * 1000,
  }
  cachedSaTokens.set(scopes, entry)
  logger.info({ write: scopes === SERVICE_ACCOUNT_WRITE_SCOPE }, 'Google service-account access token issued')
  return entry.token
}

/**
 * WHICH DEADLINE APPLIES, DERIVED FROM WHERE THE CALL GOES.
 *
 * This used to be a default parameter (`= TOOL_TIMEOUTS['google-calendar']`),
 * and that shape has now cost us twice. Drive needed a longer budget and got
 * the calendar's until someone passed the argument (2026-08-20); then the OAuth
 * token exchange turned out to be doing the same thing, silently, because it
 * also omits the argument -- and a token step capped at 5s makes every leg
 * report that the CALENDAR timed out (2026-08-24, card f4c59571).
 *
 * A caller cannot forget a value it never supplies. The endpoint decides.
 */
export function timeoutForUrl(url: string): number {
  // Parsed, not substring-matched. A calendar id is interpolated into the
  // events URL, and `includes('/token')` would hand the AUTH budget to a
  // calendar whose id merely contains that word. Path and host, nothing else.
  let host = ''
  let path = url
  try {
    const u = new URL(url)
    host = u.host
    path = u.pathname
  } catch {
    /* unparseable: fall through to the substring checks below */
  }
  if (host === 'oauth2.googleapis.com' || path === '/token') return TOOL_TIMEOUTS['google-auth']
  // `/upload/drive/` matters as much as `/drive/`: the create path uploads a
  // multipart body and is the slowest call we make.
  if (path.startsWith('/drive/') || path.startsWith('/upload/drive/')) {
    return TOOL_TIMEOUTS['google-drive']
  }
  return TOOL_TIMEOUTS['google-calendar']
}

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string,
  // Still overridable, but no longer a HIDDEN default: when nothing is passed
  // the deadline comes from the endpoint, not from whichever constant happened
  // to be written here.
  timeoutMs: number = timeoutForUrl(url),
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          data: Buffer.concat(chunks).toString('utf-8'),
        })
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => {
      // Name the HOST. "Google API request timed out" sent every reader to the
      // Calendar API, when the call that died was the token exchange.
      let host = url
      try { host = new URL(url).host } catch { /* keep the raw url */ }
      req.destroy(new Error(`Google request to ${host} timed out after ${timeoutMs}ms`))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function refreshAccessToken(): Promise<string> {
  const tokens = loadTokens()
  const client = loadClientCredentials()

  const params = new URLSearchParams({
    client_id: client.installed.client_id,
    client_secret: client.installed.client_secret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  })

  const { status, data } = await httpsRequest(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    params.toString()
  )

  if (status !== 200) {
    logger.error({ status, body: data }, 'Google token refresh failed')
    throw new Error(`Token refresh failed: ${status}`)
  }

  const refreshed = JSON.parse(data)
  const updated: TokenData = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + (refreshed.expires_in * 1000),
  }
  saveTokens(updated)
  logger.info('Google access token refreshed')
  return updated.access_token
}

/**
 * One access token for whichever auth path this install has.
 *
 * The service account WINS when its key is present, and that ordering is
 * deliberate: it is the path that does not expire, so an install that has both
 * should never drift back onto the weekly-re-consent one. Installs without the
 * key file keep the OAuth behaviour unchanged.
 */
async function getValidAccessToken(): Promise<string> {
  if (hasServiceAccount()) return getServiceAccountAccessToken()
  const tokens = loadTokens()
  // Refresh if token expires within 5 minutes
  if (Date.now() > tokens.expiry_date - 5 * 60 * 1000) {
    return refreshAccessToken()
  }
  return tokens.access_token
}

/**
 * Force a brand-new access token after a mid-flight 401, on whichever path is
 * active. Without this the 401 retry below would call the OAuth refresh even on
 * a service-account install, and fail on the missing tokens.json.
 */
async function forceNewAccessToken(): Promise<string> {
  if (hasServiceAccount()) return getServiceAccountAccessToken(true)
  return refreshAccessToken()
}

/**
 * The outcome of a calendar read, as a value the caller cannot ignore.
 *
 * WHY THIS IS NOT `CalendarEvent[]` (2026-08-22). The previous shape returned
 * `[]` on every failure -- missing key file, 403 on an unshared calendar, 404
 * on a typo'd id, a 500 from Google -- and `[]` is also what a genuinely quiet
 * day returns. The heartbeat then rendered "Nincs kozelgo esemeny." and the
 * notification gate read `calendar.length > 0`, so a BROKEN calendar was
 * indistinguishable from a free afternoon AND suppressed the very notification
 * that would have surfaced it. The error was logged, and nothing reads the log.
 *
 * Email already learned this on 2026-08-20 (`emailError` in heartbeat.ts):
 * "no mail" and "we could not look" must never render the same. Calendar was
 * left on the old shape for two days. This closes that asymmetry, and it does
 * it in the TYPE rather than in a convention, so the next caller cannot
 * reintroduce the bug by forgetting to check.
 */
export type CalendarFetch =
  | { ok: true; events: CalendarEvent[] }
  | { ok: false; error: string }

/** One short line, no newlines, no credentials -- safe to render into a prompt.
 *  Exported for the test that pins that contract. */
export function calendarApiError(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    detail = parsed.error?.message ?? ''
  } catch {
    detail = body
  }
  const flat = detail.replace(/\s+/g, ' ').trim().slice(0, 160)
  return flat ? `HTTP ${status}: ${flat}` : `HTTP ${status}`
}

/**
 * A thrown value rendered so the string is NEVER empty. Card 7f3e1357.
 *
 * Measured on the live install at 15:00:28 on 2026-08-27:
 * `{"ok":false,"via":"dist","error":""}`, then green again in the same minute.
 * `err.message` is empty often enough to matter -- an aborted socket, a
 * `new Error()` with no text -- and the old line trimmed that to `''` and
 * passed it on.
 *
 * An empty `error` is worse here than a vague one, because the morning
 * briefing was changed (card f5aee23d) to stop saying "no calendar" and quote
 * this string VERBATIM. Empty text turns that instruction into an empty
 * explanation: the owner is told something failed and nothing else. The name
 * of the exception is not much, but it is the difference between "AbortError"
 * and silence.
 */
export function describeThrown(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.replace(/\s+/g, ' ').trim()
    const name = err.name?.trim() || 'Error'
    // Name AND message when both exist, because the name is what survives a
    // message that turns out to be useless.
    return (msg ? `${name}: ${msg}` : name).slice(0, 160)
  }
  // A non-Error throw is labelled when its rendering carries nothing on its
  // own. An emptiness check alone is not enough: `String(undefined)` is the
  // non-empty string "undefined", and `String({})` is "[object Object]" --
  // both pass a length test and still tell the reader nothing, which would be
  // a fresh version of this very defect in a briefing that prints the field
  // verbatim. A thrown string like "boom" IS its own explanation and is left
  // alone. (Both halves are pinned by controls in the test; the first draft of
  // this function failed one of them each way round.)
  const text = String(err).replace(/\s+/g, ' ').trim()
  const uninformative = text === '' || text === 'undefined' || text === 'null' || /^\[object \w+\]$/.test(text)
  return (uninformative ? `nem-Error ertek dobva (${typeof err}): ${text || '<ures>'}` : text).slice(0, 160)
}

export async function fetchCalendarEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarFetch> {
  // An unset id would hit `/calendars//events` and come back 404, which reads
  // like a missing calendar rather than a missing setting. Name the real cause.
  if (!calendarId.trim()) {
    return { ok: false, error: 'HEARTBEAT_CALENDAR_ID nincs beallitva (ures)' }
  }

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20',
  })

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`

  try {
    const token = await getValidAccessToken()

    const { status, data } = await httpsRequest(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (status === 401) {
      // Token expired mid-flight, refresh and retry once
      const newToken = await forceNewAccessToken()
      const retry = await httpsRequest(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${newToken}` },
      })
      if (retry.status !== 200) {
        logger.error({ status: retry.status, body: retry.data }, 'Google Calendar API error after refresh')
        return { ok: false, error: calendarApiError(retry.status, retry.data) }
      }
      const parsed: CalendarListResponse = JSON.parse(retry.data)
      return { ok: true, events: parsed.items ?? [] }
    }

    if (status !== 200) {
      logger.error({ status, body: data }, 'Google Calendar API error')
      return { ok: false, error: calendarApiError(status, data) }
    }

    const parsed: CalendarListResponse = JSON.parse(data)
    return { ok: true, events: parsed.items ?? [] }
  } catch (err) {
    // Missing credential file, DNS failure, a socket timeout, unparseable
    // JSON. All of these used to surface as an empty calendar via the
    // caller's catch. They are failures, and they say so now.
    logger.error({ err }, 'Google Calendar fetch threw')
    return { ok: false, error: describeThrown(err) }
  }
}

/**
 * Every calendar this identity can read.
 *
 * WHY this exists (2026-08-20): on the OAuth path `primary` is the owner's own
 * calendar, so nothing else was needed. On the service-account path `primary`
 * is the MACHINE account's calendar, which is permanently empty -- the owner's
 * calendar shows up only as a SHARED entry, keyed by their address. Reading
 * `primary` there returns 200 and zero events, which is the worst kind of
 * failure: it looks like "no meetings today". Callers pick the real calendar
 * from this list instead of assuming `primary`.
 */
export async function listCalendars(): Promise<CalendarSummary[]> {
  const token = await getValidAccessToken()
  const url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'
  const { status, data } = await httpsRequest(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (status === 401) {
    const newToken = await forceNewAccessToken()
    const retry = await httpsRequest(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${newToken}` },
    })
    if (retry.status !== 200) {
      logger.error({ status: retry.status, body: retry.data }, 'Google calendarList error after refresh')
      return []
    }
    return (JSON.parse(retry.data) as CalendarListEntries).items ?? []
  }
  if (status !== 200) {
    logger.error({ status, body: data }, 'Google calendarList error')
    return []
  }
  return (JSON.parse(data) as CalendarListEntries).items ?? []
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  /** Absent for Google-native documents -- they have no byte size until exported. */
  size?: string
}

interface DriveListResponse {
  files?: DriveFile[]
}

/**
 * The `q` a list call actually sends.
 *
 * Pure and exported because the trashed-file rule is easy to lose in a later
 * edit and impossible to notice afterwards: a deleted file that still answers
 * queries looks like a live file, and nothing about the result says otherwise.
 */
export function driveListQuery(query?: string): string {
  return query ? `(${query}) and trashed = false` : 'trashed = false'
}

/**
 * Download URL for a file, which is NOT the same endpoint for every file.
 *
 * Google-native documents (Docs, Sheets, Slides) have no downloadable bytes:
 * `?alt=media` answers 403 for them, and they must go through `/export` with a
 * target type. Pure and exported because that 403 is the most misleading error
 * in this module -- it reads as a permission problem, which sends you checking
 * the sharing settings of a file that was shared correctly all along.
 */
export function driveDownloadUrl(fileId: string, mimeType?: string): string {
  const id = encodeURIComponent(fileId)
  return (mimeType ?? '').startsWith('application/vnd.google-apps.')
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fplain`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
}

/**
 * Files this identity can see on Drive.
 *
 * On the service-account path that means exactly what the owner SHARED with
 * the machine address -- the account owns no files of its own, so an empty
 * list means "nothing shared yet", not "no files exist". Worth stating because
 * the empty list is the state a caller will hit first, and it is easy to read
 * as a failure.
 *
 * `query` takes Drive's own search syntax (e.g. `name contains 'arlista'`).
 * Trashed files are excluded unless the caller asks otherwise: a deleted file
 * that still answers queries is the kind of thing nobody expects.
 */
export async function listDriveFiles(query?: string, pageSize = 50): Promise<DriveFile[]> {
  const token = await getValidAccessToken()
  const q = driveListQuery(query)
  const params = new URLSearchParams({
    q,
    pageSize: String(Math.min(Math.max(pageSize, 1), 1000)),
    fields: 'files(id,name,mimeType,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
  })
  const url = `https://www.googleapis.com/drive/v3/files?${params}`

  const { status, data } = await httpsRequest(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (status === 401) {
    const newToken = await forceNewAccessToken()
    const retry = await httpsRequest(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${newToken}` },
    })
    if (retry.status !== 200) {
      logger.error({ status: retry.status, body: retry.data }, 'Google Drive list error after refresh')
      return []
    }
    return (JSON.parse(retry.data) as DriveListResponse).files ?? []
  }
  if (status !== 200) {
    logger.error({ status, body: data }, 'Google Drive list error')
    return []
  }
  return (JSON.parse(data) as DriveListResponse).files ?? []
}

/**
 * A Drive file's contents as text.
 *
 * Google-native documents (Docs, Sheets, Slides) have no downloadable bytes --
 * `?alt=media` returns 403 for them. They must go through the EXPORT endpoint
 * with a target type instead. Getting this wrong looks like a permission
 * problem, which sends you off checking the sharing settings for a file that
 * was shared correctly all along.
 *
 * Returns null on failure rather than throwing: a caller summarising several
 * files should lose the one it could not read, not the whole summary. The
 * failure is logged, so it is never silent.
 *
 * Binary formats (PDF, images) are NOT decoded here -- a PDF read as UTF-8 is
 * mojibake that looks like data. Callers that need those should fetch the
 * bytes and use a real extractor.
 */
export async function readDriveFileText(fileId: string, mimeType?: string): Promise<string | null> {
  const token = await getValidAccessToken()
  const isGoogleNative = (mimeType ?? '').startsWith('application/vnd.google-apps.')
  const url = driveDownloadUrl(fileId, mimeType)

  const { status, data } = await httpsRequest(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (status === 401) {
    const newToken = await forceNewAccessToken()
    const retry = await httpsRequest(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${newToken}` },
    })
    if (retry.status !== 200) {
      logger.error({ status: retry.status, fileId }, 'Google Drive read error after refresh')
      return null
    }
    return retry.data
  }
  if (status !== 200) {
    logger.error({ status, fileId, isGoogleNative }, 'Google Drive read error')
    return null
  }
  return data
}

/**
 * Create a NEW Google Doc from plain text and return its id.
 *
 * Deliberately a CREATE, not an update of something the owner wrote. The first
 * time this ran, the task was "restructure my ideas document" -- and replacing
 * that document wholesale would put the owner's own notes behind an undo he
 * did not ask for. A new file next to the original is reversible by ignoring
 * it, and the two can be compared side by side. Overwriting someone's
 * document should be a separate, explicitly requested act.
 *
 * The narrow `drive.file` scope makes that a property of the credential rather
 * than of my restraint: this token CANNOT touch a file it did not create.
 *
 * Returns null on failure (logged), so a caller mid-way through a longer job
 * loses this step and not the job.
 */
export async function createDriveDoc(
  name: string,
  text: string,
  parentFolderId?: string,
): Promise<string | null> {
  const token = await getServiceAccountAccessToken(false, SERVICE_ACCOUNT_WRITE_SCOPE)
  const boundary = `marveen-${Date.now().toString(36)}`
  const metadata: Record<string, unknown> = {
    name,
    // Uploading text/plain with this target type makes Drive convert it into a
    // real Google Doc rather than storing a .txt the owner has to open in
    // another app.
    mimeType: 'application/vnd.google-apps.document',
  }
  if (parentFolderId) metadata.parents = [parentFolderId]

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  const { status, data } = await httpsRequest(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body).toString(),
      },
    },
    body,
  )
  if (status !== 200 && status !== 201) {
    logger.error({ status, body: data.slice(0, 300) }, 'Google Drive create failed')
    return null
  }
  return (JSON.parse(data) as { id?: string }).id ?? null
}

export type { CalendarEvent, CalendarSummary, DriveFile }

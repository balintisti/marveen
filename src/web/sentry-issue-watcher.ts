// I/O for the Sentry unresolved-issue reader. The DECISIONS live in
// ../sentry-issues.ts, which has zero imports and is unit-tested; this file only
// fetches, parses, enqueues, and reads back.
//
// WHY A POLLER AND NOT THE SCHEDULE (card 21634d17, and it is the closing
// condition, not a preference): the `sentry-or` schedule runs as an injected
// prompt on an agent turn, and on 09-05 its 15:23 slot retried 628 times against
// `busy` without ever running -- during the one hour that day when 135 commits
// went live. A prompt-driven reader inherits exactly that withholding. This runs
// on the dashboard's interval, out of `dist/`; there is no turn to hold back.
//
// WHY NOT MCP: the read was first measured through the Sentry MCP server
// (`~/.mcp.json`, https://mcp.sentry.dev/mcp). MCP tools exist ONLY inside an
// agent turn, so that path satisfies "reading works" and contradicts "must not
// depend on a turn". The REST path resolves both, and it needed a credential
// that did not exist on 09-05 and does now (`sentry_olvaso_token`, vault,
// provisioned 09-05 20:37).
//
// THE TOKEN NEVER TOUCHES A COMMAND LINE -- it is read from the vault in-process
// and sent in an Authorization header, never as an argv element where `ps` would
// show it to every process on the machine (card 38bd8366).
//
// MEASURED, so it is not assumed: the token answers 200 to the issues endpoint
// and 403 to a status write (2026-09-06). This reader cannot change anything in
// Sentry even if it tried.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger.js'
import { MAIN_AGENT_ID, PROJECT_ROOT } from '../config.js'
import { createAgentMessage, getAgentMessage } from '../db.js'
import { getSecret } from './vault.js'
import { redactSecrets, type Probe } from './uptime-alert-watcher.js'
import {
  decideSentryIssues,
  buildSentryNotice,
  buildUnreadableSentryNotice,
  NO_SENTRY_STATE,
  type SentryIssue,
  type SentryIssueState,
  type SentryReading,
} from '../sentry-issues.js'

/**
 * Ten minutes.
 *
 * MEASURED CEILING, not a guess: the API answers with
 * `x-sentry-rate-limit-limit: 10` over a SHORT window (the reset stamp had
 * already passed by the time the response was read, so the window is seconds,
 * not a daily quota). A tick costs one org-list call plus one call per org --
 * three today. Ten minutes leaves the budget untouched while keeping the lag
 * below the interval at which anyone would act on an error anyway.
 */
const INTERVAL_MS = 600_000
/** Offset from the uptime poller's 45s so two cold starts do not collide. */
const INITIAL_DELAY_MS = 90_000

const VAULT_KEY = 'sentry_olvaso_token'
const API_ROOT = 'https://sentry.io/api/0'
const FETCH_TIMEOUT_MS = 15_000
/** Cap on any borrowed text (HTTP body, error message) that can reach the queue. */
const MAX_REASON_CHARS = 300
/**
 * How far back an issue may have been last seen and still count as standing.
 * 90 days matches what the card measured; a shorter window would silently drop
 * long-running issues and make the count look like progress.
 */
const STATS_PERIOD = '90d'
/** Sentry's own page cap for this endpoint. */
const PAGE_LIMIT = 100

/**
 * Where the ONE surviving number lives -- card 65a324b2.
 *
 * Everything else stays in memory on purpose: a restart re-seeds, so the next
 * tick reports the standing total once rather than replaying the backlog issue
 * by issue. What that rule also swallowed was an issue that FIRST APPEARED
 * while the process was down, and a single watermark is enough to stop it,
 * because `firstSeen` already travels with every issue. A file with one field,
 * not a table.
 */
export const SENTRY_WATERMARK_PATH = join(PROJECT_ROOT, 'store', 'sentry-issue-watermark.json')

/**
 * Read the watermark. EVERY failure means "no watermark", never a crash and
 * never a zero: a missing file is a first run, and a corrupt one must not be
 * read as 1970, which would classify the entire backlog as arrivals.
 */
export function loadWatermark(path = SENTRY_WATERMARK_PATH): number | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const v = (raw as { lastReadAtMs?: unknown } | null)?.lastReadAtMs
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * Persist the watermark. A failure here is logged and NOT thrown: losing the
 * watermark costs one gap's worth of silence, while throwing would take down
 * the tick that was about to report actual issues.
 */
export function saveWatermark(ms: number | undefined, path = SENTRY_WATERMARK_PATH): void {
  if (ms == null) return
  try {
    writeFileSync(path, `${JSON.stringify({ lastReadAtMs: ms }, null, 2)}\n`, 'utf8')
  } catch (err) {
    logger.warn(`[sentry] could not persist the read watermark: ${String(err)}`)
  }
}

// In-memory apart from the watermark above, which is loaded once at module
// start so the FIRST tick of a new process can tell a gap arrival from backlog.
let state: SentryIssueState = { ...NO_SENTRY_STATE, lastReadAtMs: loadWatermark() }

/** Test seam: reset the module's memory between cases. */
export function __resetSentryState(watermark?: number): void {
  state = watermark == null ? NO_SENTRY_STATE : { ...NO_SENTRY_STATE, lastReadAtMs: watermark }
}

function token(): Probe<string> {
  try {
    const t = getSecret(VAULT_KEY)
    // NULL AND THROW ARE DIFFERENT CAUSES and must not collapse: a missing entry
    // is an operator action (add the secret), an unreadable vault is a broken
    // install. A single "no token" reason would send the reader to the wrong one.
    if (t == null || t.length === 0) {
      return { ok: false, reason: `vault has no '${VAULT_KEY}' entry (or it is empty)` }
    }
    return { ok: true, value: t }
  } catch (err) {
    const msg = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_CHARS)
    return { ok: false, reason: `vault read for '${VAULT_KEY}' threw: ${msg}` }
  }
}

async function getJson(url: string, tok: string): Promise<Probe<unknown>> {
  const where = url.split('?')[0]
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn({ status: res.status, url: where }, 'sentry reader: API call failed')
      // The STATUS is the diagnosis: 401 is the token, 403 is its scope, 404 is
      // the org slug, 429 is the rate limit, 5xx is Sentry. Collapsing them into
      // null is the defect this card is about, one layer out.
      return { ok: false, reason: `HTTP ${res.status} from ${where}` }
    }
    return { ok: true, value: await res.json() }
  } catch (err) {
    logger.warn({ err, url: where }, 'sentry reader: API call threw')
    const msg = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_CHARS)
    return { ok: false, reason: `request to ${where} threw: ${msg}` }
  }
}

/**
 * Org slugs, READ rather than hardcoded.
 *
 * The uptime poller made this a requirement for its alert condition and the
 * reason carries: the day an org is added or renamed, a hardcoded list keeps
 * answering the old question and nothing about its output looks wrong. Two orgs
 * answer today (`delta-crm`, `agrotech-cv`) -- and the second one is exactly the
 * kind of thing a hardcoded list would have missed.
 */
export function orgsFromPayload(payload: unknown): string[] {
  if (!Array.isArray(payload)) return []
  return payload
    .map(o => (o as { slug?: unknown } | null)?.slug)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
}

/** Flatten Sentry's issue payload, keeping ABSENT distinct from zero/empty. */
export function issuesFromPayload(payload: unknown, org: string): SentryIssue[] {
  if (!Array.isArray(payload)) return []
  const out: SentryIssue[] = []
  for (const raw of payload) {
    const o = raw as Record<string, unknown> | null
    const id = o?.id
    if (typeof id !== 'string' || id.length === 0) continue
    const str = (k: string): string | null => (typeof o?.[k] === 'string' ? (o[k] as string) : null)
    // `count` arrives as a STRING from this endpoint. Number(null) is 0, which
    // would read as "harmless" -- so an absent count stays null, not zero.
    const rawCount = o?.count
    const count =
      typeof rawCount === 'number'
        ? rawCount
        : typeof rawCount === 'string' && rawCount.trim() !== '' && Number.isFinite(Number(rawCount))
          ? Number(rawCount)
          : null
    out.push({
      id,
      org,
      shortId: str('shortId'),
      title: str('title') ?? '(untitled)',
      culprit: str('culprit'),
      level: str('level'),
      count,
      firstSeen: str('firstSeen'),
      lastSeen: str('lastSeen'),
      permalink: str('permalink'),
    })
  }
  return out
}

/**
 * Enqueue and READ BACK.
 *
 * A write counts as done when the row comes back, not when the call returns. An
 * alert path whose own delivery fails silently is the defect being fixed, so it
 * would be a poor joke to build it on an unverified insert.
 */
function enqueueVerified(content: string): boolean {
  try {
    const msg = createAgentMessage('system', MAIN_AGENT_ID, content)
    const back = getAgentMessage(msg.id)
    if (back == null || back.content !== content) {
      logger.error({ id: msg.id }, 'sentry reader: notice did NOT read back after insert')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, 'sentry reader: failed to enqueue notice')
    return false
  }
}

export async function sentryTick(now = Date.now()): Promise<void> {
  const tokenProbe = token()

  // NO TOKEN IS AN ALERT, NOT A QUIET SKIP. This is the whole point of the card:
  // the failure that looks like silence looks like health. Note the reading is
  // built with ZERO orgs queried, so the decision reports `blind` -- it does not
  // report a clean zero.
  if (!tokenProbe.ok) {
    const reading: SentryReading = { issues: [], orgsQueried: [], orgsFailed: [] }
    const decision = decideSentryIssues(reading, state, now)
    // PERSIST ON THIS PATH TOO, or the re-announce window never advances on the
    // likeliest blind path of all -- and the branch that most needs the hourly
    // cap would be the one branch without it.
    state = decision.next
    saveWatermark(state.lastReadAtMs)
    const notice = buildUnreadableSentryNotice(decision, reading, now)
    if (notice != null) enqueueVerified(`${notice} (cause: ${tokenProbe.reason})`)
    return
  }

  const tok = tokenProbe.value
  const orgProbe = await getJson(`${API_ROOT}/organizations/`, tok)
  const orgs = orgsFromPayload(orgProbe.ok ? orgProbe.value : null)

  if (orgs.length === 0) {
    const reading: SentryReading = { issues: [], orgsQueried: [], orgsFailed: [] }
    const decision = decideSentryIssues(reading, state, now)
    state = decision.next
    saveWatermark(state.lastReadAtMs)
    const notice = buildUnreadableSentryNotice(decision, reading, now)
    if (notice != null) {
      // The org list FAILING and the account having no orgs are different facts.
      // Both are loud, but they send the reader to different places.
      const why = orgProbe.ok
        ? 'the org list came back EMPTY with a clean response -- the token may have no org access'
        : `the org list call FAILED -- ${orgProbe.reason}`
      enqueueVerified(`${notice} (${why})`)
    }
    return
  }

  const issues: SentryIssue[] = []
  const orgsFailed: { org: string; reason: string }[] = []
  for (const org of orgs) {
    const q = new URLSearchParams({
      query: 'is:unresolved',
      statsPeriod: STATS_PERIOD,
      limit: String(PAGE_LIMIT),
    })
    const probe = await getJson(`${API_ROOT}/organizations/${encodeURIComponent(org)}/issues/?${q}`, tok)
    if (!probe.ok) {
      orgsFailed.push({ org, reason: probe.reason })
      continue
    }
    issues.push(...issuesFromPayload(probe.value, org))
  }

  const reading: SentryReading = { issues, orgsQueried: orgs, orgsFailed }
  const decision = decideSentryIssues(reading, state, now)
  state = decision.next
  saveWatermark(state.lastReadAtMs)

  const unreadable = buildUnreadableSentryNotice(decision, reading, now)
  if (unreadable != null) enqueueVerified(unreadable)
  const notice = buildSentryNotice(decision)
  if (notice != null) enqueueVerified(notice)
}

export function startSentryIssueWatcher(): NodeJS.Timeout {
  setTimeout(() => { void sentryTick() }, INITIAL_DELAY_MS)
  return setInterval(() => { void sentryTick() }, INTERVAL_MS)
}

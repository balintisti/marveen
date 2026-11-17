// Live wiring of the scheduler-entry census (card fe838f28) behind the pure rules in
// ../scheduler-census.ts: which stores, where the state lives, who gets the report.
//
// Every 15 minutes, so an entry is reported well inside the card's one-hour bound even when a
// round is skipped. The report goes to the front desk (074149c2 stage 2), on any doubt to the
// coordinator. The state is written only AFTER the report was stored: a failed send is retried on
// the next round instead of being marked as reported.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../logger.js'
import { LEGACY_APP_SERVICE_LABEL, PROJECT_ROOT, SERVICE_ID, appServiceLabel } from '../config.js'
import { createAgentMessage } from '../db.js'
import { withFrontDeskHeader, type FrontDeskNotice } from '../front-desk.js'
import { resolveMachineNoticeRecipient } from './front-desk-route.js'
import { atomicWriteFileSync } from './atomic-write.js'
import { AGENTS_BASE_DIR, listAllAgentNames } from './agent-config.js'
import {
  buildCensusReport, deriveKnownGood, diffCensus, parseCensusState,
  readAtQueue, readCrontab, readCronFile, readLaunchAgents, readScheduledTasks,
  type CensusExec, type CensusRound, type StoreReading,
} from '../scheduler-census.js'

const INTERVAL_MS = 15 * 60_000
const INITIAL_DELAY_MS = 2 * 60_000
export const SCHEDULER_CENSUS_STATE_PATH = join(PROJECT_ROOT, 'store', 'scheduler-census-state.json')
/** The subject of the front-desk notice. Not an agent: the router only needs it non-empty. */
export const SCHEDULER_CENSUS_SUBJECT = 'scheduler-census'

export interface SchedulerCensusDeps {
  home: string
  repoRoot: string
  serviceId: string
  extraLabels: readonly string[]
  /** Project directories whose `.claude/` may hold Claude Code's durable cron file. */
  projectDirs: readonly string[]
  exec: CensusExec
  statePath: string
  /** Store the report; false (or a throw) = not delivered, the state is not advanced. */
  send: (text: string) => boolean
  nowIso: () => string
}

const realExec: CensusExec = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { encoding: 'utf-8', timeout: 15_000 })
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    ...(r.error ? { error: String((r.error as NodeJS.ErrnoException).code ?? r.error.message) } : {}),
  }
}

/** The default sender: front desk, fail-open to the coordinator (resolveMachineNoticeRecipient). */
export function sendToFrontDesk(text: string): boolean {
  const route = resolveMachineNoticeRecipient([SCHEDULER_CENSUS_SUBJECT])
  const notice: FrontDeskNotice = { type: 'scheduler-census', subjects: [SCHEDULER_CENSUS_SUBJECT], reason: 'unknown-scheduler-entry' }
  createAgentMessage('system', route.to, withFrontDeskHeader(route, notice, text))
  return true
}

function defaultDeps(): SchedulerCensusDeps {
  let agents: string[] = []
  try { agents = listAllAgentNames() } catch (err) { logger.warn({ err }, 'scheduler-census: agent list unreadable') }
  return {
    home: homedir(),
    repoRoot: PROJECT_ROOT,
    serviceId: SERVICE_ID,
    extraLabels: [appServiceLabel(SERVICE_ID), LEGACY_APP_SERVICE_LABEL],
    projectDirs: [PROJECT_ROOT, ...agents.map((a) => join(AGENTS_BASE_DIR, a))],
    exec: realExec,
    statePath: SCHEDULER_CENSUS_STATE_PATH,
    send: sendToFrontDesk,
    nowIso: () => new Date().toISOString(),
  }
}

/** All stores this census covers, in report order. */
export function readAllStores(d: Pick<SchedulerCensusDeps, 'home' | 'projectDirs' | 'exec'>): StoreReading[] {
  const cronFiles = [d.home, ...d.projectDirs].map((dir) => join(dir, '.claude', 'scheduled_tasks.json'))
  return [
    readCrontab(d.exec),
    readAtQueue(d.exec),
    readLaunchAgents(join(d.home, 'Library', 'LaunchAgents')),
    readScheduledTasks(join(d.home, '.claude', 'scheduled-tasks')),
    ...[...new Set(cronFiles)].map(readCronFile),
  ]
}

/** One round. Returns what it found and whether a report was stored (for tests and the log). */
export function runSchedulerCensusOnce(d: SchedulerCensusDeps = defaultDeps()): { round: CensusRound; reported: boolean } {
  let prevRaw: string | null = null
  try { prevRaw = readFileSync(d.statePath, 'utf-8') } catch { /* first round of this install */ }
  // A state file that exists but does not parse is treated as no state: the next report is a
  // baseline again (louder, never silent).
  const prev = prevRaw === null ? null : parseCensusState(prevRaw)
  const known = deriveKnownGood(d.repoRoot, d.serviceId, d.extraLabels)
  const round = diffCensus(readAllStores(d), known, prev, d.nowIso())
  const text = buildCensusReport(round, d.statePath)
  let reported = false
  if (text !== null) {
    try {
      reported = d.send(text)
    } catch (err) {
      logger.warn({ err }, 'scheduler-census: report could not be stored, state not advanced')
    }
    if (!reported) return { round, reported }
  }
  atomicWriteFileSync(d.statePath, JSON.stringify(round.next, null, 2))
  return { round, reported }
}

function tick(): void {
  try {
    const { round, reported } = runSchedulerCensusOnce()
    if (reported) {
      logger.info(
        { newEntries: round.newEntries.length, changed: round.changedEntries.length, unreached: round.unreached.length, baseline: round.baseline },
        'scheduler-census: report stored',
      )
    }
  } catch (err) {
    logger.warn({ err }, 'scheduler-census: round failed')
  }
}

export function startSchedulerCensusWatcher(): NodeJS.Timeout {
  setTimeout(tick, INITIAL_DELAY_MS)
  return setInterval(tick, INTERVAL_MS)
}

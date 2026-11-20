import {
  readFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { buildProcessLockContext } from './process-lock-context.js'
import type { Server as HttpServer } from 'node:http'
import { STORE_DIR, PID_FILENAME, WEB_PORT, MAIN_AGENT_ID, RESPAWN_ENABLED, HEARTBEAT_AGENT_ENABLED } from './config.js'
import { resolveOwnerChatId } from './owner-chat.js'
import { initDatabase, backfillEmbeddings } from './db.js'
import { runDecaySweep, runDailyDigest } from './memory.js'
import { DECAY_SWEEP_INTERVAL_MS } from './db.js'
import { initHeartbeat, stopHeartbeat, ensureHeartbeatWorkerHidden } from './heartbeat.js'
import { ensureHeartbeatAgent, shouldBootHeartbeatAgent, HEARTBEAT_AGENT_NAME } from './web/heartbeat-agent-scaffold.js'
import { startAgentProcess } from './web/agent-process.js'
import { runLogRotationSweep, LOG_ROTATION_SWEEP_MS } from './web/log-rotation.js'
import { sweepScheduledRunSnapshots } from './web/scheduled-run-snapshot.js'
import { renameSharedCredentialsIfSafe, fleetTokenBootPass } from './web/claude-credentials-guard.js'
import { startWebServer } from './web.js'
import { endAllDetachedGroups } from './web/detached-groups.js'
import { logger } from './logger.js'
import { startInviteMonitor, stopInviteMonitor } from './web/channel-invites.js'
import { ensureDiscordChannelGroup } from './web/discord-group-bootstrap.js'
import { startChannelRequestWatcher, stopChannelRequestWatcher } from './web/channel-request-watcher.js'
import { startStoreWatcher, stopStoreWatcher } from './store-watcher.js'
import { AGENTS_BASE_DIR } from './web/agent-config.js'
import {
  acquirePortLock,
  acquirePidfileLock,
  writeBufferFully,
  DeferToPeerError,
  ForeignPortHolderError,
  type ProcessLockContext,
  type PidfileLockContext,
} from './process-lock.js'

const BANNER = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
 ██████╗██╗      █████╗ ██╗    ██╗
██╔════╝██║     ██╔══██╗██║    ██║
██║     ██║     ███████║██║ █╗ ██║
██║     ██║     ██╔══██║██║███╗██║
╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝  (lite)
`

const PID_FILE = join(STORE_DIR, PID_FILENAME)
// Hard-kill timeout: if graceful shutdown (HTTP drain + releaseLock) has not
// finished in this window, exit so launchd's KeepAlive isn't blocked by a
// hung socket. closeAllConnections (Node 18.2+) normally drains in ms, but
// a browser tab holding a chunked response might still stall close().
const SHUTDOWN_HARD_KILL_MS = 5000
// Match own-UID node processes whose argv contains the dashboard binary
// path, followed by whitespace or end-of-string. The delimiters are load-
// bearing: without them, `\b` matched `dist/index.js.map`, `dist/index.js.bak`
// and other sibling files, and unrelated editor/bundler processes touching
// those files would get SIGKILLed on startup.
const DASHBOARD_BINARY_PATTERN = /(?:^|[\s/])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)/

// The process-lock I/O context (install roots, argv, cwd, ancestors, LISTEN
// holders) lives in process-lock-context.ts so the web server's EADDRINUSE
// reclaim uses the same install-affinity decision (card 77a48069).

function readRecordedPidFrom(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf-8').trim()
    // Strict parse: only pure digits. Guards against truncated writes
    // ("12345" partially landed as "1"), empty files from a crash between
    // openSync and writeSync, or accidental free-form content.
    if (!/^\d+$/.test(raw)) return null
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

// Legitimacy check for the PID recorded in the pidfile. True only if the PID
// looks like a previous dashboard instance (own UID + node/tsx + argv
// matches the binary pattern). Prevents the acquire loop from SIGTERMing an
// unrelated process whose PID happens to appear in a stale pidfile (PID
// recycling on long-lived systems is routine).
function isLegitimateDashboardPid(pid: number, procCtx: ProcessLockContext): boolean {
  const cmd = procCtx.getProcessCommand(pid)
  if (cmd == null) return false
  if (procCtx.uid != null) {
    const ownerUid = procCtx.getProcessUid(pid)
    if (ownerUid == null || ownerUid !== procCtx.uid) return false
  }
  if (!/node|tsx/i.test(cmd)) return false
  const matches = procCtx.listOwnProcessesMatching(DASHBOARD_BINARY_PATTERN)
  return matches.includes(pid)
}

function buildPidfileLockContext(procCtx: ProcessLockContext): PidfileLockContext {
  return {
    tryCreateExclusive(path, pid) {
      try {
        const fd = openSync(path, 'wx')
        try {
          // Short-writes can legally return fewer bytes than requested.
          // writeBufferFully loops until the buffer is fully drained; if
          // we crash mid-write the file is left truncated and
          // readRecordedPidFrom will reject it as non-digits.
          writeBufferFully(
            (b, off, len) => writeSync(fd, b, off, len),
            Buffer.from(String(pid)),
          )
        } finally {
          closeSync(fd)
        }
        return 'created'
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') return 'exists'
        throw err
      }
    },
    readRecordedPid(path) {
      return readRecordedPidFrom(path)
    },
    unlinkIfMatches(path, expected) {
      // Re-read just before unlink so a third party's freshly-won lock
      // (O_EXCL'd after our SIGTERM'd predecessor exited) survives. Not
      // atomic w.r.t. an interleaved rewrite: if the file is rewritten
      // between our read and the unlink, we could still delete the new
      // file. The winning side's openSync('wx') is atomic, so the worst
      // case is a spurious removal plus one more acquire-loop iteration,
      // not a double-acquire.
      try {
        const raw = readFileSync(path, 'utf-8').trim()
        const current: number | null = /^\d+$/.test(raw) ? parseInt(raw, 10) : null
        if (current !== expected) return
        unlinkSync(path)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return
        throw err
      }
    },
    probeAlive(pid) {
      try {
        process.kill(pid, 0)
        return true
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ESRCH') return false
        // Non-ESRCH: rethrow so the caller is conservative (assumes alive).
        throw err
      }
    },
    sendTerm(pid) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ESRCH') return
        throw err
      }
    },
    isLegitimatePredecessor(pid) {
      return isLegitimateDashboardPid(pid, procCtx)
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },
    log: {
      info: (obj, msg) => logger.info(obj, msg),
      warn: (obj, msg) => logger.warn(obj, msg),
      error: (obj, msg) => logger.error(obj, msg),
    },
  }
}

// Fresh-startup race short-circuit. When two dashboard processes start
// near-simultaneously, acquirePortLock would see the loser's peer as a
// zombie (alive + binary-pattern match, but not yet listening on the port)
// and SIGKILL it before the peer ever got a chance to install its signal
// handlers. That's exactly the "startup race kills the winner mid-init"
// scenario. Check the pidfile FIRST: if it already records a legitimate
// alive peer that isn't listening on the port yet, the peer is mid-init
// and we're the loser -- defer.
function checkFreshStartupRace(procCtx: ProcessLockContext): void {
  const recorded = readRecordedPidFrom(PID_FILE)
  if (recorded == null || recorded === process.pid) return

  let alive = false
  try {
    const out = procCtx.signal(recorded, 0)
    alive = out === 'sent'
  } catch {
    // Probe failed (e.g. EPERM). We cannot positively detect the race, so
    // we fall through to acquirePortLock which will SIGTERM the matching
    // binary-pattern process. That peer's early signal handler (installed
    // before acquireLock in main) runs graceful shutdown, so even if the
    // peer was mid-init the state is flushed cleanly rather than lost.
    return
  }
  if (!alive) return

  if (!isLegitimateDashboardPid(recorded, procCtx)) return

  // If the peer already holds the listening port, it's a fully-up
  // predecessor (not a mid-init winner). acquirePortLock will handle it.
  const portHolders = procCtx.listPortHolders(WEB_PORT)
  if (portHolders.includes(recorded)) return

  throw new DeferToPeerError(recorded)
}

async function acquireLock(): Promise<void> {
  mkdirSync(STORE_DIR, { recursive: true })

  const procCtx = buildProcessLockContext()

  // Defer BEFORE we start killing things: if the pidfile records a peer
  // that is alive, legitimate, and not yet on the port, we're the loser
  // of a fresh-startup race -- exit 0 without disturbing the winner.
  checkFreshStartupRace(procCtx)

  // Kill any previous instance(s) next: anything holding WEB_PORT, and
  // anything running the dashboard binary (for the zombie case where the
  // port was released but the process survived). The pidfile alone can
  // lie under launchd KeepAlive because each restart overwrites it.
  await acquirePortLock(WEB_PORT, procCtx, { binaryPattern: DASHBOARD_BINARY_PATTERN })

  // Atomic O_EXCL claim on PID_FILE. Serializes any two fresh startups
  // that race past the port check. `onLiveLegitimate: 'defer'` is a
  // belt-and-braces backup -- checkFreshStartupRace above should have
  // already caught the common case, but if the winner wrote its pidfile
  // between those two checks, defer here too.
  await acquirePidfileLock(PID_FILE, process.pid, buildPidfileLockContext(procCtx), {
    onLiveLegitimate: 'defer',
  })
}

// Delete the PID file ONLY if it still points at this process. A zombie
// shutdown path must not nuke the successor's pidfile after the successor
// already overwrote it.
function releaseLock(): void {
  try {
    const recordedPid = readRecordedPidFrom(PID_FILE)
    if (recordedPid !== process.pid) return
    unlinkSync(PID_FILE)
  } catch {
    // best-effort: the pidfile may already be gone (successor unlinked it)
  }
}

// Module-scope runtime state + shutdown hook. Kept out of main() so the
// main().catch handler can reach shutdown when an async init step rejects
// after partial state was already wired up (e.g. initDatabase throws after
// acquireLock wrote the pidfile -- we still need to drop the heartbeat /
// digest timers and release the pidfile on the way out).
let decayInterval: NodeJS.Timeout | null = null
let digestTimer: NodeJS.Timeout | null = null
let digestInterval: NodeJS.Timeout | null = null
let logRotationInterval: NodeJS.Timeout | null = null
let scheduledRunSnapshotSweepInterval: NodeJS.Timeout | null = null
let heartbeatStarted = false
let webServer: HttpServer | null = null
let shuttingDown = false
let exitCode = 0

const shutdown = (): void => {
  if (shuttingDown) return
  try {
    shuttingDown = true
    logger.info('Leallitas...')
    // DETACHEDSHUTDOWN1007: the command-task and pre-check groups run DETACHED
    // (outside our process group), so neither launchd nor our own exit ends
    // them, and their timeout timers die with us. End them first.
    try { endAllDetachedGroups('dashboard shutdown') } catch (err) { logger.warn({ err }, 'endAllDetachedGroups threw during shutdown') }
    if (heartbeatStarted) {
      try { stopHeartbeat() } catch (err) { logger.warn({ err }, 'stopHeartbeat threw during shutdown') }
    }
    try { stopInviteMonitor() } catch (err) { logger.warn({ err }, 'stopInviteMonitor threw during shutdown') }
    try { stopChannelRequestWatcher() } catch (err) { logger.warn({ err }, 'stopChannelRequestWatcher threw during shutdown') }
    try { stopStoreWatcher() } catch (err) { logger.warn({ err }, 'stopStoreWatcher threw during shutdown') }
    if (decayInterval) clearInterval(decayInterval)
    if (digestTimer) clearTimeout(digestTimer)
    if (digestInterval) clearInterval(digestInterval)
    if (logRotationInterval) clearInterval(logRotationInterval)
    if (scheduledRunSnapshotSweepInterval) clearInterval(scheduledRunSnapshotSweepInterval)

    const hardKill = setTimeout(() => {
      logger.warn({ timeoutMs: SHUTDOWN_HARD_KILL_MS }, 'Graceful shutdown timeout, hard exit')
      releaseLock()
      process.exit(exitCode || 1)
    }, SHUTDOWN_HARD_KILL_MS)

    if (webServer) {
      try { webServer.closeIdleConnections?.() } catch { /* older node */ }
      try { webServer.closeAllConnections?.() } catch { /* older node */ }
      webServer.close(() => {
        clearTimeout(hardKill)
        releaseLock()
        process.exit(exitCode)
      })
    } else {
      // Early shutdown, before startWebServer ran. Nothing to drain.
      clearTimeout(hardKill)
      releaseLock()
      process.exit(exitCode)
    }
  } catch (err) {
    logger.error({ err }, 'Shutdown threw, exiting anyway')
    releaseLock()
    process.exit(1)
  }
}

async function main(): Promise<void> {
  console.log(BANNER)

  // Install signal handlers EARLIEST so we can respond cleanly to SIGTERM
  // during init. Required to close the fresh-startup race: a concurrent
  // startup will SIGTERM this process via acquirePortLock's binary-pattern
  // kill; without an early handler, default SIGTERM behavior terminates
  // us mid-init with no chance to flush SQLite WAL or drop the pidfile.
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException')
    exitCode = 1
    shutdown()
  })
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandledRejection')
  })

  await acquireLock()

  // Database
  initDatabase()
  logger.info('Adatbazis inicializalva')

  // Backfill embeddings for memories saved before Ollama was available.
  // Fire-and-forget: a missing or slow Ollama instance must not block startup.
  //
  // THE OLD LINE LOGGED ONLY SUCCESS (`if (count > 0)`), so the one moment
  // per process where this question is cheap to answer produced NOTHING when
  // the answer was bad. Boot is exactly when an operator is looking. A failure
  // here is WARN and says how many are waiting -- it runs once per start, so
  // it cannot become noise.
  backfillEmbeddings().then(r => {
    if (r.embedded > 0) logger.info({ embedded: r.embedded, remaining: r.remaining }, 'Embedding backfill befejezve')
    if (!r.ok) {
      logger.warn(
        { pending: r.pending, embedded: r.embedded, failed: r.failed, aborted: r.aborted, err: r.error },
        'Embedding backfill NEM sikerult -- a vektoros kereses reszlegesen mukodik',
      )
    }
  }).catch(err => logger.warn({ err }, 'Embedding backfill hiba (Ollama nem elerheto)'))

  // Memory decay (24h cycle)
  runDecaySweep()
  decayInterval = setInterval(runDecaySweep, DECAY_SWEEP_INTERVAL_MS)
  logger.info('Memoria leepulesi ciklus beallitva (24 oras)')

  // Log rotation (LOGROTATE910): copytruncate on the launcher-redirected
  // logs, size-capped, hourly check. Runs inside the dashboard so every
  // platform gets it without launchd/systemd/cron wiring.
  runLogRotationSweep()
  logRotationInterval = setInterval(runLogRotationSweep, LOG_ROTATION_SWEEP_MS)

  // Scheduled-task run snapshot retention (SCHEDPROMPTREF917): same hourly
  // cadence as log rotation, 7-day age cutoff with a per-task floor of the
  // most recent 20 (see scheduled-run-snapshot.ts).
  sweepScheduledRunSnapshots()
  scheduledRunSnapshotSweepInterval = setInterval(() => sweepScheduledRunSnapshots(), LOG_ROTATION_SWEEP_MS)

  // Daily digest at 23:00. Timer handles kept so shutdown can drop them.
  function scheduleDailyDigest() {
    const now = new Date()
    const target = new Date(now)
    target.setHours(23, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    const msUntil = target.getTime() - now.getTime()
    // Resolved per run, not captured once: a wizard install pairs AFTER boot,
    // so a value read at startup would stay the placeholder for the life of
    // the process and the first digest would go nowhere.
    const runDigest = () => {
      const chatId = resolveOwnerChatId()
      if (!chatId) {
        logger.warn('Napi naplo kihagyva: nincs gazda-chat (nincs ALLOWED_CHAT_ID es nincs parositott csatorna)')
        return
      }
      runDailyDigest(chatId).catch((err) => logger.error({ err }, 'Napi naplo hiba'))
    }
    digestTimer = setTimeout(() => {
      runDigest()
      digestInterval = setInterval(runDigest, 24 * 60 * 60 * 1000)
    }, msUntil)
    logger.info({ nextRun: target.toLocaleString('hu-HU') }, 'Napi naplo utemezve')
  }
  scheduleDailyDigest()

  // Heartbeat -- 2026-06-02 architecture switch: the dedicated channel-less
  // `heartbeat` sub-agent now handles the hourly summary via the scheduled-
  // task runner. The legacy native scheduler (initHeartbeat) was the source
  // of the Marveen self-poll loop that caused channel-disconnect every fire
  // (see commit history #237/#250/#252/#253/#255 for the abandoned
  // isolation-chain attempt). We keep the native module imported so other
  // code paths that reference its exports still compile, but we do NOT
  // start its scheduler.
  // The heartbeat sub-agent is OFF by default. It auto-starts only when it
  // is explicitly opted in (HEARTBEAT_AGENT_ENABLED) AND this host owns the
  // respawn gate -- a fresh or upgrading install must not silently spawn a
  // sub-agent that reads the operator's calendar and DB, and a gated-off
  // machine (e.g. a dev box) must not fight the production host over the
  // channel.
  // Linux credentials-guard, once at boot before any agent starts (opt-in,
  // default OFF, no-op on macOS). Retires the rotating credentials.json so
  // even the systemd-managed main channels agent comes up on the stable
  // setup-token; startAgentProcess re-runs it per launch for self-healing.
  // Was previously nested inside the heartbeat-agent boot branch below, so on
  // any install with the heartbeat sub-agent disabled (the common case) this
  // never ran at boot at all (found 2026-07-13 while diagnosing recurring
  // dead-token incidents).
  renameSharedCredentialsIfSafe()

  // Fleet-token boot pass, DEFERRED and fire-and-forget: it live-probes a
  // credential (one real `claude -p` call, up to 60s) so it must never block
  // boot. Backfills store/.claude-oauth-token from a terminal-pasted
  // `claude setup-token` (which lands only in ~/.claude/.credentials.json and
  // silently disables per-agent isolation AND the rename guard -- 2026-07-15
  // bootcamp root gap), validates a never-verified existing fleet token, and
  // quarantines one the probe proves dead.
  setTimeout(() => {
    fleetTokenBootPass()
      .then((result) => logger.info({ result }, 'credentials-guard: fleet-token boot pass'))
      .catch((err) => logger.warn({ err }, 'credentials-guard: fleet-token boot pass failed'))
  }, 15_000)

  if (shouldBootHeartbeatAgent({ respawnEnabled: RESPAWN_ENABLED, agentEnabled: HEARTBEAT_AGENT_ENABLED })) {
    ensureHeartbeatAgent()
    logger.info({ agent: HEARTBEAT_AGENT_NAME }, 'Heartbeat agent scaffold ensured (channel-less, dashboard-hidden)')
    const heartbeatStart = await startAgentProcess(HEARTBEAT_AGENT_NAME)
    if (heartbeatStart.ok) {
      logger.info({ agent: HEARTBEAT_AGENT_NAME }, 'Heartbeat agent started')
    } else if (heartbeatStart.error === 'Agent is already running') {
      logger.info({ agent: HEARTBEAT_AGENT_NAME }, 'Heartbeat agent already running')
    } else {
      logger.warn({ error: heartbeatStart.error }, 'Heartbeat agent failed to start (legacy native heartbeat is NOT a fallback any more)')
    }
  } else {
    // Even with the feature off, keep the isolation sandbox out of the agent
    // list: agents/heartbeat-worker is a cwd, not an agent, and without the
    // sentinel the dashboard offers it as a startable agent (2026-08-25).
    ensureHeartbeatWorkerHidden()
    logger.info('Heartbeat agent boot-start skipped (set HEARTBEAT_AGENT_ENABLED=1 on the respawn host to enable)')
  }

  // Discord-only: ensure the operator-configured DISCORD_CHANNEL_ID is
  // in access.groups so the plugin's outbound `reply` tool can send to
  // server channels without a manual `/discord:access group add` step.
  // No-op for non-discord providers.
  ensureDiscordChannelGroup()

  // Telegram invite auto-approve monitor (one-click pairing).
  startInviteMonitor(MAIN_AGENT_ID, AGENTS_BASE_DIR)

  // Slack channel request watcher (audit.jsonl -> pending_channel_requests).
  startChannelRequestWatcher()

  // Store file audit watcher
  startStoreWatcher()

  // Web dashboard
  webServer = startWebServer(WEB_PORT)

  logger.info(`Marveen fut! Dashboard: http://localhost:${WEB_PORT}`)
  logger.info('Telegram kommunikacio: Claude Code Channels kezeli')
}

main().catch((err) => {
  if (err instanceof DeferToPeerError) {
    logger.info({ peerPid: err.peerPid }, 'Peer dashboard already claimed the pidfile, exiting quietly')
    process.exit(0)
  }
  if (err instanceof ForeignPortHolderError) {
    // Not a crash of ours: another install sits on our port and we refused to
    // kill it (card 77a48069). The message names the holder and the way out.
    logger.error({ port: err.port, holders: err.holders, installRoot: err.installRoot }, err.message)
  }
  // Route through shutdown() so any partial init (heartbeat, digest
  // timers, decay interval) is drained before exit. shutdown() is
  // idempotent and no-ops if a signal handler already ran; in that case
  // we must NOT overwrite the exit code the handler already chose --
  // otherwise a clean SIGTERM plus a concurrent unrelated async rejection
  // would report crash when the operator expected 0.
  logger.error({ err }, 'Vegzetes hiba')
  if (!shuttingDown) exitCode = 1
  shutdown()
})

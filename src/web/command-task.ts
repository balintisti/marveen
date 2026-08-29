import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { STORE_DIR, TELEGRAM_BOT_TOKEN, MAIN_AGENT_ID } from "../config.js"
import { resolveOwnerChatId } from "../owner-chat.js"
import { atomicWriteFileSync } from "./atomic-write.js"
import { logger } from "../logger.js"
import { sendTelegramMessage } from "./telegram.js"
import { appendTaskRun, createAgentMessage } from "../db.js"
import { detectTransitions, readQuotaSourceState } from "../data-source-alarm.js"
import type { ScheduledTask } from "./scheduled-tasks-io.js"

// command-type scheduled tasks run a raw shell command directly (no LLM
// agent, no tmux session) and alert on Telegram after N consecutive
// failures. This keeps infra heartbeats inside the one system that gets
// backed up (the Marveen store) instead of a separate crontab.

const HEALTH_PATH = join(STORE_DIR, "command-task-health.json")

export interface CommandHealth {
  fails: number
  alerted: boolean
  lastStatus: "ok" | "fail" | "unknown"
  lastRun: number
}
type HealthMap = Record<string, CommandHealth>

let healthMap: HealthMap | null = null
function load(): HealthMap {
  if (healthMap) return healthMap
  try { healthMap = JSON.parse(readFileSync(HEALTH_PATH, "utf-8")) as HealthMap }
  catch { healthMap = {} }
  return healthMap
}
function persist(): void {
  try { atomicWriteFileSync(HEALTH_PATH, JSON.stringify(healthMap ?? {}, null, 2)) }
  catch (err) { logger.warn({ err }, "command-task: failed to persist health map") }
}

/**
 * Egy command-feladat tarolt health-bejegyzese, vagy `undefined`.
 *
 * Kiolvashato, mert eddig NEM VOLT OLVASOJA: a `command-task-health.json`-t
 * csak ez a modul irta, es semmi nem adta vissza sehol. Egy allapot, amit
 * senki nem kerdez le, nem allapot -- naplo. (Kartya bae4df49.)
 */
export function readCommandHealth(name: string): CommandHealth | undefined {
  return load()[name]
}

export type CommandAction = "none" | "alert" | "recover"

// Pure decision function so the failure/recovery policy is unit-testable
// without spawning processes. success=true zeroes the streak; an alert
// fires exactly once when the streak first reaches failThreshold; a
// recover fires once when a previously-alerted task succeeds again.
export function evaluateCommandResult(
  prev: CommandHealth | undefined,
  success: boolean,
  failThreshold: number,
  now: number,
): { next: CommandHealth; action: CommandAction } {
  const wasAlerted = prev?.alerted ?? false
  const fails = success ? 0 : (prev?.fails ?? 0) + 1
  let action: CommandAction = "none"
  let alerted = wasAlerted
  if (success) {
    if (wasAlerted) { action = "recover"; alerted = false }
  } else if (fails >= failThreshold && !wasAlerted) {
    action = "alert"; alerted = true
  }
  return {
    next: { fails, alerted, lastStatus: success ? "ok" : "fail", lastRun: now },
    action,
  }
}

function runCommand(cmd: string, timeoutMs: number): { ok: boolean; detail: string } {
  try {
    const r = spawnSync("bash", ["-lc", cmd], { timeout: timeoutMs, encoding: "utf-8" })
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code
      if (code === "ETIMEDOUT") return { ok: false, detail: `timeout ${timeoutMs}ms` }
      return { ok: false, detail: r.error.message }
    }
    if (r.status === 0) return { ok: true, detail: "exit 0" }
    const err = (r.stderr || "").trim().slice(0, 200)
    return { ok: false, detail: `exit ${r.status}${err ? ": " + err : ""}` }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

export function runCommandTask(task: ScheduledTask, now: number): void {
  if (!task.command) {
    logger.warn({ task: task.name }, "command task has no command, skipping")
    return
  }
  const timeoutMs = task.timeoutMs && task.timeoutMs > 0 ? task.timeoutMs : 10_000
  const failThreshold = task.failThreshold && task.failThreshold > 0 ? task.failThreshold : 2
  const map = load()
  const { ok, detail } = runCommand(task.command, timeoutMs)
  const { next, action } = evaluateCommandResult(map[task.name], ok, failThreshold, now)
  map[task.name] = next
  persist()
  try { appendTaskRun(task.name, task.agent || "system") } catch { /* non-fatal */ }
  logger.info({ task: task.name, ok, detail, fails: next.fails, action }, "command task ran")

  // A KVOTA-FORRAS FIGYELESE ITT UL, NEM CSAK A HEARTBEATBEN (dontes (B),
  // 2026-08-23). A heartbeat oran kent fut, es CSAK 9..23 kozott -- az ablakon
  // kivul nulla tickje van. A kvota-forras allapota viszont FAJLBOL eldontheto,
  // gyujtes nelkul, tehat rakothet o erre a 10 perces tickre: olcso, es epp azt
  // a forrast fedi, amelyiknek a kiesese ma este a leletet adta.
  //
  // MINDEN command-task utan fut, nem csak a `usage-snapshot` utan, es ez
  // szandekos: a nev szerinti kotes egy atnevezessel nemán megszunne.
  // El-vezerelt, tehat egy valtozatlan allapot NEM termel uzenetet.
  //
  // ES A KET UT EGYUTT AD FEDEZETET: ez a tick gyors (10 perc, 24/7, amig a
  // feladat fut), a heartbeate viszont TULELI, ha ez a feladat leall -- mert a
  // snapshot ELAVULTSAGA maga is riasztasi feltetel. Egyik ut sem egyedul
  // felelos, es epp ez volt a kikotes.
  try {
    // EGY ORA, NEM KETTO. Az elavultsag-merese es az atmenet idobelyege
    // ugyanabbol a `now`-bol jojjon: kulon `Date.now()`-val a ketto elcsuszna
    // egymastol, es ami ennel is rosszabb, a staleness-ag TESZTELHETETLEN
    // lenne -- egy or, amit csak a valodi ora tud tuzelni, nem merheto.
    const quota = readQuotaSourceState(undefined, now)
    if (quota) {
      for (const t of detectTransitions({ quota }, Math.floor(now / 1000))) {
        createAgentMessage("system", MAIN_AGENT_ID, t.message)
        logger.info({ source: t.source, via: task.name }, "kvota-forras allapota valtozott")
      }
    }
  } catch (err) {
    // A riasztas hibaja nem allithatja meg a command-task sajat jelzeset.
    logger.warn({ err, task: task.name }, "kvota-forras riasztas hiba")
  }

  if (action === "none") return
  const ownerChat = resolveOwnerChatId()
  if (!TELEGRAM_BOT_TOKEN || !ownerChat) {
    logger.warn({ task: task.name }, "command task alert suppressed: missing token, or no owner chat (ALLOWED_CHAT_ID unset/placeholder and no paired channel)")
    return
  }
  const label = task.description || task.name
  const text = action === "alert"
    ? `\u{1F534} Hiba: ${label} nem v\u00e1laszol (${next.fails}. egym\u00e1s ut\u00e1ni hiba). R\u00e9szlet: ${detail}`
    : `\u{1F7E2} Helyre\u00e1llt: ${label} ism\u00e9t OK.`
  sendTelegramMessage(TELEGRAM_BOT_TOKEN, ownerChat, text)
    .then(() => logger.info({ task: task.name, action }, "command task alert sent"))
    .catch((err) => logger.warn({ err, task: task.name }, "command task alert send failed"))
}

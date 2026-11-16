/**
 * seat-set: move ONE agent's model and/or Claude plan with one command
 * (card 336501d7; wrapper `scripts/seat-set.sh`, CLI `scripts/seat-set.ts`).
 *
 * WHY. In the 24 h to 2026-11-11 the coordinator moved an agent's model or plan by hand five
 * times: edit agents/<name>/agent-config.json, back it up, restart, verify. Every hand edit is a
 * chance to leave a seat half-moved (config says one thing, the process runs another). This file
 * is that routine with the refusals and the verification written down.
 *
 * WHAT A "SEAT" IS HERE.
 *   model: agent-config.json "model"; the launcher passes it as `--model <id>` to claude.
 *   plan : `elso` = the key "oauthTokenFile" is ABSENT (the fleet token, store/.claude-oauth-token);
 *          `masodik` = "oauthTokenFile" is the second plan's token file. These are the only two.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without `apply`. With `apply`: backup next to the
 * config, atomic write, read back, then restart ONLY an idle pane (`mayActOnPane` and no
 * `busyEvidence`, the repo's own detectors). A busy or unreadable pane keeps the written config
 * and the exit says "takes effect at next restart".
 *
 * VERIFICATION IS ON THE NEW PROCESS, NOT THE CONFIG. After a restart the claude process must be a
 * different pid than before, its argv must carry the expected `--model`, and its environment token
 * must hash to the expected plan's token file. THE COMPARISON IS A HASH COMPARED IN MEMORY: no
 * token, and no hash of one, is ever printed, logged, put in an error, or written anywhere, and no
 * token file is ever written. An unreadable environment (another OS user's process) is
 * "unverified", never "yes".
 *
 * NOT HERE: deciding who moves (a coordinator decision on Isti's word), automatic switching, and
 * the coordinator's own seat (marveen): that move goes through claude-plans-state.json + HANDOFF
 * and stays manual.
 */
import { createHash } from 'node:crypto'
import { busyEvidence, mayActOnPane } from './pane-state.js'

export const SEAT_EXIT = {
  /** Dry run printed, nothing to change, or applied + restarted + verified. */
  OK: 0,
  USAGE: 2,
  /** Refused before any write (unknown agent/model/plan, marveen, unreadable config, ...). */
  REFUSED: 3,
  /** Config written; the pane is busy or unreadable, so it was NOT restarted: next restart applies it. */
  WRITTEN_NOT_RESTARTED: 10,
  /** Restarted, but the new process does not show the expected seat, or could not be read. */
  UNVERIFIED: 11,
  /** The restart call failed; the config is already written. */
  RESTART_FAILED: 12,
  /** The config write failed or did not read back; the backup was restored where possible. */
  WRITE_FAILED: 13,
} as const

export type PlanId = 'elso' | 'masodik'
export const PLAN_IDS: readonly PlanId[] = ['elso', 'masodik']
export const OAUTH_TOKEN_FILE_KEY = 'oauthTokenFile'
const FLEET_TOKEN_FILE = '.claude-oauth-token'
const PLAN_TOKEN_FILES: Record<PlanId, string> = {
  elso: FLEET_TOKEN_FILE,
  masodik: '.claude-oauth-token-masodik',
}
const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The path a plan's token lives at, under the store dir. `elso` is the fleet file. */
export function planTokenPath(plan: PlanId, storeDir: string): string {
  return `${storeDir.replace(/\/+$/, '')}/${PLAN_TOKEN_FILES[plan]}`
}

export interface SeatRequest {
  agent: string
  model?: string
  plan?: string
}

export interface SeatContext {
  /** Agents the coordinator may not be moved through this tool. */
  coordinatorIds: readonly string[]
  /** Model ids accepted as targets. */
  knownModels: readonly string[]
  storeDir: string
  /** Is there an agent directory with a config for this name? */
  agentExists: (agent: string) => boolean
}

export type Refusal = { ok: false; why: string }

/** Every refusal that needs no I/O beyond `ctx`. Loud on purpose: the `why` names the rule. */
export function validateSeatRequest(req: SeatRequest, ctx: SeatContext): Refusal | { ok: true; plan: PlanId | null } {
  if (!AGENT_NAME_RE.test(req.agent)) return { ok: false, why: `"${req.agent}" is not an agent name (lowercase letters, digits, - and _ only)` }
  if (ctx.coordinatorIds.includes(req.agent)) {
    return { ok: false, why: `${req.agent} is the coordinator: its own move goes through claude-plans-state.json + HANDOFF and stays manual` }
  }
  if (!ctx.agentExists(req.agent)) return { ok: false, why: `unknown agent "${req.agent}": no agent directory with an agent-config.json` }
  if (req.model === undefined && req.plan === undefined) return { ok: false, why: 'nothing to move: give --model <id> and/or --plan elso|masodik' }
  if (req.model !== undefined && !ctx.knownModels.includes(req.model)) {
    return { ok: false, why: `unknown model id "${req.model}": not in the alias table, store/model-choices.json or any agent config` }
  }
  if (req.model !== undefined && !req.model.startsWith('claude-')) {
    return { ok: false, why: `"${req.model}" is not a Claude model: seat-set moves Claude seats only (a setup-token cannot take effect on another provider)` }
  }
  let plan: PlanId | null = null
  if (req.plan !== undefined) {
    if (!(PLAN_IDS as readonly string[]).includes(req.plan)) {
      const keyLike = /api|key|second/i.test(req.plan)
      return {
        ok: false,
        why: keyLike
          ? `"${req.plan}" is an API key, not a seat: ANTHROPIC_API_KEY_SECOND is a gift key and is never a plan`
          : `unknown plan "${req.plan}": the only plans are ${PLAN_IDS.join(' and ')}`,
      }
    }
    plan = req.plan as PlanId
  }
  return { ok: true, plan }
}

export interface SeatState {
  model: string | null
  /** 'elso' (key absent), 'masodik' (the second plan's file) or the raw other path. */
  plan: string
}

export function readSeat(config: Record<string, unknown>, storeDir: string): SeatState {
  const model = typeof config.model === 'string' ? config.model : null
  const file = config[OAUTH_TOKEN_FILE_KEY]
  let plan: string
  if (file === undefined) plan = 'elso'
  else if (typeof file !== 'string') plan = `(non-string ${OAUTH_TOKEN_FILE_KEY})`
  else if (file === planTokenPath('masodik', storeDir)) plan = 'masodik'
  else plan = `other:${file}`
  return { model, plan }
}

export type ConfigChange =
  | { ok: false; why: string }
  | { ok: true; changed: boolean; before: SeatState; after: SeatState; newText: string }

/**
 * Pure: config text in, new config text out. The ORIGINAL must survive a parse + stringify
 * round trip byte for byte (2-space indent, with or without the final newline); a file that does
 * not is refused, which is what guarantees that every key we do not touch keeps its bytes.
 */
export function applySeatChange(text: string, want: { model?: string; plan?: PlanId }, storeDir: string): ConfigChange {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, why: 'agent-config.json is not valid JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, why: 'agent-config.json is not a JSON object' }
  const config = parsed as Record<string, unknown>
  const body = JSON.stringify(config, null, 2)
  const trailing = text === `${body}\n` ? '\n' : text === body ? '' : null
  if (trailing === null) {
    return { ok: false, why: 'agent-config.json does not round-trip at 2-space indent: editing it here could reformat other keys; change it by hand' }
  }
  const before = readSeat(config, storeDir)
  if (want.model !== undefined) config.model = want.model
  if (want.plan === 'elso') delete config[OAUTH_TOKEN_FILE_KEY]
  else if (want.plan === 'masodik') config[OAUTH_TOKEN_FILE_KEY] = planTokenPath('masodik', storeDir)
  const newText = `${JSON.stringify(config, null, 2)}${trailing}`
  return { ok: true, changed: newText !== text, before, after: readSeat(config, storeDir), newText }
}

/** idle = may restart; busy = a turn is in flight or text is parked; unreadable = no capture. */
export type PaneVerdict = 'idle' | 'busy' | 'unreadable'

export function paneVerdictForRestart(pane: string | null): PaneVerdict {
  if (pane == null || pane.trim() === '') return 'unreadable'
  if (busyEvidence(pane) != null) return 'busy'
  return mayActOnPane(pane) ? 'idle' : 'busy'
}

/** What the running claude process shows. tokenSha = sha256 hex of its env token, null = unreadable. */
export interface ProcessFacts {
  pid: string
  model: string | null
  tokenSha: string | null
}

export type Check = 'yes' | 'no' | 'unknown' | 'n/a'

export interface Verification {
  model: Check
  plan: Check
  /** yes only when every requested check is yes. */
  verified: boolean
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Hash of a token file's content (trimmed), or null when it cannot be read. Never returns the content. */
export function tokenFileSha(read: (path: string) => string | null, path: string): string | null {
  const raw = read(path)
  if (raw == null || raw.trim() === '') return null
  return sha256Hex(raw.trim())
}

export function verifyFacts(facts: ProcessFacts | null, expect: { model?: string; tokenSha?: string | null }): Verification {
  let model: Check = 'n/a'
  let plan: Check = 'n/a'
  if (expect.model !== undefined) model = facts == null || facts.model == null ? 'unknown' : facts.model === expect.model ? 'yes' : 'no'
  if (expect.tokenSha !== undefined) {
    if (facts == null || facts.tokenSha == null || expect.tokenSha == null) plan = 'unknown'
    else plan = facts.tokenSha === expect.tokenSha ? 'yes' : 'no'
  }
  const wanted = [model, plan].filter(c => c !== 'n/a')
  return { model, plan, verified: wanted.length > 0 && wanted.every(c => c === 'yes') }
}

export interface SeatDeps {
  readText: (path: string) => string | null
  copyFile: (from: string, to: string) => void
  /** Atomic write that keeps the file's mode. */
  writeText: (path: string, text: string) => void
  appendLine: (path: string, line: string) => void
  /** Europe/Belgrade wall clock, `YYYY-MM-DD HH:MM:SS`, from the real clock. */
  now: () => string
  /** Compact stamp for the backup name, `YYYYMMDD-HHMMSS`. */
  stamp: () => string
  capturePane: () => string | null
  /** The claude process of the agent's pane, null = none found. */
  processFacts: () => ProcessFacts | null
  restart: () => Promise<{ ok: boolean; error?: string }>
  /**
   * The launcher's own start decision for the config as it WOULD be written (oauthTokenFileConflict +
   * checkOauthTokenFile, the same code startAgentProcess runs). A string = the launcher would refuse
   * the start; null = it would start. The dashboard restart STOPS the pane before it starts it, so a
   * config the launcher refuses leaves the agent down (didi, card 336501d7, L1).
   */
  startProblem: (newConfigText: string) => string | null
  delay: (ms: number) => Promise<void>
}

export interface SeatOptions {
  apply: boolean
  /** Who asked (ledger). Required with apply. */
  by: string
  /** Where the agent's config lives. */
  configPath: string
  ledgerPath: string
  storeDir: string
  /** How long to wait for the restarted process to show up. */
  verifyWaitMs?: number
  verifyPollMs?: number
}

export interface SeatReport {
  exit: number
  lines: string[]
}

function seatLine(label: string, from: string | null, to: string | null): string {
  return `${label}: ${from ?? '(unset)'} -> ${to ?? '(unset)'}${from === to ? '  (no change)' : ''}`
}

/** The whole routine. Pure over `deps`: the tests drive it with fakes and never touch a real seat. */
export async function runSeatSet(deps: SeatDeps, req: SeatRequest, ctx: SeatContext, opts: SeatOptions): Promise<SeatReport> {
  const lines: string[] = []
  const out = (l: string): void => { lines.push(l) }
  const refuse = (why: string): SeatReport => { out(`REFUSED: ${why}`); return { exit: SEAT_EXIT.REFUSED, lines } }

  const v = validateSeatRequest(req, ctx)
  if (!v.ok) return refuse(v.why)
  if (opts.apply && !opts.by.trim()) return { exit: SEAT_EXIT.USAGE, lines: ['--by <who> is required with --apply (it goes into the ledger)'] }
  // One ledger line per move: a line break or the field separator in --by would forge or split a line.
  // eslint-disable-next-line no-control-regex
  if (opts.apply && /[\u0000-\u001f\u007f|]/.test(opts.by)) return { exit: SEAT_EXIT.USAGE, lines: ['--by may not contain a line break, a control character or "|" (it goes into the one-line ledger)'] }

  const text = deps.readText(opts.configPath)
  if (text == null) return refuse(`cannot read ${opts.configPath}`)

  const want = { model: req.model, plan: v.plan ?? undefined }
  const change = applySeatChange(text, want, opts.storeDir)
  if (!change.ok) return refuse(change.why)

  const problem = change.changed ? deps.startProblem(change.newText) : null
  if (problem != null) {
    return refuse(`the launcher would refuse to start ${req.agent} with this config (${problem}): the dashboard restart stops the pane first, so the agent would stay DOWN. Nothing was written`)
  }

  let expectSha: string | null | undefined
  if (v.plan != null) {
    const tokenPath = planTokenPath(v.plan, opts.storeDir)
    expectSha = tokenFileSha(deps.readText, tokenPath)
    if (expectSha == null) return refuse(`the ${v.plan} plan's token file is missing or empty (${tokenPath}): the move could not be verified`)
  }

  const pane = deps.capturePane()
  const paneVerdict = paneVerdictForRestart(pane)
  const backupPath = `${opts.configPath}.bak-seatset-${deps.stamp()}`

  out(`seat-set ${req.agent} (${opts.apply ? 'APPLY' : 'DRY RUN, nothing is written'})`)
  if (req.model !== undefined) out(seatLine('model', change.before.model, change.after.model))
  if (v.plan != null) out(seatLine('plan', change.before.plan, change.after.plan))
  out(`pane: ${paneVerdict === 'idle' ? 'idle (a restart is allowed)' : paneVerdict === 'busy' ? 'BUSY (no restart; the config change would take effect at next restart)' : 'unreadable (no restart)'}`)
  out(`backup would be: ${backupPath}`)

  if (!change.changed) {
    out('nothing to change: the config already holds this seat. Nothing was written, nothing was restarted.')
    return { exit: SEAT_EXIT.OK, lines }
  }
  if (!opts.apply) {
    out('dry run: add --apply --by <who> to write it.')
    return { exit: SEAT_EXIT.OK, lines }
  }

  // ---- write: backup, atomic write, read back ----
  const ledger = (state: string, verified: 'yes' | 'no'): void => {
    const parts = [deps.now(), req.agent]
    if (req.model !== undefined) parts.push(`model ${change.before.model ?? '(unset)'} -> ${change.after.model ?? '(unset)'}`)
    if (v.plan != null) parts.push(`plan ${change.before.plan} -> ${change.after.plan}`)
    parts.push(state, `verified=${verified}`, `by=${opts.by}`)
    deps.appendLine(opts.ledgerPath, parts.join(' | '))
  }
  try {
    deps.copyFile(opts.configPath, backupPath)
    deps.writeText(opts.configPath, change.newText)
  } catch (e) {
    out(`WRITE FAILED: ${e instanceof Error ? e.message : 'unknown error'}`)
    return { exit: SEAT_EXIT.WRITE_FAILED, lines }
  }
  const back = deps.readText(opts.configPath)
  let readBack: SeatState | null = null
  try {
    readBack = back == null ? null : readSeat(JSON.parse(back) as Record<string, unknown>, opts.storeDir)
  } catch { readBack = null }
  if (back !== change.newText || readBack == null) {
    try { deps.copyFile(backupPath, opts.configPath) } catch { /* reported below */ }
    out(`WRITE FAILED: the config did not read back as written; the backup ${backupPath} was copied back`)
    return { exit: SEAT_EXIT.WRITE_FAILED, lines }
  }
  out(`written. read back: model=${readBack.model ?? '(unset)'} plan=${readBack.plan}`)
  out(`backup: ${backupPath}`)

  if (paneVerdict !== 'idle') {
    out('NOT restarted: takes effect at next restart.')
    ledger(`written, not restarted (pane ${paneVerdict})`, 'no')
    return { exit: SEAT_EXIT.WRITTEN_NOT_RESTARTED, lines }
  }

  // ---- restart and verify on the NEW process ----
  const oldPid = deps.processFacts()?.pid ?? null
  const r = await deps.restart()
  if (!r.ok) {
    // The dashboard restart STOPS the pane before it starts it: after a failed restart the agent may be
    // DOWN, not "still on the old seat". Put the old config back so a supervisor restart can succeed.
    let restored = 'the config was restored from the backup'
    try { deps.copyFile(backupPath, opts.configPath) } catch { restored = 'the config could NOT be restored: copy the backup back by hand' }
    out(`RESTART FAILED: ${r.error ?? 'no detail'}. The agent may be STOPPED (a restart stops the pane before it starts it); ${restored} (${backupPath}). Check the pane and start it again.`)
    ledger('written, restart failed, config restored', 'no')
    return { exit: SEAT_EXIT.RESTART_FAILED, lines }
  }
  const waitMs = opts.verifyWaitMs ?? 90_000
  const pollMs = opts.verifyPollMs ?? 3_000
  let facts: ProcessFacts | null = null
  for (let waited = 0; waited <= waitMs; waited += pollMs) {
    await deps.delay(pollMs)
    const f = deps.processFacts()
    if (f != null && f.pid !== oldPid) { facts = f; break }
  }
  const ver = facts == null
    ? ({ model: req.model !== undefined ? 'unknown' : 'n/a', plan: v.plan != null ? 'unknown' : 'n/a', verified: false } as Verification)
    : verifyFacts(facts, { model: req.model, tokenSha: v.plan != null ? expectSha : undefined })
  out(`new process: ${facts == null ? 'NOT SEEN (a different pid than before did not appear)' : 'seen'}`)
  if (req.model !== undefined) out(`  model on the process: ${ver.model}`)
  if (v.plan != null) out(`  plan token on the process: ${ver.plan}`)
  ledger('applied, restarted', ver.verified ? 'yes' : 'no')
  if (!ver.verified) {
    out('UNVERIFIED: the seat is written but the new process does not (or cannot be shown to) hold it. Look at the pane.')
    return { exit: SEAT_EXIT.UNVERIFIED, lines }
  }
  out('verified on the new process.')
  return { exit: SEAT_EXIT.OK, lines }
}

/** Read-only: does the RUNNING process hold what the config says? The live positive control. */
export function verifyRunning(
  deps: Pick<SeatDeps, 'readText' | 'processFacts'>,
  configPath: string,
  storeDir: string,
): { lines: string[]; verified: boolean } {
  const text = deps.readText(configPath)
  if (text == null) return { lines: [`cannot read ${configPath}`], verified: false }
  let config: Record<string, unknown>
  try { config = JSON.parse(text) as Record<string, unknown> } catch { return { lines: ['agent-config.json is not valid JSON'], verified: false } }
  const seat = readSeat(config, storeDir)
  const planId: PlanId | null = seat.plan === 'elso' || seat.plan === 'masodik' ? seat.plan : null
  const expectSha = planId != null ? tokenFileSha(deps.readText, planTokenPath(planId, storeDir)) : null
  const facts = deps.processFacts()
  const ver = verifyFacts(facts, { model: seat.model ?? undefined, tokenSha: planId != null ? expectSha : null })
  return {
    lines: [
      `config says: model=${seat.model ?? '(unset)'} plan=${seat.plan}`,
      `process: ${facts == null ? 'no claude process found' : 'found'}`,
      `  model on the process matches the config: ${ver.model}`,
      `  plan token on the process matches the config's plan: ${ver.plan}`,
    ],
    verified: ver.verified,
  }
}

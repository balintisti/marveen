/**
 * seat-set CLI (card 336501d7). Run it through `scripts/seat-set.sh`; the logic is in
 * src/seat-set.ts, this file is the plumbing: file I/O, tmux, `ps`, the restart call.
 *
 * Environment overrides, for tests and for pointing at a fixture tree (nothing here moves a live
 * seat unless the defaults are left in place AND --apply is given):
 *   SEATSET_AGENTS_DIR   default <repo>/agents
 *   SEATSET_STORE_DIR    default <repo>/store (token files, model-choices.json, dashboard token)
 *   SEATSET_LEDGER       default <store>/seat-ledger.log
 *   SEATSET_RESTART_CMD  an executable run as `<cmd> <agent>` INSTEAD of the dashboard restart call
 *   SEATSET_DASHBOARD_URL default http://localhost:3420
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '../src/web/atomic-write.js'
import {
  SEAT_EXIT,
  runSeatSet,
  sha256Hex,
  verifyRunning,
  type ProcessFacts,
  type SeatContext,
  type SeatDeps,
} from '../src/seat-set.js'

const REPO = join(import.meta.dirname, '..')
const AGENTS_DIR = process.env.SEATSET_AGENTS_DIR ?? join(REPO, 'agents')
const STORE_DIR = process.env.SEATSET_STORE_DIR ?? join(REPO, 'store')
const LEDGER = process.env.SEATSET_LEDGER ?? join(STORE_DIR, 'seat-ledger.log')

function usage(): never {
  process.stderr.write(
    'usage: seat-set.sh <agent> [--model <id>] [--plan elso|masodik] [--apply --by <who>]\n' +
      '       seat-set.sh <agent> --verify\n',
  )
  process.exit(SEAT_EXIT.USAGE)
}

function readText(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

function belgrade(): { date: string; time: string } {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date())
  const [date, time] = f.split(' ')
  return { date, time }
}

function knownModels(aliases: Record<string, string>): string[] {
  const set = new Set<string>(Object.values(aliases))
  const choices = readText(join(STORE_DIR, 'model-choices.json'))
  if (choices != null) {
    try {
      for (const v of Object.values(JSON.parse(choices) as Record<string, { id?: unknown }>)) if (typeof v?.id === 'string') set.add(v.id)
    } catch { /* an unreadable choices file only narrows the list */ }
  }
  try {
    for (const d of readdirSync(AGENTS_DIR)) {
      const t = readText(join(AGENTS_DIR, d, 'agent-config.json'))
      if (t == null) continue
      try { const m = (JSON.parse(t) as { model?: unknown }).model; if (typeof m === 'string') set.add(m) } catch { /* skip */ }
    }
  } catch { /* no agents dir: the refusal for the agent comes first anyway */ }
  return [...set]
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  let agent: string | null = null
  let model: string | undefined
  let plan: string | undefined
  let by = ''
  let apply = false
  let verify = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--apply') apply = true
    else if (a === '--verify') verify = true
    else if (a === '--model') { model = args[++i]; if (!model) usage() }
    else if (a === '--plan') { plan = args[++i]; if (!plan) usage() }
    else if (a === '--by') { by = args[++i] ?? ''; if (!by) usage() }
    else if (a.startsWith('--')) usage()
    else if (agent == null) agent = a
    else usage()
  }
  if (agent == null) usage()

  // Loaded here: the modules are large and the usage errors above must not need them.
  const proc = await import('../src/web/agent-process.js')
  const names = await import('../src/web/session-names.js')
  const cfg = await import('../src/web/agent-config.js')
  const appCfg = await import('../src/config.js')

  const session = names.sessionNameForAgent(agent)
  const target = proc.agentTmuxTarget(agent)
  const host = target.host ?? null
  const configPath = join(AGENTS_DIR, agent, 'agent-config.json')

  const sh = (file: string, a: string[]): string =>
    execFileSync(file, a, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 })

  // The claude process of the agent's pane: the pane's pid and its descendants, the first whose
  // argv has --model. The environment text stays in this function; only a hash leaves it.
  const processFacts = (): ProcessFacts | null => {
    try {
      const inv = proc.tmuxInvocationFor(['list-panes', '-t', `=${session}`, '-F', '#{pane_pid}'], target)
      const panePid = sh(inv.file, inv.args).split(/\s+/).find(Boolean)
      if (!panePid) return null
      const kids = new Map<string, string[]>()
      for (const line of sh('ps', ['-axo', 'pid=,ppid=']).split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/)
        if (pid && ppid) kids.set(ppid, [...(kids.get(ppid) ?? []), pid])
      }
      const stack = [panePid]
      const seen = new Set<string>()
      while (stack.length > 0) {
        const pid = stack.pop() as string
        if (seen.has(pid)) continue
        seen.add(pid)
        stack.push(...(kids.get(pid) ?? []))
        let text = ''
        try { text = sh('ps', ['eww', '-p', pid, '-o', 'command=']) } catch { continue }
        const m = / --model (\S+)/.exec(text)
        if (!m) continue
        const t = /CLAUDE_CODE_OAUTH_TOKEN=(\S+)/.exec(text)
        return { pid, model: m[1], tokenSha: t ? sha256Hex(t[1].trim()) : null }
      }
      return null
    } catch {
      return null
    }
  }

  const ctx: SeatContext = {
    coordinatorIds: [appCfg.MAIN_AGENT_ID, 'marveen'],
    knownModels: knownModels(cfg.MODEL_ALIASES),
    storeDir: STORE_DIR,
    agentExists: (a) => existsSync(join(AGENTS_DIR, a, 'agent-config.json')),
  }

  if (verify) {
    const r = verifyRunning({ readText, processFacts }, configPath, STORE_DIR)
    for (const l of r.lines) process.stdout.write(`${l}\n`)
    process.stdout.write(r.verified ? 'verify: the running process holds the config seat.\n' : 'verify: NOT confirmed (see the lines above).\n')
    return r.verified ? SEAT_EXIT.OK : SEAT_EXIT.UNVERIFIED
  }

  const restart = async (): Promise<{ ok: boolean; error?: string }> => {
    const cmd = process.env.SEATSET_RESTART_CMD
    if (cmd) {
      try { execFileSync(cmd, [agent as string], { timeout: 60_000, stdio: 'ignore' }); return { ok: true } } catch { return { ok: false, error: 'the restart command failed' } }
    }
    const token = readText(join(STORE_DIR, '.dashboard-token'))?.trim()
    if (!token) return { ok: false, error: 'the dashboard token file is missing' }
    try {
      const res = await fetch(`${process.env.SEATSET_DASHBOARD_URL ?? 'http://localhost:3420'}/api/agents/${encodeURIComponent(agent as string)}/restart`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      return res.ok ? { ok: true } : { ok: false, error: `the dashboard answered HTTP ${res.status}` }
    } catch {
      return { ok: false, error: 'the dashboard could not be reached' }
    }
  }

  const deps: SeatDeps = {
    readText,
    copyFile: (from, to) => { copyFileSync(from, to) },
    writeText: (path, text) => {
      const mode = statSync(path).mode & 0o777
      atomicWriteFileSync(path, text, { mode })
    },
    appendLine: (path, line) => { appendFileSync(path, `${line}\n`) },
    now: () => { const b = belgrade(); return `${b.date} ${b.time}` },
    stamp: () => { const b = belgrade(); return `${b.date.replaceAll('-', '')}-${b.time.replaceAll(':', '')}` },
    capturePane: () => {
      const has = proc.tmuxInvocationFor(['has-session', '-t', `=${session}`], target)
      try { sh(has.file, has.args) } catch { return null }
      return proc.capturePane(session, host)
    },
    processFacts,
    restart,
    delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  }

  const report = await runSeatSet(deps, { agent, model, plan }, ctx, { apply, by, configPath, ledgerPath: LEDGER, storeDir: STORE_DIR })
  for (const l of report.lines) process.stdout.write(`${l}\n`)
  return report.exit
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`seat-set: ${err instanceof Error ? err.message : 'unexpected error'}\n`)
    process.exit(1)
  },
)

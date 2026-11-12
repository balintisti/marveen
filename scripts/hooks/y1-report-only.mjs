#!/usr/bin/env node
// PreToolUse hook, REPORT-ONLY (card 5b639edb): what WOULD the upstream sub-agent write gate deny here?
//
// It runs the upstream gate's decision (Szotasz/marveen 4bdb49da2, vendored byte-identical under
// y1-report-only/upstream/) on every Bash, file-tool and MCP call and writes the answer to store/y1-report-only/.
// It decides NOTHING: no output, exit 0, always. A crash, a hang, a missing file or a full log lets the call through;
// what went wrong is a row in the log (or, when even the log code is gone, a line in ERRORS.txt next to it).
//
// This file imports node built-ins only and loads the rest inside a try, so a broken part cannot stop it from
// reaching exit 0. A run that HANGS is ended by the watchdog thread with SIGKILL, which no code in here can turn
// into exit 0: the registered command adds that layer, `... >/dev/null 2>&1; exit 0`.
//
// The seven-day table by target path class: node scripts/hooks/y1-report-only/report.mjs
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DIR = process.env.Y1_REPORT_ONLY_DIR ? resolve(process.env.Y1_REPORT_ONLY_DIR) : join(ROOT, 'store', 'y1-report-only')
// From process start to the last row. The registered hook timeout (10 s) stays well above it.
const DEADLINE_MS = 4000
const GRACE_MS = 2000

// Nothing the vendored code prints may reach the harness: a JSON object on a PreToolUse hook's stdout is a decision.
process.stdout.write = () => true
process.stderr.write = () => true

function lastResort(what) {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 })
    appendFileSync(join(DIR, 'ERRORS.txt'), `${new Date().toISOString()} ${String(what?.stack ?? what).slice(0, 4000).replace(/\n/g, ' | ')}\n`, { mode: 0o600 })
  } catch { /* nothing left to tell it to */ }
}

process.on('uncaughtException', (err) => { lastResort(err); process.exit(0) })
process.on('unhandledRejection', (err) => { lastResort(err); process.exit(0) })

// the environment may only SHORTEN the deadline (the tests do)
const asked = Number(process.env.Y1_REPORT_ONLY_DEADLINE_MS)
const deadlineMs = asked > 0 && asked < DEADLINE_MS ? asked : DEADLINE_MS
const startedAt = Math.round(performance.timeOrigin)
const state = new Int32Array(new SharedArrayBuffer(8))
let worker = null
try {
  const row = { ts: new Date().toISOString(), agent: 'unknown', kind: 'timeout', phase: 'load', node: process.versions.node }
  worker = new Worker(new URL('./y1-report-only/watchdog.mjs', import.meta.url), {
    workerData: { state, deadlineMs, graceMs: GRACE_MS, startedAt, initial: { dir: DIR, rows: [['findings.jsonl', row]] } },
    stdout: true,
    stderr: true,
  })
  worker.unref()
  worker.on('error', lastResort)
} catch (err) {
  lastResort(err)
}

const dog = {
  // the rows to write if the run ends at the deadline from here on
  arm(rows) { try { worker?.postMessage({ dir: DIR, rows }) } catch { /* the verdict does not depend on it */ } },
  up() { return Atomics.load(state, 1) === 1 },
  // true: the rows are the main thread's to write. false: the watchdog took the run at the deadline; wait for its rows.
  finish() {
    if (Atomics.compareExchange(state, 0, 0, 1) === 0) return true
    Atomics.wait(state, 0, 2, GRACE_MS)
    return false
  },
}

try {
  const core = await import('./y1-report-only/core.mjs')
  await core.run({ root: ROOT, dir: DIR, dog })
} catch (err) {
  lastResort(err)
}
process.exit(0)

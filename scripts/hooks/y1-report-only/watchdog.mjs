// y1-report-only/watchdog.mjs: ends a run that does not end by itself. Worker thread, node built-ins only.
//
// The decision runs on the MAIN thread (a decision worker cost 30-60 ms per tool call, card 5b639edb), so a gate that
// never returns cannot be ended from there. This thread can: at the deadline it writes the rows the main thread
// prepared for exactly this case (the last ones it posted: they name the phase it is stuck in and carry the full
// input) and kills the process. SIGKILL cannot be turned into exit code 0 from inside; the registered command ends
// in `; exit 0`, and that is what the harness sees.
//
// `state` (shared): [0] 0 = running, 1 = the main thread has its verdict and writes it, 2 = this thread took the run,
// 3 = this thread's rows are written; [1] 1 = this thread is up (logged per call as `dog`).
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

const { state, deadlineMs, graceMs, startedAt, initial } = workerData
let pending = initial
parentPort.on('message', (m) => { pending = m })

function kill() {
  try { process.kill(process.pid, 'SIGKILL') } catch { /* nothing else can end it */ }
}

setTimeout(async () => {
  if (Atomics.compareExchange(state, 0, 0, 2) !== 0) return
  const late = { deadline_ms: deadlineMs, ms_total: Date.now() - startedAt }
  try {
    const { appendRow } = await import('./core.mjs')
    for (const [file, row] of pending.rows) appendRow(pending.dir, file, { ...row, ...late })
  } catch (err) {
    try {
      mkdirSync(pending.dir, { recursive: true, mode: 0o700 })
      appendFileSync(join(pending.dir, 'ERRORS.txt'), `${new Date().toISOString()} watchdog: deadline ${deadlineMs} ms, rows not written: ${String(err?.message ?? err).slice(0, 500)}\n`, { mode: 0o600 })
    } catch { /* nothing left to tell it to */ }
  }
  Atomics.store(state, 0, 3)
  Atomics.notify(state, 0)
  kill()
}, deadlineMs)
// the main thread won the race above and then hung while writing: no row is owed any more, only the end
setTimeout(kill, deadlineMs + graceMs)
Atomics.store(state, 1, 1)

// y1-report-only/core.mjs: everything of the report-only hook that is NOT the gate's decision: who called, the two
// log files, and one hook call from stdin to its rows. Node built-ins only at load: the decision (decide.mjs, the
// vendored gate behind it) is imported inside run(), so a broken gate is a row, not a hook that does not start.
//
// The log (store/y1-report-only/, directory 0700, files 0600):
//   calls.jsonl     one short row per judged call (the denominator, the per-agent liveness and the cost in ms)
//   findings.jsonl  one row per would-deny / exempted / error / timeout, with the FULL input the gate read:
//                   a Bash command whole, a file tool's path (its content is not read by the gate, so it is not
//                   logged), an MCP call's input. The transcripts hold the same text already; nothing new leaves.
// A file at its size cap takes no more rows: one byte per dropped row goes to <file>.FULL, so the loss is a number.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

export const INPUT_CAP_BYTES = 256 * 1024
export const CAP_BYTES = { 'calls.jsonl': 64 * 1024 * 1024, 'findings.jsonl': 256 * 1024 * 1024 }
// Naming the target classes of a deny re-decides the call several times. Live it may run until the hook is this old
// (ms since process start); a row it did not finish has classes: null and report.mjs replays it.
export const ATTRIBUTE_UNTIL_MS = 1000
export const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

export function isJudgedTool(name) {
  const n = String(name ?? '')
  return n === 'Bash' || FILE_TOOLS.includes(n) || /^mcp__/i.test(n)
}

export function logDir(root, env = process.env) {
  return env.Y1_REPORT_ONLY_DIR ? resolve(env.Y1_REPORT_ONLY_DIR) : join(root, 'store', 'y1-report-only')
}

function real(p) {
  try { return realpathSync(p) } catch { return resolve(String(p)) }
}

// A label for the table, never an input of the decision. The hook's CLAUDE_PROJECT_DIR names the caller's home; a
// Task sub-agent shares its parent's, so it carries the parent's label.
export function agentLabel(root, env = process.env, cwd = null) {
  const from = env.CLAUDE_PROJECT_DIR || cwd
  if (!from) return 'unknown'
  const here = real(from)
  if (here === real(root)) return 'main'
  let names = []
  try { names = readdirSync(join(root, 'agents')) } catch { /* no agents directory */ }
  for (const name of names) {
    const home = real(join(root, 'agents', name))
    if (here === home || here.startsWith(home + '/')) return name
  }
  return `other:${basename(here)}`
}

// The part of the tool input the gate decided on, whole up to INPUT_CAP_BYTES (beyond it: the head, the full length
// and a sha256 of the whole, so a cut row says it was cut).
export function loggedInput(toolName, toolInput) {
  const name = String(toolName ?? '')
  if (FILE_TOOLS.includes(name)) {
    return { input: { file_path: toolInput?.file_path, notebook_path: toolInput?.notebook_path } }
  }
  const whole = name === 'Bash' ? String(toolInput?.command ?? '') : JSON.stringify(toolInput ?? null) ?? 'null'
  const bytes = Buffer.byteLength(whole)
  const key = name === 'Bash' ? 'command' : 'json'
  if (bytes <= INPUT_CAP_BYTES) return { input: { [key]: whole } }
  return {
    input: { [key]: Buffer.from(whole).subarray(0, INPUT_CAP_BYTES).toString('utf8') },
    input_truncated: true,
    input_bytes: bytes,
    input_sha256: createHash('sha256').update(whole).digest('hex'),
  }
}

export function appendRow(dir, file, row) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, file)
  let size = 0
  try { size = statSync(path).size } catch { /* first row */ }
  if (size >= CAP_BYTES[file]) {
    appendFileSync(path + '.FULL', '.', { mode: 0o600 })
    return false
  }
  appendFileSync(path, JSON.stringify(row) + '\n', { mode: 0o600 })
  return true
}

// One hook call, from stdin to the log rows. Returns the verdict it logged (the tests read it); the caller exits 0
// whatever this does. `dog` is the entry's handle on the watchdog thread: before every step that can hang, the rows
// to write if it does are handed over (`arm`), and the rows of a finished run are written only if the watchdog has
// not taken the run (`finish`).
export async function run({ root, env = process.env, dir = logDir(root, env), dog = null, stdin = () => readFileSync(0, 'utf8') } = {}) {
  const ts = new Date().toISOString()
  const node = process.versions.node
  const late = (phase, short, finding) => dog?.arm([['calls.jsonl', { ...short, kind: 'timeout', phase }], ['findings.jsonl', { ...finding, kind: 'timeout', phase }]])
  const write = (short, finding) => {
    if (dog && !dog.finish()) return
    if (short) appendRow(dir, 'calls.jsonl', short)
    if (finding) appendRow(dir, 'findings.jsonl', finding)
  }

  const nobody = { ts, agent: agentLabel(root, env), node }
  late('stdin', nobody, nobody)
  let payload
  try {
    payload = JSON.parse(stdin())
  } catch (err) {
    write(null, { ...nobody, kind: 'error', error: `no payload: ${String(err?.message ?? err)}` })
    return { kind: 'error' }
  }
  const tool = String(payload?.tool_name ?? '')
  if (!isJudgedTool(tool)) return { kind: 'skip' }
  const job = {
    root,
    toolName: tool,
    toolInput: payload?.tool_input ?? {},
    cwd: payload?.cwd ?? null,
    projectDir: env.CLAUDE_PROJECT_DIR || null,
    configDir: env.CLAUDE_CONFIG_DIR || null,
  }
  const who = { ts, agent: agentLabel(root, env, job.cwd), tool: /^mcp__/i.test(tool) ? 'mcp' : tool, node }
  const detail = {
    tool,
    session: payload?.session_id,
    agent_type: payload?.agent_type,
    cwd: payload?.cwd,
    project_dir: job.projectDir,
    config_dir: job.configDir,
    ...loggedInput(tool, payload?.tool_input),
  }
  late('decision', who, { ...who, ...detail })

  let v
  let classes
  try {
    const { judge, classesFor } = await import('./decide.mjs')
    v = judge(job)
    if (v.kind === 'would-deny' || v.kind === 'exempted') {
      const verdict = { sub: v.sub, reason: v.reason, ms: v.ms, base_deny: v.base_deny, base_reason: v.base_reason, exemption: v.exemption, git_out: v.git_out, supplements: v.supplements, error: v.error }
      late('attribute', { ...who, ...verdict }, { ...who, ...detail, ...verdict, verdict: v.kind, classes: null })
      classes = classesFor(v.decided ? { ...job, toolInput: v.decided } : job, ATTRIBUTE_UNTIL_MS - performance.now())
    }
  } catch (err) {
    if (!v) v = { kind: 'error', error: `the decision did not run: ${String(err?.stack ?? err).slice(0, 2000)}` }
    else { classes = null; v = { ...v, attribute_error: String(err?.message ?? err).slice(0, 500) } }
  }
  const short = { ...who, sub: v.sub, kind: v.kind, reason: v.reason, ms: v.ms, ms_total: Math.round(performance.now()), dog: dog ? dog.up() : undefined }
  write(short, v.kind === 'allow' ? null : {
    ...short,
    ...detail,
    base_deny: v.base_deny,
    base_reason: v.base_reason,
    exemption: v.exemption,
    git_out: v.git_out,
    supplements: v.supplements,
    classes,
    error: v.error,
    attribute_error: v.attribute_error,
  })
  return { ...v, classes }
}

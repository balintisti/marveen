// Card 66d4698a (Isti TG 8534, sirius dbcbb210): no new sub-agent above 75% of the context-guard
// limit; the Agent call is refused with "handoff first". 18 of 290 sub-agent runs died in the guard's
// restart of their parent session.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE = join(REPO, 'scripts', 'hooks', 'subagent-context-gate.py')
const mkTmp = tmpDirs()
const ROOT = mkTmp('subagent-gate-')
const CONFIG = join(ROOT, 'context-guard.json')
writeFileSync(CONFIG, JSON.stringify({
  dexter: { enabled: true, actPct: 0.9, hardPct: 0.97, limitTokens: 200_000 },
  marveen: { enabled: false, actPct: 0.9, hardPct: 0.97, limitTokens: null },
  ford: { enabled: true, actPct: 0.9, hardPct: 0.97, limitTokens: null },
  didi: { enabled: false, actPct: 0.9, hardPct: 0.97, limitTokens: 200_000 },
  zara: { enabled: true, actPct: 0.9, hardPct: 0.97, limitTokens: 0 },
}))

const usage = (tokens: number, extra: Record<string, unknown> = {}) => JSON.stringify({
  type: 'assistant', ...extra,
  message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens - 1_010, cache_creation_input_tokens: 1_000, output_tokens: 99 } },
})
let n = 0
function transcript(agent: string, lines: string[]): string {
  const dir = join(ROOT, 'agents', agent, '.claude-config', 'projects', `-Users-Shared-marveen-${agent}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `s${++n}.jsonl`)
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}
function run(payload: unknown) {
  const r = spawnSync('python3', [GATE], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, SUBAGENT_GATE_CONFIG: CONFIG },
    encoding: 'utf8',
  })
  return { status: r.status, stderr: r.stderr }
}
const call = (agent: string, tokens: number, tool = 'Agent', more: string[] = []) =>
  run({ tool_name: tool, tool_input: { prompt: 'x' }, cwd: `/Users/Shared/marveen-${agent}`, transcript_path: transcript(agent, [usage(5_000), usage(tokens), ...more]) })

describe('the card controls', () => {
  it('76% of the 200k limit: refused, loudly, with the way out', () => {
    const r = call('dexter', 152_000)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('SUBAGENT-GATE (card 66d4698a): no new sub-agent at 76% context (152000 of 200000 tokens')
    expect(r.stderr).toContain('Handoff first')
  })
  it('60%: goes through', () => {
    const r = call('dexter', 120_000)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })
  it('the coordinator, whose guard is off: out of scope even at 95%', () => {
    expect(call('marveen', 190_000).status).toBe(0)
  })
})

describe('edges', () => {
  it('exactly 75% is refused, just below is not', () => {
    expect(call('dexter', 150_000).status).toBe(2)
    expect(call('dexter', 149_999).status).toBe(0)
  })
  it('the Task name is gated too; any other tool is not', () => {
    expect(call('dexter', 160_000, 'Task').status).toBe(2)
    expect(call('dexter', 160_000, 'Bash').status).toBe(0)
  })
  it('an agent without a limitTokens cap is not gated (no cap-relative percentage)', () => {
    expect(call('ford', 190_000).status).toBe(0)
  })
  it('a capped agent whose guard is switched off is not gated either', () => {
    expect(call('didi', 190_000).status).toBe(0)
  })
  it('a zero limit is no cap, and no division by zero (that would exit 1)', () => {
    const r = call('zara', 190_000)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })
  it('the LAST main-chain usage decides; a later sidechain line does not', () => {
    expect(call('dexter', 100_000, 'Agent', [usage(190_000, { isSidechain: true })]).status).toBe(0)
    expect(call('dexter', 190_000, 'Agent', [usage(10_000, { isSidechain: true })]).status).toBe(2)
  })
  it('the agent comes from the cwd when the transcript path does not name it', () => {
    const file = transcript('dexter', [usage(170_000)])
    const moved = join(ROOT, 'elsewhere.jsonl')
    writeFileSync(moved, readFileSync(file))
    expect(run({ tool_name: 'Agent', cwd: '/Users/Shared/marveen-dexter', transcript_path: moved }).status).toBe(2)
    expect(run({ tool_name: 'Agent', cwd: '/tmp/somewhere', transcript_path: moved }).status).toBe(0)
  })
  it('never exits 1: garbage, a missing transcript, an unknown agent all let the call through', () => {
    expect(run('not json').status).toBe(0)
    expect(run({ tool_name: 'Agent', cwd: '/Users/Shared/marveen-dexter', transcript_path: join(ROOT, 'nope.jsonl') }).status).toBe(0)
    expect(call('nobody', 190_000).status).toBe(0)
  })
})

describe('wiring: every agent session gets it from the settings template', () => {
  it('the template runs the gate on Agent|Task', () => {
    const tpl = JSON.parse(readFileSync(join(REPO, 'templates', 'settings.json.template'), 'utf8').replaceAll('{{PROJECT_ROOT}}', '/x'))
    const entry = (tpl.hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>)
      .find((e) => e.hooks.some((h) => h.command.includes('/scripts/hooks/subagent-context-gate.py')))
    expect(entry?.matcher).toBe('Agent|Task')
  })
})

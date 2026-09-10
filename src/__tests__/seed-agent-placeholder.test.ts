import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// EVERY shipped task-config that declares `agent` must use the placeholder, not
// a concrete agent id -- an agent name is not portable between installs, and on
// another machine that name simply does not exist.
//
// The rule already existed and was already TESTED -- three times, once per task
// (kanban-audit, auto-update, post-rollback-diagnose). Nothing covered the
// CLASS, so a seed added later got no guard at all: I added
// seed-scheduled-tasks/reggeli-napindito this afternoon with a literal
// `marveen` in it, one of seven, and every existing guard stayed green.
//
// That is this page's own shape -- a per-instance check reads exactly like a
// per-class one until someone adds the instance nobody wrote a check for.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIRS = ['seed-scheduled-tasks', 'scheduled-tasks']

function configs(): { path: string; agent: unknown }[] {
  const out: { path: string; agent: unknown }[] = []
  for (const d of DIRS) {
    const root = join(ROOT, d)
    if (!existsSync(root)) continue
    for (const task of readdirSync(root)) {
      const p = join(root, task, 'task-config.json')
      if (!existsSync(p)) continue
      out.push({ path: `${d}/${task}`, agent: JSON.parse(readFileSync(p, 'utf-8')).agent })
    }
  }
  return out
}

describe('shipped task-configs carry no concrete agent id', () => {
  it('finds the shipped configs at all (positive control)', () => {
    // Without this the assertion below is satisfied by an empty list, which is
    // exactly how a per-instance guard fails to become a per-class one.
    expect(configs().length).toBeGreaterThan(5)
  })

  it('every declared agent is the placeholder', () => {
    const bad = configs().filter((c) => c.agent !== undefined && c.agent !== '{{MAIN_AGENT_ID}}')
    expect(bad.map((b) => `${b.path}: ${String(b.agent)}`)).toEqual([])
  })

  it('CONTROL: the check can say no -- a concrete id is rejected', () => {
    const bad = [{ path: 'x', agent: 'jarvis' }].filter(
      (c) => c.agent !== undefined && c.agent !== '{{MAIN_AGENT_ID}}')
    expect(bad.length).toBe(1)
  })

  it('CONTROL: and an ABSENT agent is allowed -- the loader defaults it', () => {
    // scheduled-tasks-io.ts: `agent: config.agent || MAIN_AGENT_ID`. Omitting
    // the key is legal; only a WRONG value is not.
    const bad = [{ path: 'x', agent: undefined }].filter(
      (c) => c.agent !== undefined && c.agent !== '{{MAIN_AGENT_ID}}')
    expect(bad.length).toBe(0)
  })
})

// Card fe838f28, didi 59440 L1: the census must list every task directory the schedule runner
// reads. The census once filtered with Dirent.isDirectory() and skipped dot-names, while the runner
// (listScheduledTasks) follows symlinks and keeps dot-names: a `.hidden` or symlinked task the
// runner fires was invisible to the census. This file runs BOTH on the same sandbox HOME.
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// SCHEDULED_TASKS_DIR is computed from homedir() when scheduled-tasks-io loads: the sandbox HOME
// is set before that import below.
const h = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => h.home }))
vi.mock('../config.js', () => ({ MAIN_AGENT_ID: 'marveen' }))
vi.mock('../web/agent-config.js', () => ({ readJsonObjectForWrite: vi.fn(() => ({})) }))

const mkTmp = tmpDirs()
h.home = mkTmp('census-parity-home-')
const tasks = join(h.home, '.claude', 'scheduled-tasks')
const outside = mkTmp('census-parity-outside-')

function task(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\ndescription: d\n---\n\nprompt\n')
}
task(join(tasks, 'plain-foreign'))
task(join(tasks, '.hidden-foreign'))
task(join(outside, 'target'))
symlinkSync(join(outside, 'target'), join(tasks, 'linked-foreign'))
symlinkSync(join(outside, 'gone'), join(tasks, 'dangling'))
writeFileSync(join(outside, 'file'), 'x')
symlinkSync(join(outside, 'file'), join(tasks, 'link-to-file'))
writeFileSync(join(tasks, '.removed-defaults'), 'x\n')

const { SCHEDULED_TASKS_DIR, listScheduledTasks } = await import('../web/scheduled-tasks-io.js')
const { readScheduledTasks } = await import('../scheduler-census.js')

describe('census and runner list the same scheduled tasks', () => {
  it('the sandbox is the one both read', () => {
    expect(SCHEDULED_TASKS_DIR).toBe(tasks)
  })

  it('a dot-named and a symlinked task dir: the runner reads them, so the census lists them', () => {
    const runner = listScheduledTasks().map((t) => t.name).sort()
    const r = readScheduledTasks(tasks)
    expect(r.reached).toBe(true)
    const census = r.reached ? r.entries.map((e) => e.label).sort() : []
    expect(runner).toEqual(['.hidden-foreign', 'linked-foreign', 'plain-foreign'])
    expect(census).toEqual(runner)
  })
})

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { listAncestorPids } from '../process-tree.js'

// Card 77a48069: the takeover excludes its own launcher chain. Real processes:
// a grandchild must list this test process among its ancestors.

const here = dirname(fileURLToPath(import.meta.url))

describe('listAncestorPids (77a48069)', () => {
  it('a grandchild lists this test process among its ancestors, and never init', () => {
    // node -> sh -> node: the inner node reports listAncestorPids(process.ppid).
    const tsx = join(here, '..', '..', 'node_modules', '.bin', 'tsx')
    const script = `import { listAncestorPids } from ${JSON.stringify(join(here, '..', 'process-tree.ts'))}; console.log(JSON.stringify([...listAncestorPids(process.ppid)]))`
    const res = spawnSync('/bin/sh', ['-c', `"${tsx}" -e '${script}'`], { encoding: 'utf-8', timeout: 30000 })
    expect(res.status).toBe(0)
    const pids = JSON.parse(res.stdout.trim().split('\n').pop()!) as number[]
    expect(pids).toContain(process.pid)
    expect(pids).not.toContain(1)
    expect(pids).not.toContain(0)
  })

  it('returns an empty set for init or an invalid pid', () => {
    expect([...listAncestorPids(1)]).toEqual([])
    expect([...listAncestorPids(0)]).toEqual([])
    expect([...listAncestorPids(Number.NaN)]).toEqual([])
  })

  it('a pid that no longer exists ends the walk after itself', () => {
    // 2^22 is above the default pid_max on macOS and Linux: ps fails, the walk stops.
    expect([...listAncestorPids(4194303)]).toEqual([4194303])
  })
})

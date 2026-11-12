/**
 * y1-report-only: the vendored upstream gate is the upstream gate (card 5b639edb).
 *
 * The hook reports what the UPSTREAM sub-agent write gate would deny, so the copies under
 * scripts/hooks/y1-report-only/upstream/ must stay byte-identical to the commit MANIFEST.json names. A local edit
 * there would make the report a report about our own code. Each file's git blob id is computed here from its bytes
 * and compared with the manifest; where the upstream commit is in this clone's object store, the manifest itself is
 * compared with that commit.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const UPSTREAM = join(ROOT, 'scripts', 'hooks', 'y1-report-only', 'upstream')
const COMMIT = '4bdb49da2fcdd809a91c1d8e9e884d0045993a0e'

interface Manifest { upstream: string; commit: string; files: Record<string, string> }
const manifest = JSON.parse(readFileSync(join(UPSTREAM, 'MANIFEST.json'), 'utf8')) as Manifest

function blobId(path: string): string {
  const bytes = readFileSync(path)
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`])
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

describe('y1-report-only: the vendored gate is pinned to its upstream commit', () => {
  it('names the upstream repository and the commit the card was approved for', () => {
    expect(manifest.upstream).toBe('Szotasz/marveen')
    expect(manifest.commit).toBe(COMMIT)
  })

  it('holds the five files of the gate', () => {
    expect(Object.keys(manifest.files).sort()).toEqual([
      'scripts/hooks/child-claude-channel-guard.mjs',
      'scripts/hooks/db-write-gate.mjs',
      'scripts/hooks/mcp-file-targets.mjs',
      'scripts/hooks/py-inline-data.py',
      'scripts/self-pace-gate.mjs',
    ])
  })

  it.each(Object.entries(manifest.files))('%s is byte-identical to the blob the manifest names', (path, id) => {
    expect(id).toMatch(/^[0-9a-f]{40}$/)
    expect(blobId(join(UPSTREAM, path))).toBe(id)
  })

  it('has no file under upstream/ that the manifest does not name', () => {
    expect(filesUnder(UPSTREAM).sort()).toEqual(['MANIFEST.json', ...Object.keys(manifest.files)].sort())
  })

  // The manifest and a file could be edited together. The commit is the anchor neither of them can move, but only a
  // clone that has fetched the upstream holds it: elsewhere this case is reported as skipped, not as passed.
  const haveCommit = git('cat-file', '-e', `${COMMIT}^{commit}`) !== null
  it.skipIf(!haveCommit)('names the blobs the upstream commit holds (needs the commit in this clone)', () => {
    for (const [path, id] of Object.entries(manifest.files)) {
      expect(git('rev-parse', `${COMMIT}:${path}`), path).toBe(id)
    }
  })
})

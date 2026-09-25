import { describe, it, expect, afterAll } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { projectsDirFor } from '../web/active-model.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()

describe('projectsDirFor', () => {
  it('uses <home>/.claude/projects when no config dir is given', () => {
    const result = projectsDirFor('/home/u/work', undefined, '/home/u')
    expect(result).toBe(join('/home/u', '.claude', 'projects', '-home-u-work'))
  })

  it('uses the supplied config dir instead of the default home location', () => {
    const result = projectsDirFor('/home/u/work', '/home/u/.claude-coding', '/home/u')
    expect(result).toBe(join('/home/u/.claude-coding', 'projects', '-home-u-work'))
  })

  it('does not fall back to the home dir when a config dir is supplied', () => {
    const result = projectsDirFor('/home/u/work', '/var/lib/claude-coding', '/home/u')
    expect(result.startsWith('/var/lib/claude-coding')).toBe(true)
    expect(result).not.toContain('/home/u/.claude')
  })

  it('encodes slashes and dots in the working dir to dashes', () => {
    const result = projectsDirFor('/home/u/some.dir/app', '/cfg', '/home/u')
    expect(result).toBe(join('/cfg', 'projects', '-home-u-some-dir-app'))
  })

  it('produces distinct project dirs for the same working dir on different config roots', () => {
    const a = projectsDirFor('/w', '/home/u/.claude', '/home/u')
    const b = projectsDirFor('/w', '/home/u/.claude-coding', '/home/u')
    expect(a).not.toBe(b)
  })

  // Card 5c094718: every detached fleet agent's working dir is a symlink
  // (`agents/<name>` -> `/Users/Shared/marveen-<name>`). Claude Code keys the
  // project dir off the RESOLVED cwd, so encoding the unresolved path pointed
  // the guard at a directory that existed and held yesterday's transcripts --
  // a reading that never changed, and therefore restarted the agent forever.
  describe('symlinked working dirs', () => {
    const root = realpathSync(mkTmp('projdir-'))
    const real = join(root, 'real-home')
    const link = join(root, 'link-to-home')
    mkdirSync(real)
    symlinkSync(real, link)
    afterAll(() => { rmSync(root, { recursive: true, force: true }) })

    it('keys off the RESOLVED path, so a symlink and its target agree', () => {
      const viaLink = projectsDirFor(link, '/cfg')
      const viaReal = projectsDirFor(real, '/cfg')
      // Guards against the defect: keying the unresolved path makes these differ.
      expect(viaLink).toBe(viaReal)
      expect(viaLink).toBe(join('/cfg', 'projects', real.replace(/[/.]/g, '-')))
    })

    it('falls back to the raw path when the working dir does not exist', () => {
      const missing = join(root, 'no-such-dir')
      expect(projectsDirFor(missing, '/cfg')).toBe(
        join('/cfg', 'projects', missing.replace(/[/.]/g, '-')),
      )
    })
  })
})

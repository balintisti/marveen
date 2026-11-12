// The re-check after the rename in releaseOwnRespawnStamp (card 85ddce83, T2 of didi's
// review of the bd36ce7d76 port): the stamp is read, judged ours, then moved aside. If
// another actor wrote ITS stamp between that read and the rename, the moved copy is not
// ours and must be put back. respawn-stamp-release.test.ts (upstream's) never opens that
// window, so `moved.trim() === own.value` -> `true` stayed green. Here renameSync is
// wrapped so a foreign stamp lands exactly in the window.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const race = vi.hoisted(() => ({ before: null as null | ((from: string) => void) }))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      const hook = race.before
      race.before = null
      if (hook) hook(from)
      return real.renameSync(from, to)
    },
  }
})

const { releaseOwnRespawnStamp } = await import('../web/respawn-stamp-release.js')

const SETTLE = 240_000
const AT = 1_790_000_000_000
const OWN = { value: String(Math.floor(AT / 1000)), at: AT }
const FOREIGN = String(Math.floor(AT / 1000) + 90)

const mkTmp = tmpDirs()

describe('releaseOwnRespawnStamp: a stamp written between our read and the rename', () => {
  let dir: string
  let stamp: string
  beforeEach(() => {
    dir = mkTmp('stamp-release-race-')
    stamp = join(dir, '.channel-last-respawn')
  })

  it('is put back, not deleted, and the release reports not-ours', () => {
    writeFileSync(stamp, OWN.value)
    race.before = (from) => writeFileSync(from, FOREIGN)
    expect(releaseOwnRespawnStamp(stamp, OWN, AT + SETTLE, SETTLE)).toBe('not-ours')
    expect(readFileSync(stamp, 'utf-8')).toBe(FOREIGN)
    expect(readdirSync(dir)).toEqual(['.channel-last-respawn'])
  })

  it('control: with nothing in the window our own stamp is released', () => {
    writeFileSync(stamp, OWN.value)
    race.before = () => {}
    expect(releaseOwnRespawnStamp(stamp, OWN, AT + SETTLE, SETTLE)).toBe('release')
    expect(existsSync(stamp)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })
})

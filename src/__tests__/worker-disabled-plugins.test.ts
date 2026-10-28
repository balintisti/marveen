import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureWorkerCwd, makeWorkerCtx } from '../web/agent-worker.js'
import { CHANNEL_PLUGIN_IDS } from '../web/plugin-ids.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()

// WHAT THIS PINS (card dcdcab66). The worker's isolated settings.json carries an
// enabledPlugins block that force-disables the channel plugins. Claude Code keys that
// block by the FULL plugin id (<name>@<marketplace>); the list used to hold the short
// names ('telegram', 'slack-channel'), which match no installed plugin, so the block
// disabled nothing. Measured 2026-10-09: the worker settings held exactly those two
// short keys, both false, and the real ids (telegram@claude-plugins-official,
// slack-channel@marveen-marketplace) were absent.
//
// ensureWorkerCwd really runs here, but both homedir() (HOME) and the worker ctx point
// into a temp dir, so nothing under the real ~/.claude or ~/.marveen-worker is touched.
describe('ensureWorkerCwd: worker settings.json disables every channel plugin by full id', () => {
  let fakeHome: string
  let ctx: ReturnType<typeof makeWorkerCtx>
  const readEnabled = (): Record<string, boolean> =>
    JSON.parse(readFileSync(join(ctx.configDir, 'settings.json'), 'utf-8')).enabledPlugins

  beforeEach(() => {
    fakeHome = mkTmp('worker-plugins-home-')
    mkdirSync(join(fakeHome, '.claude'), { recursive: true })
    vi.stubEnv('HOME', fakeHome)
    ctx = makeWorkerCtx('test-worker', join(fakeHome, '.test-worker'))
  })
  afterEach(() => vi.unstubAllEnvs())

  it('CONTROL: the fixture home is what the code sees', async () => {
    const { homedir } = await import('node:os')
    expect(homedir()).toBe(fakeHome)
  })

  it('writes every CHANNEL_PLUGIN_IDS value as false', () => {
    ensureWorkerCwd(ctx)
    const enabled = readEnabled()
    const ids = Object.values(CHANNEL_PLUGIN_IDS)
    expect(ids.length).toBeGreaterThanOrEqual(5)
    for (const id of ids) expect(enabled[id], id).toBe(false)
  })

  it('overrides an inherited enabled=true for a full id', () => {
    mkdirSync(ctx.configDir, { recursive: true })
    writeFileSync(join(ctx.configDir, 'settings.json'), JSON.stringify({
      enabledPlugins: { [CHANNEL_PLUGIN_IDS.telegram]: true, 'keep-me@somewhere': true },
    }))
    ensureWorkerCwd(ctx)
    const enabled = readEnabled()
    expect(enabled[CHANNEL_PLUGIN_IDS.telegram]).toBe(false)
    expect(enabled['keep-me@somewhere']).toBe(true)
  })
})

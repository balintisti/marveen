// Tick-harness a channel-monitor ujraindulas-felismeresehez (kartya 8908acbc).
//
// A startChannelPluginMonitor() check() zarlata a 60 mp-es setInterval-bol fut, es ket hivast
// tartalmaz: checkMainIdentityAfterRestart() (a fo session /rename-je) es
// checkMainPluginUnlockAfterRestart() (a csatorna-plugin /mcp probaja, 'failed-only' szaballyal).
// Eddig ezt csak forrasszoveg rogzitette (channel-plugin-unlock-in-lane.test.ts 'wiring'): egy
// `if (false) {}` kore tett hivas vagy egy korai `return` a hivasok elott a szoveg-tesztet nem
// buktatta (tulelo mutansok M8d, M8e). Ez a teszt a VALODI monitort inditja, hamis idozitovel es
// hamis tmux/pid forrassal, es a viselkedest meri: egy uj pane-pid utan a tick utemezi az
// identitast ES a plugin-unlockot, ugyanazzal a pid-del a kovetkezo tickek nem ismetlik.
//
// BIZTONSAG (egy runner-teszt egyszer elesben ujrainditotta a marveent): a node:child_process
// TELJESEN hamis (nincs importOriginal), minden hivas rogzitesre kerul, a vegen egy census
// bizonyitja, hogy csak a ket olvaso tmux-hivas (has-session, list-panes) es a ps etime futott.
// A db, az ertesitok, a rendszer-direktiva es az agent-process hamis; a PROJECT_ROOT egy
// mkdtemp konyvtar, es minden fajl-iras rogzitve van es abban a konyvtarban kell maradjon.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const H = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tick-harness-')))
  const state = {
    sessionExists: true,
    panePid: 1111,
    paneEtime: '30-00:00:00', // a pane regi: az elso olvasas nem "a dashboarddal indult"
  }
  // Minden child_process hivas ide kerul: [api, parancs, argumentumok].
  const execCalls: Array<[string, string, string[]]> = []
  const fsWrites: string[] = []
  const scheduleIdentitySetup = vi.fn()
  const schedulePluginUnlockAfterRespawn = vi.fn()
  // Minden nem felsorolt export egy vi.fn: a monitor sok modult huz be, a teszt csak a
  // felsoroltakat hasznalja, a tobbi nem hivodhat az utvonalon (a vi.fn hivasa nem csinal semmit).
  const autoMock = <T extends Record<string, unknown>>(overrides: T) => new Proxy(overrides, {
    get(t, k) {
      if (k in t) return (t as Record<string | symbol, unknown>)[k]
      if (typeof k !== 'string' || k === 'then' || k === '__esModule') return undefined
      const f = vi.fn()
      ;(t as Record<string, unknown>)[k] = f
      return f
    },
    has(t, k) { return k in t || (typeof k === 'string' && k !== 'then' && k !== '__esModule') },
  })
  return { tmp, state, execCalls, fsWrites, scheduleIdentitySetup, schedulePluginUnlockAfterRespawn, autoMock }
})
mkTmp.adopt(H.tmp)   // a vi.hoisted-ben keszult, ahol a mkTmp meg nem letezik

const FAKE_TMUX = '/fake/bin/tmux'
const IDLE_PANE = 'scrollback\n──────────\n ❯ \n──────────\n  ⏵⏵ bypass permissions on (shift+tab to cycle)'

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

// TELJES hamis child_process: nincs importOriginal, semmi nem fut valodiban.
vi.mock('node:child_process', () => {
  const blocked = (api: string) => (cmd: string, args?: unknown) => {
    H.execCalls.push([api, String(cmd), Array.isArray(args) ? args.map(String) : []])
    throw new Error(`child_process.${api} is blocked in the tick harness`)
  }
  const execFileSync = (cmd: string, args: string[] = []) => {
    H.execCalls.push(['execFileSync', cmd, args.map(String)])
    if (cmd === FAKE_TMUX && args[0] === 'has-session') {
      if (H.state.sessionExists) return ''
      throw Object.assign(new Error('no session'), { status: 1 })
    }
    if (cmd === FAKE_TMUX && args[0] === 'list-panes') return `${H.state.panePid}\n`
    if (cmd === '/bin/ps' && args.includes('etime=')) return `${H.state.paneEtime}\n`
    throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`)
  }
  const api = {
    execFileSync,
    execFile: blocked('execFile'),
    execSync: blocked('execSync'),
    exec: blocked('exec'),
    spawn: blocked('spawn'),
    spawnSync: blocked('spawnSync'),
  }
  return { ...api, default: api }
})

// RESPAWN_ENABLED kenyszeritve, a PROJECT_ROOT eldobhato konyvtar.
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, RESPAWN_ENABLED: true, PROJECT_ROOT: H.tmp }
})

// A tmux keresese ne fuggjon a gep PATH-jatol: a hamis child_process ugyis csak ezt a nevet ismeri.
vi.mock('../platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform.js')>()
  const fake = (name: string) => (name === 'tmux' ? FAKE_TMUX : `/fake/bin/${name}`)
  // A resolveFromPath is hamis: a valodi `which <nev>`-et futtat execSync-kel.
  return { ...actual, makeLazyBinResolver: (name: string) => () => fake(name), resolveFromPath: fake }
})

// Fajl-iras rogzito: a teszt vegen minden iras a mkdtemp konyvtarban kell legyen.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const rec = <F extends (...a: any[]) => any>(fn: F): F =>
    ((...a: any[]) => { H.fsWrites.push(String(a[0])); return fn(...a) }) as F
  return {
    ...actual,
    writeFileSync: rec(actual.writeFileSync),
    appendFileSync: rec(actual.appendFileSync),
    utimesSync: rec(actual.utimesSync),
    mkdirSync: rec(actual.mkdirSync),
    renameSync: rec(actual.renameSync),
    unlinkSync: rec(actual.unlinkSync),
    rmSync: rec(actual.rmSync),
    copyFileSync: rec(actual.copyFileSync),
  }
})

vi.mock('../db.js', () => H.autoMock({ createAgentMessage: vi.fn(), listKanbanCards: vi.fn(() => []) }))
vi.mock('../notify.js', () => H.autoMock({ notifyChannel: vi.fn() }))
vi.mock('../web/routine-alert.js', () => H.autoMock({ sendRoutineAlert: vi.fn() }))
vi.mock('../web/system-directive.js', () => H.autoMock({ sendSystemDirective: vi.fn() }))

// A fo pane: idle doboz, igy a tobbi tick-lepes (menu, stuck-input) nem csinal semmit.
vi.mock('../web/agent-process.js', () => H.autoMock({
  scheduleIdentitySetup: H.scheduleIdentitySetup,
  stampFableOverageConsentSharedRoots: vi.fn(),
  agentSessionName: (n: string) => `agent-${n}`,
  agentHasChannel: () => false,
  isAgentRunning: () => false,
  capturePane: () => IDLE_PANE,
  capturePaneWithHistory: () => IDLE_PANE,
  captureParkedInputView: () => IDLE_PANE,
}))
vi.mock('../web/agent-config.js', () => H.autoMock({
  listAgentNames: () => [],
  agentDir: (n: string) => `${H.tmp}/agents/${n}`,
  readAgentChannelProvider: () => 'telegram',
}))
vi.mock('../web/agent-desired-state.js', () => ({ getDesiredAgents: () => new Set<string>() }))
vi.mock('../web/channel-poller-reap.js', () => H.autoMock({
  reapChannelOrphans: vi.fn(() => []),
  reapDetachedChannelClaudes: vi.fn(() => []),
  reapForeignMainPollers: vi.fn(() => []),
  collectPollerEvidence: vi.fn(() => ({})),
}))
vi.mock('../web/sleep-wake-detector.js', () => H.autoMock({
  startSleepWakeDetector: vi.fn(),
  systemSleptBetween: () => false,
}))
vi.mock('../web/fleet-freeze.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/fleet-freeze.js')>()
  return { ...actual, whileNotFrozen: <A extends unknown[], R>(_label: string, tick: (...a: A) => R) => tick }
})

// A plugin-probe: csak az utemezes hivasa figyelt, a tobbi export valodi.
vi.mock('../web/channel-plugin-unlock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/channel-plugin-unlock.js')>()
  return { ...actual, schedulePluginUnlockAfterRespawn: H.schedulePluginUnlockAfterRespawn }
})

// A claude pid letezik, a plugin-eletjel "unknown": a tick a fo celpontnal megall, nem indit ujra semmit.
vi.mock('../channel-coordinator/liveness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../channel-coordinator/liveness.js')>()
  return {
    ...actual,
    getClaudePidForSession: () => 4242,
    hasChannelPluginAlive: () => true,
    probeChannelPluginLiveness: () => 'unknown',
    classifyRespawnStampAdvance: () => 'none',
  }
})

import { BOT_NAME, CHANNEL_PROVIDER } from '../config.js'
import { getProvider } from '../channel-provider.js'
import { MAIN_CHANNELS_SESSION } from '../web/main-agent.js'
import { logger } from '../logger.js'

const TICK_FIRST_MS = 30_000
const TICK_MS = 60_000

let timer: NodeJS.Timeout | null = null

async function startMonitor(): Promise<void> {
  vi.resetModules()
  const { startChannelPluginMonitor } = await import('../web/channel-monitor.js')
  timer = startChannelPluginMonitor()
  expect(timer, 'a monitor nem indult el (RESPAWN_ENABLED?)').not.toBeNull()
}

const listPanesCalls = () => H.execCalls.filter(([api, cmd, args]) => api === 'execFileSync' && cmd === FAKE_TMUX && args[0] === 'list-panes').length

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(H.state, { sessionExists: true, panePid: 1111, paneEtime: '30-00:00:00' })
  H.execCalls.length = 0
  H.fsWrites.length = 0
  H.scheduleIdentitySetup.mockClear()
  H.schedulePluginUnlockAfterRespawn.mockClear()
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
})
afterEach(() => {
  if (timer) clearInterval(timer)
  timer = null
  vi.useRealTimers()
})

describe('startChannelPluginMonitor tick: restart detection reaches identity AND plugin unlock', () => {
  it('a new main pane pid schedules the /rename and the failed-only unlock once; the same pid on later ticks does not repeat', async () => {
    await startMonitor()

    // 1. tick (30 mp): alap-olvasas egy REGI pane-nel -> nincs ujraindulas, nincs utemezes.
    await vi.advanceTimersByTimeAsync(TICK_FIRST_MS)
    // Pozitiv kontroll: a tick valoban lefutott es olvasta a pane pid-et.
    expect(listPanesCalls(), 'az elso tick nem olvasta a pane pid-et').toBeGreaterThanOrEqual(1)
    expect(H.scheduleIdentitySetup).not.toHaveBeenCalled()
    expect(H.schedulePluginUnlockAfterRespawn).not.toHaveBeenCalled()

    // 2. a claude pid megvaltozik (launchd reload / kickstart / KeepAlive), a kovetkezo tick (60 mp) latja.
    H.state.panePid = 2222
    await vi.advanceTimersByTimeAsync(TICK_FIRST_MS)

    // (a) identitas: /rename utemezve a fo sessionre, a BOT_NAME-mel.
    expect(H.scheduleIdentitySetup).toHaveBeenCalledTimes(1)
    expect(H.scheduleIdentitySetup).toHaveBeenCalledWith(MAIN_CHANNELS_SESSION, BOT_NAME)
    // (b) plugin-unlock: hideg inditas = 'failed-only' szabaly.
    expect(H.schedulePluginUnlockAfterRespawn).toHaveBeenCalledTimes(1)
    expect(H.schedulePluginUnlockAfterRespawn).toHaveBeenCalledWith(MAIN_CHANNELS_SESSION, getProvider(CHANNEL_PROVIDER).type, 'failed-only')

    // Negativ: ugyanaz a pid, a dedupe-ablakon (120 mp) TUL is (5 tick) -> nincs masodik utemezes.
    const picksBefore = listPanesCalls()
    await vi.advanceTimersByTimeAsync(5 * TICK_MS)
    expect(listPanesCalls(), 'a kesobbi tickek nem futottak').toBeGreaterThanOrEqual(picksBefore + 5)
    expect(H.scheduleIdentitySetup).toHaveBeenCalledTimes(1)
    expect(H.schedulePluginUnlockAfterRespawn).toHaveBeenCalledTimes(1)

    // A hivasok nem elnyelt hibak mogott maradtak ki: a monitor nem naplozott "check failed"-et.
    const warned = vi.mocked(logger.warn).mock.calls.map((c) => String(c[1] ?? ''))
    expect(warned.filter((m) => /main (identity|plugin unlock) check failed/.test(m))).toEqual([])
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled()
  })

  it('a pane that came up WITH the dashboard is named and probed on the first tick (started-with-dashboard)', async () => {
    H.state.paneEtime = '00:20' // 20 mp-es pane
    await startMonitor()
    await vi.advanceTimersByTimeAsync(TICK_FIRST_MS)

    expect(H.scheduleIdentitySetup).toHaveBeenCalledTimes(1)
    expect(H.scheduleIdentitySetup).toHaveBeenCalledWith(MAIN_CHANNELS_SESSION, BOT_NAME)
    expect(H.schedulePluginUnlockAfterRespawn).toHaveBeenCalledTimes(1)
    expect(H.schedulePluginUnlockAfterRespawn).toHaveBeenCalledWith(MAIN_CHANNELS_SESSION, getProvider(CHANNEL_PROVIDER).type, 'failed-only')
  })

  it('call census: only the read-only tmux calls and ps ran, no restart/keystroke/launchd command, writes stayed in the temp dir', async () => {
    // Onallo teszt: sajat tickeket futtat, nem a fenti futasok maradekabol szamol.
    await startMonitor()
    await vi.advanceTimersByTimeAsync(TICK_FIRST_MS)
    H.state.panePid = 3333
    await vi.advanceTimersByTimeAsync(3 * TICK_MS)

    // Pozitiv kontroll: a hamis forras tenyleg hivodott (nem ures a census).
    expect(H.execCalls.length).toBeGreaterThan(0)
    expect(H.scheduleIdentitySetup).toHaveBeenCalled()

    // Csak az execFileSync API, csak a ket olvaso tmux-alparancs es a ps etime.
    for (const [api, cmd, args] of H.execCalls) {
      expect(api, `${api} ${cmd} ${args.join(' ')}`).toBe('execFileSync')
      const ok = (cmd === FAKE_TMUX && (args[0] === 'has-session' || args[0] === 'list-panes')) || (cmd === '/bin/ps' && args.includes('etime='))
      expect(ok, `nem engedelyezett hivas: ${cmd} ${args.join(' ')}`).toBe(true)
    }
    // Tiltott szavak, kulon is (ha a fenti lista valaha tagulna).
    const flat = H.execCalls.map(([, cmd, args]) => `${cmd} ${args.join(' ')}`).join('\n')
    expect(flat).not.toMatch(/launchctl|kickstart|kill|respawn-pane|send-keys|new-session/)

    // Fajl-iras: minden a mkdtemp konyvtarban.
    const outside = H.fsWrites.filter((p) => !p.startsWith(H.tmp))
    expect(outside, `iras a mkdtemp konyvtaron kivul: ${outside.join(', ')}`).toEqual([])
  })
})

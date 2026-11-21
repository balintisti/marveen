import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  findOwnNodeHolders,
  findOwnBinaryMatches,
  terminateProcesses,
  acquirePortLock,
  acquirePidfileLock,
  belongsToInstall,
  classifyPortHolders,
  ForeignPortHolderError,
  reclaimPortAfterAddrInUse,
  writeBufferFully,
  DeferToPeerError,
  type ProcessLockContext,
  type PidfileLockContext,
} from '../process-lock.js'

// Build a mock context backed by a mutable process table. Tests drive the
// table directly so we can simulate PIDs dying at specific points, foreign
// UIDs, non-node commands, etc. without ever touching real processes.

interface MockProc { pid: number; uid: number; cmd: string; args?: string; alive: boolean; cwd?: string | null; argvUnreadable?: boolean }

interface MockOptions {
  currentPid?: number
  uid?: number | null
  /** Defaults to SELF_ROOT so existing tests (which don't care about
   * cwd-scoping) keep matching by default; override to test cross-root
   * scoping specifically. */
  selfProjectRoot?: string | null
  procs?: MockProc[]
  portHolders?: Record<number, number[]>
  /** PIDs of the current process's ancestors (its launcher chain). */
  ancestorPids?: number[]
  /** Names of this install; defaults to [selfProjectRoot] (or [] when that is null). */
  installRoots?: string[]
  /** signal-probe override so tests can simulate EPERM etc. */
  signalOverride?: ProcessLockContext['signal']
}

// Default project root shared by currentPid and any MockProc that doesn't
// specify its own `cwd` -- keeps every pre-existing test (written before
// cwd-scoping existed) passing unchanged, since they're not testing that
// dimension.
const SELF_ROOT = '/self/root'

function makeCtx(options: MockOptions): {
  ctx: ProcessLockContext
  table: Map<number, MockProc>
  sleptFor: number[]
  logs: Array<{ level: string; msg: string; obj: Record<string, unknown> }>
  signalCalls: Array<{ pid: number; sig: string }>
} {
  const table = new Map<number, MockProc>()
  for (const p of options.procs ?? []) table.set(p.pid, { ...p })
  const sleptFor: number[] = []
  const logs: Array<{ level: string; msg: string; obj: Record<string, unknown> }> = []
  const signalCalls: Array<{ pid: number; sig: string }> = []
  const log = (level: string) => (obj: Record<string, unknown>, msg?: string) => {
    logs.push({ level, msg: msg ?? '', obj })
  }
  const currentPid = options.currentPid ?? 100
  const uid = options.uid === undefined ? 501 : options.uid
  const defaultSignal: ProcessLockContext['signal'] = (pid, sig) => {
    const p = table.get(pid)
    if (!p || !p.alive) return 'gone'
    if (sig === 0) return 'sent'
    p.alive = false
    return 'sent'
  }
  const selfProjectRoot = options.selfProjectRoot === undefined ? SELF_ROOT : options.selfProjectRoot
  const ctx: ProcessLockContext = {
    currentPid,
    uid,
    selfProjectRoot,
    ancestorPids: new Set(options.ancestorPids ?? []),
    installRoots: options.installRoots ?? (selfProjectRoot != null ? [selfProjectRoot] : []),
    getProcessArgv: (pid: number) => {
      const p = table.get(pid)
      if (!p || p.argvUnreadable) return null
      return p.args ?? p.cmd
    },
    getProcessCwd: (pid: number) => {
      const p = table.get(pid)
      if (!p) return null
      return p.cwd === undefined ? SELF_ROOT : p.cwd
    },
    listPortHolders: (port: number) => options.portHolders?.[port] ?? [],
    listOwnProcessesMatching: (pattern: RegExp) => {
      const out: number[] = []
      for (const p of table.values()) {
        if (!p.alive) continue
        if (p.pid === currentPid) continue
        if (uid != null && p.uid !== uid) continue
        const argv = p.args ?? p.cmd
        if (pattern.test(argv)) out.push(p.pid)
      }
      return out
    },
    getProcessCommand: (pid: number) => table.get(pid)?.cmd ?? null,
    getProcessUid: (pid: number) => {
      const p = table.get(pid)
      return p ? p.uid : null
    },
    signal: (pid, sig) => {
      signalCalls.push({ pid, sig: String(sig) })
      if (options.signalOverride) return options.signalOverride(pid, sig)
      return defaultSignal(pid, sig)
    },
    sleep: async (ms: number) => {
      sleptFor.push(ms)
    },
    log: { info: log('info'), warn: log('warn'), error: log('error') },
  }
  return { ctx, table, sleptFor, logs, signalCalls }
}

describe('findOwnNodeHolders', () => {
  it('returns an empty list when no one holds the port', () => {
    const { ctx } = makeCtx({ portHolders: { 3420: [] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([])
  })

  it('excludes the current PID even if it appears in the holder list', () => {
    const procs: MockProc[] = [
      { pid: 100, uid: 501, cmd: 'node', alive: true },
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx } = makeCtx({ currentPid: 100, procs, portHolders: { 3420: [100, 200] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([200])
  })

  it('excludes processes owned by a different UID', () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 502, cmd: 'node', alive: true },
      { pid: 300, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx, logs } = makeCtx({ uid: 501, procs, portHolders: { 3420: [200, 300] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([300])
    expect(logs.some(l => l.level === 'warn' && /different UID/.test(l.msg))).toBe(true)
  })

  it('excludes non-node commands', () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'nginx', alive: true },
      { pid: 300, uid: 501, cmd: 'node', alive: true },
      { pid: 400, uid: 501, cmd: 'tsx', alive: true },
    ]
    const { ctx, logs } = makeCtx({ procs, portHolders: { 3420: [200, 300, 400] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([300, 400])
    expect(logs.some(l => l.level === 'warn' && /not a node\/tsx/.test(l.msg))).toBe(true)
  })

  it('skips PIDs that are gone between lsof and ps', () => {
    const procs: MockProc[] = [
      { pid: 300, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx } = makeCtx({ procs, portHolders: { 3420: [200, 300] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([300])
  })

  it('skips non-positive or non-finite PIDs defensively', () => {
    const { ctx } = makeCtx({ portHolders: { 3420: [0, -1, NaN as unknown as number] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([])
  })

  it('skips UID check when the platform has no getuid (uid=null)', () => {
    const procs: MockProc[] = [
      { pid: 300, uid: 0, cmd: 'node', alive: true },
    ]
    const { ctx } = makeCtx({ uid: null, procs, portHolders: { 3420: [300] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([300])
  })

  it('deduplicates PIDs that appear twice in the holder list', () => {
    const procs: MockProc[] = [
      { pid: 300, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx } = makeCtx({ procs, portHolders: { 3420: [300, 300] } })
    expect(findOwnNodeHolders(3420, ctx)).toEqual([300])
  })
})

describe('findOwnBinaryMatches', () => {
  it('returns own-UID node processes matching the argv pattern', () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true },
      { pid: 300, uid: 501, cmd: 'node', args: 'node other.js', alive: true },
    ]
    const { ctx } = makeCtx({ procs })
    expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([200])
  })

  it('excludes the current PID even if its argv matches', () => {
    const procs: MockProc[] = [
      { pid: 100, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true },
      { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true },
    ]
    const { ctx } = makeCtx({ currentPid: 100, procs })
    expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([200])
  })

  it('excludes foreign-UID processes even with matching argv', () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 999, cmd: 'node', args: 'node dist/index.js', alive: true },
    ]
    const { ctx } = makeCtx({ uid: 501, procs })
    expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([])
  })

  // Regression for the 2026-07-15 incident: a git worktree of this repo
  // booting dist/index.js matched -- and killed -- the live production
  // dashboard running from a completely different checkout, because the
  // pattern only checks the trailing path segment. Fixed by scoping matches
  // to the candidate process's actual cwd (via /proc/<pid>/cwd in the real
  // ctx, `MockProc.cwd` here).
  describe('cross-worktree scoping (2026-07-15 fix)', () => {
    it('excludes a same-argv-pattern process running from a DIFFERENT project root', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: '/home/user/marveen-worktrees/other-branch' },
      ]
      const { ctx, logs } = makeCtx({ selfProjectRoot: '/home/user/marveen', procs })
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([])
      expect(logs.some(l => l.level === 'warn' && /different project root/.test(l.msg))).toBe(true)
    })

    it('includes a same-argv-pattern process running from the SAME project root', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: '/home/user/marveen' },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/home/user/marveen', procs })
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([200])
    })

    // CWD774FIX: a null cwd means "cannot resolve" (lsof denied, racing exit),
    // NOT "not ours". The candidates reaching here already passed argv-
    // attribution upstream (listOwnProcessesMatching -> argvBelongsToThisInstall),
    // so an own process whose cwd is momentarily unreadable stays reclaimable.
    // Reading null as "different" is what disabled reclaim entirely on macOS.
    it('INCLUDES a candidate whose cwd cannot be resolved (null cwd is not "not ours")', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: null },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/home/user/marveen', procs })
      // Pre-fix this returned [] (null -> exclude); the fix keeps it reclaimable.
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([200])
    })

    // The macOS production reality, directly: the earlier getProcessCwd was
    // /proc-only, so on a box with no /proc EVERY probe returned null and the
    // byBinary single-instance reclaim was a permanent no-op. Simulate that
    // whole-platform condition (getProcessCwd -> null for all) and prove the
    // reclaim STILL finds our own predecessor. Reverting to the null-excludes
    // logic turns this red -- which is the point.
    it('reclaims on a no-/proc platform where EVERY cwd probe returns null (macOS)', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: null },
        { pid: 300, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: null },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/Users/marvin/ClaudeClaw', procs })
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx).sort()).toEqual([200, 300])
    })

    // Dani's second miss: a legit self-orphan launched with an ABSOLUTE argv
    // under PROJECT_ROOT but running from a DIFFERENT cwd. It is still ours
    // (the binary lives under our root), yet the resolvable-but-different cwd
    // used to exclude it. Here the cwd is unresolvable, exercising the same
    // "argv already vouched" path -- it must stay reclaimable.
    it('keeps a legit self-orphan whose cwd differs from PROJECT_ROOT but argv is ours', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node /home/user/marveen/dist/index.js', alive: true, cwd: null },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/home/user/marveen', procs })
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([200])
    })

    it('falls back to unscoped (old) behavior when selfProjectRoot itself is unresolvable', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: '/home/user/marveen-worktrees/other-branch' },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: null, procs })
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([200])
    })

    // LOCAL DIVERGENCE FROM UPSTREAM (77a48069, decision 2fc37799): upstream
    // e9fd33bdb pinned the opposite ("a real port conflict is still
    // reclaimed"). A port holder of another install is no longer ours to kill.
    it('scopes findOwnNodeHolders (byPort) to this install -- a holder from another checkout is not taken over', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', alive: true, cwd: '/some/other/checkout' },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/home/user/marveen', procs, portHolders: { 3420: [200] } })
      expect(findOwnNodeHolders(3420, ctx)).toEqual([])
      expect(classifyPortHolders(3420, ctx).foreign).toEqual([{ pid: 200, argv: 'node', cwd: '/some/other/checkout' }])
    })

    it('pair: an old instance of THIS install on the port is still taken over (updates keep working)', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: '/home/user/marveen' },
        { pid: 201, uid: 501, cmd: 'node', args: '/usr/bin/node /home/user/marveen/dist/index.js', alive: true, cwd: null },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/home/user/marveen', procs, portHolders: { 3420: [200, 201] } })
      expect(findOwnNodeHolders(3420, ctx)).toEqual([200, 201])
      expect(classifyPortHolders(3420, ctx).foreign).toEqual([])
    })

    it('byPort stays unscoped when the install roots are unknown (old behaviour)', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', alive: true, cwd: '/some/other/checkout' },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: null, procs, portHolders: { 3420: [200] } })
      expect(findOwnNodeHolders(3420, ctx)).toEqual([200])
    })

    it('multiple worktrees: only the same-root instance is matched, siblings are left alone', () => {
      const procs: MockProc[] = [
        { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: '/home/user/marveen' },
        { pid: 300, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: '/home/user/marveen-worktrees/branch-a' },
        { pid: 400, uid: 501, cmd: 'node', args: 'node dist/index-scratch.js', alive: true, cwd: '/home/user/marveen-worktrees/branch-b' },
      ]
      const { ctx } = makeCtx({ selfProjectRoot: '/home/user/marveen-worktrees/branch-a', procs })
      expect(findOwnBinaryMatches(/dist\/index\.js/, ctx)).toEqual([300])
    })
  })
})

// Card 77a48069, measured 2026-11-20 10:58 (mandark's f327-server.log): a
// dashboard started as `tsx src/index.ts` from a worktree SIGTERMed its own tsx
// launcher (pid 84718, matchedBy byBinary) and died with exit 143. The launcher's
// argv matches the binary pattern and lives in the same install, so the
// install-affinity check cannot tell it from a predecessor. The ancestor set can.
describe('own ancestors are never victims (77a48069)', () => {
  const WT = '/Users/isti/mandark-marveen-f327'
  // The measured process tree: zsh (84713) -> tsx launcher (84718) -> node child (84730, this process).
  const tree = (): MockProc[] => [
    { pid: 84713, uid: 501, cmd: '/bin/zsh', args: '-zsh', alive: true, cwd: WT },
    { pid: 84718, uid: 501, cmd: 'node', args: `node ${WT}/node_modules/.bin/tsx src/index.ts`, alive: true, cwd: WT },
  ]

  it('findOwnBinaryMatches leaves the tsx launcher alone and says why', () => {
    const { ctx, logs } = makeCtx({ currentPid: 84730, selfProjectRoot: WT, ancestorPids: [84718, 84713], procs: tree() })
    expect(findOwnBinaryMatches(/(?:^|[\s/])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)/, ctx)).toEqual([])
    expect(logs.some((l) => l.level === 'info' && l.obj.pid === 84718 && /ancestor of this process/.test(l.msg))).toBe(true)
  })

  it('control: the same launcher shape is a victim when it is NOT an ancestor (a real leftover predecessor)', () => {
    const { ctx } = makeCtx({ currentPid: 84730, selfProjectRoot: WT, ancestorPids: [84713], procs: tree() })
    expect(findOwnBinaryMatches(/(?:^|[\s/])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)/, ctx)).toEqual([84718])
  })

  it('acquirePortLock never signals an ancestor, by binary or by port', async () => {
    const { ctx, signalCalls } = makeCtx({
      currentPid: 84730,
      selfProjectRoot: WT,
      ancestorPids: [84718, 84713],
      procs: tree(),
      portHolders: { 4320: [84718] },
    })
    await acquirePortLock(4320, ctx, { binaryPattern: /(?:^|[\s/])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)/, graceMs: 0, postKillDrainMs: 0 })
    expect(signalCalls.filter((c) => c.pid === 84718 || c.pid === 84713)).toEqual([])
  })
})

describe('foreign port holder (77a48069, LOCAL DIVERGENCE FROM UPSTREAM)', () => {
  // Measured 2026-11-20 10:58 (mandark's f327-server.log): a dashboard started
  // from the worktree /Users/isti/mandark-marveen-f327 bound 3420 (WEB_PORT
  // comes from <root>/.env, the worktree had none) and killed the live
  // dashboard, pid 84187, argv below, matchedBy byPort.
  const LIVE = { pid: 84187, uid: 501, cmd: 'node', args: '/opt/homebrew/opt/node@22/bin/node /Users/isti/marveen/dist/index.js', alive: true, cwd: '/Users/isti/marveen' }
  const WT = '/Users/isti/mandark-marveen-f327'
  const PATTERN = /(?:^|[\s/])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)/

  it('refuses to take over the live dashboard of another install, signals nobody, and names holder, root and way out', async () => {
    const { ctx, signalCalls, table } = makeCtx({ currentPid: 84730, selfProjectRoot: WT, procs: [{ ...LIVE }], portHolders: { 3420: [84187] } })
    const err = await acquirePortLock(3420, ctx, { binaryPattern: PATTERN, graceMs: 0, postKillDrainMs: 0 }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(ForeignPortHolderError)
    const msg = (err as Error).message
    expect(msg).toContain('Port 3420')
    expect(msg).toContain('pid 84187')
    expect(msg).toContain('/Users/isti/marveen/dist/index.js')
    expect(msg).toContain(`not this install (${WT})`)
    expect(msg).toContain('Not killing it')
    expect(msg).toContain(`WEB_PORT in ${WT}/.env`)
    expect(signalCalls).toEqual([])
    expect(table.get(84187)?.alive).toBe(true)
  })

  it('refuses before killing even its OWN binary-pattern zombie', async () => {
    const zombie = { pid: 500, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: WT }
    const { ctx, signalCalls } = makeCtx({ currentPid: 84730, selfProjectRoot: WT, procs: [{ ...LIVE }, zombie], portHolders: { 3420: [84187] } })
    await expect(acquirePortLock(3420, ctx, { binaryPattern: PATTERN, graceMs: 0, postKillDrainMs: 0 })).rejects.toBeInstanceOf(ForeignPortHolderError)
    expect(signalCalls).toEqual([])
  })

  it('an unattributable holder (relative argv, cwd unknown) is refused, not killed', async () => {
    const { ctx, signalCalls } = makeCtx({ selfProjectRoot: WT, procs: [{ pid: 300, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd: null }], portHolders: { 3420: [300] } })
    const err = await acquirePortLock(3420, ctx, { graceMs: 0, postKillDrainMs: 0 }).then(() => null, (e: unknown) => e)
    expect((err as Error).message).toContain('cwd: unknown')
    expect(signalCalls).toEqual([])
  })

  it('control: the live install itself, restarting, still takes over its predecessor on the same port', async () => {
    const { ctx, signalCalls } = makeCtx({ currentPid: 90000, selfProjectRoot: '/Users/isti/marveen', procs: [{ ...LIVE }], portHolders: { 3420: [84187] } })
    await acquirePortLock(3420, ctx, { binaryPattern: PATTERN, graceMs: 0, postKillDrainMs: 0 })
    expect(signalCalls).toContainEqual({ pid: 84187, sig: 'SIGTERM' })
  })
})

describe('unreadable argv is judged by cwd alone (77a48069, didi D1)', () => {
  const ROOT = '/home/user/marveen'
  const holder = (cwd: string | null): MockProc => ({ pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true, cwd, argvUnreadable: true })
  it('argv unreadable, cwd in this install: still ours (taken over)', () => {
    const { ctx } = makeCtx({ selfProjectRoot: ROOT, procs: [holder(ROOT)], portHolders: { 3420: [200] } })
    expect(classifyPortHolders(3420, ctx)).toEqual({ own: [200], foreign: [] })
  })
  it('argv unreadable, cwd elsewhere: foreign, with argv reported unknown', () => {
    const { ctx } = makeCtx({ selfProjectRoot: ROOT, procs: [holder('/elsewhere')], portHolders: { 3420: [200] } })
    expect(classifyPortHolders(3420, ctx)).toEqual({ own: [], foreign: [{ pid: 200, argv: null, cwd: '/elsewhere' }] })
  })
  it('argv AND cwd unreadable: cannot be attributed, foreign (refused, not killed)', () => {
    const { ctx } = makeCtx({ selfProjectRoot: ROOT, procs: [holder(null)], portHolders: { 3420: [200] } })
    expect(classifyPortHolders(3420, ctx).foreign.map((h) => h.pid)).toEqual([200])
  })
})

describe('EADDRINUSE reclaim uses the same decision (77a48069, didi 72633)', () => {
  // The race didi named: the worktree passes acquirePortLock while the live
  // dashboard is down, the live one binds first, the worktree's listen() hits
  // EADDRINUSE. The reclaim must not kill the live dashboard either.
  const LIVE = { pid: 84187, uid: 501, cmd: 'node', args: '/opt/homebrew/opt/node@22/bin/node /Users/isti/marveen/dist/index.js', alive: true, cwd: '/Users/isti/marveen' }
  const WT = '/Users/isti/mandark-marveen-f327'
  const hooks = () => {
    const calls = { relisten: 0, exit: [] as number[] }
    return { calls, h: { relisten: () => { calls.relisten++ }, exit: (c: number) => { calls.exit.push(c) } } }
  }

  it('a listener of another install: exits 1 with the named message, signals nobody, does not relisten', async () => {
    const { ctx, signalCalls, logs, table } = makeCtx({ currentPid: 84730, selfProjectRoot: WT, procs: [{ ...LIVE }], portHolders: { 3420: [84187] } })
    const { calls, h } = hooks()
    expect(await reclaimPortAfterAddrInUse(3420, ctx, h, { graceMs: 0 })).toBe('exit')
    expect(calls).toEqual({ relisten: 0, exit: [1] })
    expect(signalCalls).toEqual([])
    expect(table.get(84187)?.alive).toBe(true)
    const line = logs.find((l) => l.level === 'error')
    expect(line?.msg).toContain('pid 84187')
    expect(line?.msg).toContain('Not killing it')
    expect(line?.msg).toContain(`WEB_PORT in ${WT}/.env`)
  })

  it('a predecessor of this install: SIGTERM, then relisten, no exit', async () => {
    const { ctx, signalCalls } = makeCtx({ currentPid: 90000, selfProjectRoot: '/Users/isti/marveen', procs: [{ ...LIVE }], portHolders: { 3420: [84187] } })
    const { calls, h } = hooks()
    expect(await reclaimPortAfterAddrInUse(3420, ctx, h, { graceMs: 0 })).toBe('relisten')
    expect(signalCalls).toContainEqual({ pid: 84187, sig: 'SIGTERM' })
    expect(calls).toEqual({ relisten: 1, exit: [] })
  })

  it('a SIGTERM-resistant predecessor is SIGKILLed before relisten', async () => {
    const { ctx, signalCalls } = makeCtx({
      currentPid: 90000, selfProjectRoot: '/Users/isti/marveen', procs: [{ ...LIVE }], portHolders: { 3420: [84187] },
      signalOverride: (_pid, sig) => (sig === 'SIGKILL' ? 'sent' : 'sent'),
    })
    const { calls, h } = hooks()
    await reclaimPortAfterAddrInUse(3420, ctx, h, { graceMs: 0 })
    expect(signalCalls.map((c) => c.sig)).toEqual(['SIGTERM', '0', 'SIGKILL'])
    expect(calls.relisten).toBe(1)
  })

  it('nothing reclaimable (non-node holder, or our own launcher): exit 1, nobody signalled', async () => {
    const { ctx, signalCalls } = makeCtx({
      currentPid: 90000, selfProjectRoot: '/Users/isti/marveen', ancestorPids: [300],
      procs: [{ pid: 200, uid: 501, cmd: 'nginx', alive: true }, { pid: 300, uid: 501, cmd: 'node', args: 'node /Users/isti/marveen/node_modules/.bin/tsx src/index.ts', alive: true }],
      portHolders: { 3420: [200, 300] },
    })
    const { calls, h } = hooks()
    expect(await reclaimPortAfterAddrInUse(3420, ctx, h, { graceMs: 0 })).toBe('exit')
    expect(calls).toEqual({ relisten: 0, exit: [1] })
    expect(signalCalls).toEqual([])
  })

  it('web.ts has no kill loop of its own: its EADDRINUSE branch delegates to reclaimPortAfterAddrInUse', () => {
    // A second, hand-rolled kill path in web.ts is exactly the defect didi found.
    const web = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')
    expect(web).not.toMatch(/process\.kill\(|['"]SIG(?:TERM|KILL)['"]/)
    const branch = web.slice(web.indexOf("err.code === 'EADDRINUSE'"))
    expect(web.indexOf("err.code === 'EADDRINUSE'")).toBeGreaterThan(-1)
    expect(branch.slice(0, 2500)).toContain('reclaimPortAfterAddrInUse(port, buildProcessLockContext()')
  })

  it('web.ts really exits when the reclaim refuses: its exit hook passes the code to process.exit', () => {
    // didi 72649 E2: with `exit: () => {}` a refused reclaim (foreign listener)
    // left the live process running without its web port, and launchd would
    // never restart it. The delegation pin above does not see that, so the
    // hook itself is pinned here, scoped to the reclaim call.
    const web = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')
    const start = web.indexOf('reclaimPortAfterAddrInUse(port, buildProcessLockContext()')
    expect(start).toBeGreaterThan(-1)
    const call = web.slice(start, start + 1500)
    expect(call).toMatch(/\bexit:\s*\((\w+)\)\s*=>\s*process\.exit\(\1\)/)
  })
})

describe('belongsToInstall', () => {
  const roots = ['/home/u/marveen', '/real/marveen']
  it('matches an absolute argv under any root name, boundary-suffixed', () => {
    expect(belongsToInstall('node /home/u/marveen/dist/index.js', () => null, roots)).toBe(true)
    expect(belongsToInstall('node /real/marveen/dist/index.js', () => null, roots)).toBe(true)
    expect(belongsToInstall('node /home/u/marveen2/dist/index.js', () => null, roots)).toBe(false)
  })
  it('matches a relative argv by cwd equal to or under a root', () => {
    expect(belongsToInstall('node dist/index.js', () => '/real/marveen', roots)).toBe(true)
    expect(belongsToInstall('node dist/index.js', () => '/home/u/marveen/sub', roots)).toBe(true)
    expect(belongsToInstall('node dist/index.js', () => '/home/u/marveen2', roots)).toBe(false)
    expect(belongsToInstall('node dist/index.js', () => null, roots)).toBe(false)
  })
  it('does not read the cwd when the argv already decides', () => {
    let calls = 0
    belongsToInstall('node /home/u/marveen/dist/index.js', () => { calls++; return null }, roots)
    expect(calls).toBe(0)
  })
  it('ignores a degenerate root ("/" or empty) instead of matching everything', () => {
    expect(belongsToInstall('node /x/dist/index.js', () => '/x', ['/', ''])).toBe(false)
    expect(belongsToInstall('node dist/index.js', () => '/', ['/'])).toBe(false)
  })
})

describe('terminateProcesses', () => {
  it('is a no-op on empty input', async () => {
    const { ctx, sleptFor } = makeCtx({})
    await terminateProcesses([], ctx, { graceMs: 1500 })
    expect(sleptFor).toEqual([])
  })

  it('sends SIGTERM, waits the grace window, does not escalate if process died', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx, table, sleptFor, signalCalls } = makeCtx({ procs })
    await terminateProcesses([200], ctx, { graceMs: 1500 })
    expect(sleptFor).toEqual([1500])
    expect(table.get(200)!.alive).toBe(false)
    expect(signalCalls.filter(c => c.sig === 'SIGKILL')).toEqual([])
  })

  it('escalates to SIGKILL if SIGTERM did not kill the process', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const signalOverride: ProcessLockContext['signal'] = (pid, sig) => {
      const p = procs.find(x => x.pid === pid)!
      if (sig === 'SIGTERM') return 'sent' // no-op (hung process)
      if (sig === 0) return p.alive ? 'sent' : 'gone'
      if (sig === 'SIGKILL') { p.alive = false; return 'sent' }
      return 'gone'
    }
    const { ctx, signalCalls } = makeCtx({ procs, signalOverride })
    await terminateProcesses([200], ctx, { graceMs: 10 })
    expect(signalCalls.map(c => c.sig)).toEqual(['SIGTERM', '0', 'SIGKILL'])
  })

  it('escalates to SIGKILL when signal(0) throws EPERM (process alive, we just cannot probe)', async () => {
    // The process table still shows alive, but the liveness probe throws.
    // The real ctx rethrows anything that isn't ESRCH. We must treat that as
    // "still alive" and escalate, otherwise a zombie we can't probe would
    // survive startup.
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const signalOverride: ProcessLockContext['signal'] = (pid, sig) => {
      const p = procs.find(x => x.pid === pid)!
      if (sig === 'SIGTERM') return 'sent' // ignored
      if (sig === 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      if (sig === 'SIGKILL') { p.alive = false; return 'sent' }
      return 'gone'
    }
    const { ctx, signalCalls } = makeCtx({ procs, signalOverride })
    await terminateProcesses([200], ctx, { graceMs: 10 })
    expect(signalCalls.map(c => c.sig)).toEqual(['SIGTERM', '0', 'SIGKILL'])
  })

  it('does not escalate when signal(0) returns gone (ESRCH)', async () => {
    const signalOverride: ProcessLockContext['signal'] = (_pid, sig) => {
      if (sig === 'SIGTERM') return 'sent'
      if (sig === 0) return 'gone'
      return 'sent'
    }
    const { ctx, signalCalls } = makeCtx({ signalOverride })
    await terminateProcesses([200], ctx, { graceMs: 10 })
    expect(signalCalls.filter(c => c.sig === 'SIGKILL')).toEqual([])
  })

  it('handles several victims in parallel -- all get SIGTERM before the grace wait', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
      { pid: 300, uid: 501, cmd: 'node', alive: true },
      { pid: 400, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx, table, signalCalls } = makeCtx({ procs })
    await terminateProcesses([200, 300, 400], ctx, { graceMs: 10 })
    expect(signalCalls.slice(0, 3)).toEqual([
      { pid: 200, sig: 'SIGTERM' },
      { pid: 300, sig: 'SIGTERM' },
      { pid: 400, sig: 'SIGTERM' },
    ])
    expect(table.get(200)!.alive).toBe(false)
    expect(table.get(300)!.alive).toBe(false)
    expect(table.get(400)!.alive).toBe(false)
  })

  it('SIGTERM failure does not block SIGKILL escalation', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const signalOverride: ProcessLockContext['signal'] = (pid, sig) => {
      const p = procs.find(x => x.pid === pid)!
      if (sig === 'SIGTERM') throw new Error('kaboom')
      if (sig === 0) return p.alive ? 'sent' : 'gone'
      if (sig === 'SIGKILL') { p.alive = false; return 'sent' }
      return 'gone'
    }
    const { ctx, signalCalls } = makeCtx({ procs, signalOverride })
    await terminateProcesses([200], ctx, { graceMs: 10 })
    expect(signalCalls.find(c => c.sig === 'SIGKILL')).toBeTruthy()
  })
})

describe('acquirePortLock', () => {
  it('returns immediately if no one holds the port and no binary pattern is given', async () => {
    const { ctx, sleptFor } = makeCtx({ portHolders: { 3420: [] } })
    await acquirePortLock(3420, ctx)
    expect(sleptFor).toEqual([])
  })

  it('returns immediately if the only holder is the current PID', async () => {
    const procs: MockProc[] = [
      { pid: 100, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx, sleptFor } = makeCtx({ currentPid: 100, procs, portHolders: { 3420: [100] } })
    await acquirePortLock(3420, ctx)
    expect(sleptFor).toEqual([])
  })

  it('kills an old dashboard instance holding the port', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx, table } = makeCtx({ procs, portHolders: { 3420: [200] } })
    await acquirePortLock(3420, ctx, { graceMs: 10 })
    expect(table.get(200)!.alive).toBe(false)
  })

  it('kills a zombie that lost the port but still runs the binary', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true },
    ]
    const { ctx, table } = makeCtx({ procs, portHolders: { 3420: [] } })
    await acquirePortLock(3420, ctx, { graceMs: 10, binaryPattern: /dist\/index\.js/ })
    expect(table.get(200)!.alive).toBe(false)
  })

  it('deduplicates a zombie that both holds the port AND matches the binary', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', args: 'node dist/index.js', alive: true },
    ]
    const { ctx, signalCalls } = makeCtx({ procs, portHolders: { 3420: [200] } })
    await acquirePortLock(3420, ctx, { graceMs: 10, binaryPattern: /dist\/index\.js/ })
    // SIGTERM should only be sent once per victim, not twice
    expect(signalCalls.filter(c => c.sig === 'SIGTERM' && c.pid === 200)).toHaveLength(1)
  })

  it('kills multiple zombie instances in one pass', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
      { pid: 300, uid: 501, cmd: 'node', alive: true },
    ]
    const { ctx, table } = makeCtx({ procs, portHolders: { 3420: [200, 300] } })
    await acquirePortLock(3420, ctx, { graceMs: 10 })
    expect(table.get(200)!.alive).toBe(false)
    expect(table.get(300)!.alive).toBe(false)
  })

  it('leaves a foreign-UID process alone and does not sleep', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 999, cmd: 'node', alive: true },
    ]
    const { ctx, table, sleptFor } = makeCtx({ uid: 501, procs, portHolders: { 3420: [200] } })
    await acquirePortLock(3420, ctx, { graceMs: 10, postKillDrainMs: 0 })
    expect(table.get(200)!.alive).toBe(true)
    expect(sleptFor).toEqual([])
  })

  it('polls listPortHolders after kill until the port is free (drain)', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    // Port holder list reflects the mutable table -- once 200 dies, it
    // "drops" off the port. Simulate this by wiring listPortHolders to
    // return 200 only while alive.
    const portHolders: Record<number, number[]> = { 3420: [200] }
    const { ctx, table } = makeCtx({ procs, portHolders })
    // Override listPortHolders to reflect alive-ness dynamically.
    const liveOnly: ProcessLockContext = {
      ...ctx,
      listPortHolders(port: number) {
        const holders = portHolders[port] ?? []
        return holders.filter(pid => table.get(pid)?.alive)
      },
    }
    await acquirePortLock(3420, liveOnly, { graceMs: 10, postKillDrainMs: 200, postKillPollMs: 10 })
    expect(table.get(200)!.alive).toBe(false)
  })

  it('logs a warning if the port stays held past the drain window', async () => {
    const procs: MockProc[] = [
      { pid: 200, uid: 501, cmd: 'node', alive: true },
    ]
    const portHolders: Record<number, number[]> = { 3420: [200] }
    // signal() marks the proc dead, but listPortHolders keeps returning
    // 200 -- simulates kernel still holding the socket in TIME_WAIT.
    const { ctx, logs } = makeCtx({ procs, portHolders })
    const stickyPort: ProcessLockContext = {
      ...ctx,
      listPortHolders() { return [200] },
    }
    await acquirePortLock(3420, stickyPort, { graceMs: 10, postKillDrainMs: 30, postKillPollMs: 10 })
    expect(logs.some(l => l.level === 'warn' && /still held after drain/.test(l.msg))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// acquirePidfileLock

interface PidfileState {
  path: string
  files: Map<string, number>
  livePids: Set<number>
  legitimatePids: Set<number>
  termed: number[]
  unlinks: string[]
  sleptFor: number[]
  logs: Array<{ level: string; msg: string; obj: Record<string, unknown> }>
  probeAliveOverride?: (pid: number) => boolean
}

function makePidfileCtx(state: PidfileState): PidfileLockContext {
  const log = (level: string) => (obj: Record<string, unknown>, msg?: string) => {
    state.logs.push({ level, msg: msg ?? '', obj })
  }
  return {
    tryCreateExclusive(path, pid) {
      if (state.files.has(path)) return 'exists'
      state.files.set(path, pid)
      return 'created'
    },
    readRecordedPid(path) {
      return state.files.get(path) ?? null
    },
    unlinkIfMatches(path, expected) {
      const raw = state.files.get(path)
      // The mock only stores numeric PIDs; a "non-parseable" file state
      // is outside its scope (real I/O produces it, the abstract mock
      // does not). expected === null never matches the mock's state,
      // which is fine: those branches are exercised by the real impl.
      const current = raw === undefined ? undefined : raw
      if (current !== expected) return
      state.unlinks.push(path)
      state.files.delete(path)
    },
    probeAlive(pid) {
      if (state.probeAliveOverride) return state.probeAliveOverride(pid)
      return state.livePids.has(pid)
    },
    sendTerm(pid) {
      state.termed.push(pid)
      state.livePids.delete(pid)
    },
    isLegitimatePredecessor(pid) {
      return state.legitimatePids.has(pid)
    },
    sleep: async (ms) => { state.sleptFor.push(ms) },
    log: { info: log('info'), warn: log('warn'), error: log('error') },
  }
}

function baseState(): PidfileState {
  return {
    path: '/tmp/test.pid',
    files: new Map(),
    livePids: new Set(),
    legitimatePids: new Set(),
    termed: [],
    unlinks: [],
    sleptFor: [],
    logs: [],
  }
}

describe('acquirePidfileLock', () => {
  it('creates the pidfile atomically when the path is free', async () => {
    const state = baseState()
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx)
    expect(state.files.get(state.path)).toBe(100)
    expect(state.termed).toEqual([])
    expect(state.unlinks).toEqual([])
  })

  it('unlinks a stale file whose recorded PID is gone, then retries', async () => {
    const state = baseState()
    state.files.set(state.path, 999) // stale, 999 is not in livePids
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 10 })
    expect(state.unlinks).toEqual([state.path])
    expect(state.files.get(state.path)).toBe(100)
    expect(state.termed).toEqual([])
  })

  it('SIGTERMs a live, legitimate predecessor and retries', async () => {
    const state = baseState()
    state.files.set(state.path, 999)
    state.livePids.add(999)
    state.legitimatePids.add(999)
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 20 })
    expect(state.termed).toEqual([999])
    expect(state.sleptFor).toEqual([20])
    expect(state.unlinks).toEqual([state.path])
    expect(state.files.get(state.path)).toBe(100)
  })

  it('does NOT SIGTERM a live but illegitimate PID (PID was recycled)', async () => {
    // Stale pidfile with PID=999, but PID 999 has been recycled to some
    // unrelated program (e.g. a shell). We must not kill it.
    const state = baseState()
    state.files.set(state.path, 999)
    state.livePids.add(999)
    // legitimatePids EMPTY -- not a dashboard process
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 10 })
    expect(state.termed).toEqual([])
    expect(state.files.get(state.path)).toBe(100)
    expect(state.logs.some(l => /not a dashboard process/.test(l.msg))).toBe(true)
  })

  it('unlinks a self-recorded file (recorded === selfPid) and retries', async () => {
    const state = baseState()
    state.files.set(state.path, 100) // our own PID somehow already in there
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 10 })
    expect(state.unlinks).toEqual([state.path])
    expect(state.files.get(state.path)).toBe(100)
  })

  it('gives up after maxAttempts if every attempt keeps seeing EEXIST', async () => {
    const state = baseState()
    // Override tryCreateExclusive to always fail; a concurrent writer keeps
    // recreating the file immediately after each unlink.
    state.files.set(state.path, 999)
    state.livePids.add(999)
    state.legitimatePids.add(999)
    const ctx = makePidfileCtx(state)
    // Monkey-patch: every successful unlink immediately replaces the
    // file, simulating a pathological writer that never relents.
    const origUnlinkIfMatches = ctx.unlinkIfMatches
    ctx.unlinkIfMatches = (path, expected) => {
      const before = state.files.get(path)
      origUnlinkIfMatches(path, expected)
      const after = state.files.get(path)
      if (before !== undefined && after === undefined) {
        state.files.set(path, 999)
        state.livePids.add(999)
      }
    }
    await expect(
      acquirePidfileLock(state.path, 100, ctx, { graceMs: 5, maxAttempts: 3 }),
    ).rejects.toThrow(/Failed to acquire pidfile lock/)
  })

  it('treats a probeAlive throw as "still alive" (conservative)', async () => {
    const state = baseState()
    state.files.set(state.path, 999)
    state.legitimatePids.add(999)
    state.probeAliveOverride = () => { throw new Error('EPERM') }
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 10 })
    // Because probeAlive threw, we assumed alive, SIGTERMed, waited, then
    // unlinked.
    expect(state.termed).toEqual([999])
    expect(state.files.get(state.path)).toBe(100)
  })

  it('throws DeferToPeerError when onLiveLegitimate=defer and peer is alive-legit', async () => {
    const state = baseState()
    state.files.set(state.path, 999)
    state.livePids.add(999)
    state.legitimatePids.add(999)
    const ctx = makePidfileCtx(state)
    await expect(
      acquirePidfileLock(state.path, 100, ctx, { graceMs: 10, onLiveLegitimate: 'defer' }),
    ).rejects.toBeInstanceOf(DeferToPeerError)
    // Defer MUST NOT SIGTERM the winner
    expect(state.termed).toEqual([])
  })

  it('defer mode still unlinks stale (dead) entries', async () => {
    const state = baseState()
    state.files.set(state.path, 999) // recorded pid, but not alive
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 10, onLiveLegitimate: 'defer' })
    expect(state.files.get(state.path)).toBe(100)
  })

  it('does NOT unlink a third peer that took the slot during our SIGTERM-wait', async () => {
    // Regression for round-8 finding: a third startup can write its own
    // PID between our SIGTERM and our post-sleep unlink. An unconditional
    // unlink would erase it and let two dashboards run concurrently.
    const state = baseState()
    state.files.set(state.path, 999) // predecessor
    state.livePids.add(999)
    state.legitimatePids.add(999)
    const ctx = makePidfileCtx(state)
    // During the SIGTERM-wait in attempt 1, predecessor 999 cleanly exits
    // (releaseLock'd its own pidfile) and a third startup (PID 777) wins
    // the O_EXCL race with its own lock. The post-sleep unlinkIfMatches
    // must NOT erase 777's file even though we went in expecting to
    // remove 999.
    const origSleep = ctx.sleep
    ctx.sleep = async (ms) => {
      await origSleep(ms)
      state.files.delete(state.path)
      state.livePids.delete(999)
      state.files.set(state.path, 777)
      state.livePids.add(777)
      state.legitimatePids.add(777)
    }
    // Cap at 1 attempt so the test isolates the first-iteration
    // unlinkIfMatches behavior. With maxAttempts=1, acquirePidfileLock
    // throws "Failed to acquire" after a single SIGTERM + sleep pass.
    await expect(
      acquirePidfileLock(state.path, 100, ctx, { graceMs: 5, maxAttempts: 1 }),
    ).rejects.toThrow(/Failed to acquire pidfile lock/)
    // The third peer's file MUST still be intact.
    expect(state.files.get(state.path)).toBe(777)
  })

  it('defer mode still unlinks illegitimate (recycled) PIDs', async () => {
    const state = baseState()
    state.files.set(state.path, 999)
    state.livePids.add(999) // alive but NOT legitimate
    const ctx = makePidfileCtx(state)
    await acquirePidfileLock(state.path, 100, ctx, { graceMs: 10, onLiveLegitimate: 'defer' })
    expect(state.files.get(state.path)).toBe(100)
    expect(state.termed).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DASHBOARD_BINARY_PATTERN correctness
//
// Regression: the first version used `/\b(dist\/index\.js|src\/index\.ts)\b/`,
// which false-positive matched `dist/index.js.map`, `dist/index.js.bak`,
// `dist/index.js.old`, etc. because `\b` after `.js` boundaries between the
// 's' word-char and the next non-word '.'. The tightened form requires the
// dashboard filename to be followed by whitespace or end-of-string so
// editors/bundlers/watchers opening sibling files don't get SIGKILLed.

const DASHBOARD_BINARY_PATTERN = /(?:^|[\s/])(?:dist\/index\.js|src\/index\.ts)(?:\s|$)/

describe('writeBufferFully', () => {
  it('writes the whole buffer in a single shot when the writer accepts it all', () => {
    const chunks: Array<{ off: number; len: number }> = []
    const buf = Buffer.from('12345')
    writeBufferFully((_b, off, len) => { chunks.push({ off, len }); return len }, buf)
    expect(chunks).toEqual([{ off: 0, len: 5 }])
  })

  it('loops through short writes until the buffer is drained', () => {
    const chunks: number[] = []
    const buf = Buffer.from('12345')
    const sequence = [2, 1, 2] // simulate three short writes summing to 5
    let call = 0
    writeBufferFully((_b, off, len) => {
      const n = Math.min(sequence[call++], len)
      chunks.push(n)
      return n
    }, buf)
    expect(chunks).toEqual([2, 1, 2])
  })

  it('throws if the writer returns 0', () => {
    expect(() =>
      writeBufferFully(() => 0, Buffer.from('x')),
    ).toThrow(/returned 0/)
  })

  it('throws if the writer returns a negative number', () => {
    expect(() =>
      writeBufferFully(() => -1, Buffer.from('x')),
    ).toThrow(/returned -1/)
  })

  it('throws if the writer returns NaN', () => {
    expect(() =>
      writeBufferFully(() => NaN, Buffer.from('x')),
    ).toThrow(/returned NaN/)
  })

  it('handles an empty buffer without calling the writer', () => {
    let called = false
    writeBufferFully(() => { called = true; return 0 }, Buffer.alloc(0))
    expect(called).toBe(false)
  })
})

describe('DASHBOARD_BINARY_PATTERN', () => {
  it.each([
    'node dist/index.js',
    '/usr/local/bin/node /opt/repo/dist/index.js',
    'node --inspect dist/index.js',
    'tsx src/index.ts',
    'node dist/index.js --flag',
  ])('matches the canonical dashboard argv: %s', (argv) => {
    expect(DASHBOARD_BINARY_PATTERN.test(argv)).toBe(true)
  })

  it.each([
    'vim dist/index.js.bak',
    'node dist/index.js.map',
    'tail dist/index.js.old',
    'grep dist/index.jsx',
    'sh -c "cp dist/index.js.tmp dist/index.js.staged"',
    'prettier --write src/index.tsx',
  ])('does NOT match unrelated argvs that merely contain the name as a prefix: %s', (argv) => {
    expect(DASHBOARD_BINARY_PATTERN.test(argv)).toBe(false)
  })
})

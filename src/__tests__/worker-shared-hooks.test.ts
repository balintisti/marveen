import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSharedHooks, mergeSharedHooks } from '../web/agent-worker.js'

// WHAT THIS PINS. The worker config dir symlinks every ~/.claude entry EXCEPT
// settings.json, so the shared `hooks` block -- where every governance gate in this
// fleet is referenced, by absolute path -- never reached a worker session. Measured
// 2026-09-11 by didi and computress independently with matching numbers: both worker
// settings.json were 417 bytes with NO hooks key, against 11 matchers in the shared
// file and in every agent config.
//
// WHY THESE ARE UNIT TESTS ON EXTRACTED FUNCTIONS AND NOT A CALL TO ensureWorkerCwd:
// that function writes to ~/.marveen-worker for real. agent-worker.ts carries a
// comment about exactly that going wrong once ("the 2026-07-28 sandbox boot wrote
// into the live worker config dir"), so the pure parts are tested pure, and the
// WIRING is pinned by the string-contract guard at the bottom -- the house idiom,
// because a correct helper proves nothing about whether the choke point calls it.
//
// AND WHAT THESE TESTS DO NOT CLAIM: that a running worker session actually INVOKES
// the gate. That is a separate measurement on a provisioned config dir, and it is the
// one the card explicitly asks the picker not to take on trust. Presence in the file
// is existence; firing is reach.

const GATE = { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 /abs/db-destructive-gate.py' }] }
const OTHER = { matcher: 'Write', hooks: [{ type: 'command', command: '/abs/other.sh' }] }
const LOCAL = { matcher: 'Bash', hooks: [{ type: 'command', command: '/abs/worker-local.sh' }] }

describe('readSharedHooks', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shared-hooks-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (o: unknown) => writeFileSync(join(dir, 'settings.json'), JSON.stringify(o))

  it('reads the hooks block out of the shared settings file', () => {
    write({ hooks: { PreToolUse: [GATE] }, permissions: { deny: ['x'] } })
    expect(readSharedHooks(dir)).toEqual({ PreToolUse: [GATE] })
  })

  it('degrades to undefined instead of throwing, on every bad input', () => {
    // Fail-soft is deliberate: this runs on the worker boot path, and a malformed
    // shared settings file must not stop a worker from starting.
    expect(readSharedHooks(join(dir, 'does-not-exist'))).toBeUndefined()
    writeFileSync(join(dir, 'settings.json'), '{not json')
    expect(readSharedHooks(dir)).toBeUndefined()
    write({ permissions: { deny: [] } })          // no hooks key at all
    expect(readSharedHooks(dir)).toBeUndefined()
    write({ hooks: ['an', 'array'] })             // wrong shape
    expect(readSharedHooks(dir)).toBeUndefined()
    write({ hooks: null })
    expect(readSharedHooks(dir)).toBeUndefined()
  })
})

describe('mergeSharedHooks', () => {
  it('carries the shared block when the worker has none -- the measured case', () => {
    expect(mergeSharedHooks({ PreToolUse: [GATE] }, undefined))
      .toEqual({ PreToolUse: [GATE] })
  })

  it('keeps worker-local entries the shared block does not have', () => {
    const out = mergeSharedHooks({ PreToolUse: [GATE] }, { PreToolUse: [LOCAL] })
    expect(out).toEqual({ PreToolUse: [GATE, LOCAL] })
  })

  it('puts shared entries first', () => {
    // Order is the fleet contract, not cosmetics: the gates should get the first
    // word on a Bash call, before anything a prior run left behind.
    const out = mergeSharedHooks({ PreToolUse: [GATE] }, { PreToolUse: [LOCAL] })
    expect(out!.PreToolUse[0]).toEqual(GATE)
  })

  it('does not double an entry present on both sides', () => {
    const out = mergeSharedHooks({ PreToolUse: [GATE] }, { PreToolUse: [GATE] })
    expect(out!.PreToolUse).toHaveLength(1)
  })

  it('unions the event keys rather than picking one side', () => {
    const out = mergeSharedHooks({ PreToolUse: [GATE] }, { PostToolUse: [OTHER] })
    expect(Object.keys(out!).sort()).toEqual(['PostToolUse', 'PreToolUse'])
  })

  it('preserves worker-only hooks when there is no shared block at all', () => {
    expect(mergeSharedHooks(undefined, { PreToolUse: [LOCAL] }))
      .toEqual({ PreToolUse: [LOCAL] })
  })

  it('returns undefined when there is nothing on either side', () => {
    // So the writer omits the key entirely rather than stamping `"hooks": {}`,
    // which would look like a configured-but-empty block to anyone auditing it.
    expect(mergeSharedHooks(undefined, undefined)).toBeUndefined()
    expect(mergeSharedHooks({}, {})).toBeUndefined()
  })

  it('ignores a non-object local value instead of crashing on it', () => {
    expect(mergeSharedHooks({ PreToolUse: [GATE] }, 'nonsense'))
      .toEqual({ PreToolUse: [GATE] })
    expect(mergeSharedHooks({ PreToolUse: [GATE] }, ['a']))
      .toEqual({ PreToolUse: [GATE] })
  })

  it('tolerates a non-array event value on either side', () => {
    expect(mergeSharedHooks({ PreToolUse: 'x' } as never, { PreToolUse: [LOCAL] }))
      .toEqual({ PreToolUse: [LOCAL] })
  })
})

describe('wiring (string contract)', () => {
  // The house idiom: a correct helper says nothing about whether the choke point
  // consults it. ensureWorkerCwd is the ONE place a worker settings.json is written,
  // and it writes to the live ~/.marveen-worker, so it cannot be called from a test.
  const SRC = readFileSync(new URL('../web/agent-worker.ts', import.meta.url), 'utf-8')

  it('the settings writer consults the merge, not just the helper existing', () => {
    expect(SRC).toMatch(/mergeSharedHooks\(readSharedHooks\(realClaude\), current\.hooks\)/)
  })

  it('the merged block is spread into the object that gets written', () => {
    const writer = SRC.slice(SRC.indexOf('const hooks = mergeSharedHooks'))
      .slice(0, 400)
    expect(writer).toMatch(/writeFileSync\(settingsPath/)
    expect(writer).toMatch(/\.\.\.\(hooks \? \{ hooks \} : \{\}\)/)
  })

  it('settings.json is still skipped by the symlink loop -- we did NOT override that', () => {
    // The exclusion is a deliberate upstream decision (the worker owns its
    // enabledPlugins). This fix is additive; if someone "fixes" it by dropping the
    // skip instead, this test says so.
    expect(SRC).toMatch(/WORKER_CONFIG_SKIP = new Set\(\[[^\]]*'settings\.json'/)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** The vault master key never travels on argv (card 612bf2f1).
 *
 *  `security add-generic-password ... -w <value>` put the key in the spawned argv, which any
 *  local process can read in `ps` for the duration of the call. The fix sends the command on
 *  STDIN of `security -i`. What this file pins, at the only boundary that matters -- the spawn:
 *  the value is in NO argv of ANY spawn the store makes, the keychain entry name is unchanged,
 *  and a store that did not land still THROWS (both vault.ts callers act on a return).
 */
const KEY = 'q2V4bXBsZSttYXN0ZXIva2V5PT0rL2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OQ=='

type Call = { file: string; args: string[]; input?: string }
const spawn = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[]; input?: string }[],
  stored: null as string | null,
  addThrows: false,
  addNoLand: false, // exit 0, nothing written
  readBack: undefined as string | undefined, // override what find-generic-password returns
}))

vi.mock('node:child_process', () => ({
  execFileSync: (file: string, args: string[], opts: { input?: string } = {}) => {
    spawn.calls.push({ file, args: [...args], input: opts.input })
    if (args[0] === '-i') {
      if (spawn.addThrows) throw Object.assign(new Error('security exited 45'), { status: 45 })
      if (spawn.addNoLand) return ''
      const m = /-w "([^"]*)"/.exec(opts.input ?? '')
      spawn.stored = m ? m[1] : null
      return ''
    }
    if (args[0] === 'find-generic-password') {
      const v = spawn.readBack ?? spawn.stored
      if (v == null) throw Object.assign(new Error('not found'), { status: 44 })
      return `${v}\n`
    }
    return ''
  },
}))

const { keychainStore } = await import('../web/keychain.js')

beforeEach(() => {
  spawn.calls = []
  spawn.stored = null
  spawn.addThrows = false
  spawn.addNoLand = false
  spawn.readBack = undefined
})

const argvHolds = (calls: Call[], v: string) => calls.some((c) => c.args.some((a) => a.includes(v)))

describe('keychainStore keeps the master key off argv (612bf2f1)', () => {
  it('the key is in NO spawned argv -- the whole finding', () => {
    keychainStore(KEY)
    expect(spawn.calls.length).toBeGreaterThan(0)
    expect(argvHolds(spawn.calls, KEY)).toBe(false)
    // and not a fragment either: the first 16 characters are enough to identify the key
    expect(argvHolds(spawn.calls, KEY.slice(0, 16))).toBe(false)
  })

  it('it travels on STDIN of `security -i`, to the SAME entry as before (name unchanged)', () => {
    keychainStore(KEY)
    const add = spawn.calls.find((c) => c.args[0] === '-i')
    expect(add?.file).toBe('/usr/bin/security')
    expect(add?.args).toEqual(['-i'])
    expect(add?.input).toBe(`add-generic-password -U -s com.marveen.vault -a master-key -w "${KEY}" -A\n`)
  })

  it('the store is PROVEN by a read-back of the same entry', () => {
    keychainStore(KEY)
    const read = spawn.calls.find((c) => c.args[0] === 'find-generic-password')
    expect(read?.args).toEqual(['find-generic-password', '-s', 'com.marveen.vault', '-a', 'master-key', '-w'])
  })

  it('a failing `security` still THROWS, as the argv form did', () => {
    spawn.addThrows = true
    expect(() => keychainStore(KEY)).toThrow()
  })

  it('exit 0 but a DIFFERENT value read back -> throws (a 0 exit is not proof)', () => {
    spawn.readBack = 'c29tZXRoaW5nLWVsc2U='
    expect(() => keychainStore(KEY)).toThrow(/read-back does not match/)
  })

  it('exit 0 but NOTHING landed -> throws (the entry reads back absent)', () => {
    spawn.addNoLand = true
    expect(() => keychainStore(KEY)).toThrow(/read-back does not match \(empty\)/)
  })

  it.each([
    ['empty', ''],
    ['double quote', 'abc"def'],
    ['backslash', 'abc\\def'],
    ['line break', 'abc\ndef'],
    ['carriage return', 'abc\rdef'],
  ])('a value the inner parser would misread is REFUSED before any spawn: %s', (_, v) => {
    expect(() => keychainStore(v)).toThrow(/refusing/)
    expect(spawn.calls).toEqual([])
  })
})

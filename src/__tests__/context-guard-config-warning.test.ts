/**
 * THE ABSENCE MUST BE LOUD -- AND IT MUST NOT BE LOUD TWELVE TIMES AN HOUR.
 *
 * Card `de0989de`. `store/context-guard.json` is now tracked, so a `git clean -fd` no longer
 * loses it. That fixed the LOSS, not the SILENCE: if the file is missing for any other reason
 * (new machine, bad install, truncation), every agent falls back to the opt-in default and
 * idle-flush turns off for the whole fleet with no line saying so.
 *
 * Measured: the file differs from DEFAULT_CONTEXT_GUARD in exactly ONE field for all seven
 * agents (idleFlushEnabled). That is why these assertions are about idle-flush by name and
 * not about "config" in general.
 *
 * WHAT THESE TESTS PIN, and each one has a mutation that turns it red:
 *   - the warner speaks when an agent has no entry            (drop the emit -> red)
 *   - it names idleFlushEnabled, not a vague "config missing" (reword -> red)
 *   - it is SILENT while the answer does not change           (drop the latch -> red)
 *   - it speaks AGAIN when the set changes, incl. re-arming after it clears
 *     (latch once-per-process instead of per-change -> red)
 *   - it never mentions an agent that HAS an entry, whatever the entry contains
 *     (this is the scope boundary marveen set: absence, never misconfiguration)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  missingContextGuardEntries,
  contextGuardConfigWarningText,
  makeContextGuardConfigWarner,
} from '../web/context-guard-config-warning.js'

const FLEET = ['marveen', 'dexter', 'didi', 'friday', 'mandark', 'jarvis', 'computress']

describe('missingContextGuardEntries', () => {
  it('finds the agents with no entry of their own', () => {
    expect(missingContextGuardEntries(FLEET, ['marveen', 'dexter'])).toEqual([
      'didi', 'friday', 'mandark', 'jarvis', 'computress',
    ])
  })

  it('POSITIVE CONTROL: a fully configured fleet yields nothing', () => {
    // Without this, every assertion above is satisfied by a function that always
    // reports everyone as missing.
    expect(missingContextGuardEntries(FLEET, FLEET)).toEqual([])
  })

  it('an entry counts even when it sets only ONE field -- jarvis is the real case', () => {
    // jarvis is configured as `{ idleFlushEnabled: true }` and nothing else. That IS an
    // entry, and treating a short entry as absent would fire on a correctly configured
    // agent -- a false alarm against working config, which is the failure mode this repo
    // keeps paying for.
    expect(missingContextGuardEntries(['jarvis'], ['jarvis'])).toEqual([])
  })

  it('the file being absent entirely reports every swept agent, once each', () => {
    expect(missingContextGuardEntries([...FLEET, 'dexter'], [])).toEqual(FLEET)
  })
})

describe('contextGuardConfigWarningText', () => {
  it('names idleFlushEnabled and the file, not a vague "config missing"', () => {
    const t = contextGuardConfigWarningText(['didi', 'friday'])
    expect(t).toContain('idleFlushEnabled')
    expect(t).toContain('store/context-guard.json')
    expect(t).toContain('didi, friday')
    // The count has to be in there: "some agents" would leave the reader unable to tell a
    // single new agent from the whole fleet losing the file.
    expect(t).toContain('2 agent(s)')
  })

  it('says how to get it back, since the file is now tracked', () => {
    expect(contextGuardConfigWarningText(['didi'])).toContain('git checkout store/context-guard.json')
  })
})

describe('makeContextGuardConfigWarner: loud once, not loud forever', () => {
  it('emits on the first tick that has a missing agent', () => {
    const seen: string[] = []
    const warn = makeContextGuardConfigWarner((m) => seen.push(m))
    warn(FLEET, ['marveen'])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('idleFlushEnabled')
  })

  it('stays SILENT while the answer is unchanged -- the sweep runs every 300 s', () => {
    const seen: string[] = []
    const warn = makeContextGuardConfigWarner((m) => seen.push(m))
    for (let i = 0; i < 12; i++) warn(FLEET, ['marveen'])
    expect(seen).toHaveLength(1)
  })

  it('speaks again when the set CHANGES', () => {
    const seen: string[] = []
    const warn = makeContextGuardConfigWarner((m) => seen.push(m))
    warn(FLEET, ['marveen'])
    warn(FLEET, ['marveen', 'dexter'])
    expect(seen).toHaveLength(2)
  })

  it('goes quiet when the set clears, and RE-ARMS for the next loss', () => {
    // A once-per-process latch would pass every assertion above and fail this one. It is
    // the difference between "we were told" and "we would be told again".
    const seen: string[] = []
    const warn = makeContextGuardConfigWarner((m) => seen.push(m))
    warn(FLEET, ['marveen'])
    expect(seen).toHaveLength(1)
    warn(FLEET, FLEET)
    expect(seen).toHaveLength(1)
    warn(FLEET, ['marveen'])
    expect(seen).toHaveLength(2)
  })

  it('NEVER emits for a fully configured fleet, however odd the entries are', () => {
    // The scope boundary: absence only. Contents are an operator decision and are not
    // second-guessed here.
    const seen: string[] = []
    const warn = makeContextGuardConfigWarner((m) => seen.push(m))
    for (let i = 0; i < 5; i++) warn(FLEET, FLEET)
    expect(seen).toEqual([])
  })
})

describe('and it is actually WIRED -- a perfect module nobody calls is the same silence', () => {
  // The module above could be flawless and never run. That is the state this repo keeps
  // paying for, so the wire gets its own assertion.
  //
  // SOURCE-LEVEL, and that is a stated limit: startContextGuardRunner() installs a 300 s
  // interval and sweeps real agents, so instantiating it in a unit test would measure the
  // harness, not the wire. What this checks is that the runner imports the warner and calls
  // it inside the sweep. It would NOT catch a call placed on a branch that never executes --
  // for that, the honest evidence is the first real sweep after deploy.
  const runner = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'context-guard-runner.ts'),
    'utf8',
  )

  it('the runner imports the warner', () => {
    expect(runner).toContain("from './context-guard-config-warning.js'")
    expect(runner).toContain('makeContextGuardConfigWarner')
  })

  it('and CALLS it in the sweep, with the configured key set', () => {
    expect(runner).toContain('warnMissingConfig(names, Object.keys(readAllContextGuardConfigs()))')
  })

  it('POSITIVE CONTROL: the meter can say no', () => {
    // Without this, the two assertions above would also pass on a file that happens to
    // contain those strings for any other reason -- and would pass just as happily if the
    // meter were reading the wrong file and getting an empty string back.
    expect(runner.length).toBeGreaterThan(1000)
    expect(runner).not.toContain('makeContextGuardConfigWarnerThatDoesNotExist')
  })
})

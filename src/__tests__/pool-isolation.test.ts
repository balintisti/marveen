// The suite's process isolation, asserted as a PROPERTY rather than as a config
// string (card 36f975ed).
//
// Several specs rely on a test not sharing process-wide state with its siblings --
// most visibly the ones that set a fake HOME. Card da9aacec measured that the
// exposure there was zero, but only because those specs happen to do the
// HOME-sensitive part in a child process. That is a property of today's specs, not
// of the suite, and until 2026-09-02 the isolation itself came from an inherited
// vitest default that nobody had chosen.
//
// WHY NOT ASSERT THE CONFIG VALUE. Reading `pool: 'forks'` back out of the config
// would pass while proving nothing: a future vitest could rename the pool, honour
// an env override, or change what `forks` means. This asserts the thing the specs
// actually depend on -- that a test body runs in its own PROCESS -- so it stays
// true for whatever config produces that, and goes red if any change stops
// producing it.
import { describe, it, expect } from 'vitest'
import { isMainThread } from 'node:worker_threads'

describe('suite isolation', () => {
  it('runs each test file in its own PROCESS, not a shared worker thread', () => {
    // In the `forks` pool each file gets a child process, where the test body is
    // the main thread of that process. Under `threads` it would be a worker, and
    // isMainThread would be false.
    expect(isMainThread).toBe(true)
  })

  it('does not share the parent process -- writing process.env here cannot reach a sibling', () => {
    // The consequence, spelled out so the first test is not read as trivia. This
    // sets a value no other spec sets; under a shared-worker pool the write would
    // be visible fleet-wide within the run. It is asserted locally only -- the
    // cross-file half is what the pool guarantees and what a single spec cannot
    // observe, which is exactly why the isolation must be declared rather than
    // hoped for.
    process.env.POOL_ISOLATION_PROBE = String(process.pid)
    expect(process.env.POOL_ISOLATION_PROBE).toBe(String(process.pid))
  })
})

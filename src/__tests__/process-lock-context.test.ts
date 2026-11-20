import { describe, it, expect } from 'vitest'
import { realpathSync } from 'node:fs'
import { PROJECT_ROOT } from '../config.js'
import { buildProcessLockContext } from '../process-lock-context.js'

// didi 72649 E1: `installRoots: []` in the real context builder survived the
// whole suite. An empty root list sends classifyPortHolders down the old,
// unscoped branch, so that one line would silently switch off the
// "never kill another install's listener" decision (2fc37799 B) in production.
describe('buildProcessLockContext', () => {
  it('hands the install roots to the port-lock decision: PROJECT_ROOT and its realpath', () => {
    const ctx = buildProcessLockContext()
    expect(ctx.installRoots).toContain(PROJECT_ROOT)
    expect(ctx.installRoots).toContain(realpathSync(PROJECT_ROOT))
  })
})

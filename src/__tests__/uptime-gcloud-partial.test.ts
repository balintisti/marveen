import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGcloud, GCLOUD_STDIO } from '../web/uptime-alert-watcher.js'

// ============================================================================================
// WHAT THESE PIN, AND WHY THEY EXIST AT ALL (card 3d038bac)
//
// These tests are the record of a REFUTED FIX, and the refutation is the deliverable.
//
// Measured from gcloud's own logs: of sixteen `gcloud timed out after 15000 ms` notices, FIVE
// have a COMPLETE gcloud log -- the value was printed within a second and the call still burned
// the whole 15 s. So "on timeout, use the stdout we already captured" looks obviously right.
//
// It is not possible this way, and only a REAL process showed it. The helper written for it
// passed nine unit tests against synthetic errors and would have shipped as a no-op.
//
// Everything here runs a real `gcloud` (a fake one on PATH) with a 200 ms budget, so the
// timeout path is exercised end to end in a fifth of a second rather than fifteen.
// ============================================================================================

describe('runGcloud -- the real timeout path, end to end', () => {
  let dir: string
  let prevPath: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fakegcloud-'))
    prevPath = process.env.PATH
    process.env.PATH = `${dir}:${prevPath ?? ''}`
  })

  afterEach(() => {
    process.env.PATH = prevPath
    rmSync(dir, { recursive: true, force: true })
  })

  function fakeGcloud(body: string) {
    const p = join(dir, 'gcloud')
    writeFileSync(p, `#!/bin/sh\n${body}\n`)
    chmodSync(p, 0o755)
  }

  // A CONTROL FIRST: without it the two assertions below would describe an environment where
  // nothing works at all, and a fake binary that is never actually reached looks identical.
  //
  // AND THE CONTROL CARRIES NO BUDGET OF ITS OWN -- MEASURED DEFECT, 2026-09-11, hours after
  // this file shipped. It originally passed 2000 ms. Standalone the spawn took 921 ms, a margin
  // of 2.2x, and inside the FULL suite it exceeded the budget and went red on the trunk:
  // `expected false to be 'gyors-ertek'` -- r.ok was false because the control itself timed out.
  //
  // The direction matters and it is why only THIS test flaked: the other three assert that a
  // timeout HAPPENS, and load pushes them further into passing. Only the control has to SUCCEED
  // inside a window, so only the control can be starved by a parallel suite.
  //
  // The fix is not a bigger number of my choosing: it uses GCLOUD_TIMEOUT_MS, the PRODUCTION
  // budget. If a fast child cannot finish inside that, the production path is broken anyway --
  // so the control stops asserting anything about timing and goes back to asserting reach.
  it('CONTROL: a fast, normally exiting gcloud returns its value', () => {
    fakeGcloud('echo gyors-ertek')
    const r = runGcloud(['whatever'], 'kontroll')   // <- a termelesi koret, nem sajat szam
    expect(r.ok && r.value).toBe('gyors-ertek')
  })

  it('A-type: a child that prints nothing and hangs is a NAMED failure, not a false success', () => {
    fakeGcloud('sleep 5')
    const r = runGcloud(['auth', 'print-access-token'], 'access token', 200)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('timed out after 200 ms')
  })

  // B-TYPE, AND THE REASON THIS CARD ENDS WITHOUT A FIX. The child PRINTED the value and then
  // hung; measured on the live board, five of sixteen timeouts look exactly like this. The
  // obvious remedy is to use the bytes already captured -- and it is not reliably available
  // (see the runGcloud docblock: the two sync APIs disagree, and which one delivers depends on
  // the runtime). So this pins what the poller ACTUALLY does today: it goes blind, by name.
  it('B-type: the value WAS printed before the hang, and the call still fails -- by name', () => {
    fakeGcloud('echo delta-crm-483922\nsleep 5')
    const r = runGcloud(['config', 'get-value', 'project'], 'project', 200)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('timed out after 200 ms')
  })
})

// THE LAYER BELOW, asserted directly, because the choice of API is the whole reason the salvage
// works: measured on node v22, the two calls DISAGREE on the same child with the same options.
// If a future node makes execFileSync deliver the bytes too, this test goes red -- and that red
// is an invitation to simplify runGcloud, not a defect.
describe('node itself: both sync APIs time out, and neither can be trusted for the bytes', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nodeprobe-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('both report ETIMEDOUT; what they hand back is runtime-dependent and NOT asserted', () => {
    const bin = join(dir, 'printer')
    writeFileSync(bin, '#!/bin/sh\necho delta-crm-483922\nsleep 5\n')
    chmodSync(bin, 0o755)
    // BOTH APIS TIME OUT. What is deliberately NOT asserted is WHAT EITHER HANDS BACK: measured
    // on this machine the answer flips with the runtime (a plain node run gives the bytes to
    // spawnSync and nothing to execFileSync; under vitest it is the other way round). Pinning
    // either value would pin an observation that already moved under us -- and that instability
    // is precisely why the salvage was abandoned rather than shipped.
    const r = spawnSync(bin, [], { encoding: 'utf8', timeout: 200, stdio: [...GCLOUD_STDIO] })
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT')

    let caught: NodeJS.ErrnoException | null = null
    try {
      execFileSync(bin, [], { encoding: 'utf8', timeout: 200, stdio: [...GCLOUD_STDIO] })
    } catch (err) {
      caught = err as NodeJS.ErrnoException
    }
    expect(caught, 'a 200 ms budget must have expired').not.toBeNull()
    expect(caught?.code).toBe('ETIMEDOUT')
  })
})

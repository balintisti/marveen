// Card 074149c2, coordinator's decision 58301 item C: a rule sheet the dashboard rewrites goes
// under the lock the sheet editors take (web/sheet-lock.ts + scripts/sheet-locked-write.py).
//
// NOTHING IS MOCKED but the logger: the pages are real files, the write step is the real script
// under the real python3, and the other side of every contention case is a second process holding
// a real flock (helpers/sheet-holder.ts), shaped like scripts/claude-md-edit.py.
//
// NOT PROVEN HERE: that the two editor scripts themselves still lock the way the holder does
// (their own source says so, nothing here runs them); what a power loss leaves on the disk (the
// kill cases below kill the PROCESS, the bytes it wrote are still the kernel's to keep); and the
// start paths end to end (startWebServer and startAgentProcess are not run here: their calls are
// read from the source, the wrapper they must go through is run against a real held lock).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { holdSheet } from './helpers/sheet-holder.js'

const log = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: log.warn, debug: vi.fn(), error: vi.fn() } }))

const { rewriteSheetUnderLock, ensureSheetSectionAtStart } = await import('../web/sheet-lock.js')

const mkTmp = tmpDirs()
const dir = mkTmp('sheet-lock-test-')
const HELPER = fileURLToPath(new URL('../../scripts/sheet-locked-write.py', import.meta.url))
const SRC = fileURLToPath(new URL('..', import.meta.url))
const OLD = '# lap\n\nárvíztűrő tükörfúrógép ⏺\n'
const BLOCK = 'BLOCK LINE\n'
const sha = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf-8')).digest('hex')

let n = 0
let page = ''
beforeEach(() => {
  page = join(dir, `CLAUDE-${++n}.md`)
  writeFileSync(page, OLD, 'utf-8')
  log.warn.mockClear()
})
const text = () => readFileSync(page, 'utf-8')
const addBlock = () => vi.fn((s: string) => s + BLOCK)

describe('rewriteSheetUnderLock, nobody else at the page', () => {
  it('writes the transformed text IN PLACE: same file, same mode, bytes as given', () => {
    chmodSync(page, 0o640)
    const before = statSync(page)
    expect(rewriteSheetUnderLock(page, (s) => s + BLOCK)).toBe('written')
    expect(readFileSync(page)).toEqual(Buffer.from(OLD + BLOCK, 'utf-8'))
    const after = statSync(page)
    // A rename would have put another file at the path, out from under a lock holder.
    expect(after.ino).toBe(before.ino)
    expect(after.mode & 0o777).toBe(0o640)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('a shorter text leaves no tail of the longer one behind', () => {
    writeFileSync(page, OLD + 'x'.repeat(5000), 'utf-8')
    expect(rewriteSheetUnderLock(page, () => 'short\n')).toBe('written')
    expect(text()).toBe('short\n')
  })

  it('a transform that changes nothing: nothing written', () => {
    const before = statSync(page)
    const same = vi.fn((s: string) => s)
    expect(rewriteSheetUnderLock(page, same)).toBe('unchanged')
    expect(same).toHaveBeenCalledTimes(1)
    expect(statSync(page).mtimeMs).toBe(before.mtimeMs)
    expect(text()).toBe(OLD)
  })

  it('a page that is not there: unreadable, the transform is not asked', () => {
    const t = addBlock()
    expect(rewriteSheetUnderLock(join(dir, 'no-such.md'), t)).toBe('unreadable')
    expect(t).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'no-such.md'))).toBe(false)
  })

  it('a transform that comes out empty is refused, the page keeps its text', () => {
    expect(() => rewriteSheetUnderLock(page, () => '')).toThrow(/came out empty, not written/)
    expect(text()).toBe(OLD)
  })

  it('a page that cannot be opened for writing: throws with the reason, the page keeps its text', () => {
    chmodSync(page, 0o444)
    expect(() => rewriteSheetUnderLock(page, (s) => s + BLOCK)).toThrow(/locked write failed \(exit 5\).*PermissionError/)
    expect(text()).toBe(OLD)
  })

  it('no python on the machine: written by rename, and said once', () => {
    const before = statSync(page).ino
    expect(rewriteSheetUnderLock(page, (s) => s + BLOCK, { python: '/nonexistent/python3' })).toBe('written')
    expect(text()).toBe(OLD + BLOCK)
    expect(statSync(page).ino).not.toBe(before)
    expect(rewriteSheetUnderLock(page, (s) => s + BLOCK, { python: '/nonexistent/python3' })).toBe('written')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(String(log.warn.mock.calls[0][1])).toContain('WITHOUT the editors\' lock')
  })
})

describe('rewriteSheetUnderLock against a process that holds the page\'s lock', () => {
  it('an editor reads, we read, the editor writes: BOTH edits are on the page', async () => {
    const holder = await holdSheet(page, 'edit', 600, { waitForGo: true })
    // The editor's wait starts at our first read, so the order does not hang on this machine's
    // speed. Our read sees the text the editor also read; the write step waits for the lock,
    // finds the page changed and writes nothing; the second round starts from the editor's text.
    const t = vi.fn((s: string) => { holder.go(); return s + BLOCK })
    expect(rewriteSheetUnderLock(page, t)).toBe('written')
    expect(await holder.done).toBe(0)
    expect(text()).toBe(OLD + 'EDITOR LINE\n' + BLOCK)
    expect(t.mock.calls.map((c) => c[0])).toEqual([OLD, OLD + 'EDITOR LINE\n'])
  })

  it('the page is replaced by a rename while we wait for the lock: we write the file the path names', async () => {
    const before = statSync(page).ino
    const holder = await holdSheet(page, 'rename', 600, { waitForGo: true })
    const t = vi.fn((s: string) => { holder.go(); return s + BLOCK })
    expect(rewriteSheetUnderLock(page, t)).toBe('written')
    expect(await holder.done).toBe(0)
    expect(statSync(page).ino).not.toBe(before)
    expect(text()).toBe(OLD + 'RENAMED LINE\n' + BLOCK)
    expect(t.mock.calls.map((c) => c[0])).toEqual([OLD, OLD + 'RENAMED LINE\n'])
  })

  it('the lock stays busy past the wait: throws, and the page is the holder\'s', async () => {
    const holder = await holdSheet(page, 'hold', 1500)
    expect(() => rewriteSheetUnderLock(page, (s) => s + BLOCK, { lockWaitMs: 200 })).toThrow(/somebody held its lock for 200 ms, not written/)
    expect(text()).toBe(OLD)
    expect(await holder.done).toBe(0)
  })

  // Review 58529, finding 2: the wait is a spawnSync, the dashboard's event loop stands still for
  // all of it. With the earlier 10 s this call would sit out the holder and write.
  it('no wait named: it gives up after 2 s, not after the holder is done', async () => {
    const holder = await holdSheet(page, 'hold', 3500)
    const started = Date.now()
    expect(() => rewriteSheetUnderLock(page, (s) => s + BLOCK)).toThrow(/somebody held its lock for 2000 ms, not written/)
    expect(Date.now() - started).toBeLessThan(3400)
    expect(text()).toBe(OLD)
    expect(await holder.done).toBe(0)
  }, 15_000)
})

// Review 58529, finding 2: the write under the lock can refuse, and a refusal is a throw. The
// dashboard's boot and an agent's start called it bare.
describe('ensureSheetSectionAtStart: a start does not fail on a sheet somebody holds', () => {
  it('the lock stays busy: no throw, the page is the holder\'s, and the log names the sheet\'s agent, the section and the reason', async () => {
    const holder = await holdSheet(page, 'hold', 1500)
    const ensure = vi.fn(() => { rewriteSheetUnderLock(page, (s) => s + BLOCK, { lockWaitMs: 200 }) })
    expect(() => ensureSheetSectionAtStart('some-agent', 'autonomy', ensure)).not.toThrow()
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(text()).toBe(OLD)
    expect(log.warn).toHaveBeenCalledTimes(1)
    const [fields, said] = log.warn.mock.calls[0]
    expect(fields).toMatchObject({ agent: 'some-agent', section: 'autonomy' })
    expect(String(fields.err.message)).toMatch(/somebody held its lock for 200 ms, not written/)
    expect(String(said)).toContain('could not be written at start')
    expect(await holder.done).toBe(0)
  })

  it('nobody at the page: the section is written and nothing is logged', () => {
    ensureSheetSectionAtStart('some-agent', 'autonomy', () => { rewriteSheetUnderLock(page, (s) => s + BLOCK) })
    expect(text()).toBe(OLD + BLOCK)
    expect(log.warn).not.toHaveBeenCalled()
  })

  // The two sections written under the lock are the two that can throw. Every call of them in the
  // source has to be one somebody catches: through the wrapper, or in front-desk-sheets.ts, which
  // catches per sheet and names the sheet in the settings answer. A new bare call fails here.
  it('every call of a locked section in src/ goes through the wrapper (or is the settings write, which catches)', () => {
    const CALL = /\b(ensureAutonomySection|ensureReportRoutingSection)\(/
    const files = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    const calls: string[] = []
    const bare: string[] = []
    for (const f of files) {
      const rel = relative(SRC, join(SRC, f))
      readFileSync(join(SRC, f), 'utf-8').split('\n').forEach((line, i) => {
        const code = line.trim()
        if (!CALL.test(code) || code.startsWith('//') || code.startsWith('*') || code.startsWith('export function ')) return
        calls.push(`${rel}:${i + 1}`)
        if (rel === join('web', 'front-desk-sheets.ts')) return
        if (!code.includes('ensureSheetSectionAtStart(')) bare.push(`${rel}:${i + 1}: ${code}`)
      })
    }
    expect(bare).toEqual([])
    // The scan found the calls it is about: two at the dashboard's boot, two at an agent's start,
    // two in the settings write. A scan that finds nothing would also report no bare call.
    expect(calls.filter((c) => c.startsWith('web.ts:'))).toHaveLength(2)
    expect(calls.filter((c) => c.startsWith(join('web', 'agent-process.ts') + ':'))).toHaveLength(2)
    expect(calls.filter((c) => c.startsWith(join('web', 'front-desk-sheets.ts') + ':'))).toHaveLength(2)
    expect(calls).toHaveLength(6)
  })
})

describe('scripts/sheet-locked-write.py, called directly', () => {
  const run = (args: string[], input: string) => spawnSync('python3', [HELPER, ...args], { input: Buffer.from(input, 'utf-8') })

  it('the text on the page is not the text the caller read: exit 3, nothing written', () => {
    const r = run([page, sha('something else')], 'NEW\n')
    expect(r.status).toBe(3)
    expect(r.stderr.toString()).toContain('changed since it was read')
    expect(text()).toBe(OLD)
  })

  it('the right hash: exit 0, the page is the new text', () => {
    expect(run([page, sha(OLD)], 'NEW\n').status).toBe(0)
    expect(text()).toBe('NEW\n')
  })

  it('an empty text is a broken caller: exit 64, nothing written', () => {
    expect(run([page, sha(OLD)], '').status).toBe(64)
    expect(text()).toBe(OLD)
  })

  it('a missing page: exit 5; a wait that is not a number, or no hash: exit 64', () => {
    expect(run([join(dir, 'gone.md'), sha(OLD)], 'NEW\n').status).toBe(5)
    expect(existsSync(join(dir, 'gone.md'))).toBe(false)
    expect(run([page, sha(OLD), 'soon'], 'NEW\n').status).toBe(64)
    expect(run([page], 'NEW\n').status).toBe(64)
    expect(text()).toBe(OLD)
  })

  // Review 58529, finding 3. The script's own write step, loaded from the script, with the
  // process KILLED (SIGKILL, from inside the named call) at one of its two steps. The order is
  // the claim: the new bytes first, the cut to length after.
  const KILL_AT = `
import importlib.util, os, signal, sys
helper, page, step = sys.argv[1], sys.argv[2], sys.argv[3]
spec = importlib.util.spec_from_file_location('sheet_locked_write', helper)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
def killed(*args):
    os.kill(os.getpid(), signal.SIGKILL)
setattr(mod.os, step, killed)
data = sys.stdin.buffer.read()
fd = os.open(page, os.O_RDWR)
mod.write_in_place(fd, data)
`
  const killAt = (step: 'pwrite' | 'ftruncate', input: string) =>
    spawnSync('python3', ['-c', KILL_AT, HELPER, page, step], { input: Buffer.from(input, 'utf-8') })

  it('killed at the cut to length: the page is the new text followed by the old tail, never shorter', () => {
    const r = killAt('ftruncate', 'NEW\n')
    expect(r.signal).toBe('SIGKILL')
    const oldBytes = Buffer.from(OLD, 'utf-8')
    expect(readFileSync(page)).toEqual(Buffer.concat([Buffer.from('NEW\n', 'utf-8'), oldBytes.subarray(4)]))
  })

  it('killed before the first byte is written: the page is the old text, whole', () => {
    const r = killAt('pwrite', 'NEW\n')
    expect(r.signal).toBe('SIGKILL')
    expect(readFileSync(page)).toEqual(Buffer.from(OLD, 'utf-8'))
  })

  it('the same driver with no step killed writes the page: the two cases above died where they say', () => {
    const r = spawnSync('python3', ['-c', KILL_AT, HELPER, page, 'not_a_step'], { input: Buffer.from('NEW\n', 'utf-8') })
    expect(r.status).toBe(0)
    expect(text()).toBe('NEW\n')
  })
})

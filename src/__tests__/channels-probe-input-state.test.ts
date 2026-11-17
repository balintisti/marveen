import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// RELOADDEADGRACE1040 (upstream 058ad0901e, card 09861207): the died-after-up
// watchdog types /reload-plugins only when probe_pane_input_state answers "idle".
// Upstream's channels.sh carries that probe from MCPDUP806; ours moved MCPDUP806
// to the dashboard (card e71b2b51), so the port added the probe back, and without
// it the call was "command not found" and the reload never fired. This runs the
// SHIPPED function against a stub pane-state.js, so the shell part is what is
// measured: which instrument decides, what is printed, and that every failure
// reads as not safe to type. The rule itself is pane-state's, tested there.

const ROOT = join(__dirname, '..', '..')
const CHANNELS = readFileSync(join(ROOT, 'scripts', 'channels.sh'), 'utf-8')
const mkTmp = tmpDirs()
const dir = mkTmp('probe-input-state-')

function sliceShellFn(src: string, name: string): string {
  const start = src.indexOf(`\n${name}() {`)
  if (start < 0) throw new Error(`function ${name}() not found`)
  const end = src.indexOf('\n}', start + 1)
  return src.slice(start + 1, end + 2)
}

// Sliced on use, so a missing function fails a test rather than the whole file.
const fn = () => sliceShellFn(CHANNELS, 'probe_pane_input_state')

// The stub reads the capture as a verdict word: IDLE, TYPING:<text> or a state.
const STUB = join(dir, 'pane-state.js')
writeFileSync(STUB, `
module.exports = {
  stripAllAnsi: (s) => s.replace(/\\x1b\\[[0-9;]*m/g, ''),
  stripGhostSuggestion: (s) => s.replace(/\\x1b\\[2m[^\\x1b]*\\x1b\\[22m/g, ''),
  idleConsideringDimGhost: (plain, view) => view.trim() === 'IDLE',
  detectPaneState: (plain) => plain.startsWith('TYPING:') ? 'typing' : plain.trim(),
  parkedInputText: (s) => s.startsWith('TYPING:') ? s.slice('TYPING:'.length) : null,
}
`)
const THROWS = join(dir, 'throws.js')
writeFileSync(THROWS, 'throw new Error("broken build")\n')

function probe(capture: string, js: string): string {
  return execFileSync('bash', ['-c', `${fn()}\nprobe_pane_input_state`], {
    input: capture,
    encoding: 'utf-8',
    env: { ...process.env, CHANNELS_PANE_STATE_JS: js, INSTALL_DIR: dir },
  }).trim()
}

describe('probe_pane_input_state (the shipped shell function)', () => {
  it('an idle verdict prints idle', () => {
    expect(probe('IDLE', STUB)).toBe('idle')
  })

  it('a dim placeholder is stripped before the idle check (the coloured capture matters)', () => {
    expect(probe('IDLE\x1b[2mTry something\x1b[22m', STUB)).toBe('idle')
  })

  it('parked text prints parked:<text>, collapsed and cut at 120', () => {
    const out = probe(`TYPING:a  half\nwritten ${'x'.repeat(200)}`, STUB)
    expect(out.startsWith('parked:a half written ')).toBe(true)
    expect(out.length).toBe('parked:'.length + 120)
  })

  it('any other state is printed as it is, never as idle', () => {
    expect(probe('busy', STUB)).toBe('busy')
  })

  it('no build to ask: unverifiable', () => {
    expect(probe('IDLE', join(dir, 'missing.js'))).toBe('unverifiable')
  })

  it('a build that throws: unverifiable', () => {
    expect(probe('IDLE', THROWS)).toBe('unverifiable')
  })

  it('it is defined before the watchdog calls it, and the reload is typed only on idle', () => {
    const def = CHANNELS.indexOf('\nprobe_pane_input_state() {')
    const use = CHANNELS.indexOf('| probe_pane_input_state)')
    expect(def).toBeGreaterThan(0)
    expect(use).toBeGreaterThan(def)
    const after = CHANNELS.slice(use, CHANNELS.indexOf("'/reload-plugins' Enter", use))
    expect(after).toContain('if [ "$_reload_probe" = "idle" ]; then')
  })
})

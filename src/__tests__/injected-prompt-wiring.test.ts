/**
 * THE WIRING IS THE THING THAT CAN VANISH -- card c29aaf14 / STUCKINPUT827.
 *
 * The registry and its consumers are both covered by their own tests, and the
 * whole feature still does nothing if `sendPromptToSession` stops recording.
 * Measured: with the recorder call removed, the full suite stays green
 * (437 files / 5553 tests), which is exactly how the binding went missing here
 * once already while a docblock kept claiming it was wired.
 *
 * SEAM, NOT SOURCE TEXT: this drives the real write gate with `node:child_process`
 * stubbed, so it asserts BEHAVIOUR. A source-reading guard would be
 * formatting-dependent -- a legitimate refactor either breaks it or, worse,
 * silently stops matching, which trades one silent gap for another.
 */
import { describe, it, expect, vi } from 'vitest'

// `execSync` must still answer `which <bin>`: platform.ts resolves tmux at
// MODULE LOAD and throws on an empty answer, so a blanket empty mock fails the
// import rather than the assertion -- a broken meter, not a finding.
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => (String(cmd).startsWith('which ') ? '/usr/bin/stub\n' : '')),
  execFileSync: vi.fn(() => ''),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}))

const { sendPromptToSession } = await import('../web/agent-process.js')
const { getInjectedPrompt } = await import('../web/injected-prompt-registry.js')

describe('the write gate records what it types (card c29aaf14)', () => {
  // No reset hook: the registry is module state and this file is its only
  // driver, so a UNIQUE session name is what keeps the case independent. A
  // `beforeEach` guarded on an export that does not exist would look like
  // isolation while doing nothing.

  it('sendPromptToSession populates the injected-prompt registry', async () => {
    const session = 'agent-seam-probe'
    await sendPromptToSession(session, 'hello from the seam probe, long enough to be a real frame', null, {
      waitForIdle: false,
      survival: 'lost',
      survivalReason: 'test probe; nothing re-delivers it',
    })
    const rec = getInjectedPrompt(session)
    expect(rec).not.toBeNull()
    expect(rec?.text).toContain('seam probe')
  })
})

/**
 * STUCK-INPUT RECOVERY NEVER PRESSES ENTER ON A TOOL-PERMISSION PROMPT (card 2a8cb07f).
 *
 * On a permission prompt `❯ 1. Yes` is preselected, so a bare Enter GRANTS the request. Both recovery
 * Enters were guarded against the model-consent dialog only (FABLEFALL1). Measured unreachable today;
 * this is the class guard, pinned in two halves: the helper decides on real pane shapes, and both
 * Enter sites consult it first.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../logger.js', () => ({ logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } }))

const { permissionPromptBlocksBareEnter } = await import('../web/agent-process.js')
const { detectsPermissionPrompt } = await import('../pane-state.js')

// The shape of the live agent-dexter capture in pane-permission-prompt.test.ts, reduced to the lines
// the detector reads: the question, the preselected Yes, and the "Esc to cancel" footer.
const PERMISSION_PANE = [
  ' Bash command',
  '   cd "$API" && npx tsc -b 2>&1 | tail -3',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and don\'t ask again for this command',
  '   3. No, and tell Claude what to do differently (esc)',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n')

const IDLE_PANE = ['╭────────────╮', '│ >          │', '╰────────────╯', '  ? for shortcuts'].join('\n')

const cap = (pane: string) => () => pane

describe('permissionPromptBlocksBareEnter', () => {
  it('the fixture really is a permission prompt to the real detector (else the test proves nothing)', () => {
    expect(detectsPermissionPrompt(PERMISSION_PANE)).toBe(true)
  })

  it('withholds the Enter when a permission prompt is on screen', () => {
    expect(permissionPromptBlocksBareEnter('s', null, cap(PERMISSION_PANE))).toBe(true)
  })

  it('CONTROLS: an idle prompt and an empty pane let the Enter through', () => {
    expect(permissionPromptBlocksBareEnter('s', null, cap(IDLE_PANE))).toBe(false)
    expect(permissionPromptBlocksBareEnter('s', null, cap(''))).toBe(false)
  })

  it('a failed capture withholds it (one tick of delay, never an unapproved grant)', () => {
    expect(permissionPromptBlocksBareEnter('s', null, () => { throw new Error('tmux gone') })).toBe(true)
  })
})

describe('wiring: both recovery Enters consult the guard first', () => {
  const src = readFileSync(join(__dirname, '..', 'web', 'channel-monitor.ts'), 'utf-8')
  const guard = 'if (permissionPromptBlocksBareEnter(session)) break'
  const enter = "execFileSync(TMUX, ['send-keys', '-t', session, 'Enter']"

  it('the guard stands at exactly the two recovery Enter sites', () => {
    expect(src.split(guard).length - 1).toBe(2)
  })

  it('each guard is IMMEDIATELY followed by its Enter, nothing in between', () => {
    let at = src.indexOf(guard)
    let seen = 0
    while (at !== -1) {
      const after = src.slice(at + guard.length, at + guard.length + 120)
      expect(after.trimStart().startsWith(enter)).toBe(true)
      seen++
      at = src.indexOf(guard, at + 1)
    }
    expect(seen).toBe(2)
  })
})

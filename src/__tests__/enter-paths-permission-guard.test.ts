/**
 * THE TWO MACHINE ENTER PATHS ASK THE PERMISSION GUARD TOO (card c5723b82).
 *
 * didi found them in the 2a8cb07f review: the resume-from-summary dismiss typed '1' + Enter when
 * the title appeared ANYWHERE on screen, and the identity /rename typed its command + Enter after a
 * restart -- neither looked for a live tool-permission prompt, where `❯ 1. Yes` is preselected and
 * an Enter GRANTS the request. The dismiss is driven for real here (tmux mocked at the process
 * boundary: the pane goes in, the keystrokes are recorded); the /rename runs inside a restart
 * timer, so its half is pinned on the source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ pane: '', keys: [] as string[][], warns: [] as string[] }))

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: vi.fn((_file: string, args: string[]) => {
    const i = args.indexOf('capture-pane')
    if (i !== -1) return h.pane
    const k = args.indexOf('send-keys')
    if (k !== -1) h.keys.push(args.slice(k + 3))
    return ''
  }),
}))
vi.mock('../logger.js', () => ({ logger: { warn: (_o: unknown, m: string) => { h.warns.push(m) }, info: () => {}, debug: () => {}, error: () => {} } }))

const { dismissResumeSummaryModalIfPresent } = await import('../web/agent-process.js')
const { detectsPermissionPrompt } = await import('../pane-state.js')

// The live modal (pane-looks-idle.test.ts's fixture): title, options, footer.
const RESUME_MODAL = [
  '  Resume from summary',
  '   1. Resume from summary (recommended)',
  '   2. Start fresh',
  '',
  '  Enter to confirm',
].join('\n')

// A permission prompt live at the bottom, with an old modal's text still in the scrollback above.
const PERMISSION_UNDER_OLD_MODAL = [
  '  Resume from summary',
  '   1. Resume from summary (recommended)',
  '',
  '⏺ Bash(cd "$API" && npx tsc -b)',
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

// Scrollback mention only, the input box live below it: not the modal either.
const IDLE_WITH_OLD_TITLE = [
  '  Resume from summary',
  '',
  '╭────────────╮',
  '│ >          │',
  '╰────────────╯',
  '  ? for shortcuts',
].join('\n')

// The footer check alone cannot tell these apart: a permission footer that ALSO says "Enter to
// confirm" passes it, and only the permission guard stops the '1' + Enter.
const PERMISSION_WITH_CONFIRM_FOOTER = [
  '  Resume from summary',
  '',
  ' Bash command',
  '   rm -rf build',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No, and tell Claude what to do differently (esc)',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n')

// The other direction: an ANSWERED permission prompt in scrollback, the modal live below it.
const MODAL_UNDER_OLD_PERMISSION = [
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
  '',
  RESUME_MODAL,
].join('\n')

beforeEach(() => { h.pane = ''; h.keys = []; h.warns = [] })

describe('dismissResumeSummaryModalIfPresent', () => {
  it('CONTROL: the live modal is still dismissed -- 1, then Enter', async () => {
    h.pane = RESUME_MODAL
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([['1'], ['Enter']])
  })

  it('the fixture really is a permission prompt to the real detector (else the next test proves nothing)', () => {
    expect(detectsPermissionPrompt(PERMISSION_UNDER_OLD_MODAL)).toBe(true)
  })

  it('a live permission prompt with the title in scrollback gets NO keystroke', async () => {
    h.pane = PERMISSION_UNDER_OLD_MODAL
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([])
  })

  it('a permission prompt whose footer also says "Enter to confirm" gets NO keystroke', async () => {
    expect(detectsPermissionPrompt(PERMISSION_WITH_CONFIRM_FOOTER)).toBe(true)
    h.pane = PERMISSION_WITH_CONFIRM_FOOTER
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([])
  })

  it('CONTROL: an old permission prompt in scrollback does not keep the live modal up', async () => {
    h.pane = MODAL_UNDER_OLD_PERMISSION
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([['1'], ['Enter']])
  })

  it('the title in scrollback above an idle input box gets NO keystroke', async () => {
    h.pane = IDLE_WITH_OLD_TITLE
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([])
  })

  // didi, 2026-09-28: the real modal's footer text is unverified on the current CLI. If it differs,
  // the footer check would leave a real modal up with nothing said -- so a title without a live
  // footer is logged. Measured live the same day: the old dismiss typed '1' + Enter into an agent's
  // pane with no modal on it (it arrived in that session as a user message "1").
  it('title without a live footer: NO keystroke, and a warning that says so', async () => {
    h.pane = IDLE_WITH_OLD_TITLE
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([])
    expect(h.warns.filter((w) => /no live "Enter to confirm" footer/.test(w))).toHaveLength(1)
  })

  it('CONTROL: no title on screen at all -- nothing typed, nothing warned', async () => {
    h.pane = ['╭────────────╮', '│ >          │', '╰────────────╯', '  ? for shortcuts'].join('\n')
    await dismissResumeSummaryModalIfPresent('agent-x')
    expect(h.keys).toEqual([])
    expect(h.warns).toEqual([])
  })
})

describe('identity /rename consults the guard before its Enter', () => {
  const src = readFileSync(join(__dirname, '..', 'web', 'agent-process.ts'), 'utf-8')
  const guard = "if (permissionPromptBlocksBareEnter(session, host, captureTmux, 'Identity /rename')) {"
  const send = "await submitOwnSlashCommand(cmd, {"

  it('the guard stands once, after the lane is taken and before the /rename send', () => {
    expect(src.split(guard).length - 1).toBe(1)
    const lane = src.indexOf('const releaseIdentityLane = tryAcquireSessionSendLane(session, host)')
    const at = src.indexOf(guard)
    const sendAt = src.indexOf(send)
    expect(lane).toBeGreaterThan(-1)
    expect(lane).toBeLessThan(at)
    expect(at).toBeLessThan(sendAt)
  })

  it('a blocked attempt releases the lane and retries -- it neither types nor holds the lane', () => {
    const at = src.indexOf(guard)
    const body = src.slice(at, src.indexOf('}', at) + 1)
    expect(body).toContain('releaseIdentityLane()')
    expect(body).toContain('continue')
    expect(body).not.toContain('send-keys')
  })
})

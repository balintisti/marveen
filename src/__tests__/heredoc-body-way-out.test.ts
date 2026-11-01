// 6525aba3 A2, marveen 50880: a heredoc body read as a program is denied when a send word
// stands in it, even inside a string literal (a patch script editing mail code, a gate test).
// That over-protection is accepted, measured at 12 false denials on 14 970 real fleet commands
// in 7 days and 0 real sends. Its price must be one step: when the heredoc body is the WHOLE
// reason, both gates name the way out. A visible send elsewhere in the command keeps the
// ordinary wording. What this does NOT protect (didi 51494, measured): the gates cannot tell
// a send word in a string literal from a real send in the body, so a REAL send inside a
// heredoc body is offered the way out too, and a script run as a file is read by neither gate
// (`python3 /tmp/real-send.py` passes, on the base as well). Reading the body by its consumer,
// then checking file-run scripts, are separate cards (marveen 51498, in that order).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision, heredocBodyHit, HEREDOC_BODY_WAY_OUT } from '../../scripts/email-send-gate.mjs'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const ROOT = join(__dirname, '..', '..')
const COPY_GATE = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')
const HARD_GATE = join(ROOT, 'scripts', 'email-send-gate.mjs')
const WAY_OUT = 'A heredoc torzse kodnak olvasodik'

// The shape of the real false denials: a Python patch script whose string holds a mailer call.
// The `<b>` makes the copy gate's body reader take `< b` as a stdin file it cannot read, which
// is how the real ones reached its fail-closed "unreadable" branch.
const PATCH = "python3 - <<'PY'\nT = \"await mail.sendEmail({ html: '<b>x</b>' })\"\nprint(len(T))\nPY"
const VISIBLE_SEND_AND_PATCH = `sendmail a@b.hu < "$BODY"; ${PATCH}`
const PLAIN_CODE_SEND = "python3 -c \"import smtplib; smtplib.SMTP('h').sendmail('a', 'b', open('<b>').read())\""

let dir: string
beforeAll(() => {
  dir = mkTmp('heredoc-way-out-')
  writeFileSync(join(dir, 'rules.json'), '{"bad_name_patterns": []}\n')
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function copyGate(cmd: string): { code: number | null; err: string } {
  const r = spawnSync('python3', [COPY_GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd }, hook_event_name: 'PreToolUse' }),
    encoding: 'utf-8',
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, OUTGOING_COPY_GATE_RULES: join(dir, 'rules.json') },
  })
  return { code: r.status, err: r.stderr }
}

function hardGate(cmd: string): string {
  const r = spawnSync(process.execPath, [HARD_GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } }),
    encoding: 'utf-8',
  })
  return r.stdout + r.stderr
}

describe('hard gate (sub-agents): a heredoc-only deny names the way out', () => {
  it('detects a heredoc body as the whole reason, and only then', () => {
    expect(heredocBodyHit(PATCH)).toBe(true)
    expect(heredocBodyHit(VISIBLE_SEND_AND_PATCH)).toBe(false)
    expect(heredocBodyHit(PLAIN_CODE_SEND)).toBe(false)
    expect(heredocBodyHit("cat <<'EOF'\nsendEmail(x)\nEOF")).toBe(false)
  })

  it('gives kind heredoc-body to the heredoc-only deny, the ordinary deny otherwise', () => {
    expect(gateDecision('Bash', { command: PATCH })).toEqual({ deny: true, kind: 'heredoc-body' })
    expect(gateDecision('Bash', { command: VISIBLE_SEND_AND_PATCH })).toEqual({ deny: true })
    expect(gateDecision('Bash', { command: PLAIN_CODE_SEND })).toEqual({ deny: true })
  })

  it('the hook process keeps the governance message and adds the way out after it', () => {
    const out = hardGate(PATCH)
    expect(out).toContain('"permissionDecision":"deny"')
    expect(out).toContain('Email-kuldes sub-agentkent tiltott')
    expect(out).toContain(WAY_OUT)
    expect(HEREDOC_BODY_WAY_OUT).toContain('KULON Bash-hivasban')
  })

  it('a visible send or a plain code send gets no way out', () => {
    for (const cmd of [VISIBLE_SEND_AND_PATCH, PLAIN_CODE_SEND]) {
      const out = hardGate(cmd)
      expect({ cmd, deny: out.includes('"permissionDecision":"deny"') }).toEqual({ cmd, deny: true })
      expect({ cmd, wayOut: out.includes(WAY_OUT) }).toEqual({ cmd, wayOut: false })
    }
  })
})

describe('copy gate: the unreadable-letter deny names the way out when a heredoc body is the reason', () => {
  it('a patch script whose string holds a mailer call: blocked, and told how to run it', () => {
    const r = copyGate(PATCH)
    expect(r.code).toBe(2)
    expect(r.err).toContain('a levelet nem tudtam megvizsgalni')
    expect(r.err).toContain(WAY_OUT)
  })

  it('a visible send or a plain code send keeps the ordinary wording only', () => {
    for (const cmd of [VISIBLE_SEND_AND_PATCH, PLAIN_CODE_SEND]) {
      const r = copyGate(cmd)
      expect({ cmd, code: r.code }).toEqual({ cmd, code: 2 })
      expect({ cmd, wayOut: r.err.includes(WAY_OUT) }).toEqual({ cmd, wayOut: false })
    }
  })
})

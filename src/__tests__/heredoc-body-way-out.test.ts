// 6525aba3 A2, marveen 50880: a heredoc body read as a program is denied when a send word
// stands in it, even inside a string literal (a patch script editing mail code, a gate test).
// bc98d6d5 narrowed that for Python bodies: their plain string literals are masked, so a
// string-only patch script passes; a body the gates cannot mask (an f-string, a runner word,
// a script-path literal) is still judged whole, and that is the deny the way out is for.
// That over-protection is accepted, measured at 12 false denials on 14 970 real fleet commands
// in 7 days and 0 real sends. Its price must be one step: when the heredoc body is the WHOLE
// reason, both gates name the way out. A visible send elsewhere in the command keeps the
// ordinary wording. What this does NOT protect (didi 51494, measured): the gates cannot tell
// a send word in a string literal from a real send in the body, so a REAL send inside a
// heredoc body is offered the way out too, by both gates (bc98d6d5 T1: the copy gate used to
// audit that body as a letter and pass it, exit 0). Running the script as a file used to be
// the way out, and a real send went through it (`python3 /tmp/real-send.py`): since a4ae5970
// both gates read the file a command runs (script-file-gate.test.ts), so the way out is a DATA
// file the script reads, or an edit made with the file tool.
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
// is how the real ones reached its fail-closed "unreadable" branch. Since bc98d6d5 the plain
// string form passes (STRING_ONLY_PATCH); the f-string keeps the body judged whole (PATCH).
const STRING_ONLY_PATCH = "python3 - <<'PY'\nT = \"await mail.sendEmail({ html: '<b>x</b>' })\"\nprint(len(T))\nPY"
const PATCH = "python3 - <<'PY'\nx = 1\nT = f\"await mail.sendEmail({{ html: '<b>{x}</b>' }})\"\nprint(len(T))\nPY"
const VISIBLE_SEND_AND_PATCH = `sendmail a@b.hu < "$BODY"; ${PATCH}`
const REAL_PY_HEREDOC_SEND = "python3 - <<'PY'\nimport smtplib\nsmtplib.SMTP('h').sendmail('a@b.hu', 'c@d.hu', 'Hello there, this is a test.')\nPY"
const REAL_NODE_HEREDOC_SEND = "node - <<'JS'\nconst { Resend } = require('resend')\nnew Resend(k).emails.send({ to: 'a@b.hu', text: 'Hello there' })\nJS"
const SEND_PY_LETTER = "python3 scripts/support-mail/send.py --to a@b.hu --subject Hello <<'EOF'\nHello there, this is a test.\nEOF"
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

  it('a string-only Python patch script is not denied at all (bc98d6d5)', () => {
    expect(gateDecision('Bash', { command: STRING_ONLY_PATCH })).toEqual({ deny: false })
    expect(hardGate(STRING_ONLY_PATCH)).not.toContain('"permissionDecision":"deny"')
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
    // a4ae5970: running the script as a file is no longer a way out, so the text must not offer it
    expect(HEREDOC_BODY_WAY_OUT).toContain('adatfajlba')
    expect(HEREDOC_BODY_WAY_OUT).not.toContain('KULON Bash-hivasban')
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

  it('a real send that stands only in a heredoc body is denied, not audited as a letter (bc98d6d5 T1)', () => {
    // On 7c63ae96f both exited 0: the copy gate took the code as the letter and found it clean.
    for (const cmd of [REAL_PY_HEREDOC_SEND, REAL_NODE_HEREDOC_SEND]) {
      const r = copyGate(cmd)
      expect({ cmd, code: r.code }).toEqual({ cmd, code: 2 })
      expect({ cmd, wayOut: r.err.includes(WAY_OUT) }).toEqual({ cmd, wayOut: true })
    }
    // CONTROL: a letter piped to the repo's sender by heredoc is still audited, and passes
    expect(copyGate(SEND_PY_LETTER).code).toBe(0)
  })

  it('a string-only Python patch script passes the copy gate (bc98d6d5)', () => {
    expect(copyGate(STRING_ONLY_PATCH).code).toBe(0)
  })

  it('a visible send or a plain code send keeps the ordinary wording only', () => {
    for (const cmd of [VISIBLE_SEND_AND_PATCH, PLAIN_CODE_SEND]) {
      const r = copyGate(cmd)
      expect({ cmd, code: r.code }).toEqual({ cmd, code: 2 })
      expect({ cmd, wayOut: r.err.includes(WAY_OUT) }).toEqual({ cmd, wayOut: false })
    }
  })
})

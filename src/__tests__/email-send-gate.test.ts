import { describe, it, expect } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision } from '../../scripts/email-send-gate.mjs'
import { injectEmailSendGate, agentGetsEmailGate } from '../web/agent-scaffold.js'
import { MAIN_AGENT_ID } from '../config.js'

// The PreToolUse gate decision: which tool calls count as outbound email-send.
describe('gateDecision', () => {
  it('blocks any MCP send_email tool (name-agnostic)', () => {
    expect(gateDecision('mcp__server-gmail-autoauth-mcp__send_email', {}).deny).toBe(true)
    // a differently-named gmail server in a customer install is still gated
    expect(gateDecision('mcp__some_other_gmail__send_email', {}).deny).toBe(true)
  })

  // GMAILCONNECTOR914: the claude.ai Gmail connector has no send_email at all
  // (send_message / reply / forward), and a sub-agent could send through it
  // with no gate. The reads and the drafts stay open, the three sends close,
  // and the kind is NOT 'send_email' so the thread-reply narrowing (which
  // reads send_email-shaped fields) never applies to a connector call.
  it('blocks the claude.ai Gmail connector send-shaped tools, keeps its reads and drafts', () => {
    for (const tool of ['send_message', 'reply', 'forward']) {
      const verdict = gateDecision(`mcp__claude_ai_Gmail__${tool}`, { messageId: 'm1', body: 'x' })
      expect(verdict.deny, tool).toBe(true)
      expect(verdict.kind, tool).toBe('connector-send')
    }
    for (const tool of ['search_threads', 'get_message', 'get_thread', 'create_draft', 'update_draft', 'label_message']) {
      expect(gateDecision(`mcp__claude_ai_Gmail__${tool}`, {}).deny, tool).toBe(false)
    }
  })

  it('allows email READ/draft tools (only sending is gated)', () => {
    expect(gateDecision('mcp__server-gmail-autoauth-mcp__search_emails', {}).deny).toBe(false)
    expect(gateDecision('mcp__server-gmail-autoauth-mcp__read_email', {}).deny).toBe(false)
    expect(gateDecision('mcp__server-gmail-autoauth-mcp__draft_email', {}).deny).toBe(false)
  })

  // @aaronsb/google-workspace-mcp multiplexes read/draft/send behind one tool,
  // so the gate has to read the operation + draft flag, not just the name.
  // This replaces the server's draft-only-email policy, which blocks drafting too.
  describe('manage_email (multiplexed google-workspace tool)', () => {
    const call = (input: Record<string, unknown>) =>
      gateDecision('mcp__google-workspace__manage_email', input)

    it('blocks the outbound operations when no draft is asked for', () => {
      for (const operation of ['send', 'reply', 'replyAll', 'forward']) {
        expect(call({ operation }).deny).toBe(true)
        expect(call({ operation }).kind).toBe('draft-required')
        expect(call({ operation, draft: false }).deny).toBe(true)
      }
    })

    it('allows the same operations when they only create a draft', () => {
      for (const operation of ['send', 'reply', 'replyAll', 'forward']) {
        expect(call({ operation, draft: true }).deny).toBe(false)
      }
    })

    it('allows read-shaped operations', () => {
      for (const operation of ['search', 'read', 'triage', 'labels', 'threads', 'modify']) {
        expect(call({ operation }).deny).toBe(false)
      }
    })

    it('fails safe on a missing or non-boolean draft flag', () => {
      expect(call({ operation: 'send', draft: 'yes' }).deny).toBe(true)
      expect(call({ operation: 'send', draft: 1 }).deny).toBe(true)
      expect(call({}).deny).toBe(false) // no operation at all is not send-shaped
      // the string 'true' survives a JSON round-trip that stringified the flag
      expect(call({ operation: 'send', draft: 'true' }).deny).toBe(false)
    })

    it('is name-agnostic across server prefixes but does not match look-alikes', () => {
      expect(gateDecision('manage_email', { operation: 'send' }).deny).toBe(true)
      expect(gateDecision('mcp__other__manage_email', { operation: 'send' }).deny).toBe(true)
      expect(gateDecision('manage_emails_bulk', { operation: 'send' }).deny).toBe(false)
    })
  })

  it('blocks Bash mail-send commands', () => {
    const bash = (command: string) => gateDecision('Bash', { command })
    expect(bash('python3 scripts/support-mail/send.py --to x@y.hu').deny).toBe(true)
    expect(bash('curl -s -X POST https://api.resend.com/emails -d @body.json').deny).toBe(true)
    expect(bash('echo hi | sendmail user@host').deny).toBe(true)
    expect(bash('swaks --to a@b.c --server smtp').deny).toBe(true)
  })

  it('blocks the graph-mail.ts CLI send path (PR #668) and direct sendMail() calls', () => {
    const bash = (command: string) => gateDecision('Bash', { command })
    expect(bash('tsx scripts/graph-mail.ts send --to a@b.hu --subject x --body y').deny).toBe(true)
    expect(bash('npx tsx scripts/graph-mail.ts send --to a@b.hu --subject x --body y').deny).toBe(true)
    expect(bash(`node -e "require('./src/graph-mail.js').sendMail({to:'a@b.hu'})"`).deny).toBe(true)
    // read-only graph-mail subcommands are NOT send-shaped, so they pass through
    // this gate untouched (they still can't do anything a sub-agent shouldn't:
    // verify/list only read the scoped mailbox)
    expect(bash('tsx scripts/graph-mail.ts verify').deny).toBe(false)
    expect(bash('tsx scripts/graph-mail.ts list --unread').deny).toBe(false)
  })

  // Card 92e3c22f: the CRM's mail service file is `resend-email.service.ts`, and the
  // vendor pattern matched the FILENAME. Two agents hit it on two different days --
  // one could not read the file he was fixing, the other could not REPORT a security
  // measurement (five refused attempts). Both directions are pinned here, because
  // narrowing a gate is exactly where a silent hole gets opened.
  it('still gates a real send through the vendor, in every shape', () => {
    const bash = (command: string) => gateDecision('Bash', { command })
    expect(bash('node -e "resend.emails.send({to:1})"').deny).toBe(true)
    expect(bash('npx resend send --to a@b.c').deny).toBe(true)
    expect(bash('curl -X POST https://api.resend.com/emails -d @b.json').deny).toBe(true)
    expect(bash('python3 support-mail/send.py --to a@b.c').deny).toBe(true)
  })

  it('does NOT gate commands that merely NAME the mail service file', () => {
    const bash = (command: string) => gateDecision('Bash', { command })
    // reading it
    expect(bash('wc -l src/common/services/resend-email.service.ts').deny).toBe(false)
    expect(bash('grep -n sanitizeHeaderValue src/common/services/resend-email.service.ts').deny).toBe(false)
    // and reporting about it -- the case that kept a finding out of the card
    expect(
      bash('curl -X POST localhost:3420/api/kanban/x/comments -d "a resend-email.service.ts 1833 sora"').deny,
    ).toBe(false)
  })

  // Card 27977d33 (didi's mutation battery on 845e457f): three behaviours
  // were right and held by nothing -- each mutant below left the suite green.
  it('pins the three shapes no test held: filename in code, resend subdomain, popen', () => {
    const bash = (command: string) => gateDecision('Bash', { command })
    // C -- the `(?!-\w)` filename exclusion on the CODE path: a one-liner that
    // merely names resend-email.service.ts next to an unrelated .send() is not
    // a send. (The Bash-path twin is the test above; this is the code string.)
    expect(bash(`node -e "console.log('resend-email.service.ts'); obj.send()"`).deny).toBe(false)
    // CONTROL for C: the same shape WITHOUT the filename is gated.
    expect(bash(`node -e "resend.emails.send({to: 'a@b.c'})"`).deny).toBe(true)
    // D -- a regional Resend host is still Resend.
    expect(bash('curl -X POST https://eu.api.resend.com/emails').deny).toBe(true)
    // E -- os.popen is an exec path like subprocess.
    expect(bash(`python3 -c "import os; os.popen('sendmail a@b.c')"`).deny).toBe(true)
  })

  it('allows ordinary Bash that does not send mail', () => {
    const bash = (command: string) => gateDecision('Bash', { command })
    expect(bash('git status').deny).toBe(false)
    expect(bash('npm run build').deny).toBe(false)
    expect(bash('curl -s http://localhost:3420/api/messages').deny).toBe(false)
    // mentioning "resend" without an email/send verb nearby is not gated
    expect(bash('grep resend src/foo.ts').deny).toBe(false)
  })
})

// The main-exempt guard: every sub-agent is gated, the main agent never is.
// Mirrors security-profile-resolution.test.ts -- pure, keyed on the configured
// MAIN_AGENT_ID (not a hardcoded name), so a customer install exempts its own owner.
describe('agentGetsEmailGate', () => {
  it('gates every sub-agent', () => {
    expect(agentGetsEmailGate('samu')).toBe(true)
    expect(agentGetsEmailGate('boni')).toBe(true)
    expect(agentGetsEmailGate('zara')).toBe(true)
  })

  it('NEVER gates the main agent (it retains email-send)', () => {
    expect(agentGetsEmailGate(MAIN_AGENT_ID)).toBe(false)
  })
})

// The settings.json wiring that installs the hook for a sub-agent.
describe('injectEmailSendGate', () => {
  it('adds the PreToolUse email-gate hook', () => {
    const s: Record<string, unknown> = {}
    injectEmailSendGate(s)
    const hooks = (s.hooks as Record<string, unknown>).PreToolUse as Array<Record<string, unknown>>
    expect(hooks).toHaveLength(1)
    expect(hooks[0].matcher).toBe('Bash|.*send_email.*|.*manage_email.*')
    const inner = (hooks[0].hooks as Array<{ command: string }>)[0]
    expect(inner.command).toContain('email-send-gate.mjs')
  })

  // Regression (2026-08-10): the matcher is full-matched against the tool name,
  // and MCP tools arrive qualified as `mcp__<server>__<tool>` -- with the old
  // bare `send_email|manage_email` alternatives the hook never fired for ANY MCP
  // mail tool, so both the sub-agent governance gate and the draft-kapu were
  // silently open. Assert against the real qualified names.
  it('matcher full-matches qualified MCP tool names', () => {
    const s: Record<string, unknown> = {}
    injectEmailSendGate(s)
    const hooks = (s.hooks as Record<string, unknown>).PreToolUse as Array<Record<string, unknown>>
    const re = new RegExp(`^(?:${hooks[0].matcher as string})$`)
    expect(re.test('mcp__google-workspace__manage_email')).toBe(true)
    expect(re.test('mcp__server-gmail-autoauth-mcp__send_email')).toBe(true)
    expect(re.test('manage_email')).toBe(true)
    expect(re.test('send_email')).toBe(true)
    expect(re.test('Bash')).toBe(true)
    expect(re.test('Read')).toBe(false)
    expect(re.test('mcp__google-workspace__manage_calendar')).toBe(false)
  })

  it('is idempotent (no duplicate entries on re-apply / respawn)', () => {
    const s: Record<string, unknown> = {}
    injectEmailSendGate(s)
    injectEmailSendGate(s)
    injectEmailSendGate(s)
    const hooks = (s.hooks as Record<string, unknown>).PreToolUse as unknown[]
    expect(hooks).toHaveLength(1)
  })

  it('preserves existing hooks (e.g. PreCompact) and other PreToolUse entries', () => {
    const s: Record<string, unknown> = {
      hooks: {
        PreCompact: [{ matcher: 'auto', hooks: [{ type: 'agent', prompt: 'x' }] }],
        PreToolUse: [{ matcher: 'WebFetch', hooks: [{ type: 'command', command: 'other.sh' }] }],
      },
    }
    injectEmailSendGate(s)
    const hooks = s.hooks as Record<string, unknown>
    expect((hooks.PreCompact as unknown[]).length).toBe(1)
    const pre = hooks.PreToolUse as Array<Record<string, unknown>>
    // the unrelated WebFetch entry is kept, the email-gate is appended
    expect(pre).toHaveLength(2)
    expect(pre.some((e) => JSON.stringify(e).includes('email-send-gate.mjs'))).toBe(true)
    expect(pre.some((e) => e.matcher === 'WebFetch')).toBe(true)
  })
})

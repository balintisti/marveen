import { describe, it, expect } from 'vitest'
import { formatPermissionPromptCancelledNotice } from '../web/channel-monitor.js'

// Card 296277e8 / 53debafd. VERBATIM `tmux capture-pane -p` from agent-dexter on
// 2026-09-03 07:24 -- the prompt the menu-recovery Escape cancelled at 07:26:45
// while nobody had answered it.
const PERMISSION_PANE = [
  "   │ open(p,'w',encoding='utf-8').write(s)",
  "   │ print(\"automations: 2 subjects + 2 bodies patched;",
  "   │ checklist/notification sites deliberately untouched\")",
  "   │ PY",
  "   │ cd \"$API\" && npx tsc -b 2>&1 | tail -3; echo \"tsc rc=$?\"",
  "   │ echo \"=== the six sites, verified ===\"",
  "   │ grep -c 'escapeHtml: true' src/forms/submission.service.ts",
  "   │ src/email-sequences/email-sequence-executor.service.ts",
  "   │ src/automations/automation-executor.service.ts",
  "   │ echo \"=== textBody must remain UNescaped ===\"",
  "   │ grep -n -A2 'template.textBody' src/forms/submission.service.ts | head",
  "   │ -4",
  "   │ Patch only the two automation email subjects and bodies, verify textBody",
  "   │ untouched",
  "",
  " │ grep on 'src/forms/submission.service.ts' after a cd would search a",
  " │ directory that cannot be determined here, and a Read() deny rule is",
  " │ configured; only you can approve running it anyway.",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. No",
  "",
  " Esc to cancel · Tab to amend",
].join('\n')

describe('formatPermissionPromptCancelledNotice', () => {
  it('names the agent, the session and WHAT was being asked', () => {
    const n = formatPermissionPromptCancelledNotice('dexter', 'agent-dexter', PERMISSION_PANE)
    expect(n).toContain('[permission-cancelled]')
    expect(n).toContain('dexter')
    expect(n).toContain('agent-dexter')
    // The question itself: without it the coordinator cannot judge the denial.
    expect(n).toContain('Do you want to proceed?')
  })

  it('carries WHY the CLI asked, not just that it did', () => {
    const n = formatPermissionPromptCancelledNotice('dexter', 'agent-dexter', PERMISSION_PANE)
    // The real pane explains it: a deny rule plus an unresolvable cwd.
    expect(n).toMatch(/deny rule|cd would search|cannot be determined/)
    expect(n).not.toContain('(nem volt kiolvashato)')
  })

  it('says it is a TRACE, not a request to intervene', () => {
    // If this reads as an alert, 15 a day turns it into noise and the next
    // person mutes the thing that was supposed to make the intervention visible.
    const n = formatPermissionPromptCancelledNotice('dexter', 'agent-dexter', PERMISSION_PANE)
    expect(n).toContain('NYOM')
    expect(n).toContain('53debafd')
  })

  it('degrades honestly when the pane could not be read', () => {
    // Never invent a question. An unreadable pane must SAY so, because a
    // plausible-looking wrong question is worse than an admitted gap.
    const n = formatPermissionPromptCancelledNotice('didi', 'agent-didi', null)
    expect(n).toContain('[permission-cancelled]')
    // Anchored on the QUESTION line specifically. The first version of this
    // assertion just looked for 'nem volt kiolvashato' anywhere, and the REASON
    // line says that too -- so a mutation that fabricated a plausible question
    // ('Do you want to proceed?') kept it green. True assertion, wrong reason.
    expect(n).toContain('A KERDES: (a kerdes nem volt kiolvashato')
    expect(n).not.toContain('undefined')
  })

  it('caps the reason so a long tool payload cannot flood the inbox', () => {
    const flood = ['x'.repeat(5000), 'Do you want to proceed?', '1. Yes'].join('\n')
    const n = formatPermissionPromptCancelledNotice('didi', 'agent-didi', flood)
    expect(n.length).toBeLessThan(1200)
  })
})

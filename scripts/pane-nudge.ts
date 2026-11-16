/**
 * pane-nudge CLI (card 3cf0019f). Run it through `scripts/pane-nudge.sh`; the logic is in
 * src/pane-nudge.ts, this file is only the tmux plumbing and the printing.
 *
 *   pane-nudge.sh <agent> "<text>" [--dry-run] [--session <tmux-session>]
 *   pane-nudge.sh --self-test
 *
 * Exit codes: see NUDGE_EXIT in src/pane-nudge.ts (0 = a turn started; every refusal is its own
 * number, and a refusal types nothing).
 *
 * `--session` replaces the agent-to-session mapping. It exists so the tool can be tried on a
 * scratch tmux session that is not an agent; pointing it at a live agent's pane is the same act
 * as naming the agent, with the same checks.
 */
import { execFileSync } from 'node:child_process'
import {
  NUDGE_EXIT,
  decidePaneNudge,
  nudgePane,
  nudgeTextProblem,
  type NudgeOutcome,
} from '../src/pane-nudge.js'

function usage(): never {
  process.stderr.write('usage: pane-nudge.sh <agent> "<text>" [--dry-run] [--session <tmux-session>]\n       pane-nudge.sh --self-test\n')
  process.exit(NUDGE_EXIT.USAGE)
}

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

// A real pane shape for each verdict. Shapes taken from the fixtures in
// src/__tests__/parked-pane-remedy.test.ts (live captures, 2026-09-03 and 2026-09-05).
const FOOTER = '⏵⏵ bypass permissions on (shift+tab to cycle)'
const RULE = '─'.repeat(60)
const SELF_TEST_PANES: Array<{ name: string; pane: string; go: boolean; refusal: string | null }> = [
  { name: 'idle, empty box', pane: ['scrollback', RULE, '❯ ', RULE, FOOTER].join('\n'), go: true, refusal: null },
  {
    name: 'working',
    pane: ['✻ Thinking… (12s · ↓ 3.1k tokens · esc to interrupt)', RULE, '❯ ', RULE, FOOTER].join('\n'),
    go: false,
    refusal: 'working',
  },
  {
    name: 'permission prompt',
    pane: [' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\n'),
    go: false,
    refusal: 'dialog',
  },
  {
    name: 'text parked in the box',
    pane: ['scrollback', RULE, '❯ [inbox-wakeup] pending inter-agent messages', RULE, FOOTER].join('\n'),
    go: false,
    refusal: 'parked-input',
  },
  { name: 'empty capture', pane: '', go: false, refusal: 'unreadable' },
]

function selfTest(): number {
  let bad = 0
  for (const c of SELF_TEST_PANES) {
    const d = decidePaneNudge(c.pane)
    const ok = d.go === c.go && d.refusal === c.refusal
    if (!ok) bad++
    say(`${ok ? 'ok  ' : 'FAIL'} pane: ${c.name} -> go=${d.go} refusal=${d.refusal}`)
  }
  const texts: Array<[string, boolean]> = [
    ['continue where you stopped', true],
    ['', false],
    ['/clear', false],
    ['!rm x', false],
    ['two\nlines', false],
    ['-s flag', false],
    ['x'.repeat(301), false],
  ]
  for (const [t, allowed] of texts) {
    const ok = (nudgeTextProblem(t) == null) === allowed
    if (!ok) bad++
    say(`${ok ? 'ok  ' : 'FAIL'} text: ${JSON.stringify(t.slice(0, 24))} allowed=${allowed}`)
  }
  say(bad === 0 ? 'self-test: all passed' : `self-test: ${bad} FAILED`)
  return bad === 0 ? 0 : 1
}

function describe(outcome: NudgeOutcome): string {
  switch (outcome.kind) {
    case 'refused':
      return `REFUSED at the ${outcome.stage} (${outcome.decision.refusal}): ${outcome.decision.why}. Nothing was typed.`
    case 'dry-run':
      return `DRY RUN: the pane passed both reads (${outcome.decision.why}). Nothing was typed.`
    case 'started':
      return `OK: a turn started (evidence: ${outcome.evidence}, extra Enters: ${outcome.extraEnters}).`
    case 'not-started':
      return `NOT STARTED: ${outcome.reason}.`
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) return selfTest()

  let dryRun = false
  let sessionOverride: string | null = null
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dry-run') dryRun = true
    else if (a === '--session') {
      sessionOverride = args[++i] ?? null
      if (!sessionOverride) usage()
    } else if (a.startsWith('--')) usage()
    else positional.push(a)
  }
  if (positional.length !== 2) usage()
  const [agent, text] = positional

  const problem = nudgeTextProblem(text)
  if (problem != null) {
    process.stderr.write(`pane-nudge: ${problem}\n`)
    return NUDGE_EXIT.USAGE
  }

  // Loaded here, not at the top: the agent-process module is large, and --self-test and the
  // usage errors above must work without it.
  const proc = await import('../src/web/agent-process.js')
  const names = await import('../src/web/session-names.js')
  const session = sessionOverride ?? names.sessionNameForAgent(agent)
  const target = sessionOverride ? { host: null } : proc.agentTmuxTarget(agent)
  const host = target.host ?? null

  const tmux = (tmuxArgs: string[]): void => {
    const inv = proc.tmuxInvocationFor(tmuxArgs, target)
    execFileSync(inv.file, inv.args, { timeout: 5000, stdio: ['ignore', 'ignore', 'pipe'] })
  }

  try {
    tmux(['has-session', '-t', `=${session}`])
  } catch {
    process.stderr.write(`pane-nudge: no tmux session "${session}" (is the agent running?)\n`)
    return NUDGE_EXIT.NO_SESSION
  }

  const outcome = await nudgePane(
    {
      capture: () => proc.capturePane(session, host),
      typeLiteral: (t) => tmux(['send-keys', '-t', session, '-l', t]),
      pressEnter: () => tmux(['send-keys', '-t', session, 'Enter']),
      delay: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    text,
    { dryRun },
  )
  say(`pane-nudge ${agent} (${session}): ${describe(outcome)}`)
  if (outcome.kind === 'refused' && outcome.decision.apiErrorAtTail === false) {
    say('note: the pane tail does not show a mid-turn API error: this agent may have stopped for another reason.')
  }
  return outcome.exit
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`pane-nudge: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  },
)

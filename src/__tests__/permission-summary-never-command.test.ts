import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { permissionPromptSummary, isPermissionFileCardTitle } from '../pane-state.js'
import { formatStuckSessionAlert } from '../web/message-router.js'
import { formatPermissionPromptMainAlert } from '../web/permission-prompt-escalation.js'
import { permissionPromptAsk, formatPermissionPromptAlert } from '../web/permission-prompt-alert.js'

// Card baabe0ba (F7), upstream ec2934146 (ESZKALTOKEN1019). Upstream's
// permissionPromptSummary() feeds three outgoing messages there; in OUR tree
// the urgent-held notice does not exist, and the third text is the router's
// stuck-session alert. That alert used to quote the pane through its own
// describePermissionPrompt, which on a card with neither a reason block nor a
// description line quoted the command box BY DESIGN, so a token in the command
// reached an inter-agent message (measured with this file, 2026-10-30).
// Coordinator decision (card fa6535bb): the router alert carries the same
// summary as the other two (permissionPromptAsk), and all three texts are
// checked on EVERY shape below.
// On a Bash card WITHOUT a reason block, the last quoted block
// before the question is the command echo, and it used to come back as the
// "reason" -- so the command line, a token in argv included, went into
// agent_messages. The summary must never return the command line.
//
// The panes below are the live captures from fixtures/pane with a token put
// into the command, then with the reason block (and the description line)
// taken out: exactly the card shape that leaked.
const load = (n: string) => readFileSync(join(__dirname, `fixtures/pane/${n}.txt`), 'utf8')
// A marker, not a secret shape (the repo's secret gate rightly refuses those in a fixture).
const TOKEN = 'PROBE-ARGV-TOKEN-ESZKALTOKEN1019'
const withToken = (pane: string) => pane.replace('ls Example/Resources', `curl -H "x-api-key: ${TOKEN}"`)

const CD = withToken(load('permission-prompt-compound-cd'))
const UPPER = withToken(load('permission-prompt-upper-half'))
const REASON_RX = /\n\n │ Compound command contains cd with a relative file read while a Read\(\) deny\n │ rule exists\n/

const noReason = (pane: string) => pane.replace(REASON_RX, '\n')
const noReasonNoDescription = (pane: string) => noReason(pane).replace(/\n {3}Check localization files\n/, '\n')
// card shapes we have not seen: the reason block nested as deep as the command,
// and the command echo at the card's own indent, still followed by its description
const reasonNested = (pane: string) => pane.replace(/\n │ /g, '\n   │ ')
const commandAtCardIndent = (pane: string) => noReason(pane).replace(/\n {3}│ /g, '\n │ ')

// Every outgoing text a permission card is quoted into, for one pane.
function outgoing(pane: string): string[] {
  const ask = permissionPromptAsk(pane)
  return [
    formatStuckSessionAlert('worker', 'marveen', 'agent-worker', 11 * 60 * 1000, 1, 'unknown', pane) ?? '',
    formatPermissionPromptMainAlert('worker', 'agent-worker', ask, 15 * 60 * 1000),
    formatPermissionPromptAlert('worker', 'agent-worker', ask, 15 * 60 * 1000, 15 * 60 * 1000),
  ]
}

describe('the fixtures carry the token in the command, and the cuts apply', () => {
  it('token in, reason block and description line removable', () => {
    for (const p of [CD, UPPER]) {
      expect(p).toContain(TOKEN)
      expect(noReason(p)).not.toContain('Compound command contains cd')
      expect(noReason(p)).toContain('Check localization files')
      expect(noReasonNoDescription(p)).not.toContain('Check localization files')
      expect(noReasonNoDescription(p)).toContain(TOKEN)
      expect(reasonNested(p)).toContain('   │ Compound command contains cd')
      expect(commandAtCardIndent(p)).toContain(' │ cd /Users/')
      expect(commandAtCardIndent(p)).not.toContain('   │ ')
    }
  })
})

describe('positive control: a card WITH its reason block still quotes the reason, never the command', () => {
  it.each([['compound-cd', CD], ['upper-half', UPPER]])('%s', (_n, pane) => {
    const s = permissionPromptSummary(pane)!
    expect(s.title).toBe('Bash command · from the general-purpose agent')
    expect(s.reason).toBe('Compound command contains cd with a relative file read while a Read() deny rule exists')
    expect(permissionPromptAsk(pane)).toContain('Compound command contains cd')
    for (const text of outgoing(pane)) {
      expect(text).toContain('Compound command contains cd')
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain('localization')
    }
  })
})

describe('negative control: a card WITHOUT a reason block never puts the command into a message', () => {
  const cases: Array<[string, string]> = [
    ['no reason block (description line stays)', noReason(CD)],
    ['no reason block, upper-half shape', noReason(UPPER)],
    ['no reason block and no description line', noReasonNoDescription(CD)],
    ['no reason block and no description line, upper-half', noReasonNoDescription(UPPER)],
    ['unseen shape: reason nested as deep as the command', reasonNested(CD)],
    ['unseen shape: command echo at the card indent, followed by its description', commandAtCardIndent(CD)],
  ]
  it.each(cases)('%s', (_n, pane) => {
    expect(permissionPromptSummary(pane)).toBeNull()
    for (const text of outgoing(pane)) {
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain('x-api-key')
      expect(text).not.toContain('example-wt')
      // the message itself still goes out: the prompt is reported, only unquoted
      expect(text.length).toBeGreaterThan(0)
    }
    expect(outgoing(pane)[0]).toContain('TOOL-PERMISSION prompt')
    expect(outgoing(pane)[1]).toContain('TOOL-PERMISSION PROMPT')
  })
})

// Card baabe0ba (F7): the file-card branch of the summary quotes the path and
// nothing else, only when the header says "<Verb> file", only from the card
// itself, and only when the path sits directly under the header.
describe('file card: the summary quotes the path, from the card, directly under the header', () => {
  const RULE = '─'.repeat(60)
  const card = (opts: { before?: string; gap?: string } = {}) => [
    ...(opts.before ? [opts.before, ''] : []),
    RULE,
    ' Edit file · from the general-purpose agent',
    ...(opts.gap ? [opts.gap] : []),
    '   │ ../.claude/scheduled-tasks/x/SKILL.md',
    '   │ + a quoted diff line, file content that is never sent',
    ' Do you want to make this edit to SKILL.md?',
    ' ❯ 1. Yes',
    '   3. No',
    '',
    ' Esc to cancel · Tab to amend',
  ].join('\n')

  it('positive control: the path is the reason, the quoted diff below it is not', () => {
    expect(permissionPromptSummary(card())).toEqual({
      title: 'Edit file · from the general-purpose agent',
      reason: '../.claude/scheduled-tasks/x/SKILL.md',
    })
  })
  it('a box drawn in the transcript ABOVE the card rule is not read as the card', () => {
    const s = permissionPromptSummary(card({ before: ' │ TRANSCRIPT-BOX-LINE' }))
    expect(s?.reason).toBe('../.claude/scheduled-tasks/x/SKILL.md')
    expect(JSON.stringify(s)).not.toContain('TRANSCRIPT-BOX-LINE')
  })
  it('a line between the header and the first quoted block means it is not the path: no summary', () => {
    expect(permissionPromptSummary(card({ gap: '   an unquoted line, a command description' }))).toBeNull()
  })
})

describe('isPermissionFileCardTitle', () => {
  it.each([
    ['Edit file', true],
    ['Create file', true],
    ['Edit file · from the general-purpose agent', true],
    ['Bash command', false],
    ['Bash command · from the general-purpose agent', false],
    ['Bash', false],
    ['Read', false],
    ['edit file', false],
    [null, false],
  ])('%s -> %s', (title, want) => {
    expect(isPermissionFileCardTitle(title as string | null)).toBe(want)
  })
})

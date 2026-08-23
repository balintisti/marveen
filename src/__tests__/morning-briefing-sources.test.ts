import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// scripts/morning-briefing.sh is NOT dead code, and that is the point of this
// file. On this macOS box nothing runs it -- there is no LaunchAgent and
// store/morning.log has never been created -- so it reads as an abandoned
// copy. install-linux.sh:1771 wires it as the ExecStart of a systemd timer, so
// on every LINUX install it IS the morning briefing.
//
// It carried the pre-2026-08-20 instructions for two days after they were
// known wrong: `search_emails` (an MCP tool no agent in this fleet can reach)
// and `list-events` (likewise). A missing MCP tool produces no section, which
// reads exactly like a quiet morning -- the failure this whole chain exists to
// remove, still shipping to a platform nobody here runs.
//
// Source-pinned deliberately: the script's only behaviour is to hand a prompt
// to `claude`, and what has to stay true is the CONTENT of that prompt.

const RAW = readFileSync(join(__dirname, '..', '..', 'scripts', 'morning-briefing.sh'), 'utf-8')

// STRIP THE COMMENTS BEFORE MATCHING, and this file is the reason the rule
// exists rather than an example of it: the first version of the `primary`
// assertion below went red against the COMMENT that explains why `primary` was
// removed. The check alarmed on its own documentation, and the obvious way to
// "fix" that is to delete the explanation -- which is the one part worth
// keeping. The repo already knows this shape (the controller-permissions
// parser strips comments for exactly this reason); a checker that flags a
// correct file teaches everyone to ignore it, and the next real hit goes with
// it.
//
// Whole-line comments only. A `#` inside the quoted prompt is not a comment,
// and a greedier rule would silently eat instructions we are here to pin.
const SRC = RAW.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

describe('morning-briefing.sh -- the sources it tells the agent to use', () => {
  it('does not send the agent looking for MCP tools that do not exist', () => {
    expect(SRC).not.toMatch(/search_emails/)
    expect(SRC).not.toMatch(/list-events/)
  })

  it('names the real mail command', () => {
    expect(SRC).toMatch(/gmail-recent\.py --minutes 720/)
  })

  it('names the real calendar command', () => {
    expect(SRC).toMatch(/calendar-agenda\.sh --hours/)
  })

  it('spells out the empty-vs-unreachable rule, the one that was violated', () => {
    // "Skip an empty category, spell out an unreachable one." Without this the
    // model writes the same calm sentence for both.
    expect(SRC).toMatch(/ok:true es ures, HAGYD KI/)
    expect(SRC).toMatch(/ok:false,\s*\n?\s*#?\s*IRD KI/)
  })

  it('refuses to run with no chat id instead of composing a briefing for chat 0', () => {
    // The channel is allowlisted: a send to chat 0 fails with
    // "chat 0 is not allowlisted", AFTER the whole briefing has been built.
    expect(SRC).not.toMatch(/ALLOWED_CHAT_ID:-0/)
    expect(SRC).toMatch(/ALLOWED_CHAT_ID nincs beallitva/)
  })

  it('does not default the calendar to `primary`', () => {
    // On the service-account path `primary` is the machine account's own
    // calendar: 200, zero events, forever. A default that always answers
    // "free day" is worse than no default.
    expect(SRC).not.toMatch(/HEARTBEAT_CALENDAR_ID:-primary/)
  })
})

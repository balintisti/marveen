import { MAIN_AGENT_ID } from '../config.js'

// EVERY tmux session name this system addresses an agent by, derived in ONE
// place (card 228c9252).
//
// There are two shapes, and both were already correct before this module
// existed. What was missing is that they lived apart: the sub-agent template in
// agent-process.ts, the channels name in main-agent.ts, and the RULE for
// choosing between them nowhere -- so every caller wrote the choice out by hand.
// Five copies of the same ternary, and one caller (agentRunState) that never got
// one. That miss is what told the fleet, in writing, that the coordinator was
// not running and that they should stop sending to it.
//
// The module has no imports beyond the id it keys off, so a caller can depend on
// the rule without pulling in the process layer -- which is also what keeps the
// rule REAL in tests that mock agent-process.

/** Sub-agent template: sub-agents run in `agent-<name>`, started by agent-process. */
export function agentSessionName(name: string): string {
  return `agent-${name}`
}

/** Main-agent template: the main agent runs in a long-lived `<id>-channels`
 *  session managed by launchd/systemd via channels.sh. Parameterized so the
 *  derivation is provable for any brand id, not just the default. */
export function channelsSessionName(mainAgentId: string): string {
  return `${mainAgentId}-channels`
}

/** THE resolver: which of the two shapes addresses this agent.
 *
 *  Anything asking "does this agent's session exist / capture its pane / send to
 *  it" wants this, not `agentSessionName`. The latter answers a narrower
 *  question than its name suggests, and asking it about the main agent yields a
 *  session that has never existed -- which reads as 'stopped' rather than as an
 *  error. A wrong name here is silent by construction.
 *
 *  NOT for the lifecycle paths in agent-process (start/stop/restart): the main
 *  agent has no `agents/<name>` dir and is started by launchd, so those must
 *  keep refusing to act on it (see isMainChannelsAgent). This resolver is for
 *  the READ side -- presence, panes, sends. */
export function sessionNameForAgent(name: string): string {
  return name === MAIN_AGENT_ID ? channelsSessionName(MAIN_AGENT_ID) : agentSessionName(name)
}

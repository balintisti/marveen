// Post-respawn channel-plugin unlock for in-process tmux respawn-pane paths.
//
// Card e71b2b51: this is now the ONLY unlock probe. scripts/channels.sh used to
// run its own after launching the main session (PR #231 / #232), from its own
// process, so its /mcp keystrokes bypassed this process's per-pane send lane and
// could land inside a directive the dashboard was typing into the same pane in
// the same seconds (didi 49996 F4; the /rename twin split a guard directive on
// 2026-10-26 05:19, card c91a1989). channel-monitor.ts now schedules this probe
// after ANY restart of the main pane it sees, including the cold launches that
// used to be channels.sh's (launchd start, `launchctl kickstart`, KeepAlive).
// The empty-input proof (MCPDUP806) that only the shell probe had moved here
// with it: see unlockInputState below.
//
// Originally this module covered only the in-process respawn-pane recovery
// paths in channel-monitor.ts (resumeMarveenSession and
// respawnMarveenSessionFresh), which call `tmux respawn-pane` directly and so
// never ran the channels.sh probe. The
// 2026-06-01 18:55 incident demonstrated this end-to-end: the keep-alive
// staleness watchdog fired respawnMarveenSessionFresh at 18:55:09, the new
// session came up cleanly, but the Telegram plugin landed in `◯ disabled`
// (likely a side-effect of a prior unlock-while-already-running cycle
// disabling it) and stayed there because no unlock probe was scheduled.
// The channel was offline for ~6 minutes until manually rescued via /mcp.
//
// This module is the in-process equivalent of the channels.sh probe.
// schedulePluginUnlockAfterRespawn() is fire-and-forget from the JS respawn
// paths; it waits past the cold-start window, gates on `pgrep -P <claude_pid>
// bun` (no bun = plugin is not running), and if it needs to act, sends the
// same /mcp + Up + Enter + Enter sequence. The Up wraps to the bottom of the
// MCP server list (where plugin:<provider>:<provider> lives), the first Enter
// opens its action menu, and the second Enter selects whichever first action
// is offered. Before the Up, the plugin's OWN /mcp row is classified
// (classifyMcpPluginRow, ported from channels.sh in card e71b2b51) and only a
// row in a state the path may revive fires: on a connected row the second
// Enter lands on "View tools" or "Disable" and turns a healthy plugin off
// (#232). Which states fire is the caller's UnlockRowPolicy:
//   'failed-or-disabled' -- the in-process respawn paths (#234: after the
//       2026-06-01 18:55 respawn the plugin sat in `◯ disabled` until a manual
//       /mcp; this module's comment says the first action there is "Enable").
//   'failed-only'        -- a cold launch the monitor did not cause, the job of
//       the former channels.sh probe, which never fired on a disabled row (#232;
//       its comment: the Enable-only submenu has no Reconnect and the sequence
//       "would land somewhere unsafe").
// The two upstream claims about the disabled submenu contradict each other and
// neither was measured here (no live /mcp capture of a disabled row); each path
// keeps the rule it had (didi 50251).
//
// Caveat: while the keystrokes are being delivered the
// session cannot accept other input, but the helper runs in a setTimeout off
// the recovery thread and only fires once per respawn, so the cost is bounded.

import { tmuxStderr } from './tmux-stderr.js'
import { execFileSync } from 'node:child_process'
import { resolveFromPath } from '../platform.js'
import { logger } from '../logger.js'
import { getProvider, type ChannelProviderType } from '../channel-provider.js'
import { detectPaneState, idleConsideringDimGhost, parkedInputText, stripAllAnsi, stripGhostSuggestion } from '../pane-state.js'
import { tryAcquireSessionSendLane } from './session-send-lock.js'

const TMUX = resolveFromPath('tmux')

// Mirror of scripts/channels.sh post-init grace. The plugin handshake
// (bun spawn + Telegram getMe + sendMessage) usually completes within 15s
// of the claude TUI being interactive. After scheduleIdentitySetup's
// 8s modal-dismiss + 5s /rename + a ~1s safety buffer, the prompt is ready
// around T+15s. We wait another 20s on top of that so a healthy plugin
// has time to write its bot.pid and spawn the bun child before we read.
// Total: T+35s post-respawn.
const UNLOCK_PROBE_DELAY_MS = 35_000

// If the bun child still hasn't appeared the first time we look, give it
// one more grace window before we conclude the plugin is wedged. Some
// installs see the bun process appear only after the first inbound poll,
// which can be delayed if Telegram's long-poll happens to be quiet.
const UNLOCK_PROBE_RETRY_DELAY_MS = 15_000
const UNLOCK_PROBE_MAX_RETRIES = 2

// Per-keystroke settling delays, measured for the former channels.sh probe: opening /mcp
// renders the server list (~3s), Up scrolls to the bottom of the list (~1s),
// the first Enter opens the menu (~2s), the second Enter activates it (~3s).
const MCP_OPEN_SETTLE_MS = 3000
const KEYSTROKE_SETTLE_MS = 1500
// After the second Enter activates Enable/Reconnect, the plugin handshake
// takes a moment and Claude Code renders an action confirmation toast.
// Wait long enough for the toast to settle before Escape, otherwise the
// first Escape can be swallowed by the toast dismiss instead of backing
// out of the action menu.
const POST_UNLOCK_SETTLE_MS = 3000

// Sessions whose most recent unlock probe found the channel plugin ABSENT from
// the /mcp list -- i.e. the plugin MCP server never loaded at all (distinct from
// a Failed/disabled plugin, which the /mcp unlock sequence CAN revive). A fresh
// restart cannot fix an absent plugin: it comes up absent again (observed
// 2026-07-01, rocket + mantis looped 5x fresh-restarts, each absent, until the
// watchdog gave up -- every restart cost the agent its whole session context).
// The down-cascade reads this to escalate to the operator after ONE restart
// instead of burning the full AGENT_MAX_RESTART_ATTEMPTS on a condition no
// restart can repair. Keyed by tmux session name; entries are re-stamped by each
// probe and cleared once the plugin is observed healthy again.
const pluginAbsentAt = new Map<string, number>()

function markPluginAbsent(session: string): void {
  pluginAbsentAt.set(session, Date.now())
}

/** Clear the absent mark once the plugin is observed healthy (recovery). */
export function clearPluginAbsent(session: string): void {
  pluginAbsentAt.delete(session)
}

/**
 * True iff an unlock probe confirmed the plugin ABSENT from the /mcp list for
 * this session within the last `withinMs`. The down-cascade uses this to cut the
 * restart budget for the absent case, since fresh-restarting cannot reload a
 * plugin that never registered.
 */
export function wasPluginConfirmedAbsent(session: string, withinMs: number): boolean {
  const at = pluginAbsentAt.get(session)
  return at != null && Date.now() - at <= withinMs
}

function getSessionClaudePid(session: string): number | null {
  try {
    const raw = execFileSync(TMUX, ['list-panes', '-t', session, '-F', '#{pane_pid}'], {
      timeout: 3000,
      encoding: 'utf-8',
      // TMUXWINDOWATTR920: piped, so tmux's one-line error is logged below with
      // the site instead of being copied undated onto dashboard.error.log.
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n')[0]
    const pid = parseInt(raw ?? '', 10)
    return Number.isFinite(pid) && pid > 1 ? pid : null
  } catch (err) {
    logger.warn({ site: 'channel-plugin-unlock.getSessionClaudePid', session, tmux: tmuxStderr(err) }, 'channel-plugin-unlock: failed to read session claude pid')
    return null
  }
}

// True iff at least one `bun` child is reparented under the claude pid -
// the plugin spawns its poller as a direct subprocess of the claude main
// loop, so bun's presence under the claude pid is the most reliable
// liveness signal we have. Matches the channels.sh `pgrep -P <claude_pid>
// bun` check so the two paths agree on what "plugin running" means.
function hasBunChild(claudePid: number): boolean {
  try {
    const out = execFileSync('/usr/bin/pgrep', ['-P', String(claudePid), 'bun'], {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim()
    return out.length > 0
  } catch {
    // pgrep exits 1 when there are no matches; treat as "no bun child"
    return false
  }
}

// Captured pane lines we use to refuse the keystrokes. Two safety gates:
// (a) the session must be at the bypass-permissions footer (the TUI's idle
// state). If we still see the modal/dialog prompt or the Resume-from-summary
// screen, the unlock keystrokes would land in the wrong context. (b) we
// never send keystrokes if `bun` *is* running - that would risk toggling
// the plugin into Disable, exactly the 2026-06-01 18:55 root cause.
function isSessionReadyForUnlock(session: string): boolean {
  try {
    const pane = execFileSync(TMUX, ['capture-pane', '-t', session, '-p'], {
      timeout: 3000,
      encoding: 'utf-8',
    })
    // Idle footer: claude renders this footer line once the TUI is ready
    // for input. Matches the empirical signature used by detectPaneState
    // for the 'idle' state.
    if (!/bypass permissions on/.test(pane)) return false
    // Refuse if any modal is visible.
    if (/Resume from summary/.test(pane)) return false
    if (/Open System Settings/.test(pane)) return false
    return true
  } catch (err) {
    logger.warn({ err, session }, 'channel-plugin-unlock: capture-pane failed')
    return false
  }
}

// MCPDUP806 (moved from channels.sh with card e71b2b51). Typing "/mcp" only opens
// the MCP manager from an EMPTY idle prompt; into any other state the literal text
// parks in the input box. On a fresh 0.3.9 install (2026-08-06) two boots in a row
// did that: the second "/mcp" appended to the first ("/mcp/mcp"), the combined
// text was submitted as a PROMPT, and while parked the router read the session as
// busy and stopped delivering to it. The footer check above does not see parked
// text, so the round is bracketed by this proof. It reads a COLOURED capture:
// Claude Code renders placeholder hints dim (SGR 2) inside an empty box, and a
// plain capture cannot tell them from parked text.
//   'idle'           -- input box live and provably empty; safe to type
//   'parked:<text>'  -- text parked in the box (collapsed, truncated for logs)
//   anything else    -- the detectPaneState verdict; not safe to type
export function unlockInputState(colouredPane: string): string {
  const plain = stripAllAnsi(colouredPane)
  const view = stripGhostSuggestion(colouredPane)
  if (idleConsideringDimGhost(plain, view)) return 'idle'
  const state = detectPaneState(plain)
  if (state === 'typing') {
    const parked = parkedInputText(view) || parkedInputText(plain) || ''
    return 'parked:' + parked.replace(/\s+/g, ' ').slice(0, 120)
  }
  return state
}

// True when the parked text is nothing but OUR OWN probe residue ("/mcp" fragments
// and whitespace). Only that is ever cleared here; anything else (a human draft, a
// delivered channel message) belongs to the stuck-input recovery stack.
export function isOwnProbeResidue(text: string): boolean {
  return /^\s*(\/mcp\s*)+$/.test(text)
}

// The state of the channel plugin's OWN row in an open /mcp list. Ported from
// channels.sh classify_mcp_plugin_row (#232, #727; card e71b2b51, didi 50251 G1).
// Only the plugin's own row counts, and only its status word decides:
//   - the row label is the MCP server id (pluginPaneId, 2.1.220:
//     `plugin:telegram:telegram`) or `plugin:<pluginId>` (2.1.159:
//     `plugin:telegram@claude-plugins-official`); both are accepted;
//   - the failure glyph changed (`✗ Failed` -> `✘ failed`), so no glyph is
//     matched; the vocabulary mirrors PLUGIN_FAILED_RX in channel-health-monitor.ts;
//   - a line without a status word (the "Listening for channel messages from:"
//     banner names the plugin too) is not the row; the last row wins, the menu
//     renders at the bottom of the pane.
// 'absent' = no own row with a status word: the plugin is not in the list (or the
// list did not render), so Up would select another MCP server.
export type McpPluginRowState = 'failed' | 'disabled' | 'connected' | 'absent'
export function classifyMcpPluginRow(pane: string, provider: ChannelProviderType): { state: McpPluginRowState; row: string } {
  const { pluginPaneId, pluginId } = getProvider(provider)
  const row = pane
    .split('\n')
    .filter((l) => l.includes(pluginPaneId) || l.includes(`plugin:${pluginId}`))
    .filter((l) => /failed|error|disconnected|connected|disabled/i.test(l))
    .at(-1)
  if (row === undefined) return { state: 'absent', row: '' }
  const s = row.toLowerCase()
  const state: McpPluginRowState = /failed|error|disconnected/.test(s) ? 'failed' : s.includes('disabled') ? 'disabled' : 'connected'
  return { state, row: row.trim() }
}

// Which row states a caller lets the Up+Enter+Enter fire on; see the header.
export type UnlockRowPolicy = 'failed-only' | 'failed-or-disabled'
export function unlockRowFires(state: McpPluginRowState, policy: UnlockRowPolicy): boolean {
  return state === 'failed' || (state === 'disabled' && policy === 'failed-or-disabled')
}

function readUnlockInputState(session: string): string {
  try {
    return unlockInputState(execFileSync(TMUX, ['capture-pane', '-t', session, '-e', '-p'], {
      timeout: 3000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
  } catch (err) {
    logger.warn({ site: 'channel-plugin-unlock.readUnlockInputState', session, tmux: tmuxStderr(err) }, 'channel-plugin-unlock: coloured capture failed')
    return 'unverifiable'
  }
}

// One Ctrl-C clears a parked line (measured; C-u and Escape do not empty it). Sent
// only for our own residue, then the state is read again.
function clearOwnResidue(session: string, state: string): string {
  if (!state.startsWith('parked:') || !isOwnProbeResidue(state.slice('parked:'.length))) return state
  execFileSync(TMUX, ['send-keys', '-t', session, 'C-c'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
  execFileSync('/bin/sleep', [String(KEYSTROKE_SETTLE_MS / 1000)], { timeout: KEYSTROKE_SETTLE_MS + 2000 })
  return readUnlockInputState(session)
}

// End of round: leave the input line PROVABLY empty. Escape pops the /mcp modal
// levels one at a time but never clears parked text, so after a bounded Escape
// loop our own leftover "/mcp" gets one Ctrl-C. Returns the measured end state.
const END_OF_ROUND_ESCAPES = 3
function finishUnlockRound(session: string): string {
  let state = readUnlockInputState(session)
  for (let i = 0; i < END_OF_ROUND_ESCAPES && state !== 'idle' && !state.startsWith('parked:'); i++) {
    execFileSync(TMUX, ['send-keys', '-t', session, 'Escape'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync('/bin/sleep', [String(KEYSTROKE_SETTLE_MS / 1000)], { timeout: KEYSTROKE_SETTLE_MS + 2000 })
    state = readUnlockInputState(session)
  }
  return clearOwnResidue(session, state)
}

function sendUnlockKeystrokes(session: string, provider: ChannelProviderType, rowPolicy: UnlockRowPolicy): void {
  try {
    // Open the MCP dialog. Claude renders the server list within ~2s; the
    // 3s settle ensures the cursor is on the first item before we move.
    execFileSync(TMUX, ['send-keys', '-t', session, '/mcp', 'Enter'], { timeout: 5000 })
    execFileSync('/bin/sleep', [String(MCP_OPEN_SETTLE_MS / 1000)], { timeout: MCP_OPEN_SETTLE_MS + 2000 })

    // Safety gate: classify the channel plugin's own row in the /mcp list
    // before navigating to it. When the CC regression prevents the plugin from
    // loading at all, the list only shows google-workspace / spotify / computer-use
    // -- the Up key would select the wrong entry and Enable/Reconnect an unrelated
    // MCP server. A bare mention of the provider elsewhere on the screen (a
    // channel message in the scrollback) is not the row.
    let paneAfterOpen = ''
    try {
      paneAfterOpen = execFileSync(TMUX, ['capture-pane', '-t', session, '-p'], {
        timeout: 3000,
        encoding: 'utf-8',
      })
    } catch (err) {
      logger.warn({ err, session }, 'channel-plugin-unlock: capture-pane after /mcp open failed -- aborting')
      try { execFileSync(TMUX, ['send-keys', '-t', session, 'Escape'], { timeout: 5000 }) } catch { /* ignore */ }
      return
    }
    const { state: rowState, row } = classifyMcpPluginRow(paneAfterOpen, provider)
    if (rowState === 'absent') {
      // Plugin is not in the MCP list (never loaded, not Failed/disabled) --
      // the unlock sequence cannot help and would target the wrong entry.
      logger.warn({ session, provider }, 'channel-plugin-unlock: provider plugin absent from /mcp list -- skipping unlock (plugin never loaded, not recoverable via /mcp)')
      // Record the absent verdict so the down-cascade escalates to the operator
      // after one restart instead of looping fresh-restarts that cannot help.
      markPluginAbsent(session)
      try { execFileSync(TMUX, ['send-keys', '-t', session, 'Escape'], { timeout: 5000 }) } catch { /* ignore */ }
      return
    }
    if (!unlockRowFires(rowState, rowPolicy)) {
      // A connected row (Up+Enter+Enter would pick "Disable"), or a disabled row
      // on a path that never fires on one. The row is logged: a stale matcher is
      // invisible without it.
      logger.warn({ session, provider, rowState, rowPolicy, row }, 'channel-plugin-unlock: plugin row not in a state this path revives -- skipping unlock')
      try { execFileSync(TMUX, ['send-keys', '-t', session, 'Escape'], { timeout: 5000 }) } catch { /* ignore */ }
      return
    }

    // Up wraps to the bottom of the list, where the plugin servers live
    // (claude lists them last). Built-in MCPs are above Plugin MCPs in the
    // sort order, so the bottommost entry is the channel plugin we want.
    execFileSync(TMUX, ['send-keys', '-t', session, 'Up'], { timeout: 5000 })
    execFileSync('/bin/sleep', [String(KEYSTROKE_SETTLE_MS / 1000)], { timeout: KEYSTROKE_SETTLE_MS + 2000 })
    // First Enter opens the action menu for the selected MCP server.
    execFileSync(TMUX, ['send-keys', '-t', session, 'Enter'], { timeout: 5000 })
    execFileSync('/bin/sleep', [String(KEYSTROKE_SETTLE_MS / 1000)], { timeout: KEYSTROKE_SETTLE_MS + 2000 })
    // Second Enter activates the first action - "Reconnect" for failed,
    // "Enable" for disabled (per #234; see the header).
    execFileSync(TMUX, ['send-keys', '-t', session, 'Enter'], { timeout: 5000 })
    // After activation, the pane stays in the MCP server list (Claude Code
    // does NOT auto-dismiss to the prompt). detectPaneState reads that as
    // non-idle, every scheduled tick + inter-agent msg piles up with
    // "Schedule target session busy" until someone manually presses Esc.
    // 2026-06-01 19:25 incident: the unlock probe recovered the plugin at
    // 19:27:16, but the pane stayed wedged in the MCP list until manual
    // Escape at 19:40 -- 13 minutes of dropped traffic. Escape twice to
    // back out of both menu levels (action menu -> server list -> idle
    // prompt), with a settle between so the first Escape lands before
    // the second arrives.
    execFileSync('/bin/sleep', [String(POST_UNLOCK_SETTLE_MS / 1000)], { timeout: POST_UNLOCK_SETTLE_MS + 2000 })
    execFileSync(TMUX, ['send-keys', '-t', session, 'Escape'], { timeout: 5000 })
    execFileSync('/bin/sleep', [String(KEYSTROKE_SETTLE_MS / 1000)], { timeout: KEYSTROKE_SETTLE_MS + 2000 })
    execFileSync(TMUX, ['send-keys', '-t', session, 'Escape'], { timeout: 5000 })
    logger.warn({ session }, 'channel-plugin-unlock: sent /mcp+Up+Enter+Enter+Esc+Esc unlock sequence')
  } catch (err) {
    logger.error({ err, session }, 'channel-plugin-unlock: failed to deliver unlock keystrokes')
  }
}

interface UnlockProbeState {
  session: string
  provider: ChannelProviderType
  rowPolicy: UnlockRowPolicy
  retriesLeft: number
}

function runUnlockProbe(state: UnlockProbeState): void {
  const claudePid = getSessionClaudePid(state.session)
  if (!claudePid) {
    logger.warn({ session: state.session }, 'channel-plugin-unlock: no claude pid; skipping unlock probe')
    return
  }

  if (hasBunChild(claudePid)) {
    // Plugin is up again -- retire any stale absent verdict so a future
    // down-spell starts from a clean restart budget.
    clearPluginAbsent(state.session)
    logger.info(
      { session: state.session, claudePid, provider: state.provider },
      'channel-plugin-unlock: bun child present, plugin healthy - no unlock needed',
    )
    return
  }

  if (!isSessionReadyForUnlock(state.session)) {
    if (state.retriesLeft > 0) {
      logger.info(
        { session: state.session, retriesLeft: state.retriesLeft },
        'channel-plugin-unlock: pane not idle yet, retrying',
      )
      setTimeout(() => runUnlockProbe({ ...state, retriesLeft: state.retriesLeft - 1 }), UNLOCK_PROBE_RETRY_DELAY_MS)
      return
    }
    logger.warn({ session: state.session }, 'channel-plugin-unlock: pane never reached idle state, abandoning')
    return
  }

  // PANEWRITERS805: the unlock sequence is direct keystrokes (/mcp, Up, Enter)
  // into a pane that also receives locked deliveries. Fail-closed on a busy
  // send lane, reusing the existing not-idle retry ladder: a delivery finishes
  // within seconds, well inside the ladder's budget.
  const releaseLane = tryAcquireSessionSendLane(state.session, null)
  if (!releaseLane) {
    if (state.retriesLeft > 0) {
      logger.info(
        { session: state.session, retriesLeft: state.retriesLeft },
        'channel-plugin-unlock: pane send lane busy (delivery in flight), retrying',
      )
      setTimeout(() => runUnlockProbe({ ...state, retriesLeft: state.retriesLeft - 1 }), UNLOCK_PROBE_RETRY_DELAY_MS)
      return
    }
    logger.warn({ session: state.session }, 'channel-plugin-unlock: pane send lane never freed up, abandoning')
    return
  }

  // Inside the lane, so no delivery can start between the proof and the typing.
  let inputState = 'unverifiable'
  try {
    inputState = clearOwnResidue(state.session, readUnlockInputState(state.session))
    if (inputState === 'idle') {
      logger.warn(
        { session: state.session, claudePid, provider: state.provider },
        'channel-plugin-unlock: bun child absent after cold-start window, firing /mcp unlock sequence',
      )
      sendUnlockKeystrokes(state.session, state.provider, state.rowPolicy)
      const endState = finishUnlockRound(state.session)
      if (endState === 'idle') {
        logger.info({ session: state.session }, 'channel-plugin-unlock: unlock round finished, input line verified empty')
      } else {
        logger.warn({ session: state.session, endState }, 'channel-plugin-unlock: input line NOT verified empty after the unlock round (MCPDUP806) -- the stuck-input recovery owns it from here')
      }
    }
  } catch (err) {
    logger.error({ err, session: state.session }, 'channel-plugin-unlock: unlock round failed')
    return
  } finally {
    releaseLane()
  }
  if (inputState === 'idle') return
  if (state.retriesLeft > 0) {
    logger.info(
      { session: state.session, retriesLeft: state.retriesLeft, inputState },
      'channel-plugin-unlock: input line not provably empty, not typing /mcp (MCPDUP806), retrying',
    )
    setTimeout(() => runUnlockProbe({ ...state, retriesLeft: state.retriesLeft - 1 }), UNLOCK_PROBE_RETRY_DELAY_MS)
    return
  }
  logger.warn({ session: state.session, inputState }, 'channel-plugin-unlock: input line never proven empty, abandoning (MCPDUP806)')
}

/**
 * Schedule a post-respawn unlock probe for the main channels session.
 *
 * Call this fire-and-forget right after `tmux respawn-pane` in any in-process
 * recovery path (resumeMarveenSession, respawnMarveenSessionFresh, etc.); for
 * the main session channel-monitor's restart tracker also calls it after any
 * restart it did not cause.
 * The probe waits for the new claude session to finish cold-starting, then
 * checks `pgrep -P <claude_pid> bun`:
 *   - bun child present: plugin healthy, do nothing.
 *   - bun child absent + idle pane + provably empty input line (inside the
 *     send lane): open /mcp and, when the plugin's own row is in a state
 *     `rowPolicy` revives, send Up + Enter + Enter to reconnect (or enable) it.
 *     The default is the in-process respawn rule ('failed-or-disabled'); a cold
 *     launch passes 'failed-only' (the former channels.sh rule).
 *   - bun child absent + non-idle pane: retry up to UNLOCK_PROBE_MAX_RETRIES
 *     times every UNLOCK_PROBE_RETRY_DELAY_MS before giving up.
 *
 * Idempotent across multiple respawns - each call schedules its own setTimeout
 * and the unlock-keystrokes path is itself gated on bun absence, so a stale
 * probe from a previous respawn cannot toggle a healthy plugin to Disable.
 */
export function schedulePluginUnlockAfterRespawn(session: string, provider: ChannelProviderType, rowPolicy: UnlockRowPolicy = 'failed-or-disabled'): void {
  setTimeout(
    () => runUnlockProbe({ session, provider, rowPolicy, retriesLeft: UNLOCK_PROBE_MAX_RETRIES }),
    UNLOCK_PROBE_DELAY_MS,
  )
  logger.info(
    { session, provider, rowPolicy, delayMs: UNLOCK_PROBE_DELAY_MS },
    'channel-plugin-unlock: probe scheduled after respawn',
  )
}

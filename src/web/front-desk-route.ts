// The front desk's live wiring (card 074149c2, stage 2): the setting, tmux and the queue behind
// the pure rule in ../front-desk.ts. Never throws: a failure here answers "the coordinator".
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { getEffectiveSettingValue } from '../settings-store.js'
import { getRecipientQueueState } from '../db.js'
import { isKnownAgent } from './agent-config.js'
import { isAgentRunning } from './agent-process.js'
import { FRONT_DESK_SETTING, machineNoticeRecipient, type MachineNoticeRoute } from '../front-desk.js'

/** Who gets a machine notice about `subjects` right now. The setting is read on every call, so
 *  turning the front desk on or off needs no restart. */
export function resolveMachineNoticeRecipient(subjects: readonly string[]): MachineNoticeRoute {
  try {
    const configured = String(getEffectiveSettingValue(FRONT_DESK_SETTING))
    const route = machineNoticeRecipient(MAIN_AGENT_ID, configured, subjects, {
      isKnown: isKnownAgent,
      isRunning: isAgentRunning,
      pendingDepth: (agent) => getRecipientQueueState(agent).queueDepth,
    })
    // 'not-configured' is the resting state and is not logged; every other answer is, because the
    // before/after inbox measurement counts these lines.
    if (route.why !== 'not-configured') {
      logger.info(
        { frontDesk: configured, to: route.to, subjects, why: route.why },
        route.rerouted
          ? 'front desk: machine notice goes to the front desk'
          : 'front desk: machine notice stays with the coordinator',
      )
    }
    return route
  } catch (err) {
    try {
      logger.warn({ err, subjects }, 'front desk: could not resolve the recipient -- the notice stays with the coordinator')
    } catch { /* the notice matters more than the log line */ }
    return { to: MAIN_AGENT_ID, rerouted: false, why: 'probe-failed' }
  }
}

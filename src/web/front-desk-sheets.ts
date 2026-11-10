// The rule files that NAME the front desk, rewritten the moment the setting changes (card
// 074149c2, follow-up; coordinator's comment 57647, item 2).
//
// Two generated CLAUDE.md sections carry the configured front desk: report-routing and the
// autonomy block's Level 3 line. An agent's sheet is rewritten at that agent's start and the
// coordinator's only at dashboard boot, so after a change of FRONT_DESK_AGENT_ID the sheets on
// disk kept naming the OLD front desk (or none) until each agent happened to restart, and the
// coordinator's until the next dashboard restart. The settings route calls this right after a
// successful write.
//
// What it does NOT do: a session that is already running has read its sheet and keeps the old
// text until its next start. The file is right; the reader is not told.
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { listAllAgentNames } from './agent-config.js'
import { ensureAutonomySection, ensureReportRoutingSection } from './agent-scaffold.js'
import { configuredFrontDesk } from './front-desk-setting.js'

export type FrontDeskSheetRefresh =
  /** A WEB_ONLY staging instance never rewrites a persona file (same gate as the boot path). */
  | { skipped: 'web-only' }
  /** `pages`: every sheet the two writers ran on without throwing (a writer that finds its
   *  block current writes nothing). `failed`: sheets a writer threw on; those keep the old text
   *  until that agent's next start. */
  | { pages: string[]; failed: string[] }

/** Rewrite the front-desk-dependent sections on the coordinator's sheet and on every agent's
 *  sheet (hidden agents too: they start through the same path). Never throws. */
export function refreshFrontDeskSheets(): FrontDeskSheetRefresh {
  if (process.env['WEB_ONLY'] === 'true') return { skipped: 'web-only' }
  const pages: string[] = []
  const failed: string[] = []
  let names: string[]
  try {
    names = [MAIN_AGENT_ID, ...listAllAgentNames().filter((n) => n !== MAIN_AGENT_ID)]
  } catch (err) {
    logger.warn({ err }, 'front desk sheets: could not list the agents -- no sheet rewritten')
    return { pages, failed: ['*'] }
  }
  const desk = configuredFrontDesk()
  for (const name of names) {
    try {
      ensureAutonomySection(name, desk)
      ensureReportRoutingSection(name, desk)
      pages.push(name)
    } catch (err) {
      failed.push(name)
      logger.warn({ err, agent: name }, 'front desk sheets: could not rewrite this sheet -- it keeps the old text until the next start')
    }
  }
  logger.info({ frontDesk: desk, pages: pages.length, failed }, 'front desk sheets: rewritten after a settings change')
  return { pages, failed }
}

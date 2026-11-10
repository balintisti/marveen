// The configured front-desk id for callers that only need the VALUE (card 074149c2, stage 3: the
// rule-file section). Never throws: an unreadable setting reads as "not configured", which writes
// the section's no-rule form.
import { getEffectiveSettingValue } from '../settings-store.js'
import { FRONT_DESK_SETTING } from '../front-desk.js'

export function configuredFrontDesk(): string {
  try {
    return String(getEffectiveSettingValue(FRONT_DESK_SETTING) ?? '')
  } catch {
    return ''
  }
}

import { CHANNEL_PROVIDER, CHANNEL_TOKEN, CHANNEL_CHAT_ID, ALERT_CHAT_ID } from './config.js'
import { normalizeChatId, resolveAlertOwnerChat } from './owner-chat.js'
import { getProvider } from './channel-provider.js'
import { logger } from './logger.js'
import { markIfTestRun } from './test-run-marker.js'

// Card baabe0ba (F7, upstream 6dc8bfb3d): what a caller may say about an alert,
// for its delivery log line (see logAlertDelivery). Never the text, never a
// chat id.
export interface AlertMeta {
  /** The agent the alert is about, when there is one. */
  agent?: string | null
  /** Which case raised it, e.g. 'permission-prompt'. */
  kind: string
}

type AlertRecipient = 'owner' | 'alert-chat'
type AlertOutcome = 'sent' | 'partial' | 'failed' | 'skipped'

// True when operational alerts go to a chat other than the owner's. Callers
// must then leave owner/partner conversation content (e.g. a preview of a
// parked input line) out of the alert text.
export function alertIsRedirected(): boolean {
  return normalizeChatId(ALERT_CHAT_ID) !== null
}

// Operational alert (watchdogs, restarts, stuck sessions). Goes to
// ALERT_CHAT_ID when it is set, otherwise to the owner chat.
export async function notifyChannel(text: string, meta?: AlertMeta): Promise<void> {
  const alertChat = normalizeChatId(ALERT_CHAT_ID)
  if (alertChat) return sendToChat(alertChat, text, { meta, recipient: 'alert-chat' })
  return notifyOwner(text, meta)
}

// Owner-facing content (heartbeat digest, security events): always the owner
// chat, never rerouted by ALERT_CHAT_ID.
export async function notifyOwner(text: string, meta?: AlertMeta): Promise<void> {
  // CHATID0 -- resolveAlertOwnerChat, not a truthiness test on the raw .env
  // value. The installer writes ALLOWED_CHAT_ID=0 as its placeholder, and "0"
  // is neither empty nor falsy, so a plain truthiness/normalizeChatId-only
  // guard used to PASS on exactly the installs that had no owner chat: the
  // send went out with chat_id=0, the Bot API answered 400, and the two
  // nested catches below discarded it. Result on such an install: every alert
  // in the fleet is silently dropped, and the "kihagyva" warning that exists
  // to say so never fired.
  //
  // The access.json fallback here is the ALERT rule, not the digest one: only
  // a single paired DM entry counts as the owner, never a group or channel,
  // and with several entries the alert is not sent (a guess would reach a
  // stranger). The reason is logged, so a skipped alert is visible.
  const owner = resolveAlertOwnerChat(undefined, CHANNEL_CHAT_ID, CHANNEL_PROVIDER)
  if (!CHANNEL_TOKEN || !owner.chatId) {
    const reason = !CHANNEL_TOKEN ? 'nincs token' : `nincs tulajdonos-chat (${owner.reason})`
    logger.warn(`Channel ertesites kihagyva: ${reason}`)
    logAlertDelivery(meta, 'owner', 'skipped')
    return
  }
  return sendToChat(owner.chatId, text, { meta, recipient: 'owner' })
}

// `alert` carries the caller's meta and the recipient role for the delivery
// line (logAlertDelivery); every send in this file is an alert path.
async function sendToChat(chatId: string, text: string, alert: { meta?: AlertMeta; recipient: AlertRecipient }): Promise<void> {
  if (!CHANNEL_TOKEN) {
    logger.warn('Channel ertesites kihagyva: nincs token')
    logAlertDelivery(alert.meta, alert.recipient, 'skipped')
    return
  }

  // Marked here at the funnel, NOT at call sites -- a new caller must not be
  // able to leak an unmarked message from a test run.
  const outbound = markIfTestRun(text)
  const provider = getProvider(CHANNEL_PROVIDER)
  const formatted = provider.formatMessage(outbound)
  const chunks = provider.splitMessage(formatted)

  let delivered = 0
  for (const chunk of chunks) {
    try {
      const parseMode = CHANNEL_PROVIDER === 'telegram' ? 'HTML' : undefined
      await provider.sendMessage(CHANNEL_TOKEN, chatId, chunk, parseMode)
      delivered++
    } catch {
      try {
        await provider.sendMessage(CHANNEL_TOKEN, chatId, outbound.slice(0, 4096))
        delivered++
      } catch { /* last resort, give up */ }
    }
  }
  const failedChunks = chunks.length - delivered
  const outcome: AlertOutcome = failedChunks === 0 ? 'sent' : delivered > 0 ? 'partial' : 'failed'
  logAlertDelivery(alert.meta, alert.recipient, outcome, chunks.length, failedChunks)
}

// Card baabe0ba (F7, upstream 6dc8bfb3d / 68cb6715): every alert send leaves
// one line -- sent, partly sent, failed or skipped -- so "which alerts did the
// owner get last night" is measurable afterwards. Who and which case come from
// the caller's meta when it gives one; the recipient is a role, never a chat
// id, and the text never enters the line. It is a record, so it is info
// whatever the outcome (the skip reason keeps its own warn above).
function logAlertDelivery(
  meta: AlertMeta | undefined,
  recipient: AlertRecipient,
  outcome: AlertOutcome,
  chunks = 0,
  failedChunks = 0,
): void {
  logger.info({ agent: meta?.agent ?? null, kind: meta?.kind ?? null, recipient, outcome, chunks, failedChunks }, 'alert delivery')
}

// Backward-compatible alias
export const notifyTelegram = notifyChannel

// Security-event notification (break-glass password reset, security:reset).
// Unlike notifyChannel, a missing channel config is an EXPECTED state here
// (fresh installs, channel-less deployments), so it stays fully silent -- the
// recovery path must never depend on, or be noisy about, Telegram being wired.
export async function notifySecurityEvent(text: string): Promise<void> {
  if (!CHANNEL_TOKEN || !resolveAlertOwnerChat(undefined, CHANNEL_CHAT_ID, CHANNEL_PROVIDER).chatId) return
  try {
    await notifyOwner(text)
  } catch {
    /* never let a notification failure break the recovery action itself */
  }
}

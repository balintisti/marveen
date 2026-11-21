// Card f494cace: the card-text read hint bound to THIS install's configured store dir, host and port.
// Kept apart from card-ref.ts so the idle evaluator (src/idle-agent.ts) does not import config.ts.
import { join } from 'node:path'
import { STORE_DIR, WEB_HOST, WEB_PORT } from './config.js'
import { cardTextReadHint } from './card-ref.js'

export const CARD_TEXT_READ_HINT = cardTextReadHint(join(STORE_DIR, '.dashboard-token'), WEB_HOST, WEB_PORT)

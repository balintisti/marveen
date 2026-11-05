// Card 1bde6410 (port of upstream 033b3ff6, card 3ed09d25): notify-owner-chat-runtime pins
// what notify.ts does with a sink, but not that the dashboard registers one. Without the
// line in web.ts every [notify-undelivered] notice goes to a null sink and only the log
// line remains: the silent drop the sink exists to end. This reads web.ts and pins the
// registration, its target (the main agent's inbox, as 'system') and its lane (the router
// process, not web-only).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')

// A live statement: leading whitespace only, so a commented-out copy does not count.
const REGISTRATION =
  /^[ \t]*if \(!webOnly\) setOwnerChatMissingSink\(\(text\) => \{ createAgentMessage\('system', MAIN_AGENT_ID, text\) \}\)/m

describe('web.ts registers the owner-chat-missing sink (1bde6410)', () => {
  it('(w1) the sink writes to the main agent inbox as system, outside web-only mode', () => {
    expect(WEB).toMatch(REGISTRATION)
  })

  it('(w2) both names are imported from the modules that own them', () => {
    expect(WEB).toMatch(/^import \{ setOwnerChatMissingSink \} from '\.\/notify\.js'$/m)
    expect(WEB).toMatch(/^import \{[^}]*\bcreateAgentMessage\b[^}]*\} from '\.\/db\.js'$/m)
  })

  it('(w3) it is registered where the router starts, inside startWebServer', () => {
    const start = WEB.indexOf('export function startWebServer(')
    const router = WEB.indexOf('startMessageRouter()', start)
    const sink = WEB.search(REGISTRATION)
    expect(start).toBeGreaterThan(-1)
    expect(router).toBeGreaterThan(start)
    expect(sink).toBeGreaterThan(router)
  })

  it('(w4) CONTROL: the pattern does not accept a commented-out registration', () => {
    const commented = "  // if (!webOnly) setOwnerChatMissingSink((text) => { createAgentMessage('system', MAIN_AGENT_ID, text) })"
    expect(commented).not.toMatch(REGISTRATION)
  })
})

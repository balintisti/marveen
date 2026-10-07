import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// WHY THIS TEST EXISTS (card fbee04e0, marveen 24820, 2026-10-07).
//
// The uptime and Sentry watchers are ours only: their four source files do not exist
// upstream, so an upstream update cannot conflict with them. What CAN be lost is the
// wiring in web.ts -- two imports, two starts, two stops. An update that rewrites web.ts
// drops them without a conflict, the build stays green, and both watchers silently stop:
// production downtime and new Sentry issues would again reach nobody.
//
// The watchers' own tests pass either way. This test reads the call site instead.
//
// IT IS A SOURCE ASSERTION: it proves the pieces are CONNECTED TO EACH OTHER, not that
// the running process polls. And update.sh does not run vitest, so it fires when the
// suite runs, not at update time; the runtime staleness signal is a separate card.
const WEB = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')
const read = (rel: string) => readFileSync(join(__dirname, '..', ...rel.split('/')), 'utf-8')

const WATCHERS = [
  { fn: 'startUptimeAlertWatcher', module: 'web/uptime-alert-watcher' },
  { fn: 'startSentryIssueWatcher', module: 'web/sentry-issue-watcher' },
] as const

describe.each(WATCHERS)('$fn is wired into the web server', ({ fn, module }) => {
  it('the watcher module exports it', () => {
    expect(read(`${module}.ts`)).toMatch(new RegExp(`export function ${fn}\\(`))
  })

  it('web.ts imports it FROM that module, not from somewhere else', () => {
    const escaped = module.replace(/[/.-]/g, (c) => `\\${c}`)
    expect(WEB).toMatch(new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '\\./${escaped}\\.js'`))
  })

  it('CORRESPONDENCE: started in the not-webOnly arm of startWebServer, and that same handle is stopped', () => {
    // The start: `const X = webOnly ? undefined : fn()`. Inverting the arms would start the
    // watcher only in the web-only process, which is the one that must NOT poll.
    const start = WEB.match(new RegExp(`const (\\w+) = webOnly \\? undefined : ${fn}\\(\\)`))
    expect(start, `${fn}() is no longer started in the not-webOnly arm`).not.toBeNull()
    const handle = start![1]

    // Inside startWebServer, after webOnly is known -- not in some function nobody calls.
    const server = WEB.indexOf('export function startWebServer(')
    const webOnly = WEB.indexOf("const webOnly = process.env['WEB_ONLY'] === 'true'")
    expect(server).toBeGreaterThan(-1)
    expect(webOnly).toBeGreaterThan(server)
    expect(start!.index!).toBeGreaterThan(webOnly)

    // The handle the start returned is the one shutdown clears; a stop on a different name
    // would leave the interval running after close.
    expect(WEB).toMatch(new RegExp(`if \\(${handle}\\) clearInterval\\(${handle}\\)`))
  })

  it('started exactly once -- a second start would poll twice', () => {
    expect(WEB.match(new RegExp(`\\b${fn}\\(\\)`, 'g')) ?? []).toHaveLength(1)
  })
})

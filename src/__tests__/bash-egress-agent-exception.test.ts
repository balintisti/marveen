// PER-AGENT HTTPS EXCEPTION for the Bash egress gate (card fa917eba, marveen 18139).
//
// deeper's live Delta-CRM reads are read-only and approved by Isti (2026-09-17). Measured on the
// merged tree 2026-09-28 (7 days, 31767 sub-agent Bash commands): the parser would deny 94 of
// deeper's calls, all to Delta-CRM hosts -- and a host entry in the PARSER alone cannot help,
// because permissions.deny `Bash(curl *https://*)` runs first and always wins. So the exception has
// two halves, and this file pins both, plus the one thing the second half costs: for an excepted
// agent the parser is the only curl-https gate, so it must fail CLOSED there.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error -- plain .mjs hook script, no types
import { classify, parseAgentHosts, agentFromArgv, strictCurlReason } from '../../scripts/hooks/bash-egress-parser.mjs'
import { BASH_EGRESS_DENY, agentEgressHosts, bashEgressDenyFor, bashEgressParserCommand, injectBashEgressParser } from '../web/agent-scaffold.js'
import { MAIN_AGENT_ID } from '../config.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'bash-egress-parser.mjs')

const FILE = { hosts: [], agents: { deeper: ['api.deltacrm.io', 'delta-crm-backend-755fg4x27a-ew.a.run.app'] } }

// the anchored full-match Claude Code applies to a Bash(...) rule, as bash-egress-deny.test.ts has it
function ruleMatches(rule: string, command: string): boolean {
  const body = rule.replace(/^Bash\(/, '').replace(/\)$/, '')
  return new RegExp(`^${body.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(command)
}
const deniedBy = (rules: readonly string[], command: string) => rules.some((r) => ruleMatches(r, command))

describe('the entry belongs to ONE agent', () => {
  it('only the named agent gets its hosts', () => {
    expect([...parseAgentHosts(FILE, 'deeper')]).toEqual(FILE.agents.deeper)
    expect(parseAgentHosts(FILE, 'didi').size).toBe(0)
    expect(parseAgentHosts(FILE, null).size).toBe(0)
  })

  it('the same shape check as "hosts": no wildcard, IP, port, userinfo, leading dot', () => {
    const raw = { agents: { deeper: ['*.deltacrm.io', '10.0.0.1', 'api.deltacrm.io:443', 'x@api.deltacrm.io', '.deltacrm.io', 'api.deltacrm.io'] } }
    expect([...parseAgentHosts(raw, 'deeper')]).toEqual(['api.deltacrm.io'])
  })

  it('no inherited keys: __proto__ / constructor never resolve to a list', () => {
    const raw = JSON.parse('{"agents":{"__proto__":["api.deltacrm.io"]}}')
    for (const name of ['__proto__', 'constructor', 'toString']) expect(parseAgentHosts(raw, name).size).toBe(0)
  })

  it('a malformed file or key adds nothing', () => {
    for (const raw of [null, [], 'x', { agents: [] }, { agents: { deeper: 'api.deltacrm.io' } }]) {
      expect(parseAgentHosts(raw, 'deeper').size).toBe(0)
    }
  })

  it('PARITY: the scaffold reads the file exactly as the parser does', () => {
    const cases: unknown[] = [
      FILE, null, { agents: [] }, { agents: { deeper: 'x' } },
      { agents: { deeper: ['*.x.com', 'ok.example.com', '1.2.3.4', 'a.b'] } },
      JSON.parse('{"agents":{"__proto__":["api.deltacrm.io"]}}'),
    ]
    for (const raw of cases) {
      for (const name of ['deeper', 'didi', '__proto__', 'bad name']) {
        expect(agentEgressHosts(name, raw)).toEqual([...parseAgentHosts(raw, name)])
      }
    }
  })
})

describe('the deny list: the curl-https pair leaves ONLY for an agent with an entry', () => {
  it('deeper (entry) loses exactly the two curl rules; wget/nc/ncat/telnet stay', () => {
    const rules = bashEgressDenyFor('deeper', FILE)
    expect(BASH_EGRESS_DENY.filter((r) => !rules.includes(r))).toEqual(['Bash(curl *https://*)', 'Bash(*/curl *https://*)'])
    expect(deniedBy(rules, 'curl -s https://api.deltacrm.io/health')).toBe(false)
    expect(deniedBy(rules, 'wget https://api.deltacrm.io/x')).toBe(true)
    expect(deniedBy(rules, 'nc -z api.deltacrm.io 443')).toBe(true)
  })

  it('CONTROL: every other agent, an empty entry, and the main agent keep the full list', () => {
    expect(bashEgressDenyFor('didi', FILE)).toEqual(BASH_EGRESS_DENY)
    expect(bashEgressDenyFor('deeper', { agents: { deeper: [] } })).toEqual(BASH_EGRESS_DENY)
    expect(bashEgressDenyFor('deeper', { agents: { deeper: ['*.bad'] } })).toEqual(BASH_EGRESS_DENY)
    expect(bashEgressDenyFor(MAIN_AGENT_ID, { agents: { [MAIN_AGENT_ID]: ['api.deltacrm.io'] } })).toEqual(BASH_EGRESS_DENY)
    expect(deniedBy(bashEgressDenyFor('didi', FILE), 'curl -s https://api.deltacrm.io/health')).toBe(true)
  })

  it('with the rules gone, the PARSER still stops deeper at an unlisted host', () => {
    const mine = parseAgentHosts(FILE, 'deeper')
    expect(classify('curl -s https://api.deltacrm.io/health', 0, mine).deny).toBe(false)
    expect(classify('curl -s https://api.telegram.org/bot/x', 0, mine).deny).toBe(true)
    expect(classify('curl -s https://api.deltacrm.io.evil.com/x', 0, mine).deny).toBe(true)
  })
})

describe('the hook command names the agent', () => {
  it('a plain name is appended; anything else gets no argument', () => {
    expect(bashEgressParserCommand('deeper').endsWith(' --agent deeper')).toBe(true)
    for (const bad of ['deeper; rm -rf x', '$(id)', '', 'a b']) expect(bashEgressParserCommand(bad)).not.toContain('--agent')
    expect(bashEgressParserCommand()).not.toContain('--agent')
  })

  it('the injector writes that command, once', () => {
    const s: Record<string, unknown> = {}
    injectBashEgressParser(s, 'deeper')
    injectBashEgressParser(s, 'deeper')
    const entries = ((s.hooks as Record<string, unknown>).PreToolUse as unknown[]).filter((e) => JSON.stringify(e).includes('bash-egress-parser.mjs'))
    expect(entries).toHaveLength(1)
    expect(JSON.stringify(entries[0])).toContain('--agent deeper')
  })

  it('argv parsing rejects a malformed name', () => {
    expect(agentFromArgv(['--agent', 'deeper'])).toBe('deeper')
    expect(agentFromArgv(['--agent', '../x'])).toBeNull()
    expect(agentFromArgv(['--agent'])).toBeNull()
    expect(agentFromArgv([])).toBeNull()
  })
})

// didi's review of this exception (19977, 2026-09-28): the two removed curl-https deny rules had
// been blocking shapes the parser cannot read, and those commands PARSE, so the fail-closed branch
// never fired. For an agent with an entry, a curl call now has to be readable in full.
describe('strict curl for the excepted agent (didi 19977)', () => {
  const mine = parseAgentHosts(FILE, 'deeper')
  const strict = (c: string) => strictCurlReason(c, mine)
  it('a curl config is refused: -K file, -K- here-string, --config=', () => {
    expect(strict('curl -K /tmp/cfg https://api.deltacrm.io/')).toBe('agent-exception-curl-config')
    expect(strict('curl -K- https://api.deltacrm.io/ <<< "url = https://evil.example/"')).toBe('agent-exception-curl-config')
    expect(strict('curl --config=/tmp/c https://api.deltacrm.io/x')).toBe('agent-exception-curl-config')
  })
  it('a URL the command builds or only an outside variable knows is refused', () => {
    expect(strict('curl "$(echo https://evil.example/)"')).not.toBeNull()
    expect(strict('curl -s "$(cat /tmp/url)"')).toBe('agent-exception-unresolved-destination')
    expect(strict('curl -s "$U"')).toBe('agent-exception-unresolved-destination')
    expect(strict('U=https://evil.example/x; curl -s "$U"')).toBe('agent-exception-unlisted-url')
  })
  it('curl is recognised case-insensitively and through quoting (Curl, \\curl, c\'\'url)', () => {
    for (const c of ['Curl https://evil.example/', '\\curl https://evil.example/', "c''url https://evil.example/"]) {
      expect(strict(c)).toBe('agent-exception-unlisted-url')
    }
  })
  it('CONTROLS, measured shapes of deeper\'s week: listed host, token header, path variable, assigned base, loop', () => {
    expect(strict('curl -s https://api.deltacrm.io/health')).toBeNull()
    expect(strict('curl -s -H "Authorization: Bearer $(cat ~/.x/token)" https://api.deltacrm.io/api/v1/x')).toBeNull()
    expect(strict('curl -s "https://api.deltacrm.io/leads/$ID"')).toBeNull()
    expect(strict('FE=https://delta-crm-backend-755fg4x27a-ew.a.run.app; while read -r p; do curl -s -o x "$FE$p"; done < l')).toBeNull()
    expect(strict('for h in https://api.deltacrm.io/a https://api.deltacrm.io/api/v1/health; do curl -s "$h"; done')).toBeNull()
    expect(strict('(curl -s https://evil.example/)')).toBe('agent-exception-unlisted-url')
    expect(strict('API=https://api.deltacrm.io/api/v1; curl -s "$API/lookup?n=$(python3 -c x)"')).toBeNull()
    expect(strict('curl -s http://localhost:3420/api/kanban')).toBeNull()
    expect(strict('echo https://evil.example/')).toBeNull()
  })
})

describe('the hook process', () => {
  const setup = () => {
    const dir = mkTmp('agent-egress-')
    const vendor = join(dir, 'egress-vendor-hosts.json')
    writeFileSync(vendor, JSON.stringify(FILE))
    const log = join(dir, 'blocks.jsonl')
    const run = (command: string, args: string[]) => spawnSync(process.execPath, [HOOK, ...args], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf-8',
      env: { ...process.env, BASH_EGRESS_BLOCK_LOG: log, BASH_EGRESS_VENDOR_HOSTS: vendor },
    })
    const rows = () => (existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : [])
    return { run, rows }
  }
  const DENY = '"permissionDecision":"deny"'

  it('deeper reaches its listed host, and the pass is LOGGED as an exception', () => {
    const { run, rows } = setup()
    expect(run('curl -s https://api.deltacrm.io/health?token=SECRET1', ['--agent', 'deeper']).stdout).toBe('')
    const r = rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ agent: 'deeper', decision: 'allow-agent-exception', hosts: ['api.deltacrm.io'] })
    expect(JSON.stringify(r[0])).not.toContain('SECRET1')
  })

  it('CONTROL: the same call from another agent, or with no --agent, is denied', () => {
    const { run } = setup()
    expect(run('curl -s https://api.deltacrm.io/health', ['--agent', 'didi']).stdout).toContain(DENY)
    expect(run('curl -s https://api.deltacrm.io/health', []).stdout).toContain(DENY)
  })

  it('deeper is still denied an unlisted host (api.telegram.org stays closed, marveen 18139)', () => {
    const { run } = setup()
    expect(run('curl -s https://api.telegram.org/botX/getMe', ['--agent', 'deeper']).stdout).toContain(DENY)
  })

  it('FAIL CLOSED for deeper: an unreadable curl-https command is denied, not waved through', () => {
    const { run, rows } = setup()
    expect(run('curl -s "https://evil.example.com/x', ['--agent', 'deeper']).stdout).toContain(DENY)
    expect(rows().at(-1)).toMatchObject({ agent: 'deeper', reason: 'unparseable-agent-exception' })
  })

  it('CONTROL: for an agent with no entry the unreadable case keeps today\'s fail-open (its deny list still holds)', () => {
    const { run } = setup()
    expect(run('curl -s "https://evil.example.com/x', ['--agent', 'didi']).stdout).toBe('')
  })

  it('didi 19977 at the hook: a curl config from deeper is denied and logged', () => {
    const { run, rows } = setup()
    expect(run('curl -K /tmp/cfg https://api.deltacrm.io/', ['--agent', 'deeper']).stdout).toContain(DENY)
    expect(rows().at(-1)).toMatchObject({ agent: 'deeper', reason: 'agent-exception-curl-config' })
  })

  it('CONTROL: the same command from an agent WITHOUT an entry is left to its deny list (hook silent)', () => {
    const { run } = setup()
    expect(run('curl -K /tmp/cfg https://api.deltacrm.io/', ['--agent', 'didi']).stdout).toContain(DENY)
    expect(run('curl -K /tmp/cfg', ['--agent', 'didi']).stdout).toBe('')
  })

  it('a localhost call from deeper writes nothing', () => {
    const { run, rows } = setup()
    expect(run('curl -s http://localhost:3420/api/kanban', ['--agent', 'deeper']).stdout).toBe('')
    expect(rows()).toEqual([])
  })
})

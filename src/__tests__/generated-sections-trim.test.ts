// THE SIX SHORTENED GENERATED SECTIONS KEEP THEIR RULES AND STAY SHORT (card 06874086).
//
// Every agent re-reads its CLAUDE.md on every turn; the pages were 38-47k characters against a
// 25k target, and six generated sections carried the measured-incident stories inline. The card
// moved the stories into rulebook/generalt-szakaszok-indoklas.md (verbatim) and left the operative
// rule and every command on the page. This file pins both halves:
//   1. what must SURVIVE in each section (the rule, the command, the value), read from the block
//      the REAL ensure* writer puts into a file;
//   2. a size ceiling per section, so the stories cannot grow back unnoticed.
// The install root is normalised to '<ROOT>' before measuring: the token path and the rulebook
// pointer are absolute, and a ceiling must not depend on how long the install path is.
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const base = vi.hoisted(() => ({ dir: '' }))
// Only agentDir is redirected: PROJECT_ROOT stays the real one, so the printed paths are the
// install's own, and nothing is written outside the temp dir (sub-agent sheets only).
vi.mock('../web/agent-config.js', async (orig) => ({ ...(await orig<typeof import('../web/agent-config.js')>()), agentDir: (n: string) => join(base.dir, n) }))

const NAMES = ['autonomy-wiring', 'skills-path-trap', 'evidence-rule', 'fleet-auth', 'message-close', 'mcp-list-channel'] as const
type Sec = typeof NAMES[number]

// Byte-identical markers: scripts/agent-core-check.py reads the generated names from them, and
// every live page is matched by them on the next start.
const BEGIN = (n: Sec) => `<!-- BEGIN GENERATED: ${n} (auto-generated, do not edit by hand) -->`
const END = (n: Sec) => `<!-- END GENERATED: ${n} -->`

// Ceilings, normalised length of BEGIN..END inclusive. Measured at the change on the live
// install root, agent 'friday' (before -> after): autonomy 2917 -> 1967, skills 2018 -> 915,
// evidence 1420 -> 1205, fleet-auth 870 -> 681, message-close 794 -> 695, mcp-list 586 -> 537.
// The ceiling is that measurement plus a small margin (the normalised root is shorter, the
// long test agent name is longer).
// autonomy-wiring again, card 134bff2f: the two curl recipes moved to the rulebook, measured on
// this test's own agent and root: 1967 ceiling -> 1542 (the ceiling is that plus a margin).
const CEILING: Record<Sec, number> = {
  'autonomy-wiring': 1600,
  'skills-path-trap': 960,
  'evidence-rule': 1280,
  'fleet-auth': 740,
  'message-close': 730,
  'mcp-list-channel': 590,
}

const AGENT = 'pin-agent-long-name'

async function render() {
  base.dir = mkTmp('gen-trim-')
  const sc = await import('../web/agent-scaffold.js')
  const { PROJECT_ROOT } = await import('../config.js')
  const file = join(base.dir, AGENT, 'CLAUDE.md')
  mkdirSync(join(base.dir, AGENT), { recursive: true })
  writeFileSync(file, '# persona\n')
  sc.ensureAutonomySection(AGENT)
  sc.ensureSkillsPathTrapSection(AGENT)
  sc.ensureEvidenceSection(AGENT)
  sc.ensureFleetAuthSection(AGENT)
  sc.ensureMessageCloseSection(AGENT)
  sc.ensureMcpListChannelSection(AGENT)
  const text = readFileSync(file, 'utf-8')
  const blocks = {} as Record<Sec, string>
  for (const n of NAMES) {
    const from = text.indexOf(BEGIN(n))
    const to = text.indexOf(END(n))
    expect(from, `${n}: BEGIN marker not written byte-identically`).toBeGreaterThanOrEqual(0)
    expect(to, `${n}: END marker missing`).toBeGreaterThan(from)
    blocks[n] = text.slice(from, to + END(n).length)
  }
  return { blocks, PROJECT_ROOT, sc }
}

const between = (s: string, a: string, b?: string) => {
  const i = s.indexOf(a)
  expect(i, `anchor not found: ${a}`).toBeGreaterThanOrEqual(0)
  const j = b === undefined ? s.length : s.indexOf(b, i + a.length)
  expect(j, `end anchor not found: ${b}`).toBeGreaterThan(i)
  return s.slice(i, j)
}

describe('autonomy-wiring: the approval flow survives the trim', () => {
  it('names the config file and the three levels with their meaning', async () => {
    const b = (await render()).blocks['autonomy-wiring']
    expect(b).toContain('store/autonomy-config.json')
    const l1 = between(b, '**Level 1', '**Level 2')
    expect(l1).toContain('csak jelez')
    expect(l1).toContain('NE végezd el')
    expect(l1).toContain('ÁLLJ MEG')
    const l3 = between(b, '**Level 3', 'PAYLOAD')
    expect(l3).toContain('autonóm')
    expect(l3).toContain('utána jelented')
    expect(l3).not.toContain('/api/approvals')
  })

  // Since card 134bff2f the two curl recipes live in the rulebook. The page keeps what a
  // request needs without them: Level 1 names the endpoint and the signal, Level 2 the
  // endpoint, the payload with the own name, the poll and the three outcomes.
  it('level 1 names the endpoint, the payload with the own name and the coordinator, and calls no approval', async () => {
    const l1 = between((await render()).blocks['autonomy-wiring'], '**Level 1', '**Level 2')
    expect(l1).toContain('`POST /api/messages`')
    expect(l1).toContain(`"from":"${AGENT}","to":"`)
    expect(l1).toContain('[FELHÍVÁS] CATEGORY_KEY')
    expect(l1).toContain('NE végezd el')
    expect(l1).toContain('ÁLLJ MEG')
    expect(l1).not.toContain('/api/approvals')
  })

  it('level 2: approval BEFORE acting, POST with the four fields and the own name, GET every 60 s, the three outcomes', async () => {
    const l2 = between((await render()).blocks['autonomy-wiring'], '**Level 2', '**Level 3')
    expect(l2).toContain('MIELŐTT cselekszel')
    expect(l2).toContain('`POST /api/approvals`')
    for (const f of [`"agent_id":"${AGENT}"`, '"category":', '"action_description":', '"timeout_seconds":']) expect(l2).toContain(f)
    expect(l2).toContain('`GET /api/approvals/<id>` 60 mp-enként')
    expect(l2).toContain('status=approved -> végezd el')
    expect(l2).toContain('status=rejected vagy status=timeout -> ne csináld, naplózd az okot')
  })

  it('the page points at a rulebook section that exists and holds both full recipes', async () => {
    const { blocks, PROJECT_ROOT, sc } = await render()
    const b = blocks['autonomy-wiring']
    const book = join(PROJECT_ROOT, 'rulebook', 'generalt-szakaszok-indoklas.md')
    const title = sc.AUTONOMY_RECIPE_HEADING.replace(/^## /, '')
    expect(b).toContain(`\`${book}\`, "${title}" szakasz`)
    expect(b).toMatch(/dashboard: http\S+, token: \/\S+\.dashboard-token\)/)
    const text = readFileSync(book, 'utf-8')
    const from = text.indexOf(`\n${sc.AUTONOMY_RECIPE_HEADING}\n`)
    expect(from, 'the recipe heading is not in the rulebook').toBeGreaterThan(0)
    const to = text.indexOf('\n## ', from + 1)
    const r = text.slice(from, to > 0 ? to : text.length)
    expect(r).toMatch(/curl -s -X POST <DASHBOARD>\/api\/messages /)
    expect(r).toContain(`--data-binary @- <<'JSON'`)
    expect(r).toContain('"from":"<NEVED>"')
    expect(r).toMatch(/curl -s -X POST <DASHBOARD>\/api\/approvals /)
    for (const f of ['"agent_id":"<NEVED>"', '"category":', '"action_description":', '"timeout_seconds":']) expect(r).toContain(f)
    expect(r).toContain('curl -s -H "Authorization: Bearer $(cat <TOKEN>)" "<DASHBOARD>/api/approvals/<id>"')
    expect(r).toContain('A header `$(cat ...)`-ja szándékosan helyettesít be')
    expect(r).toContain('status=approved -> végezd el')
    expect(r).toContain('status=rejected vagy status=timeout -> ne csináld, naplózd az okot')
  })

  it('the payload-quoting rule keeps every load-bearing clause', async () => {
    const p = between((await render()).blocks['autonomy-wiring'], 'PAYLOAD')
    expect(p).toContain('minden API-hívásnál')
    expect(p).toContain('`-d "{...}"` dupla idézőjeles alak TILOS')
    expect(p).toContain('a backtick és a `$(...)` lefut')
    expect(p).toContain('a küldés mégis 200')
    expect(p).toContain("IDÉZETT határoló (`<<'JSON'`")
    expect(p).toContain('a `<<JSON` is behelyettesít')
    expect(p).toContain('`--data-binary @fájl`')
    expect(p).toContain('`python3` + `json.dumps`')
    expect(p).toContain('írás utáni VISSZAOLVASÁS fogja meg')
  })
})

describe('skills-path-trap: the trap, both names, the check', () => {
  it('keeps the symlink fact, the own-skill location and the realpath check', async () => {
    const b = (await render()).blocks['skills-path-trap']
    expect(b).toContain('`.claude-config/skills`')
    expect(b).toContain('`.channels-config/skills`')
    expect(b).toContain('NEM a saját mappád: symlink a')
    expect(b).toContain('`~/.claude/skills`')
    expect(b).toContain('EGÉSZ flottánál megjelenik')
    expect(b).toContain('Saját skill: a munkakönyvtárad')
    expect(b).toContain('`.claude/skills/`')
    expect(b).toContain('Ne a NEVÉT nézd, kérdezd meg, HOVA MUTAT')
    expect(b).toContain('MUNKAKÖNYVTÁRADHOZ KÉPEST RELATÍV')
    expect(b).toContain('python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" <a skills út>')
  })

  it('keeps the insert warning as the first line under BEGIN', async () => {
    const lines = (await render()).blocks['skills-path-trap'].split('\n')
    expect(lines[1]).toContain('NYOMTALANUL ELVESZ')
  })
})

describe('evidence-rule, fleet-auth, message-close, mcp-list-channel: operative rules', () => {
  it('evidence-rule: the three forms, the four bans, the source rule, the true gate sentence', async () => {
    const { blocks, sc } = await render()
    const b = blocks['evidence-rule']
    for (const s of ['**Tény.**', '**Tipp.**', '**Nem tudom.**', 'fontosabb a gyorsaságnál',
      'Nem találsz ki magyarázatot', 'lejárt vagy leállt, amíg meg nem nézted', 'emlékezetből', 'RÁÉPÜL',
      'a gazda ideje utoljára', 'ha van rá mód, nézd meg', 'Mindig előbb', 'mi épült rá', 'From fejléce', '`support@`, `info@`, `hello@` szokásból',
      '"ezt nem találom sehol"', 'a KÜLDÉST tiltja', 'A CÍMET nem ellenőrzi', 'ne olvasd védelemnek ott, ahol nincs']) {
      expect(b, s).toContain(s)
    }
    expect(sc.buildEvidenceBody(true)).toContain('a CÍMET ezen a telepítésen semmilyen gépi kapu nem ellenőrzi')
  })

  it('fleet-auth: token source is the fix, never copy credentials, claudeConfigDir is supported', async () => {
    const b = (await render()).blocks['fleet-auth']
    for (const s of ['AUTH-szabály', '`CLAUDE_CODE_OAUTH_TOKEN`', '`store/.claude-oauth-token`', '`CLAUDE_CONFIG_DIR`',
      '`MAIN_AGENT_ISOLATED_CONFIG`', '`MAIN_AGENT_CONFIG_DIR`', '`claudeConfigDir` támogatott',
      '"Not logged in": a javítás a TOKEN-FORRÁS', 'symlinkelt `.credentials.json`', 'az érvényes env-tokennel szemben is nyer',
      'SOHA ne másold át másik agent tokenjét vagy credentialjét', 'saját tokent']) {
      expect(b, s).toContain(s)
    }
  })

  it('message-close: notify:false for incoming reports, a JSON boolean, the curl', async () => {
    const b = (await render()).blocks['message-close']
    expect(b).toMatch(/DELEGÁLT FELADAT[\s\S]{0,60}szokásos/)
    expect(b).toMatch(/BEJÖVŐ RIPORT vagy ÉRTESÍTÉS: `"notify":false`/)
    expect(b).toContain('A `notify` JSON boolean: a `"false"` string 400-at kap, és nem zár le.')
    expect(b).toMatch(/curl -s -X PUT \S+\/api\/messages\/<id> /)
    expect(b).toContain(`--data-binary '{"status":"done","notify":false}'`)
  })

  it('mcp-list-channel: do not run it in a channel-owning session; scope, symptom, recovery, doc', async () => {
    const b = (await render()).blocks['mcp-list-channel']
    for (const s of ['csatornát birtokol', 'NE futtasd a `claude mcp list`-et', '`Connected`-et ír és 0-val tér vissza',
      '2026-09-21', 'újraindítása visszahozza', 'hasznos diagnosztika', 'BEJÖVŐ üzenetek sorsát nem mértük',
      '`docs/mcp-list-channel-plugin.md`']) {
      expect(b, s).toContain(s)
    }
  })
})

describe('the moved-out reasoning is reachable and complete', () => {
  it('the two trimmed-story sections point to the rulebook file with an absolute path', async () => {
    const { blocks, PROJECT_ROOT } = await render()
    const ptr = join(PROJECT_ROOT, 'rulebook', 'generalt-szakaszok-indoklas.md')
    expect(blocks['autonomy-wiring']).toContain(`\`${ptr}\``)
    expect(blocks['skills-path-trap']).toContain(`\`${ptr}\``)
  })

  it('the rulebook file exists and keeps the removed stories verbatim', async () => {
    const { PROJECT_ROOT } = await render()
    const f = join(PROJECT_ROOT, 'rulebook', 'generalt-szakaszok-indoklas.md')
    expect(existsSync(f)).toBe(true)
    const doc = readFileSync(f, 'utf-8')
    for (const n of NAMES) expect(doc, n).toContain(`## \`${n}\``)
    for (const s of ['("command not found"), és némán kiesnek a mentett szövegből',
      'KILENC ilyen symlink van, és a gyökérből egy sem látszik',
      'ÉS A KILENCEDIKET A NEVE REJTETTE EL',
      'A másolás auditálhatatlan, és más adatához is hozzáférést ad.']) {
      expect(doc, s).toContain(s)
    }
  })
})

describe('house style and size budget', () => {
  it('no em dash in any of the six blocks', async () => {
    const { blocks } = await render()
    for (const n of NAMES) expect(blocks[n], n).not.toContain('—')
  })

  it('every section stays under its ceiling (install root normalised)', async () => {
    const { blocks, PROJECT_ROOT } = await render()
    const sizes: Record<string, number> = {}
    for (const n of NAMES) sizes[n] = blocks[n].replaceAll(PROJECT_ROOT, '<ROOT>').length
    // CONTROL: the measure sees real blocks, not empty strings
    for (const n of NAMES) expect(sizes[n], n).toBeGreaterThan(400)
    for (const n of NAMES) expect(sizes[n], `${n}: ${sizes[n]} > ${CEILING[n]}`).toBeLessThanOrEqual(CEILING[n])
  })
})

/**
 * A LEMEZ-OR RIASZTASA: A `curl` KILEPESI KODJA NEM VALASZ ARRA, HOGY KIMENT-E.
 *
 * A javitott defektus (kartya 1f0f225f, didi merte a `4be2027c` alatt): az
 * `alert_owner` igy allt ossze --
 *
 *     curl -s -m 10 -o /dev/null ... && log "owner alerted" || log "ALERT ... FAILED"
 *
 * A curl `0`-val ter vissza egy HTTP 400-ra is, tehat a `&&` ag futott, es a naplo azt
 * mondta, hogy a gazda ertesult -- akkor is, ha a Telegram elutasitotta. Ez pontosan az
 * az alak, amit a `4be2027c` a notify.sh-ban mar megszuntetett; csak ez a NAPLOBA
 * hazudott, nem a stdoutra, es EPP ABBAN AZ ORBEN, ami akkor szolal meg, amikor a lemez
 * betelt.
 *
 * MIERT `.test.ts` ES NEM `.test.sh`, HOLOTT MAR VAN EGY SHELL-TESZT E MELLE A SZKRIPT
 * MELLE. Merve (2026-09-04, `npx vitest list`, pozitiv kontrollal):
 *
 *     npx vitest list scripts/__tests__/disk-space-guard.test.sh  ->  SEMMI
 *     npx vitest list src/__tests__/quota-ceiling-guard.test.ts   ->  5+ sor
 *
 * Az `npm test` = `vitest run`, es a vitest alap `include`-ja nem illeszkedik a `.sh`-ra.
 * A 14 `scripts/__tests__/*.test.sh` fajl tehat SOHA nem fut -- ugyanaz a csalad, mint a
 * `27975b85` kartya a `.test.py`-ra. Egy ide irt shell-eset nem proba lenne, hanem diszlet.
 *
 * ES AMIERT A MEGLEVO SHELL-TESZT AKKOR SEM FOGTA VOLNA MEG, HA FUT: mind a kilenc esete
 * `DISK_GUARD_ALERT_DRYRUN=1`-gyel hivja az ort, az pedig az `alert_owner` ELSO soraban
 * visszater. A hibas curl-sort a sajat teszt-keszlete SZERKEZETILEG nem tudta elerni.
 * Ezek a tesztek ezert szandekosan a NORMAL agon futnak, es a curl-t stubboljak.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL_SCRIPT = join(HERE, '..', '..', 'scripts', 'disk-space-guard.sh')

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface CurlBehaviour {
  /** Amit a stub a torzsbe ir (a valodi curl `-w '\n%{http_code}'` ele kerul). */
  body: string
  /** A `%{http_code}` helyere kerulo szoveg. */
  status: string
  /** A stub kilepesi kodja -- rc!=0 = a curl el sem jutott a szerverig. */
  exit?: number
}

interface Run {
  log: string
  /** Igaz, ha a stubbolt curl-t TENYLEG meghivtak (kulonben minden allitas ures halmazon all). */
  curlCalled: boolean
  /** A curl-nek atadott teljes argumentumlista, soronkent. */
  curlArgs: string
  /** Letezik-e a cooldown-belyeg a futas utan. */
  stamped: boolean
}

/**
 * Eldobhato telepites: valodi szkript, valodi /bin/bash, hamis HOME (hogy a valodi
 * bot-tokenhez SOHA ne nyulhasson), es egy PATH-ra tett `curl`-stub, ami rogzit es a
 * kert valaszt adja vissza.
 */
function runGuard(curl: CurlBehaviour, usage = 96): Run {
  const base = mkdtempSync(join(tmpdir(), 'disk-guard-alert-'))
  made.push(base)
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'store'))
  mkdirSync(join(base, 'bin'))
  mkdirSync(join(base, 'scratch'))
  mkdirSync(join(base, 'home', '.claude', 'channels', 'telegram'), { recursive: true })

  writeFileSync(join(base, 'scripts', 'disk-space-guard.sh'), readFileSync(REAL_SCRIPT))
  chmodSync(join(base, 'scripts', 'disk-space-guard.sh'), 0o755)

  // A ket hitelesito forras, amit a szkript olvas -- mindketto HAMIS ertekkel.
  writeFileSync(join(base, '.env'), 'ALLOWED_CHAT_ID=111222333\n')
  writeFileSync(join(base, 'home', '.claude', 'channels', 'telegram', '.env'),
    'TELEGRAM_BOT_TOKEN=000:HAMIS-TOKEN-CSAK-TESZTHEZ\n')

  // A curl-stub. A valodi curl a `-w '\n%{http_code}'` miatt a torzs utan egy soremeléssel
  // kiirja a statuszt -- a stub pontosan ezt az alakot allitja elo, hogy amit a szkript
  // parsol, az ugyanaz legyen.
  const rec = join(base, 'curl-args.txt')
  writeFileSync(join(base, 'bin', 'curl'), [
    '#!/bin/bash',
    `printf '%s\\n' "$@" >> ${JSON.stringify(rec)}`,
    `printf '%s' ${JSON.stringify(curl.body)}`,
    `printf '\\n%s' ${JSON.stringify(curl.status)}`,
    `exit ${curl.exit ?? 0}`,
  ].join('\n') + '\n')
  chmodSync(join(base, 'bin', 'curl'), 0o755)

  const log = execFileSync('/bin/bash', [join(base, 'scripts', 'disk-space-guard.sh')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: join(base, 'home'),
      PATH: `${join(base, 'bin')}:${process.env.PATH}`,
      DISK_GUARD_USAGE_OVERRIDE: String(usage),
      DISK_GUARD_SCRATCH_DIR: join(base, 'scratch'),
      DISK_GUARD_STATE_DIR: join(base, 'store'),
      // SZANDEKOSAN NINCS DISK_GUARD_ALERT_DRYRUN: az rovidre zarna azt a fuggvenyt,
      // amit ezek a tesztek merni akarnak.
    },
  })

  return {
    log,
    curlCalled: existsSync(rec),
    curlArgs: existsSync(rec) ? readFileSync(rec, 'utf8') : '',
    stamped: existsSync(join(base, 'store', '.disk-guard-alerted')),
  }
}

const OK_BODY = '{"ok":true,"result":{"message_id":42}}'

describe('disk-space-guard: a naplo csak akkor mond sikert, ha a Telegram elfogadta', () => {
  it('POZITIV KONTROLL: 200 + ok:true -> sikert naplo ES belyeget ir', () => {
    const r = runGuard({ body: OK_BODY, status: '200' })
    // Enelkul minden lenti allitas kielegitheto lenne egy ollyal is, ami SOHA nem
    // naploz sikert -- ez a sor mondja ki, hogy a mero tud igent is mondani.
    expect(r.curlCalled).toBe(true)
    expect(r.log).toContain('owner alerted via direct Bot API')
    expect(r.log).not.toContain('ALERT sendMessage FAILED')
    expect(r.stamped).toBe(true)
  })

  it('HTTP 400 -> BUKAST naploz, nem sikert (ez a javitott defektus)', () => {
    const r = runGuard({ body: '{"ok":false,"description":"Bad Request: chat not found"}', status: '400' })
    expect(r.curlCalled).toBe(true)
    expect(r.log).toContain('ALERT sendMessage FAILED')
    expect(r.log).not.toContain('owner alerted via direct Bot API')
    // Az OK is bekerul a naploba, kulonben a bukas nem diagnosztizalhato.
    expect(r.log).toContain('HTTP=400')
    expect(r.log).toContain('Bad Request: chat not found')
  })

  it('200 DE ok:false -> szinten BUKAS (ez valasztja szet a fel-javitastol)', () => {
    // A DISZKRIMINALO ESET. Egy javitas, ami CSAK a `%{http_code}`-ot nezi, a masik
    // harom esetet is teljesiti -- ezt nem. A Telegram ad 200-at `ok:false` mellett is,
    // tehat a statusz onmagaban nem valasz arra, hogy kiment-e.
    const r = runGuard({ body: '{"ok":false,"description":"Forbidden: bot was blocked by the user"}', status: '200' })
    expect(r.log).toContain('ALERT sendMessage FAILED')
    expect(r.log).not.toContain('owner alerted via direct Bot API')
    expect(r.log).toContain('ok=0')
  })

  it('a curl EL SEM JUT a szerverig (rc!=0) -> BUKAS, es a naplo megnevezi a curl kodjat', () => {
    // A regi alak ezt is es a 400-at is UGYANANNAK mutatta; a `curl_rc` valasztja szet
    // a "nem ertunk oda" es az "elutasitottak" esetet.
    const r = runGuard({ body: '', status: '000', exit: 6 })
    expect(r.log).toContain('ALERT sendMessage FAILED')
    expect(r.log).toContain('curl_rc=6')
    expect(r.log).not.toContain('owner alerted via direct Bot API')
  })
})

describe('disk-space-guard: egy elbukott riasztas nem hasznalja el az orat', () => {
  it('bukasnal NEM ir cooldown-belyeget, es ezt ki is mondja', () => {
    const r = runGuard({ body: '{"ok":false,"description":"Bad Request: chat not found"}', status: '400' })
    expect(r.stamped).toBe(false)
    expect(r.log).toContain('cooldown stamp NOT written')
  })

  it('sikernel VISZONT ir -- kulonben az ismetlodes-vedelem tunne el', () => {
    // A fenti allitas parja: a "nem ir belyeget" onmagaban egy olyan javitassal is
    // teljesulne, ami SOHA nem ir -- az pedig a cooldownt szuntetne meg.
    const r = runGuard({ body: OK_BODY, status: '200' })
    expect(r.stamped).toBe(true)
    expect(r.log).not.toContain('cooldown stamp NOT written')
  })
})

describe('disk-space-guard: a mero tenyleg a riasztasi utat jarja', () => {
  it('a kuszob ALATT egyaltalan nem hiv curl-t (negativ kontroll az egesz fixture-re)', () => {
    // Ha ez is hivna curl-t, akkor a fenti esetek nem a riasztasrol szolnanak.
    const r = runGuard({ body: OK_BODY, status: '200' }, 50)
    expect(r.curlCalled).toBe(false)
  })

  it('a riasztas a konfigbol vett chat-id-re megy, nem beegetettre', () => {
    const r = runGuard({ body: OK_BODY, status: '200' })
    expect(r.curlArgs).toContain('chat_id=111222333')
    expect(r.log).toContain('post-reap disk 96%')
  })
})

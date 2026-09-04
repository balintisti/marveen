/**
 * LATCHELT LEMEZ-RIASZTAS AZ IDLE-REPORTERBEN (kartya 3cf52601).
 *
 * A 06-03-i incidens MERT kara: *"inbound messages were dropped UNTIL A HUMAN NOTICED"*.
 * A kar a CSEND, nem a takaritas hianya -- ezert ez CSAK RIASZT, es nem torol semmit
 * (a torles kulon kerdes, `0dcf8eef`, Isti dontese).
 *
 * MIERT LATCH, ES MIERT EZ A TESZT LENYEGE. A riasztas Isti TELEFONJARA megy
 * (`idle-reporter.py:24`, `:309-310`), a kadencia 300 masodperc. Latch nelkul egy ALLO
 * 90%+ allapot 12 push/ora -- es egy elnemitott riasztas ugyanaz, mint egy nem letezo.
 * A masik fele, amit el szoktak felejteni, az UJRAFEGYVERZES: nelkule egy
 * telik / kitakaritjak / ujra telik ciklus EGYSZER szol, aztan soha.
 *
 * ES EGY DEFEKTUS, AMIT A MERES FOGOTT MEG, NEM AZ ATOLVASAS (friday, 2026-09-04):
 * az elso valtozatban a NEM MERHETO allapot (`statvfs` hiba -> `None`) ugyanazon az agon
 * ment, mint az EGESZSEGES lemez, tehat TOROLTE a latchot. 93% mellett egy megbicsaklo
 * `statvfs` igy ujrafegyverzett, es a kovetkezo sikeres olvasas ISMET riasztott -- vagyis
 * egy flappelo mero pontosan azt a telefon-spamot termelte volna, ami ellen a latch keszult.
 * A docstring kozben az ELLENKEZOJET allitotta. A 3. eset ezt szegezi le.
 *
 * MIERT `.test.ts` ES NEM `.test.py` / `.test.sh`: az `npm test` = `vitest run`, es annak
 * alap `include`-ja egyikre sem illeszkedik -- a 14 `scripts/__tests__/*.test.sh` fajl
 * SOHA nem fut. Egy ide irt shell- vagy python-eset nem proba lenne, hanem diszlet.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', '..', 'scripts', 'idle-reporter.py')

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'idle-disk-'))
  made.push(d)
  return d
}

function py(body: string): any {
  const d = scratch()
  const f = join(d, 'driver.py')
  writeFileSync(f, `
import importlib.util, json, os, sqlite3, sys, tempfile
spec = importlib.util.spec_from_file_location("ir", ${JSON.stringify(SCRIPT)})
ir = importlib.util.module_from_spec(spec); spec.loader.exec_module(ir)
D = ${JSON.stringify(d)}
${body}
`)
  return JSON.parse(execFileSync('python3', [f], { encoding: 'utf8' }))
}

/** Vegigvezeti a latchot a szazalek-sorozaton, es visszaadja, mely tickek riasztottak. */
function walk(seq: (number | null)[]): { fired: boolean[]; messages: string[] } {
  return py(`
state = os.path.join(D, "state.json")
seq = json.loads(${JSON.stringify(JSON.stringify(seq))})
prev, fired, msgs = {}, [], []
for pct in seq:
    prev, f = ir._maybe_disk_alert(prev, state, lambda m: msgs.append(m), lambda: pct)
    fired.append(bool(f))
print(json.dumps({"fired": fired, "messages": msgs}))
`)
}

describe('idle-reporter lemez-riasztas', () => {
  it('a kuszobok MAGASAN maradnak: 90 / 95', () => {
    // A kartya kimondott kikotese: NE talaljunk ki alacsonyabb "korai figyelmeztetest".
    // Telefonon egy hamis pozitiv ara nem egy naplosor.
    const r = py(`print(json.dumps({"warn": ir.DISK_WARN_PCT, "crit": ir.DISK_CRIT_PCT}))`)
    expect(r.warn).toBe(90)
    expect(r.crit).toBe(95)
  })

  it('allapot-valtasra szol, aztan HALLGAT, amig all', () => {
    const { fired } = walk([50, 91, 92, 93])
    //          50=ok   91=ok->warn   92,93=warn->warn
    expect(fired).toEqual([false, true, false, false])
  })

  it('a warn -> crit KULON esemeny, mert a szint valtozik', () => {
    const { fired, messages } = walk([91, 96, 97])
    expect(fired).toEqual([true, true, false])
    expect(messages[0]).toContain('fogy')
    expect(messages[1]).toContain('MEGTELIK')
  })

  it('a valodi gyogyulas UJRAFEGYVERZI a latchot -- csendben', () => {
    const { fired } = walk([96, 50, 91])
    //          96=riaszt  50=crit->ok CSENDES ujrafegyverzes  91=ISMET riaszt
    expect(fired).toEqual([true, false, true])
  })

  it('a NEM MERHETO allapot nem riaszt ES nem is fegyverez ujra', () => {
    // Ez a megmert defektus: `None` es "egeszseges" egy agon -> a latch torlodott,
    // es egy flappelo `statvfs` minden sikeres olvasasnal ujra riasztott volna.
    const { fired } = walk([93, null, 94, null, 94])
    expect(fired).toEqual([true, false, false, false, false])
  })

  it('OLVASHATATLAN adatbazis mellett IS kimegy -- ott a legfontosabb', () => {
    // Egy megtelt kotet EPP AZT teheti olvashatatlanna, es az az ag korai `return`-nel
    // zarul. Kontrollal: kuszob ALATT ugyanazon az agon NINCS lemez-sor -- kulonben ez
    // az eset akkor is atmenne, ha a szkript mindig kiirna egy lemez-sort.
    const r = py(`
fleet = os.path.join(D, "fleet"); os.makedirs(os.path.join(fleet, "agents"))
bad = os.path.join(D, "bad.db"); open(bad, "w").write("NEM ADATBAZIS")
def once(pct, tag):
    sent = []
    ir.run(now=1000000, send=lambda m: sent.append(m), state_path=os.path.join(D, tag),
           db_path=bad, fleet_root=fleet, out=lambda m: None, disk_pct=lambda: pct)
    return [m for m in sent if "LEMEZ" in m]
print(json.dumps({"full": once(96, "a.json"), "healthy": once(50, "b.json")}))
`)
    expect(r.full).toHaveLength(1)
    expect(r.full[0]).toContain('96%')
    expect(r.healthy).toHaveLength(0)
  })
})

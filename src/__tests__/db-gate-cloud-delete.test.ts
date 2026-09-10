/**
 * A DB-KAPU HARMADIK OSZTALYA: DESTRUKTIV FELHO-MUVELET (kartya 9e3f2f5c, G3 csoport).
 *
 * MIERT KAPU ES NEM DENY-SZABALY. A kartya harom hetet toltott azzal, hogy ezt MERESSEL
 * dontse el, nem velemennyel (jarvis es computress, negy szonda + pozitiv kontroll,
 * 2026-09-06): a `Bash(...)` szabaly LITERALIS ELOTAG a nyers parancs-sztringen, az
 * egyetlen joker a zaro `:*`, es a mintan BELULI `*` a `*` KARAKTERT jelenti. A gcloud
 * destruktiv igeje viszont a parancs VEGEN all (`gcloud run services delete`), tehat egy
 * elotag-minta csak FELSOROLASSAL erne oda -- es amit a felsorolas kihagy, azt CSENDBEN
 * hagyja ki. A kapu barhol illeszt; ezert kerult ide es nem a jogosultsagi listaba.
 *
 * EZ A FAJL SEMMIT NEM HAJT VEGRE. A kapu DONTESI fuggvenyenek szoveget ad at, es a
 * verdiktet olvassa vissza -- ugyanaz a szerzodes, mint a `db-gate-heredoc-scope` specben.
 * Egy destruktiv kapunal a PROBA MAGA a kockazat, ezert egyetlen gcloud parancs sem fut le.
 *
 * A KONTROLLOK NEM DISZEK. Egy or, ami a HELYES megoldast jeloli hibanak, rosszabb a
 * semminel, mert a kezenfekvo javitas az, hogy kiveszik az ort. Ezert all itt az az ot alak,
 * ami az eles `.bash_history`-ban TENYLEG fut (run deploy 39, builds submit 34,
 * config get-value 12, sql connect 7, secrets versions add 1) -- 81 gcloud hivasbol NULLA
 * hordoz onallo `delete`/`destroy` tokent, es az egesz, 532 soros elozmenyen a valtozas
 * NULLA tovabbi megtagadast termel (a regi kapu 15-ot mar megtagadott -> a mero nem vak).
 *
 * ES AMI A KONTROLLOKBOL A LEGFONTOSABB: a `prose inside quotes` es a `commit message`.
 * Az elso `echo "gcloud ... delete x"` alak MAGATOL is atmegy, mert a CLI-mintanak szokoz
 * (vagy sor-eleje) kell a `gcloud` ele, es ott egy idezojel-KARAKTER all -- vagyis az a
 * teszt VELETLENUL zold, nem a parancs-pozicio miatt. A mutacios probaval derult ki:
 * a `cmdpos` -> `segment` mutacio TULELTE. Ez a ketto az, amelyik tenyleg diszkriminal.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

/** A kapu DONTESI fuggvenye egy parancs-SZOVEGRE. Nem hajt vegre semmit. */
function blocks(command: string): boolean {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps(bool(g.find_hits(json.loads(sys.stdin.read())))))
`
  const out = execFileSync('python3', ['-c', driver], { input: JSON.stringify(command), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

describe('db-destructive-gate: destruktiv felho-muvelet (G3)', () => {
  it('Cloud Run szolgaltatas torlese BLOKKOLVA', () => {
    expect(blocks('gcloud run services delete crm-backend --region europe-west1')).toBe(true)
  })

  it('titok-verzio megsemmisitese BLOKKOLVA -- a `destroy` ige is szamit', () => {
    expect(blocks('gcloud secrets versions destroy 3 --secret=database-url')).toBe(true)
  })

  it('SQL peldany torlese BLOKKOLVA', () => {
    expect(blocks('gcloud sql instances delete crm-prod')).toBe(true)
  })

  it('az ige a parancs VEGEN all, es ez a lenyeg: egy elotag-minta ide nem er el', () => {
    expect(blocks('gcloud compute instances delete runner-1 --quiet')).toBe(true)
  })

  it('objektum-torles, ami a `delete` szot SOHA nem tartalmazza', () => {
    expect(blocks('gcloud storage rm -r gs://crm-uploads')).toBe(true)
    expect(blocks('gsutil -m rm -r gs://crm-uploads/**')).toBe(true)
  })

  it('sor-folytatas: a `\\`+sortores EGY parancs, nem ketto', () => {
    expect(blocks('gcloud run services \\\n  delete crm-backend')).toBe(true)
  })

  it('ugyanez a TOOL-osztalyra is -- a folytatas-osszevonas MINDEN osztalyt szigorit', () => {
    expect(blocks('npx prisma migrate \\\n  reset --force')).toBe(true)
  })

  it('vegrehajtott heredocban is', () => {
    expect(blocks("bash <<'EOF'\ngcloud run services delete crm-backend\nEOF")).toBe(true)
  })

  it('szegmens-hatar utan is (a `cd x && ...` alak)', () => {
    expect(blocks('cd /tmp && gcloud run services delete crm-backend')).toBe(true)
  })

  // === KONTROLLOK: ami az eles elozmenyben TENYLEG fut, annak at kell mennie =========

  it('KONTROLL: az ot valodi alak MIND atmegy (81 gcloud hivasbol 0 destruktiv)', () => {
    expect(blocks('gcloud run deploy crm-backend --source . --region europe-west1')).toBe(false)
    expect(blocks('gcloud builds submit --tag gcr.io/proj/crm-backend')).toBe(false)
    expect(blocks('gcloud config get-value project')).toBe(false)
    expect(blocks('gcloud sql connect crm-prod --user=postgres')).toBe(false)
    expect(blocks('gcloud secrets versions add database-url --data-file=-')).toBe(false)
  })

  it('KONTROLL: PROZA egy idezojeles argumentumban ATMEGY -- ez a parancs-pozicio proba', () => {
    // Ez az a ket alak, ami tenyleg diszkrimial: szokoz all a `gcloud` elott, tehat a
    // nyers szegmensre illeszkedne. Csak a kiuresitett idezojel-tartalom menti meg.
    expect(blocks('echo "run: gcloud run services delete x"')).toBe(false)
    expect(blocks('git commit -m "drop the gcloud run services delete step"')).toBe(false)
  })

  it('KONTROLL: kotojeles TOKEN nem ige -- `\\b` itt hamis pozitivot adna', () => {
    expect(blocks('gcloud storage rsync a gs://b --delete-unmatched-destination-objects')).toBe(false)
    expect(blocks('gcloud run services list --filter=delete-me')).toBe(false)
    expect(blocks('gcloud run services update crm --remove-env-vars=FOO')).toBe(false)
  })

  it('KONTROLL: olvaso muveletek atmennek', () => {
    expect(blocks('gcloud run services describe crm-backend --format=json')).toBe(false)
    expect(blocks('gcloud --version')).toBe(false)
    expect(blocks('which gcloud')).toBe(false)
  })

  it('KONTROLL: a proza-heredoc tovabbra is ATMEGY (a v1 elso hamis pozitivja)', () => {
    expect(blocks("cat > notes.md <<'EOF'\ngcloud run services delete x\nEOF")).toBe(false)
  })

  it('KONTROLL: gcloud NELKUL a `rm` nem ennek a kapunak a dolga', () => {
    expect(blocks('rm -rf node_modules && npm ci')).toBe(false)
  })

  // === A BOVITES: gh es kubectl (marveen rendelkezese, ugyanaznap) ==================
  //
  // Az elso valtozat SZANDEKOSAN kihagyta oket ("ez a kartya gcloudot mert es mast
  // nem"). marveen megforditotta, es az erve az, amire ez az egesz osztaly epul: a
  // deny-lista elleni kifogas az volt, hogy egy CSALAD-FELSOROLAS-bol ki lehet
  // felejteni valamit CSENDBEN. Harom NEVESITETT csaladot kihagyni egy szabalybol,
  // aminek az ALAKJA amugy is fedi oket, ugyanaz a hiba, tobb lepesben.

  it('gh repo delete BLOKKOLVA', () => {
    expect(blocks('gh repo delete balintisti/valami --yes')).toBe(true)
  })

  it('kubectl delete BLOKKOLVA', () => {
    expect(blocks('kubectl delete pod api-7d9f --namespace prod')).toBe(true)
  })

  it('gh api -X DELETE is -- az ige NAGYBETUS es nem alparancs', () => {
    expect(blocks('gh api -X DELETE repos/o/r/actions/caches/12')).toBe(true)
  })

  it('gh secret set BLOKKOLVA, PEDIG NINCS BENNE DESTRUKTIV IGE', () => {
    // Ez az egyetlen minta, ami nem torlesre szol. didi a kartyat inditó leletben
    // NEVESITETTE a `Bash(gh secret:*)`-ot, a `sudo rm` es a `gcloud` mellett. Egy
    // CI-kredencialt ir felul helyben: a parancsban sehol nem all az, hogy `delete`,
    // tehat MINDEN masik minta vak ra, es a kar egy hibas config-gal futo pipeline.
    expect(blocks('gh secret set DATABASE_URL --body xxx')).toBe(true)
  })

  it('KONTROLL: a `gh secret` OLVASO alakjai atmennek', () => {
    // A `set`-minta szandekosan szuk. Ha ez a ketto pirosra valtana, a minta
    // `gh secret`-re szelesedett, es a kapu egy listazast tiltana.
    expect(blocks('gh secret list')).toBe(false)
    expect(blocks('gh secret list --repo balintisti/marveen')).toBe(false)
  })

  it('KONTROLL: a lap SAJAT gh-receptjei atmennek', () => {
    // A szabalykonyv a push elotti CI-perc-ellenorzest ezzel az alakkal irja elo.
    // Ha ez elbukik, a kapu a sajat dokumentalt szokasunkat tiltja meg -- pontosan
    // az az alak, amit ez a lap "a helyes megoldast jeloli hibanak" neven tilt.
    expect(blocks('gh pr list --state open --head fix/abc')).toBe(false)
    expect(blocks('gh pr create --title Fix --body Text')).toBe(false)
    expect(blocks('gh run watch 12345')).toBe(false)
    expect(blocks('kubectl get pods -n prod')).toBe(false)
  })

  it('KONTROLL: kotojeles cimke a gh mellett sem ige', () => {
    expect(blocks('gh issue list --label delete-me')).toBe(false)
  })

  it('KONTROLL: idezojelben a gh-alak is proza marad', () => {
    expect(blocks('echo "run: gh repo delete x"')).toBe(false)
    expect(blocks('git commit -m "drop the gh repo delete step"')).toBe(false)
  })

  // === A DB-OSZTALYOK VALTOZATLANOK =================================================

  it('REGRESSZIO: a DB-osztalyok verdiktje nem valtozott', () => {
    expect(blocks('psql -d crm -c \'DROP TABLE IF EXISTS "FormField" CASCADE;\'')).toBe(true)
    expect(blocks('npx prisma migrate reset --force')).toBe(true)
    expect(blocks('psql -d x -c \'SELECT count(*) FROM "Task";\'')).toBe(false)
  })
})

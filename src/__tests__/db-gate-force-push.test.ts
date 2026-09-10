/**
 * A DB-KAPU NEGYEDIK OSZTALYA: FORCE-PUSH (kartya 9e3f2f5c, G2 csoport; 733acbc3).
 *
 * MIERT KAPU, AMIKOR ITT A DENY-LISTA MUKODIK. A G3-nal (felho-CLI) a deny-lista
 * SEMMIT nem tudott: az ige a parancs VEGEN all. Itt MAS a helyzet, es epp ezert
 * konnyebb felreerteni: a harom szabaly KOT is, csak ott, ahol a kapcsolo ritkan all.
 * computress negy szondaja (2026-09-06, pozitiv kontrollal) mérte meg a szemantikat:
 * a `:*`-ra vegzodo minta LITERALIS ELOTAG, a `:*` NELKULI PONTOS egyezes. A harom
 * elo szabaly ezert ezt fedi:
 *
 *     Bash(git push --force)      pontos  -> a CSUPASZ `git push --force`
 *     Bash(git push --force :*)   elotag  -> `git push --force origin main`
 *     Bash(git push -f:*)         elotag  -> `git push -f ...`
 *
 * MINDHAROM KOZVETLENUL a `push` UTAN horgonyozza a kapcsolot. A szokasos alak nem:
 * `git push fork feat/x --force` egyikre sem illeszkedik. Ezt a korlatot dexter maga
 * irta a kartyara 2026-09-10 16:07-kor, didi pedig fuggetlenul ujramerte 16:56-kor
 * (`git push origin main --force` -> rc=0, atengedve). Ez a spec azt zarja.
 *
 * ES A CSAPDA, AMIT MARVEEN NEVEZETT MEG A RENDELKEZESBEN: a G3 osztaly token-hatara
 * (`(?<![\w-])X(?![\w-])`) IDE NEM MASOLHATO. Az a lookbehind pont azert van, hogy a
 * `--delete-labels` NE illeszkedjen -- egy FLAG viszont pontosan ilyen alaku, a `force`
 * elott ott all a kotojel. Aki a konvenciot atveszi, olyan mintat kap, ami leforditodik,
 * helyesnek olvasodik, atmegy a review-n es SOHA NEM TUZEL. A `--force-with-lease`
 * kontroll ezert nem disz: az a hatar masik fele, es a BIZTONSAGOS alaknak at KELL mennie.
 *
 * EZ A FAJL SEMMIT NEM HAJT VEGRE -- se pusht, se mast. A kapu DONTESI fuggvenyenek
 * szoveget ad at es a verdiktet olvassa vissza, ugyanaz a szerzodes, mint a
 * `db-gate-cloud-delete` es a `db-gate-heredoc-scope` specekben.
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

describe('db-destructive-gate: force-push (G2)', () => {
  it('A RES MAGA: a kapcsolo az ARGUMENTUMOK UTAN -- egyetlen deny-szabaly sem eri el', () => {
    expect(blocks('git push fork feat/x --force')).toBe(true)
  })

  it('a kartyan kimondott korlat, amit didi 16:56-kor rc=0-val mert', () => {
    expect(blocks('git push origin main --force')).toBe(true)
  })

  it('a csupasz alak is -- a deny-lista fedi, a kapu megis mondja ki', () => {
    // Redundans a `Bash(git push --force)` pontos szabalyaval, SZANDEKOSAN: a deny-lista
    // sessionfuggo (be kell toltodnie), a hook KOD, es minden modban fut.
    expect(blocks('git push --force')).toBe(true)
  })

  it('rovid alak, onalloan es a vegen is', () => {
    expect(blocks('git push -f')).toBe(true)
    expect(blocks('git push fork feat/x -f')).toBe(true)
  })

  it('CSOPORTOSITOTT rovid kapcsolo: -fu = -f + -u', () => {
    expect(blocks('git push -fu origin main')).toBe(true)
    expect(blocks('git push -uf origin main')).toBe(true)
  })

  it('a `+<src>:<dst>` refspec -- git sajat force-alakja, a `force` szo NELKUL', () => {
    expect(blocks('git push origin +main:main')).toBe(true)
    expect(blocks('git push fork +refs/heads/x:refs/heads/x')).toBe(true)
  })

  it('a kapcsolo az argumentumok ELOTT is, es kozottuk is', () => {
    expect(blocks('git push --no-verify fork feat/x --force')).toBe(true)
    expect(blocks('git push -q fork feat/x -f')).toBe(true)
  })

  it('globalis opcio az alparancs elott (`git -C <ut> push`)', () => {
    expect(blocks('git -C /Users/isti/marveen push fork feat/x --force')).toBe(true)
  })

  it('szegmens-hatar utan is', () => {
    expect(blocks('cd /Users/isti/marveen && git push fork feat/x --force')).toBe(true)
  })

  it('sor-folytatas: a `\\`+sortores EGY parancs', () => {
    expect(blocks('git push fork feat/x \\\n  --force')).toBe(true)
  })

  it('vegrehajtott heredocban is', () => {
    expect(blocks("bash <<'EOF'\ngit push fork feat/x --force\nEOF")).toBe(true)
  })

  // === KONTROLLOK ===================================================================
  // Egy or, ami a HELYES megoldast jeloli hibanak, rosszabb a semminel: a kezenfekvo
  // javitas az, hogy kiveszik az ort. Az alabbi ket csoport a MERT valosag: a termelesi
  // checkout `.bash_history`-jaban (567 sor) a `git push` MIND A NEGY elofordulasa
  // `git push -u origin main`, es ugyanabban a fajlban 2 sor visel csupasz `--force`-ot
  // (npm) es 9 sor `f`-et tartalmazo rovid kapcsolot (`rm -rf`). Ha a szabaly nem lenne
  // a push-szegmensre szukitve, tizenegy sor rendes munkat tagadna meg az elso napon.

  it('KONTROLL: a rendes push atmegy -- ez a MERT valodi alak, 4/4 az elozmenyben', () => {
    expect(blocks('git push -u origin main')).toBe(false)
    expect(blocks('git push fork feat/x')).toBe(false)
    expect(blocks('git push fork HEAD:refs/heads/feat-x')).toBe(false)
  })

  it('KONTROLL: a BIZTONSAGOS valtozat atmegy -- ez a token-hatar masik fele', () => {
    // Ha ez pirosra valt, a mintaba `\b`-szeru hatar kerult, es a kapu a biztonsagos
    // alakot tiltja meg, vagyis a veszelyes fele terel.
    expect(blocks('git push --force-with-lease')).toBe(false)
    expect(blocks('git push --force-with-lease=main fork feat/x')).toBe(false)
    expect(blocks('git push --force-with-lease --force-if-includes fork x')).toBe(false)
  })

  it('KONTROLL: `f`-et tartalmazo, de nem force kapcsolok', () => {
    expect(blocks('git push --follow-tags fork main')).toBe(false)
    expect(blocks('git push --set-upstream fork feat/x')).toBe(false)
    expect(blocks('git push --no-verify fork feat/x')).toBe(false)
  })

  it('KONTROLL: a `+` egy MASIK ertek belsejeben nem refspec', () => {
    // Ez a kontroll UTOLAG kerult ide, es a mutacios kor kerte: a refspec-minta
    // `(?<!\S)` horgonyat kivéve MIND A 22 spec zold maradt -- vagyis a horgony
    // ALLITAS NELKUL allt. Ez az az alak, amiert letezik: a `+` csak akkor nyit
    // refspecet, ha o kezd egy argumentumot.
    expect(blocks('git push --push-option=ci.var=A+B:C fork main')).toBe(false)
  })

  it('KONTROLL: a tavoli ag torlese RENDES KARBANTARTAS, nem ennek a kapunak a dolga', () => {
    expect(blocks('git push --delete fork feat/old')).toBe(false)
    expect(blocks('git push fork :feat/old')).toBe(false)
  })

  it('KONTROLL: a force-alak MAS git-alparancson nem ennek a kapunak a dolga', () => {
    // `git fetch --force` a HELYI refeket frissiti eroszakkal; a tiltas a PUSH-ra szol.
    // Ha ez pirosra valt, a `push`-feltetel kiesett a szabalybol.
    expect(blocks('git fetch --force fork')).toBe(false)
    expect(blocks('git checkout -f main')).toBe(false)
    expect(blocks('git clean -fd')).toBe(false)
  })

  it('KONTROLL: a szegmens-hatar szetvalaszt -- a `rm -rf` nem a push argumentuma', () => {
    expect(blocks('git push fork feat/x && rm -rf node_modules')).toBe(false)
    expect(blocks('git push fork feat/x; npm run dev -- --force')).toBe(false)
  })

  it('KONTROLL: a `--force` git NELKUL nem ennek a kapunak a dolga (2 mert sor)', () => {
    expect(blocks('npm run dev -- --force')).toBe(false)
    expect(blocks('npm run start:dev -- --force')).toBe(false)
    expect(blocks('rm -rf node_modules package-lock.json')).toBe(false)
  })

  it('KONTROLL: PROZA egy idezojeles argumentumban ATMEGY -- a parancs-pozicio proba', () => {
    // Ez a diszkriminalo kontroll: szokoz all a `git` elott, tehat a nyers szegmensre
    // illeszkedne. Csak a kiuresitett idezojel-tartalom menti meg.
    expect(blocks('git commit -m "drop the git push --force step"')).toBe(false)
    expect(blocks('echo "never run git push --force on main"')).toBe(false)
    expect(blocks("grep -rn 'git push --force' scripts/")).toBe(false)
  })

  it('KONTROLL: a proza-heredoc atmegy (a v1 elso hamis pozitivja, ugyanaz az alak)', () => {
    expect(blocks("cat > notes.md <<'EOF'\ngit push fork feat/x --force\nEOF")).toBe(false)
  })

  it('KONTROLL: olvaso git-muveletek', () => {
    expect(blocks('git status')).toBe(false)
    expect(blocks('git log --oneline -5')).toBe(false)
    expect(blocks('git rev-list --count HEAD --not --remotes=fork')).toBe(false)
  })

  // === A HAROM REGI OSZTALY VALTOZATLAN ============================================

  it('REGRESSZIO: a DB- es CLOUD-osztalyok verdiktje nem valtozott', () => {
    expect(blocks('gcloud run services delete crm-backend --region europe-west1')).toBe(true)
    expect(blocks('gh secret set DATABASE_URL --body xxx')).toBe(true)
    expect(blocks('npx prisma migrate reset --force')).toBe(true)
    expect(blocks('gcloud run deploy crm-backend --source .')).toBe(false)
    expect(blocks('psql -d x -c \'SELECT count(*) FROM "Task";\'')).toBe(false)
  })
})

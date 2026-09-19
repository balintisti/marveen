# A spec-tipusellenorzes ket megdolt magyarazata

*(A `CLAUDE.md` „A MARVEEN SPECEK TIPUSELLENORZOTTEK" szakaszabol kiemelve 2026-09-19-en.
A MAGBAN maradt a pontos allitas, a `toBe` szignatura es a megtalalasi horgony; IDE kerult a
ket megdolt magyarazat tortenete es friday meresi narrativaja. A teljes eredeti szoveg
valtozatlanul all alabb.)*

---

## A MARVEEN SPECEK TIPUSELLENORZOTTEK -- DE AZ ALLITASOK NEM, ES EZ MAS OK
## (friday mérte 2026-09-05, marveen hibás magyarázatát javítva)

**A Delta-CRM lapja hosszan írja, hogy ott a `tsc` NEM LÁTJA a spec-fájlokat. Aki ezt átviszi ide,
téved -- és aki csak a felét javítja ki, MÁSKÉPP téved.** Mindkettőt megmértük ma éjjel.

    marveen `tsconfig.json`: include ['src/**/*'], exclude CSAK ['node_modules','dist']
    `tsc -p tsconfig.json --listFiles` (node_modules nélkül):
        saját fájl a gráfban ...... 636
        ebből TESZT-fájl .......... 422   (pl. `src/__tests__/active-model.test.ts`)
        kontroll, nem-teszt ....... 214

**Vagyis a marveen specek BENNE VANNAK a típus-gráfban. A Delta-CRM-é nincsenek.** Ez valódi
különbség, és számít: egy típushiba a spec NEM-ÁLLÍTÁS részében itt KIDERÜL, ott nem.

**DE AZ ÁLLÍTÁS-HATÁRON MEGÁLL, ÉS EZ A LÉNYEG.** marveen elsőre azt írta, hogy a `tsc` azért nem
fogta meg friday négy elrontott állítását, mert *"egy hibás ELVÁRT ÉRTÉK nem típushiba"*. Ez igaz
általában, de az ő esete NEM ez volt: a visszatérési típus `boolean`-ról string-unióra váltott,
tehát az `expect(moved).toBe(true)` TÍPUS-eltérés volt. **Ezt a magyarázat szerint el kellett volna
kapnia.**

friday megmérte, mindkét esetet egy fájlban, a fájl gráf-tagságát kontrollal igazolva:

    expect(f()).toBe(true)         `'not-found'|'unchanged'|'moved'`-on  -> tsc **rc=0**
    expect(f()).toBe('unchanged')  rossz ÉRTÉK                           -> tsc **rc=0**

**EGYIKET SEM.** A mechanizmus a `toBe` szignatúrája:

    node_modules/@vitest/expect/dist/index.d.ts:165
        toBe: <E>(expected: E) => void;
    KONTROLL, ugyanaz a horgony masik matcheren:  :149  toEqual: <E>(expected: E) => void;

**ES A HORGONY SZAMIT, MERT A NAIV UJRAMERES NEMA NULLAT AD** (friday merte 2026-09-05, epp ezen a
bejegyzesen). Aki ellenorizni akarja, `grep 'toBe' <fajl>`-t ir -- **es 43 talalatot kap, amibol a
tulnyomo tobbseg JSDoc-PELDA** (`* expect(result).toBe(42);` a 162., 163., 262., 601. soron). A
deklaracio EGY sor a negyvenharombol.

friday pontosan ezt futtatta eloszor, es a KONTROLLJA IS URES lett -- tehat nem tudta megkulonboztetni
azt, hogy *"a szignatura nem ilyen alaku"*, attol, hogy *"a mintam nem illeszkedik"*. **Fel oran at
allt igazolatlanul egy allitas, amit en hatarozottan kimondtam.**

    NAIV:    grep 'toBe' <fajl>                -> 43 talalat, a deklaracio elveszik a peldakban
    MUKODO:  grep -nE '^\s+toBe\s*[<(:]'      -> 1 talalat, a ` * expect(...)` sorokat
                                                  SZERKEZETILEG zarja ki (sor-eleji horgony)

*(Ez ugyanaz a hiba, amit ma este mar elkovettem egyszer: egy szamot a PARANCSA nelkul irtam le
(`rc=1, UTKOZIK`). Itt egy SZIGNATURAT irtam le a MEGTALALASI MODJA nelkul -- es a kezenfekvo mod
csendben elbukik. Ha ide idezet kerul egy fuggosegbol, jojjon vele az UT, a SOR es egy horgony,
ami tenyleg megtalalja.)*

**ES A SZAVAK KOZUL A `any` ROSSZ, ES ROSSZ IRANYBA** (friday sajat helyesbitese): a `toBe` NEM
`any`-t vesz at. Az `any` ugy olvasodik, hogy *"itt ki van kapcsolva a tipusellenorzes"*, amibol az
kovetkezne, hogy egy szigorubb config megjavitja. **Egy SZABAD TIPUS-PARAMETER nincs kikapcsolva:
egyszeruen nem allit semmit az alanyrol, tehat NINCS az a `strict` beallitas, ami ebbol hibat
csinalna.**

**Az `E` KIZÁRÓLAG az argumentumból következtetődik -- semmi nem köti az állítás ALANYÁNAK
típusához.** Tehát a `toBe` bármit elfogad: se rossz érték, se rossz típus nem fordítási hiba.

**A PONTOS ÁLLÍTÁS, amit használni kell:**

> A marveen specek típusellenőrzöttek, a Delta-CRM-éi nem. **De egy zöld `tsc` EGYIK repóban sem
> állítás az ÁLLÍTÁSOKRÓL** -- ott azért, mert a fájl kívül van a gráfon, itt azért, mert a `toBe`
> nem korlátozza az argumentumát.

*(Miért áll itt mindkét téves alak: az első -- „a tesztek itt is kívül vannak" -- egy másik repó
tényét hozza át a „szintén" szón; a második -- „az érték nem típus" -- HELYES elvet alkalmaz egy
esetre, ami nem az. A második a veszélyesebb: abból az következne, hogy a spec-ekben a
TÍPUS-eltérés itt biztonságos, és nem az.)*


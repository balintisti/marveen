

<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:23 (kartya 2028900e) -->
### Progressive disclosure (token-hatékony betöltés)
A skill-ek 3 szinten töltődnek:
- **Level 0**: Csak név + leírás (~100 szó) -- mindig elérhető
- **Level 1**: Teljes SKILL.md tartalom -- csak ha releváns
- **Level 2**: Segédfájlok (scripts/, references/) -- csak ha specifikusan kell

Tartsd a SKILL.md-t 500 sor alatt. Nagyobb anyagot tegyél `references/` almappába.

**DE A 500 NEM MINDEN SKILLRE AZ ÉRVÉNYES KAPU, ÉS EZ 2026-08-24-ig nem állt itt** (didi mérte,
marveen újramérte). A `scripts/skill-index.sh` **két rezsimet** használ, és a saját összegző sora
(az összegző `echo`, ami a `MERET-OR: minden skill a sajat hatara alatt` sorral kezdődik -- SORSZÁMOT szándékosan nem írunk ide: a `:249` 2026-08-23-án pontos volt, ma nem, és egy sorszám mindig mutat VALAMIRE) ki is mondja:

| skill | mi kapuzza |
|---|---|
| **alapvonal nélküli** (a legtöbb) | `SKILL_LINE_LIMIT` = **500** |
| **alapvonalas** (ma egy: `felderites-ket-listas-proba`) | a NÖVEKEDÉS: alapvonal + `SKILL_GROWTH_LIMIT`, plusz a kemény `SKILL_HARD_LIMIT` = 600 |

**ÉS A `references/` SZÁNDÉKOSAN NINCS KAPUZVA -- MÉRT INDOKKAL, MERT KÜLÖNBEN VALAKI „RENDBE TESZI"**
(friday mérte 2026-09-03, marveen nyitva hagyott kérdésére).

A `references/` populáció ma **11 fájl / 8498 sor**, a legnagyobb egymaga **5582** -- miközben a
magja 424 soron áll, 15 soros növekedés-kerettel. A kézenfekvő reflex kapuzni. **Ne.**

A kérdés az volt, hogy a `references/` BETÖLTŐDIK-E a maggal együtt. Ha igen, az a 8498 sor nem
súlyozatlan, hanem MÉRT ÉS ELREJTETT -- ami rosszabb. Megmérve, nem levezetve: egy 347 soros
referenciával rendelkező skill meghívva ->

    megérkezett .... a MAG, 483 sor
    megérkezett .... NULLA referencia-sor, csak MUTATÓK (`-> references/alakok.md`)

**A Level 2 tényleg halaszt.** A 8498 sor tehát súlyozatlan és NEM betöltött. Egy 5582 soros
referencia nem baj, ha alapból semmi nem tölti be -- a kérés ezért LÁTHATÓSÁG volt, nem határ, és a
mérleg-sor ezt írja ki (`MERLEG: mag ... | references ... (NEM kapuzott -- merve halaszt, Level 2)`).

*(A mérés ára maga a bizonyíték: 483 sor. Ha a referenciák betöltődtek volna, azt is kifizeti, és
AZ a fizetés lett volna a válasz.)*

**AMI TOVÁBBRA IS MÉRETLEN, és külön kártya, ha valaki akarja:** hogy egy `references/` fájlt
ELOLVAS-e valaha bárki. A mérés a BETÖLTÉSRŐL szól, nem a HASZNÁLATRÓL. Egy 8498 soros törzs, amit
senki nem tölt be, olcsó; amit senki nem tölt be ÉS senki nem olvas el, holt teher -- de ahhoz
másik mérőeszköz kell, és ma nincs.

**ÉS EGY BONTÁS UTÁN A ZÖLD ŐR KÉT DOLGOT JELENTHET, AMIK BÁJT-AZONOSAK:** hogy a skill kisebb lett,
vagy hogy sorok ÁTKERÜLTEK a súlyozatlan populációba. A `context-guard-restart-recovery` 2026-09-03-i
bontásánál a mag 503 -> 436 ment, a references 0 -> 108, és az őr `rc=3` -> `rc=0`. **A bontás
helyes volt és elő van írva; a zöld utána mégsem méret-csökkenés.** Ezért kell a mérleg-sor: enélkül
a „minden skill a határa alatt" mondat a MAGOKRÓL szól, és aki idézi, többet állít.

Mérve, nem kódból levezetve: `SKILL_LINE_LIMIT=400` mellett három skill tüzelt (450, 498, 499
sor), az alapvonalas 499 soros fájl **nem**. Ugyanaz a szám, ellentétes verdikt.

**Miért van két rezsim, és miért helyes:** egy fájlra, ami MÁR a limit fölött van, a „legyél 500
alatt" nem lezárható jelzés, tehát minden körben újra tüzel és zajjá válik. A növekedés-kapu
viszont lezárható: „ne legyen rosszabb".

**AMI VISZONT DEFEKTUS, ÉS AMIT KI KELL MONDANI: BONTÁS UTÁN AZ ALAPVONALAT ÚJRA KELL ÁLLÍTANI.**
Aznap didi 549 → 491-re vágta a fájlt, az alapvonal viszont 513 maradt (08-23-i mérésből). Ezzel a
bontás 58 soros nyeresége **növekedési keretté** vált: a fájl 528-ig nőhetett volna hang nélkül, és
öt órán belül 510-en állt. A bontás így nem a nyereséget rögzítette, hanem helyet csinált az
újranövésnek. Ugyanaz a néma alak, mint mindenhol máshol ezen a lapon: az őr zöldet mond, miközben
azt bontják vissza, amit véd.
**ÉS A BONTÁS SORRENDJE: ÁLLÍTS, AZTÁN TÖRÖLJ -- FORDÍTVA AZ ÁLLÍTÁS SEMMIT NEM ÉR** (friday
fogalmazta meg, 2026-09-04, öt átmozgatott soron alkalmazva).

Mindegyik átmozgatott sorra ÁLLÍTOTTA az archívumbeli meglétet, MIELŐTT törölte a magból -- amelyik
megbukik az asserten, azt nem törli.

    ELŐTTE állítva ... „ott van-e már?" -> egy NEM megállítja a törlést
    UTÁNA állítva .... „megmaradt-e?"   -> MÁSIK kérdés, és mindig IGENT ad

**Az utólagos ellenőrzés arról szól, ami túlélt, nem arról, ami elveszhetett** -- ezért néz ki
mindig jónak. Ugyanaz a törvény, mint a mutációnál: a próba a művelet ELŐTT dönt, nem utána.

*(És a bontás egészére van egy egysoros cáfolata a „ez vágás volt" vádnak: mag + archívum EGYÜTT
NŐTT (6215 -> 6255 sor). Egy vágás csökkenti. Ez nem igényli, hogy bárki megbízzon a bontóban.)*

**A szabály: minden sikeres `references/` bontás után az alapvonal a bontás utáni mért méret ÉS a
RÉGI alapvonal MINIMUMA lesz.** A nyereséget a kapu rögzíti, nem az emlékezet.

**A `MINIMUM` szó 2026-08-27-én került ide, és mért defektus-javítás** (friday találta, miközben
betartotta volna a szabályt, és észrevette, hogy a betartása rontana). A korábbi alak -- „az
alapvonal a bontás utáni mért méret lesz" -- csak arra az esetre volt igaz, amiből született: ott
a bontás az alapvonal ALÁ vitt (549 -> 491, alapvonal 513). Fordítva viszont **tágít**:

    felderites-ket-listas-proba:  bontás után 495, alapvonal 491
    a szabály betűje szerint:     alapvonal := 495   -> a plafon 506-ról 510-re EMELKEDIK
    vagyis egy sikeres bontás egy TÁGABB kaput hagyott volna maga után

Egy alapvonal **racsni**: csak szorulhat. A régi mondat a MECHANIZMUST írta le („állítsd a mért
méretre") a SZÁNDÉK helyett („a kapu soha ne táguljon"), és a mechanizmus pontosan abban az
esetben volt helyes, amiben megfogalmazták. Ez ugyanaz az alak, mint bárhol máshol ezen a lapon,
csak magán a lapon.

**ÉS A MÁSIK FELE, KÜLÖNBEN A RACSNI TILALOMMÁ VÁLIK.** A `MINIMUM` azt zárja ki, hogy a kapu
MELLÉKHATÁSKÉNT táguljon. Azt NEM zárja ki, hogy tudatosan tágítsuk. A kettő különbsége nem a
szám, hanem hogy le van-e írva, MIÉRT:

- **Bontás mellékhatásaként soha.** Egy `references/` kiköltöztetés nyereség, nem keret.
- **Kimondott döntéssel igen**, ha a fájl VALÓDI új tartalommal nőtt (egy új mért alak, nem
  átfogalmazás). Ilyenkor az alapvonal az új mért méret lesz, és a kártyán ott az indok.

Enélkül az őr minden körben tüzelne egy jogos növekedésre, és pár kör után zajjá válna -- vagyis
ugyanaz történne vele, amit a növekedés-kapu épp megelőzni hivatott. Egy tartósan tüzelő őr és egy
kikapcsolt őr között nincs gyakorlati különbség; az elsőhöz csak hozzászoknak.

*(Mért példa, 2026-08-27: a `felderites-ket-listas-proba` bontás után 495 soron állt, 491-es
alapvonal mellett, mert közben egy valódi 12. alak került bele. A `+4` helyes tüzelés volt, és a
helyes válasz nem a bontás visszacsinálása, hanem az alapvonal kimondott emelése 495-re.)*

**ÉS A BONTÁS MÁSIK KOCKÁZATA, AMIT A MÉRET-KAPU SZERKEZETILEG NEM LÁT: A KONDENZÁLT MAG
ELDOBHATJA A TEHERHORDÓ MONDATOT** (jarvis mérte, 2026-08-27 19:08, néhány perccel egy bontás
után).

Egy `references/`-bontás után jarvis végigmérte, hogy a kimondott három követelmény megvan-e a
KÉSZ szövegben:

    a lelet mechanizmusa ........ megvan, magban ÉS references-ben
    a két mért szám (1 -> 2) .... megvan, mindkét helyen
    a MONDAT, ami a leletet egy MÁSIK lap törvényéhez köti ... CSAK a references-ben

A bontás kondenzált magot hagyott, és épp az az egy mondat esett ki, amelyik a két lapot
összeköti -- vagyis az, amitől az olvasó FELISMERI, hogy ismerős alakról van szó. A `references/`
technikailag megőrizte; a gyakorlatban viszont a magot olvassák, a referenciát csak az, aki már
tudja, hogy oda kell néznie.

**A méret-kapu csak a SORSZÁMOT látja. Azt nem, hogy a rövidítés MELYIK mondatot dobta el** -- és
egy bontás után a fájl kisebb, a kapu zöld, tehát semmi nem jelzi, hogy a mag közben elveszítette
a fogást.

**A szabály:** minden `references/`-bontás után olvasd el a MAGOT ÖNMAGÁBAN, és kérdezd meg, hogy
a lelet így is FELISMERHETŐ-e. A teherhordó mondat -- ami a mechanizmust vagy a más lapokkal közös
alakot mondja ki -- maradjon a magban, akkor is, ha a részletek kiköltöznek. Egy sor általában
elég; jarvis esetében pontosan egy volt (489 -> 490).

*(Ez ugyanaz az alak, mint mindenhol máshol ezen a lapon, csak a MÉRŐN belül: a szám javult, a
védett dolog romlott, és a mérő szerkezetileg nem tudott róla.)*

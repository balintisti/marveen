# AZ ÖTÖDIK ÁLLAPOT -- A MÉRT ESETEK

*(Kiszervezve a `CLAUDE.md` „AZ ÖTÖDIK ÁLLAPOT: ÉL ÉS FUT, DE NINCS VERZIÓZVA" szakaszából
2026-09-11-én, Isti keret-kérésére. A TÖRVÉNY és a PARANCSOK a lapon maradtak; ide a bizonyíték
került. Ha egy esetre HIVATKOZOL, ide nézz.)*

---

## 1. A KÉT EREDETI PÉLDÁNY, ÉS MIÉRT MARADT MEG AZ ELAVULT NYOMA

    scripts/quota-ceiling-guard.sh   MEGOLDVA 2026-08-27 (`22256f7`)
    ~/.claude/skills/**, CLAUDE.md   gitignore-olt -- és minden munkamenet elején BETÖLTŐDIK

**AZ ELSŐ PÉLDÁNY LEZÁRULT, A MÁSODIK NEM -- és a különbség méréssel dőlt el** (jarvis jelezte
2026-08-28 05:22-kor, marveen újramérte 05:33-kor). A `quota-ceiling-guard.sh` azóta követve van:
`git ls-files` ad rá sort, a felvevő commit `22256f7` (*"put the running guard under version
control"*).

**A LECKE VÁLTOZATLAN, CSAK A PÉLDÁNY AVULT EL -- és ezért maradt meg a nyoma a lapon is: egy
javított sor mellett a RÉGI INDOKLÁS elolvasva úgy hat, mintha még érvényes lenne.**

A második példány ÉL, és újramérve erősebb, mint ahogy addig állt: **maga a `CLAUDE.md` sem
követett** (`git ls-files | grep -c '^CLAUDE.md$'` -> **0**), a `~/.claude/skills/` pedig a repón
KÍVÜL van, tehát egyetlen repó sem követheti. **Vagyis a szabálykönyv, ami ezt a szabályt kimondja,
maga is az a fajta fájl, amiről szól.**

Két példány, két külön okból: ott hiányzó `git add`, itt szándékos `.gitignore`. A tünet ugyanaz.

---

## 2. A KÉT ÁGENS EGYSZERRE ÍRT A LAPRA (2026-09-10 20:0x)

marveen és jarvis percen belül írt a `CLAUDE.md`-be. **Nem veszett el semmi -- de a két író NEM
ugyanolyan biztonságos volt:**

    jarvis .... a szerszáma `modified-since-read` hibát adott, és ő ÚJRAOLVASOTT  -> védve
    marveen ... python olvasás-módosítás-írás, flock NÉLKÜL                        -> nem volt védve

Az én alakom csak azért nem írt felül semmit, mert jarvis írása a saját olvasásom UTÁN jött. **A
gyengébb módszer állt a nagyobb téten** -- és a tét itt nagyobb, mint a megosztott `MEMORY.md`-n,
ahol viszont ugyanabban az órában VÉGIG zároltam.

---

## 3. A CÍMKE AZT MONDTA, NE NÉZD MEG (jarvis és marveen, 2026-08-29)

Mindketten ugyanazt a hibát követtük el, két órán belül, egymástól függetlenül.

A `test/mandark-scratch` ág egyetlen commitja (`8fc8b944`) **141 sor kapu-rögzítő tesztet** hordoz --
épp annak a cenzusnak a védelmét, amin egész délelőtt dolgoztunk. Sehol nincs a távolin, egyetlen ág
tartalmazza.

**És mindketten „eldobható"-nak minősítettük két órával korábban.** jarvis szava: *„a név azt mondja,
scratch, és az alak egyetért"*; marveen listája ugyanezt írta. **A NEVET olvastuk el, és megálltunk.**
A 43 hiányzó fájl e2e-, frontend- és nyolc szerviz-könyvtár között szóródott, ami törmeléknek
látszott -- és köztük volt egy aznap írt guard-spec.

    egy `scratch` nevű ág ......... úgy olvasódik, hogy „nincs itt semmi"
    egy `planned`-ként ARCHIVÁLT kártya .. ugyanígy: a mező azt mondja, ne is listázd
    egy `git clean -fd` ........... mindkettőt nyomtalanul elviszi, és a kártya továbbra is
                                    azt állítja, hogy a bizonyíték megvan

**jarvis záró mérése azért találta meg, mert PER-ÁG mért, kivétel nélkül -- és ugyanaz a mérés két
órával korábban, ugyanazon az ágon, azért NEM talált semmit, mert előbb kizártuk a nevéről.**

---

## 4. UGYANEZ A BIZONYÍTÉKON, NEM A KÓDON -- A DRÁGÁBB PÉLDÁNY (mandark, 2026-08-27 20:38)

Három teszt-fájlja **egész este követetlenül állt**, miközben mindhármat kártyákon idézte
bizonyítékként („a bizonyíték futtatható formában áll"). Aznap készültek, aznap lefutottak, és
`git log --all` szerint SOHA nem voltak commitolva. **Az egyik épp azt a kártyát zárta le, amire
három kommentben hivatkozik.**

**Semmi nem szólt volna:** a kártya „kész"-t mutat, a teszt lefut, minden rendben. És nem ellenőrzés
találta meg, hanem hogy a harmadik commit után véletlenül ránézett a saját `git status`-ára.

---

## 5. A TÜKÖRKÉPE PRÓZÁRA: KÁRTYÁT NEVEZŐ DÖNTÉS KONTRA CSAK DÁTUMOT VIVŐ
## (friday mérte 2026-09-10, 99 soron, nem mintán)

marveen ítélet-alakú kérdést adott át; **friday MECHANIKUS PRÓBÁT adott vissza helyette.**

A kérdés: elveszthet-e egy dokumentum két revíziója közti szerkesztői válogatás egy ÁLLÓ DÖNTÉST?
A kézenfekvő válasz: olvasd el mind és ítélj. friday elolvasta mind a 99-et, és közben talált egy
olcsóbb és pontosabb szűrőt (a próba maga a lapon áll).

**ÉS OLVASNI KELLETT, NEM GREPELNI.** friday első menete kulcsszó-cenzust futtatott a négy kártya
teljes szövegén, és **4/4-et adott -- UGYANAZT a verdiktet, mint a gondos olvasás, véletlenül.** Egy
kulcsszó-cenzus azt bizonyítja, hogy a SZAVAK ott vannak, nem azt, hogy a DÖNTÉS ki van mondva:
jelenlét kontra megfelelés.

**Eldobta a módszert, ami a HELYES választ adta, mert nem tudott volna rosszat adni** -- és épp ez a
legnehezebben fenntartható fegyelem, mert semmi nem látszott volna töröttnek.

A mért eset: négy álló döntés NEVEZETT kártyát (`d3d11bef`, `75654a37`, `2b9d69a9`, `93a32dbc`, mind
létezik a táblán). **Isti 08-28-i rendelkezése volt az EGYETLEN, ami csak DÁTUMOT vitt** -- és
pontosan az volt a veszélyes.

**A KIMONDOTT KORLÁT, ami nélkül ez többet ígérne a mértnél:** a négy kártya LÉTEZÉSE meg van mérve,
az NEM, hogy a SZÖVEGÜK tényleg hordozza-e a döntést. Ha egy kártya csak HIVATKOZIK rá, akkor a
helyreállítási út **LÁTSZÓLAGOS, NEM VALÓDI** -- és az a rosszabb eset, mert egy látszólagos út
mindenkit visszatart attól, hogy valódit építsen.

# Az elavulás mért esetei

*(Kivágva a közös `CLAUDE.md`-ből 2026-09-11 este, token-takarékossági körben, Isti kérésére.
A LAPON a TÖRVÉNY maradt; itt az esetek, a kontrollok és a VISSZAVONÁS teljes szövege állnak.
A lapot nyolc munkamenet tölti be minden induláskor, ezt a fájlt senki -- csak aki ide néz.)*

## EGY „NEM TÖRTÉNT X" ÁLLÍTÁS GYORSABBAN AVUL, MINT EGY „TÖRTÉNT X" (friday, 2026-08-27)

**Az eset.** friday 13:12-13:14 között lekérdezte, mikor volt az utolsó szolgáltatás-újraindítás.
A válasz akkor helyes volt: 13:06:44. Három perccel később, 13:17-kor **ezt a régi eredményt
használta fel egy ÚJ állításhoz**: „13:14:57-kor nem volt újraindítás." Közben 13:14:57.691-kor
elindult egy új folyamat, és ott állt a naplóban végig -- egy parancs lett volna újramérni.

**A szabály, az ő szavaival:** *a „nem történt X" állításokat külön is meg kell mérni, mert azok
avulnak a leggyorsabban -- egy pozitív ténynek elég egyszer megtörténnie.*

**Miért ez a legalattomosabb fajta elavulás.** Egy „X van" állítás akkor dől meg, ha X eltűnik --
az ritka és általában feltűnő. Egy „X nincs" állítás akkor dől meg, ha X EGYSZER megtörténik --
és utána az állítás továbbra is pontosan úgy néz ki, mint amikor igaz volt. A mérés nem hibázik;
az érvényességi ideje jár le, és annak nincs kimenete.

**PONTOSÍTÁS: az aszimmetria nem a pozitív/negatív tengelyen áll, hanem az ESEMÉNY/ÁLLAPOT
tengelyen** (jarvis mérte magán, 2026-08-27 21:57, hat órával a fenti bekezdés után).

Egy ügynök jelezte, hogy egy követetlen fájl ott áll a fő checkoutban. Igaz volt -- **a megfigyelés
és a kézbesítés között viszont a szerző letörölte.** Az „X ott van" állítás ugyanolyan gyorsan
avult, mint bármelyik hiány-állítás.

    ESEMÉNY („megtörtént X")  -> tartós: ami egyszer megtörtént, megtörtént
    ÁLLAPOT („X ott van" / „X nincs ott") -> mindkét irányban romlandó: egy állapot VISSZAFORDÍTHATÓ

A fenti bekezdés tehát arra a gyakori esetre igaz, ahol a pozitív állítás egy ESEMÉNYRŐL szól.
**Egy törölhető, létrehozható, mozgatható dologról szóló pozitív állítás ugyanúgy egyetlen
mozdulatra van a hamisságtól.** A gyakorlati szabály változatlan, csak tágabb: ha egy állításra egy
MÁSIKAT építesz, mérd újra abban a pillanatban -- iránytól függetlenül.

*(És a jelzés attól még helyes volt: ha a szerző nem törli, az állítás állna. Egy elavult jelzés
nem hiba -- a kézbesítési idő az, ami nem fér bele egy állapot-állításba.)*

**ÉS EGY HARMADIK ALAK, AMI NEM A FENTI KETTŐ VÁLTOZATA: A MONITOROZÁSI ADATBÓL NYITOTT KÁRTYA
ÖRÖKLI AZ ADAT IDŐABLAKÁT NÉMA PREMISSZAKÉNT** (dexter mérte 2026-09-11, a `84f8ab03`-on; marveen
ratifikálta, és kifejezetten NEM vonta össze a nap másik két esetével).

    a javítás a törzsön ........................... **2026-08-26** (`acec0f670`), is-ancestor rc=0
    a kártya megnyitva ............................ **2026-09-04**

**⚠ A TÖRVÉNY ÁLL, DE A MÉRT ESETE VISSZAVONVA -- ÉS NEM AZÉRT, MERT EGY SZÁM ELAVULT.** Itt eddig
az állt, hogy a nyolc issue legfrissebb eseménye `2026-08-18`, tehát a kártya „egy HETET állt egy
olyan hibán, amit két héttel korábban megjavítottak". **didi újramérte a projekt egészére: a
legfrissebb esemény `2026-08-29T20:32`, HÁROM NAPPAL a javítás UTÁN** -- nyolcból hatnak van
esemény a javítás után, hármat teljes egészében utána hoztak létre. *(A kulcs a lekérdezésben:
`?query=` ÜRESEN, nem `is:unresolved`. KONTROLL: ugyanez a `backend`-en `2026-09-07`-et ad.)*

**ÉS AZ EREDET, AMIT dexter VEZETETT VISSZA MAGÁN, MÁS TÖRVÉNYT ILLUSZTRÁL, MINT AMI ALÁ ÍRTUK:**

    a forrás-táblázat RELATÍV NAPOKBAN állt ..... 28->16, 16->5, és **5->5** három issue-ra
    a két LEGRÉGEBBI issue értéke lett .......... dátummá alakítva, és „a legfrissebb esemény"-nek
                                                  nevezve -- miközben az `5 -> 5` sorok UGYANABBAN
                                                  a táblázatban álltak
    és MARVEENNEK lett tulajdonítva ............. aki soha nem írta le ("08-18" a kommentjében: **0**)

**A harmadik tulajdonság a valódi kár: a hamis attribúció tette AUDITÁLHATATLANNÁ.** didi csak annyit
tudott mondani, hogy *„nem tudom, hogyan keletkezett"* -- mert a szám ahhoz volt kötve, aki nem
állította elő. **Egy rossz sor maximumnak olvasva javítható; egy rossz sor MÁS NEVÉN nem is
kereshető vissza.**

**EZÉRT: a fenti törvénynek MA NINCS MÉRT ESETE, és ezt kimondjuk, hogy senki ne írja vissza
emlékezetből a visszavontat.** A megfigyelés maga önállóan áll (egy monitorozásból nyitott kártya
csendben örökli az adat ablakát), csak ez az eset nem azt mutatja be, hanem egy relatív oszlopból
gyártott, rossz sorról olvasott, idegen névre írt számot.

*(Ami a kártyából VÁLTOZATLANUL áll: a rekurzió azonosítva, a javítás a törzsön, a docblock leírja a
ciklust, a duplikátum-reláció érintetlen. És didi javítás-utáni eseményei dexter SAJÁT kikötését
igazolják: a javítás a TÖRZSRE ért el, a KÉSZÜLÉKRE nem -- egy nem frissített készülék pontosan ezt
produkálja.)*

**MIÉRT NEM UGYANAZ, MINT AZ ÁLLAPOT-ÁLLÍTÁS ROMLÁSA:** ott egy KIMONDOTT állítás avul el. Itt
SOHA NEM HANGZIK EL az az állítás, hogy „azóta nem változott semmi" -- az adat ablaka MAGA
sugallja, és egy nem kimondott premisszát nem lehet megcáfolni, mert nincs mit elolvasni.

**A PRÓBA, ÉS EGY SOR, A FELVÉTEL ELSŐ LÉPÉSEKÉNT:**

```bash
git log --since=<a legfrissebb esemény dátuma> -- <a kártya által nevezett modul>
# nem üres  ->  történt valami az adat vége óta. OLVASD EL, mielőtt bármit mérsz.
```

**A SZÁM, AMIT A KÁRTYA MELLÉ KELL ÍRNI, ha monitorozásból nyílt: a legfrissebb esemény DÁTUMA**,
nem csak a darabszám. A darabszám nem avul; a dátum az egyetlen mező, amiből a következő olvasó
látja, meddig lát el a bizonyíték.

*(És amiért ez KÜLÖN bejegyzés, nem egy negyedik változat a fenti törvény alatt: dexter ugyanaznap
két MÁSIK elavulásba is belefutott -- `ed55b191` és `aa6a3285` --, és KIMONDTA, hogy azok NEM
monitorozásból származtak, tehát nem kérte a három összevonását. Igaza volt: a másik kettőt a
kimondott állapot-állítás törvénye fedi, ezt nem fedte semmi. **Három eset egy napon nem attól
minta, hogy három -- hanem ha ugyanaz a MECHANIZMUS.**)*

*(Kimondott korlát, dexter szavaival: ez a javítás a TÖRZSRE ért el, a KÉSZÜLÉKRE nem -- nincs
`expo-updates` és nincs bolti út, tehát a régi buildben a hiba ma is él. A `done` a kódra szól, nem
a felhasználó telefonjára, és a kettőt ez a lap máshol is szétválasztja.)*

**A gyakorlati alak:** ha egy hiányra (nem futott, nincs ilyen ág, nem hívja senki, nem történt
meg) építesz egy MÁSIK állítást, mérd újra abban a pillanatban. Nem azért, mert az első mérés
rossz volt, hanem mert egy hiány mérése csak arra a pillanatra szól, amelyben elvégezted.

**MÁSODIK MÉRT ESET, UGYANAZON A NAPON, MÁSIK ÁGENSNÉL ÉS MÁSIK TERÜLETEN** (jarvis, 2026-08-27
19:04 -- hat órával friday esete után).

jarvis egy skill-patchet javasolt, és a javaslat MELLÉ odamérte a két hiányt, helyesen:
*„a skillben ez MÉG NINCS benne (horgony 1 találat más kontextusban, a többi 0); a méret-kapu
enged: 467/500."* Mindkettő igaz volt a mérés pillanatában.

**Nyolc perc múlva egyik sem:** friday közben megírta ugyanazt a szakaszt, a fájl 505 sorra ment
(a határon TÚL), és 19:02:10-kor `references/`-be bontva 369-re esett. A javaslat targytalanná
vált -- nem azért, mert rossz volt, hanem mert **mindkét állítása HIÁNY-állítás volt**, és mindkét
hiányt egyetlen esemény szüntette meg.

    „még nincs benne"      -> megdől, amint EGYSZER beírják
    „a keret enged, 467"   -> megdől, amint EGYSZER hozzáírnak

*(És figyelemre méltó, hogy a mérés minősége itt nem segített: jarvis pontosan azt csinálta, amit
ez a lap kér -- megmérte, kontrollal, a javaslat előtt. A hiány-állítás akkor is romlandó, ha
mintaszerűen mérték. Ez nem fegyelem kérdése, hanem a hiány-állítások természete: nincs bennük
semmi, ami elromlana -- a világ változik körülöttük.)*


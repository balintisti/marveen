---
name: sentry-or
description: Uj eles Sentry-hiba figyelese 3 oraankent, csak-olvaso, allapotfajllal a duplikatumok ellen. Isti kerte 2026-09-04 09:30-kor.
---

SENTRY-OR (csak-olvaso). Cel: UJ eles hiba eszrevetele, nem a meglevok ismetlese.

1. `date` KULON hivasban, mielott barmit leirsz.
2. Olvasd el a `store/sentry-watch-state.json`-t (ha nincs, ez az ELSO futas -- akkor csak
   allapotot rogzitesz, jelentes nelkul).
3. Kerdezd le a Sentryt MINDKET szervezetben, de tudd, MELYIK az eles:
     delta-crm / backend              <- IDE JELENT AZ ELES BACKEND (2026-09-04 07:56 UTC OTA)
     agrotech-cv / sajat-crm-backend  <- a REGI cel; 07:56 elotti esemenyek vannak benne

     MEGFORDULT 2026-09-04-EN, es a regi sorrend HAMIS NULLAT adott volna: aki az
     agrotech-cv-t nezi elesnek, egy valodi nullat "nincs eles hiba"-nak olvas.
     BIZONYITEK: a delta-crm/backend 7 napig URES volt, es a revizio-csere
     (00318-rhz, 07:55:59Z) utan negy perccel harom esemeny erkezett
     (08:32:23 / 08:34:34 / 08:36:03 UTC). Kartya: b0e4b82f.
     A FRONTEND soha nem volt rosszul iranyitva (a DSN a kepbe sutve), tehat az O
     nemasaga NEM iranyitasi kerdes -- ne "javitsd".
   `search_issues(organizationSlug=..., query='is:unresolved firstSeen:-4h', period='24h')`

   **DE A `firstSeen` A DELTA-CRM-EN 2026-09-11-IG NEM AZT MERI, AMIT KERDEZEL** (merve
   2026-09-04 15:3x, az elso eles futason). A projekt 07:56 UTC ota kap esemenyt, tehat MINDEN
   hibaosztaly, amit az alkalmazas termel, `firstSeen` szerint UJ -- akkor is, ha hetek ota fut.
   **A szuro a PROJEKT eletkorat meri, nem a hibaet.** Merve: 4 talalatbol 3-nak PONTOS parja
   volt a regi projekt 7 napos tortenetében.

   **A DISZKRIMINATOR, ES EZ KOTELEZO LEPES, nem ajanlas:** minden delta-crm talalatot vess
   ossze az `agrotech-cv/sajat-crm-backend` 7-30 napos tortenetevel, CIM es CULPRIT szerint:

       search_issues(organizationSlug='agrotech-cv', query='is:unresolved', period='7d', sort='freq', limit=15)

       ott LETEZIK ugyanaz a cim/culprit  ->  NEM UJ. Uj CSOPORTOSITAS, mert masik projektbe esik.
       ott NINCS                          ->  jelolt. Es akkor meg egy lepes: az elso esemeny
                                              idejet vesd ossze a REVIZIO-CSERE idejevel.

   **A HARMADIK LEPES, MERT KULONBEN EGY DEPLOY-MUTERMEKET JELENTESZ HIBAKENT:** egy Cloud Run
   revizio-csere leallitja a regi peldanyt menet kozben. A `job stalled` (bull), a `Connection is
   closed` es az ioredis-ujrakapcsolodas mind ENNEK a tunete, nem kod-regresszio. Ha egy jelolt
   elso esemenye a csereto 1-3 percen belul van, mondd ki, hogy a KETTO EGYBEESIK -- es azt is,
   hogy egy egy-esemenyes egybeeses nem bizonyitek, csak a legolcsobb magyarazat.

   **ES A SZAM, AMIT NE ADJ TOVABB CSUPASZON: AZ ISSUE-SZAM NEM PROBLEMA-SZAM.** Ugyanaz a
   `prisma-cache-invalidation` hiba HET kulon issue-csoportban all (93+49+18+16+13+9+8 = 206
   esemeny / 7 nap). Aki a legnagyobb csoportot idezi, a valodi terheles 45%-at mondja.
4. Vesd ossze az allapotfajlban tarolt, mar jelentett issue-azonositokkal. CSAK az ujakat vedd.
5. Ird vissza az allapotot (jelentett id-k + a futas ideje).
6. JELENTES: csak akkor irj Istinek, ha van UJ, es akkor is roviden -- mi tort el, hany
   felhasznalot erint, es hogy ez uj-e vagy visszatero. Ha nincs uj: NE irj. Ez heartbeat.

KIKOTESEK:
- Ha a Sentry MCP eszkoz nem erheto el, NE tippelj es NE jelents "nincs hiba"-t. Ird a
  naploba, hogy a MERO nem volt elerheto -- az ures es a nem-mert nem ugyanaz.

- **ES A HARMADIK ALLAPOT, AMI EDDIG HIANYZOTT, ES AMI HAROM NAPIG VAKKA TETT MINKET**
  (merve 2026-09-10, kartya `b3ea27c4`). A fenti kikotes egy ELROMLOTT MUSZER ellen ved. Van egy
  rosszabb eset: **a muszer MUKODIK, a valasza IGAZ, es a FORRAS hallgat.**

      1. az eszkoz nem erheto el ...... a fenti sor fedi -- HIBAT ad, tehat latszik
      2. tenyleg nincs uj hiba ........ nyugalom, ez a normalis
      3. **a projekt NEM KAP TOBBE ESEMENYT** -- az eszkoz valaszol, a valasz TISZTA NULLA,
         es az pontosan ugy nez ki, mint a 2.

  A 3. rosszabb az 1-nel: az 1. hibauzenetet ad, a 3. egy tiszta, helyes, MEGNYUGTATO nullat.
  Merve: a `delta-crm/backend` 3 napig nem kapott esemenyt, kozben a Cloud Logging ~81 ERROR/ora
  sebesseggel folyt (24h: 1944 sor, a limit alatt, tehat teljes szam).

  **A DISZKRIMINATOR MAR ABBAN AZ ADATBAN VAN, AMIT UGYIS LEKERDEZEL** -- nem kell uj forras,
  nem kell Cloud Logging, EGY masodik ablak ugyanazzal a hivassal:

      search_issues(organizationSlug='delta-crm', query='is:unresolved', period='7d', limit=25)

      a 24 oras ablak URES  ES  a 7 naposban VAN issue, de MIND 3+ napja latszott utoljara
          -> **A CSATORNA HALLGAT, nem a rendszer.** Ird ki, es NEVEZD MEG igy.
      a 24 oras ablak URES  ES  a 7 naposban is friss a `lastSeen`
          -> valodi nyugalom, ez a 2. eset: NE irj.
      a 7 napos ablak is URES
          -> ebbol MAGABOL **NEM MERHETO**: egy uj vagy tenyleg nema projekt ugyanigy nez ki.
             **DE EZ AZ ESET MOSTANTOL NEM AZ UT VEGE -- lasd a KVOTA-LABAT lentebb.**

  **ES A CSUSZO ABLAK EL IS FOGY ALOLAD: EZERT KELL EGY LAB, AMI NEM ABLAKBOL JON**
  (kartya `0fff734b`, merve 2026-09-11). A fenti megkulonboztetes azon all, hogy a 7 NAPOS
  ablakban VAN issue. Az az ablak CSUSZIK: ha a csatorna nema marad, a benne levo issue-k
  kiesnek, es akkor a muszer PONTOSAN AKKOR veszti el a megkulonbozteto kepesseget, amikor a
  csend a leghosszabb es a legjelentosebb. Mert eset: 2026-09-14 08:11 CEST-re mind a 23 kiesett
  volna. **Az ablak SZELESITESE nem javitas** -- merve, a 14 napos ablakban UGYANAZ a legfrissebb
  esemeny, tehat napokat vesz, nem kepesseget, es hozza a sajat kesobbi lejaratat.

      **A KVOTA-LAB (ezt kerdezd meg, amikor a 24h URES -- MINDIG, nem csak ha a 7d is ures):**

      GET https://sentry.io/api/0/organizations/delta-crm/stats_v2/
          ?field=sum(quantity)&groupBy=outcome&statsPeriod=24h&category=error&interval=1d
      (a mi `sentry_olvaso_token`-unkkel, vaultbol; merve 2026-09-11: HTTP 200)

      `accepted` > 0  ...........  a csatorna EL, a nulla issue VALODI nyugalom
      `accepted` HIANYZIK vagy 0, es `rate_limited` > 0
                      ...........  **A CSATORNA BE VAN ZARVA: a Sentry ELDOBJA az esemenyeket.**
                                   Ez nem "hallgat" -- ez egy MEGNEVEZETT ok, es ki kell irni.
      mindketto 0 ...............  tenyleg nem erkezik semmi a kuldo oldalrol sem

  **MIERT ER TOBBET, MINT A MASODIK ABLAK:** ez akkor is valaszol, ha NULLA issue van BARMELYIK
  ablakban -- vagyis pontosan abban az allapotban, ahol a ket-ablakos megkulonboztetes csodot
  mond. Es nem csak azt mondja meg, hogy a csatorna nema, hanem hogy MIERT.

  MERT PELDA, es ez a lab elso hasznalata volt: 2026-09-07-en fordult at a delta-crm szervezet.
      09-06  accepted 2567 | rate_limited    0
      09-07  accepted  775 | rate_limited  929   <- az atmenet napja
      09-08  accepted    0 | rate_limited 1468
  A legfrissebb issue `lastSeen`-je 2026-09-07 06:11:01Z -- ket fuggetlen mero, ugyanaz a nap.

  **ES AMIT A KVOTA-LAB SEM MOND MEG:** hogy MIKOR all helyre. A `subscription` es a `quotas`
  vegpont a mi olvaso tokenunkkel **404** (merve), tehat a szamlazasi idoszak fordulasa innen nem
  lathato. Ird ki, hogy nem merheto -- ne tippelj datumot.

  ES AMIT A HAROM-ALLAPOTOS RESZ NEM ALLIT: a `rate_limited` megnevezi a MECHANIZMUST (a Sentry
  dobja el), de nem mondja meg, MI ette meg a kvotat. Az a backend gazdajae.
- A 4 oras ablak SZANDEKOSAN szelesebb a 3 oras cronnal: az atfedes duplikatumot adhat, a res
  viszont kihagyast. A duplikatumot az allapotfajl szuri.
- Semmit ne minositsits resolved-nak es ne modosits Sentry-oldali allapotot. CSAK OLVASAS.

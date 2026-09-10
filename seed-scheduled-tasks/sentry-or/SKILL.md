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
          -> **NEM MERHETO ebbol**: egy uj vagy tenyleg nema projekt ugyanigy nez ki. Mondd ki,
             hogy nem tudod eldonteni, ne valassz.

  ES AMIT EZ NEM ALLIT: nem mondja meg, MIERT hallgat a csatorna (DSN, SDK-init, kvota). Az a
  backend gazdajae. Ez a lepes csak annyit allit, hogy a NULLA nem nyugalom -- es epp ez az,
  amit harom napig nem tudtunk.
- A 4 oras ablak SZANDEKOSAN szelesebb a 3 oras cronnal: az atfedes duplikatumot adhat, a res
  viszont kihagyast. A duplikatumot az allapotfajl szuri.
- Semmit ne minositsits resolved-nak es ne modosits Sentry-oldali allapotot. CSAK OLVASAS.

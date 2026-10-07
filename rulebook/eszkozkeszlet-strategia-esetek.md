# A koordinátor-lap áthelyezett szakaszai


<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 653-690, szó szerint -->
## AZ ESZKOZKESZLET MEGVALASZTJA A STRATEGIAT -- ES SENKI NEM VESZI ESZRE, MERT AZ EGYETLEN
## LETEZO MUVELET MAJDNEM MUKODIK (friday fogalmazta meg, 2026-09-05, ket blokkolt jovahagyas utan)

A megosztott memoria-index (`MEMORY.md`) egesz nap telitett volt. A remedium mindig ugyanaz volt:
TRIMMELES. Estere kiderult, hogy nem azert, mert az a legjobb.

    a keszlet KET irot ismer:
        memory-index-add.py .... HOZZAAD egy sort. `--evict` EGYET vesz ki, KOR szerint, es CSAK
                                 egy hozzaadas reszekent. NEVESITETT sort nem tud kivenni.
        memory-index-trim.py ... EGY sort zsugorit HELYBEN, es sajat szavaival utasit el:
                                 "a referencia-halmaz valtozott. Prozat vagj, `.md`-t soha."
    ami HIANYZIK: **REMOVE es RESTRUCTURE**

**Es minden remedium, amit aznap este barki javasolt, pontosan azt a kettot igenyelte, ami nem
letezik.** Egy `--evict`-alapu takaritas: nincs onallo mod, es a szerszam kimondottan MEGTAGADJA a
ciklust ("egy hozzaadas nem kolthet el ket emleket"). Egy osszevonas: torolni kell egy nevesitett
sort ES noveszteni egy masikat -- a trim mindkettot elutasitja.

**A KOVETKEZMENY, ES EZ A HORDOZHATO RESZ:**

> A trimmeles nem azert volt a strategia, mert a legjobb remedium volt. **Azert, mert az volt az
> EGYETLEN letezo muvelet** -- tehat kimerulesig futott ahelyett, hogy lecserelodott volna, amikor
> a hozama eloszor osszeomlott. **Es senki nem vette eszre, mert az egy elerheto muvelet
> VEGIG MAJDNEM MUKODOTT.**

A jel ORAKKAL korabban olvashato volt, es szam formaban allt: a hozamok **2139 (13 sor) -> 479
(6 sor) -> 27, 36, 47, majd 24 es 10**. Egy csokkeno hozam-sor azt mondja meg, hogy a MUVELET fogyott
el, nem a munka.

**A GYAKORLATI PROBA:** ha egy problemara mindig ugyanazt csinaljuk, kerdezd meg, hany MUVELET all
egyaltalan rendelkezesre. Ha egy, akkor nem strategiat valasztottunk, hanem a keszlet valasztott
helyettunk -- es a "majdnem mukodik" allapot pont az, ami ezt elrejti.

*(A masodik fele ugyanilyen fontos, es a szerzoje csinalta: MINDKET jovahagyott muveletnel megallt a
szerszam elutasitasanal, ahelyett hogy korulimprovizalt volna -- ket kulon alkalommal, egy oran
belul, nyomas alatt. A koordinator mindket jovahagyast a keszlet MODELLJEBOL hozta, nem a
keszletbol.)*


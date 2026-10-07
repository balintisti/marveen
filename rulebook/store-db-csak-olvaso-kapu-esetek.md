# A koordinátor-lap áthelyezett szakaszai


<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 694-697, szó szerint -->
A csak-olvaso meres receptje a Delta-CRM lapjan all, Postgresre. **Az SQLite-specifikus csapda
IS ott all -- ezen a lapon eddig NULLA emlites volt rola, pedig az SQLite adatbazis ITT van.**
Mérve: `CREATE TEMP TABLE` 4 talalat a CRM lapjan, 0 itt; `claudeclaw.db` 3 talalat itt.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 698-702, szó szerint -->
**A KONKRET CSAPDA:** a `gate_after` bevett alakja Postgresen a `CREATE TEMP TABLE`. SQLite-on
az egy read-only kapcsolaton is **ATMEGY** (a temp store kulon el), tehat ott VAK.

**A HELYES ALAK ITT -- a kapu a VEDETT TABLAT irja, a meres ELOTT ES UTAN:**



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 711-718, szó szerint -->
**AMIT MEGMERTEM, HOGY NE EPULJON RA FOLOSLEGES RITUALE:** a `uri=True` ELHAGYASA itt NEM
termel nema hibat -- mindket interpreter (`zsh` -> 3.14.7, `bash` -> 3.9.6) ertelmezi az URI-t,
a valodi fajlt nyitja meg, es a kapu tuzel. Nem kell ellene vedekezni.

**ES AMI NINCS: SQLITE-TAMOGATAS A SEGEDBEN.** A `scripts/readonly-measure.sh` psql-alaku
(SAVEPOINT, `ON_ERROR_STOP`); a fejlece FIGYELMEZTET az SQLite-csapdara, de utat nem ad hozza.
Aki a store-t meri, kezzel irja a kaput -- a fenti harom sor az.


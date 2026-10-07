# A koordinátor-lap áthelyezett szakaszai


<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2026-2044, szó szerint -->
## Reggeli napindító

**AZ ELJÁRÁS A SAJÁT SKILLJÉBEN ÉL, ÉS A SAJÁT ÜTEMEZETT FELADATA TÖLTI BE:**
`~/.claude/scheduled-tasks/reggeli-napindito/SKILL.md`. Ide NEM másoljuk vissza: a napindítót EGY
ágens futtatja NAPONTA EGYSZER, a lapot viszont MINDEN fordulóban olvassa, akihez eljut.

**ÉS AKIHEZ ELJUT, AZ MA EGY OLVASÓ, NEM NYOLC** (mérve 2026-09-20; itt eddig „MIND A NYOLC ágens
beolvassa MINDEN fordulóban" állt, és az 09-18 óta hamis). Mind a hét ágens LE VAN VÁLASZTVA
(`agents/<név>` symlink a `/Users/Shared/marveen-<név>`-re, és a futó panelek `pane_current_path`-e
ezt adja), tehát **ezt a lapot kizárólag a koordinátor sessionje tölti be.** A hét ágenshez a
`scripts/agent-core-check.py` 23 teherhordó mondata viszi át a flotta-szabályokat -- és annak a
kapunak MA NULLA ÉLŐ HÍVÓJA van (kártya `b493b5a5`). **Aki ide ír egy flotta-szabályt, az egy
olvasónak ír;** a többi hétnek KÉZZEL kell átvinni, amíg a hívó meg nem épül.

A négy csapda, ami korábban itt állt (a `search_emails` MCP-eszköz, ami NINCS bekötve és a hiánya
üres postafióknak látszik; a `--hours 744` mint az EGYETLEN elérhető pozitív kontroll; a
`HEARTBEAT_CALENDAR_ID`; és hogy a `warning` a `primary`-csapdát zárja ki, nem a látást) **átkerült
a skillbe, a törlés ELŐTT ellenőrizve**. A teljes régi szöveg: `rulebook/reggeli-napindito-esetek.md`.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2045-2049, szó szerint -->
**AMI ITT MARAD, MERT MINDEN ADATFORRÁSRA ÁLL:** ha egy kategóriában NINCS ESEMÉNY, hagyd ki a
szekciót; ha viszont NEM ÉRTED EL az adatforrást, azt ÍRD KI egy sorban, az okkal. **Az ÜRES és a
NEM MÉRHETŐ nem ugyanaz**, és a napindító hónapokig ígérhet email-blokkot úgy, hogy egyszer sem
tudta lekérni.


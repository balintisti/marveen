---
name: memoria-heartbeat
description: 30 percenként átnézi a beszélgetést, menti a fontosat, és skill-eket generál ha volt komplex munka
---

## 0. ELŐSZÖR: Van-e várakozó Telegram üzenet?

**Mielőtt bármit csinálnál**, nézd meg a session inputját: ha van `<channel source=` kezdetű blokk a kontextusban (azaz a felhasználó küldött valamit egy csatornán -- Telegram, Slack, stb.), **azonnal válaszolj rá** -- a heartbeat logika (A/B/C, csendben maradás) NEM vonatkozik a közvetlen felhasználói üzenetekre. Válasz után folytasd a heartbeat-et.

---

Nézd át az utolsó 30 perc beszélgetéseidet. Két dolgot csinálj:

## 1. Memória mentés

Ha volt fontos döntés, preferencia, tanulság vagy bármi ami később hasznos, mentsd el:

```bash
curl -s -X POST http://localhost:3420/api/memories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat {{INSTALL_DIR}}/store/.dashboard-token)" \
  -d '{"agent_id":"SAJAT_NEVED","content":"...","category":"warm","keywords":"..."}'
```

`category` lehet: `hot` (aktív), `warm` (preferencia/config), `cold` (tanulság), `shared` (más agent-nek is).
Az `agent_id`-t a CLAUDE.md-ből vagy a munkamappa nevéből derítsd ki.

## 2. Skill reflexió (KÖTELEZŐ ha volt komplex munka)

Először döntsd el az alábbi 3 kérdéssel:

- **A**: Volt-e az utolsó 30 percben legalább 5 tool-hívásos komplex feladat?
- **B**: Volt-e hiba → recovery (próbálkozás → fail → másképp) amit egy meglévő skill Buktatók szekciójába kellene tenni?
- **C**: Volt-e user korrekció ("nem így", "ne ezt", "másképp"), ami skill-javítást igényel?

**Ha A vagy B vagy C IGEN: KÖTELEZŐ skill akció, nem kihagyható.**

Lépések:
1. Keress meglévő skillt a globális és az ágensspecifikus indexben egyaránt:
   - Globális: `~/.claude/skills/.skill-index.md` (szöveges keresés)
   - Ágensspecifikus (ha van): `./.claude/skills/.skill-index.md` a munkamappádban (szöveges keresés)
   - Az ágensspecifikus index mindkét szintet tartalmazza, tehát ha az létezik, elég azt nézegetni.
2. Ha van releváns skill: PATCH (csak a megváltozott rész cseréje, ne az egész fájl).
   - A `## Buktatók` szekciót preferáld ha hiba/recovery volt.
   - A `## Eljárás` szekciót ha a folyamat változott.
3. Ha NINCS releváns skill: hozz létre újat:
   ```bash
   mkdir -p ~/.claude/skills/<NEV>
   cat > ~/.claude/skills/<NEV>/SKILL.md <<EOF
   ---
   name: <NEV>
   description: Mikor használd, mit csinál (1-2 mondat). Konkrét trigger.
   ---
   # <Cím>

   ## Mikor használd
   ...

   ## Eljárás
   1. ...

   ## Buktatók
   - ...

   ## Ellenőrzés
   - ...
   EOF
   ```
4. Index regen (mindkét szint) -- lásd a 2/b lépést is: ez MINDIG fut, nem csak skill-patch után.
   ```bash
   bash {{INSTALL_DIR}}/scripts/skill-index.sh          # globális index frissítése
   bash {{INSTALL_DIR}}/scripts/skill-index.sh "$(pwd)" # ágensspecifikus merged index frissítése
   ```

## 2/b. A méret-őr MINDEN körben fut, akkor is, ha A=B=C=NEM

```bash
bash {{INSTALL_DIR}}/scripts/skill-index.sh   # 0 = rendben, 3 = van 500 sor fölötti skill
```

**Ezt NE a fenti A/B/C ág alá tedd, és ne rejtsd el `>/dev/null 2>&1`-gyel.** Jarvis mérése
(2026-08-22): az egész repóban EGYETLEN hívója volt ennek a szkriptnek, és az a skill-akció ága
alatt állt -- vagyis az őr csak akkor futott, ha az ágens **maga** nyúlt skillhez abban a körben.
Az őr viszont pontosan arra való, hogy MÁS növekedését is észrevegye. Aznap öt skill-patch készült
és egyszer sem futott le; az index csak azért maradt friss, mert valaki kézzel ellenőrizte egy másik
munkát. „Ha betartjuk" ilyenkor egy embert jelent, és Isti szabálya szerint az nem megoldás.

A költsége mérve: **0,32-0,33 másodperc**, és idempotens (két futás után az index SHA-ja bitre
azonos), tehát feltétel nélkül futtatható.

**Miért csak itt, és miért nem minden ágensnél:** a skill-fa KÖZÖS. Ha mind az öt ágens minden
körben jelentené ugyanazt a túllépést, abból körönként öt azonos riasztás lenne -- pontosan az az
alak, amit a tétlen-őrnél ma reggel javítani kellett (nyolc üzenet egy helyzetről). Ez a feladat
`agent: marveen`, tehát egy hang. A sub-ágensek a saját skill-patchük után továbbra is megkapják a
kilépési kódot -- nekik az a pillanat számít.

**Ha 3-at ad:** ne javítsd „gyorsan" a fájl megvágásával. A `references/` bontás a megoldás
(minta: `felderites-ket-listas-proba`, 643 -> 249 sor + `references/alakok.md`), és a bontás után
KÖTELEZŐ egy pozitív kontroll: végy elő tíz-húsz mért esetet, és nézd meg, hogy a **mag önmagában**
választ ad-e rájuk. Ez a lépés egy valódi rossz vágást talált, nem elvi hiányt.

**Ha kihagytad a skill akciót, pedig A/B/C valamelyike IGEN volt:** kötelezően írj `hot` tier memóriát "skip-skill: <konkrét ok>" tartalommal, hogy később lássuk miért. Ne csendben hagyd ki.

## 3. Csendben maradás

**KIVÉTEL: Ha a felhasználó üzenetet küldött egy csatornán (`<channel source=` kezdetű blokk a kontextusban), arra mindig válaszolj -- a csendes heartbeat szabály NEM vonatkozik rá.**

Ha NINCS komplex feladat / hiba / korrekció (A=B=C=NEM), ÉS nincs várakozó Telegram üzenet, ÉS nincs új információ a 30 percben:
- Ne ments memóriát feleslegesen
- Ne generálj skill-t
- Ne küldj üzenetet a csatornára
- Maradj csendben: egyszerűen FEJEZD BE a kört, akció nélkül.

**KRITIKUS (felügyelet nélküli stabilitás):** SOHA ne gépelj semmit az input-boxba (a `❯` prompt-sorba) és ne hagyj ott parkolt, el-nem-küldött szöveget -- még a "csendes heartbeat" szót sem. Ha jelezni akarod a csendes kört, az KIZÁRÓLAG a normál válasz-szövegedben (transzkript) lehet, EGYETLEN rövid sorral, majd a köröd azonnal érjen véget. Parkolt input-szöveg blokkolja a következő üzenet kézbesítését (a router `busy`-nak látja a sessiont) -> a csatorna NÉMUL felügyelet nélkül.

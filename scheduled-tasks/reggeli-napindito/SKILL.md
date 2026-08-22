---
name: reggeli-napindito
description: Reggeli összefoglaló: email, naptár, AI hírek, plus Dream Engine top-of-message
---

Reggeli napindítót a CLAUDE.md formátum szerint. A beállított csatornára (chat_id: 0).

**FONTOS — Dream Engine override**: a napindító ELEJÉRE (még az email/naptár szekciók ELŐTT) tedd be a `{{INSTALL_DIR}}/DREAM.md` fájl tartalmából az 5 bucket-et — `💡 Skill-javaslatok`, `🧹 Memória-egészség`, `🎯 Top-3 holnapi javaslat`, `🌐 External opportunity`, `🛠 Skill-flotta health`. Ha a DREAM.md nem létezik vagy üres (pl. a Dream Engine valamiért nem futott le), kihagyod ezt a szekciót.

A `cat {{INSTALL_DIR}}/DREAM.md` parancs visszaadja a tartalmat, abból emeld ki a kulcs-szekciókat MarkdownV2-formátumra escape-elve.

A többi szekció (email, naptár, AI hírek) maradnak a CLAUDE.md-ben leírt formátum szerint.

**KÖTELEZŐ képesség-ellenőrzés az email/naptár szekció ELŐTT** (2026-08-18: kiderült, hogy
a napindító hónapokig ígért email- és naptár-blokkot úgy, hogy egyiket sem tudta lekérni,
és senkinek nem tűnt fel, mert a hiányzó adat ugyanúgy néz ki, mint a nyugodt reggel):

```bash
ls ~/.config/google-calendar-mcp/tokens.json 2>/dev/null || echo "NAPTAR: nincs token"
```
Email-eszközhöz `ToolSearch` (mail/gmail). A CLAUDE.md-ben említett `search_emails` NEM
garantált: ha az MCP nincs bekötve, a tool nem létezik.

A szabály: **az ÜRES kategóriát hagyd ki, a NEM ELÉRHETŐT írd ki** egy sorban, az okkal
(pl. "Naptár: nem elérhető, nincs Google-hitelesítés ezen a gépen"). Soha ne tűnjön úgy,
hogy nincs esemény, amikor valójában nem tudtuk megnézni.

Mail.app AppleScripten át: időkorláttal futtasd. Ha `-1712` (Apple-esemény időkorlát) jön,
az hiányzó Automation-engedély, nem üres postafiók -- ezt írd ki.

**AI hírek szekció -- CSAK a fő-ágensnél ({{MAIN_AGENT_ID}})**: ha NEM a fő-ágensként futsz (azaz sub-agentként), HAGYD KI az "🤖 AI HÍREK" szekciót -- sub-agenteknek nem releváns. Az email és naptár szekció marad mindenkinél.

# A `scripts/` fejleceiben allo dontesek

**GENERALT FAJL -- ne szerkeszd kezzel.** Ujrageneralas:

```bash
python3 scripts/decision-index.py            # ujrageneralja ezt a fajlt
python3 scripts/decision-index.py --check    # elavult-e (exit 3, ha igen)
python3 scripts/decision-index.py --unnamed  # ELO: amit egyik kozos lap sem nevez
```

Miert letezik, mit szamol es mit NEM: `scripts/decision-index.py` fejlece.
Roviden: ezek a sorok DONTESEK -- "miert EZ es nem AZ" --, es a nagy reszuk
egyetlen kozos lapon sem szerepel. Ez a lista a keresheto masodik lista;
a valasz maga a szkript fejlecben all, teljes indoklassal.

**Nincs benne idobelyeg** (hogy diffelheto legyen) es **nincs benne**
**"lapon nevezik-e" oszlop** (a bemenete a repon kivuli, kovetetlen fajl).

Populacio: `git ls-files scripts/` = **196** kovetett fajl, ebbol
**52** hordoz dontes-fejlecet.

## Nem olvasott fejlec-alak (1)

Ezek a fajlok egyik olvasott fejlec-alakot sem hasznaljak (sor-komment,
docstring, blokk-komment), de a fejlec-tartomanyukban all dontes-alaku sor.
Nyers frazis-szuro, nem parser -- ezert kulon szakasz.

- `scripts/com.marveen.idle-reporter.plist.template` -- MIERT KULON FOLYAMAT, ES NEM A DASHBOARDBAN EGY TIMER: mert epp azt az esetet

### `scripts/__tests__/channels-main-model.test.sh`

- Why this exists (2026-07-29): the model was read ONLY from

### `scripts/__tests__/idle-reporter.test.py`

- MIERT PYTHON-TESZT ES NEM VITEST: a szkript szandekosan ONALLO -- semmit nem

### `scripts/agent-msg.sh`

- WHY: the common `curl -s ... >/dev/null && echo sent` pattern is DANGEROUS -- curl exits 0 even when

### `scripts/agent-progress.sh`

- WHY: the [session-stuck] alert fires every 30 minutes for every agent that is

### `scripts/applies-cleanly.sh`

- WHY IT EXISTS (card 64968e12, measured 2026-08-29). mandark reviewed 15 commits against

### `scripts/calendar-agenda.sh`

- WHY A WRAPPER AND NOT `node dist/agenda-cli.js` DIRECTLY: three of the four

### `scripts/capacity-report.sh`

- WHY A WRAPPER AND NOT `node dist/capacity-cli.js` DIRECTLY: three of the four

### `scripts/card-comment.sh`

- MIERT LETEZIK. Ket ismetlodo hibat zar le egyszerre, es mindketto MERT eset

### `scripts/card-flow-report.sh`

- WHY A WRAPPER AND NOT `node dist/card-flow-cli.js` DIRECTLY: three of the four

### `scripts/channel-keepalive-probe.sh`

- WHY: the keepalive freshness signal (store/.channel-keepalive mtime) has two

### `scripts/channel-watchdog.sh`

- WHY a separate timer when the dashboard already has an in-process watchdog:

### `scripts/ci-watch.sh`

- MIERT LETEZIK: 2026-08-20-an a main CI-je elpirosodott, egy telepites emiatt kimaradt,

### `scripts/dashboard-user-add.sh`

- MIERT LETEZIK: az `/api/*` MINDEN hivasa hitelesitest kiван (nincs loopback-mentesseg,

### `scripts/decision-index.py`

- MIERT LETEZIK (kartya 72edf070). A scripts/ fejlecei dontes-alaku valaszokat hordoznak
- MIERT GENERALT ES NEM KEZI LISTA: egy kezi lista ugyanugy elavul, mint minden mas szam
- MIERT NINCS IDOBELYEG A GENERALT FAJLBAN, es ez SZANDEKOS elteres a skill-index.sh-tol:
- MIERT NINCS A "lapon nevezik-e" OSZLOP A GENERALT FAJLBAN. A bemenete a repon KIVUL van

### `scripts/deploy-lane.sh`

- MIERT SZERSZAM ES NEM SZABALY. A repo dokumentacioja eddig egy SZAMOT mondott

### `scripts/doc-commands.py`

- WHY THIS IS ITS OWN FILE. The extraction plus the path resolution is a `case`
- WHY THE RESOLUTION RULE MATTERS MORE THAN THE PATTERN (Marveen, 2026-08-22

### `scripts/email-send-gate.mjs`

- Governance control (Szabi 2026-06-25, after the Boni incident: a sub-agent
- Why a hook and not a permissions deny-list: permissive security profiles

### `scripts/ensure-managed-channels-enabled.sh`

- WHY: claude-code >= 2.1.205 SILENTLY drops channel-plugin INBOUND

### `scripts/git-at.sh`

- MIERT LETEZIK (kartya e63ce68e). A `git show "$ag:$ut"` alak zsh-ban NEMAN

### `scripts/gmail-recent.py`

- WHY THIS EXISTS (2026-08-20). The heartbeat gathers calendar and kanban data
- WHY PYTHON AND NOT NODE: Node has no IMAP client in its standard library, and
- WHY IMAP AND NOT THE GMAIL API: the OAuth app is stuck in Google's "Testing"
- WHY --with-body IS OPT-IN, AND WHY THE HEARTBEAT DOES NOT USE IT (2026-08-20):

### `scripts/heartbeat-metrics.sh`

- Why a script and not a prescribed command, measured three times: the

### `scripts/hooks/db-destructive-gate.py`

- WHY THIS EXISTS, AND WHY THE PERMISSION LIST IS NOT ENOUGH (measured 2026-08-19,

### `scripts/hooks/outgoing-copy-gate.py`

- Why this exists (Szabi, 2026-08-10 12:57): a licence-delivery email went out to a

### `scripts/hooks/skills-snapshot-on-write.sh`

- WHY (card de00fd2b, measured 2026-08-27). rulebook-snapshot.sh already versions
- WHY THIS MATCHES Bash AND NOT JUST Write|Edit, which is the whole point.
- WHY IT ASKS THE FILESYSTEM AND NOT THE COMMAND TEXT. Grepping the Bash command

### `scripts/hooks/telegram_fallback_send.py`

- WHY THE USAGE IS SPELLED OUT HERE (card 471ea006, measured 2026-08-28). The

### `scripts/hooks/telegram_progress_reply_clear.py`

- Why: a single long turn can pull a bigger task forward and emit several replies

### `scripts/idle-reporter.py`

- A KARTYA (ee4163be), es MIERT NEM ELEG A MEGLEVO TETLEN-OR. Egy agens fordulot

### `scripts/install-launchd-unit.sh`

- WHY (card 9f89c7e1, measured 2026-08-27). Every loaded com.marveen.* unit had an

### `scripts/install-skills-snapshot-hook.sh`

- WHY A SCRIPT AND NOT A VERSIONED settings.json (card de00fd2b, 2026-08-27).

### `scripts/kanban-project-classify.py`

- MIERT FAJLUT ES NEM CIMSZO. Egy fajlut ellenorizheto teny: vagy letezik az adott

### `scripts/lib/content-hash.sh`

- Why this exists: `md5sum` does not exist on macOS, and the flagship host's

### `scripts/limit-monitor.sh`

- WHY bash and not a Claude scheduled-task: a Claude agent invocation itself

### `scripts/main-agent-isolated-config.mjs`

- Why: the main agent otherwise keeps the shared ~/.claude and authenticates

### `scripts/memory-save.sh`

- WHY: the pattern documented in CLAUDE.md is

### `scripts/merge-overlap.py`

- WHY THIS EXISTS (2026-08-23). Two branches touching the same file, with git

### `scripts/mutate-probe.py`

- MIERT LETEZIK. Egy mutacios proba akkor er valamit, ha a ZOLD eredmeny EGY dolgot

### `scripts/permission-guard-check.sh`

- MIERT LETEZIK, KET MERT ESEMENYBOL:

### `scripts/playwright-cache-check.sh`

- WHY THIS EXISTS (card d1cf8ffb, measured 2026-08-23). A `playwright install`

### `scripts/pre-push-secret-check.sh`

- MIERT LETEZIK (kartya dd5e07b4, mert eset 2026-08-28). A lapon egy KEZI recept allt:

### `scripts/quota-ceiling-guard.sh`

- WHY THIS EXISTS  /  Isti lifted the fleet standstill for ONE agent (dexter) on 2026-08-26 with a hard

### `scripts/readonly-measure.sh`

- MIERT LETEZIK. A CLAUDE.md „Eles adatbazis MERESE" receptje JO, es harman futtattuk egy

### `scripts/rulebook-snapshot-audit.sh`

- WHY A SEPARATE, SELF-CHECKING DETECTOR (didi, card c26193d7, 2026-08-27).
- WHY THE TWO CAN DISAGREE AT ALL, and why the existing deletion guard could not

### `scripts/rulebook-snapshot.sh`

- WHY THIS EXISTS (card 52edd21e, measured 2026-08-27). The files every agent
- WHY COPIES AND NOT A BARE REPO OVER $HOME: the set spans three roots, so a

### `scripts/self-pace-gate.mjs`

- Governance control (2026-06-26, after the autonom-kor incident: a sub-agent
- Why a hook and not only a permissions deny-list: permissive profiles launch

### `scripts/skill-index.sh`

- Miert nem a duplikatum-szuro: didi megmerte a skill-fan (47 skill, 271 szekcio). Egy PROZAS
- Miert nem a globalis indexbe: az Level 0 kontextus, minden korben betoltodik. 271 szekcio-cim

### `scripts/task-last-run.sh`

- Miert letezik ez a szkript: a task_runs.ts oszlop MILLISZEKUNDUM epoch, a

### `scripts/tenant-second-user-watch.sh`

- MIERT LETEZIK. didi merte 2026-09-02-an: minden szervezetnek PONTOSAN EGY felhasznaloja van
- MIERT `command`-TIPUSU UTEMEZES, ES NEM HEARTBEAT. friday merte 2026-09-02-an, en

### `scripts/titok.sh`

- MIERT NEM TELEGRAMON: az uzenet ott marad a beszelgetesben, a telefonodon, a

### `scripts/update-readiness.sh`

- MIERT KULON SZKRIPT, ES NEM `update.sh --check`. A felmeresemben meg az utobbit
- MIERT KELL EGYALTALAN: a frissitesi ut hibaja definicio szerint KESON derul ki

### `scripts/update-suite-baseline.mjs`

- MIERT LETEZIK. A suite-meret or alapvonala eddig kezzel allt a forrasban, es a

### `scripts/upstream-sync-report.sh`

- WHY (card c83eb6b6). The cost of falling behind does not grow linearly: ten
- WHY IT FETCHES FIRST, AND WHY THAT IS THE WHOLE POINT (measured 2026-08-27).
- WHY IT DOES NOT MERGE. An automatic `git merge` in the main checkout is

### `scripts/verify-context-pct.sh`

- WHY A SCRIPT AND NOT A UNIT TEST. The route only computes contextTokens (and
- WHY IT RE-IMPLEMENTS THE RULE. The model -> window mapping below is a second,

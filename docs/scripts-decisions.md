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

Populacio: `git ls-files scripts/` = **195** kovetett fajl, ebbol
**30** hordoz dontes-fejlecet.

### `scripts/__tests__/channels-main-model.test.sh`

- Why this exists (2026-07-29): the model was read ONLY from

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

### `scripts/ci-watch.sh`

- MIERT LETEZIK: 2026-08-20-an a main CI-je elpirosodott, egy telepites emiatt kimaradt,

### `scripts/dashboard-user-add.sh`

- MIERT LETEZIK: az `/api/*` MINDEN hivasa hitelesitest kiван (nincs loopback-mentesseg,

### `scripts/deploy-lane.sh`

- MIERT SZERSZAM ES NEM SZABALY. A repo dokumentacioja eddig egy SZAMOT mondott

### `scripts/email-send-gate.mjs`

- Governance control (Szabi 2026-06-25, after the Boni incident: a sub-agent
- Why a hook and not a permissions deny-list: permissive security profiles

### `scripts/git-at.sh`

- MIERT LETEZIK (kartya e63ce68e). A `git show "$ag:$ut"` alak zsh-ban NEMAN

### `scripts/heartbeat-metrics.sh`

- Why a script and not a prescribed command, measured three times: the

### `scripts/hooks/skills-snapshot-on-write.sh`

- WHY THIS MATCHES Bash AND NOT JUST Write|Edit, which is the whole point.
- WHY IT ASKS THE FILESYSTEM AND NOT THE COMMAND TEXT. Grepping the Bash command

### `scripts/install-skills-snapshot-hook.sh`

- WHY A SCRIPT AND NOT A VERSIONED settings.json (card de00fd2b, 2026-08-27).

### `scripts/lib/content-hash.sh`

- Why this exists: `md5sum` does not exist on macOS, and the flagship host's

### `scripts/limit-monitor.sh`

- WHY bash and not a Claude scheduled-task: a Claude agent invocation itself

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

### `scripts/upstream-sync-report.sh`

- WHY IT DOES NOT MERGE. An automatic `git merge` in the main checkout is

### `scripts/verify-context-pct.sh`

- WHY A SCRIPT AND NOT A UNIT TEST. The route only computes contextTokens (and

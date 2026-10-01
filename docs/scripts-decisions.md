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

Populacio: `git ls-files scripts/` = **437** kovetett fajl, ebbol
**132** hordoz dontes-fejlecet.

## Nem olvasott fejlec-alak (3)

Ezek a fajlok egyik olvasott fejlec-alakot sem hasznaljak (sor-komment,
docstring, blokk-komment), de a fejlec-tartomanyukban all dontes-alaku sor.
Nyers frazis-szuro, nem parser -- ezert kulon szakasz.

- `scripts/com.marveen.idle-reporter.plist.template` -- MIERT KULON FOLYAMAT, ES NEM A DASHBOARDBAN EGY TIMER: mert epp azt az esetet
- `scripts/expiry-inventory.json` -- "WHY A DECLARED PROBE AND NOT A DATE FIELD: a stored date drifts silently the",
- `scripts/sql/tasks-reopen-grant.sql` -- MIERT ALL EZ ITT, ES NEM CSAK A KARTYAN: a fajlt UJRAFUTTATTAK nyitott kerdeskent,

### `scripts/__tests__/channels-custom-provider.test.sh`

- Why this exists: channels.sh gains customProvider support for the main agent

### `scripts/__tests__/channels-main-model.test.sh`

- Why this exists (2026-07-29): the model was read ONLY from

### `scripts/__tests__/channels-native-install-no-npm.test.sh`

- Why this exists (2026-09-17): a host that had migrated to the native installer

### `scripts/__tests__/expiry-check.test.py`

- WHAT THESE PIN, AND WHY THESE AND NOT THE HAPPY PATH. The defect this checker

### `scripts/__tests__/hook-agent-id-resolver.test.py`

- Why a shape check earns its place here: the swap is one line per file and the

### `scripts/__tests__/idle-reporter.test.py`

- MIERT PYTHON-TESZT ES NEM VITEST: a szkript szandekosan ONALLO -- semmit nem

### `scripts/__tests__/install-hooks-cwd-independence.test.sh`

- WHY THIS TEST IS CLASS-LEVEL AND NOT THREE PER-INSTALLER CASES: each of those

### `scripts/__tests__/install-no-force-push-hook.test.sh`

- MIERT SCRATCH REPO ES NEM A SAJAT FANK: ez a telepito a `.git/hooks` ala ir.

### `scripts/__tests__/lib/sqlite-oracle.sh`

- WHY THIS EXISTS. Several suites looked into (or seeded) a database with the

### `scripts/__tests__/main-inbox-observer.test.sh`

- Why the observer exists:  /  the main agent's queue is the one delivery path nothing watches from outside

### `scripts/__tests__/memory-index-add-check-hop2.test.py`

- WHY THAT IS THE DANGEROUS DIRECTION, and not just an inaccurate number: NO PATH is the input to

### `scripts/__tests__/memory-index-add-unreachable-truncation.test.py`

- WHY THAT IS THE DANGEROUS DIRECTION: the question people bring to this list is "did my

### `scripts/__tests__/memory-index-gate-jq-fallback.test.sh`

- why this suite asserts the maximum first: it is the one that fails QUIET.

### `scripts/__tests__/nullaor-memgate.test.sh`

- WHY THIS FILE EXISTS, STATED HONESTLY: the guard added alongside this test is

### `scripts/__tests__/outgoing-gate-entry-seam.test.py`

- WHY NOT `elif` (marveen's ruling, didi's mechanism). `elif` closes the chain, so control resumes

### `scripts/__tests__/script-import-guard.test.py`

- WHY A POSITIVE CONTROL IS THE WHOLE TEST. "Nothing happened" is exactly what a

### `scripts/__tests__/telegram-reply-guard-agent-id.test.py`

- Why this hook first, and alone: it is the one on the path to Isti. The upstream

### `scripts/__tests__/update-npm-ci-include-dev.test.sh`

- Why: the service runs under NODE_ENV=production, and a bare `npm ci` then

### `scripts/__tests__/usage-collect-expired-windows.test.py`

- MIERT LETEZIK. 2026-09-19-en kiderult, hogy a kulcstarto-hitelesites 129 oraja lejart,
- MIERT MESTERSEGES BEMENET, KIMONDVA: az elo lekerdezes MA egyaltalan nem ad `windows`-t

### `scripts/__tests__/usage-collect-json-purity.test.py`

- MIERT LETEZIK. A modul sajat docstringje azt igeri: "--json prints only the snapshot

### `scripts/__tests__/vault-alak-scan.test.py`

- Miert alprocesszkent: amit ez az eszkoz KIIR, az maga a kockazat. Egy fuggveny-

### `scripts/agent-core-check.py`

- MIERT: Isti dontese (2026-09-18) szerint minden agens a SAJAT lapjat olvassa, nem a kozoset.

### `scripts/agent-cwd-detach.sh`

- MIERT. A Claude Code a cwd-tol a GYOKERIG minden szinten betolti a CLAUDE.md-t, es erre NINCS

### `scripts/agent-msg-get.sh`

- WHY THIS EXISTS: a completion notification carries only the first part of a long `result`,

### `scripts/agent-msg.sh`

- WHY: the common `curl -s ... >/dev/null && echo sent` pattern is DANGEROUS -- curl exits 0 even when

### `scripts/agent-progress.sh`

- WHY: the [session-stuck] alert fires every 30 minutes for every agent that is

### `scripts/alert-coordinator.sh`

- WHY: agent-msg.sh refuses a message when the recipient already has >= 3 pending (its saturation

### `scripts/applies-cleanly.sh`

- WHY IT EXISTS (card 64968e12, measured 2026-08-29). mandark reviewed 15 commits against

### `scripts/assert-isolated.py`

- WHAT WENT WRONG, AND WHY "READ THE VARIABLE" IS NOT THE FIX. On 2026-09-11 I measured

### `scripts/backup-offsite.py`

- WHY NOT THE SERVICE ACCOUNT (measured 2026-09-25 07:32): a service account has a Drive storage

### `scripts/batch-candidates.py`

- WHY THIS EXISTS. The batch rule lived only in prose and was re-derived by hand every
- WHY THE COUPLING MUST BE DECLARED AND NOT INFERRED (marveen measured 2026-09-12, on

### `scripts/bontas-horgony-check.py`

- MIERT LETEZIK. 2026-09-17-en hat szakaszt bontottam ki a `CLAUDE.md`-bol, es a bontas utani

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

### `scripts/ci-env-parity.py`

- WHY A TOOL AND NOT A CHECKLIST LINE. The rule "copy the whole job, not just the

### `scripts/ci-watch.sh`

- MIERT LETEZIK: 2026-08-20-an a main CI-je elpirosodott, egy telepites emiatt kimaradt,

### `scripts/claude-md-canary.txt`

- MIERT LETEZIK: 2026-09-18-an egy blokk kivitele elvitte Isti VISELKEDESI szabalyait

### `scripts/claude-md-edit.py`

- MIERT LETEZIK. A lapot ketszer vagtuk le es ketszer nott vissza, MERVE:

### `scripts/contrast-both-themes.js`

- WHY IT EXISTS IN THIS SHAPE. marveen made it a standing rule on 2026-09-10

### `scripts/dashboard-user-add.sh`

- MIERT LETEZIK: az `/api/*` MINDEN hivasa hitelesitest kiван (nincs loopback-mentesseg,

### `scripts/decision-index.py`

- MIERT LETEZIK (kartya 72edf070). A scripts/ fejlecei dontes-alaku valaszokat hordoznak
- MIERT GENERALT ES NEM KEZI LISTA: egy kezi lista ugyanugy elavul, mint minden mas szam
- MIERT NINCS IDOBELYEG A GENERALT FAJLBAN, es ez SZANDEKOS elteres a skill-index.sh-tol:
- MIERT NINCS A "lapon nevezik-e" OSZLOP A GENERALT FAJLBAN. A bemenete a repon KIVUL van

### `scripts/delta-crm-backup-key.sh`

- WHY `show` REFUSES UNLESS BOTH STDIN AND STDOUT ARE A TERMINAL: every agent's

### `scripts/deploy-lane.sh`

- MIERT SZERSZAM ES NEM SZABALY. A repo dokumentacioja eddig egy SZAMOT mondott

### `scripts/dev-gc.py`

- WHY (card 251b5785, didi's measurement 2026-09-26 04:16): the disk lost ~52 GiB in one

### `scripts/doc-commands.py`

- WHY THIS IS ITS OWN FILE. The extraction plus the path resolution is a `case`
- WHY THE RESOLUTION RULE MATTERS MORE THAN THE PATTERN (Marveen, 2026-08-22

### `scripts/done-vs-live.py`

- WHY (Isti 4553, 2026-09-30). Measured that day: 173 done/testing cards whose work never reached
- WHY NOT scripts/landed-check.py (card 7eb6a490). It asks whether the SHAs a card's TEXT names

### `scripts/email-send-gate.mjs`

- Governance control (Szabi 2026-06-25, after the Boni incident: a sub-agent
- Why a hook and not a permissions deny-list: the hook is version- and

### `scripts/ensure-managed-channels-enabled.sh`

- WHY: claude-code >= 2.1.205 SILENTLY drops channel-plugin INBOUND

### `scripts/expiry-check.py`

- WHY THIS EXISTS AT ALL. friday's SOUL.md has carried this as a STANDING duty since
- WHY FIVE OUTCOMES AND NOT TWO. The failure this card documents is not "a date passed
- WHY A FAILED PROBE IS NOT 'NO EXPIRY'. A command that errors, returns non-JSON, or
- WHY THE SUMMARY CANNOT SAY 'ALL CLEAR' WHILE ANYTHING IS UNMEASURED. A checker whose
- WHY --quiet-unless-changed EXISTS, AND WHY THE SILENCE HAS A CEILING. Run daily,

### `scripts/fetch-budget.py`

- Why this exists  /  ---------------

### `scripts/fleet-page-guard.sh`

- MIERT LETEZIK. 2026-09-20-an megmertem, hogy mind a het agens LE VAN VALASZTVA
- MIERT NEM BLOKKOL, HANEM JELEZ. A drift nem a futas pillanataban keletkezik, hanem amikor

### `scripts/garmin_run_gate.py`

- WHY A CRASH IS NOT exit 0. The task spec asked for "already analysed OR error
- WHY WE ROLL THE STATE BACK. running_analysis.py advances

### `scripts/git-at.sh`

- MIERT LETEZIK (kartya e63ce68e). A `git show "$ag:$ut"` alak zsh-ban NEMAN

### `scripts/gmail-recent.py`

- WHY THIS EXISTS (2026-08-20). The heartbeat gathers calendar and kanban data
- WHY PYTHON AND NOT NODE: Node has no IMAP client in its standard library, and
- WHY IMAP AND NOT THE GMAIL API: the OAuth app is stuck in Google's "Testing"
- WHY --with-body IS OPT-IN, AND WHY THE HEARTBEAT DOES NOT USE IT (2026-08-20):

### `scripts/heartbeat-metrics.sh`

- Why a script and not a prescribed command, measured three times: the

### `scripts/hooks/browser-content-notice.py`

- WHY THIS EXISTS  /  ---------------
- WHY THE LABEL NEVER QUOTES THE PAYLOAD  /  --------------------------------------

### `scripts/hooks/channel-process-gate.py`

- Why this exists (card ccdc10ec, step 3): on 2026-09-05 and 09-06 the telegram

### `scripts/hooks/db-destructive-gate.py`

- WHY THIS EXISTS, AND WHY THE PERMISSION LIST IS NOT ENOUGH (measured 2026-08-19,
- === THE OVERRIDE, AND WHY IT IS A TOKEN AND NOT A CARVE-OUT

### `scripts/hooks/memory-frontmatter-gate.py`

- WHY (MEMFMGATE918, 2026-09-18): nine memory files in the fleet store had a

### `scripts/hooks/memory-index-write-gate.py`

- WHY THIS EXISTS (card c837502c, didi's finding d85cfbb4 c8). The index overflow rule had
- === WHY THE TARGET IS MATCHED BY realpath AND NOT BY NAME

### `scripts/hooks/mio-orszem-precheck.sh`

- Why: the hourly sentinel round re-injects its full SKILL.md (~3.5k tokens of

### `scripts/hooks/outgoing-copy-gate.py`

- Why this exists (Szabi, 2026-08-10 12:57): a licence-delivery email went out to a

### `scripts/hooks/skills-snapshot-on-write.sh`

- WHY (card de00fd2b, measured 2026-08-27). rulebook-snapshot.sh already versions
- WHY THIS MATCHES Bash AND NOT JUST Write|Edit, which is the whole point.
- WHY IT ASKS THE FILESYSTEM AND NOT THE COMMAND TEXT. Grepping the Bash command

### `scripts/hooks/slack_progress_reply_clear.py`

- Why: a single long turn can pull a bigger task forward and emit several

### `scripts/hooks/telegram_fallback_send.py`

- WHY THE USAGE IS SPELLED OUT HERE (card 471ea006, measured 2026-08-28). The

### `scripts/hooks/telegram_progress_reply_clear.py`

- Why: a single long turn can pull a bigger task forward and emit several replies

### `scripts/idle-reporter.py`

- A KARTYA (ee4163be), es MIERT NEM ELEG A MEGLEVO TETLEN-OR. Egy agens fordulot

### `scripts/install-backup-gate-hook.sh`

- WHY THIS EXISTS -- the rule was already written, and measured not to work.

### `scripts/install-launchd-unit.sh`

- WHY (card 9f89c7e1, measured 2026-08-27). Every loaded com.marveen.* unit had an

### `scripts/install-no-force-push-hook.sh`

- WHY THIS FILE EXISTS AT ALL (card f2b369ff, measured 2026-09-10 19:5x).
- WHY THE HOOK AND NOT THE DENY-LIST (the card's own point 3, now measured).

### `scripts/install-skills-snapshot-hook.sh`

- WHY A SCRIPT AND NOT A VERSIONED settings.json (card de00fd2b, 2026-08-27).

### `scripts/install-slack-progress-hook.sh`

- Why not Slack's "typing…" indicator: the classic RTM `type: typing` frame

### `scripts/installed-drift-daily.sh`

- WHY: nothing ran the meter. After the upstream merge it stood at "NEM MERHETO" (an unclassified

### `scripts/kanban-project-classify.py`

- MIERT FAJLUT ES NEM CIMSZO. Egy fajlut ellenorizheto teny: vagy letezik az adott

### `scripts/kanban-uj.sh`

- MIERT LETEZIK. A `CLAUDE.md`-ben het curl-pelda all a kartya-nyitasra, es a valasz,

### `scripts/kartya-es-ertesites.py`

- MIERT: 2026-09-05-en a kanban-audit ot friss kartyat talalt megnevezett flotta-gazdaval,

### `scripts/landed-check.py`

- WHY THIS EXISTS, AND WHY IT REPORTS INSTEAD OF BLOCKING. Measured 2026-08-25 (card b53a0836):
- WHY NOT THE HARD GATE THE CARD ORIGINALLY ASKED FOR ("not on the trunk -> waiting, not done"):
- WHY TWO LEGS AND NOT ONE. Ancestry is NECESSARY but not SUFFICIENT: after a rebase or a
- WHY SUBJECT AND NOT PATCH-ID: patch-id was measured unreliable here on 2026-08-23, and a rebase
- WHY THE CARD-ID EXCLUSION IS NOT COSMETIC. Our card ids are 8 hex characters, so a bare
- WHY A CARD COUNTS AS LANDED IF ANY named commit landed. Cards quote other people's commits and

### `scripts/lib/backup-key.sh`

- WHY gpg AND NOT OUR OWN AES-GCM (vault.ts has one): the restore that matters

### `scripts/lib/backup_key_words.py`

- WHY WORDS AND NOT RANDOM CHARACTERS (marveen's ruling, and the reason is the

### `scripts/lib/content-hash.sh`

- Why this exists: `md5sum` does not exist on macOS, and the flagship host's

### `scripts/lib/homoglyph.py`

- WHY THIS EXISTS. Measured 2026-09-22: one agent sent a report with three
- WHY IT IS HERE AND NOT IN ONE AGENT'S TOOLBOX (MSGGATE924). Two agents had

### `scripts/lib/mixed_script.py`

- WHY IT LIVES HERE (2026-09-24 review of #1541). Two paths block on this rule:

### `scripts/lib/pg-argv-safe.sh`

- WHY THE SCRIPTS WERE NOT CARELESS. `delta-crm-backup.sh`'s own header says
- WHY A VARIABLE AND NOT AN ECHOED RESULT: `$(...)` strips trailing newlines, so
- WHY NOT `printf %b "${s//%/\\x}"`, the usual one-liner: it also interprets

### `scripts/lib/retire_progress_hooks.py`

- Why a separate file: this used to be a here-document inside a "$( ... )" in the
- why Linux never showed it. Python that lives in its own file cannot break the

### `scripts/limit-monitor.sh`

- WHY bash and not a Claude scheduled-task: a Claude agent invocation itself

### `scripts/main-agent-isolated-config.mjs`

- Why: the main agent otherwise keeps the shared ~/.claude and authenticates

### `scripts/main-inbox-observer.sh`

- WHY A SEPARATE UNIT -- the two cheap in-tree candidates both failed their

### `scripts/memoria_heartbeat_gate.py`

- WHO MOVES THE WATERMARK, AND WHY IT IS NOT THIS SCRIPT

### `scripts/memory-index-add.py`

- WHY THIS IS CODE AND NOT A RULE, and the reason is measured rather than stylistic. The
- WHY PREPEND. Measured 2026-09-03: the first 40 index lines had a median file mtime of

### `scripts/memory-index-fold.py`

- why: "pretending otherwise is how a tool grows a capability nobody asked for." So the caller
- WHY THE LOCK IS LOAD-BEARING, not ceremony: six agents write MEMORY.md through a shared inode,

### `scripts/memory-index-gate.sh`

- MIERT A HOSSZ, ES NEM A TARTALOM: a "tartalmaz-e mert reszletet" osztalyozast
- MIERT 800: a forro sorok eloszlasa (n=313) p50=373, p75=530, p90=669, p95=896,

### `scripts/memory-index-linkcheck.py`

- WHY A SECOND NUMBER NEXT TO THE SIZE  /  The index gate measures the SIZE of the shared MEMORY.md, because above the
- WHY A CANDIDATE, AND ONLY THEN A FINDING

### `scripts/memory-save.sh`

- WHY: the pattern documented in CLAUDE.md is

### `scripts/merge-overlap.py`

- WHY THIS EXISTS (2026-08-23). Two branches touching the same file, with git

### `scripts/mio-feed-post.py`

- Miert ilyen alakban (es nem ad-hoc fetch-csel):

### `scripts/mutate-probe.py`

- MIERT LETEZIK. Egy mutacios proba akkor er valamit, ha a ZOLD eredmeny EGY dolgot

### `scripts/napindito-sections.py`

- MIERT SZKRIPT ES NEM PROMPT: mind a harom szekcio szamlalas, es egy LLM-fordulo
- hogy az ellenorzes miert nem futott le. A napindito pontosan ezen bukott el

### `scripts/net-probe.py`

- WHY: on 2026-09-24 four pollers failed on four different hosts in one morning (googleapis oauth2,
- why this measures HTTPS); 120 interleaved HTTPS requests: 1 failure, sentry.io. The machine is on

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

### `scripts/recipient-ledger.mjs`

- Why this exists (2026-08-14): an agent wrote to support@connectors.hu, an

### `scripts/retire-progress-watchdog.sh`

- Why this exists: installing a second provider's progress hook does NOT

### `scripts/rulebook-snapshot-audit.sh`

- WHY A SEPARATE, SELF-CHECKING DETECTOR (didi, card c26193d7, 2026-08-27).
- WHY THE TWO CAN DISAGREE AT ALL, and why the existing deletion guard could not

### `scripts/rulebook-snapshot.sh`

- WHY THIS EXISTS (card 52edd21e, measured 2026-08-27). The files every agent
- WHY COPIES AND NOT A BARE REPO OVER $HOME: the set spans three roots, so a

### `scripts/run-python-contract-tests.py`

- WHY THIS EXISTS (card 27975b85). Nothing ran scripts/__tests__/*.test.py: `npm test` is
- WHY IT WRITES A STATE FILE EVEN WHEN EVERYTHING PASSES (marveen's condition on this card).

### `scripts/safety-core-drift-check.py`

- MIERT NEM ELOSZTO (marveen dontese, 2026-09-24, a kartyan): friday merte, hogy a sablon a lapok

### `scripts/schedule-artifact-watch.py`

- WHY (card 5b69464f, didi 2026-09-18): sentry-or's state file did not move for 5 days 12 hours

### `scripts/self-pace-gate.mjs`

- Governance control (2026-06-26, after the autonom-kor incident: a sub-agent
- Why a hook and not only a permissions deny-list: permissive profiles launch

### `scripts/skill-index.sh`

- Miert nem a duplikatum-szuro: didi megmerte a skill-fan (47 skill, 271 szekcio). Egy PROZAS
- Miert nem a globalis indexbe: az Level 0 kontextus, minden korben betoltodik. 271 szekcio-cim

### `scripts/skill.ts`

- MIERT A CLI SAJAT FOLYAMATABAN SZKENNEL (spec, msg 16930/b): a hatokor

### `scripts/sms/seeme-send.py`

- MIERT KuLoN FAJL, ES NEM AZ `sms-send.py` BoVITESE: az `sms-send.py` az sms-gate.app
- ATVETT ELEMEK, ES MIERT (ellenorizve a sajat testverenel, nem feltetelezve):
- TUDATOSAN NEM ATVETT ELEMEK, ES MIERT:  /  - KLIENS-OLDALI TITKOSITAS (sms_crypto.py): az sms-gate.app tamogatja, mert egy

### `scripts/statusline-ratelimit.sh`

- WHY THIS EXISTS: the owner asked to be warned when the 5-hour or the weekly

### `scripts/supabase-q.sh`

- WHY IT EXISTS, measured: the account-level Supabase PAT leaked into 167 places,

### `scripts/support-mail/entitlement.py`

- WHY THIS EXISTS: the old support-inbox check queried ONE customer DB

### `scripts/task-last-run.sh`

- Miert letezik ez a szkript: a task_runs.ts oszlop MILLISZEKUNDUM epoch, a

### `scripts/telegram-live-progress.py`

- Why a daemon and not a hook: a hook fires at discrete points and cannot keep a

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

### `scripts/worktree-uj.sh`

- MIERT LETEZIK. 2026-09-17 09:3x-kor marveen ezt irta:

### `scripts/write-built-commit.cjs`

- WHY THE BUILD WRITES IT. update.sh:747-751 uses dist/.built-commit as the

### `scripts/write-census.mjs`

- WHY IT EXISTS (card e3f8f2fd, then 99d3fef7). A destination written by SEVERAL functions

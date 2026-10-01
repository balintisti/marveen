#!/bin/bash
# Marveen -- CI/deploy figyelo a Delta-CRM `main` again.
#
# MIERT LETEZIK: 2026-08-20-an a main CI-je elpirosodott, egy telepites emiatt kimaradt,
# es SENKI NEM SZOLT. Masnap zoldre allt magatol. A hiba nem az volt, hogy elromlott,
# hanem hogy nem latszott.
#
# NEM modell-fordulo: sima szkript, ~nulla token. Csak akkor ertesit, ha VALTOZIK az allapot,
# tehat egy tartos piros nem spammel orankent.
#
# A LEGFONTOSABB TERVEZESI DONTES: a "nem tudtam megmerni" NEM ugyanaz, mint a "zold".
# Ha a `gh` elbukik, azt KIIRJA es ertesit -- nem hallgat el.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="${CI_WATCH_REPO:-/Users/isti/Projektek/sajat-crm}"
# THE REPO IS NAMED, NOT RESOLVED (card fd1d30af). REPO_DIR has two remotes (old-origin =
# the old sajat-crm, origin = Delta-CRM) and no `gh repo set-default`; the watcher asks by
# name so that the answer cannot depend on how gh resolves a remote today.
REPO_SLUG="${CI_WATCH_REPO_SLUG:-balintisti/Delta-CRM}"
STATE="${CI_WATCH_STATE:-$DIR/store/ci-watch-state.json}"
NOTIFY="${CI_WATCH_NOTIFY:-$DIR/scripts/notify.sh}"
BRANCH="${CI_WATCH_BRANCH:-main}"
# MELYIK munkafolyamatok szamitanak. Vesszovel elvalasztva; ures = MIND.
# Miert nem mind: az elso eles futas a "Dependabot Updates" 08-20-i bukasat talalta meg.
# Valodi, de NEM termeki CI -- es egy riaszto, ami hajnalban Dependabot-ugyben ebreszt,
# pontosan azt tanitja meg, hogy a riasztast figyelmen kivul kell hagyni.
# A ket termeki kapu: a CI es a telepites.
# `ALL` = mindet nezze. NEM ures sztringgel jelezzuk: a `${VAR:-alap}` az URESET IS
# alapertelmezettel potolja, tehat egy `CI_WATCH_WORKFLOWS=""` csendben visszaallna a
# szurt listara -- es a kontroll ugy nezne ki, mintha atment volna. (Merve, sajat hiba.)
WATCH_WORKFLOWS="${CI_WATCH_WORKFLOWS:-CI,Deploy to Cloud Run}"
[ "$WATCH_WORKFLOWS" = "ALL" ] && WATCH_WORKFLOWS=""

log() { printf '[ci-watch %s] %s\n' "$(date '+%F %T')" "$*"; }

command -v gh >/dev/null 2>&1 || { log "HIBA: nincs gh a PATH-on"; exit 1; }
[ -d "$REPO_DIR" ] || { log "HIBA: nincs ilyen repo: $REPO_DIR"; exit 1; }

# --- meres ---------------------------------------------------------------
# HAROM PROBA, mert egy atmeneti halozati pillanat NEM allapot. Merve 2026-08-25:
# az elso eles futasom `i/o timeout`-ot kapott az api.github.com fele, ket masodperccel
# kesobb ugyanaz a hivas hibatlanul ment. Egy ilyen villanas nem ebreszthet ejjel.
GH_RC=1; RAW=""
for _try in 1 2 3; do
  RAW="$(cd "$REPO_DIR" && gh run list --repo "$REPO_SLUG" --branch "$BRANCH" --limit 20 \
          --json conclusion,status,displayTitle,createdAt,url,workflowName,databaseId 2>&1)"
  GH_RC=$?
  [ $GH_RC -eq 0 ] && [ -n "$RAW" ] && [ "${RAW:0:1}" = "[" ] && break
  log "proba $_try sikertelen (rc=$GH_RC), ujraprobalom"
  sleep 5
done

if [ $GH_RC -ne 0 ] || [ -z "$RAW" ] || [ "${RAW:0:1}" != "[" ]; then
  # A MERES BUKOTT. Ez NEM zold. Ertesitunk rola, de csak ha valtozott.
  MSG="CI-figyelo: NEM TUDTAM MEGMERNI a(z) $BRANCH allapotat (gh rc=$GH_RC). Reszlet: ${RAW:0:200}"
  log "$MSG"
  python3 - "$STATE" "unmeasurable" "$MSG" "$NOTIFY" <<'PY'
import json, os, subprocess, sys
state_path, key, msg, notify = sys.argv[1:5]
try: st = json.load(open(state_path))
except Exception: st = {}
if st.get("last_key") != key:
    # AZ ERTESITES ELOSZOR, AZ ALLAPOT CSAK UTANA. Forditva egy bukott kuldes utan a dedupe
    # ORoKRE elnemitja ugyanezt a leletet, es a naplo kozben egeszsegesnek olvasodik.
    rc = subprocess.run(["bash", notify, msg]).returncode
    if rc != 0:
        print(f"[ci-watch] AZ ERTESITES BUKOTT (notify rc={rc}) -- az allapotot NEM leptetem, "
              "a kovetkezo futas ujraprobalja")
        sys.exit(1)
    st["last_key"] = key
    json.dump(st, open(state_path, "w"))
PY
  exit 1
fi

# --- ertelmezes ----------------------------------------------------------
python3 - "$RAW" "$STATE" "$NOTIFY" "$BRANCH" "$WATCH_WORKFLOWS" "$REPO_SLUG" <<'PY'
import json, subprocess, sys, time

raw, state_path, notify, branch, wf_filter, repo = sys.argv[1:7]
runs = json.loads(raw)
_print = print
def print(*a, **k):  # every line says WHEN and WHICH repo (card fd1d30af: the log had neither)
    _print(f"[ci-watch {time.strftime('%Y-%m-%d %H:%M:%S')} {repo}]", *a, **k)

watched = [w.strip() for w in wf_filter.split(",") if w.strip()]
if watched:
    runs = [r for r in runs if r["workflowName"] in watched]

# Munkafolyamatonkent a LEGUTOBBI befejezett futas -- egy meg futo nem mond allapotot.
latest = {}
for r in runs:
    wf = r["workflowName"]
    if wf in latest:
        continue
    if r["status"] != "completed":
        continue          # meg fut: nem allapot, atlepjuk a kovetkezo, regebbi futasra
    latest[wf] = r

if not latest:
    print("nincs BEFEJEZETT futas a lekert ablakban -- nem allitok semmit")
    sys.exit(0)

try:    st = json.load(open(state_path))
except Exception: st = {}

# AN OLDER ANSWER IS NOT A STATE CHANGE (card fd1d30af, Isti 4759). Measured 2026-10-01: the
# same `gh run list --branch main` returned, call after call, a newest run from 10-01, 09-25,
# 09-10 and even June, and the watcher reported each older picture as "ZOLD lett" -- green
# and red alternating every 10 minutes while main was red. A workflow's newest completed run
# can only move FORWARD; if an answer's is older than one already seen, the answer is stale
# (or the newer run is being re-run, which is not a state either). Logged, not believed.
seen_ids = st.get("last_run_id", {})
stale = {wf: (r.get("databaseId"), seen_ids[wf]) for wf, r in latest.items()
         if wf in seen_ids and r.get("databaseId") is not None and r["databaseId"] < seen_ids[wf]}
if stale:
    print("ELAVULT valasz, nem allapot: " + ", ".join(
        f"{wf} legujabb befejezett futasa {got} regebbi, mint a mar latott {have}"
        for wf, (got, have) in sorted(stale.items())))
    sys.exit(0)

# A MISSING WORKFLOW IS NOT MEASURABLE, NOT A STATE (card fd1d30af, didi 21638). The same
# unstable answer can also leave a watched workflow out entirely; the key then gets shorter,
# reads as a change, and an unchanged red main sent five identical alerts in five ticks
# (full / no-Deploy / full / no-Deploy / full). A workflow we have seen before and do not see
# now says nothing about main: logged, state not moved.
# The way out, so this guard is not a trap: if the same workflow stays missing for
# MISSING_ALERT_TICKS ticks in a row (renamed, deleted, or pushed out of the --limit window),
# that is said ONCE, and the streak restarts only after a full answer.
MISSING_ALERT_TICKS = 18   # 18 x 600 s = 3 hours
expected = watched or sorted(seen_ids)
missing = sorted(wf for wf in expected if wf in seen_ids and wf not in latest)
if missing:
    streak = st.get("missing_streak", 0) + 1
    st["missing_streak"] = streak
    print(f"NEM MERHETO: {', '.join(missing)} hianyzik a valaszbol ({streak}. egymas utani tick) "
          "-- nem ertesitek, az allapot nem lep")
    if streak == MISSING_ALERT_TICKS:
        msg = (f"CI-figyelo: a(z) {branch} agon {', '.join(missing)} {MISSING_ALERT_TICKS} egymas utani "
               "lekeresben hianyzott a GitHub valaszabol, ezert az allapotat nem tudom merni. "
               "Ha a munkafolyamatot atneveztek vagy toroltek, a CI_WATCH_WORKFLOWS-t kell igazitani.")
        rc = subprocess.run(["bash", notify, msg]).returncode
        if rc != 0:
            st["missing_streak"] = streak - 1   # retry the notice on the next tick
            print(f"AZ ERTESITES BUKOTT (notify rc={rc}) -- a kovetkezo futas ujraprobalja")
    json.dump(st, open(state_path, "w"), indent=1)
    sys.exit(0)
st.pop("missing_streak", None)

bad = {wf: r for wf, r in latest.items() if r["conclusion"] not in ("success", "skipped")}
key = "|".join(f"{wf}:{r['conclusion']}" for wf, r in sorted(latest.items()))
prev = st.get("last_key")

def remember_ids():
    ids = dict(seen_ids)
    for wf, r in latest.items():
        if r.get("databaseId") is not None:
            ids[wf] = max(ids.get(wf, 0), r["databaseId"])
    st["last_run_id"] = ids

if prev == key:
    print(f"valtozatlan ({len(bad)} rossz) -- nem ertesitek")
    remember_ids()
    json.dump(st, open(state_path, "w"), indent=1)
    sys.exit(0)

if bad:
    lines = [f"CI FIGYELMEZTETES a(z) {branch} agon:", ""]
    for wf, r in sorted(bad.items()):
        lines.append(f"{wf}: {r['conclusion']}")
        lines.append(f"  {r['displayTitle'][:90]}")
        lines.append(f"  {r['url']}")
    lines.append("")
    lines.append("(Csak allapotvaltozaskor szolok, tartos pirosnal nem ismetlem.)")
    msg = "\n".join(lines)
else:
    msg = (f"CI: a(z) {branch} agon minden munkafolyamat ZOLD lett.\n"
           + "\n".join(f"{wf}: {r['conclusion']}" for wf, r in sorted(latest.items())))

print("ALLAPOTVALTOZAS -> ertesites")
print(msg)
# UGYANAZ A SORREND, MINT FENT, es ugyanabbol az okbol: a `last_key` az a mezo, ami a MASODIK
# jelzest megakadalyozza. Ha a kuldes bukott, es MEGIS leptetjuk, a kovetkezo futas
# "valtozatlan (N rossz) -- nem ertesitek"-et ir, ami HELYESNEK olvasodik, es a riasztas elveszett.
rc = subprocess.run(["bash", notify, msg]).returncode
if rc != 0:
    print(f"AZ ERTESITES BUKOTT (notify rc={rc}) -- az allapotot NEM leptetem, "
          "a kovetkezo futas ujraprobalja")
    sys.exit(1)
st["last_key"] = key
remember_ids()
st["last_seen"] = {wf: r["conclusion"] for wf, r in latest.items()}
json.dump(st, open(state_path, "w"), indent=1)
PY

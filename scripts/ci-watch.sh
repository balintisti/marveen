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

log() { printf '[ci-watch] %s\n' "$*"; }

command -v gh >/dev/null 2>&1 || { log "HIBA: nincs gh a PATH-on"; exit 1; }
[ -d "$REPO_DIR" ] || { log "HIBA: nincs ilyen repo: $REPO_DIR"; exit 1; }

# --- meres ---------------------------------------------------------------
# HAROM PROBA, mert egy atmeneti halozati pillanat NEM allapot. Merve 2026-08-25:
# az elso eles futasom `i/o timeout`-ot kapott az api.github.com fele, ket masodperccel
# kesobb ugyanaz a hivas hibatlanul ment. Egy ilyen villanas nem ebreszthet ejjel.
GH_RC=1; RAW=""
for _try in 1 2 3; do
  RAW="$(cd "$REPO_DIR" && gh run list --branch "$BRANCH" --limit 20 \
          --json conclusion,status,displayTitle,createdAt,url,workflowName 2>&1)"
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
python3 - "$RAW" "$STATE" "$NOTIFY" "$BRANCH" "$WATCH_WORKFLOWS" <<'PY'
import json, subprocess, sys

raw, state_path, notify, branch, wf_filter = sys.argv[1:6]
runs = json.loads(raw)

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
    print("[ci-watch] nincs BEFEJEZETT futas a lekert ablakban -- nem allitok semmit")
    sys.exit(0)

bad = {wf: r for wf, r in latest.items() if r["conclusion"] not in ("success", "skipped")}
key = "|".join(f"{wf}:{r['conclusion']}" for wf, r in sorted(latest.items()))

try:    st = json.load(open(state_path))
except Exception: st = {}
prev = st.get("last_key")

if prev == key:
    print(f"[ci-watch] valtozatlan ({len(bad)} rossz) -- nem ertesitek")
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

print("[ci-watch] ALLAPOTVALTOZAS -> ertesites")
print(msg)
# UGYANAZ A SORREND, MINT FENT, es ugyanabbol az okbol: a `last_key` az a mezo, ami a MASODIK
# jelzest megakadalyozza. Ha a kuldes bukott, es MEGIS leptetjuk, a kovetkezo futas
# "valtozatlan (N rossz) -- nem ertesitek"-et ir, ami HELYESNEK olvasodik, es a riasztas elveszett.
rc = subprocess.run(["bash", notify, msg]).returncode
if rc != 0:
    print(f"[ci-watch] AZ ERTESITES BUKOTT (notify rc={rc}) -- az allapotot NEM leptetem, "
          "a kovetkezo futas ujraprobalja")
    sys.exit(1)
st["last_key"] = key
st["last_seen"] = {wf: r["conclusion"] for wf, r in latest.items()}
json.dump(st, open(state_path, "w"), indent=1)
PY

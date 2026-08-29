#!/usr/bin/env bash
# quota-ceiling-guard.sh -- keeps fleet work under an owner-set weekly-quota ceiling.
#
# WHY THIS EXISTS
# Isti lifted the fleet standstill for ONE agent (dexter) on 2026-08-26 with a hard
# condition: "csak figyeljunk a keretre, 95-6% fole ne menjunk vele". A condition that
# depends on somebody REMEMBERING to re-measure is not a condition, it is a hope -- and
# the coordinator's own session can restart, compact, or be busy for an hour at the exact
# moment the ceiling is crossed. So the ceiling gets a guard that runs on launchd,
# independently of any Claude session.
#
# ZERO CLAUDE TOKENS. Plain bash + curl + python3 for JSON. It never starts an agent turn,
# so the guard itself cannot consume the quota it is guarding. (Same reasoning as
# scripts/limit-monitor.sh.)
#
# TWO LEVELS, AND THE GAP BETWEEN THEM IS THE POINT
#   SOFT (default 93%) -> tell the agent to finish its current thread and stop.
#   HARD (default 95%) -> the owner's stated ceiling; repeat the stop and escalate.
# The soft level is deliberately BELOW the ceiling. An inter-agent message only lands in
# the recipient's IDLE gaps (see CLAUDE.md), so a working agent may not read it for tens
# of minutes; and one turn can still burn quota after the message is queued. Firing AT the
# ceiling would guarantee crossing it. The ~2-point gap is the room to actually stop.
#
# WHAT IT REFUSES TO DO: say "fine" when it cannot see.
# A stale or non-authoritative snapshot means the quota state is UNKNOWN. The guard does
# not treat unknown as safe -- it alerts the owner that it is blind. A guard that goes
# quiet exactly when its input breaks is the failure mode this whole repo is written
# against. (Note this is the OPPOSITE default from src/quota-gate.ts, on purpose: that gate
# fails OPEN so uncertainty never silences the fleet; this one is a CEILING, and an unknown
# reading cannot prove we are below it.)
#
# Usage: bash scripts/quota-ceiling-guard.sh [--dry-run] [--force-percent N]
#   --dry-run        run every check and print what WOULD be sent; send nothing.
#   --force-percent  pretend the weekly window reads N% (proves the guard fires without
#                    waiting for real quota pressure -- the control, not the event).

set -u

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$INSTALL_DIR/store"
# Overridable ONLY so the blind-path can be exercised against a throwaway file.
# The guard's most important behaviour is what it does when it CANNOT see, and that
# path must be provable without corrupting the live snapshot the fleet reads.
SNAPSHOT="${QUOTA_CEILING_SNAPSHOT:-$STORE/usage-latest.json}"
STATE="${QUOTA_CEILING_STATE:-$STORE/quota-ceiling-guard-state.json}"
LOG="$STORE/quota-ceiling-guard.log"

# Thresholds. Overridable from the environment so a changed owner instruction does not
# need a code edit -- but the defaults ARE the instruction as given on 2026-08-26.
SOFT_PCT="${QUOTA_CEILING_SOFT:-93}"
HARD_PCT="${QUOTA_CEILING_HARD:-95}"
# Agents this guard is allowed to stop. The standstill (card 11ef4c0a) covers everyone
# else already; this list is who was let OUT of it.
GUARDED_AGENTS="${QUOTA_CEILING_AGENTS:-dexter}"
# A snapshot older than this proves nothing about now.
MAX_AGE_MIN="${QUOTA_CEILING_MAX_AGE_MIN:-30}"

DRY_RUN=0
FORCE_PCT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force-percent) shift; FORCE_PCT="${1:-}" ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# Rounds a possibly-fractional number to an integer, shell-independently.
#
# NOT `printf '%.0f'`: the macOS system bash is 3.2, and ITS printf rejects a
# fractional argument outright ("87.0: invalid number") while zsh's accepts it.
# Measured 2026-08-26 -- and it mattered: the first version of this guard used
# printf, so every real reading (which is always fractional, e.g. "87.0") made
# the comparison fall through with an EMPTY value. The guard printed "under
# threshold" and would have printed it at 95.0% too. It looked correct in a
# hand-run because the hand-run was zsh; the launchd job is bash.
num_int() {
  python3 -c "import sys;print(int(round(float(sys.argv[1]))))" "$1" 2>/dev/null
}

log(){ echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
say(){ [ "$DRY_RUN" = 1 ] && echo "$*"; }

# --- refresh the snapshot if it is stale -------------------------------------------
# The dashboard writes usage-latest.json every ~10 min. If it stopped, the guard must not
# inherit its silence: it collects once itself. This is cheap and consumes no model tokens.
snapshot_age_min() {
  python3 - "$SNAPSHOT" <<'PY' 2>/dev/null || echo 99999
import sys, json, time, datetime
try:
    d = json.load(open(sys.argv[1]))
    t = d.get('generated_at')
    dt = datetime.datetime.fromisoformat(t.replace('Z', '+00:00'))
    print(int((time.time() - dt.timestamp()) / 60))
except Exception:
    print(99999)
PY
}

AGE="$(snapshot_age_min)"
if [ "$AGE" -gt "$MAX_AGE_MIN" ]; then
  log "snapshot ${AGE}min old (max ${MAX_AGE_MIN}), collecting fresh"
  say "snapshot stale (${AGE}min) -> running usage-collect.py"
  if [ -z "${QUOTA_CEILING_SNAPSHOT:-}" ]; then
    python3 "$INSTALL_DIR/scripts/usage-collect.py" >/dev/null 2>&1
    AGE="$(snapshot_age_min)"
  else
    say "(test snapshot in use -- not running usage-collect.py)"
  fi
fi

# --- read the weekly window ---------------------------------------------------------
read -r SOURCE PCT RESETS <<EOF
$(python3 - "$SNAPSHOT" <<'PY'
import sys, json
try:
    d = json.load(open(sys.argv[1]))
    c = d.get('claude') or {}
    w = (c.get('windows') or {}).get('seven_day') or {}
    print(c.get('source') or 'none', w.get('used_percent'), w.get('resets_at') or 0)
except Exception:
    print('none', 'None', 0)
PY
)
EOF

if [ -n "$FORCE_PCT" ]; then
  log "FORCED weekly percent: $FORCE_PCT (real: $PCT)"
  say "FORCED weekly percent: $FORCE_PCT (real reading was: $PCT)"
  PCT="$FORCE_PCT"
  SOURCE="authoritative"
  AGE=0
fi

# --- helpers ------------------------------------------------------------------------
notify_owner() {
  if [ "$DRY_RUN" = 1 ]; then echo "--- WOULD TELEGRAM ---"; echo "$1"; echo "----------------------"; return 0; fi
  bash "$INSTALL_DIR/scripts/notify.sh" "$1" >/dev/null 2>&1
}

stop_agent() {
  local agent="$1" body="$2"
  if [ "$DRY_RUN" = 1 ]; then echo "--- WOULD MESSAGE $agent ---"; echo "$body"; echo "----------------------"; return 0; fi
  printf '%s' "$body" | bash "$INSTALL_DIR/scripts/agent-msg.sh" marveen "$agent" - >>"$LOG" 2>&1
}

# Fire each level at most once per weekly window. The window id is the reset timestamp:
# when the quota rolls over, the id changes and the guard arms itself again -- no manual
# state reset, and no way for a stale "already alerted" flag to silence the next window.
WINDOW_ID="$(num_int "${RESETS:-0}")"
already_fired() {
  python3 - "$STATE" "$WINDOW_ID" "$1" <<'PY'
import sys, json, os
p, win, lvl = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(p))
except Exception:
    d = {}
print('yes' if d.get('window') == win and lvl in (d.get('fired') or []) else 'no')
PY
}
mark_fired() {
  [ "$DRY_RUN" = 1 ] && return 0
  python3 - "$STATE" "$WINDOW_ID" "$1" <<'PY'
import sys, json
p, win, lvl = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(p))
except Exception:
    d = {}
if d.get('window') != win:
    d = {'window': win, 'fired': []}
if lvl not in d['fired']:
    d['fired'].append(lvl)
json.dump(d, open(p, 'w'), indent=2)
PY
}

# --- BLIND CHECK: the guard must never imply "below the ceiling" when it cannot see ---
if [ "$SOURCE" != "authoritative" ] && [ "$SOURCE" != "authoritative_cached" ]; then
  log "BLIND: source=$SOURCE (not authoritative) -- cannot prove we are under the ceiling"
  say "BLIND: source=$SOURCE"
  if [ "$(already_fired blind)" = "no" ]; then
    notify_owner "KERET-OR: NEM LATOK.

A heti keret leolvasasa nem hiteles forrasbol jon (source: $SOURCE), tehat NEM tudom
bizonyitani, hogy a 95%-os plafon alatt vagyunk. Ez nem azt jelenti, hogy baj van: azt
jelenti, hogy az or vak.

Amit tenni erdemes: nezd meg a dashboardot, vagy szolj, es kezzel megmerem.
(Az or 10 percenkent ujraprobal. Ezt az uzenetet ablakonkent egyszer kuldi.)"
    mark_fired blind
  fi
  exit 0
fi

if [ "$AGE" -gt "$MAX_AGE_MIN" ]; then
  log "BLIND: snapshot still ${AGE}min old after refresh attempt"
  say "BLIND: stale snapshot (${AGE}min)"
  if [ "$(already_fired blind)" = "no" ]; then
    notify_owner "KERET-OR: NEM LATOK.

A keret-pillanatfelvetel ${AGE} perce nem frissult, es a sajat frissitesi kiserletem sem
hozott ujat. Tehat NEM tudom bizonyitani, hogy a 95%-os plafon alatt vagyunk.

Valoszinu ok: a dashboard nem fut, vagy a usage-collect.py hibara fut.
(Az or 10 percenkent ujraprobal. Ezt az uzenetet ablakonkent egyszer kuldi.)"
    mark_fired blind
  fi
  exit 0
fi

if [ "$PCT" = "None" ] || [ -z "$PCT" ]; then
  # Caught by src/__tests__/quota-ceiling-guard.test.ts, not by review: this branch
  # originally logged and exited SILENTLY. A guard whose input went missing and said
  # nothing is indistinguishable from a guard reporting "all clear" -- the exact shape
  # the rest of this file is written against, reproduced inside the guard itself.
  log "BLIND: no weekly percent in snapshot"
  say "BLIND: no weekly percent in snapshot"
  if [ "$(already_fired blind)" = "no" ]; then
    notify_owner "KERET-OR: NEM LATOK.

A keret-pillanatfelvetelben NINCS heti szazalek (a mezo ures vagy hianyzik), tehat NEM
tudom bizonyitani, hogy a 95%-os plafon alatt vagyunk. Az or vak, nem nyugodt.

Valoszinu ok: a usage-collect.py lefutott, de a heti ablakot nem tudta leolvasni.
(Az or 10 percenkent ujraprobal. Ezt az uzenetet ablakonkent egyszer kuldi.)"
    mark_fired blind
  fi
  exit 0
fi

# --- the actual comparison ----------------------------------------------------------
PCT_INT="$(num_int "$PCT")"
if [ -z "$PCT_INT" ]; then
  # Could not turn the reading into a number. That is not "we are fine" -- it is
  # the same blindness as a stale snapshot, and it must say so out loud.
  log "BLIND: weekly percent '$PCT' is not a number"
  say "BLIND: weekly percent '$PCT' is not a number"
  if [ "$(already_fired blind)" = "no" ]; then
    notify_owner "KERET-OR: NEM LATOK.

A heti keret leolvasott erteke ('$PCT') nem ertelmezheto szamkent, tehat NEM tudom
bizonyitani, hogy a 95%-os plafon alatt vagyunk. Az or vak, nem nyugodt.

(Az or 10 percenkent ujraprobal. Ezt az uzenetet ablakonkent egyszer kuldi.)"
    mark_fired blind
  fi
  exit 0
fi
log "weekly=${PCT}% source=$SOURCE age=${AGE}min soft=$SOFT_PCT hard=$HARD_PCT window=$WINDOW_ID"
say "weekly=${PCT}%  source=$SOURCE  age=${AGE}min  soft=$SOFT_PCT  hard=$HARD_PCT"

RESET_HUMAN="$(python3 -c "
import sys, datetime
try:
    print(datetime.datetime.fromtimestamp(float('${RESETS:-0}')).strftime('%Y-%m-%d %H:%M'))
except Exception:
    print('ismeretlen')
")"

# Who is actually running? Nothing to stop if the session is not there.
running_agents=""
for a in $GUARDED_AGENTS; do
  if tmux has-session -t "agent-$a" 2>/dev/null; then running_agents="$running_agents $a"; fi
done
running_agents="${running_agents# }"

if [ "$PCT_INT" -ge "$HARD_PCT" ]; then
  say "LEVEL: HARD"
  if [ "$(already_fired hard)" = "no" ]; then
    for a in $running_agents; do
      stop_agent "$a" "[KERET-OR / HARD] ALLJ MEG MOST.

A heti keret ${PCT}%-on all. Isti plafonja 95-96%, tehat ELERTUK.

Amit tegyel, ebben a sorrendben:
1. NE kezdj uj tool-hivast. A futo gondolatot fejezd be, ne a futo FELADATOT.
2. Amit eddig csinaltal, ird fel a kartyara EGY kommentben -- ez tulel egy restartot,
   a beszelgetes nem.
3. Utana allj meg. Ne vegyel fel uj tetelt.

A keret ujul: $RESET_HUMAN. Addig a leallas (kartya 11ef4c0a) rad is ervenyes.
Ezt az uzenetet egy launchd-or kuldte, nem en gepeltem be -- de a tartalma az en dontesem."
    done
    notify_owner "KERET-OR: ELERTUK A PLAFONT ($PCT%).

Megallitottam: ${running_agents:-nincs futo agens}.

A heti keret ${PCT}%-on all, a te plafonod 95-96% volt. Az ujulas: $RESET_HUMAN.

Amit az agens csinal: felirja a kartyara, ahol tart, es megall. Nem szakitok felbe futo
fordulot -- egy felbehagyott szal tobbe kerul, mint az a fel szazalek, amit megsporolna.

Ha ugy dontesz, hogy megis mehet tovabb, szolj, es feloldom."
    mark_fired hard
  else
    say "(hard already fired for this window)"
  fi
  exit 0
fi

if [ "$PCT_INT" -ge "$SOFT_PCT" ]; then
  say "LEVEL: SOFT"
  if [ "$(already_fired soft)" = "no" ]; then
    for a in $running_agents; do
      stop_agent "$a" "[KERET-OR / LAGY] FEJEZD BE A FUTO SZALAT, ES ALLJ MEG.

A heti keret ${PCT}%-on all. Isti plafonja 95-96%, tehat kb. ${HARD_PCT}-ig van ut.
Ez NEM vesz-leallas: azert szolok most, hogy legyen idod rendesen lezarni.

Amit tegyel:
1. A FUTO tetelt fejezd be, ha kb. egy orai munka. Ha nem, akkor allj meg ott, ahol vagy.
2. Ird fel a kartyara, hol tartasz es mi a kovetkezo lepes. Egy kommentben, konkretan.
3. Uj tetelt NE vegyel fel.

A keret ujul: $RESET_HUMAN. Utana folytathatod.
Ezt az uzenetet egy launchd-or kuldte, nem en gepeltem be -- de a tartalma az en dontesem."
    done
    notify_owner "KERET-OR: kozeledunk a plafonhoz ($PCT%).

Szoltam ennek: ${running_agents:-nincs futo agens} -- fejezze be a futo szalat es alljon meg.

Miert most es nem 95-nel: az agens-uzenet csak akkor er celba, amikor az agens ket
fordulo kozott van, es egy fordulo alatt is fogy a keret. Ha 95-nel szolnek, atlepnenk.
Igy van kb. ket szazaleknyi ut a rendes megallasra.

A keret ujul: $RESET_HUMAN. Nem kell tenned semmit, csak tudj rola."
    mark_fired soft
  else
    say "(soft already fired for this window)"
  fi
  exit 0
fi

say "LEVEL: none (under soft threshold)"
log "under soft threshold, nothing to do"
exit 0

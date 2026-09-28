#!/bin/bash
# Disk-space guard for the host (systemd --user timer, every minute).
#
# Incident it fixes (2026-06-03 dawn): the root filesystem filled to 100% from a
# 2.2G orphaned /tmp/health_* Apple Health export (the apple-health skill's
# scratch cleanup didn't run). A full root wedged the main session in a /mcp
# modal and every disk-touching watchdog gave false signals. This guard is the
# independent net: it reaps known-safe scratch BEFORE the disk fills, and when it
# can't recover it alerts the owner over the DIRECT Telegram Bot API (the in-session
# MCP plugin is dead under disk-full).
#
# Determinism + safety:
#   - Thresholds are constants at the top.
#   - Reaping is restricted to an explicit allowlist of scratch globs AND an age
#     guard, so a CURRENTLY-RUNNING export (recent mtime) is never deleted -- only
#     orphans are reaped. Never recurses outside the scratch dir.
#   - Alerts go via direct Bot API (token from channels/.env), never via MCP.
#   - Every stamp/log write is best-effort: under ENOSPC a failed write must not
#     wedge or crash the guard (that is the whole point).
#
# Test hooks (env, used only by scripts/__tests__/disk-space-guard.test.sh):
#   DISK_GUARD_USAGE_OVERRIDE   - use this usage% instead of df (integer)
#   DISK_GUARD_SCRATCH_DIR      - reap base dir (default /tmp)
#   DISK_GUARD_STATE_DIR        - cooldown-stamp dir (default <install>/store)
#   DISK_GUARD_REAP_MIN_AGE_MIN - override the reap age guard (minutes)
#   DISK_GUARD_ALERT_DRYRUN     - if 1, print "ALERT_DRYRUN: <msg>" not curl

set -u

# --- thresholds (tunable constants) ---
# DISK_PATH is NOT a constant any more -- see below, right after SCRATCH_DIR.
# >= this %: reap safe scratch. Env-overridable for ONE reason: without it no test
# can exercise main()'s OWN decision on a real measurement -- it would have to fake
# the measurement instead, which is exactly how the /-vs-data-volume defect stayed
# green (didi, 2026-09-19). NOTE THE DIFFERENCE IN KIND between the two hooks:
# DISK_GUARD_USAGE_OVERRIDE REPLACES the thing under test; this one only moves an
# unrelated constant so the real thing runs. A test may use this one and still be
# a measurement.
REAP_THRESHOLD="${DISK_GUARD_REAP_THRESHOLD:-90}"
ALERT_THRESHOLD=95       # >= this % (after reap): alert the owner directly
REAP_MIN_AGE_MIN="${DISK_GUARD_REAP_MIN_AGE_MIN:-30}"   # only reap orphans older than this
# Numeric-validate the age guard BEFORE use: a malformed env (e.g. "abc", "-1")
# OR literal 0 must NOT degrade into "reap everything" (-mmin +0 matches an
# in-progress export). Fall back to a very conservative day.
case "$REAP_MIN_AGE_MIN" in (''|0|*[!0-9]*) REAP_MIN_AGE_MIN=1440;; esac
# Same validation for the threshold, and for the same reason -- but note the two
# bad values fail in OPPOSITE directions, so neither may survive: 0 (or "abc"
# read as 0) means REAP EVERY TICK, while 900 means NEVER REAP, silently, on a
# guard whose whole job is to act. Both fall back to the documented default.
case "$REAP_THRESHOLD" in (''|0|*[!0-9]*) REAP_THRESHOLD=90;; esac
[ "$REAP_THRESHOLD" -gt 100 ] && REAP_THRESHOLD=90
ALERT_COOLDOWN=3600      # at most one disk-full alert per hour

# Explicit allowlist of scratch globs reaped under SCRATCH_DIR (maxdepth 1).
# Space-separated env override DISK_GUARD_REAP_GLOBS; the default targets the
# apple-health analysis scratch that caused the original incident. Extend
# deliberately -- every entry here is `rm -rf`-able once age-guarded.
if [ -n "${DISK_GUARD_REAP_GLOBS:-}" ]; then
  read -r -a REAP_GLOBS <<< "$DISK_GUARD_REAP_GLOBS"
else
  REAP_GLOBS=("health_*")
fi

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH_DIR="${DISK_GUARD_SCRATCH_DIR:-/tmp}"
# THE VOLUME WE MEASURE MUST BE THE VOLUME WE REAP FROM -- derived, never a
# separate constant that can drift away from SCRATCH_DIR unnoticed.
#
# It WAS a separate constant (`DISK_PATH="/"`), and on macOS that is the wrong
# volume: `/` is the read-only system volume while /tmp (-> /private/tmp) and
# /Users live on /System/Volumes/Data. Measured 2026-09-19 on this host (didi,
# card fbbbca3c): df / = 7%, df /tmp = 62%. Worse than a wrong label -- APFS
# shares free space inside the container, so `/`'s Capacity is
# used_system/(used_system+free) and only reaches the 90% reap threshold when
# ~1.4 GB of free space is left, i.e. at ~99.7% of the data volume. The original
# 2026-06-03 incident (a 2.2 GB orphan under /tmp) moves df / by 0 percentage
# points, so the guard would have reaped nothing and alerted nobody.
# On Linux /tmp is normally on / and this derivation changes nothing.
DISK_PATH="$SCRATCH_DIR"
STATE_DIR="${DISK_GUARD_STATE_DIR:-$INSTALL_DIR/store}"
ALERT_STAMP="$STATE_DIR/.disk-guard-alerted"
# Overridable for ONE reason: the alert path is the only path in this guard that
# reaches the outside world, and a test of it must not be able to send. Pointed at
# an empty file, alert_owner finds no token and returns before curl -- so the test
# is safe even if the refusal below is broken, which is the state a test of a
# refusal has to survive. Also lets a manual end-to-end check run against a test bot.
# #915 (upstream 2997022b): main channel state is install-scoped once migrated;
# the legacy shared path only serves unmigrated installs. The test override above
# still wins over both.
TG_CHAN_DIR="${TELEGRAM_STATE_DIR:-}"
if [ -z "$TG_CHAN_DIR" ]; then
  TG_CHAN_DIR="$INSTALL_DIR/.claude/channels/telegram"
  [ -f "$TG_CHAN_DIR/.env" ] || TG_CHAN_DIR="$HOME/.claude/channels/telegram"
fi
TG_ENV="${DISK_GUARD_TG_ENV:-$TG_CHAN_DIR/.env}"
LOG_TAG="disk-space-guard"

# CHATID0 (upstream b49d4c5d): the owner chat id comes from resolve_owner_chat_id.
. "$(cd "$(dirname "$0")" && pwd)/lib/owner-chat.sh"

# THE COORDINATOR FIRST, THE OWNER AS FALLBACK (card b610c593, marveen 2026-09-25 04:38): the same
# routing as the idle guard's 45101873 -- "Isti cannot do anything with the disk at night; I can".
# Resolved the way backup.sh does (src/env.ts: .env MAIN_AGENT_ID, default "marveen").
MAIN_AGENT_ID="marveen"
if [ -f "$INSTALL_DIR/.env" ]; then
  _mid="$(grep -E '^[[:space:]]*MAIN_AGENT_ID[[:space:]]*=' "$INSTALL_DIR/.env" | tail -1 \
    | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' || true)"
  [ -n "${_mid:-}" ] && MAIN_AGENT_ID="$_mid"
fi
# Test hooks: the tmux binary (the "is the coordinator running" probe), and a SENDER executable
# that takes the message on stdin and prints "OK id=<n>" like agent-msg.sh -- so a test exercises
# this routing without ever writing to the live dashboard queue.
# LAUNCHD'S PATH IS /usr/bin:/bin:/usr/sbin:/sbin (`launchctl print`, default environment), and
# Homebrew's tmux is not on it. The bare `tmux` exited 127 under launchd, 2>/dev/null hid it, and on
# 2026-09-26 every one of 9 alerts logged "coordinator ... is not running" while it ran -- all 9 went
# to the owner. So: PATH first, then the known install dirs; and an empty result is said, not guessed.
TMUX_SEARCH="${DISK_GUARD_TMUX_SEARCH:-/opt/homebrew/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin}"
resolve_tmux() {
  local d
  if [ -n "${DISK_GUARD_TMUX_BIN:-}" ]; then echo "$DISK_GUARD_TMUX_BIN"; return; fi
  command -v tmux 2>/dev/null && return
  local IFS=:
  for d in $TMUX_SEARCH; do [ -x "$d/tmux" ] && { echo "$d/tmux"; return; }; done
  return 0
}
TMUX_BIN="$(resolve_tmux)"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [$LOG_TAG] $*" || true; }

# REAL usage% of the measured volume (0-100). No override reaches this: it is the
# line the whole test suite used to hide, so `--probe` calls it directly.
real_disk_usage() {
  df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}'
}

# Mount point of the measured volume -- what the probe and the alert text name,
# so "which volume did you look at" is answerable from the output alone.
disk_mount() {
  df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {print $6}'
}

# Current usage% of DISK_PATH (0-100), or the test override.
disk_usage() {
  if [ -n "${DISK_GUARD_USAGE_OVERRIDE:-}" ]; then
    echo "$DISK_GUARD_USAGE_OVERRIDE"; return
  fi
  real_disk_usage
}

# Reap age-guarded scratch matching the allowlist. Prints how many entries it
# removed. Defensive: only operates strictly under SCRATCH_DIR, maxdepth 1, and
# only on entries matching an allowlisted glob older than REAP_MIN_AGE_MIN.
reap_scratch() {
  local glob removed=0 path real
  [ -d "$SCRATCH_DIR" ] || { echo 0; return; }
  # HARD location guard: reaping is only ever allowed inside the system scratch
  # tree. Resolve symlinks and require the REAL path to be /tmp or
  # $XDG_RUNTIME_DIR (or a dir directly beneath them); refuse a symlinked
  # SCRATCH_DIR outright. A misconfigured/hostile DISK_GUARD_SCRATCH_DIR can then
  # never aim the reaper at real data.
  [ -L "$SCRATCH_DIR" ] && { echo 0; return; }
  # realpath is not on every host -> fall back to readlink -f, then `cd && pwd -P`.
  real="$(realpath "$SCRATCH_DIR" 2>/dev/null \
        || readlink -f "$SCRATCH_DIR" 2>/dev/null \
        || (cd "$SCRATCH_DIR" 2>/dev/null && pwd -P))"
  [ -z "$real" ] && { echo 0; return; }
  case "$real/" in
    /tmp/*) : ;;
    # SHTEST807: on macOS /tmp is a symlink to /private/tmp, so every resolved
    # scratch path starts with /private/tmp and the /tmp/* arm never matches --
    # the reaper was a silent no-op on every macOS install. /private/tmp does
    # not exist on Linux, so this arm is inert there.
    /private/tmp/*) : ;;
    "${XDG_RUNTIME_DIR:-/nonexistent-xdg}"/*) : ;;
    *) echo 0; return ;;
  esac
  for glob in "${REAP_GLOBS[@]}"; do
    while IFS= read -r -d '' path; do
      # Guard: the path must live directly under SCRATCH_DIR (no traversal).
      case "$path" in
        "$SCRATCH_DIR"/*) : ;;
        *) continue ;;
      esac
      # A directory's own mtime does NOT change when files INSIDE it are written,
      # so a long-running export dir can look "old" by mtime while still active.
      # Skip a matched DIRECTORY if it contains ANY file newer than the age guard.
      if [ -d "$path" ] && [ ! -L "$path" ]; then
        if find "$path" -type f -mmin "-$REAP_MIN_AGE_MIN" -print -quit 2>/dev/null | grep -q .; then
          continue   # has a recently-written file -> in-progress, leave it
        fi
      fi
      rm -rf -- "$path" 2>/dev/null && removed=$((removed + 1)) || true
    done < <(find "$SCRATCH_DIR" -maxdepth 1 -name "$glob" -mmin "+$REAP_MIN_AGE_MIN" -print0 2>/dev/null)
  done
  echo "$removed"
}

# DIRECT-BOT-API alert (mirrors channel-watchdog.sh alert_owner). Bypasses MCP
# because under disk-full the in-session plugin cannot send.
alert_owner() {
  local msg="$1" token chat
  if [ "${DISK_GUARD_ALERT_DRYRUN:-}" = "1" ]; then
    echo "ALERT_DRYRUN: $msg"; return 0
  fi
  # A PLANTED PERCENTAGE IS NOT A DISK. DISK_GUARD_USAGE_OVERRIDE exists for tests,
  # and a test that forgets DISK_GUARD_ALERT_DRYRUN would otherwise send the owner a
  # real Telegram about a fake full disk -- which nearly happened while this very
  # file was being tested (friday, 2026-09-19: a new case ran the guard without the
  # dryrun flag, reached here with a planted 101%, and only missed because the chat
  # id happened to be empty). Discipline held six times and had to hold a seventh.
  #
  # The refusal NAMES THE WAY OUT, because the one legitimate use of a planted
  # percentage is checking that the Telegram wiring really works end to end -- on a
  # guard whose entire job is to alert, that is a thing you must be able to do.
  if [ -n "${DISK_GUARD_USAGE_OVERRIDE:-}" ] && [ "${DISK_GUARD_ALLOW_FAKE_ALERT:-}" != "1" ]; then
    log "ALERT REFUSED: usage is a planted value (DISK_GUARD_USAGE_OVERRIDE=${DISK_GUARD_USAGE_OVERRIDE}), not a real disk. Set DISK_GUARD_ALLOW_FAKE_ALERT=1 if you mean to test the wiring for real: $msg"
    return 1
  fi
  # Token from the channels env, never hardcoded. Owner chat id via
  # resolve_owner_chat_id (CHATID0): the old direct ALLOWED_CHAT_ID/
  # TELEGRAM_CHAT_ID reads let the installer's "0" placeholder through
  # unnoticed, and skipped the access.json fallback entirely.
  # `tr -d '\r '` strips a trailing CR (CRLF-edited .env) / stray spaces so the
  # token doesn't corrupt the URL.
  token="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$TG_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r ')"
  # The resolver's reason line stays on stderr (the guard's log), not
  # /dev/null: a skipped alert must say why (no DM entry, several DM entries,
  # no access.json). Not captured with 2>&1 -- any stderr noise on the success
  # path would then become part of the chat id.
  chat="$(resolve_owner_chat_id "$INSTALL_DIR/.env")" || chat=""
  if [ -z "$token" ] || [ -z "$chat" ]; then
    log "ALERT (no bot token or owner chat id configured, could not Telegram): $msg"; return 1
  fi
  # A curl KILEPESI KODJA NEM MONDJA MEG, HOGY A TELEGRAM ELFOGADTA-E: 0-val ter vissza
  # egy HTTP 400-ra is. A korabbi `curl ... && log "owner alerted"` alak ezert SIKERT
  # naplozott egy elutasitott kuldesre -- pontosan az az alak, amit a `4be2027c` a
  # notify.sh-ban mar megszuntetett (lasd scripts/notify.sh:71-93), csak ez a NAPLOBA
  # hazudott, nem a stdoutra. Es ugyanabbol a forrasbol olvas (ALLOWED_CHAT_ID, :130),
  # tehat a `0`-s chat-id koraban ez is nemán elveszett, sikert naplozva.
  #
  # Ez az EGYETLEN or, ami akkor szolal meg, amikor a lemez betelt. Ha a riasztasa nem
  # megy ki, es kozben azt naplozza, hogy kiment, akkor a legrosszabb pillanatban vagyunk
  # vakok -- ugy, hogy a naplo megnyugtat.
  #
  # NINCS ATMENETI FAJL: a valasz vegig valtozoban marad. A szkript fejlece kikoti, hogy
  # ENOSPC alatt egy elbukott iras nem akaszthatja meg az ort -- egy tmp-fajl epp azt
  # szegné meg, amiert ez a szkript letezik.
  local resp code body okf rc desc
  resp="$(curl -s -m 10 -w '\n%{http_code}' "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat}" --data-urlencode "text=${msg}")"
  rc=$?
  code="$(printf '%s' "$resp" | tail -n1)"
  body="$(printf '%s' "$resp" | sed '$d')"
  case "$body" in (*'"ok":true'*) okf=1;; (*) okf=0;; esac

  # 200 ES `"ok":true` -- mindketto kell. A Telegram ad 200-at hibaval is, es ad
  # `ok:false`-t 200 alatt is; kulon-kulon egyik sem eleg.
  if [ "$rc" = "0" ] && [ "$code" = "200" ] && [ "$okf" = "1" ]; then
    log "owner alerted via direct Bot API (delivery confirmed)"
    return 0
  fi
  # A `rc` valasztja szet a ket bukast, amit a regi alak egyformanak mutatott:
  # rc!=0 = a curl el sem jutott odaig (6 nev, 7 kapcsolat, 28 idotullepes);
  # rc=0 + code!=200 = elert, es a Telegram ELUTASITOTTA.
  desc="$(printf '%s' "$body" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p')"
  log "ALERT sendMessage FAILED (curl_rc=${rc} HTTP=${code:-none} ok=${okf}${desc:+ -- $desc}): $msg"
  return 1
}

# The coordinator, through agent-msg.sh -- the one path that checks HTTP code AND id and says
# "OK id=<n>" (fleet-page-guard.sh uses it for the same reason; a bare curl exits 0 on a 403).
# `--force` because this is the one alert that must not be held back by the courtesy queue gate.
# Returns non-zero -- and the owner gets it -- when the coordinator is NOT RUNNING (a letter in a
# queue nobody reads is the idle guard's lesson, 45101873) or the send fails. Note agent-msg.sh uses
# mktemp: on a truly full disk this path can fail, and the fallback below uses no files at all.
alert_coordinator() {
  local msg="$1" out rc
  if [ -z "$TMUX_BIN" ]; then
    log "cannot find tmux (PATH=$PATH; searched $TMUX_SEARCH) -- cannot tell whether the coordinator runs; the owner gets this alert"
    return 1
  fi
  # rc 1 is tmux's "no such session"; anything else is a probe that did not answer.
  "$TMUX_BIN" has-session -t "${MAIN_AGENT_ID}-channels" 2>/dev/null; rc=$?
  if [ "$rc" = "1" ]; then
    log "coordinator session ${MAIN_AGENT_ID}-channels is not running -- the owner gets this alert"
    return 1
  elif [ "$rc" != "0" ]; then
    log "tmux probe failed (rc=${rc}, $TMUX_BIN) -- cannot tell whether the coordinator runs; the owner gets this alert"
    return 1
  fi
  if [ -n "${DISK_GUARD_COORD_SENDER:-}" ]; then
    out="$(printf '%s' "$msg" | "$DISK_GUARD_COORD_SENDER" 2>&1)"; rc=$?
  elif [ "${DISK_GUARD_ALERT_DRYRUN:-}" = "1" ]; then
    echo "ALERT_DRYRUN(coordinator): $msg"; return 0
  else
    # the same refusal as alert_owner: a planted percentage is not a disk
    if [ -n "${DISK_GUARD_USAGE_OVERRIDE:-}" ] && [ "${DISK_GUARD_ALLOW_FAKE_ALERT:-}" != "1" ]; then
      log "ALERT REFUSED (coordinator): usage is a planted value, not a real disk: $msg"; return 1
    fi
    out="$(printf '%s' "$msg" | bash "$INSTALL_DIR/scripts/agent-msg.sh" "$MAIN_AGENT_ID" "$MAIN_AGENT_ID" - --force 2>&1)"; rc=$?
  fi
  if [ "$rc" = "0" ]; then
    case "$out" in (*"OK id="*) log "coordinator alerted ($(printf '%s' "$out" | grep -o 'OK id=[0-9]*' | head -1))"; return 0;; esac
  fi
  log "coordinator alert FAILED (rc=${rc}) -- the owner gets this alert"
  return 1
}

alert_route() {
  alert_coordinator "$1" || alert_owner "$1"
}

main() {
  local usage removed now last
  # Ensure the state dir exists UP FRONT so the cooldown stamp write below always
  # succeeds. Otherwise (missing STATE_DIR) the stamp never persists, `last` stays
  # 0 every tick, and a stuck-full disk re-alerts up to 60x/hour.
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  usage="$(disk_usage)"
  # A DERIVED DISK_PATH CAN CEASE TO EXIST, which the old constant "/" could not:
  # point DISK_GUARD_SCRATCH_DIR at a missing dir and df has nothing to report.
  # The guard then does nothing -- correct (it must not guess a volume), but it
  # must SAY WHICH PATH it could not read, or the log blames the number instead of
  # the configuration. Pinned by test (m).
  case "$usage" in (''|*[!0-9]*) log "could not read disk usage of '$DISK_PATH' (got '$usage') -- no-op"; return 0;; esac

  # ALERTGATE926 (card 0c8ff24b): the ALERT must not hang off the REAP threshold.
  # The live plist turns the reap off with DISK_GUARD_REAP_THRESHOLD=100, and the old
  # early return (`usage < REAP -> return`) sat BEFORE the alert branch, so switching the
  # reap off switched the 95% alert off too: 2026-09-26 the disk stood at 98% for hours
  # with a 0-byte log. Now: nothing to do only when BOTH thresholds are unmet; the reap
  # runs only at/above its own threshold; the alert branch below runs at/above 95%
  # whether or not a reap happened.
  if [ "$usage" -lt "$REAP_THRESHOLD" ] && [ "$usage" -lt "$ALERT_THRESHOLD" ]; then
    return 0   # plenty of room
  fi

  removed=0
  if [ "$usage" -ge "$REAP_THRESHOLD" ]; then
    log "disk ${usage}% >= ${REAP_THRESHOLD}% -- reaping scratch under $SCRATCH_DIR"
    removed="$(reap_scratch)"
    log "reaped $removed scratch entr$( [ "$removed" = 1 ] && echo y || echo ies )"
    usage="$(disk_usage)"
    log "post-reap disk ${usage}%"
  else
    log "disk ${usage}% >= alert ${ALERT_THRESHOLD}% (reap off: threshold ${REAP_THRESHOLD}%)"
  fi

  if [ "$usage" -ge "$ALERT_THRESHOLD" ]; then
    # Cooldown so a stuck-full disk alerts at most once/hour (best-effort stamp).
    now="$(date +%s)"
    last=0; [ -f "$ALERT_STAMP" ] && last="$(cat "$ALERT_STAMP" 2>/dev/null || echo 0)"
    case "$last" in (''|*[!0-9]*) last=0;; esac
    if [ $(( now - last )) -ge "$ALERT_COOLDOWN" ]; then
      # A BELYEG CSAK SIKERRE MEGY KI. Korabban feltetel nelkul iródott, tehat egy
      # ELBUKOTT riasztas is elhasznalta a teljes orat: a kovetkezo 59 tick "within
      # alert cooldown"-t naplozott volna, es a gazda soha nem tudja meg, hogy tele a
      # lemez. Ez nem kulon hiba, hanem UGYANANNAK a hianyzo visszateresi-ertek-
      # ellenorzesnek a masodik fele -- amig az `alert_owner` nem tudott nemet mondani,
      # ezt nem is lehetett megirni.
      #
      # AZ ARA, KIMONDVA: egy tartosan bukó riasztasi ut mostantol MINDEN ticken ujraprobal
      # (a timer kadenciaja szerint), tehat elbukott alertenkent egy naplosor. Ez szandekos:
      # a lemez ilyenkor TELE van, es egy nem kezbesitett veszjelzes ujraprobalasa pontosan
      # az, amiert ez az or letezik. A csendes elhallgatas volt a hiba.
      if alert_route "🔴 Disk space critical: ${SCRATCH_DIR} (volume $(disk_mount)) is at ${usage}% ($( [ "$REAP_THRESHOLD" -ge 100 ] && echo "reap off" || echo "after reaping ${removed} scratch item(s)" )). Manual cleanup needed -- a full disk can wedge the channel session (deafness)."; then
        echo "$now" > "$ALERT_STAMP" 2>/dev/null || true
      else
        log "alert did NOT go out -- cooldown stamp NOT written, will retry next tick"
      fi
    else
      log "disk ${usage}% critical but within alert cooldown ($(( now - last ))s) -- skip alert"
    fi
  fi
}

# --probe: report what this guard WOULD measure, and act on nothing. It bypasses
# DISK_GUARD_USAGE_OVERRIDE on purpose -- a probe that could be fed a fake number
# would let the test suite "cover" the df line without ever running it.
if [ "${1:-}" = "--probe" ]; then
  echo "PROBE scratch=$SCRATCH_DIR mount=$(disk_mount) usage=$(real_disk_usage) reap_at=${REAP_THRESHOLD} alert_at=${ALERT_THRESHOLD} tmux=${TMUX_BIN:-none}"
  exit 0
fi

main "$@"
exit 0

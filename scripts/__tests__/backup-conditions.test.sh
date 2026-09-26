#!/bin/bash
# The three success conditions of scripts/backup.sh (card fb315ca6, marveen's ruling 2026-09-24):
#   the archive is owner-only (0600), the newest 14 are kept, and 0 agent files is a FAILED run.
# Run: bash scripts/__tests__/backup-conditions.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${HERE}/../backup.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
T="$(mktemp -d)"; trap 'rm -rf "${T}"' EXIT

fixture() {  # fixture <dir> -- a fresh install tree with one agent that has a page
  mkdir -p "$1/scripts" "$1/agents/a1" "$1/home"
  cp "${SRC}" "$1/scripts/backup.sh"
  echo page > "$1/agents/a1/CLAUDE.md"
  echo X=1 > "$1/.env"
}
run() { HOME="$1/home" bash "$1/scripts/backup.sh" >"$1/out" 2>&1; echo $?; }
mode() { python3 -c "import os,sys;print(oct(os.stat(sys.argv[1]).st_mode & 0o777))" "$1"; }

# 1. owner-only archive -- even when the caller's umask is permissive
F="${T}/one"; fixture "${F}"
rc=$(umask 022; run "${F}")
arc="$(ls "${F}"/backups/claudeclaw-*.tar.gz | head -1)"
[ "${rc}" = "0" ] && ok "a normal run exits 0" || bad "normal run rc=${rc}: $(cat "${F}/out")"
[ "$(mode "${arc}")" = "0o600" ] && ok "archive is 0600" || bad "archive mode $(mode "${arc}")"
[ "$(mode "${F}/backups")" = "0o700" ] && ok "backups/ dir is 0700 when this run creates it" || bad "backups/ mode $(mode "${F}/backups")"
grep -q "agent files 1" "${F}/out" && ok "the summary line names the agent-file count" || bad "no count in: $(cat "${F}/out")"

# 2. retention: 15 older archives + this run -> the newest 14 stay
F="${T}/keep"; fixture "${F}"; mkdir -p "${F}/backups"
for i in $(seq -w 1 15); do
  f="${F}/backups/claudeclaw-202601${i}-000000.tar.gz"; echo old > "$f"
  touch -t "202601${i}0000" "$f"
done
rc=$(run "${F}")
n=$(ls "${F}"/backups/claudeclaw-*.tar.gz | wc -l | tr -d ' ')
[ "${n}" = "14" ] && ok "14 archives remain" || bad "${n} archives remain"
[ ! -e "${F}/backups/claudeclaw-20260101-000000.tar.gz" ] && ok "the OLDEST was pruned" || bad "oldest still there"
ls "${F}"/backups/claudeclaw-2026*.tar.gz | grep -vq "202601" && ok "this run's archive is among them" || bad "new archive pruned"

# 3. agent dirs exist, 0 agent files collected -> exit 3, archive still written
F="${T}/zero"; fixture "${F}"; rm "${F}/agents/a1/CLAUDE.md"
rc=$(run "${F}")
[ "${rc}" = "3" ] && ok "0 agent files -> exit 3" || bad "0 agent files rc=${rc}"
ls "${F}"/backups/claudeclaw-*.tar.gz >/dev/null 2>&1 && ok "the archive is still written (db and tokens are worth keeping)" || bad "no archive"
grep -q "FAILED CONDITION" "${F}/out" && ok "the failure is named" || bad "failure not named: $(cat "${F}/out")"

# 3c. the same failure on the EARLY path: agents exist, and there is nothing else to archive either
F="${T}/empty"; fixture "${F}"; rm "${F}/agents/a1/CLAUDE.md" "${F}/.env"
rc=$(run "${F}")
[ "${rc}" = "3" ] && ok "agents but nothing to archive at all -> exit 3, not a quiet 0" || bad "early path rc=${rc}"

# 4. PER AGENT (didi): two agent dirs, one collected -> exit 3, and the empty one is NAMED
F="${T}/half"; fixture "${F}"; mkdir -p "${F}/agents/a2"; echo x > "${F}/agents/a2/notes.txt"
rc=$(run "${F}")
[ "${rc}" = "3" ] && ok "one of two agents with no files -> exit 3 (the total 1 used to pass)" || bad "half rc=${rc}: $(cat "${F}/out")"
grep -q "no files collected for agent(s): a2" "${F}/out" && ok "the empty agent is named" || bad "empty agent not named: $(cat "${F}/out")"
grep -q "agents with NO files: a2" "${F}/out" && ok "the summary line names it too" || bad "summary: $(cat "${F}/out")"
# 4b. CONTROL: both agents contribute -> 0, and a prefix-sharing name does not cover for another
F="${T}/both"; fixture "${F}"; mkdir -p "${F}/agents/a10"; echo p > "${F}/agents/a10/CLAUDE.md"
rc=$(run "${F}")
[ "${rc}" = "0" ] && ok "every agent contributes -> exit 0" || bad "both rc=${rc}: $(cat "${F}/out")"
F="${T}/prefix"; fixture "${F}"; rm "${F}/agents/a1/CLAUDE.md"; mkdir -p "${F}/agents/a10"; echo p > "${F}/agents/a10/CLAUDE.md"
rc=$(run "${F}")
[ "${rc}" = "3" ] && grep -q "agent(s): a1 " "${F}/out" && ok "a10's files do not count for a1" || bad "prefix rc=${rc}: $(cat "${F}/out")"

# 5. agent-config.json is collected (ef6a93dc): an agent whose ONLY file is its config still counts
F="${T}/cfg"; fixture "${F}"; rm "${F}/agents/a1/CLAUDE.md"; echo '{"model":"x"}' > "${F}/agents/a1/agent-config.json"
rc=$(run "${F}")
arc="$(ls "${F}"/backups/claudeclaw-*.tar.gz | head -1)"
[ "${rc}" = "0" ] && ok "agent-config.json alone counts for its agent" || bad "cfg rc=${rc}: $(cat "${F}/out")"
tar -tzf "${arc}" | grep -q '^repo/agents/a1/agent-config.json$' && ok "agent-config.json is IN the archive" || bad "not archived: $(tar -tzf "${arc}")"

# 6. workcheck.json too (didi, ef6a93dc): without it a restored agent is invisible to the idle guard
F="${T}/wc"; fixture "${F}"; echo '{"kind":"assigned_open_cards"}' > "${F}/agents/a1/workcheck.json"
rc=$(run "${F}")
arc="$(ls "${F}"/backups/claudeclaw-*.tar.gz | head -1)"
[ "${rc}" = "0" ] && tar -tzf "${arc}" | grep -q '^repo/agents/a1/workcheck.json$' && ok "workcheck.json is IN the archive" || bad "workcheck not archived rc=${rc}: $(tar -tzf "${arc}")"

# 3b. CONTROL: no agents dir at all (a fresh machine) is not that failure
F="${T}/fresh"; fixture "${F}"; rm -rf "${F}/agents"
rc=$(run "${F}")
[ "${rc}" = "0" ] && ok "no agents at all -> exit 0 (fresh machine)" || bad "fresh machine rc=${rc}"

TOTAL=$((PASS + FAIL))
echo "Results: ${PASS}/${TOTAL} passed"
if [ "${FAIL}" -gt 0 ]; then echo "FAILED: ${FAIL} tests"; exit 1; fi

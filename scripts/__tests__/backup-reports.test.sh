#!/bin/bash
# The agents' reports in the daily archive, FAIL-CLOSED (card 23bd6a95, Isti 2026-10-04: no GitHub copy,
# the offsite one instead). The archive is what backup-offsite.py encrypts and uploads, so a report tree
# that is missing from it, or stale in it, is missing from the offsite copy too.
#
# The snapshot repo in every fixture is built by the REAL scripts/agent-reports-snapshot.sh, not by hand:
# a hand-made repo would test the check against my idea of the producer.
# Run: bash scripts/__tests__/backup-reports.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${HERE}/../backup.sh"
SNAP="${HERE}/../agent-reports-snapshot.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
T="$(mktemp -d)"; trap 'rm -rf "${T}"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

OLD=202601010000   # touch -t: far older than the grace period
fixture() {  # fixture <dir> -- an install with one agent holding two old report files, snapshotted
  mkdir -p "$1/scripts" "$1/agents/a1/reports/sub" "$1/home/Backups"
  cp "${SRC}" "$1/scripts/backup.sh"
  # the stub records that an alert was queued and what it said
  printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "%s/alerts"\nexit 0\n' "$1" > "$1/scripts/agent-msg.sh"
  chmod +x "$1/scripts/agent-msg.sh"
  echo page > "$1/agents/a1/CLAUDE.md"; echo X=1 > "$1/.env"
  mkdir -p "$1/store" "$1/home/.claude/skills" "$1/home/.claude/scheduled-tasks"; echo db > "$1/store/claudeclaw.db"
  echo one > "$1/agents/a1/reports/one.md"
  echo two > "$1/agents/a1/reports/sub/my report (1).md"      # a name that is a regex in disguise
  touch -t "${OLD}" "$1/agents/a1/reports/one.md" "$1/agents/a1/reports/sub/my report (1).md"
}
snapshot() {  # snapshot <dir> -- the real producer, into <dir>/home/Backups/agent-reports
  local r="$1/home/Backups/agent-reports"
  [ -d "${r}/.git" ] || git init -q "${r}"
  REPORTS_REPO="${r}" REPORTS_MARVEEN_ROOT="$1" REPORTS_NOTIFY=/dev/null bash "${SNAP}" >/dev/null 2>&1
}
run() { HOME="$1/home" bash "$1/scripts/backup.sh" >"$1/out" 2>&1; echo $?; }
archive() { ls "$1"/backups/claudeclaw-*.tar.gz 2>/dev/null | head -1; }

# 1. CONTROL: sources and a current snapshot -> exit 0, and the reports (with history) are IN the archive
F="${T}/ok"; fixture "${F}"; snapshot "${F}"
rc=$(run "${F}"); arc="$(archive "${F}")"
[ "${rc}" = "0" ] && ok "sources + a current snapshot -> exit 0" || bad "control rc=${rc}: $(cat "${F}/out")"
tar -tzf "${arc}" | grep -qxF 'home/Backups/agent-reports/a1/one.md' && ok "a report file is IN the archive" || bad "one.md not archived"
tar -tzf "${arc}" | grep -qxF 'home/Backups/agent-reports/a1/sub/my report (1).md' && ok "a name with spaces and brackets is archived too" || bad "odd name not archived"
tar -tzf "${arc}" | grep -qxF 'home/Backups/agent-reports/.git/HEAD' && ok "the snapshot's git history is in the archive" || bad "no .git in the archive"
tar -xzOf "${arc}" MANIFEST.txt | grep -q 'agent reports: 2 source files, 2 compared byte for byte, snapshot HEAD ' && ok "the manifest says what was compared" || bad "manifest: $(tar -xzOf "${arc}" MANIFEST.txt | tail -3)"

# 2. reports exist, no snapshot repo at all -> exit 7, archive still written, the cause named, an alert queued
F="${T}/nosnap"; fixture "${F}"
rc=$(run "${F}")
[ "${rc}" = "7" ] && ok "report files but no snapshot repo -> exit 7" || bad "nosnap rc=${rc}: $(cat "${F}/out")"
[ -n "$(archive "${F}")" ] && ok "the archive is still written" || bad "no archive"
grep -q 'no snapshot repo at' "${F}/out" && ok "the cause is named" || bad "cause not named: $(cat "${F}/out")"
grep -q 'riport-resze NEM teljes' "${F}/alerts" 2>/dev/null && ok "an alert is queued for the coordinator" || bad "no alert queued"

# 3. a snapshot repo that tracks nothing is not a snapshot
F="${T}/emptysnap"; fixture "${F}"; git init -q "${F}/home/Backups/agent-reports"
rc=$(run "${F}")
[ "${rc}" = "7" ] && grep -q 'tracks none' "${F}/out" && ok "an empty snapshot repo -> exit 7" || bad "emptysnap rc=${rc}: $(cat "${F}/out")"

# 4. STALE: a source older than the grace period changed after the snapshot -> exit 7, named
F="${T}/stale"; fixture "${F}"; snapshot "${F}"
echo changed > "${F}/agents/a1/reports/one.md"; touch -t "${OLD}" "${F}/agents/a1/reports/one.md"
rc=$(run "${F}")
[ "${rc}" = "7" ] && ok "an old source that differs from the snapshot -> exit 7" || bad "stale rc=${rc}: $(cat "${F}/out")"
grep -q '1 of 2 report files' "${F}/out" && grep -q 'a1/one.md' "${F}/out" && ok "the stale file is counted and named" || bad "stale not named: $(cat "${F}/out")"
# 4b. CONTROL: the same change, but FRESH -- the snapshot job may not have reached it yet
F="${T}/fresh"; fixture "${F}"; snapshot "${F}"
echo changed > "${F}/agents/a1/reports/one.md"          # mtime now
rc=$(run "${F}")
[ "${rc}" = "0" ] && ok "a fresh change is not held against the snapshot (grace)" || bad "fresh rc=${rc}: $(cat "${F}/out")"
tar -xzOf "$(archive "${F}")" MANIFEST.txt | grep -q '1 compared byte for byte' && ok "... and the manifest shows only the old file was compared" || bad "compared count"
# 4c. the grace BOUNDARY, both sides (trillian 31619): "old" and "now" above are both far from 35 minutes,
#     so a grace of 0, 2000 or 36000 passed them all. 20 minutes is inside the grace, 50 is past it.
F="${T}/inside"; fixture "${F}"; snapshot "${F}"
echo changed > "${F}/agents/a1/reports/one.md"; touch -t "$(date -v-20M +%Y%m%d%H%M)" "${F}/agents/a1/reports/one.md"
rc=$(run "${F}")
[ "${rc}" = "0" ] && ok "a change 20 min old is still inside the grace -> exit 0" || bad "inside rc=${rc}: $(cat "${F}/out")"
F="${T}/outside"; fixture "${F}"; snapshot "${F}"
echo changed > "${F}/agents/a1/reports/one.md"; touch -t "$(date -v-50M +%Y%m%d%H%M)" "${F}/agents/a1/reports/one.md"
rc=$(run "${F}")
[ "${rc}" = "7" ] && grep -q 'a1/one.md' "${F}/out" && ok "a change 50 min old is past the grace -> exit 7, named" || bad "outside rc=${rc}: $(cat "${F}/out")"

# 5. a NEW old report the snapshot never mirrored
F="${T}/newfile"; fixture "${F}"; snapshot "${F}"
echo three > "${F}/agents/a1/reports/three.md"; touch -t "${OLD}" "${F}/agents/a1/reports/three.md"
rc=$(run "${F}")
[ "${rc}" = "7" ] && grep -q 'a1/three.md' "${F}/out" && ok "an old report missing from the snapshot -> exit 7, named" || bad "newfile rc=${rc}: $(cat "${F}/out")"

# 6. CONTROL: no reports anywhere and no snapshot -> nothing to cover, exit 0 (a fresh install must not fail)
F="${T}/none"; fixture "${F}"; rm -rf "${F}/agents/a1/reports"
rc=$(run "${F}")
[ "${rc}" = "0" ] && ok "no report files at all and no snapshot -> exit 0" || bad "none rc=${rc}: $(cat "${F}/out")"

# 7. a torn copy: the snapshot's history does not connect (an object file is missing)
F="${T}/torn"; fixture "${F}"; snapshot "${F}"
obj="$(find "${F}/home/Backups/agent-reports/.git/objects" -type f -path '*/??/*' | head -1)"
rm -f "${obj}"
rc=$(run "${F}")
[ "${rc}" = "7" ] && grep -q 'connectivity check, twice' "${F}/out" && ok "a history that does not connect -> exit 7 (checked on the COPY, copied twice)" || bad "torn rc=${rc}: $(cat "${F}/out")"
# 7b. the copy torn ONCE (the snapshot job committed mid-copy), whole on the second copy -> exit 0, and the
#     repo is in the archive. A git shim fails the FIRST fsck only; everything else goes to the real git.
F="${T}/torn-once"; fixture "${F}"; snapshot "${F}"; mkdir -p "${F}/bin"
printf '#!/bin/bash\nif [ "$1" = "-C" ] && [ "$3" = "fsck" ] && [ ! -e "%s/fsck-failed" ]; then : > "%s/fsck-failed"; exit 1; fi\nexec "%s" "$@"\n' \
  "${F}" "${F}" "$(command -v git)" > "${F}/bin/git"; chmod +x "${F}/bin/git"
rc=$(PATH="${F}/bin:${PATH}" run "${F}")
[ -e "${F}/fsck-failed" ] && ok "the first connectivity check really failed (shim fired)" || bad "the shim never saw an fsck"
[ "${rc}" = "0" ] && ! grep -q 'connectivity check' "${F}/out" && ok "a copy torn once and whole the second time -> exit 0, no alert" || bad "torn-once rc=${rc}: $(cat "${F}/out")"
tar -tzf "$(archive "${F}")" | grep -qxF 'home/Backups/agent-reports/.git/HEAD' && ok "... and the second copy is the one in the archive" || bad "torn-once: no .git in the archive"

# 8. exit 3 (an agent with no files) and exit 7 together: the lower, older code stays, BOTH are said
F="${T}/both"; fixture "${F}"; rm "${F}/agents/a1/CLAUDE.md"
rc=$(run "${F}")
[ "${rc}" = "3" ] && grep -q 'no files collected for agent' "${F}/out" && grep -q 'reports are not covered' "${F}/out" && ok "exit 3 and a reports failure together: exit 3, both named" || bad "both rc=${rc}: $(cat "${F}/out")"

# 9. the SAME population as the snapshot job: a report that is a symlink (find -L) is mirrored by it, so a
#    stale one must be caught here too -- a plain `find` would not even see it
F="${T}/link"; fixture "${F}"; mkdir -p "${F}/elsewhere"
echo target > "${F}/elsewhere/linked.md"; touch -t "${OLD}" "${F}/elsewhere/linked.md"
ln -s "${F}/elsewhere/linked.md" "${F}/agents/a1/reports/linked.md"; snapshot "${F}"
echo changed > "${F}/elsewhere/linked.md"; touch -t "${OLD}" "${F}/elsewhere/linked.md"
rc=$(run "${F}")
[ "${rc}" = "7" ] && grep -q 'a1/linked.md' "${F}/out" && ok "a stale symlinked report is caught (same population as the snapshot job)" || bad "link rc=${rc}: $(cat "${F}/out")"

echo "Results: ${PASS}/$((PASS + FAIL)) passed"
[ "${FAIL}" = "0" ]

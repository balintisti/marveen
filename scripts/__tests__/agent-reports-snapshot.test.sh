#!/bin/bash
# Card b511e460 -- agent-reports-snapshot.sh. Fixture install, fixture repo, stub notify:
# nothing here reads the real reports or the real backup repository. Runs under /bin/bash
# (3.2), which is what launchd uses.
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/agent-reports-snapshot.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
ok(){ printf '  ok   %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  FAIL %s\n' "$1"; FAIL=$((FAIL+1)); }

M="$T/marveen"; R="$T/repo"; mkdir -p "$M/agents/alfa/reports/sub" "$T/shared-beta/reports"
# beta's agent dir is a SYMLINK, the way every real sub-agent's is (-> /Users/Shared/marveen-<name>)
ln -s "$T/shared-beta" "$M/agents/beta"
for i in 1 2 3 4 5 6 7; do echo "alfa $i" > "$M/agents/alfa/reports/r$i.md"; done
echo "nested" > "$M/agents/alfa/reports/sub/deep.md"
echo "beta one" > "$T/shared-beta/reports/b1.md"
echo "with space" > "$T/shared-beta/reports/b 2.md"
git init -q "$R" && git -C "$R" config user.name t && git -C "$R" config user.email t@t
NOTIFIED="$T/notified.txt"
printf '#!/bin/bash\necho "$*" >> "%s"\n' "$NOTIFIED" > "$T/notify.sh"; chmod +x "$T/notify.sh"
run() { REPORTS_REPO="$R" REPORTS_MARVEEN_ROOT="$M" REPORTS_NOTIFY="$T/notify.sh" REPORTS_LOCK_DIR="$T/lock" \
          /bin/bash "$SCRIPT" 2>"$T/err.txt"; }
commits() { git -C "$R" rev-list --count HEAD 2>/dev/null || echo 0; }

echo "== the ordinary path =="
run; rc=$?
[ "$rc" -eq 0 ] && ok "first snapshot rc=0" || no "first snapshot rc=$rc: $(cat "$T/err.txt")"
[ "$(git -C "$R" ls-files | wc -l | tr -d ' ')" = 10 ] && ok "all 10 files committed" || no "committed: $(git -C "$R" ls-files | wc -l)"
[ "$(cat "$R/beta/b 2.md" 2>/dev/null)" = "with space" ] && ok "the symlinked agent and a name with a space are copied" || no "beta/b 2.md missing"
[ -f "$R/alfa/sub/deep.md" ] && ok "nested paths keep their structure" || no "alfa/sub/deep.md missing"
C=$(commits); run
[ "$(commits)" = "$C" ] && ok "no change -> no empty commit" || no "an empty commit was written"
echo "changed" > "$M/agents/alfa/reports/r1.md"; run
[ "$(commits)" = $((C + 1)) ] && [ "$(cat "$R/alfa/r1.md")" = changed ] && ok "an edit is committed" || no "the edit was not committed"
rm "$M/agents/alfa/reports/r7.md"; run
[ ! -f "$R/alfa/r7.md" ] && ! git -C "$R" ls-files | grep -q r7.md && ok "a SMALL deletion (1 of 10) is committed" || no "the small deletion was not committed"
# captured, not piped into grep -q: under pipefail the early exit SIGPIPEs git log and reads as "no history"
HIST=$(git -C "$R" log --all --format=%H -- alfa/r7.md)
[ "$(printf '%s\n' "$HIST" | grep -c .)" -ge 2 ] && ok "...and the deleted file stays in history (added + deleted)" || no "r7.md history: '$HIST'"

echo "== the deletion guard =="
H=$(git -C "$R" rev-parse HEAD); rm -f "$NOTIFIED"
mkdir -p "$T/aside" && mv "$M/agents/alfa/reports/"r[2-6].md "$T/aside/"
run; rc=$?
[ "$rc" -eq 4 ] && ok "5 of 9 vanished -> refused (rc=4)" || no "mass deletion rc=$rc"
[ "$(git -C "$R" rev-parse HEAD)" = "$H" ] && [ -f "$R/alfa/r2.md" ] && ok "the repo is untouched" || no "the repo changed on a refused run"
grep -q "eltunt" "$NOTIFIED" 2>/dev/null && ok "an alert went out, naming the loss" || no "no alert on the refused run"
mv "$T/aside/"r*.md "$M/agents/alfa/reports/"
rm -f "$NOTIFIED"
REPORTS_REPO="$R" REPORTS_MARVEEN_ROOT="$T/no-such-root" REPORTS_NOTIFY="$T/notify.sh" REPORTS_LOCK_DIR="$T/lock" /bin/bash "$SCRIPT" 2>/dev/null; rc=$?
[ "$rc" -eq 4 ] && grep -q "URES" "$NOTIFIED" 2>/dev/null && ok "an EMPTY source (wrong root) is refused and alerted" || no "empty source rc=$rc"
[ "$(git -C "$R" rev-parse HEAD)" = "$H" ] && ok "...and commits nothing" || no "the empty source changed the repo"
run; [ "$(git -C "$R" rev-parse HEAD)" = "$H" ] && ok "CONTROL: the restored sources match the repo again (no commit)" || no "restore produced a commit"

echo "== local only, enforced =="
git -C "$R" remote add origin https://example.invalid/reports.git
echo "new" > "$M/agents/alfa/reports/r8.md"; rm -f "$NOTIFIED"
run; rc=$?
[ "$rc" -eq 3 ] && ok "a repo WITH a remote is refused (rc=3)" || no "remote rc=$rc"
[ "$(git -C "$R" rev-parse HEAD)" = "$H" ] && grep -q "Isti" "$NOTIFIED" 2>/dev/null && ok "...nothing committed, and the alert says whose decision it is" || no "remote case committed or did not alert"
git -C "$R" remote remove origin
run; [ -f "$R/alfa/r8.md" ] && ok "CONTROL: without the remote the same run commits" || no "control run did not commit"

echo "== the lock =="
mkdir "$T/lock" && echo $$ > "$T/lock/pid"
echo "locked" > "$M/agents/alfa/reports/r9.md"; C=$(commits)
run; rc=$?
[ "$rc" -eq 0 ] && [ "$(commits)" = "$C" ] && ok "a LIVE lock -> exit 0, nothing committed" || no "live lock rc=$rc"
echo 999999 > "$T/lock/pid"; run
[ -f "$R/alfa/r9.md" ] && [ ! -d "$T/lock" ] && ok "a STALE lock is broken, the run commits and releases it" || no "stale lock not handled"

echo
echo "  $PASS ok, $FAIL bukott"
[ "$FAIL" -eq 0 ]

#!/usr/bin/env bash
# applies-cleanly.sh -- does THIS ONE commit still apply to THAT target, right now?
#
# WHY IT EXISTS (card 64968e12, measured 2026-08-29). mandark reviewed 15 commits against
# three conditions. Two of them are properties of the COMMIT and keep; the third --
# APPLICABILITY -- is a property of the TARGET, and the target moved 293 commits under him
# while he worked. Re-measured, 4 of the 15 conflicted. jarvis had verified three separate
# ways at 20:05 that the head had not moved, and was right at the time. What caught it was
# not a check but an anomaly: a test reporting "0 matches" for a file that should exist.
#
# So applicability belongs immediately BEFORE the merge, not inside a review pass, and it
# has to be cheap enough to re-run there. This is that, in ten seconds.
#
# WHAT IT CANNOT DO, and this is not a footnote:
#   * It asks whether ONE commit applies to the target. It has NO question about whether
#     TWO commits stand in a relationship. Two that each apply cleanly are fine together,
#     but one ALONE can still produce a tree that does not compile -- the classic shape is
#     a commit whose ten files import a module that a DIFFERENT, un-merged commit creates.
#     A clean answer here is not a promise that the result builds.
#   * It does not run tests, does not judge whether a commit SHOULD land, and changes
#     nothing. It is a meter.
#
# THE INVOCATION IS THE WHOLE TRICK, and the obvious one is wrong (measured on the four
# commits above, target 5df66d8a):
#     git merge-tree --write-tree <target> <commit>                    -> 3 of 4 CLEAN
#     git merge-tree --write-tree --merge-base=<commit>^ <t> <commit>  -> 4 of 4 CONFLICT
# Without --merge-base the command merges the commit's whole BRANCH into the target, using
# their common ancestor -- a different question, and one that errs toward "clean", which is
# the comfortable direction. With the commit's own parent as the base, the three-way merge
# carries exactly that commit's change. That is the question a cherry-pick asks.
#
# Usage:
#   scripts/applies-cleanly.sh --target <ref> [--repo <path>] <commit> [<commit>...]
#   git log --format=%H a..b | scripts/applies-cleanly.sh --target <ref> --stdin
#   scripts/applies-cleanly.sh --self-check          # proves the meter can say BOTH answers
#
# Exit: 0 = every commit clean or already in     1 = at least one conflict
#       2 = usage / unknown ref / unknown commit  <- NEVER an empty list, see below
set -uo pipefail

REPO="."; TARGET=""; STDIN=0; SELFCHECK=0; COMMITS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --repo)   REPO="${2:-}"; shift 2 ;;
    --stdin)  STDIN=1; shift ;;
    --self-check) SELFCHECK=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    -*) echo "ismeretlen kapcsolo: $1" >&2; exit 2 ;;
    *) COMMITS+=("$1"); shift ;;
  esac
done

git_() { git -C "$REPO" "$@"; }

self_check() {
  # A PORTABLE control: builds a throwaway repo, so it proves the MECHANISM rather than
  # one repo's history. A meter that only ever says "clean" would pass any test made of
  # clean cases; this asserts BOTH answers and the error exit.
  local d; d="$(mktemp -d)"; trap 'rm -rf "$d"' RETURN
  git -C "$d" init -q .
  git -C "$d" config user.email t@t; git -C "$d" config user.name t
  printf 'egy\nketto\nharom\n' > "$d/f.txt"; git -C "$d" add f.txt; git -C "$d" commit -qm base
  local base; base=$(git -C "$d" rev-parse HEAD)
  printf 'egy\nKETTO-A\nharom\n' > "$d/f.txt"; git -C "$d" commit -qam A; local a; a=$(git -C "$d" rev-parse HEAD)
  git -C "$d" checkout -q "$base"
  printf 'egy\nKETTO-B\nharom\n' > "$d/f.txt"; git -C "$d" commit -qam B; local b; b=$(git -C "$d" rev-parse HEAD)
  git -C "$d" checkout -q "$base"
  printf 'egy\nketto\nharom\nNEGY\n' > "$d/f.txt"; git -C "$d" commit -qam C; local c; c=$(git -C "$d" rev-parse HEAD)
  # A FOURTH shape, and it is the one that pins the --merge-base flag itself: a candidate
  # whose BRANCH carries an earlier conflicting commit, while the candidate ITSELF touches
  # a different file. Asking about the branch (merge-tree without --merge-base) answers
  # CONFLICT -- caused by P, not by the candidate. Asking about the commit answers CLEAN.
  # Without this case a mutation removing --merge-base leaves every control green, which
  # is exactly what happened the first time this was mutated.
  git -C "$d" checkout -q "$base"
  printf 'egy\nUTKOZO-P\nharom\n' > "$d/f.txt"; git -C "$d" commit -qam P
  printf 'mas fajl\n' > "$d/g.txt"; git -C "$d" add g.txt; git -C "$d" commit -qm D
  local dd; dd=$(git -C "$d" rev-parse HEAD)

  local fail=0 got
  # A failing control PRINTS WHAT IT GOT. A control that only says "failed" sends the
  # reader back to reproduce it by hand, which is how a control stops being run.
  REPO="$d"; TARGET="$a"
  # NEGATIVE: A and B change the same line from the same base -> must conflict
  got=$(judge "$b"); case "$got" in
    CONFLICT*) echo "  ok  negativ: ugyanaz a sor -> CONFLICT" ;;
    *) echo "  BUKIK negativ: vart CONFLICT, kapott: $got"; fail=1 ;;
  esac
  # POSITIVE: C touches a different line -> must be clean
  got=$(judge "$c"); case "$got" in
    CLEAN*) echo "  ok  pozitiv: masik sor -> CLEAN" ;;
    *) echo "  BUKIK pozitiv: vart CLEAN, kapott: $got"; fail=1 ;;
  esac
  # ALREADY: the target's own commit is already in
  got=$(judge "$a"); case "$got" in
    ALREADY*) echo "  ok  mar benne: ALREADY" ;;
    *) echo "  BUKIK: vart ALREADY, kapott: $got"; fail=1 ;;
  esac
  # A COMMIT KERDESE, NEM AZ AGE: D csak egy uj fajlt ad hozza, de az AGAN elotte all egy
  # utkozo commit. Ha ez CONFLICT-ot ad, akkor az agrol kerdeztunk, nem a commitrol.
  got=$(judge "$dd"); case "$got" in
    CLEAN*) echo "  ok  commit-kerdes: az agon levo IDEGEN utkozes nem szamit bele" ;;
    *) echo "  BUKIK commit-kerdes: vart CLEAN, kapott: $got  (a --merge-base hianyzik?)"; fail=1 ;;
  esac
  # ERROR: a ref that does not exist must NOT come back as an empty, clean-looking list
  if ( REPO="$d" TARGET="nincs-ilyen-ref" ; git -C "$d" rev-parse --verify -q "nincs-ilyen-ref^{commit}" >/dev/null ); then
    echo "  BUKIK: a nem letezo ref feloldodott"; fail=1
  else echo "  ok  nem letezo ref: nem oldodik fel (a fo ag ilyenkor exit 2)"; fi
  return $fail
}

judge() { # <commit> -> one line
  local c="$1" short subj base out rc n
  short=$(git_ rev-parse --short "$c" 2>/dev/null) || { echo "ERROR|$c|ismeretlen commit"; return 2; }
  subj=$(git_ log -1 --format=%s "$c" 2>/dev/null | cut -c1-60)
  if git_ merge-base --is-ancestor "$c" "$TARGET" 2>/dev/null; then
    echo "ALREADY $short  $subj"; return 0
  fi
  base=$(git_ rev-parse --verify -q "${c}^" 2>/dev/null)
  if [ -z "$base" ]; then echo "ERROR|$short|gyoker-commit (nincs szuloje), egyedul nem merheto"; return 2; fi
  out=$(git_ merge-tree --write-tree --merge-base="$base" "$TARGET" "$c" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then echo "CLEAN   $short  $subj"; return 0; fi
  n=$(printf '%s\n' "$out" | grep -cE '^[0-7]{6} ' || true)
  echo "CONFLICT $short  ($n utkozo bejegyzes)  $subj"; return 1
}

if [ "$SELFCHECK" = 1 ]; then
  echo "onellenorzes (eldobhato repo, a MECHANIZMUSRA):"
  self_check; rc=$?
  [ $rc -eq 0 ] && echo "MINDEN KONTROLL RENDBEN" || echo "KONTROLL BUKOTT"
  exit $rc
fi

[ -n "$TARGET" ] || { echo "hasznalat: --target <ref> [--repo <path>] <commit>..." >&2; exit 2; }
git_ rev-parse --git-dir >/dev/null 2>&1 || { echo "nem git repo: $REPO" >&2; exit 2; }
# A NEM LETEZO REF NEM URES LISTA. Egy ures kimenet ugyanugy nez ki, mint a "minden
# tiszta" -- ez a lap tobb helyen rogzitett, legdragabb alak.
git_ rev-parse --verify -q "${TARGET}^{commit}" >/dev/null || { echo "nincs ilyen cel-ref: $TARGET" >&2; exit 2; }

if [ "$STDIN" = 1 ]; then while read -r l; do [ -n "$l" ] && COMMITS+=("$l"); done; fi
[ ${#COMMITS[@]} -gt 0 ] || { echo "nincs commit a listaban (se argumentum, se stdin)" >&2; exit 2; }

echo "cel: $(git_ rev-parse --short "$TARGET")  ($(git_ log -1 --format=%s "$TARGET" | cut -c1-50))"
echo "merve: $(date '+%Y-%m-%d %H:%M:%S %Z')   -- a valasz a CEL allapotara vonatkozik, es a cel mozog"
worst=0
for c in "${COMMITS[@]}"; do
  line=$(judge "$c"); rc=$?
  echo "$line"
  [ $rc -gt $worst ] && worst=$rc
done
exit $worst

#!/usr/bin/env bash
# EVIDGUARD818 -- idempotent installer: run the secret gate before every commit.
# Auto-run by scripts/sync-hooks.sh on update, same as install-git-guard-hook.sh.
#
# THIS HOOK IS THE FAST LANE, NOT THE GATE. It is skippable with
# `git commit --no-verify`, so the authoritative check is the CI job on the PR
# (.github/workflows/secret-gate.yml). Both call the same scanner.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)" && pwd)/hooks"
DISPATCH="$HOOK_DIR/pre-commit"
GUARD="$HOOK_DIR/pre-commit.d/10-secret-gate"
MARK="marveen-pre-commit-dispatcher"
mkdir -p "$HOOK_DIR/pre-commit.d"

# 1. The sub-hook: scan what is staged.
cat > "$GUARD" <<'EOF'
#!/usr/bin/env bash
# EVIDGUARD818: block a commit that stages an evidence/artifact path, a known
# secret shape, or quoted channel material. Override (CI still checks):
#   SKIP_SECRET_GATE=1 git commit ...
set -euo pipefail
[ "${SKIP_SECRET_GATE:-0}" = "1" ] && { echo "pre-commit: SKIP_SECRET_GATE=1 -- the CI job still runs." >&2; exit 0; }
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if ! command -v npx >/dev/null 2>&1; then
  echo "pre-commit: npx not found, cannot run the secret gate -- BLOCKING (fail-closed)." >&2
  echo "Install Node, or bypass knowingly with SKIP_SECRET_GATE=1 (the CI job will still catch it)." >&2
  exit 1
fi
# THE SCRIPT'S ABSENCE IS NOT A SECRET HIT (2026-08-23, measured).
# `.git/hooks` is SHARED across worktrees, so installing this hook reaches every
# branch at once -- including branches older than the gate itself. Measured that
# night: 43 worktrees, 35 without `scripts/secret-gate.ts`. There the hook died
# with a raw ERR_MODULE_NOT_FOUND stack that never mentioned the gate, and the
# whole fleet lost `git commit` for 25 minutes.
#
# We do NOT block here, and that is not a weakening: on those branches the gate
# never existed, so blocking is not protection -- it is an outage, and the signal
# it gives is not even about secrets. This hook is the fast lane by design (see
# the header); the authoritative check is the CI job. Say it loudly, name the way out.
if [ ! -f scripts/secret-gate.ts ]; then
  echo "pre-commit: the secret-gate script is NOT on this branch (scripts/secret-gate.ts)." >&2
  echo "            THIS IS NOT A SECRET HIT -- the branch predates the gate." >&2
  echo "            Bring it in:  git merge origin/develop   (or rebase onto it)." >&2
  echo "            The CI job (secret-gate.yml) still checks on the PR." >&2
  exit 0
fi
npx --no-install tsx scripts/secret-gate.ts --staged
EOF
chmod +x "$GUARD"

# 2. Dispatcher: run every executable in pre-commit.d/ (mirrors the pre-push one).
if [ -f "$DISPATCH" ] && ! grep -q "$MARK" "$DISPATCH" 2>/dev/null; then
  mv "$DISPATCH" "$HOOK_DIR/pre-commit.d/00-existing-precommit"
  chmod +x "$HOOK_DIR/pre-commit.d/00-existing-precommit"
  echo "  (preserved existing pre-commit as pre-commit.d/00-existing-precommit)"
fi
cat > "$DISPATCH" <<EOF
#!/usr/bin/env bash
# $MARK : run every executable in pre-commit.d/.
set -euo pipefail
HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
status=0
for h in "\$HOOK_DIR"/pre-commit.d/*; do
  [ -x "\$h" ] || continue
  "\$h" "\$@" || status=1
done
exit \$status
EOF
chmod +x "$DISPATCH"

echo "  secret gate pre-commit hook installed (bypass: SKIP_SECRET_GATE=1; the CI job is the real gate)"

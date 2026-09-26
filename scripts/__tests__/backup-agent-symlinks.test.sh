#!/bin/bash
# Contract tests for the agents/ block of scripts/backup.sh (card ef6a93dc).
# Run: bash scripts/__tests__/backup-agent-symlinks.test.sh
#
# Measured 2026-09-24: every agents/<n> had become a symlink, `find agents` does not descend into
# one, and the backup kept printing "backup: wrote ..." with zero agent files in it. This runs a
# COPY of the real script in a throwaway tree and reads the archive it produced.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${HERE}/../backup.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

T="$(mktemp -d)"
trap 'rm -rf "${T}"' EXIT
FX="${T}/install"; ELSE="${T}/elsewhere"; SHARED="${T}/shared-channels"
mkdir -p "${FX}/scripts" "${FX}/agents/realone" "${ELSE}/linked" "${SHARED}/telegram" "${T}/home"
cp "${SRC}" "${FX}/scripts/backup.sh"

# a real agent dir, the pre-09-18 shape
echo real > "${FX}/agents/realone/CLAUDE.md"
# a SYMLINKED agent dir, today's shape
ln -s "${ELSE}/linked" "${FX}/agents/linked"
echo page > "${ELSE}/linked/CLAUDE.md"
echo soul > "${ELSE}/linked/SOUL.md"
mkdir -p "${ELSE}/linked/.claude/channels/telegram"
echo TOKEN=agent > "${ELSE}/linked/.claude/channels/telegram/.env"
echo '{}' > "${ELSE}/linked/.claude/channels/telegram/access.json"
# must NOT be followed: a nested link to the shared channels dir, and a project checkout's .env
echo TOKEN=shared > "${SHARED}/telegram/.env"
mkdir -p "${ELSE}/linked/.claude-config"
ln -s "${SHARED}" "${ELSE}/linked/.claude-config/channels"
mkdir -p "${ELSE}/linked/work/project"
echo DATABASE_URL=prod > "${ELSE}/linked/work/project/.env"
echo nested > "${ELSE}/linked/work/project/CLAUDE.md"
# a second linked agent whose .claude/channels IS a link to the shared dir, ON a documented path:
# its token is the shared one, already in the home/ group -- following it (-L) would file the
# main bot token a second time, under this agent's name
mkdir -p "${ELSE}/sharer/.claude"
echo page > "${ELSE}/sharer/CLAUDE.md"
ln -s "${SHARED}" "${ELSE}/sharer/.claude/channels"
ln -s "${ELSE}/sharer" "${FX}/agents/sharer"

out="$(HOME="${T}/home" bash "${FX}/scripts/backup.sh" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] && ok "backup.sh exits 0" || bad "backup.sh rc=${rc}: ${out}"
arc="$(ls "${FX}"/backups/claudeclaw-*.tar.gz 2>/dev/null | head -1)"
if [ -z "${arc}" ]; then bad "no archive written"; echo "Results: ${PASS}/$((PASS + FAIL)) passed"; exit 1; fi
list="$(tar -tzf "${arc}")"

has()  { printf '%s\n' "${list}" | grep -qx "$1" && ok "archived: $1" || bad "MISSING from archive: $1"; }
hasnt(){ printf '%s\n' "${list}" | grep -q  "$1" && bad "must NOT be archived: $1" || ok "not archived: $1"; }

# THE FINDING: the symlinked agent's page and its OWN bot token
has "repo/agents/linked/CLAUDE.md"
has "repo/agents/linked/SOUL.md"
has "repo/agents/linked/.claude/channels/telegram/.env"
has "repo/agents/linked/.claude/channels/telegram/access.json"
# CONTROL: the real-dir agent was always collected, and still is
has "repo/agents/realone/CLAUDE.md"
# the link must be crossed ONCE, not followed further, and no name search into project trees
hasnt ".claude-config/channels"
hasnt "work/project"

has "repo/agents/sharer/CLAUDE.md"
hasnt "agents/sharer/.claude/channels"

# and the archived token is the agent's, not the shared one
tmpx="${T}/x"; mkdir -p "${tmpx}"; tar -xzf "${arc}" -C "${tmpx}"
grep -qx "TOKEN=agent" "${tmpx}/repo/agents/linked/.claude/channels/telegram/.env" \
  && ok "the archived .env is the agent's own" || bad "archived .env is not the agent's"

TOTAL=$((PASS + FAIL))
echo "Results: ${PASS}/${TOTAL} passed"
if [ "${FAIL}" -gt 0 ]; then echo "FAILED: ${FAIL} tests"; exit 1; fi

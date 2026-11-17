#!/usr/bin/env bash
# Marveen backup.
#
# The archive has two top-level groups so a restore is unambiguous about
# where each file belongs (see docs/MIGRATION.md):
#
#   repo/   -> extract under the project root (this repo)
#     store/**                 (DB WAL-checkpointed first; minus models,
#                               virtualenvs, browser profile and logs)
#     .env                     (project root secrets)
#     scheduled-tasks.json     (legacy, if present)
#     assets/meetings/**       (meeting transcripts/memos)
#     agents/*/CLAUDE.md, SOUL.md, .mcp.json, agent-config.json, workcheck.json
#     agents/*/.claude/channels/{telegram,slack,discord}/.env, access.json
#
#   home/   -> extract under $HOME
#     .claude/skills/**            (the self-built skill library)
#     .claude/scheduled-tasks/**   (file-based scheduled tasks: SKILL.md + config)
#     .claude/channels/*/.env      (MAIN orchestrator channel token)
#     .claude/channels/*/access.json, invites.json, approved/**  (pairing state)
#     Library/LaunchAgents/com.<MAIN_AGENT_ID>.*.plist (launchd jobs)
#     Backups/agent-reports        (the agents' reports/ snapshot repo with its git history,
#                                   scripts/agent-reports-snapshot.sh; card 23bd6a95)
#
# Output: backups/claudeclaw-YYYYmmdd-HHMMSS.tar.gz
# Retention: keeps the most recent 14 archives, prunes the rest.
#
# Restore (preserve modes so the 0600 token files stay private):
#   tar -xpzf <archive> -C /tmp/restore        # inspect first
#   then copy repo/* into the project root and home/* into $HOME.
# Full runbook: docs/MIGRATION.md.

set -euo pipefail

# The archive carries live secrets (store/.claude-oauth-token, .dashboard-token,
# the vault master key next to vault.json, every channel .env). It must be
# born 0600 -- not chmod-ed afterwards, because a crash between tar and chmod
# would leave a world-readable copy (BACKUPTITOK915: measured 0644 on the
# owner host under the default umask 022; ours measured the same on the 09-14
# archive, card fb315ca6). umask 077 covers the archive, the backups/ dir, the
# staging dir and every temp file this script creates -- owner-only from the
# first byte.
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so a test can build a throwaway archive without touching the
# real backup directory (and its retention sweep).
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${BACKUP_DIR}/claudeclaw-${STAMP}.tar.gz"
KEEP=14

mkdir -p "${BACKUP_DIR}"
cd "${REPO_ROOT}"

# Checkpoint WAL into the main DB file so the snapshot is self-contained.
# Tolerate a missing sqlite3 CLI -- just fall back to copying the files as-is.
if [[ -f store/claudeclaw.db ]] && command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 store/claudeclaw.db 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || true
fi

# --- Build the two path lists (each relative to its own base). -------------
# tar refuses missing entries, which would fail the whole backup on a fresh
# machine (no agents yet) -- so we only list paths that actually exist.
REPOLIST="$(mktemp -t claudeclaw-repo.XXXXXX)"
HOMELIST="$(mktemp -t claudeclaw-home.XXXXXX)"
MANIFEST="$(mktemp -t claudeclaw-manifest.XXXXXX)"
# The staging tree lives next to the archives, NOT in $TMPDIR. macOS runs
# com.apple.bsd.dirhelper daily at 03:35 (StartCalendarInterval) with
# CLEAN_FILES_OLDER_THAN_DAYS=3: it deletes $TMPDIR files whose atime is older
# than three days. `cp -p` below preserves the SOURCE atime, so every file that
# is rarely read (an agent's CLAUDE.md, a channel .env, the dashboard token, a
# small side database) arrives in the stage already "three days old" and can be
# swept between the copy and the tar. The archive is still written, the
# verification below then reports the holes, and the nightly job fails.
# BACKUP_DIR is not a sweep target, and the EXIT trap still removes the stage.
STAGE="$(mktemp -d "${BACKUP_DIR}/.stage.XXXXXX")"
BUNDLE=""
trap 'rm -f "${REPOLIST}" "${HOMELIST}" "${MANIFEST}"; [[ -n "${BUNDLE}" ]] && rm -f "${BUNDLE}"; rm -rf "${STAGE}"' EXIT

# add_if <listfile> <base> <relpath>  -- append relpath when <base>/<relpath> exists.
add_if() {
  local list="$1" base="$2" rel="$3"
  if [[ -e "${base}/${rel}" ]]; then echo "${rel}" >> "${list}"; fi
}

# repo/ group (relative to REPO_ROOT)
# store/ -- everything EXCEPT the bulky, regenerable and transient parts.
# Until 2026-09-04 this was a five-name whitelist (the DB, its -shm/-wal, the
# dashboard token, config-overrides.json) and every OTHER file in store/ sat
# outside the archive without ever saying so: the credential vault, the
# verified-recipients ledger that gates every outgoing letter, the egress
# allowlist, the autonomy levels, the per-service API tokens, and hand-made
# data that exists nowhere else (the mail-partner categorisation, the SEO
# baselines, the webshop change log). A whitelist is silent about every file
# added after it was written, so the rule is inverted here: take store/ and
# name only what must stay OUT.
#   whisper, health, cowork, venv-*, dhl-chrome-profile, fedex-labels,
#   fedex-vam, archery-basis  -- models, exports, virtualenvs, a browser
#     profile and generated PDFs: 3.2 GB, all re-downloadable or reproducible
#   *.log, *.out, *.pid       -- runtime noise, worthless in a restore
# What remains is ~4 MB next to the DB, so the archive stays small.
#   backups                   -- store/backups holds OTHER machines' tarballs (two 2026-07-13
#     hermes dumps, 701 MB): a backup inside the backup, and not this host's state
#   darwin-relay              -- relay.log (87 MB): a log, not state; nothing restores from it
#   scheduled-runs            -- SCHEDPROMPTREF917 fire-time snapshots, ~100 files/day,
#     7-day retention on disk already (scheduled-run-snapshot.ts); regenerated on every
#     large-task fire, so a restore losing yesterday's costs nothing
#   (measured 2026-09-16: these two were 788 MB of a 948 MB archive; excluding them
#    leaves ~150 MB. STORE_SKIP does not delete anything -- the files stay on disk.)
STORE_SKIP=" whisper health cowork venv-garmin venv-pdf dhl-chrome-profile fedex-labels fedex-vam archery-basis backups darwin-relay scheduled-runs "
if [[ -d store ]]; then
  while IFS= read -r _entry; do
    _name="$(basename "${_entry}")"
    case "${STORE_SKIP}" in *" ${_name} "*) continue ;; esac
    case "${_name}" in *.log|*.out|*.pid) continue ;; esac
    echo "store/${_name}" >> "${REPOLIST}"
  done < <(find store -mindepth 1 -maxdepth 1)
fi
add_if "${REPOLIST}" "${REPO_ROOT}" .env
add_if "${REPOLIST}" "${REPO_ROOT}" scheduled-tasks.json
add_if "${REPOLIST}" "${REPO_ROOT}" assets/meetings
# Per-agent identity + channel secrets (glob; missing dir is not an error).
#
# EACH agents/<n> MAY BE A SYMLINK, and since 2026-09-18 all seven are (-> /Users/Shared/...).
# A plain `find agents` does not descend into a symlinked directory, so this block skipped deeper
# from 09-07 and collected ZERO files once all seven were links -- and nothing said so: the archive
# was written, "backup: wrote" was printed, and five agents' own bot tokens were in no backup
# (card ef6a93dc, measured 2026-09-24).
#
# `-H` follows ONLY the start point -- the agents/<n> link itself -- and no symlink below it:
# an agent's .claude-config/channels points at the SHARED ~/.claude/channels (already in the
# home/ group) and its plugin caches hold unrelated .mcp.json files; `-L` would pull in both.
# The -path list is the documented layout from the header, not a name search: an agent dir can
# later hold a project checkout with its own .env, and a recursive name match would copy that
# secret into the archive without anyone deciding to.
if [[ -d agents ]]; then
  for a in agents/*; do
    [[ -d "${a}" ]] || continue
    find -H "${a}" -maxdepth 4 -type f \
      \( -path "${a}/CLAUDE.md" -o -path "${a}/SOUL.md" -o -path "${a}/.mcp.json" \
         -o -path "${a}/.claude/channels/*/.env" -o -path "${a}/.claude/channels/*/access.json" \
         -o -path "${a}/agent-config.json" -o -path "${a}/workcheck.json" \) \
      -print >> "${REPOLIST}"
  done
fi

# home/ group (relative to $HOME)
add_if "${HOMELIST}" "${HOME}" .claude/skills
add_if "${HOMELIST}" "${HOME}" .claude/scheduled-tasks
# The file-based auto-memory. Until 2026-09-04 this was NOT in the archive, and
# a restore test that day proved what that costs: 490 markdown memories for the
# main agent alone, none of them in the tarball. The SQLite copy is not a
# substitute -- it holds the prose, not the frontmatter, the type or the
# [[links]] between memories. Only the memory/ directories are taken, not the
# whole projects/ tree, which is full of transcripts and tool-result dumps.
if [[ -d "${HOME}/.claude/projects" ]]; then
  ( cd "${HOME}" && find .claude/projects -maxdepth 2 -type d -name memory -print ) >> "${HOMELIST}"
fi
# MAIN orchestrator channel tokens + pairing state, per provider. bot.pid and
# inbox/ are runtime/transient and intentionally excluded. Since #915 the
# main state dir is install-scoped (<repo>/.claude/channels/<provider>); the
# HOME base only still holds it on an unmigrated install -- take both, each
# from its own list so restore puts them back where they came from.
if [[ -d "${HOME}/.claude/channels" ]]; then
  ( cd "${HOME}" && find .claude/channels -maxdepth 2 \
      \( -name '.env' -o -name 'access.json' -o -name 'invites.json' \) \
      -print ) >> "${HOMELIST}"
  ( cd "${HOME}" && find .claude/channels -maxdepth 2 -type d -name 'approved' -print ) >> "${HOMELIST}"
fi
if [[ -d "${REPO_ROOT}/.claude/channels" ]]; then
  ( cd "${REPO_ROOT}" && find .claude/channels -maxdepth 2 \
      \( -name '.env' -o -name 'access.json' -o -name 'invites.json' \) \
      -print ) >> "${REPOLIST}"
  ( cd "${REPO_ROOT}" && find .claude/channels -maxdepth 2 -type d -name 'approved' -print ) >> "${REPOLIST}"
fi
# launchd jobs for this fleet. The job labels are com.<MAIN_AGENT_ID>.<service>
# (see src/web/main-agent.ts), so resolve MAIN_AGENT_ID the way the app does
# (src/env.ts: read from .env, default "marveen" when unset) instead of
# hardcoding one deployment's prefix. Parsing mirrors env.ts: last definition
# wins, surrounding matching quotes stripped.
MAIN_AGENT_ID="marveen"
if [[ -f "${REPO_ROOT}/.env" ]]; then
  # `|| true`: with `set -o pipefail`, a no-match grep would otherwise fail the
  # whole substitution (and, under `set -e`, abort the backup) on any install
  # that leaves MAIN_AGENT_ID unset and relies on the "marveen" default.
  _mid="$(grep -E '^[[:space:]]*MAIN_AGENT_ID[[:space:]]*=' "${REPO_ROOT}/.env" | tail -1 \
    | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' || true)"
  [[ -n "${_mid}" ]] && MAIN_AGENT_ID="${_mid}"
fi
if [[ -d "${HOME}/Library/LaunchAgents" ]]; then
  ( cd "${HOME}" && find Library/LaunchAgents -maxdepth 1 -name "com.${MAIN_AGENT_ID}.*.plist" -print ) >> "${HOMELIST}"
fi

# THE AGENTS' REPORTS (card 23bd6a95, Isti 2026-10-04: no GitHub copy, the offsite one instead).
# agents/<n>/reports/ sits in no git repository; scripts/agent-reports-snapshot.sh mirrors every
# such tree into ~/Backups/agent-reports (a LOCAL-ONLY git repo, every 30 minutes). Until now that
# copy lived on this disk only. It joins the archive, and the archive is what the offsite job
# encrypts, uploads and restore-tests, so the reports leave the machine encrypted like everything
# else here and no new destination or credential exists.
#
# FAIL-CLOSED, and judged on the RESULT, not on the job having run:
#   - there are report files and no snapshot repo (or one with nothing tracked): the archive says
#     nothing about them, which looks exactly like a good backup -- a failed condition (exit 7);
#   - a source file older than the snapshot interval differs from its snapshot copy, or is not in
#     it: the snapshot job has stopped, and the "copy" is stale -- a failed condition;
#   - the staged copy's git history does not pass a connectivity check (the snapshot may be
#     committing while it is copied): copied again once, then a failed condition;
#   (a snapshot directory that did not make it into the archive is exit 6, through the manifest check)
# A file younger than REPORTS_GRACE_MIN is not compared: the snapshot job may simply not have
# reached it yet, and failing on that would teach everyone to ignore the alert.
# The archive is ALWAYS written (the database and tokens in it are worth keeping), like exit 3.
REPORTS_REL="Backups/agent-reports"
REPORTS_SNAP="${HOME}/${REPORTS_REL}"
REPORTS_GRACE_MIN=35
REPORTS_FAIL=""
REPORTS_SRC_N=0
REPORTS_CHECKED=0
REPORTS_SNAP_HEAD=""

# reports_sources [find args] -> "<agent>/<path under reports/>" per file; the same glob, the same
# `find -L` and the same skipped dependency trees as the snapshot script, so both name the same
# population. DEPENDENCY TREES (card 212e319f): node_modules, .venv, venv are rebuilt from a lockfile;
# one report's node_modules (1081 MB) took the archive from 437 to 724 MB and the upload past the
# Drive token's hour. agent-reports-snapshot.sh skips the same names: the two lists must stay the same.
REPORTS_SKIP_DIRS=( \( -name node_modules -o -name .venv -o -name venv \) )
reports_sources() {
  local d a
  for d in agents/*/reports; do
    [[ -d "${d}" ]] || continue
    a="$(basename "$(dirname "${d}")")"
    ( cd "${d}" && find -L . -type d "${REPORTS_SKIP_DIRS[@]}" -prune \
        -o -type f ! -name '.DS_Store' "$@" -print | sed "s|^\./|${a}/|" )
  done
}

REPORTS_SRC_N="$(reports_sources | grep -c . || true)"
REPORTS_SKIPPED="$(find -L agents/*/reports -type d "${REPORTS_SKIP_DIRS[@]}" -prune -print 2>/dev/null | grep -c . || true)"
[[ -d "${REPORTS_SNAP}" ]] && echo "${REPORTS_REL}" >> "${HOMELIST}"
if [[ "${REPORTS_SRC_N}" -gt 0 ]]; then
  if ! command -v git >/dev/null 2>&1; then
    REPORTS_FAIL="${REPORTS_FAIL} git is not installed, the reports snapshot cannot be checked;"
  elif [[ ! -d "${REPORTS_SNAP}/.git" ]]; then
    REPORTS_FAIL="${REPORTS_FAIL} ${REPORTS_SRC_N} report files exist but there is no snapshot repo at ${REPORTS_SNAP};"
  elif [[ "$(git -C "${REPORTS_SNAP}" ls-files | grep -c . || true)" -eq 0 ]]; then
    REPORTS_FAIL="${REPORTS_FAIL} ${REPORTS_SRC_N} report files exist but the snapshot repo tracks none;"
  else
    REPORTS_SNAP_HEAD="$(git -C "${REPORTS_SNAP}" rev-parse --short HEAD 2>/dev/null || echo '?')"
    REPORTS_STALE=0
    REPORTS_STALE_NAMES=""
    while IFS= read -r _rel; do
      [[ -z "${_rel}" ]] && continue
      REPORTS_CHECKED=$((REPORTS_CHECKED + 1))
      if ! cmp -s "agents/${_rel%%/*}/reports/${_rel#*/}" "${REPORTS_SNAP}/${_rel}" 2>/dev/null; then
        REPORTS_STALE=$((REPORTS_STALE + 1))
        [[ "${REPORTS_STALE}" -le 3 ]] && REPORTS_STALE_NAMES="${REPORTS_STALE_NAMES} ${_rel}"
      fi
    done < <(reports_sources -mmin "+${REPORTS_GRACE_MIN}")
    if [[ "${REPORTS_STALE}" -gt 0 ]]; then
      REPORTS_FAIL="${REPORTS_FAIL} ${REPORTS_STALE} of ${REPORTS_CHECKED} report files older than ${REPORTS_GRACE_MIN} min differ from the snapshot or are missing from it (the snapshot job has stopped?):${REPORTS_STALE_NAMES};"
    fi
  fi
fi

# THE AGENT-FILE COUNT IS A SUCCESS CONDITION, NOT A DETAIL (card fb315ca6, marveen's ruling).
# From 09-18 this block collected ZERO agent files and the run still printed "backup: wrote":
# a backup that silently stops covering the agents looks exactly like one that works. If agent
# directories exist and none of their files were collected, the archive is STILL written (the
# database and tokens in it are worth keeping) but the run exits 3, so the scheduler's health
# verdict turns red instead of green.
#
# PER AGENT, NOT IN TOTAL (didi, 2026-09-24): with two agent dirs and one of them collected, the
# total was 1 and the run was green -- the same silent gap, one agent at a time. So every agent
# dir must contribute at least one file, and the ones that did not are NAMED. Measured the same
# night on the live tree: all 7 agents contribute 3-5 files and all 7 have agent-config.json.
AGENT_DIRS=0
AGENT_FILES=0
EMPTY_AGENTS=""
if [[ -d agents ]]; then
  for a in agents/*; do
    [[ -d "${a}" ]] || continue
    AGENT_DIRS=$((AGENT_DIRS + 1))
    # index()==1, not a regex: an agent name is data, and `agents/a1/` must not match `agents/a10/`
    n=$(awk -v p="${a}/" 'index($0, p) == 1' "${REPOLIST}" | wc -l | tr -d ' ')
    AGENT_FILES=$((AGENT_FILES + n))
    [[ "${n}" -eq 0 ]] && EMPTY_AGENTS="${EMPTY_AGENTS} ${a#agents/}"
  done
fi

# --- Local commits that live on no remote. ---------------------------------
# This archive deliberately carries unversioned state, not the source: the
# source is supposed to live on a git remote. On 2026-09-04 that assumption
# broke -- nine days of work sat committed locally and pushed nowhere, so the
# only copy was this disk, and the tarball did not hold it either. A bundle of
# every local branch that origin does not already have closes the gap for a few
# hundred KB (the full history is 26 MB, but the shared part is recoverable by
# cloning origin). Restore, after cloning origin:
#   git fetch <restored>/repo/local-commits.bundle 'refs/heads/*:refs/heads/*'
if command -v git >/dev/null 2>&1 && [[ -d "${REPO_ROOT}/.git" ]]; then
  BUNDLE="$(mktemp -t claudeclaw-bundle.XXXXXX)"
  # An empty ref set makes `git bundle` refuse with "empty bundle", which is
  # the GOOD case (everything is already pushed), not an error -- so a failure
  # here just drops the file instead of failing the backup.
  if git -C "${REPO_ROOT}" bundle create "${BUNDLE}" \
       --branches --not --remotes=origin >/dev/null 2>&1; then
    echo "backup: local-commits.bundle $(wc -c < "${BUNDLE}" | awk '{print $1}') bytes"
  else
    rm -f "${BUNDLE}"; BUNDLE=""
    echo "backup: no local-only commits to bundle"
  fi
fi

if [[ ! -s "${REPOLIST}" && ! -s "${HOMELIST}" ]]; then
  echo "backup: nothing to archive" >&2
  # nothing at all is a fresh machine -- unless agents exist, which is the silent failure above
  [[ "${AGENT_DIRS}" -gt 0 ]] && exit 3
  exit 0
fi

# --- Manifest (stored at the archive root for self-description). -----------
{
  echo "Marveen backup ${STAMP}"
  echo "host: $(hostname 2>/dev/null || echo '?')   user: ${USER:-?}   home: ${HOME}"
  echo "repo root: ${REPO_ROOT}"
  echo "Restore: tar -xpzf <archive> -C <tmp>; copy repo/* -> project root, home/* -> \$HOME."
  echo "See docs/MIGRATION.md for the full runbook (TCC, launchd paths, one-bot-one-poller, venv rebuild)."
  echo "--- repo/ ---"; sed 's,^,repo/,' "${REPOLIST}" 2>/dev/null || true
  if [[ -n "${BUNDLE}" ]]; then
    echo "repo/local-commits.bundle   (git bundle: local branches absent from origin)"
  fi
  echo "--- home/ ---"; sed 's,^,home/,' "${HOMELIST}" 2>/dev/null || true
  echo "--- reports ---"
  echo "agent reports: ${REPORTS_SRC_N} source files, ${REPORTS_CHECKED} compared byte for byte, snapshot HEAD ${REPORTS_SNAP_HEAD:-none}, ${REPORTS_SKIPPED} dependency trees skipped"
} > "${MANIFEST}"

# --- Assemble the archive via a staging dir, then one plain tar. -----------
# The repo/ and home/ groups are produced by copying into a staging tree, NOT
# by tar name-substitution: bsdtar's `-s` and GNU tar's `--transform` are
# mutually incompatible (on GNU tar, `-s` is `--same-order` and takes no
# argument), so a substitution-based build is not portable. Staging + a single
# `tar -czf -C "${STAGE}" .` works identically on macOS (bsdtar) and Linux
# (GNU tar). Everything backed up is small (a few MB), so the copy is cheap;
# `cp -pR` preserves modes so the 0600 token files stay private.
cp "${MANIFEST}" "${STAGE}/MANIFEST.txt"

STAGE_FAILS=0
stage_group() {  # stage_group <listfile> <base> <group>
  local list="$1" base="$2" group="$3" rel parent
  [[ -s "${list}" ]] || return 0
  while IFS= read -r rel; do
    [[ -z "${rel}" ]] && continue
    parent="$(dirname "${rel}")"
    mkdir -p "${STAGE}/${group}/${parent}"
    # BACKUPALERT925: one unreadable file (e.g. a root-owned 0600 leftover) used
    # to abort the whole run under `set -e`, so no archive was written at all.
    # Skip it loudly instead; the manifest still names it, so the verification
    # below reports it as MISSING and the run fails with exit 6 and an alert.
    if ! cp -pR "${base}/${rel}" "${STAGE}/${group}/${parent}/"; then
      # A directory entry can be PARTIALLY copied (one unreadable file inside):
      # the manifest names the directory, which did get in, so verification
      # alone would pass. Count every staging failure and fail the run on it.
      STAGE_FAILS=$((STAGE_FAILS + 1))
      echo "backup: WARN could not fully stage ${group}/${rel} -- the run will fail (exit 6)" >&2
    fi
  done < "${list}"
}

stage_group "${REPOLIST}" "${REPO_ROOT}" repo
stage_group "${HOMELIST}" "${HOME}" home

# The snapshot job may be committing while its repository is copied. A copy whose history does not
# connect is worse than no copy (it looks like a backup), so it is checked and, once, copied again.
if [[ -d "${STAGE}/home/${REPORTS_REL}/.git" ]]; then
  if ! git -C "${STAGE}/home/${REPORTS_REL}" fsck --connectivity-only --no-dangling >/dev/null 2>&1; then
    rm -rf "${STAGE}/home/${REPORTS_REL}"
    mkdir -p "${STAGE}/home/$(dirname "${REPORTS_REL}")"
    cp -pR "${REPORTS_SNAP}" "${STAGE}/home/$(dirname "${REPORTS_REL}")/" 2>/dev/null || true
    if ! git -C "${STAGE}/home/${REPORTS_REL}" fsck --connectivity-only --no-dangling >/dev/null 2>&1; then
      REPORTS_FAIL="${REPORTS_FAIL} the copied history of ${REPORTS_SNAP} does not pass a git connectivity check, twice;"
    fi
  fi
fi

# A dependency tree the snapshot job mirrored before it skipped them (card 212e319f) is still in its
# directory: it stays out of the archive here. Only the STAGED copy is touched, never the snapshot.
if [[ -d "${STAGE}/home/${REPORTS_REL}" ]]; then
  find "${STAGE}/home/${REPORTS_REL}" -path "${STAGE}/home/${REPORTS_REL}/.git" -prune \
    -o -type d "${REPORTS_SKIP_DIRS[@]}" -prune -exec rm -rf {} + \
    || echo "backup: WARN could not drop every dependency tree from the staged reports (a larger archive, not a broken one)" >&2
fi

if [[ -n "${BUNDLE}" ]]; then
  mkdir -p "${STAGE}/repo"
  cp -p "${BUNDLE}" "${STAGE}/repo/local-commits.bundle"
  chmod 600 "${STAGE}/repo/local-commits.bundle"
fi

# Archive only the top-level entries that exist (a group dir is absent when
# its list was empty), so tar never errors on a missing entry and the names
# stay clean (no leading "./").
( cd "${STAGE}" && tar -czf "${ARCHIVE}" MANIFEST.txt \
    $( [[ -d repo ]] && echo repo ) $( [[ -d home ]] && echo home ) )
echo "backup: wrote ${ARCHIVE} ($(wc -c < "${ARCHIVE}" | awk '{print $1}') bytes; agent dirs ${AGENT_DIRS}, agent files ${AGENT_FILES}${EMPTY_AGENTS:+; agents with NO files:${EMPTY_AGENTS}})"

# --- Verify the archive against the manifest. ------------------------------
# The manifest says what the backup INTENDED to carry; until now nothing
# checked what it actually carries. That gap is exactly how 2026-09-04
# happened: the store/ whitelist had been silently dropping files for weeks
# and the restore test was what finally noticed, not the backup itself. A
# backup that cannot say what is inside it is a promise, not a copy.
#
# Two checks, because they fail differently:
#   - every manifest entry has a matching path in the archive (a staging copy
#     that silently did nothing shows up here),
#   - a few load-bearing items are present by name (an archive that is valid,
#     small and useless -- the 09-04 shape -- shows up here even if the
#     manifest itself was built wrong).
ARCHIVE_LIST="$(mktemp -t claudeclaw-verify.XXXXXX)"
trap 'rm -f "${REPOLIST}" "${HOMELIST}" "${MANIFEST}" "${ARCHIVE_LIST}"; [[ -n "${BUNDLE}" ]] && rm -f "${BUNDLE}"; rm -rf "${STAGE}"' EXIT
tar -tzf "${ARCHIVE}" > "${ARCHIVE_LIST}"

missing=0
while IFS= read -r want; do
  # Manifest body lines only: the header block and the group separators are
  # prose, not paths.
  case "${want}" in repo/*|home/*) ;; *) continue ;; esac
  # A directory entry is listed once in the manifest and expands to many paths
  # in the archive, so match on the prefix, and anchor it so "store/x" cannot
  # be satisfied by "store/xyz".
  if ! grep -qE "^${want}(/|$)" "${ARCHIVE_LIST}"; then
    echo "backup: MISSING from the archive: ${want}" >&2
    missing=$((missing + 1))
  fi
done < <(sed -e 's/  *(.*)$//' "${MANIFEST}")

# Load-bearing by name. Each one has already been lost or nearly lost once:
# the memory directories and the local-commit bundle on 2026-09-04, the
# credential-carrying store/ files by the whitelist that preceded it.
for marker in "repo/store/claudeclaw.db" "home/.claude/skills" "home/.claude/scheduled-tasks"; do
  grep -qE "^${marker}(/|$)" "${ARCHIVE_LIST}" || {
    echo "backup: MISSING load-bearing item: ${marker}" >&2
    missing=$((missing + 1))
  }
done
# The file-based memories: only required when this host actually has some, so
# a fresh install does not fail its first backup.
if ( cd "${HOME}" && find .claude/projects -maxdepth 2 -type d -name memory -print -quit 2>/dev/null | grep -q . ); then
  grep -qE "^home/\.claude/projects/.*/memory(/|$)" "${ARCHIVE_LIST}" || {
    echo "backup: MISSING load-bearing item: the file-based memory directories" >&2
    missing=$((missing + 1))
  }
fi

if [[ "${STAGE_FAILS}" -gt 0 ]]; then
  echo "backup: FAILED staging -- ${STAGE_FAILS} entr(y/ies) could not be copied completely (see WARN lines above)." >&2
  missing=$((missing + STAGE_FAILS))
fi

if [[ "${missing}" -gt 0 ]]; then
  echo "backup: FAILED verification -- ${missing} item(s) named in the manifest are not in ${ARCHIVE}." >&2
  echo "backup: the archive is kept for inspection, but do NOT treat it as a good copy." >&2
  # launchd sends this script's output to logs/backup.log, which nobody opens.
  # A loud failure into an unread file is the same silence the verification
  # above exists to break, so the failure also goes onto the agent message
  # queue, where it survives the agent being asleep at 04:30 and gets read on
  # the next turn. Best-effort: a messaging problem must not change the exit
  # code or mask the real failure.
  if [[ -x "${REPO_ROOT}/scripts/agent-msg.sh" ]]; then
    # BACKUPALERT925: the recipient used to be a literal agent name from the
    # author's machine, so on any other fleet the alert went nowhere and the
    # swallowed error hid that too. Address this install's main agent.
    # The body goes on STDIN (`-`): agent-msg.sh refuses a positional body since
    # card 16d66942 (exit 5), and this call's stderr is swallowed -- without the
    # `-` form the failure alert would be silently dropped, the very failure it reports.
    printf '%s\n' "[MENTES] A napi mentes ellenorzese ELBUKOTT ${STAMP}-kor: ${missing} tetel hianyzik az archivumbol (reszletek: logs/backup.log). Az archivum NEM tekintheto jo masolatnak." \
      | bash "${REPO_ROOT}/scripts/agent-msg.sh" "${MAIN_AGENT_ID}" "${MAIN_AGENT_ID}" - \
      >/dev/null 2>&1 || echo "backup: WARN could not queue the failure alert for ${MAIN_AGENT_ID}" >&2
  fi
  exit 6
fi
echo "backup: verified $(grep -cE '^(repo|home)/' "${MANIFEST}") manifest entries against the archive"

# The archive contains sensitive tokens (dashboard bearer, channel bot tokens,
# project .env secrets). Do not auto-sync ${BACKUP_DIR} to iCloud, Dropbox,
# Google Drive, or any other cloud-backup folder. Keep it local.
echo "backup: WARNING -- archive contains sensitive tokens; keep ${BACKUP_DIR} out of cloud-sync folders (iCloud / Dropbox / Google Drive)." >&2

# Keep the newest ${KEEP} archives, drop the rest. while-read (not mapfile)
# for macOS bash 3.2 compatibility.
ls -1t "${BACKUP_DIR}"/claudeclaw-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  rm -f "${f}"
  echo "backup: pruned $(basename "${f}")"
done

FINAL_RC=0
if [[ -n "${EMPTY_AGENTS}" ]]; then
  echo "backup: FAILED CONDITION -- no files collected for agent(s):${EMPTY_AGENTS} (${AGENT_FILES} agent files from ${AGENT_DIRS} dirs in total); the archive was written but does NOT cover them." >&2
  FINAL_RC=3
fi
if [[ -n "${REPORTS_FAIL}" ]]; then
  echo "backup: FAILED CONDITION -- the agents' reports are not covered:${REPORTS_FAIL} the archive was written but its reports part is NOT a good copy." >&2
  # Same reason as the verification alert above: a loud line in a log nobody opens is no alert.
  if [[ -x "${REPO_ROOT}/scripts/agent-msg.sh" ]]; then
    bash "${REPO_ROOT}/scripts/agent-msg.sh" "${MAIN_AGENT_ID}" "${MAIN_AGENT_ID}" \
      "[MENTES] A napi mentes riport-resze NEM teljes ${STAMP}-kor:${REPORTS_FAIL} Az archivum megvan, de az agents/*/reports masolata nem megbizhato." \
      >/dev/null 2>&1 || echo "backup: WARN could not queue the reports alert for ${MAIN_AGENT_ID}" >&2
  fi
  [[ "${FINAL_RC}" -eq 0 ]] && FINAL_RC=7
fi
exit "${FINAL_RC}"

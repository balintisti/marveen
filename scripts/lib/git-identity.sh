# git_identity_env <name>: prints the export statement that makes an agent's commits carry its
# own name, ending in " && " so it can be spliced into a launch command (card db775775; the TS
# twin is src/web/git-identity.ts). Empty name: prints nothing, the machine's identity stays.
#
# Sourced by the main-agent launchers (channels.sh, channel-watchdog.sh, stuck-modal-guard.sh)
# and the sub-agent relaunch (watchdog.sh). Each sources it with a no-op fallback: a missing
# helper must not keep the channel from coming up -- commits would carry the machine's
# identity again, which is the state before this change, not an outage.
git_identity_env() {
  [ -n "${1:-}" ] || return 0
  local q e
  q="'$(printf '%s' "$1" | sed "s/'/'\\\\''/g")'"
  e="'$(printf '%s' "$1@agents.local" | sed "s/'/'\\\\''/g")'"
  printf 'export GIT_AUTHOR_NAME=%s GIT_AUTHOR_EMAIL=%s GIT_COMMITTER_NAME=%s GIT_COMMITTER_EMAIL=%s && ' "$q" "$e" "$q" "$e"
}

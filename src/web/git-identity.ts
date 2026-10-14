import { shQuote } from './ssh-tmux.js'

/** The git identity an agent's commits carry (card 49d1d6b6; every launch path: db775775).
 *
 * SCOPE: every path that starts an agent process -- startAgentProcess (local and remote), the
 * main agent's start and respawns (channels.sh, channel-monitor.ts, channel-watchdog.sh,
 * stuck-modal-guard.sh; the shell side uses scripts/lib/git-identity.sh), the sub-agent
 * relaunch in watchdog.sh, the worker sessions, and scheduled command / pre-check / background
 * tasks. Pinned by agent-git-identity-every-launch.test.ts.
 *
 * WHY THE PROCESS AND NOT THE TREE: on 2026-09-24 the shared Delta-CRM `.git/config` held a
 * leftover `jarvis@localhost` identity and 45 commits by several agents carried it. The first
 * remedy considered was a per-worktree identity; measured: 240 linked worktrees, 30 with a name,
 * 0 with an email, ~109 not attributable by path, and new ones created constantly. An identity
 * exported at LAUNCH follows the agent into every tree it touches, old or new, in every repo.
 * Git's precedence makes the environment win over any repo or worktree config (measured in a
 * throwaway repo, both directions).
 *
 * The email is `<agent>@agents.local` (marveen's decision): deliberately not a real mailbox, so
 * an agent commit is never mistaken for the owner's, on GitHub or anywhere else.
 */
export function gitIdentityVars(name: string): Record<string, string> {
  const email = `${name}@agents.local`
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }
}

/** The same identity as one shell `export` statement, without a trailing separator. */
export function gitIdentityExport(name: string): string {
  return `export ${Object.entries(gitIdentityVars(name)).map(([k, v]) => `${k}=${shQuote(v)}`).join(' ')}`
}

export function gitIdentityEnv(name: string): string {
  return `${gitIdentityExport(name)} && `
}

/**
 * A made-up install for the y1-report-only tests (card 5b639edb): an install root, agent homes, a HOME and a scratch
 * directory, all under one temporary directory.
 *
 * The agent homes come in the two layouts that exist:
 *   'symlinked'  agents/<name> is a symlink to <top>/shared/marveen-<name>, as on the live machine. The upstream gate
 *                compares real paths, so here its `agents/<name>/...` patterns do not see ANOTHER agent's files: the
 *                case the hook's supplements are for.
 *   'plain'      agents/<name> is a directory, as upstream assumes.
 * A sub-agent's job carries what the live hook gets: CLAUDE_PROJECT_DIR is the home's REAL path, CLAUDE_CONFIG_DIR
 * the lexical agents/<name>/.claude-config.
 */
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Layout = 'symlinked' | 'plain'

export interface Y1Job {
  root: string
  toolName: string
  toolInput: Record<string, unknown>
  cwd: string
  projectDir: string
  configDir: string
}

export interface Y1Install {
  layout: Layout
  root: string
  /** the HOME the gate must see (stub it before the first decision) */
  home: string
  scratch: string
  /** an agent's home by its real path */
  homeOf(name: string): string
  /** the same home as the install spells it: <root>/agents/<name> */
  lexical(name: string): string
  sub(name: string, toolName: string, toolInput: Record<string, unknown>, cwd?: string): Y1Job
  main(toolName: string, toolInput: Record<string, unknown>, cwd?: string): Y1Job
}

export function makeInstall(base: string, layout: Layout, agents: string[] = ['dexter', 'didi']): Y1Install {
  const top = realpathSync(base)
  const root = join(top, 'install')
  const home = join(top, 'home')
  const scratch = join(top, 'scratch')
  const put = (path: string, text = '{}\n'): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  const lexical = (name: string): string => join(root, 'agents', name)
  const homeOf = (name: string): string => (layout === 'symlinked' ? join(top, 'shared', `marveen-${name}`) : lexical(name))

  put(join(root, '.claude', 'settings.json'))
  put(join(root, 'scripts', 'hooks', 'db-write-gate.mjs'), '// a hook\n')
  put(join(root, 'store', '.dashboard-token'), 'not-a-token\n')
  put(join(home, '.claude', 'channels', 'telegram', 'access.json'))
  mkdirSync(scratch, { recursive: true })
  mkdirSync(join(root, 'agents'), { recursive: true })
  for (const name of agents) {
    const real = homeOf(name)
    put(join(real, 'agent-config.json'))
    put(join(real, '.claude', 'settings.json'))
    put(join(real, '.claude', 'channels', 'telegram', 'access.json'))
    put(join(real, 'notes', 'a.txt'), 'a\n')
    mkdirSync(join(real, '.claude-config'), { recursive: true })
    if (layout === 'symlinked') symlinkSync(real, lexical(name))
  }

  return {
    layout,
    root,
    home,
    scratch,
    homeOf,
    lexical,
    sub: (name, toolName, toolInput, cwd = homeOf(name)) => ({ root, toolName, toolInput, cwd, projectDir: homeOf(name), configDir: join(lexical(name), '.claude-config') }),
    main: (toolName, toolInput, cwd = root) => ({ root, toolName, toolInput, cwd, projectDir: root, configDir: join(root, '.channels-config') }),
  }
}

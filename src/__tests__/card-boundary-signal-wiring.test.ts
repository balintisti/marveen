/**
 * THE CARD-BOUNDARY SIGNAL HOOK IS REGISTERED WHERE THE MOVE HAPPENS (card 00262e3f).
 *
 * The stop signal reaches an agent only if scripts/hooks/card-boundary-signal.py runs after its Bash
 * calls. Two registrations carry it: templates/settings.json.template (every sub-agent, merged in by
 * ensureAgentHooks at the next dashboard start) and the tracked .claude/settings.json (the main
 * agent). Without either, the dashboard writes a signal nobody is shown, and the guard reads that
 * as "not followed" ten minutes later.
 *
 * The cases run the REAL migration against the REAL template on settings that already carry the
 * memory gate's Bash group, because that is the shape of the running fleet. The registered commands
 * are then RUN: what is pinned is that the wrapper passes the hook's exit 2 and its text through,
 * and that a missing script is silent instead of an error on every shell call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { writeSignal } from '../web/card-boundary-signal.js'
import { KNOWN_HOOK_SCRIPTS } from '../web/hook-registration-guard.js'

const mkTmp = tmpDirs()

vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}))

let agentRoot: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: () => agentRoot }
})
const fakeHome = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return mkdtempSync(join(tmpdir(), 'cardsignal-home-'))
})
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => fakeHome }))

const { ensureAgentHooks } = await import('../web/agent-scaffold.js')
mkTmp.adopt(fakeHome)

const REPO = process.cwd()
const HOOK = 'card-boundary-signal.py'
const TEXT = '[SYSTEM-DIREKTIVA msg_id:77 -- envelope]\n[KARTYAHATAR] stop here'
const SETTINGS = () => join(agentRoot, '.claude', 'settings.json')
// Scratch scopes, so the cross-scope dedupe never consults the operator's real files.
const SCOPES = () => ({ user: join(fakeHome, '.claude', 'settings.json'), project: join(agentRoot, 'no-project.json') })

type Group = { matcher?: string; hooks?: Array<{ command?: string; timeout?: number }> }
const groupsWith = (hooks: Record<string, Group[]>, event: string, script = HOOK): Group[] =>
  (hooks[event] ?? []).filter((g) => (g.hooks ?? []).some((h) => (h.command ?? '').includes(script)))
const agentHooks = () => (JSON.parse(readFileSync(SETTINGS(), 'utf-8')).hooks ?? {}) as Record<string, Group[]>
const projectHooks = () => (JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf-8')).hooks ?? {}) as Record<string, Group[]>
const commandOf = (g: Group): string => g.hooks?.find((h) => (h.command ?? '').includes(HOOK))?.command ?? ''

/** The settings of an agent of the running fleet: the memory gate's Bash group is already there. */
function fleetSettings(): void {
  const gate = { matcher: 'Bash', hooks: [{ type: 'command', command: 'bash -c \'[ -f /x/scripts/hooks/memory-frontmatter-bash-gate.py ] && exec python3 /x/scripts/hooks/memory-frontmatter-bash-gate.py; exit 0\'', timeout: 10 }] }
  writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreToolUse: [gate], PostToolUse: [gate], PostToolUseFailure: [gate] } }))
}

/** Runs a registered command the way Claude Code does (a shell line), as the agent `computress`. */
function runRegistered(command: string, env: Record<string, string>): { rc: number | null; out: string; err: string } {
  const full = { ...process.env, ...env }
  delete (full as Record<string, string | undefined>).MARVEEN_AGENT_ID
  const stdin = JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'curl ...' },
    transcript_path: join(REPO, 'agents', 'computress', '.claude-config', 'projects', 'p', 's.jsonl'),
  })
  const r = spawnSync('/bin/sh', ['-c', command], { input: stdin, env: full, encoding: 'utf-8', timeout: 20_000 })
  return { rc: r.status, out: r.stdout, err: r.stderr }
}

function armedDir(): { dir: string; errlog: string } {
  const root = mkTmp('cardsignal-wiring-')
  const dir = join(root, 'signals')
  writeSignal({ agent: 'computress', cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: Date.now() - 500, issuedAtMs: Date.now(), msgId: 77, text: TEXT }, dir)
  return { dir, errlog: join(root, 'hook-errors.log') }
}

beforeEach(() => {
  agentRoot = mkTmp('cardsignal-agent-')
  mkdirSync(join(agentRoot, '.claude'), { recursive: true })
})
afterEach(() => rmSync(agentRoot, { recursive: true, force: true }))

describe('a sub-agent of the running fleet gets the hook at the next start', () => {
  it('one Bash group on PostToolUse, beside the memory gate\'s own', () => {
    fleetSettings()
    expect(ensureAgentHooks('probe', SCOPES())).toBe(true)
    const ours = groupsWith(agentHooks(), 'PostToolUse')
    expect(ours).toHaveLength(1)
    expect(ours[0].matcher).toBe('Bash')
    expect(ours[0].hooks?.find((h) => (h.command ?? '').includes(HOOK))?.timeout).toBe(10)
    expect(groupsWith(agentHooks(), 'PostToolUse', 'memory-frontmatter-bash-gate.py').length).toBeGreaterThanOrEqual(1)
  })

  it('PostToolUse ONLY: before the call there is nothing to show, and a failed move issued no signal', () => {
    fleetSettings()
    ensureAgentHooks('probe', SCOPES())
    const hooks = agentHooks()
    for (const event of Object.keys(hooks)) {
      if (event === 'PostToolUse') continue
      expect(groupsWith(hooks, event), event).toHaveLength(0)
    }
  })

  it('settings with no hooks at all get it too', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    expect(ensureAgentHooks('probe', SCOPES())).toBe(true)
    expect(groupsWith(agentHooks(), 'PostToolUse')).toHaveLength(1)
  })

  it('a second run adds nothing (no duplicate group on every start: the text would be shown twice)', () => {
    fleetSettings()
    ensureAgentHooks('probe', SCOPES())
    const first = readFileSync(SETTINGS(), 'utf-8')
    ensureAgentHooks('probe', SCOPES())
    expect(groupsWith(agentHooks(), 'PostToolUse')).toHaveLength(1)
    expect(readFileSync(SETTINGS(), 'utf-8')).toBe(first)
  })

  it('the script is one the registration guard knows, and it exists', () => {
    expect(KNOWN_HOOK_SCRIPTS).toContain(HOOK)
    expect(() => readFileSync(join(REPO, 'scripts', 'hooks', HOOK), 'utf-8')).not.toThrow()
  })
})

describe('the registered command, run: it carries the signal through and never becomes an error itself', () => {
  const rendered = (): string => {
    fleetSettings()
    ensureAgentHooks('probe', SCOPES())
    return commandOf(groupsWith(agentHooks(), 'PostToolUse')[0])
  }

  it('sub-agent command: an armed signal comes out as exit 2 with the text on stderr', () => {
    const { dir, errlog } = armedDir()
    const cmd = rendered()
    expect(cmd).toContain(join(REPO, 'scripts', 'hooks', HOOK))   // rendered to THIS tree, so the run below is the real script
    expect(runRegistered(cmd, { CARD_BOUNDARY_SIGNAL_DIR: dir, HOOK_ERRLOG_PATH: errlog })).toEqual({ rc: 2, out: '', err: TEXT + '\n' })
  })

  it('sub-agent command: nobody armed is exit 0 and silent', () => {
    const empty = join(mkTmp('cardsignal-wiring-'), 'signals')
    expect(runRegistered(rendered(), { CARD_BOUNDARY_SIGNAL_DIR: empty, HOOK_ERRLOG_PATH: join(empty, '..', 'e.log') })).toEqual({ rc: 0, out: '', err: '' })
  })

  it('sub-agent command: a missing script is exit 0 and silent, even with a signal out', () => {
    const { dir, errlog } = armedDir()
    const gone = rendered().replaceAll(join(REPO, 'scripts', 'hooks', HOOK), join(agentRoot, 'no-such', HOOK))
    expect(gone).not.toContain(join(REPO, 'scripts'))
    expect(runRegistered(gone, { CARD_BOUNDARY_SIGNAL_DIR: dir, HOOK_ERRLOG_PATH: errlog })).toEqual({ rc: 0, out: '', err: '' })
  })

  describe('main agent (.claude/settings.json of the repo)', () => {
    const projectCommand = (): string => {
      const ours = groupsWith(projectHooks(), 'PostToolUse')
      expect(ours).toHaveLength(1)
      expect(ours[0].matcher).toBe('Bash')
      return commandOf(ours[0])
    }

    it('registered once, on PostToolUse only', () => {
      projectCommand()
      const hooks = projectHooks()
      for (const event of Object.keys(hooks)) {
        if (event === 'PostToolUse') continue
        expect(groupsWith(hooks, event), event).toHaveLength(0)
      }
    })

    it('an armed signal comes out as exit 2 with the text on stderr', () => {
      const { dir, errlog } = armedDir()
      expect(runRegistered(projectCommand(), { CLAUDE_PROJECT_DIR: REPO, CARD_BOUNDARY_SIGNAL_DIR: dir, HOOK_ERRLOG_PATH: errlog }))
        .toEqual({ rc: 2, out: '', err: TEXT + '\n' })
    })

    it('nobody armed is exit 0 and silent', () => {
      const empty = join(mkTmp('cardsignal-wiring-'), 'signals')
      expect(runRegistered(projectCommand(), { CLAUDE_PROJECT_DIR: REPO, CARD_BOUNDARY_SIGNAL_DIR: empty, HOOK_ERRLOG_PATH: join(empty, '..', 'e.log') }))
        .toEqual({ rc: 0, out: '', err: '' })
    })

    it('a project dir without the script (an install older than this hook) is exit 0 and silent, not python\'s exit 2', () => {
      // python3 exits 2 on a script it cannot open, and in PostToolUse exit 2 is shown to the model:
      // the plain `python3 "$CLAUDE_PROJECT_DIR/..."` form would put an error on every Bash call.
      const { dir, errlog } = armedDir()
      expect(runRegistered(projectCommand(), { CLAUDE_PROJECT_DIR: agentRoot, CARD_BOUNDARY_SIGNAL_DIR: dir, HOOK_ERRLOG_PATH: errlog }))
        .toEqual({ rc: 0, out: '', err: '' })
    })
  })
})

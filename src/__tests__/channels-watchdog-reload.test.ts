import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// RELOADDEADGRACE1040 (upstream 058ad0901e, card 09861207): the died-after-up
// watchdog in scripts/channels.sh sends ONE /reload-plugins per death, only into
// a pane proven idle on the COLOURED capture, and re-arms it when the plugin
// comes back. channels-dead-after-up-verdict.test.ts measures the verdict for a
// given "tried" flag; this measures who sets and resets that flag. The SHIPPED
// functions run over a sequence of 5s ticks against a stub tmux, so the number
// of keystrokes the watchdog would type is what is asserted.

const ROOT = join(__dirname, '..', '..')
const CHANNELS = readFileSync(join(ROOT, 'scripts', 'channels.sh'), 'utf-8')
const mkTmp = tmpDirs()

function sliceShellFn(src: string, name: string): string {
  const start = src.indexOf(`\n${name}() {`)
  if (start < 0) throw new Error(`function ${name}() not found`)
  const end = src.indexOf('\n}', start + 1)
  return src.slice(start + 1, end + 2)
}

function constant(name: string): number {
  const m = CHANNELS.match(new RegExp(`^${name}=(\\d+)$`, 'm'))
  if (!m) throw new Error(`${name} not found in channels.sh`)
  return parseInt(m[1], 10)
}

const GRACE = constant('PLUGIN_DEAD_GRACE')
const RELOAD_AFTER = constant('PLUGIN_RELOAD_AFTER')
const BUDGET = constant('RESPAWN_SETTLE_BUDGET')

const ESC = '\x1b'
// An empty input box with Claude Code's dim placeholder: idle only when the
// colour is kept, since the plain capture shows the placeholder as text.
const DIM_PLACEHOLDER_PANE = `❯ ${ESC}[2mTry refactor src/utils.ts${ESC}[22m`
const PARKED_PANE = '❯ half-written draft for the owner'
const BUSY_PANE = 'BUSY esc to interrupt'

// tmux stub: logs every call; capture-pane prints the pane file, coloured only
// when -e is passed (as real tmux does).
const TMUX_STUB = `#!/bin/bash
printf '%s\\n' "$*" >> "$TMUX_LOG"
if [ "$1" = capture-pane ]; then
  coloured=false
  for a in "$@"; do [ "$a" = -e ] && coloured=true; done
  if [ "$coloured" = true ]; then cat "$PANE_FILE"; else sed $'s/\\x1b\\\\[[0-9;]*m//g' "$PANE_FILE"; fi
fi
`

// probe_pane_input_state stand-in with the readiness rule's shape (the real
// probe is measured in channels-probe-input-state.test.ts): a dim run is a
// placeholder, visible text after the prompt is a parked draft.
const PROBE_STUB = `probe_pane_input_state() {
  _in="$(cat)"
  case "$_in" in
    *BUSY*) echo busy ;;
    *$'\\x1b[2m'*) echo idle ;;
    *'❯ '[!\\ ]*) echo "parked:draft" ;;
    *) echo idle ;;
  esac
}`

type Step = { at: number; alive: boolean; pane?: string }

/** Run the shipped watchdog functions over ticks; returns the tmux calls and the final flags. */
function run(steps: Step[], opts: { streak?: number } = {}) {
  const dir = mkTmp('watchdog-reload-')
  const tmux = join(dir, 'tmux')
  writeFileSync(tmux, TMUX_STUB)
  chmodSync(tmux, 0o755)
  const paneFile = join(dir, 'pane')
  const tmuxLog = join(dir, 'tmux.log')
  const streakFile = join(dir, 'streak')
  if (opts.streak) writeFileSync(streakFile, String(opts.streak))
  writeFileSync(tmuxLog, '')
  const lines = [
    `export TMUX_LOG='${tmuxLog}' PANE_FILE='${paneFile}'`,
    `TMUX='${tmux}'`,
    `SESSION=agent-x CHANNEL_PROVIDER=telegram`,
    `PLUGIN_DEAD_GRACE=${GRACE} PLUGIN_RELOAD_AFTER=${RELOAD_AFTER} RESPAWN_SETTLE_BUDGET=${BUDGET}`,
    `NEVER_STARTED_STREAK=${opts.streak ?? 0} NEVER_STARTED_STREAK_FILE='${streakFile}'`,
    `PLUGIN_SEEN_ONCE=false PLUGIN_DEAD_SINCE=0 PLUGIN_RELOAD_ATTEMPTED=false`,
    `respawn_log() { :; }`,
    PROBE_STUB,
    sliceShellFn(CHANNELS, 'dead_after_up_verdict'),
    sliceShellFn(CHANNELS, 'watchdog_plugin_alive'),
    sliceShellFn(CHANNELS, 'died_after_up_try_reload'),
    // The loop's composition (pinned against the shipped loop below).
    `tick() {
  NOW="$1"
  if [ "$2" = alive ]; then
    watchdog_plugin_alive
  elif [ "$PLUGIN_SEEN_ONCE" = "true" ]; then
    [ "$PLUGIN_DEAD_SINCE" -eq 0 ] && PLUGIN_DEAD_SINCE=$NOW
    _v="$(dead_after_up_verdict "$NOW" "$PLUGIN_DEAD_SINCE" '' "$PLUGIN_RELOAD_ATTEMPTED")"
    [ "$_v" = reload ] && died_after_up_try_reload
  fi
}`,
  ]
  for (const s of steps) {
    if (s.pane !== undefined) lines.push(`printf '%s' '${s.pane}' > "$PANE_FILE"`)
    lines.push(`tick ${s.at} ${s.alive ? 'alive' : 'dead'} 2>/dev/null`)
  }
  lines.push('echo "FLAGS $PLUGIN_RELOAD_ATTEMPTED $NEVER_STARTED_STREAK"')
  const p = join(dir, 'run.sh')
  writeFileSync(p, lines.join('\n') + '\n')
  const out = execFileSync('bash', [p], { encoding: 'utf-8' }).trim().split('\n')
  const calls = readFileSync(tmuxLog, 'utf-8').split('\n').filter(Boolean)
  const flags = out[out.length - 1]!.split(' ')
  return {
    calls,
    reloads: calls.filter((c) => c.includes('/reload-plugins')).length,
    captures: calls.filter((c) => c.startsWith('capture-pane')),
    tried: flags[1],
    streak: flags[2],
    streakFileExists: existsSync(streakFile),
  }
}

const T0 = 1_800_000_000
/** Alive at T0, dead from T0+5 every 5s until just before the grace runs out. */
function oneDeath(start: number, pane: string): Step[] {
  const steps: Step[] = [{ at: start, alive: true, pane }]
  for (let t = start + 5; t < start + 5 + GRACE; t += 5) steps.push({ at: t, alive: false })
  return steps
}

describe('channels.sh died-after-up reload (RELOADDEADGRACE1040)', () => {
  it('the window between the reload point and the grace spans many ticks (what makes the once-only matter)', () => {
    expect((GRACE - RELOAD_AFTER) / 5).toBeGreaterThan(2)
  })

  it('one death, idle pane: exactly ONE /reload-plugins across the whole grace window', () => {
    const r = run(oneDeath(T0, DIM_PLACEHOLDER_PANE))
    expect(r.reloads).toBe(1)
    expect(r.tried).toBe('true')
  })

  it('the reload goes into the coloured capture: an empty box with a dim placeholder is reloaded', () => {
    const r = run(oneDeath(T0, DIM_PLACEHOLDER_PANE))
    expect(r.captures.length).toBeGreaterThan(0)
    for (const c of r.captures) expect(c.split(' ')).toContain('-e')
    expect(r.reloads).toBe(1)
  })

  it('NEGATIVE CONTROL: a real parked draft is never typed over, and the flag stays unset for a retry', () => {
    const r = run(oneDeath(T0, PARKED_PANE))
    expect(r.reloads).toBe(0)
    expect(r.tried).toBe('false')
  })

  it('a busy pane is retried on the next tick and reloaded once it goes idle', () => {
    const steps = oneDeath(T0, BUSY_PANE)
    const firstReloadTick = steps.findIndex((s) => !s.alive && s.at - (T0 + 5) >= RELOAD_AFTER)
    steps[firstReloadTick + 2] = { ...steps[firstReloadTick + 2]!, pane: DIM_PLACEHOLDER_PANE }
    const r = run(steps)
    expect(r.captures.length).toBe(3)
    expect(r.reloads).toBe(1)
  })

  it('the plugin comes back and dies again: the second death gets its own reload', () => {
    const first = oneDeath(T0, DIM_PLACEHOLDER_PANE)
    const second = oneDeath(T0 + 5 + GRACE, DIM_PLACEHOLDER_PANE)
    const r = run([...first, ...second])
    expect(r.reloads).toBe(2)
  })

  it('the plugin coming up clears the never-started streak (file and counter)', () => {
    const r = run([{ at: T0, alive: true, pane: DIM_PLACEHOLDER_PANE }], { streak: 3 })
    expect(r.streak).toBe('0')
    expect(r.streakFileExists).toBe(false)
  })

  it('wiring: the shipped loop calls these functions where the test driver does, and sets the flag nowhere else', () => {
    const loopStart = CHANNELS.indexOf('while $TMUX has-session -t "$SESSION" 2>/dev/null; do')
    expect(loopStart).toBeGreaterThan(CHANNELS.indexOf('\ndied_after_up_try_reload() {'))
    const loop = CHANNELS.slice(loopStart, CHANNELS.indexOf('\ndone', loopStart))
    expect(loop).toMatch(/if \[ "\$_plugin_alive" = "true" \]; then\n\s+watchdog_plugin_alive\n\s+elif \[ "\$PLUGIN_SEEN_ONCE" = "true" \]; then/)
    expect(loop).toMatch(/elif \[ "\$_dead_verdict" = "reload" \]; then\n(\s+#.*\n)*\s+died_after_up_try_reload\n\s+fi/)
    expect(loop).toContain('"$PLUGIN_RELOAD_ATTEMPTED")"')
    expect(loop).not.toMatch(/PLUGIN_RELOAD_ATTEMPTED=/)
  })
})

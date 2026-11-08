// Card b1f0011b: does a freshly started Claude Code session actually READ its input yet?
//
// Measured 2026-11-08 17:16:47 (didi, guard restart; measurements/b1f0011b in friday's dir):
// the pane showed the empty `❯` box and the idle footer from +2s, so isSessionReadyForPrompt said
// ready and the resume directive was typed at +7.4s. At +10s and +15s the box was STILL EMPTY --
// no echo, no spinner: the TUI had drawn the prompt but was not consuming keystrokes. The submit
// follow-up loop read that empty box as 'done', the /rename lane read it as free and typed too, and
// when the TUI finally read the PTY (~+20s) the directive, its Enter, `/rename Didi` and that Enter
// arrived as ONE burst, tripped paste detection, and both Enters became newlines: a parked
// multi-row box nobody recovers. Control: friday 17:26:47, same timing, was mid-turn at +10s.
//
// An empty box cannot tell "submitted" from "not read yet". The only direct evidence that the TUI
// reads input is an echo, so this probe types ONE sentinel character, waits for it to appear in the
// box, and erases it. No echo -> not ready. The unread sentinel and its BSpace sit in the PTY
// together and cancel out when the TUI does read them; if they arrive as a burst and leave a residue
// of sentinels, the next probe sees exactly that residue, erases it, and counts it as an echo (the
// TUI drew it, so it reads now). Any OTHER text in the box is someone else's: nothing is typed.

export const ECHO_SENTINEL = 'x'
export const ECHO_PROBE_BUDGET_MS = 1500
export const ECHO_PROBE_POLL_MS = 150

export type EchoProbeResult =
  | 'echoed'            // the sentinel appeared and was erased: the TUI reads input
  | 'no-echo'           // typed, never appeared within the budget (BSpace sent behind it)
  | 'left-residue'      // appeared, but the box was not empty again within the budget
  | 'foreign-text'      // the box already held text that is not our residue: nothing typed
  | 'permission-prompt' // a tool permission prompt is up: nothing typed
  | 'capture-failed'    // the box could not be read before typing: nothing typed
  | 'lane-busy'         // another writer holds this pane's send lane: nothing typed
  | 'keystroke-failed'  // a send-keys threw (set by the tmux wrapper, never by probeInputEcho)

export interface EchoProbeDeps {
  /** Text in the live input box (prompt glyph and dim ghost stripped), null when empty,
   *  undefined when the pane could not be captured. */
  readBox: () => string | null | undefined
  typeSentinel: () => void
  backspace: (count: number) => void
  permissionBlocks: () => boolean
  delay: (ms: number) => Promise<unknown>
}

const isSentinelResidue = (box: string): boolean => box.length > 0 && [...box].every((c) => c === ECHO_SENTINEL)

async function waitFor(
  deps: EchoProbeDeps,
  budgetMs: number,
  pollMs: number,
  done: (box: string | null | undefined) => boolean,
): Promise<boolean> {
  for (let waited = 0; waited < budgetMs; waited += pollMs) {
    await deps.delay(pollMs)
    if (done(deps.readBox())) return true
  }
  return false
}

export async function probeInputEcho(
  deps: EchoProbeDeps,
  opts: { budgetMs?: number; pollMs?: number } = {},
): Promise<EchoProbeResult> {
  const budgetMs = opts.budgetMs ?? ECHO_PROBE_BUDGET_MS
  const pollMs = opts.pollMs ?? ECHO_PROBE_POLL_MS
  const before = deps.readBox()
  if (before === undefined) return 'capture-failed'
  if (deps.permissionBlocks()) return 'permission-prompt'
  if (before !== null) {
    if (!isSentinelResidue(before)) return 'foreign-text'
    // An earlier probe's sentinel, drawn late: the TUI reads input now. Erase exactly that.
    deps.backspace(before.length)
    return (await waitFor(deps, budgetMs, pollMs, (box) => box === null)) ? 'echoed' : 'left-residue'
  }
  deps.typeSentinel()
  const seen = await waitFor(deps, budgetMs, pollMs, (box) => typeof box === 'string' && box.includes(ECHO_SENTINEL))
  deps.backspace(1)
  if (!seen) return 'no-echo'
  return (await waitFor(deps, budgetMs, pollMs, (box) => box === null)) ? 'echoed' : 'left-residue'
}

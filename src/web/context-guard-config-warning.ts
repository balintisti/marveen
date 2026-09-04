/**
 * AN AGENT WITH NO ENTRY IN `store/context-guard.json` LOSES ITS IDLE-FLUSH, SILENTLY.
 *
 * MEASURED 2026-09-04 (card `de0989de`). The whole 1446-byte config file differs from
 * `DEFAULT_CONTEXT_GUARD` in exactly ONE field, and it does so for every one of the seven
 * agents: jarvis, marveen, dexter, didi, friday, mandark, computress -- all of them differ
 * in `idleFlushEnabled` (code default false, file true), and in nothing else. Every other
 * field is byte-identical to the default.
 *
 * So an agent missing from that file is not "unconfigured": it is an agent whose idle-flush
 * is OFF while every one of its peers has it ON. And nothing says so. `readContextGuardConfig`
 * returns a copy of DEFAULT_CONTEXT_GUARD for an unknown name, which is the CORRECT and
 * DELIBERATE upstream behaviour (the store\'s own comment: the guard is DEFAULT-OFF (opt-in),
 * an agent with no entry is unprotected until an operator enables it). A legitimate opt-in
 * state and an accidentally-lost config are the same value, so the read path cannot tell
 * them apart and must not try.
 *
 * WHY A WARNING AND NOT A CHANGED DEFAULT (marveen\'s decision, 2026-09-04). Flipping
 * `DEFAULT_CONTEXT_GUARD.idleFlushEnabled` to true would make the absence harmless, and it
 * was rejected for a reason worth keeping: `src/context-guard.ts` is UPSTREAM code (present
 * on origin/develop, origin/main and fork/develop; control: the same check does NOT find our
 * own local files), and it states the default-off intent deliberately. Changing it would
 * encode OUR fleet\'s preference into upstream\'s documented choice, and would dissolve our
 * deviation into the default, which is the opposite of what a fork should do with a deviation
 * it wants to keep visible. If the default is wrong for everyone and not just for us, that is
 * a PR to Szotasz with the measurement attached, not an edit here.
 *
 * WHAT THIS FILE THEREFORE DOES: it changes no behaviour. It names the ABSENCE, once, so the
 * fleet cannot lose idle-flush without a line saying so.
 *
 * SCOPE, deliberately narrow: ABSENCE ONLY, never misconfiguration. An agent WITH an entry is
 * never mentioned here whatever it contains, because judging the contents would be second-
 * guessing an operator\'s opt-in. And the wording names `idleFlushEnabled` rather than saying
 * "config missing", which would overstate it the same way the original card title did (that
 * said the guard turns off; only idle-flush does).
 */

/**
 * Agents that are being swept but have no entry of their own in the store.
 *
 * `configured` is the key set of `readAllContextGuardConfigs()`, which returns ONLY
 * explicitly-configured agents, so a name absent from it is absent from the file. Output
 * order follows `present` so the message is stable across ticks.
 */
export function missingContextGuardEntries(present: string[], configured: string[]): string[] {
  const have = new Set(configured)
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of present) {
    if (have.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * The one line. Names `idleFlushEnabled` specifically, because the measurement says that is
 * the only thing an absent entry can cost; a vaguer "config missing" would send the reader
 * looking for losses that are not there.
 */
export function contextGuardConfigWarningText(missing: string[]): string {
  const who = missing.join(', ')
  return (
    `context-guard: ${missing.length} agent(s) have NO entry in store/context-guard.json ` +
    `(${who}) -- they fall back to the opt-in default, so idleFlushEnabled is false for them ` +
    `while their peers run with it true. If that is not deliberate, the file is missing or ` +
    `truncated; it is tracked, so: git checkout store/context-guard.json`
  )
}

/**
 * Once-per-change latch.
 *
 * WHY NOT ONE LINE PER TICK: the sweep runs every 300 s, so a standing absence would emit 12
 * lines an hour forever, and a guard that logs on every attempt is something this repo
 * already has a card about (`f3c6054e`, ~36 lines/minute, 12791 lines). WHY NOT ONCE PER
 * PROCESS EITHER: then a lose / fix / lose-again cycle would be announced only the first
 * time. Keyed on the missing SET, so it speaks when the answer changes and stays quiet while
 * it does not, including going quiet when the set becomes empty, which re-arms it.
 */
export function makeContextGuardConfigWarner(
  emit: (msg: string) => void,
): (present: string[], configured: string[]) => void {
  let lastKey: string | null = null
  return (present, configured) => {
    const missing = missingContextGuardEntries(present, configured)
    const key = missing.join(' ')
    if (key === lastKey) return
    lastKey = key
    if (missing.length === 0) return
    emit(contextGuardConfigWarningText(missing))
  }
}

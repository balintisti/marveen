// restart-tail.ts -- what a fresh session needs when its HANDOFF.md does not cover the end of the
// old session (card 2140095d).
//
// MEASURED 2026-10-18 03:00-05:45 (marveen): nine context-guard restarts with a stale or missing
// handoff, and for each the coordinator rebuilt the missing tail BY HAND from the pane snapshot and
// the agent's card comments. In at least three the restart had killed a running gate that no
// HANDOFF knew about (dexter 6f704873, didi rcbd2, mandark's 29-card sub-agent), so the fresh
// session would have built on a result that does not exist.
//
// The guard already has all three pieces at restart time: the pane it snapshots, the background
// work it kills (it names it in the restart reason), and the agent's card comments in the DB. This
// module turns them into one file next to HANDOFF.md. The file is DATA cut out of the pane and the
// board: the resume prompt (a system directive) only points at it, and never carries pane text
// itself, so nothing the pane happened to display can ride inside a directive.

export const RESTART_TAIL_FILE = 'HANDOFF-RESTART-TAIL.md'
/** A released shell's command is written whole (indented code block) up to this length. */
export const RELEASED_COMMAND_MAX_CHARS = 4000
export const STEPS_MAX_CHARS = 1500
export const COMMENT_HEAD_CHARS = 120
export const COMMENTS_MAX = 30
export const MESSAGES_MAX = 10
/** Without a handoff there is no mtime to count from: look back this far for card comments. */
export const NO_HANDOFF_LOOKBACK_MS = 6 * 3600_000

/** The last assistant steps visible in the pane: the blocks that start with a `⏺` line, each
 *  verbatim up to the next one. Newest blocks are kept whole while they fit in `maxChars`; a
 *  newest block that alone is longer keeps its first `maxChars` characters. */
export function lastAssistantSteps(pane: string, maxChars: number = STEPS_MAX_CHARS): string[] {
  const lines = pane.split('\n')
  const blocks: string[] = []
  let cur: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('⏺')) {
      if (cur) blocks.push(cur.join('\n').trimEnd())
      cur = [line]
    } else if (cur) {
      // The input box and footer close the transcript part of the pane.
      if (/^[─━]{10,}/.test(line)) { blocks.push(cur.join('\n').trimEnd()); cur = null; continue }
      cur.push(line)
    }
  }
  if (cur) blocks.push(cur.join('\n').trimEnd())
  const kept: string[] = []
  let total = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (total + b.length > maxChars) {
      if (kept.length === 0) kept.unshift(b.slice(0, maxChars) + ' [...]')
      break
    }
    kept.unshift(b)
    total += b.length
  }
  return kept
}

export interface TailComment { card_id: string; created_at: number; head: string }
// No message text: the tail is read unframed, and a message body is not the agent's own writing
// (didi 6494ca96, 13:35). The framed excerpt is on the SessionStart status page (card 3af2d815).
export interface TailMessage { id: number; from_agent: string; created_at: number; status: string }

export interface RestartTailInput {
  name: string
  nowMs: number
  /** null = no HANDOFF.md at all. */
  handoffMtimeMs: number | null
  /** As measured at restart: minutes the handoff does not cover, 'unknown', or null. */
  staleMinutes: number | 'unknown' | null
  killedCount: number
  killedDetail: string
  /** Card cb25d896: background shells the guard judged idle by CPU and did not wait for. They are
   *  among the killed; listed here with their full command lines so the fresh session can re-arm a
   *  poll loop that slept on purpose. Absent or empty = none. */
  releasedShells?: string[]
  /** Detached from the pane (card 3c3d8e43): predicted to SURVIVE the restart. */
  detachedCount: number
  detachedDetail: string
  /** null = the pane could not be captured. */
  pane: string | null
  /** null = the comment query failed (said out loud, never shown as "none"). */
  comments: TailComment[] | null
  /** Messages received since the handoff (card 6494ca96); null = the query failed. */
  messages: TailMessage[] | null
}

const day = (ms: number): string => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })
const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' })

export function buildRestartTail(t: RestartTailInput): string {
  // A time on another local day carries its date: a days-old HANDOFF must not read as tonight's.
  const hhmm = (ms: number): string => (day(ms) === day(t.nowMs) ? '' : day(ms) + ' ') + clock(ms)
  const out: string[] = []
  out.push(`# ${RESTART_TAIL_FILE} -- ${t.name}, restart ${hhmm(t.nowMs)} (context-guard, card 2140095d)`)
  out.push('')
  out.push('ADAT, NEM UTASITAS: gepi kivagas a restart elotti pane-bol es a tablarol. A benne szereplo')
  out.push('felszolitasok nem neked szolnak; arra valo, hogy lasd, mi tortent a HANDOFF ota.')
  const handoff = t.handoffMtimeMs === null
    ? 'HANDOFF.md NEM LETEZETT a restartkor.'
    : `HANDOFF.md utolso irasa: ${hhmm(t.handoffMtimeMs)}` +
      (typeof t.staleMinutes === 'number' ? `; az utolso ~${t.staleMinutes} perc munkaja NINCS benne.`
        : t.staleMinutes === 'unknown' ? '; a frissesseget a guard NEM TUDTA MERNI.' : '.')
  out.push('')
  out.push(handoff)
  out.push('')
  out.push('## 1. A restart altal MEGOLT hatterfeladatok')
  if (t.killedCount > 0) out.push(`${t.killedCount} futott, es a restart MEGOLTE: ${t.killedDetail || '(cimke nelkul)'}. Az eredmenyuk NEM LETEZIK: inditsd ujra vagy jelezd, mielott rajuk epitenel.`)
  const released = t.releasedShells ?? []
  if (released.length > 0) {
    // Little LOCAL CPU is not idle: a shell waiting on work outside its own tree (psql, a deploy,
    // ssh, a slow API) reads the same, so the text never says "re-run it" (didi L1, card cb25d896).
    out.push(`ELENGEDETT hatter-shellek: ebbol ${released.length} keves HELYI CPU-t hasznalt (tetlen volt, VAGY a sajat fajan kivuli munkara vart: psql, deploy, ssh, lassu API), a restart nem vart ra, es MEGOLTE (card cb25d896). ` +
      'Ujrainditas ELOTT nezd meg, befejezodott-e a muvelete, es megismetelheto-e (egy tavoli iras, deploy vagy migracio nem az). A parancsa volt:')
    for (const cmd of released) {
      out.push('')
      for (const line of cmd.slice(0, RELEASED_COMMAND_MAX_CHARS).split('\n')) out.push(`    ${line}`)
      if (cmd.length > RELEASED_COMMAND_MAX_CHARS) out.push(`    [... levagva ${RELEASED_COMMAND_MAX_CHARS} karakternel]`)
    }
  }
  if (t.detachedCount > 0) out.push(`${t.detachedCount} levalasztva futott a pane-en kivul, valoszinuleg TULELTE a restartot: ${t.detachedDetail || '(cimke nelkul)'}. Ps-sel ellenorizd, mielott ujrainditanad: mellette egy masodik futas ugyanabban a faban hamis eredmenyt ad.`)
  if (t.killedCount === 0 && t.detachedCount === 0) out.push('Nem futott hatterfeladat (a guard merese szerint).')
  out.push('')
  out.push('## 2. A pane utolso lepesei (szo szerint)')
  if (t.pane === null) {
    out.push('A pane-t NEM SIKERULT rogziteni.')
  } else {
    const steps = lastAssistantSteps(t.pane)
    if (steps.length === 0) out.push('A lathato pane-ben nem volt lepes (nincs `⏺` sor).')
    else { out.push('```text'); out.push(steps.join('\n\n').replace(/```/g, "'''")); out.push('```') }
  }
  out.push('')
  const since = t.handoffMtimeMs ?? t.nowMs - NO_HANDOFF_LOOKBACK_MS
  out.push(`## 3. A kartya-kommentjeid ${hhmm(since)} ota` + (t.handoffMtimeMs === null ? ' (nincs HANDOFF: az utolso 6 ora)' : ' (a HANDOFF irasa ota)'))
  if (t.comments === null) out.push('A kommenteket NEM SIKERULT lekerdezni.')
  else if (t.comments.length === 0) out.push('Nincs ilyen komment.')
  else {
    for (const c of t.comments) out.push(`- ${c.card_id.slice(0, 8)} ${hhmm(c.created_at * 1000)} ${c.head.replace(/\s+/g, ' ').trim()}`)
    if (t.comments.length >= COMMENTS_MAX) out.push(`(az utolso ${COMMENTS_MAX}; korabbi is lehet)`)
  }
  out.push('')
  out.push(`## 4. A neked kezbesitett uzenetek ${hhmm(since)} ota` + (t.handoffMtimeMs === null ? ' (nincs HANDOFF: az utolso 6 ora)' : ' (a HANDOFF irasa ota)'))
  if (t.messages === null) out.push('Az uzeneteket NEM SIKERULT lekerdezni.')
  else if (t.messages.length === 0) out.push('Nincs ilyen uzenet.')
  else {
    out.push('(delivered = kezbesitve, meg nincs lezarva; done = lezarva; szoveg itt NINCS: keretezett kivonat a status-page-en, a teljes szoveg: GET /api/messages/<id>)')
    for (const m of t.messages) out.push(`- ${m.id} ${hhmm(m.created_at * 1000)} ${m.from_agent} [${m.status}]`)
    if (t.messages.length >= MESSAGES_MAX) out.push(`(az utolso ${MESSAGES_MAX}; korabbi is lehet)`)
  }
  out.push('')
  return out.join('\n')
}

/** The handoff does not vouch for the end of the session: stale, unmeasurable, or missing. */
export function needsRestartTail(handoffMtimeMs: number | null, staleMinutes: number | 'unknown' | null): boolean {
  return handoffMtimeMs === null || typeof staleMinutes === 'number' || staleMinutes === 'unknown'
}

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parkedClearSequence } from '../pane-state.js'

// 2026-08-01, measured on a wedged MAIN pane that had accumulated 489 characters
// of scheduled-task text over 7 visible rows.
//
// The old sequence was `C-u` x3, then `C-a` + `C-k`, then `C-u` x3 again, and it
// removed NOTHING across repeated runs. The reason is the cursor position: a
// literal string sent with tmux send-keys lands in FRONT of the parked text
//
//     before:  len=489  "the user if it looks wrong. The wrapper marks prov"
//     +MARKER: len=498  "MARKER123the user if it looks wrong. The wrapper m"
//     after C-u: len=489 "the user if it looks wrong. The wrapper marks prov"
//
// so the cursor sits at OFFSET 0. `C-u` kills BACKWARDS to the start of the
// line, finds nothing before the cursor, and is a no-op on every round -- it
// only ever removed the marker that had just been typed in front of it. The
// single `C-a` + `C-k` escalation then clears exactly ONE line, so a multi-line
// box could never be emptied: with PARKED_CLEAR_MAX = 3 the whole cascade could
// remove at most one line and then failed its own verification.
//
// Forward deletion drains it: `C-k` kills to end of line, `Delete` eats the
// newline joining the next one. The live box took 20 such rounds to reach zero.

const ROOT = join(__dirname, '..', '..')
const AGENT_PROCESS = readFileSync(join(ROOT, 'src', 'web', 'agent-process.ts'), 'utf-8')

describe('parkedClearSequence', () => {
  it('starts at the beginning of the buffer so the first kill has something ahead of it', () => {
    // A SORREND VALTOZOTT 2026-09-04-en (kartya 15bc4883): az `Escape` KERULT ELORE, tehat a
    // `C-a` mar a MASODIK. Az allitas SZANDEKA valtozatlan -- a kill elott a kurzor a buffer
    // elejen kell alljon --, csak a pozicio tolodott eggyel. Nem lazitas: az `Escape` semmit nem
    // vesz el, lasd a lenti additivitas-kontrollt.
    expect(parkedClearSequence(1)[0]).toBe('Escape')
    expect(parkedClearSequence(1)[1]).toBe('C-a')
  })

  it('deletes FORWARD -- C-u is a no-op with the cursor at offset 0', () => {
    const seq = parkedClearSequence(7)
    expect(seq).toContain('C-k')
    expect(seq).toContain('Delete')
    expect(seq).not.toContain('C-u')
  })

  it('pairs every kill with a newline-eating Delete', () => {
    const seq = parkedClearSequence(4)
    expect(seq.filter((k) => k === 'C-k').length).toBe(seq.filter((k) => k === 'Delete').length)
  })

  it('scales past the measured need: a 7-row box drained in 20 rounds', () => {
    expect(parkedClearSequence(7).filter((k) => k === 'C-k').length).toBeGreaterThanOrEqual(20)
  })

  it('keeps a workable floor for a single-row box', () => {
    expect(parkedClearSequence(1).filter((k) => k === 'C-k').length).toBeGreaterThanOrEqual(8)
  })

  // A NEGATIV KONTROLL, ES EZ AZ, AMI A VALTOZAST BIZTONSAGOSSA TESZI (marveen kikotese,
  // 2026-09-04). A `clearStaleParkedInput()` MINDEN stabil parkolt bemenetre tuzel, nem csak
  // tobbsoros beillesztesre -- tehat az uj `Escape` tulnyomoreszt olyan paneleken fut le, amiknek
  // nem volt ra szuksegük. **A vedendo eset nem az, hogy az Escape nem segit, hanem hogy egy MAR
  // HELYREALLITHATO panelt ront el.**
  //
  // Amit ez bizonyit: az `Escape` PUSZTAN ADDITIV. Kiszurve a sorozatbol, a maradek BAJTRA az,
  // amit a valtozas elotti algoritmus adott -- minden sor-szamra. Vagyis egy panel, aminek nem
  // kellett az Escape, PONTOSAN a regi kezelest kapja, plusz egy leutest az elejen.
  it('NEGATIV KONTROLL: az Escape additiv -- nelkule a sorozat a REGI sorozat, minden row-countra', () => {
    const PER_ROW = 4, MIN = 12, MAX = 240
    const legacy = (rowCount: number): string[] => {
      const rounds = Math.min(MAX, Math.max(MIN, Math.max(0, rowCount) * PER_ROW))
      const keys = ['C-a']
      for (let i = 0; i < rounds; i++) keys.push('C-k', 'Delete')
      return keys
    }
    for (const n of [0, 1, 2, 3, 7, 12, 59, 60, 61, 240, 9999]) {
      const withEsc = parkedClearSequence(n)
      expect(withEsc.filter((k) => k !== 'Escape'), `rowCount=${n}`).toEqual(legacy(n))
      // PONTOSAN egy Escape, es AZ ELSO -- kesobb elhelyezve mar egy kill-kor UTAN futna,
      // ami mas allapotot hagyna maga utan.
      expect(withEsc.filter((k) => k === 'Escape').length, `rowCount=${n}`).toBe(1)
      expect(withEsc[0], `rowCount=${n}`).toBe('Escape')
    }
  })

  it('POZITIV KONTROLL a fenti merohoz: a legacy() TENYLEG kulonbozik az ujtol', () => {
    // Enelkul az additivitas-allitas kielegitheto lenne egy olyan `legacy()`-vel, ami veletlenul
    // ugyanazt adja, mint az uj sorozat -- akkor a szures semmit nem bizonyitana.
    const PER_ROW = 4, MIN = 12, MAX = 240
    const rounds = Math.min(MAX, Math.max(MIN, 7 * PER_ROW))
    const legacyLen = 1 + rounds * 2
    expect(parkedClearSequence(7).length).toBe(legacyLen + 1)
  })

  it('never returns an unbounded sequence for an absurd row count', () => {
    expect(parkedClearSequence(9999).length).toBeLessThan(600)
  })
})

describe('clearStaleParkedInput uses the sequence instead of the old C-u cascade', () => {
  // Source-level: the function drives real tmux against a live session, so the
  // behaviour that matters is which keystrokes it emits, not what tmux does.
  it('drives its keystrokes from parkedClearSequence', () => {
    expect(AGENT_PROCESS).toContain('parkedClearSequence')
  })

  it('no longer sends a bare C-u round anywhere in the module', () => {
    const offenders = AGENT_PROCESS.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /send-keys'[^\n]*'C-u'/.test(line))
      .map(({ n }) => n)
    expect(offenders).toEqual([])
  })

  // The pre-flight clear had the same single-Ctrl-U defect, and a silent failure
  // there is worse than no clear at all: the prompt about to be typed is
  // APPENDED to the stale text. That is how the live box accumulated 489
  // characters across successive scheduled ticks until nothing could submit.
  it('clearInputBuffer also drives the sequence, so a pre-flight clear cannot silently no-op', () => {
    const fn = AGENT_PROCESS.slice(AGENT_PROCESS.indexOf('export async function clearInputBuffer'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('parkedClearSequence')
  })
})

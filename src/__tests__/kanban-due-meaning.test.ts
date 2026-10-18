/**
 * Card 8e4cc966: one due_date field carried two meanings. The idle guard reads
 * it on a planned card as a FLOOR ("not before", src/idle-agent.ts isDeferred),
 * while the board badge, the Gantt and fleet.py's kanban_due_today read every
 * past date as a missed deadline -- so a deliberately deferred card whose floor
 * passed turned red on Isti's board and showed up as "due today". Policy
 * 4bda5cb9 / marveen 38456: the STATUS decides. planned = floor (neutral, no
 * Gantt bar, not due); waiting / in_progress / testing = deadline (red once past).
 *
 * Runs the REAL dueMeaning out of web/app.js (the kanban-due-modal.test.ts
 * pattern), pins that every consumer goes through it, and runs the real
 * kanban_due_today against a throwaway SQLite store.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const src = readFileSync(join(ROOT, 'web', 'app.js'), 'utf8')
const mkTmp = tmpDirs()

function extractFn(name: string): string {
  const m = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src)
  if (!m) throw new Error(`${name} missing from web/app.js -- 8e4cc966 fix reverted?`)
  let depth = 0
  for (let j = src.indexOf('{', m.index + m[0].length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

type Meaning = { kind: 'floor' | 'deadline'; overdue: boolean } | null
const dueMeaning = new Function(`${extractFn('dueMeaning')}; return dueMeaning`)() as
  (card: { status: string; due_date: number | null } | null, nowMs: number) => Meaning

const NOW = 1_800_000_000_000
const PAST = NOW / 1000 - 86_400
const FUTURE = NOW / 1000 + 86_400

describe('dueMeaning: the status decides what due_date means (card 8e4cc966)', () => {
  it('planned: a floor, never overdue -- past or future', () => {
    expect(dueMeaning({ status: 'planned', due_date: PAST }, NOW)).toEqual({ kind: 'floor', overdue: false })
    expect(dueMeaning({ status: 'planned', due_date: FUTURE }, NOW)).toEqual({ kind: 'floor', overdue: false })
  })

  it.each(['waiting', 'in_progress', 'testing'])('%s: a deadline, overdue only once past', (status) => {
    expect(dueMeaning({ status, due_date: PAST }, NOW)).toEqual({ kind: 'deadline', overdue: true })
    expect(dueMeaning({ status, due_date: FUTURE }, NOW)).toEqual({ kind: 'deadline', overdue: false })
  })

  it('done: never overdue', () => {
    expect(dueMeaning({ status: 'done', due_date: PAST }, NOW)).toEqual({ kind: 'deadline', overdue: false })
  })

  it('no date, no meaning', () => {
    expect(dueMeaning({ status: 'planned', due_date: null }, NOW)).toBeNull()
    expect(dueMeaning(null, NOW)).toBeNull()
  })
})

describe('every board consumer reads due_date through dueMeaning', () => {
  it('the card badge: a floor gets its own neutral label, only a deadline can be red', () => {
    const body = extractFn('createCardEl')
    expect(body).toContain('const due = dueMeaning(card, Date.now())')
    expect(body).toMatch(/due\.kind === 'floor'\s*\?\s*`<span class="kanban-card-due floor"/)
    expect(body).toContain("${due.overdue ? 'overdue' : ''}")
    expect(body).not.toMatch(/d < now/)
  })

  it('the Gantt: only deadlines get a bar, and overdue comes from dueMeaning', () => {
    expect(src).toContain(".filter(c => dueMeaning(c, nowMs)?.kind === 'deadline')")
    expect(src).toContain('const isOverdue  = dueMeaning(card, nowMs).overdue')
    expect(src).not.toMatch(/\.filter\(c => c\.due_date\)/)
  })

  it('the card meta panel names a floor "not before"', () => {
    expect(src).toContain("t(card.status === 'planned' ? 'kanban.meta.floor' : 'kanban.meta.deadline')")
  })

  it.each(['hu', 'en'])('%s carries the floor labels', (lang) => {
    const l = readFileSync(join(ROOT, 'web', 'lang', `${lang}.js`), 'utf8')
    for (const key of ['kanban.meta.floor', 'kanban.due.floor', 'kanban.due.floor_tooltip']) expect(l).toContain(`'${key}':`)
    expect(l).toMatch(/'kanban\.due\.floor':\s*'[^']*\{date\}/)
  })

  it('a floor is neutral in the stylesheet', () => {
    const css = readFileSync(join(ROOT, 'web', 'style.css'), 'utf8')
    const rule = /\.kanban-card-due\.floor\s*\{([^}]*)\}/.exec(css)
    expect(rule?.[1]).toBeDefined()
    expect(rule?.[1]).not.toMatch(/danger/)
  })
})

describe('fleet.py kanban_due_today skips planned floors (real SQLite)', () => {
  it('returns past-dated waiting/in_progress/testing cards, not planned or done', () => {
    const dir = mkTmp('due-meaning-')
    mkdirSync(join(dir, 'store'), { recursive: true })
    const py = `
import sqlite3, sys, os, json, importlib.util, time
db = os.path.join(sys.argv[2], 'store', 'claudeclaw.db')
con = sqlite3.connect(db)
con.execute("CREATE TABLE kanban_cards (id TEXT, title TEXT, status TEXT, assignee TEXT, priority TEXT, project TEXT, due_date INTEGER, updated_at INTEGER, archived_at INTEGER)")
past = int(time.time()) - 3 * 86400
future = int(time.time()) + 3 * 86400
rows = [('planned-past', 'planned', past), ('waiting-past', 'waiting', past), ('inprog-past', 'in_progress', past),
        ('testing-past', 'testing', past), ('done-past', 'done', past), ('waiting-future', 'waiting', future)]
for cid, st, due in rows:
    con.execute("INSERT INTO kanban_cards VALUES (?,?,?,?,?,?,?,?,NULL)", (cid, cid, st, 'x', 'normal', 'p', due, 0))
con.commit(); con.close()
os.environ['CLAW_DIR'] = sys.argv[2]
spec = importlib.util.spec_from_file_location('fleet', sys.argv[1])
fleet = importlib.util.module_from_spec(spec); spec.loader.exec_module(fleet)
print(json.dumps(sorted(r['id'] for r in fleet.kanban_due_today())))
`
    // -B: importing fleet.py must not leave a __pycache__ in seed-skills/ -- the .pyc embeds this
    // machine's absolute path and trips seed-skills-portable.test.ts (it did, on the first full run).
    const scripts = join(ROOT, 'seed-skills', 'fleet-helper', 'scripts')
    const r = spawnSync('python3', ['-I', '-B', '-c', py, join(scripts, 'fleet.py'), dir], { encoding: 'utf8' })
    expect(existsSync(join(scripts, '__pycache__'))).toBe(false)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(['inprog-past', 'testing-past', 'waiting-past'])
  })
})

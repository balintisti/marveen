/**
 * A napindito parancsa a KARTYA-ARAMROL (kartya 54ee459b).
 *
 * Ugyanaz a szerzodes, mint a `calendar-agenda.sh`-nal: mindig JSON, mindig
 * 0-val lep ki, es a `via` megmondja, melyik peldany valaszolt.
 *
 * CSAK-OLVASO kapcsolatot nyit: egy jelentes soha ne tudja megvaltoztatni azt,
 * amirol jelent.
 */
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { STORE_DIR } from './config.js'
import {
  dailyCardFlow, cardFlowConvergence, CONVERGENCE_DEFAULT,
  type CardRow, type CardFlowEvent,
} from './card-flow-report.js'

function emit(o: unknown): never { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(0) }

try {
  const db = new Database(join(STORE_DIR, 'claudeclaw.db'), { readonly: true, fileMustExist: true })
  const cards = db.prepare('select id, created_at, archived_at from kanban_cards').all() as Array<{ id: string; created_at: number; archived_at: number | null }>
  const events = db.prepare('select card_id, to_status, created_at from kanban_card_events').all() as Array<{ card_id: string; to_status: string; created_at: number }>
  const testing = (db.prepare("select count(*) as n from kanban_cards where status='testing' and archived_at is null").get() as { n: number }).n
  db.close()

  const rows: CardRow[] = cards.map((c) => ({
    id: c.id, createdAtMs: c.created_at * 1000, archivedAtMs: c.archived_at ? c.archived_at * 1000 : null,
  }))
  const evs: CardFlowEvent[] = events.map((e) => ({ cardId: e.card_id, toStatus: e.to_status, atMs: e.created_at * 1000 }))

  const now = Date.now()
  const flow = dailyCardFlow(rows, evs, now)
  const verdict = cardFlowConvergence(flow)
  const utolso = flow[flow.length - 1]

  emit({
    ok: true,
    via: process.env.CARDFLOW_VIA ?? 'ismeretlen',
    measured_at: new Date(now).toISOString(),
    // A HAROM SZAM -- es kimondva, hogy KETTO FOLYAM es EGY SZINT.
    numbers: {
      created_last_full_day: utolso?.created ?? null,
      closed_last_full_day: utolso?.closed ?? null,
      testing_now: testing,
    },
    note: 'a `created`/`closed` FOLYAM (egy TELJES napra, a mai kimarad, mert a nap vegeig no); '
        + 'a `testing_now` SZINT (most merve). A harmat ne olvasd egy sorban ugyanolyan szamkent.',
    convergence: verdict,
    population: CONVERGENCE_DEFAULT,
    full_days: flow.length,
  })
} catch (err) {
  emit({ ok: false, error: (err as Error).message })
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Kartya 44730c4c: a `scripts/notify.sh` a TARTALEK kuldo -- akkor fut, amikor az MCP `reply`
// tool nincs meg, vagyis PONT AKKOR, amikor a rendszer mar serult. Eddig SEMMIT nem irt a
// `conversation_log`-ba, tehat egy igy kikuldott uzenet szerkezetileg lathatatlan maradt annak,
// aki a ledgerbol olvassa ki, mit tud mar a gazda -- es a lap epp arra tanit, hogy onnan olvassuk.
//
// A PROBA NEM KULD VALODI UZENETET: egy hamis `curl` all a PATH elejen, es a Telegram valaszat
// adja vissza. Igy a VALODI szkript-ut fut le (a sikeressegi ellenorzessel egyutt), halozat nelkul.

function makeTree(opts: { withLedgerLib?: boolean } = {}): string {
  const tree = mkdtempSync(join(tmpdir(), 'notify-ledger-'))
  mkdirSync(join(tree, 'scripts', 'hooks'), { recursive: true })
  mkdirSync(join(tree, 'store'), { recursive: true })
  mkdirSync(join(tree, 'bin'), { recursive: true })
  copyFileSync(join(REPO, 'scripts', 'notify.sh'), join(tree, 'scripts', 'notify.sh'))
  if (opts.withLedgerLib !== false) {
    copyFileSync(join(REPO, 'scripts', 'hooks', 'ledger_lib.py'), join(tree, 'scripts', 'hooks', 'ledger_lib.py'))
  }
  writeFileSync(join(tree, '.env'),
    'TELEGRAM_BOT_TOKEN=teszt-token\nALLOWED_CHAT_ID=8362010684\nMAIN_AGENT_ID=marveen\n')
  // Hamis curl: a valodi valasz alakjat adja vissza, message_id-vel egyutt.
  writeFileSync(join(tree, 'bin', 'curl'),
    '#!/bin/bash\nprintf \'{"ok":true,"result":{"message_id":4242}}\\n200\\n\'\n')
  chmodSync(join(tree, 'bin', 'curl'), 0o755)
  const db = new Database(join(tree, 'store', 'claudeclaw.db'))
  db.exec(`CREATE TABLE conversation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, chat_id TEXT NOT NULL,
    direction TEXT NOT NULL, message_id INTEGER, text TEXT NOT NULL, ts INTEGER,
    created_at INTEGER NOT NULL, attachment_kind TEXT, attachment_file_id TEXT);
    CREATE UNIQUE INDEX ux_cl ON conversation_log(agent_id, chat_id, direction, message_id);`)
  db.close()
  return tree
}

function runNotify(tree: string, msg: string) {
  const r = execFileSync('bash', [join(tree, 'scripts', 'notify.sh'), msg], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${join(tree, 'bin')}:${process.env.PATH}` },
  })
  return r
}

function rows(tree: string): Array<{ agent_id: string; chat_id: string; direction: string; message_id: number | null; text: string }> {
  const db = new Database(join(tree, 'store', 'claudeclaw.db'), { readonly: true })
  const out = db.prepare('SELECT agent_id, chat_id, direction, message_id, text FROM conversation_log').all() as never
  db.close()
  return out
}

describe('notify.sh -- a tartalek uton kikuldott uzenet BEKERUL a ledgerbe (44730c4c)', () => {
  let tree: string
  afterEach(() => { if (tree) rmSync(tree, { recursive: true, force: true }) })

  it('sikeres kuldes utan EGY kimeno sor keletkezik, a Telegram message_id-jevel', () => {
    tree = makeTree()
    const out = runNotify(tree, 'proba uzenet')
    expect(out).toContain('Ertesites elkuldve.')
    const r = rows(tree)
    expect(r.length, 'a ledger ures maradt: a tartalek ut megint lathatatlan').toBe(1)
    expect(r[0].direction).toBe('out')
    expect(r[0].chat_id).toBe('8362010684')
    expect(r[0].message_id).toBe(4242)
    expect(r[0].text).toContain('proba uzenet')
  })

  // FAIL-OPEN, ES EZ A LEGFONTOSABB ALLITAS: a levelet MAR ELKULDTUK. Ha a naplozas elbukik,
  // a szkript AKKOR IS sikert jelent -- egy kezbesitett uzenetet elveszettnek jelenteni
  // rosszabb, mint a lathatatlansag, amit javitunk.
  it('ha a LEDGER-IRAS elbukik, a kuldes akkor is SIKER marad (fail-open)', () => {
    tree = makeTree({ withLedgerLib: false })   // nincs ledger_lib.py -> az import dob
    const out = runNotify(tree, 'masik proba')
    expect(out).toContain('Ertesites elkuldve.')
    expect(rows(tree).length).toBe(0)
  })

  // KONTROLL a fenti ketto kozott: az elso teszt csak akkor bizonyit, ha a masodik NEM ir sort.
  // Egyutt mondjak ki, hogy a sor A LEDGER-IRASBOL jon, nem valami masbol.
  it('ketszeri kuldes UGYANAZZAL a message_id-vel egy sort ad (a dedup all)', () => {
    tree = makeTree()
    runNotify(tree, 'elso')
    runNotify(tree, 'masodik')
    expect(rows(tree).length, 'az INSERT OR IGNORE dedupja a (agent,chat,dir,mid) kulcson').toBe(1)
  })
})

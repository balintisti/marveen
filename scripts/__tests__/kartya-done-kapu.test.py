#!/usr/bin/env python3
"""Test that scripts/kartya-es-ertesites.py refuses status=done on BOTH write paths (card d2d72d9a).

The done gate (card 3c7be3c4: no KESZ-IGAZOLAS line -> 409) lives in the dashboard API. This
script writes the SQLite DB directly, so a done it let through would bypass the gate silently.
marveen's decision (2026-10-20): close it -- the script refuses done on the create path (INSERT)
and the field-move path (UPDATE), and the refusal names the right route (proof comment + API move).

Both directions are measured: done is refused with the row untouched, and the other statuses
still go through (negative control: the guard is not wider than done).

Drives the script as a subprocess against an isolated DB (KARTYA_DB). Run:
    python3 scripts/__tests__/kartya-done-kapu.test.py
Exit 0 = all pass; non-zero = a failure (message on stderr).
"""
import os, sqlite3, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, 'scripts', 'kartya-es-ertesites.py')
DB_PATH = None
FAILS = []
# SANDBOX-GYOKER: ha a KARTYA_DB-t barmi elrontja, a gyoker ide oldodik fel, nem az eles tablara.
SANDBOX_ROOT = tempfile.mkdtemp(prefix='kartya-sandbox-')


def check(name, cond, detail=''):
    print(('PASS  ' if cond else 'FAIL  ') + name + (('  -- ' + detail) if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def fresh_db(path):
    db = sqlite3.connect(path)
    db.executescript('''
      CREATE TABLE kanban_cards (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'planned'
          CHECK(status IN ('planned','in_progress','testing','waiting','done')),
        assignee TEXT,
        priority TEXT NOT NULL DEFAULT 'normal'
          CHECK(priority IN ('low','normal','high','urgent')),
        project TEXT, due_date INTEGER, sort_order REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER,
        parent_id TEXT, dispatched_at INTEGER);
      CREATE TABLE kanban_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
        author TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        result TEXT, created_at INTEGER NOT NULL, delivered_at INTEGER, completed_at INTEGER);
    ''')
    db.commit()
    db.close()


def seed(card_id, status='testing'):
    db = sqlite3.connect(DB_PATH)
    now = int(time.time())
    db.execute('INSERT INTO kanban_cards (id,title,status,assignee,created_at,updated_at) '
               'VALUES (?,?,?,?,?,?)', (card_id, card_id + ' teszt', status, 'boni', now, now))
    db.commit()
    db.close()


def env():
    e = dict(os.environ)
    e['KARTYA_DB'] = DB_PATH
    e['CLAUDECLAW_ROOT'] = SANDBOX_ROOT
    # PROBA-HIGIENIA: egy teszt-futas soha ne irhasson az ELES uzenetsorba.
    e['KARTYA_API'] = 'http://127.0.0.1:1/api/messages'
    return e


def comment(card_id, text, extra=()):
    d = tempfile.mkdtemp(prefix='kartya-d-')
    cf = os.path.join(d, 'c.txt')
    with open(cf, 'w', encoding='utf-8') as f:
        f.write(text)
    return subprocess.run(
        [sys.executable, SCRIPT, '--id', card_id, '--comment-file', cf, '--author', 'Boni',
         '--nincs-ertesites-szandekos', *extra],
        capture_output=True, text=True, env=env(), timeout=30)


def create(card_id, extra=()):
    return subprocess.run(
        [sys.executable, SCRIPT, '--id', card_id, '--assignee', 'marveen', '--author', 'Boni',
         '--title', card_id + ' uj kartya teszt', '--no-msg', *extra],
        capture_output=True, text=True, env=env(), timeout=30)


def status(card_id):
    db = sqlite3.connect(DB_PATH)
    r = db.execute('SELECT status FROM kanban_cards WHERE id=?', (card_id,)).fetchone()
    db.close()
    return r[0] if r else None


def comments(card_id):
    db = sqlite3.connect(DB_PATH)
    r = db.execute('SELECT content FROM kanban_comments WHERE card_id=? ORDER BY id', (card_id,)).fetchall()
    db.close()
    return [x[0] for x in r]


def names_route(p, card_id):
    """A megtagadas a MEGLEVO bajt nevezi meg ES a kiutat: a proof-sort es az API-mozgatast."""
    out = p.stdout + p.stderr
    return ('KESZ-IGAZOLAS' in out and f'/api/kanban/{card_id}/move' in out
            and 'TARGYTALAN' in out and '"status":"done"' in out)


def main():
    global DB_PATH
    fd, DB_PATH = tempfile.mkstemp(suffix='.db', prefix='kartya-d-')
    os.close(fd); os.remove(DB_PATH)
    fresh_db(DB_PATH)

    # 1. MOZGATO AG (UPDATE): --status done megtagadva, a sor ES a kommentek valtozatlanok.
    seed('DONEMOZ1', 'testing')
    p = comment('DONEMOZ1', 'Kartya DONEMOZ1: kesz.', ('--status', 'done'))
    check('1 mozgato ag: done megtagadva', p.returncode != 0, p.stdout + p.stderr)
    check('1 a statusz valtozatlan (testing)', status('DONEMOZ1') == 'testing', f'kapott: {status("DONEMOZ1")}')
    # A kapu a komment-iras ELOTT all: egy felig sikerult futas (komment be, mozgatas nem) is hazugsag.
    check('1 a komment sem irodott be', comments('DONEMOZ1') == [], f'kapott: {comments("DONEMOZ1")}')
    check('1 a megtagadas megnevezi a helyes utat', names_route(p, 'DONEMOZ1'), p.stdout + p.stderr)

    # 2. DRY-RUN PARITAS: a dry-run sem mondhat zoldet arra, amit az eles ag megtagad.
    p = comment('DONEMOZ1', 'Kartya DONEMOZ1: kesz.', ('--status', 'done', '--dry-run'))
    check('2 mozgato ag dry-run: done megtagadva', p.returncode != 0, p.stdout + p.stderr)

    # 3. LETREHOZO AG (INSERT): done-ban nem jon letre kartya.
    p = create('DONEUJ1', ('--status', 'done'))
    check('3 letrehozo ag: done megtagadva', p.returncode != 0, p.stdout + p.stderr)
    check('3 a kartya nem jott letre', status('DONEUJ1') is None, f'kapott: {status("DONEUJ1")}')
    check('3 a megtagadas megnevezi a helyes utat', names_route(p, 'DONEUJ1'), p.stdout + p.stderr)
    check('3 a megtagadas a letrehozas kiutjat is mondja', 'LETREHOZNI' in p.stdout + p.stderr,
          p.stdout + p.stderr)

    p = create('DONEUJ2', ('--status', 'done', '--dry-run'))
    check('4 letrehozo ag dry-run: done megtagadva', p.returncode != 0, p.stdout + p.stderr)
    check('4 a kartya nem jott letre', status('DONEUJ2') is None)

    # 5. NEGATIV KONTROLL, mozgato ag: minden NEM-done statusz tovabbra is atmegy.
    for i, st in enumerate(('planned', 'in_progress', 'waiting', 'testing')):
        cid = f'NEMDONE{i}'
        seed(cid, 'testing' if st != 'testing' else 'waiting')
        p = comment(cid, f'Kartya {cid}: mozgatas {st}-be.', ('--status', st))
        check(f'5 mozgato ag: {st} atmegy', p.returncode == 0 and status(cid) == st,
              f'rc={p.returncode} statusz={status(cid)} {p.stdout + p.stderr}')

    # 6. NEGATIV KONTROLL, letrehozo ag: kimondott es alapertelmezett statusz is atmegy.
    p = create('UJTESTING1', ('--status', 'testing'))
    check('6 letrehozo ag: testing atmegy', p.returncode == 0 and status('UJTESTING1') == 'testing',
          p.stdout + p.stderr)
    p = create('UJALAP1')
    check('6 letrehozo ag: alapertelmezett planned atmegy', p.returncode == 0 and status('UJALAP1') == 'planned',
          p.stdout + p.stderr)

    # 7. A KIUT ELSO LEPESE ezen a szkripten at is mukodik: KESZ-IGAZOLAS komment, statusz nelkul.
    seed('PROOF1', 'testing')
    p = comment('PROOF1', 'KESZ-IGAZOLAS: TARGYTALAN | teszt-kartya\nKartya PROOF1: lezarhato.')
    check('7 a KESZ-IGAZOLAS komment beirodik', p.returncode == 0
          and any('KESZ-IGAZOLAS: TARGYTALAN' in c for c in comments('PROOF1')), p.stdout + p.stderr)
    check('7 a statusz nem mozdult (a done az API dolga)', status('PROOF1') == 'testing')

    os.remove(DB_PATH)
    if FAILS:
        sys.stderr.write('\nBUKOTT: ' + ', '.join(FAILS) + '\n')
        return 1
    print('\nminden teszt atment')
    return 0


if __name__ == '__main__':
    sys.exit(main())

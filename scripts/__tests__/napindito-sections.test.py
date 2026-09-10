#!/usr/bin/env python3
"""A napindito harom uj szekcioja (kartya b5981bdb).

A KET CSAPDA, amit a kartya NEVESITETT, es amiert ez a fajl letezik:
  1. egy hianyzo alapvonal BAJT-AZONOS egy nulla deltaval
  2. egy le nem futott ellenorzes BAJT-AZONOS azzal, hogy nem talalt semmit
Mindketto a megnyugtato iranyba teved, tehat egyik sem derulne ki magatol.

Minden eset SAJAT, eldobhato adatbazison fut -- az elesre nem irunk, es nem is
olvasunk belole, hogy a teszt ne az aznapi tabla allapotatol fuggjon.

Futtatas: python3 <ezafajl>   Exit 0 = mind atment.
"""
import importlib.util, json, os, sqlite3, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ns", os.path.join(HERE, "..", "napindito-sections.py"))
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)

failed = []
def check(label, got, want):
    if got == want: print(f"ok   {label}")
    else: failed.append(label); print(f"FAIL {label}: got {got!r}, want {want!r}")
def check_true(label, cond):
    check(label, bool(cond), True)

NOW = int(time.time())

def make_db(cards=(), runs=(), msgs=()):
    """Kartya: (id, title, status, assignee, updated_at_sec, archived_at)."""
    fd, path = tempfile.mkstemp(suffix=".db"); os.close(fd)
    c = sqlite3.connect(path)
    c.execute("create table kanban_cards (id text primary key, title text, status text,"
              " assignee text, updated_at integer, created_at integer, archived_at integer)")
    c.execute("create table task_runs (id integer primary key, name text, agent text, ts integer, status text)")
    c.execute("create table agent_messages (id integer primary key, content text, created_at integer)")
    c.executemany("insert into kanban_cards (id,title,status,assignee,updated_at,created_at,archived_at)"
                  " values (?,?,?,?,?,?,?)", [(i,t,s,a,u,u,ar) for i,t,s,a,u,ar in cards])
    c.executemany("insert into task_runs (name,agent,ts,status) values (?,?,?,?)", runs)
    c.executemany("insert into agent_messages (content,created_at) values (?,?)", msgs)
    c.commit(); c.close()
    return path

def con_for(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)

# --- 1. MI VAR RAD ----------------------------------------------------------
db = make_db(cards=[
    ("a","Isti dontese kell","waiting","Isti",   NOW-10*86400, None),
    ("b","kisbetuvel","waiting","isti",          NOW- 3*86400, None),   # az assignee nem tisztitott
    ("c","mas gazdaja","waiting","dexter",       NOW-99*86400, None),   # nem Istie
    ("d","Isti, de nem waiting","planned","Isti",NOW-99*86400, None),   # nem var valaszra
    ("e","Isti, de ARCHIVALT","waiting","Isti",  NOW-99*86400, NOW),    # nem elo
])
con = con_for(db)
out = ns.section_isti(con)
check("1: a szam a waiting ES Isti metszete (kisbetus gazdaval egyutt)", out[0].split()[3], "2")
check_true("1: a legregebbi kora a 10 napos kartyaе", "10 napja" in out[0])
check_true("1: a MAS gazdaju 99 napos kartya NEM szamit bele", "99" not in " ".join(out))
check_true("1: az ARCHIVALT sem", "ARCHIVALT" not in " ".join(out))
# KONTROLL: a mero tud nullat is mondani, es akkor MAS mondatot ir
empty = ns.section_isti(con_for(make_db(cards=[("z","x","waiting","dexter",NOW,None)])))
check_true("1 KONTROLL: nulla eseten sajat mondat, nem '0 kartya'", "semmi" in empty[0])

# --- 2. DELTA: a NEVESITETT CSAPDA -----------------------------------------
snap = tempfile.mktemp(suffix=".json")
first = ns.section_delta(con, snap, write=True)
check_true("2: alapvonal NELKUL az elso futas KIMONDJA, hogy elso meres", "ELSO meres" in first[0])
check_true("2: es NEM ir nulla deltat", "nulla valtozas" not in " ".join(first))
check_true("2: a pillanatfelvetel elkeszult", os.path.exists(snap))
second = ns.section_delta(con, snap, write=False)
check_true("2: MASODIK futas ugyanazon az adaton MAR deltat mond", "VALTOZAS" in second[0])
check_true("2: es valtozatlan adaton nullat", "nulla valtozas" in second[0])
# MAS allapot -> a delta a statuszt ES az elojelet is mondja ki.
# Az alapvonal a fenti `db`: elo kartyak = waiting 3 (a,b,c), planned 1 (d);
# az `e` archivalt, tehat nem szamit. A `db2`-ben egyetlen `planned` all, tehat
# a helyes delta `waiting -3` -- planned valtozatlan.
# (Eloszor `planned +1`-et vartam itt: a TESZTEM volt rossz, nem a kod, es a
# szamolast a fenti kartya-lista dontotte el, nem az emlekezetem.)
db2 = make_db(cards=[("n","uj","planned","dexter",NOW,None)])
moved = ns.section_delta(con_for(db2), snap, write=False)
check_true("2: valtozas eseten a statusz es az elojel is megjelenik", "waiting -3" in moved[0])
check_true("2: a valtozatlan oszlop NEM kerul a sorba", "planned" not in moved[0])
check_true("2 KONTROLL: a mondat kimondja, hogy NEM teljesitmeny-mutato",
           any("nem teljesitmeny" in l for l in second))

# --- 3. MI TORT EL: csak az ABLAKON BELUL letiltott szamit ------------------
tasks = tempfile.mkdtemp()
for name, enabled, age_days in (("regota-tiltva", False, 20), ("most-tiltva", False, 0.1), ("fut", True, 0)):
    d = os.path.join(tasks, name); os.makedirs(d)
    p = os.path.join(d, "task-config.json")
    json.dump({"enabled": enabled, "schedule": "0 7 * * *"}, open(p, "w"))
    os.utime(p, (NOW - age_days*86400,)*2)
b = ns.section_broken(con_for(make_db()), hours=24, tasks_dir=tasks)
joined = " ".join(b)
check_true("3: az ABLAKBAN letiltott feladat hir", "most-tiltva" in joined)
check_true("3: a REGOTA letiltott NEM hir (kulonben minden reggel ugyanaz)", "regota-tiltva" not in joined)
check_true("3: a FUTO feladat sem", "fut" not in joined.replace("futasok", ""))

# --- 3b. A MASODIK NEVESITETT CSAPDA: a le nem futott ellenorzes SZOLJON ----
b2 = ns.section_broken(con_for(make_db()), hours=24, tasks_dir="/nincs/ilyen/konyvtar")
check_true("3: egy le NEM futott ellenorzes SAJAT SORT kap, nem csendet",
           any("NEM FUTOTT LE" in l for l in b2))
# KONTROLL: ugyanez a hivas jo konyvtarral NEM ir ilyen sort
b3 = ns.section_broken(con_for(make_db()), hours=24, tasks_dir=tasks)
check_true("3 KONTROLL: jo konyvtarral nincs 'NEM FUTOTT LE' sor",
           not any("NEM FUTOTT LE" in l for l in b3))
# es ha SEMMI nincs, a szekcio KIMARAD (a spec igy keri)
empty_tasks = tempfile.mkdtemp()
check("3: ha nincs mit mondani, a szekcio ures", ns.section_broken(con_for(make_db()), 24, empty_tasks), [])

# --- 4. EGYSEG-ORZES --------------------------------------------------------
bad = make_db(cards=[("x","x","planned","dexter", NOW*1000, None)])   # MS-ben irt masodperc-oszlop
try:
    ns._assert_units(con_for(bad)); check("4: a rossz egyseg megallitja a szkriptet", "nem allt meg", "megall")
except RuntimeError as e:
    check_true("4: a rossz egyseg RuntimeError-t ad, nem ertelmetlen szamot", "egysege" in str(e))
try:
    ns._assert_units(con_for(db)); print("ok   4 KONTROLL: a HELYES egyseget atengedi")
except RuntimeError as e:
    failed.append("4 kontroll"); print(f"FAIL 4 KONTROLL: a helyes egyseget is elutasitja: {e}")

print()
if failed:
    print(f"{len(failed)} FAILED: {failed}", file=sys.stderr); sys.exit(1)
print("All napindito-section tests passed.")

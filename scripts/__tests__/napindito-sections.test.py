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


# --- 5. SABLON-ELCSUSZAS: HIR KONTRA ALLANDO (kartya a22c9fe8) --------------
# marveen rulingja, es a sajat ervem dontotte el: egy JELENLET-alapu napi sor
# minden reggel ugyanazt a negy fajlt nevezne meg. De a csak-hir jelentes
# LATHATATLANNA tenne egy allando problemat -- epp azt, ami ellen keszult.
print()
D = lambda k, d="both": {k: {"key": k, "direction": d}}

out, fs = ns.drift_lines(D("a/x.md"), {}, NOW)
check_true("5: egy UJ elteres HIRKENT jelenik meg, iranyostul",
           len(out) == 1 and "UJ" in out[0] and "both" in out[0])
out, _ = ns.drift_lines({}, {"a/x.md": NOW - 100}, NOW)
check_true("5: egy MEGSZUNT elteres is hir", len(out) == 1 and "MEGSZUNT" in out[0])

# A LENYEG: valtozatlan halmazra NEM listaz, de NEM is hallgat.
prev = {"a/x.md": NOW - 9 * 86400, "b/y.json": NOW - 2 * 86400}
out, fs = ns.drift_lines({**D("a/x.md"), **D("b/y.json")}, prev, NOW)
check("5: valtozatlan halmaz -> PONTOSAN EGY sor", len(out), 1)
check_true("5: es abban a DARABSZAM all, nem a lista", "2 fajl" in out[0] and "a/x.md" not in out[0])
check_true("5: es a LEGREGEBBI kora, hogy lathatoan oregedjen", "9 napja" in out[0])
check_true("5: a first_seen MEGORZI a regi idobelyeget (kulonben minden reggel 0 nap)",
           fs["a/x.md"] == prev["a/x.md"])

out, _ = ns.drift_lines({}, {}, NOW)
check("5: ures halmaz -> a szekcio nem kap sort", out, [])

# KONTROLL: a mero szet tudja valasztani a harom kimenetet ugyanazon a halmazon
kinds = {
    "uj":         len(ns.drift_lines(D("z/1"), {}, NOW)[0]),
    "valtozatlan": len(ns.drift_lines(D("z/1"), {"z/1": NOW - 86400}, NOW)[0]),
    "ures":       len(ns.drift_lines({}, {}, NOW)[0]),
}
check_true("5 KONTROLL: harom bemenet, harom KULONBOZO kimenet",
           kinds["uj"] == 1 and kinds["valtozatlan"] == 1 and kinds["ures"] == 0
           and "UJ" in ns.drift_lines(D("z/1"), {}, NOW)[0][0]
           and "valtozatlan" in ns.drift_lines(D("z/1"), {"z/1": NOW - 86400}, NOW)[0][0])


# --- 5b. AZ ALPROCESSZ-UT: harom kimenet, harom KULONBOZO mondat -----------
# A tiszta logikat fent fedtuk; itt az a kerdes, mit tesz a szerszam VALASZAVAL.
import stat as _stat
def _fake_root(payload):
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "scripts"))
    p = os.path.join(root, "scripts", "seed-drift-check.ts")
    open(p, "w").write("x")            # a letezese a feltetel; a futtatast stubolјuk
    return root, p

_real_run = ns.subprocess.run
class _R:
    def __init__(self, out): self.stdout, self.stderr = out, ""
try:
    root, _ = _fake_root(None)
    st = tempfile.mktemp(suffix=".json")
    ns.subprocess.run = lambda *a, **k: _R('{"stopped":null,"unseeded":[],"drifts":[{"key":"a/x","direction":"both"}]}')
    out = ns._seed_drift(root, st, write=False)
    check_true("5b: ervenyes JSON -> a HIR-sor all elo", len(out) == 1 and "UJ sablon-elcsuszas" in out[0])

    ns.subprocess.run = lambda *a, **k: _R('{"stopped":"not the install","unseeded":[],"drifts":[]}')
    out = ns._seed_drift(root, st, write=False)
    check_true("5b: a `stopped` NEM MERHETO-t ad, NEM 'nincs elcsuszas'-t",
               len(out) == 1 and "NEM MERHETO" in out[0])

    ns.subprocess.run = lambda *a, **k: _R('seed-drift: nincs elteres (6 sablon-feladat).')
    out = ns._seed_drift(root, st, write=False)
    check_true("5b: NEM-JSON kimenet -> megnevezi az OKOT, nem a parser panaszat",
               len(out) == 1 and "NEM ADOTT JSON" in out[0] and "Expecting value" not in out[0])

    # KONTROLL: a harom valasz HAROM KULONBOZO mondat -- egy mero, ami mindig
    # ugyanazt mondja, nem valaszol.
    ns.subprocess.run = lambda *a, **k: _R('{"stopped":null,"unseeded":[],"drifts":[]}')
    empty = ns._seed_drift(root, st, write=False)
    check("5b KONTROLL: ures elcsuszas -> nulla sor", empty, [])
finally:
    ns.subprocess.run = _real_run

print()

# =============================================================================
# 4. DREAM: a HARMADIK allapot -- nem hianyzik, nem ures, hanem REGI
# =============================================================================
# A napindito SKILL kihagyas-feltetele "nem letezik vagy ures". Egy negy napos
# DREAM.md MINDKETTON atmegy, es a digest legelso blokkjakent kerul Isti ele,
# elen a "Top-3 HOLNAPI javaslat" bucketjével. Merve 2026-09-10: a fajl 09-06-i
# es 5347 bajt.
def _dream_root(first_line, mtime=None):
    d = tempfile.mkdtemp()
    p = os.path.join(d, "DREAM.md")
    with open(p, "w", encoding="utf-8") as f:
        f.write(first_line + "\n\n## bucket\n- tartalom\n")
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return d

TODAY = "2026-09-10"

def first(lines):
    """Az ELSO sor, vagy ures sztring.

    NEM kenyelmi fuggveny: egy `out[0]` egy URES listan IndexError-t dob, az
    pedig MEGALLITJA az egesz fajlt -- tehat minden utana allo eset MERETLEN
    marad, miközben a futas "elbukott"-nak latszik. Merve 2026-09-10 egy
    mutacios koron: a B mutacio utan a fajl a 222. soron elszallt, es az
    mtime-kontroll -- epp az, amit a mutacio celzott -- SOHA nem futott le."""
    return lines[0] if lines else ""


r = _dream_root("# 💭 Dream Engine — 2026-09-06 02:12")
out = ns.section_dream(r, today=TODAY)
check_true("dream: egy REGI fajl figyelmeztet", len(out) == 1)
check_true("dream: a figyelmeztetes a fajl SAJAT datumat nevezi meg", "2026-09-06" in first(out))
check_true("dream: kimondja, hogy a szekcio maradjon ki", "HAGYD KI" in first(out))

# KONTROLL: mai fajlra NEMA -- kulonben minden reggel ugyanaz a sor, es par nap
# alatt olvasatlan zaj lenne belole.
r = _dream_root("# 💭 Dream Engine — 2026-09-10 02:12")
check("dream KONTROLL: mai fajlra nema", ns.section_dream(r, today=TODAY), [])

# KONTROLL: a HIANYZO fajl SEM nema -- mas sort kap, mint a regi.
d = tempfile.mkdtemp()
out_missing = ns.section_dream(d, today=TODAY)
check_true("dream KONTROLL: hianyzo fajl sajat sort kap", len(out_missing) == 1 and "nincs" in first(out_missing))

# A datum nelkuli elso sor: egy NEM MERHETO kor nem friss kor. Enelkul a naiv
# alak (nincs datum -> nem ter el a mai datumtol -> nema) csendben atengedne.
r = _dream_root("# Dream Engine")
out_nodate = ns.section_dream(r, today=TODAY)
check_true("dream: datum nelkuli elso sor NEM olvasodik frissnek", len(out_nodate) == 1 and "NINCS datum" in first(out_nodate))

# A DONTO KONTROLL: a kort a TARTALOM adja, nem az mtime. Egy `git checkout`,
# egy masolas vagy egy szerkesztes az mtime-ot frissiti, a tartalmat nem.
r = _dream_root("# 💭 Dream Engine — 2026-09-06 02:12", mtime=time.time())
check_true("dream: FRISS mtime + REGI tartalom -> figyelmeztet", len(ns.section_dream(r, today=TODAY)) == 1)
r = _dream_root("# 💭 Dream Engine — 2026-09-10 02:12", mtime=time.time() - 40 * 86400)
check("dream: REGI mtime + MAI tartalom -> nema", ns.section_dream(r, today=TODAY), [])

# =============================================================================
# 5. KERET: a szazalek kiirasa, es a harom ok, ami helyett SOSEM becsulunk
# =============================================================================
def _quota_root(payload, mtime=None):
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "store"))
    p = os.path.join(d, "store", "usage-latest.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return d

AUTH = {"claude": {"source": "authoritative", "ok": True,
                   "windows": {"five_hour": {"used_percent": 13.0, "resets_at": NOW + 3600},
                               "seven_day": {"used_percent": 12.0, "resets_at": NOW + 86400},
                               "seven_day_opus": {"used_percent": 0, "resets_at": NOW + 86400}}}}

out = ns.section_quota(_quota_root(AUTH))
check_true("keret: hiteles forrasnal kiirja a szazalekot", any("13%" in x for x in out))
check_true("keret: mind a harom ablak sort kap", len([x for x in out if "%" in x]) == 3)

# A becsles NEM ad szazalekot es reset-idot -- pontosan ettol volt vak a flotta
# egy hetig (dbc06e8c). Ha ez a sor elnemul, a szekcio egy BECSULT szamot irna ki
# ugyanabban az alakban, mint a hiteleset.
est = {"claude": {"source": "estimate", "ok": True, "windows": {}}}
out_est = ns.section_quota(_quota_root(est))
check_true("keret: becslesre NEM MERHETO", "NEM MERHETO" in first(out_est))
check_true("keret KONTROLL: becslesnel NINCS szazalek a kimenetben", not any("%" in x for x in out_est))

# Egy ALLO 10 perces feladat mellett a szam ORAKIG ugyanaz marad, es a regi szam
# ugyanugy nez ki, mint egy friss. A 30 perces plafon a `quota-ceiling-guard.sh`-e.
out_old = ns.section_quota(_quota_root(AUTH, mtime=NOW - 3 * 3600))
check_true("keret: ELAVULT pillanatfelvetelre NEM MERHETO", "NEM MERHETO" in first(out_old))
check_true("keret: a sor kimondja a kort is", "perces" in first(out_old))

out_none = ns.section_quota(tempfile.mkdtemp())
check_true("keret: hianyzo pillanatfelvetel sajat sort kap", "NEM MERHETO" in first(out_none))

# AZ OSSZEGZO A FAJL VEGEN ALL, es ez nem stilus: 2026-09-10-ig a 200. soron
# allt, tehat minden UTANA irt eset ugy bukhatott volna, hogy a futas exit 0-t ad.
if failed:
    print(f"{len(failed)} FAILED: {failed}", file=sys.stderr); sys.exit(1)
print("All napindito-section tests passed.")

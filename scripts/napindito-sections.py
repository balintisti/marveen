#!/usr/bin/env python3
"""A reggeli napindito harom uj szekcioja, ADATBOL (kartya b5981bdb, Isti kerte).

MIERT SZKRIPT ES NEM PROMPT: mind a harom szekcio szamlalas, es egy LLM-fordulo
minden reggel ujra levezetne ugyanazt -- draga, es fordulonkent MAS eredmenyt adhat.
A szkript ugyanazt a kerdest ugyanugy teszi fel, es a valasza idezheto.

A KET SZABALY, AMI MINDEN SZEKCIORA ALL, es amiert ez a fajl igy nez ki:

  1. EGY SZEKCIO SOHA NEM MARAD EL NEMAN. Vagy tartalma van, vagy EGY SOR arrol,
     hogy az ellenorzes miert nem futott le. A napindito pontosan ezen bukott el
     haromszor: "nincs naptar" allt ott, ahol "nem tudtam megnezni" lett volna
     igaz, es a ketto kivulrol azonos.
  2. A HIANYZO ALAPVONAL NEM NULLA. Egy elso futas, aminek nincs mihez merni,
     "0 valtozas"-t irna ki, ami bajt-azonos egy nyugodt nappal. Ezert az
     alapvonal hianya SAJAT mondatot kap.

EGYSEG-CSAPDA, MERVE 2026-09-10: ebben az adatbazisban KETFELE idobelyeg van.
    kanban_cards.updated_at / created_at ... MASODPERC
    kanban_card_events.created_at .......... MASODPERC
    kanban_comments.created_at ............. MASODPERC
    agent_messages.created_at .............. MASODPERC
    task_runs.ts ........................... EZREDMASODPERC
Ezredmasodpercben olvasva egy masodperces oszlop 20 685 NAPOS kort ad -- eleg
nagy ahhoz, hogy feltunjon, de csak ha kiirjuk. Ezert van rajta futasidejuu
ellenorzes: lasd `_assert_units`.
"""
import argparse, collections, json, os, re, sqlite3, sys, time
from datetime import datetime

# A gyoker a SZKRIPT helyebol jon, nem a munkakonyvtarbol: elesben a `scripts/`
# sav a fo checkoutbol fut, es ott a `store/` mellette van. A `--root` felulirasa
# CSAK mereshez/teszthez kell (egy worktreeben nincs `store/`), es epp ezert nem
# env-bol: egy tevesen orokolt env-valtozo csendben MAS adatbazist olvasna.
DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUSES = ["planned", "in_progress", "testing", "waiting", "done"]
# Az `assignee` NEM tisztitott mezo: merve 2026-09-10 az elo kartyakon
# `Isti` 17, `isti` 2, ures sztring 2, NULL 5. Egy nagybetu-erzekeny
# osszehasonlitas ketot elveszitene -- ezert `lower()`, mindenhol.
ISTI = "lower(coalesce(assignee,'')) = 'isti'"
LIVE = "archived_at IS NULL"


def _connect(db):
    return sqlite3.connect(f"file:{db}?mode=ro", uri=True)


def _assert_units(con):
    """A ket egyseg futasidejuu ellenorzese.

    NEM stiluskerdes: ha egy jovobeli migracio atallitja valamelyik oszlopot,
    a szekciok NEM hibaznak -- csak ertelmetlen szamot irnak ki, es az
    ertelmetlen szam is szam. Inkabb alljon meg."""
    now = time.time()
    for tbl, col, unit in (("kanban_cards", "updated_at", "s"), ("task_runs", "ts", "ms")):
        mx = con.execute(f"select max({col}) from {tbl}").fetchone()[0]
        if mx is None:
            continue
        seen = "ms" if mx > 1e11 else "s"
        if seen != unit:
            raise RuntimeError(f"{tbl}.{col} egysege {seen}, a szkript {unit}-et var")
        age = now - (mx / 1000 if seen == "ms" else mx)
        if age < 0 or age > 30 * 86400:
            raise RuntimeError(f"{tbl}.{col} legfrissebb erteke {age/86400:.0f} napos -- gyanus")


def section_isti(con):
    """1. MI VAR RAD.

    A PREDIKATUM, ES MIERT EZ: sem a statusz, sem a gazda-mezo nem eleg
    onmagaban. A `waiting` BLOKKOLTAT jelent (ma 164 kartya), a gazda-mezo pedig
    a VEGREHAJTOT nevezi meg -- de a kettо EGYUTT szetvalik, es merve is: 19 elo
    kartya all Istin, ebbol 14 `waiting`. A maradek ot `done` vagy `planned`,
    tehat nem var valaszra. Ezert `waiting` ES gazda=Isti."""
    rows = con.execute(
        f"select id, title, updated_at from kanban_cards "
        f"where {LIVE} and status='waiting' and {ISTI} order by updated_at"
    ).fetchall()
    if not rows:
        return ["MI VAR RAD: semmi. Nincs olyan kartya, ami a te valaszodra var."]
    now = time.time()
    oldest = (now - rows[0][2]) / 86400
    out = [f"MI VAR RAD: {len(rows)} kartya var a dontesedre, a legregebbi {oldest:.0f} napja."]
    for _id, title, upd in rows[:3]:
        out.append(f"  - {(now - upd)/86400:>3.0f} nap: {str(title)[:88]}")
    if len(rows) > 3:
        out.append(f"  - (es meg {len(rows)-3})")
    return out


def _counts(con):
    d = dict.fromkeys(STATUSES, 0)
    for s, n in con.execute(f"select status, count(*) from kanban_cards where {LIVE} group by 1"):
        d[s] = n
    # Az ARCHIVALT kartyak KIMARADNAK, es ezt ki kell mondani: egy archivalas
    # ugyanugy csokkenti az oszlopot, mint egy lezaras, de NEM ugyanaz.
    d["_archived"] = con.execute(
        "select count(*) from kanban_cards where archived_at is not null").fetchone()[0]
    return d


def section_delta(con, snapshot_path, write):
    today = _counts(con)
    prev = None
    if os.path.exists(snapshot_path):
        try:
            prev = json.load(open(snapshot_path, encoding="utf-8"))
        except Exception as e:
            prev = None
            note = f"(az elozo pillanatfelvetel olvashatatlan: {e})"
    out = []
    if prev is None or "counts" not in prev:
        out.append("VALTOZAS: ez az ELSO meres -- nincs mihez hasonlitani, holnaptol lesz delta.")
        out.append("  (Egy hianyzo alapvonal es egy nyugodt nap ugyanugy nezne ki; ezert all itt ez a sor.)")
    else:
        p, when = prev["counts"], prev.get("taken_at_human", "?")
        parts = []
        for s in STATUSES:
            d = today.get(s, 0) - p.get(s, 0)
            if d:
                parts.append(f"{s} {d:+d}")
        da = today["_archived"] - p.get("_archived", 0)
        line = ", ".join(parts) if parts else "nulla valtozas egyik oszlopban sem"
        out.append(f"VALTOZAS {when} ota: {line}.")
        if da:
            out.append(f"  archivalva: {da:+d} (ez NEM lezaras, csak eltunt a nezetbol)")
        out.append("  (Motivacios sor, nem teljesitmeny-mutato: egy nagy es egy kicsi kartya egyet szamit.)")
    if write:
        tmp = snapshot_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"taken_at": int(time.time()),
                       "taken_at_human": datetime.now().strftime("%m-%d %H:%M"),
                       "counts": today}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, snapshot_path)   # atomikus: egy felbeszakadt iras ne hagyjon csonkot
    return out


def section_broken(con, hours, tasks_dir=None):
    """3. MI TORT EL AZ EJJEL.

    HAROM FORRAS, es a masodik-harmadik nelkul az elso megtevesztо.

    ES A LETILTAS KET POPULACIO, MERVE 2026-09-10: tizennyolc utemezett feladatbol
    KILENC volt letiltva -- de OT 09-06 22:51:40-41-kor (egy flotta-atvitel, es
    senki nem tudott rola), NEGY viszont 08-15 ota, valoszinuleg szandekosan.
    Egy "9 letiltva" sor minden reggel ugyanazt a negyet jelentene, es par kor
    utan zaj lenne belole. Ezert csak az ABLAKON BELUL letiltottak szamitanak
    hirnek."""
    now = time.time()
    since = now - hours * 3600
    out = []

    tasks_dir = tasks_dir or os.path.expanduser("~/.claude/scheduled-tasks")
    try:
        fresh = []
        for name in sorted(os.listdir(tasks_dir)):
            cfg = os.path.join(tasks_dir, name, "task-config.json")
            if not os.path.exists(cfg):
                continue
            if json.load(open(cfg, encoding="utf-8")).get("enabled", True):
                continue
            if os.path.getmtime(cfg) >= since:
                fresh.append(name)
        if fresh:
            out.append(f"  - {len(fresh)} utemezes LETILTVA az ablakban: {', '.join(fresh)}")
    except Exception as e:
        out.append(f"  - az utemezes-ellenorzes NEM FUTOTT LE: {e}")

    try:
        bad = collections.Counter()
        for s, n in con.execute(
                "select status, count(*) from task_runs where ts > ? and status <> 'fired' group by 1",
                (since * 1000,)):
            bad[s] = n
        if bad:
            out.append("  - kihagyott/hibas utemezett futasok: "
                       + ", ".join(f"{k} {v}" for k, v in bad.most_common()))
    except Exception as e:
        out.append(f"  - a futas-ellenorzes NEM FUTOTT LE: {e}")

    try:
        pref = collections.Counter()
        for (t,) in con.execute("select content from agent_messages where created_at > ?", (since,)):
            m = re.match(r"\s*(\[[^\]]{2,40}\])", t or "")
            # A `[PROBA` prefixu uzenetek SAJAT maguk mondjak, hogy nem elesek.
            if m and not m.group(1).upper().startswith("[PROBA"):
                pref[m.group(1)] += 1
        if pref:
            out.append("  - or-jelzesek: " + ", ".join(f"{k} x{v}" for k, v in pref.most_common(6)))
    except Exception as e:
        out.append(f"  - az or-jelzes-ellenorzes NEM FUTOTT LE: {e}")

    if not out:
        return []          # a spec szerint: ha nincs mit mondani, a szekcio KIMARAD
    return [f"MI TORT EL AZ EJJEL (utolso {hours} ora):"] + out


def section_quota():
    """4. KERET -- SZANDEKOSAN KIMARAD, es ez a sor a kihagyas indoka.

    A keret-mero allapota NYITOTT KARTYAN all (dbc06e8c: a hitelesnek jelolt
    forras nem lathato). Egy becsult keret-szam rosszabb a hianyanal: ugy nezne
    ki, mint egy meres."""
    return ["KERET: nem irom ki -- a keret-mero megbizhatosaga nyitott kartyan all (dbc06e8c). "
            "Becsulni nem fogom."]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-hours", type=int, default=24)
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--tasks-dir", default=None, help="csak mereshez/teszthez")
    ap.add_argument("--snapshot", default=None)
    ap.add_argument("--no-write", action="store_true",
                    help="ne frissitse a napi pillanatfelvetelt (proba-futashoz)")
    a = ap.parse_args()
    db = os.path.join(a.root, "store", "claudeclaw.db")
    snap = a.snapshot or os.path.join(a.root, "store", "kanban-daily-snapshot.json")
    try:
        con = _connect(db)
        _assert_units(con)
    except Exception as e:
        print(f"MIND A HAROM SZEKCIO KIMARAD: az adatbazis nem olvashato ({e})")
        return 1
    blocks = [section_isti(con), section_delta(con, snap, not a.no_write),
              section_broken(con, a.since_hours, a.tasks_dir), section_quota()]
    print("\n\n".join("\n".join(b) for b in blocks if b))
    return 0


if __name__ == "__main__":
    sys.exit(main())

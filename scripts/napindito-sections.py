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
import argparse, collections, json, os, re, sqlite3, subprocess, sys, time
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


def drift_lines(cur, prev, now):
    """A HIR/ALLANDO dontes, tisztan -- ezert tesztelheto alprocessz nelkul.

    Visszaad: (sorok, first_seen). A `first_seen` MEGORZI a korabbi idobelyeget,
    kulonben a "legregebbi kora" minden reggel nullarol indulna, es pont azt a
    tulajdonsagot veszitenenk el, amiert ez a sor letezik: hogy egy figyelmen
    kivul hagyott allapot LATHATOAN oregszik.
    """
    first_seen = {k: prev.get(k, now) for k in cur}
    entered = [k for k in cur if k not in prev]
    left = [k for k in prev if k not in cur]
    out = []
    if entered or left:
        for k in sorted(entered):
            out.append(f"  - UJ sablon-elcsuszas: {k} ({cur[k]['direction']})")
        for k in sorted(left):
            out.append(f"  - MEGSZUNT sablon-elcsuszas: {k}")
    elif cur:
        oldest = min(first_seen.values())
        out.append(f"  - sablon-elcsuszas: {len(cur)} fajl, valtozatlan; a legregebbi "
                   f"{(now - oldest)/86400:.0f} napja all")
    return out, first_seen


def _seed_drift(root, state_path, write):
    """A sablon-elcsuszas HIRKENT, nem jelenlet szerint (kartya a22c9fe8).

    marveen rulingja, es a sajat ervem dontotte el, amit a "9 letiltva" sorra
    irtam le, mielott az valaha tuzelt volna: egy napi sor, ami JELENLETET
    jelent, minden reggel ugyanazt a negy fajlt nevezne meg, es egy heten belul
    zaj lenne belole.

    DE A CSAK-HIR JELENTES LATHATATLANNA TESZ EGY ALLANDO PROBLEMAT, es epp az
    ellen keszult ez az egesz. Ezert ket fele van:
        a HALMAZ VALTOZIK (be- vagy kilep egy fajl) -> HIR, iranyostul
        VALTOZATLAN es NEM URES -> EGY sor: a darabszam es a LEGREGEBBI KORA.
            Nem lista. Egy szam egy korral eleg olcso ahhoz, hogy soha ne
            valjon zajja, es lathatova teszi, hogy egy figyelmen kivul hagyott
            allapot minden reggel OREGEBB.
        URES -> a szekcio elhagyja
    """
    exe = os.path.join(root, "scripts", "seed-drift-check.ts")
    if not os.path.exists(exe):
        return ["  - a sablon-elcsuszas ellenorzes NEM FUTOTT LE: nincs " + exe]
    try:
        r = subprocess.run(["npx", "--no-install", "tsx", exe, "--json"], cwd=root,
                           capture_output=True, text=True, timeout=120)
    except Exception as e:
        return [f"  - a sablon-elcsuszas ellenorzes NEM FUTOTT LE: {e}"]
    last = (r.stdout or "").strip().splitlines()[-1:] or [""]
    try:
        data = json.loads(last[0])
    except Exception:
        # A `json.loads` sajat hibaja ("Expecting value: line 1 column 5") NEM
        # mondja meg az OKOT. A leggyakoribb ok az, hogy a szerszam meg nem
        # ismeri a `--json` kapcsolot -- ilyenkor EMBERI szoveget ir, es azt
        # kell idezni, nem a parser panaszat.
        # Az ELSO nem-ures sor idezendo, a stdoutbol, kulonben a stderrbol.
        # (Elso alakomban `last[0][0]`-t vett, ami egy STRING elso KARAKTERE --
        # az uzenet igy nevezte meg az okot es nem mutatott semmit belole.)
        lines = [l.strip() for l in ((r.stdout or "") + "\n" + (r.stderr or "")).splitlines() if l.strip()]
        head = lines[0] if lines else ""
        return ["  - a sablon-elcsuszas ellenorzes NEM ADOTT JSON-t (regebbi valtozat, `--json` nelkul?): "
                + (head[:120] or "ures kimenet")]
    if data.get("stopped"):
        # A szerszam megtagadta az osszehasonlitast. Ez NEM "nincs elcsuszas".
        return [f"  - a sablon-elcsuszas NEM MERHETO: {data['stopped'][:160]}"]

    now = int(time.time())
    cur = {d["key"]: d for d in data.get("drifts", [])}
    prev = {}
    if os.path.exists(state_path):
        try:
            prev = json.load(open(state_path, encoding="utf-8")).get("first_seen", {})
        except Exception:
            prev = {}
    out, first_seen = drift_lines(cur, prev, now)
    if write:
        tmp = state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"first_seen": first_seen}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, state_path)
    return out

def section_broken(con, hours, tasks_dir=None, root=None, drift_state=None, write_drift=True):
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

    if root:
        out.extend(_seed_drift(root, drift_state or os.path.join(root, "store", "seed-drift-state.json"),
                               write_drift))

    if not out:
        return []          # a spec szerint: ha nincs mit mondani, a szekcio KIMARAD
    return [f"MI TORT EL AZ EJJEL (utolso {hours} ora):"] + out


def section_quota(root=DEFAULT_ROOT, now=None, max_age_min=30):
    """4. KERET -- MOSTANTOL KIIRJA, ES EZ A SOR AZ INDOK, HOGY MIERT VALTOZOTT.

    2026-09-10-ig ez a szekcio SZANDEKOSAN kimaradt: a keret-mero megbizhatosaga
    nyitott kartyan allt (`dbc06e8c`, "a hitelesnek jelolt forras nem lathato").
    A kartya AZNAP lezarult, meressel: a `store/usage-history.jsonl` UTOLSO
    `estimate` sora 2026-08-22 18:44 -- azota 19 napon at napi ~144 sor, mind
    `authoritative`. Az indok tehat megszunt, es egy elavult indok epp olyan
    csendben tart eletben egy kihagyast, mint egy elavult "allj meg" emlek.

    AMI NEM VALTOZOTT: BECSULNI TOVABBRA SEM FOGUNK. Harom kulon ok teheti a
    szamot ertelmetlenné, es MINDHAROM SAJAT SORT kap ahelyett, hogy szazalekot
    irnank ki:
      - nincs pillanatfelvetel        -> a mero nem futott
      - a pillanatfelvetel ELAVULT    -> a 10 perces feladat allt (ez a mai eset
                                         alakja: a `usage-snapshot` egyike a het
                                         `command` tipusu feladatnak, amelyik
                                         VEGIG futott, de ezt merni kell, nem hinni)
      - `source != authoritative`     -> a becsles NEM ad szazalekot es reset-idot,
                                         epp ezert volt vak a flotta egy hetig
    A 30 perces frissesseg-plafon nem talalt szam: a `quota-ceiling-guard.sh`
    ugyanezt hasznalja (`QUOTA_CEILING_MAX_AGE_MIN=30`), es ket kulonbozo plafon
    ugyanarra az adatra ket kulonbozo valaszt adna ugyanabban a percben."""
    path = os.path.join(root, "store", "usage-latest.json")
    now = time.time() if now is None else now
    if not os.path.exists(path):
        return ["KERET: NEM MERHETO -- nincs " + path + " (a kvota-pillanatfelvetel nem futott le)."]
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        return [f"KERET: NEM MERHETO -- a pillanatfelvetel olvashatatlan ({type(e).__name__})."]
    age_min = (now - os.path.getmtime(path)) / 60
    if age_min > max_age_min:
        return [f"KERET: NEM MERHETO -- a pillanatfelvetel {age_min:.0f} perces "
                f"(a hatar {max_age_min}); a 10 perces `usage-snapshot` feladat all."]
    cl = d.get("claude") or {}
    if cl.get("source") != "authoritative" or not cl.get("ok"):
        why = cl.get("error") or cl.get("source") or "ismeretlen ok"
        return [f"KERET: NEM MERHETO -- a mero nem hiteles forrasbol dolgozik ({str(why)[:80]}). "
                "Becsulni nem fogom: a becsles se szazalekot, se reset-idot nem ad."]
    w = cl.get("windows") or {}
    def one(key, label):
        x = w.get(key) or {}
        pct = x.get("used_percent")
        if pct is None:
            return f"  - {label}: NEM MERHETO (hianyzo mezo)"
        r = x.get("resets_at")
        when = datetime.fromtimestamp(r).strftime("%H:%M") if r else "?"
        return f"  - {label}: {pct:g}% (reset {when})"
    return ["KERET:", one("five_hour", "5 oras"), one("seven_day", "heti"),
            one("seven_day_opus", "heti opus")]


def section_dream(root=DEFAULT_ROOT, today=None):
    """5. DREAM -- CSAK AKKOR SZOLAL MEG, HA A `DREAM.md` ELAVULT.

    A napindito SKILL a DREAM.md ot bucketjet a digest LEGELEJERE teszi, es a
    kihagyas felteteleként ezt mondja: "ha a DREAM.md nem letezik vagy ures".
    **EGYIK SEM all egy REGI fajlra.** Merve 2026-09-10 19:08: a DREAM.md
    2026-09-06 02:12-rol valo es 5347 bajt -- letezik ES nem ures --, mert a
    `dream-engine` feladat `enabled:false` allapotban all 09-06 ota. A digest
    tehat valtozatlanul kiirna, az elen a "Top-3 HOLNAPI javaslat" bucketjével,
    negy nappal az utan a holnap utan.

    A HARMADIK ALLAPOT, amit a SKILL feltetele nem ismer: nem HIANYZIK, nem URES,
    hanem REGI. Ez ugyanaz az alak, mint a zold or egy leallt mero mellett -- es
    itt az ELSO dolog, amit Isti reggel lat.

    A KORT A FAJL SAJAT ELSO SORA MONDJA MEG (`# ... Dream Engine — <datum> <ido>`),
    nem az mtime: egy `git checkout`, egy masolas vagy egy szerkesztes az mtime-ot
    frissiti, a TARTALMAT nem. Ha az elso sorban nincs datum, azt is kimondjuk --
    egy nem-olvashato kor NEM friss kor.

    NEMA, HA FRISS, es ez szandekos (a `section_broken` precedense): ilyenkor a
    bizonyitek maga a digest elejen allo dream-szekcio. Ez FIGYELMEZTETO csatorna,
    nem allapot-jelentes; egy naponta ismetlodo "a DREAM.md friss" sor nehany nap
    alatt olvasatlan zajja valna."""
    path = os.path.join(root, "DREAM.md")
    today = today or datetime.now().strftime("%Y-%m-%d")
    if not os.path.exists(path):
        return ["DREAM: nincs " + path + " -- a napindito dream-szekcioja KIMARAD (a SKILL igy is keri)."]
    head = ""
    try:
        with open(path, encoding="utf-8") as f:
            head = f.readline()
    except Exception as e:
        return [f"DREAM: a {path} elso sora nem olvashato ({type(e).__name__}) -- a dream-szekcio KIMARAD."]
    m = re.search(r"(\d{4}-\d{2}-\d{2})", head)
    if not m:
        return ["DREAM: a DREAM.md elso soraban NINCS datum, tehat a kora nem allapithato meg "
                "-- a dream-szekciot HAGYD KI (egy nem merheto kor nem friss kor)."]
    when = m.group(1)
    if when == today:
        return []
    return [f"DREAM: a DREAM.md {when}-i, tehat a Dream Engine ma NEM futott le "
            f"-- a dream-szekciot HAGYD KI a napinditobol, ne masold be a bucketeket. "
            f"(A `dream-engine` utemezett feladat allapotat nezd meg: 09-06 ota `enabled:false` volt.)"]


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
    blocks = [section_dream(a.root), section_isti(con), section_delta(con, snap, not a.no_write),
              section_broken(con, a.since_hours, a.tasks_dir, a.root, None, not a.no_write),
              section_quota(a.root)]
    print("\n\n".join("\n".join(b) for b in blocks if b))
    return 0


if __name__ == "__main__":
    sys.exit(main())

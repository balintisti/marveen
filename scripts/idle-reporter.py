#!/usr/bin/env python3
"""idle-reporter.py -- jelenti, ha egy agens elnemult ES az OR SEM szolalt meg.

A KARTYA (ee4163be), es MIERT NEM ELEG A MEGLEVO TETLEN-OR. Egy agens fordulot
CSAK beerkezo uzenettol kap: a szandek a fordulo belsejeben el, es a fordulo
vegen meghal vele. Aki a KARTYARA ir, annak nem indul fordulo. Jarvis merese
2026-08-22 22:00 ota, 7,5 ora alatt: mandark 11 ebresztest kapott a tetlen-ortol
es 32 kartya-kommentet irt -- vagyis a fordulóit az OR inditotta, nem a munka.

EZ A SZKRIPT NEM EBRESZT. Csak jelent. Ket utemezo, amelyik ugyanazert az
agensert felel, a 97%-os holtpont alakja -- ezert itt nincs tmux, nincs
uzenetkuldes agensnek, nincs semmilyen beavatkozas.

HAROM SZERKEZETI DONTES, MIND MERT OKBOL (jarvis terve, 4. komment):

1. A MERES NEM FUGGHET A NODE FOLYAMATTOL. A dashboard API-ja ugyanabban a
   folyamatban fut, mint amit ellenorzunk -- ha az all, az API is all, es a
   jelento vele nemul el. Ezert KOZVETLENUL a sqlite fajlt olvassuk, CSAK-OLVASO
   kapcsolattal (`mode=ro`). Semmit nem irunk bele.

2. A KIMENET A KOMMENT ES AZ UZENET EGYUTT. Csak az uzeneteket nezni pont azt az
   agenst mutatna tetlennek, aki a kartyara dolgozik -- ez volt a lelet magja.

3. A JELENTES KOZVETLEN TELEGRAM, NEM INTER-AGENT UZENET. Az uzenet-router
   ugyanabban a node folyamatban fut (src/web.ts), tehat egy uzenetben jelento
   ellenorzes EPP AKKOR nema, amikor szolnia kellene. Onallo: csak a python
   standard konyvtar, semmi a marveen `src`-bol.

A RIASZTASI SZABALY (konjunkcio -- a masodik fele az ORT ellenorzi):
    RIASZT, HA   (now - last_out) >= T
            ES   (last_wake IS NULL VAGY last_wake < last_out VAGY (now - last_wake) >= T)
Szoban: az agens T ideje nem termelt semmit, ES ugyanebben az ablakban az or sem
szolalt meg. A masodik feltetel nelkul ez csak az or masolata lenne, es a 12
perces kuszobenel egy DOLGOZO agensre is allandoan tuzelne (mandark normal
ritmusa 13-28 perc).

T = 40 perc. Jarvis merte az egesz ejszakai forgalmon: ket ablak lepte at
(dexter 52 p, mandark 52 p), es MINDKETTONEL tuzelt az or -- vagyis ez a jelento
nulla riasztast adott volna. Ez a szam egy EJSZAKA forgalmara all; nappal,
kevesebb agenssel a normal resek hosszabbak lehetnek, ezert env-bol allithato.
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

FLEET_ROOT = os.environ.get("MARVEEN_ROOT") or os.path.expanduser("~/marveen")
DB_PATH = os.environ.get("IDLE_REPORTER_DB") or os.path.join(FLEET_ROOT, "store", "claudeclaw.db")
STATE_PATH = os.environ.get("IDLE_REPORTER_STATE") or os.path.join(
    FLEET_ROOT, "store", "idle-reporter-state.json")
ENV_PATH = os.environ.get("IDLE_REPORTER_ENV") or os.path.join(FLEET_ROOT, ".env")

DEFAULT_T_MIN = 40
# Ha ugyanaz a riasztas all fenn, ne menjen ki minden korben ujra. Allapotvaltasnal
# mindig szolunk; valtozatlan allapotban csak ennyi ora utan ismetlunk.
DEFAULT_REPEAT_H = 4


def _env_int(name, default):
    v = os.environ.get(name)
    if v:
        try:
            n = int(v)
            if n > 0:
                return n
        except ValueError:
            pass
    return default


def threshold_sec():
    return _env_int("IDLE_REPORTER_T_MIN", DEFAULT_T_MIN) * 60


def repeat_sec():
    return _env_int("IDLE_REPORTER_REPEAT_H", DEFAULT_REPEAT_H) * 3600


def roster(fleet_root=None):
    """Az agensek listaja a fajlrendszerbol, plusz a fo agens a .env-bol.

    NEM az adatbazisbol: egy agens, aki MEG SEMMIT nem irt, nem szerepelne az
    `agent_messages`-ben -- es epp az a legerdekesebb eset.
    """
    root = fleet_root or FLEET_ROOT
    names = set()
    agents_dir = os.path.join(root, "agents")
    try:
        for n in os.listdir(agents_dir):
            if os.path.isdir(os.path.join(agents_dir, n)) and not n.startswith("."):
                names.add(n)
    except OSError:
        pass
    names.add(env_value("MAIN_AGENT_ID", env_path=os.path.join(root, ".env")) or "marveen")
    return sorted(names)


def env_value(key, env_path=None):
    """Egy kulcs erteke a .env-bol. Titkot SOHA nem naplozunk, csak hasznalunk."""
    try:
        with open(env_path or ENV_PATH, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        return None
    return None


# --- a meres ---------------------------------------------------------------

class DbUnreadable(Exception):
    """Az adatbazis nem olvashato. NEM csend -- kulon jelentendo allapot."""


def read_activity(agents, db_path=None, now=None):
    """Agensenkent (last_out, last_wake) unix-masodpercben, vagy None.

    CSAK-OLVASO kapcsolat. A `mode=ro` nem kenyelmi kerdes: ez a szkript egy elo
    telepites adatbazisat nyitja meg egy launchd jobbol, es soha nem szabad,
    hogy irjon. Ha a fajl hianyzik vagy serult, DbUnreadable-t dobunk -- azt a
    hivo JELENTI, nem nyeli le.
    """
    path = db_path or DB_PATH
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as err:
        raise DbUnreadable(str(err)) from err
    try:
        out = {}
        for a in agents:
            try:
                row = conn.execute(
                    """
                    SELECT
                      (SELECT MAX(t) FROM (
                          SELECT MAX(created_at) AS t FROM kanban_comments WHERE author = ?
                          UNION ALL
                          SELECT MAX(created_at) AS t FROM agent_messages  WHERE from_agent = ?
                      )) AS last_out,
                      (SELECT MAX(created_at) FROM agent_messages
                         WHERE from_agent = 'system' AND to_agent = ?
                           AND content LIKE '%tetlen-or%') AS last_wake
                    """,
                    (a, a, a),
                ).fetchone()
            except sqlite3.Error as err:
                raise DbUnreadable(str(err)) from err
            out[a] = (row[0], row[1])
        return out
    finally:
        conn.close()


def is_silent(last_out, last_wake, now, t_sec):
    """A konjunkcio. Igaz, ha az agens elnemult ES az or sem szolalt kozben.

    A `last_out is None` (soha nem termelt semmit) NEM riasztas: egy frissen
    letrehozott agens nem tetlen, csak uj. Ha egyszer megszolal, onnantol merjuk.
    """
    if last_out is None:
        return False
    if now - last_out < t_sec:
        return False
    if last_wake is None:
        return True
    if last_wake < last_out:
        return True
    return now - last_wake >= t_sec


def evaluate(activity, now, t_sec):
    """A riaszto agensek nevei, rendezve."""
    return sorted(a for a, (lo, lw) in activity.items() if is_silent(lo, lw, now, t_sec))


# --- a jelentes ------------------------------------------------------------

def compose(silent, total, now, t_sec, activity):
    """A kimeno szoveg, vagy None ha nincs mit mondani.

    (a) HA A TELJES FLOTTA NEMA, EGY SORT KULDUNK, NEM HETET. Ha a dashboard
    folyamat all, senki nem termel es senki nem kap ebresztot -- tehat mind
    riasztana. A legrosszabb esetben a legzajosabb jelentes: pont akkor
    olvashatatlan, amikor szamit.
    """
    if not silent:
        return None
    t_min = t_sec // 60
    if total and len(silent) == total:
        return (f"[tetlen-jelento] A TELJES FLOTTA nema {t_min} perce ({total} agens), "
                f"es a tetlen-or sem szolalt meg. Ez valoszinuleg NEM {total} kulon "
                f"tetlenseg, hanem egy kozos ok -- eloszor a dashboard folyamatot nezd meg.")
    lines = [f"[tetlen-jelento] {len(silent)} agens nema {t_min} perce, es az or sem szolt nekik:"]
    for a in silent:
        lo, lw = activity[a]
        mins = int((now - lo) // 60) if lo else None
        wake = "sosem" if lw is None else f"{int((now - lw) // 60)} perce"
        lines.append(f"  {a}: utolso kimenet {mins} perce, utolso ebresztes {wake}")
    lines.append("Ez CSAK jelentes -- senkit nem ebresztettem fel.")
    return "\n".join(lines)


def db_error_text(err, t_min):
    """(b) A sajat vaksag IS jelentendo -- kulon szoveggel, hogy ne csendnek nezzek."""
    return ("[tetlen-jelento] NEM TUDTAM MERNI: a kanban-adatbazis nem olvashato. "
            f"Ez NEM azt jelenti, hogy minden rendben -- {t_min} perc ota nincs "
            f"ellenorzott allapotom a flottarol.\nOk: {str(err)[:200]}")


def load_state(path=None):
    try:
        with open(path or STATE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_state(state, path=None):
    p = path or STATE_PATH
    try:
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, p)
    except OSError:
        pass


def should_send(key, prev_state, now, repeat_s):
    """(c) ISMETLES-FEK: allapotvaltasnal mindig, valtozatlanul csak ritkan.

    A 6eba1d8c epp azt merte, mire vezet az ismetlodo azonos uzenet (78% azonos
    lista): az olvaso megszokja, es a KOVETKEZO, valodi valtozast is atlapozza.
    A csend->riaszt es a riaszt->csend viszont MINDIG esemeny.
    """
    if key is None:
        return prev_state.get("key") is not None  # riaszt -> csend: egyszer szolunk
    if prev_state.get("key") != key:
        return True
    return now - float(prev_state.get("sent_at") or 0) >= repeat_s


def usable_chat_id(chat):
    """Igaz, ha a chat-id tenylegesen kezbesitheto.

    A "0" KULON ESET, ES EZ MERT ALLAPOT (2026-08-23): ebben a telepitesben az
    `.env`-ben `ALLOWED_CHAT_ID=0` all. A csatorna allowlistes, tehat a 0-ra
    kuldes "chat 0 is not allowlisted"-tel hal el -- MIUTAN a jelentes elkeszult.
    Egy `-z`/ures-ellenorzes ezt ATENGEDI, mert a "0" nem ures string, es a
    kezbesites csendben sehova nem megy.
    Ezert nem az URESSEGET nezzuk, hanem a HASZNALHATOSAGOT.
    """
    return bool(chat) and chat.strip() not in ("", "0")


def send_telegram(text, token=None, chat_id=None):
    # `is None` ES NEM `or`: egy KIFEJEZETTEN atadott ures ertek azt jelenti,
    # hogy "nincs", nem azt, hogy "keresd meg a kornyezetben". A `or` valtozat
    # egy tesztben a VALODI .env-hez nyult es elo Telegram-hivast inditott a
    # gazda tokenjevel -- merve, ugyanezen a napon.
    tok = env_value("TELEGRAM_BOT_TOKEN") if token is None else token
    chat = env_value("ALLOWED_CHAT_ID") if chat_id is None else chat_id
    if not tok:
        print("NEM KULDTEM: TELEGRAM_BOT_TOKEN nincs beallitva", file=sys.stderr)
        return False
    if not usable_chat_id(chat):
        print(f"NEM KULDTEM: ALLOWED_CHAT_ID nem kezbesitheto ({chat!r}) -- "
              f"a 0 es az ures ertek egyarant konfiguracios hiba", file=sys.stderr)
        return False
    base = os.environ.get("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")
    req = urllib.request.Request(
        f"{base}/bot{tok}/sendMessage",
        data=json.dumps({"chat_id": chat, "text": text[:4000]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode()).get("ok", False)
    except Exception as err:  # halozat, HTTP, JSON -- mind ugyanaz a valasz
        print(f"NEM KULDTEM: {err}", file=sys.stderr)
        return False


def run(now=None, send=send_telegram, state_path=None, db_path=None, fleet_root=None):
    """Egy kor. A `send` es a `now` azert parameter, hogy tesztelheto legyen."""
    now = now if now is not None else time.time()
    t_sec = threshold_sec()
    agents = roster(fleet_root)
    prev = load_state(state_path)

    try:
        activity = read_activity(agents, db_path=db_path)
    except DbUnreadable as err:
        key = "db-unreadable"
        if should_send(key, prev, now, repeat_sec()):
            send(db_error_text(err, t_sec // 60))
            save_state({"key": key, "sent_at": now}, state_path)
        return key

    silent = evaluate(activity, now, t_sec)
    key = ",".join(silent) if silent else None
    if should_send(key, prev, now, repeat_sec()):
        text = compose(silent, len(agents), now, t_sec, activity)
        if text is None:
            # riaszt -> csend: a parja a riasztasnak, hogy ne maradjon nyitva
            text = "[tetlen-jelento] Rendben: minden agens ujra termel, vagy megkapta az ebresztest."
        send(text)
        save_state({"key": key, "sent_at": now}, state_path)
    return key


def send_log(text, token=None, chat_id=None):
    """Naplo-kimenet Telegram helyett. A launchd a stdoutot a unit
    StandardOutPath-jara iranyitja, tehat ez a fajlba kerul, idobelyeggel."""
    import datetime
    print(f"[{datetime.datetime.now().isoformat(timespec='seconds')}] JELENTENEM:\n{text}\n")
    return True


# A KULDO KIVALASZTASA KORNYEZETI VALTOZOBOL, es az ALAPERTELMEZES VALTOZATLAN
# (telegram) -- szandekosan. Ha itt a `log` lenne az alapertelmezes, akkor egy
# kesobbi telepito CSENDBEN kapna egy nemara allitott jelentot, es a "fut, de
# soha nem szol" allapot megkulonboztethetetlen lenne a "nincs mit jelenteni"-tol.
# Igy a nemitas a UNIT konfiguraciojaban all, lathatoan, es egy sor atirasaval
# vissza is fordithato.
SENDERS = {"telegram": send_telegram, "log": send_log}

if __name__ == "__main__":
    mode = os.environ.get("IDLE_REPORTER_SEND", "telegram").strip().lower()
    sender = SENDERS.get(mode)
    if sender is None:
        print(f"HIBA: ismeretlen IDLE_REPORTER_SEND={mode!r}; "
              f"ervenyes: {', '.join(sorted(SENDERS))}", file=sys.stderr)
        sys.exit(64)
    run(send=sender)

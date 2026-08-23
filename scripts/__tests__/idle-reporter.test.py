#!/usr/bin/env python3
"""A tetlen-jelento tesztjei (kartya ee4163be).

Futtatas:  python3 scripts/__tests__/idle-reporter.test.py

MIERT PYTHON-TESZT ES NEM VITEST: a szkript szandekosan ONALLO -- semmit nem
importal a marveen `src`-bol, mert epp azt az esetet kell tulelnie, amikor a node
folyamat all. Egy vitest-teszt a node-oldalrol csak a FORRASSZOVEGET tudna nezni,
es ma ejjel pont azt tanultuk meg, hogy az szoveg-poziciot mer, nem viselkedest.

Amit a tesztek rogzitenek:
  - a konjunkcio mindket fele (nema ES az or sem szolt)
  - a harom kulon kezelendo eset: teljes flotta / olvashatatlan DB / ismetles-fek
  - hogy a DB-kapcsolat tenylegesen CSAK-OLVASO
  - hogy a jelentes nem megy ki, ha nincs chat-id (nema kezbesites helyett hiba)
"""
import os
import sqlite3
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "idle_reporter", os.path.join(os.path.dirname(__file__), "..", "idle-reporter.py"))
ir = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ir)

MIN = 60
T = 40 * MIN
NOW = 1_787_000_000.0


def make_db(path, comments=(), messages=()):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE kanban_comments (id INTEGER PRIMARY KEY, card_id TEXT, author TEXT, content TEXT, created_at INTEGER)")
    conn.execute("CREATE TABLE agent_messages (id INTEGER PRIMARY KEY, from_agent TEXT, to_agent TEXT, content TEXT, created_at INTEGER)")
    conn.executemany("INSERT INTO kanban_comments (card_id, author, content, created_at) VALUES ('c', ?, 'x', ?)", comments)
    conn.executemany("INSERT INTO agent_messages (from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?)", messages)
    conn.commit()
    conn.close()


class Konjunkcio(unittest.TestCase):
    """A riasztasi szabaly mindket fele -- kulon-kulon megmerve."""

    def test_a_friss_kimenet_nem_riaszt(self):
        self.assertFalse(ir.is_silent(NOW - 5 * MIN, None, NOW, T))

    def test_a_regi_kimenet_riaszt_ha_az_or_sosem_szolt(self):
        self.assertTrue(ir.is_silent(NOW - 50 * MIN, None, NOW, T))

    def test_az_or_FRISS_ebresztese_ELNYOMJA_a_riasztast(self):
        # EZ A LENYEG. Enelkul a jelento csak az or masolata lenne: a 12 perces
        # kuszobnel egy DOLGOZO agensre is allandoan tuzelne (mandark normal
        # ritmusa 13-28 perc).
        self.assertFalse(ir.is_silent(NOW - 50 * MIN, NOW - 5 * MIN, NOW, T))

    def test_a_REGI_ebresztes_nem_nyomja_el(self):
        self.assertTrue(ir.is_silent(NOW - 50 * MIN, NOW - 60 * MIN, NOW, T))

    def test_az_ebresztes_a_kimenet_ELOTT_nem_szamit(self):
        # Az or szolt, az agens VALASZOLT is ra, aztan elnemult -- ez ujra nema
        # ablak, es a regi ebresztes nem fedi le.
        self.assertTrue(ir.is_silent(NOW - 45 * MIN, NOW - 50 * MIN, NOW, T))

    def test_aki_MEG_SOSEM_termelt_nem_tetlen_csak_uj(self):
        self.assertFalse(ir.is_silent(None, None, NOW, T))


class Meres(unittest.TestCase):
    """A lekerdezes -- kulonosen az, hogy a KOMMENT is kimenetnek szamit."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "t.db")

    def test_a_kartya_komment_IS_kimenet(self):
        # A LELET MAGJA: mandark 32 kommentet irt es 4 uzenetet. Csak az
        # uzeneteket nezve tetlennek latszana, mikozben vegig dolgozott.
        make_db(self.db, comments=[("mandark", int(NOW - 3 * MIN))], messages=[])
        act = ir.read_activity(["mandark"], db_path=self.db)
        self.assertEqual(act["mandark"][0], int(NOW - 3 * MIN))
        self.assertFalse(ir.is_silent(*act["mandark"], NOW, T))

    def test_a_kettobol_a_KESOBBIT_veszi(self):
        make_db(self.db,
                comments=[("didi", int(NOW - 50 * MIN))],
                messages=[("didi", "marveen", "x", int(NOW - 2 * MIN))])
        act = ir.read_activity(["didi"], db_path=self.db)
        self.assertEqual(act["didi"][0], int(NOW - 2 * MIN))

    def test_csak_a_tetlen_or_uzenete_szamit_ebresztesnek(self):
        make_db(self.db, comments=[("dexter", int(NOW - 50 * MIN))], messages=[
            ("system", "dexter", "[valami mas] nem ebresztes", int(NOW - 3 * MIN)),
        ])
        act = ir.read_activity(["dexter"], db_path=self.db)
        self.assertIsNone(act["dexter"][1])
        self.assertTrue(ir.is_silent(*act["dexter"], NOW, T))

    def test_a_kapcsolat_CSAK_OLVASO(self):
        # A szkript egy ELO telepites adatbazisat nyitja meg egy launchd jobbol.
        # Az iras tilalma nem szandek kerdese: a kapcsolatnak kell megtagadnia.
        make_db(self.db, comments=[("friday", int(NOW))])
        conn = sqlite3.connect(f"file:{self.db}?mode=ro", uri=True)
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("INSERT INTO kanban_comments (card_id, author, content, created_at) VALUES ('x','y','z',1)")
        conn.close()

    def test_a_hianyzo_DB_nem_csend_hanem_HIBA(self):
        with self.assertRaises(ir.DbUnreadable):
            ir.read_activity(["friday"], db_path=os.path.join(self.dir, "nincs-ilyen.db"))

    def test_a_SERULT_DB_sem_csend(self):
        bad = os.path.join(self.dir, "bad.db")
        with open(bad, "wb") as fh:
            fh.write(b"ez nem sqlite")
        with self.assertRaises(ir.DbUnreadable):
            ir.read_activity(["friday"], db_path=bad)


class HaromEset(unittest.TestCase):
    """A harom eset, amit jarvis terve kulon kezelendonek nevezett."""

    def test_a_TELJES_FLOTTA_nemasaga_EGY_sor(self):
        # (a) Ha a dashboard all, senki nem termel es senki nem kap ebresztot ->
        # mind riasztana. A legrosszabb esetben a legzajosabb jelentes.
        act = {a: (NOW - 50 * MIN, None) for a in ("a", "b", "c")}
        txt = ir.compose(["a", "b", "c"], 3, NOW, T, act)
        self.assertIn("TELJES FLOTTA", txt)
        self.assertIn("dashboard", txt)
        self.assertEqual(txt.count("\n"), 0, "egy sor legyen, nem harom")

    def test_reszleges_nemasagnal_agensenkent_sorol(self):
        act = {"a": (NOW - 50 * MIN, None), "b": (NOW - 2 * MIN, None)}
        txt = ir.compose(["a"], 2, NOW, T, act)
        self.assertIn("  a: utolso kimenet 50 perce", txt)
        self.assertNotIn("TELJES FLOTTA", txt)

    def test_a_jelentes_kimondja_hogy_NEM_ebresztett(self):
        # Ket utemezo ugyanazert az agensert a holtpont alakja. Az olvasonak
        # tudnia kell, hogy ez CSAK jelentes.
        act = {"a": (NOW - 50 * MIN, None), "b": (NOW - 2 * MIN, None)}
        self.assertIn("nem ebresztettem", ir.compose(["a"], 2, NOW, T, act))

    def test_csendben_nincs_szoveg(self):
        self.assertIsNone(ir.compose([], 3, NOW, T, {}))

    def test_a_DB_hiba_szovege_NEM_ugy_hangzik_mint_a_rendben(self):
        # (b) Egy jelento, ami a sajat vaksagatol elnemul, ugyanaz a csalad, mint
        # amit ez a kartya javit.
        txt = ir.db_error_text(sqlite3.OperationalError("locked"), 40)
        self.assertIn("NEM TUDTAM MERNI", txt)
        self.assertIn("NEM azt jelenti, hogy minden rendben", txt)


class IsmetlesFek(unittest.TestCase):
    """(c) Allapotvaltasnal mindig, valtozatlanul csak ritkan."""

    def test_uj_riasztas_megy(self):
        self.assertTrue(ir.should_send("a", {}, NOW, 4 * 3600))

    def test_ugyanaz_a_riasztas_nem_ismetlodik_azonnal(self):
        self.assertFalse(ir.should_send("a", {"key": "a", "sent_at": NOW - 60}, NOW, 4 * 3600))

    def test_ugyanaz_a_riasztas_ISMETLODIK_a_fek_utan(self):
        self.assertTrue(ir.should_send("a", {"key": "a", "sent_at": NOW - 5 * 3600}, NOW, 4 * 3600))

    def test_MAS_agens_azonnal_uj_esemeny(self):
        self.assertTrue(ir.should_send("a,b", {"key": "a", "sent_at": NOW - 60}, NOW, 4 * 3600))

    def test_riaszt_utan_a_CSEND_is_esemeny(self):
        # A riasztas parja. Enelkul az olvaso nem tudja, elmult-e.
        self.assertTrue(ir.should_send(None, {"key": "a", "sent_at": NOW - 60}, NOW, 4 * 3600))

    def test_csendbol_csendbe_nem_szolunk(self):
        self.assertFalse(ir.should_send(None, {"key": None, "sent_at": NOW - 60}, NOW, 4 * 3600))


class VegponttolVegpontig(unittest.TestCase):
    """A `run()` egesz kore, faked kuldessel es sajat allapotfajllal."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "t.db")
        self.state = os.path.join(self.dir, "state.json")
        self.fleet = os.path.join(self.dir, "fleet")
        os.makedirs(os.path.join(self.fleet, "agents", "mandark"))
        os.makedirs(os.path.join(self.fleet, "agents", "didi"))
        with open(os.path.join(self.fleet, ".env"), "w", encoding="utf-8") as fh:
            fh.write("MAIN_AGENT_ID=marveen\n")
        self.sent = []

    def _run(self, now):
        return ir.run(now=now, send=self.sent.append, state_path=self.state,
                      db_path=self.db, fleet_root=self.fleet)

    def test_nema_agensrol_jelent_majd_nem_ismetel(self):
        make_db(self.db, comments=[
            ("mandark", int(NOW - 50 * MIN)), ("didi", int(NOW - 2 * MIN)),
            ("marveen", int(NOW - 2 * MIN)),
        ])
        self._run(NOW)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("mandark", self.sent[0])
        self._run(NOW + 300)          # kovetkezo kor, valtozatlan allapot
        self.assertEqual(len(self.sent), 1, "ugyanaz a riasztas nem mehet ujra")

    def test_a_helyreallas_egy_uzenetet_ad(self):
        make_db(self.db, comments=[
            ("mandark", int(NOW - 50 * MIN)), ("didi", int(NOW - 2 * MIN)),
            ("marveen", int(NOW - 2 * MIN)),
        ])
        self._run(NOW)
        # mandark ujra termel: a kovetkezo kor "rendben"-t ad, es tobbet nem
        make_db(self.db + "2", comments=[
            ("mandark", int(NOW + 100)), ("didi", int(NOW + 100)), ("marveen", int(NOW + 100)),
        ])
        self.db = self.db + "2"
        self._run(NOW + 300)
        self.assertEqual(len(self.sent), 2)
        self.assertIn("Rendben", self.sent[1])
        self._run(NOW + 600)
        self.assertEqual(len(self.sent), 2, "a csend nem ismetlodik")

    def test_olvashatatlan_DB_eseten_IS_jelent(self):
        self.db = os.path.join(self.dir, "nincs.db")
        key = self._run(NOW)
        self.assertEqual(key, "db-unreadable")
        self.assertEqual(len(self.sent), 1)
        self.assertIn("NEM TUDTAM MERNI", self.sent[0])


class Kezbesites(unittest.TestCase):
    """A kezbesitesi kapu -- ES EGY TESZT, AMI ELOSZOR HALOZATHOZ NYULT.

    Az elso valtozat `send_telegram("x", token="", chat_id="")`-t hivott, es a
    fuggveny `token or env_value(...)` alakja miatt az URES ertek ATESETT a
    kornyezetre: a teszt a VALODI .env-bol vette a gazda bot-tokenjet, es elo
    HTTP-hivast inditott a Telegram fele (HTTP 400 jott vissza, mert a chat-id
    "0" volt -- uzenet tehat nem ment ki, de a hivas megtortent).
    Ket dolgot javit ez: a fuggveny `is None`-t nez (a kifejezett ures ertek
    "nincs"-et jelent), es a teszt sosem hagyja a fuggvenyt a kornyezethez erni.
    """

    def test_ures_chat_id_eseten_NEM_kuld(self):
        self.assertFalse(ir.send_telegram("x", token="t", chat_id=""))

    def test_a_NULLA_chat_id_sem_kezbesitheto(self):
        # MERT ALLAPOT: ebben a telepitesben az .env-ben `ALLOWED_CHAT_ID=0` all.
        # A "0" nem ures string, tehat egy ures-ellenorzes ATENGEDNE -- es a
        # kuldes "chat 0 is not allowlisted"-tel halna el, a jelentes elkeszulte
        # UTAN. Csendes nem-kezbesites.
        self.assertFalse(ir.usable_chat_id("0"))
        self.assertFalse(ir.send_telegram("x", token="t", chat_id="0"))

    def test_token_nelkul_NEM_kuld(self):
        self.assertFalse(ir.send_telegram("x", token="", chat_id="123"))

    def test_valodi_chat_id_atmegy_a_kapun(self):
        # Pozitiv kontroll: enelkul a fenti harom attol is zold lenne, hogy a
        # kapu MINDENT elutasit.
        self.assertTrue(ir.usable_chat_id("8362010684"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

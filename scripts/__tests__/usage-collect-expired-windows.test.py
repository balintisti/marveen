#!/usr/bin/env python3
"""`_mark_expired_windows`: a SZAMOK kora, nem a FAJLE -- kartya d7c57d12.

MIERT LETEZIK. 2026-09-19-en kiderult, hogy a kulcstarto-hitelesites 129 oraja lejart,
es a lekerdezo azota `ok: true`-t adott `authoritative_cached` forrasbol. HAROM fuggetlen
reteg mondott "friss"-et ugyanarra a tobb napos adatra:

    `ok: true` ................................ sikernek latszik
    `cache_age_minutes` = 8,3 ................. a CACHE-BEJEGYZES kora, nem az ADATE
    a fogyasztok `generated_at`-ora ........... MINDEN futas MOSTRA allitja

Kozben mind a harom keret-ablak `resets_at`-je a MULTBAN allt. Az ara: harom agens
(friday, jarvis, mandark) feloldasi feltetele az volt, hogy a keret-meres ELO forrasra
terjen vissza -- es a feltetel ot napon at nemán nem tudott teljesulni.

AZ INGYENES KONTROLL, amit senki nem futtatott: EGY KERET-ABLAK, AMINEK A RESET-IDEJE
ELMULT, NEM LEHET AZ AKTUALIS ABLAK.

MIERT MESTERSEGES BEMENET, KIMONDVA: az elo lekerdezes MA egyaltalan nem ad `windows`-t
(a gyorsitotar lejart, es az `estimate` ag csak token-becsleseket ad). Egy elo adatra
kotott teszt tehat ma ZOLD LENNE ANELKUL, HOGY BARMIT ALLITANA -- pontosan az a "vakon
zold" alak, amit a lap tilt. Ezert a tiszta fuggvenyt merjuk, rogzitett idovel.
"""
import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location("uc", os.path.join(ROOT, "scripts", "usage-collect.py"))
uc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(uc)

NOW = 1_800_000_000.0
ORA = 3600.0


class ExpiredWindows(unittest.TestCase):
    def test_mind_lejart(self):
        r = {"windows": {
            "five_hour": {"resets_at": NOW - 129 * ORA},
            "seven_day": {"resets_at": NOW - 50 * ORA},
        }}
        uc._mark_expired_windows(r, now=NOW)
        self.assertTrue(r["all_windows_expired"])
        self.assertEqual(sorted(r["windows_expired"]), ["five_hour", "seven_day"])
        # ALSO KORLAT: a LEGFRISSEBB lejart ablak adja, nem a legregebbi.
        # Ez a diszkriminator -- egy `max()` itt 129-et adna, es az TULBECSULNE a kort.
        self.assertEqual(r["data_age_hours_min"], 50.0)
        self.assertEqual(r["windows"]["five_hour"]["expired_hours_ago"], 129.0)

    def test_egyik_sem_lejart(self):
        r = {"windows": {"five_hour": {"resets_at": NOW + ORA}}}
        uc._mark_expired_windows(r, now=NOW)
        self.assertFalse(r["all_windows_expired"])
        self.assertEqual(r["windows_expired"], [])
        self.assertNotIn("expired_hours_ago", r["windows"]["five_hour"])

    def test_vegyes(self):
        """A RESZLEGES eset a valodi veszely: egy lejart ablak egy elo mellett."""
        r = {"windows": {
            "regi": {"resets_at": NOW - 2 * ORA},
            "elo": {"resets_at": NOW + 2 * ORA},
        }}
        uc._mark_expired_windows(r, now=NOW)
        self.assertFalse(r["all_windows_expired"])
        self.assertEqual(r["windows_expired"], ["regi"])
        self.assertEqual(r["data_age_hours_min"], 2.0)

    def test_nincs_windows_kulcs_nem_hazudik(self):
        """MA EZ AZ ELO ESET: nincs `windows`. Ilyenkor NEM allit semmit.

        Kulon allitas, mert egy `all_windows_expired: False` itt azt jelentene, hogy
        "megneztem es rendben van" -- holott nem volt mit megnezni.
        """
        r = {"provider": "claude", "source": "estimate", "ok": True}
        uc._mark_expired_windows(r, now=NOW)
        self.assertNotIn("all_windows_expired", r)
        self.assertNotIn("data_age_hours_min", r)

    def test_ertelmezhetetlen_resets_at_kimarad(self):
        r = {"windows": {"rossz": {"resets_at": "tegnap"}, "hianyzik": {}}}
        uc._mark_expired_windows(r, now=NOW)
        self.assertEqual(r["windows_expired"], [])
        self.assertFalse(r["all_windows_expired"])

    def test_a_burkolo_minden_agat_fedi(self):
        """A `collect_claude` BURKOLO, nem harom kulon hivas.

        Az elso valtozatom CSAK a gyorsitotarazott agba volt bekotve, es a kovetkezo
        futas az `estimate` agon ment -> mind a negy mezo None. Egy negyedik `return`
        ugyanigy esne ki, nemán. Ez az allitas a BURKOLAS TENYET rogziti.
        """
        import inspect
        src = inspect.getsource(uc.collect_claude)
        self.assertIn("_mark_expired_windows", src)
        self.assertIn("_collect_claude_raw", src)
        # es a belso fuggveny NE hivja maga -- kulonben visszacsuszott a per-ag alak
        self.assertNotIn("_mark_expired_windows", inspect.getsource(uc._collect_claude_raw))


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""A `--grow` az INDOK SZOVEGE, nem a novekmeny szama.

MERT ESET (marveen magan, 2026-09-19): harom egymas utani novekedest `--grow 430`,
`--grow 338`, `--grow 683` alakban hivtam meg -- a szam kezenfekvobb volt --, es a
valodi indokot a `--reason` kapcsoloba irtam, amit ez az ag SOSEM OLVAS. A naploba
igy SZAM kerult oda, ahol a korabbi sorokban tobb mondatos indoklas all:

    ... GROW 176514 -> 177529 :: friday alakja: a MAR MEGLEVO fan-out szabaly ...
    ... GROW 177529 -> 177959 :: 430        <- itt

AMIERT NEM DERULT KI MAGATOL: egy szam abban az oszlopban HIHETONEK latszik. A meret
a fajlbol barmikor visszamerheto; az INDOK az egyetlen dolog, ami csak ott van meg.

A teszt mindharom utvonalat IZOLALJA (CLAUDE_MD_PATH / _BASELINE / _LOG), mert egy
proba, ami a valodi naploba ir, pont azt a mennyiseget hamisitja meg, amit a naplo mer.
"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "claude-md-edit.py"


class GrowReason(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.page = Path(self.d, "CLAUDE.md"); self.page.write_text("ELEJE\nHORGONY\nVEGE\n", encoding="utf-8")
        self.base = Path(self.d, "baseline.txt"); self.base.write_text("20\n", encoding="utf-8")
        self.log = Path(self.d, "size.log"); self.log.write_text("", encoding="utf-8")
        # A kanari-lista IS izolalando: a valodi lista a valodi lap mondatait vedi, es egy
        # proba-lapon MINDEGYIK hianyzik -- a kapu helyesen tuzel, csak nem arra, amit merunk.
        self.canary = Path(self.d, "canary.txt"); self.canary.write_text("ELEJE\n", encoding="utf-8")
        self.a = Path(self.d, "a.txt"); self.a.write_text("HORGONY", encoding="utf-8")
        self.r = Path(self.d, "r.txt"); self.r.write_text("HORGONY, de jóval hosszabb szöveggel", encoding="utf-8")

    def run_edit(self, *args):
        env = dict(os.environ,
                   CLAUDE_MD_PATH=str(self.page),
                   CLAUDE_MD_BASELINE=str(self.base),
                   CLAUDE_MD_LOG=str(self.log),
                   CLAUDE_MD_CANARY=str(self.canary))
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--anchor-file", str(self.a), "--replace-file", str(self.r), *args],
            capture_output=True, text=True, env=env)

    def test_csupasz_szam_megtagadva(self):
        """EZ A TEHERHORDO ALLITAS: a szam NEM indok, es a szerszam MEGTAGADJA."""
        p = self.run_edit("--grow", "683")
        self.assertEqual(p.returncode, 5, p.stdout + p.stderr)
        self.assertIn("INDOK SZOVEGE", p.stderr)
        # es NEM irta at a lapot
        self.assertEqual(self.page.read_text(encoding="utf-8"), "ELEJE\nHORGONY\nVEGE\n")

    def test_szam_plusz_reason_helyreall(self):
        """A hivo LEIRTA az indokot, csak rossz kapcsoloba. Ne dobjuk el -- ez tortent velem."""
        ok = "a kommentek limitalhato olvasasa, mert merve 83-97% megtakaritast ad"
        p = self.run_edit("--grow", "683", "--reason", ok)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(ok, self.log.read_text(encoding="utf-8"))
        self.assertNotIn(":: 683", self.log.read_text(encoding="utf-8"))

    def test_tul_rovid_indok_megtagadva(self):
        p = self.run_edit("--grow", "kell")
        self.assertEqual(p.returncode, 5, p.stdout + p.stderr)
        self.assertIn("tul rovid", p.stderr)

    def test_rendes_indok_atmegy_es_naplozodik(self):
        """NEGATIV KONTROLL: a kapu tud ATENGEDNI is, kulonben csak egy tiltas lenne."""
        ok = "didi merese: a develop nem ervenyes alapvonal tartalmi ellenorzeshez"
        p = self.run_edit("--grow", ok)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(ok, self.log.read_text(encoding="utf-8"))
        self.assertIn("hosszabb", self.page.read_text(encoding="utf-8"))

    def test_a_szamos_indok_szovegkent_atmegy_ha_van_melle_szoveg(self):
        """Egy indok, ami SZAMMAL KEZDODIK de szoveg, nem esik aldozatul."""
        ok = "430 karakterrel no, mert a kartya-nyitas a helperre all at"
        p = self.run_edit("--grow", ok)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(ok, self.log.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

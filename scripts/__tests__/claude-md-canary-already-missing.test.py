#!/usr/bin/env python3
"""A kanari CSAK azt tagadja meg, amit az adott iras visz el (kartya 5d2b94a9).

MERT ESET (friday, 2026-10-24): a 2026-10-07-i vagas a szerszamon kivul 6 kanari-mondatot a
rulebookba vitt, a kanari-lista maradt. Attol fogva a lap MINDEN irasa rc=69 lett, egy
egysoros, kanarit nem erinto bovites is, es a hibauzenet azt mondta, hogy a valtozas "vinne
el" oket. A `--check` kozben "OK"-t mondott.

A teszt mindegyik utat IZOLALJA (CLAUDE_MD_PATH / _BASELINE / _LOG / _CANARY).
"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "claude-md-edit.py"
PAGE0 = "ELEJE\nKANARI-A itt all\nHORGONY\nVEGE\n"


class CanaryAlreadyMissing(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.page = Path(self.d, "CLAUDE.md"); self.page.write_text(PAGE0, encoding="utf-8")
        self.base = Path(self.d, "baseline.txt"); self.base.write_text("1000\n", encoding="utf-8")
        self.log = Path(self.d, "size.log"); self.log.write_text("", encoding="utf-8")
        # KANARI-B a lapon MAR NINCS: ez a mert allapot
        self.canary = Path(self.d, "canary.txt"); self.canary.write_text("KANARI-A\nKANARI-B\n", encoding="utf-8")

    def env(self):
        return dict(os.environ, CLAUDE_MD_PATH=str(self.page), CLAUDE_MD_BASELINE=str(self.base),
                    CLAUDE_MD_LOG=str(self.log), CLAUDE_MD_CANARY=str(self.canary))

    def edit(self, anchor, repl):
        a = Path(self.d, "a.txt"); a.write_text(anchor, encoding="utf-8")
        r = Path(self.d, "r.txt"); r.write_text(repl, encoding="utf-8")
        return subprocess.run([sys.executable, str(SCRIPT), "--anchor-file", str(a), "--replace-file", str(r)],
                              capture_output=True, text=True, env=self.env())

    def test_mar_hianyzo_nem_blokkol_de_megnevezi(self):
        """EZ A TEHERHORDO ALLITAS: egy kanarit nem erinto iras atmegy, a mar hianyzot megnevezi."""
        p = self.edit("HORGONY", "HORGONY uj sor")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("HORGONY uj sor", self.page.read_text(encoding="utf-8"))
        self.assertIn("MAR HIANYZIK 1", p.stderr)
        self.assertIn("KANARI-B", p.stderr)
        self.assertIn("CANARY ALREADY MISSING", self.log.read_text(encoding="utf-8"))

    def test_kontroll_amit_az_iras_visz_el_azt_megtagadja(self):
        p = self.edit("KANARI-A itt all\n", "")
        self.assertEqual(p.returncode, 69, p.stdout + p.stderr)
        self.assertEqual(self.page.read_text(encoding="utf-8"), PAGE0)
        self.assertIn("1 TEHERHORDO mondatot vinne el", p.stderr)

    def test_a_megtagadas_csak_a_sajat_vesztet_sorolja(self):
        p = self.edit("KANARI-A itt all\n", "")
        refusal = p.stderr.split("Ezek a")[0]
        self.assertIn("KANARI-A", refusal)
        self.assertNotIn("KANARI-B", refusal)

    def check(self):
        return subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True, env=self.env())

    def test_check_jelzi_a_hianyt(self):
        p = self.check()
        self.assertEqual(p.returncode, 6, p.stdout + p.stderr)
        self.assertIn("KANARI-HIANY: KANARI-B", p.stderr)

    def test_kontroll_check_teljes_kanarival_ok(self):
        self.page.write_text(PAGE0 + "KANARI-B\n", encoding="utf-8")
        p = self.check()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("kanari: megvan mind", p.stdout)


if __name__ == "__main__":
    unittest.main()

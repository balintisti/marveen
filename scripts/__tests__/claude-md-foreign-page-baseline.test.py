#!/usr/bin/env python3
"""Egy MASIK lapra iranyitott hivas nem irhatja at a kozos lap alapvonalat (kartya 144cb784).

MERT ESET (deeper, 2026-09-20): a `PAGE` hivas-szintu (`CLAUDE_MD_PATH`), a `BASE`
globalis. Egy 145 269 karakteres lapra iranyitott hivas a 188 041-es kozos alapvonalhoz
mert, es a racsni (`min(cur, base)`) azt az alapvonalat szoritotta volna le.

A teszt a szkript MASOLATAT futtatja, az alapertelmezett utakat ideiglenes fajlokra
cserelve: igy egy mutacio (az or kivetele) sem nyulhat az eles alapvonalhoz.
"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "claude-md-edit.py"
LIVE_PAGE = "/Users/isti/marveen/CLAUDE.md"
LIVE_BASE = "/Users/isti/marveen/scripts/claude-md-baseline.txt"
LIVE_LOG = "/Users/isti/marveen/store/claude-md-size.log"
LIVE_CANARY = "/Users/isti/marveen/scripts/claude-md-canary.txt"


class ForeignPageBaseline(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.d = d
        self.shared = d / "shared-CLAUDE.md"; self.shared.write_text("ELEJE\n" + "x" * 200 + "\n", encoding="utf-8")
        self.base = d / "shared-baseline.txt"; self.base.write_text("300\n", encoding="utf-8")
        self.log = d / "size.log"; self.log.write_text("", encoding="utf-8")
        self.canary = d / "canary.txt"; self.canary.write_text("ELEJE\n", encoding="utf-8")
        self.other = d / "agent-CLAUDE.md"; self.other.write_text("ELEJE\nHORGONY\n", encoding="utf-8")
        src = SCRIPT.read_text(encoding="utf-8")
        for live, tmp in ((LIVE_PAGE, self.shared), (LIVE_BASE, self.base), (LIVE_LOG, self.log), (LIVE_CANARY, self.canary)):
            self.assertIn(f'"{live}"', src, f"a szkript alapertelmezett utja megvaltozott: {live}")
            src = src.replace(f'"{live}"', f'"{tmp}"')
        self.script = d / "claude-md-edit.py"; self.script.write_text(src, encoding="utf-8")
        a = d / "a.txt"; a.write_text("HORGONY", encoding="utf-8")
        r = d / "r.txt"; r.write_text("H", encoding="utf-8")
        self.edit_args = ["--anchor-file", str(a), "--replace-file", str(r)]

    def run_script(self, args, **env_extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_MD_")}
        env.update(env_extra)
        return subprocess.run([sys.executable, str(self.script), *args], capture_output=True, text=True, env=env)

    def baseline_value(self):
        lines = [l for l in self.base.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
        return lines[-1].strip()

    def test_idegen_lap_alapertelmezett_alapvonallal_megtagadva(self):
        p = self.run_script(self.edit_args, CLAUDE_MD_PATH=str(self.other))
        self.assertEqual(p.returncode, 64, p.stderr)
        self.assertIn("CLAUDE_MD_BASELINE", p.stderr)
        self.assertEqual(self.baseline_value(), "300")
        self.assertEqual(self.other.read_text(encoding="utf-8"), "ELEJE\nHORGONY\n")

    def test_set_baseline_idegen_lapra_sem_irja_at(self):
        p = self.run_script(["--set-baseline", "--reason", "proba"], CLAUDE_MD_PATH=str(self.other))
        self.assertEqual(p.returncode, 64, p.stderr)
        self.assertEqual(self.baseline_value(), "300")

    def test_POZITIV_KONTROLL_sajat_alapvonallal_az_idegen_lap_irhato(self):
        own = self.d / "agent-baseline.txt"; own.write_text("100\n", encoding="utf-8")
        p = self.run_script(self.edit_args, CLAUDE_MD_PATH=str(self.other), CLAUDE_MD_BASELINE=str(own))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.other.read_text(encoding="utf-8"), "ELEJE\nH\n")
        self.assertEqual(self.baseline_value(), "300")

    def test_POZITIV_KONTROLL_env_nelkul_a_kozos_lap_mukodik(self):
        p = self.run_script(["--check"])
        self.assertEqual(p.returncode, 0, p.stderr)


if __name__ == "__main__":
    unittest.main()

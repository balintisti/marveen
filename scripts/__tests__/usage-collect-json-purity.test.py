#!/usr/bin/env python3
"""A `--json` mod STDOUTJA CSAK JSON lehet -- kartya 3110c78d.

MIERT LETEZIK. A modul sajat docstringje azt igeri: "--json prints only the snapshot
JSON (no alerts, no side effects)". 2026-09-19-en ez NEM allt: a kulcstartó-frissites
hibaaga egy `  (keychain refresh failed, ...)` sort irt a STDOUTRA, a JSON ELE.

A kar nem elmeleti volt. A `scripts/hooks/claude-usage.py` (Szotasztol atvett,
nulla-tokenes /usage parancs Telegramra) pontosan ezt hivja, `json.loads()`-szal
olvassa, es a kivetel agan a GENERIC_ERROR_REPLY-t kuldi. Vagyis a kepesseg MEGVOLT
es SOHA nem ert volna oda -- es a hibauzenet a HOOKRA mutatott volna, nem ide.

Ez a teszt a SZERZODEST vedi, nem a konkret sort: barmely jovobeli `print()` a
--json uton ugyanigy elbuktatja.
"""
import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, "scripts", "usage-collect.py")


class JsonPurity(unittest.TestCase):
    def setUp(self):
        if not os.path.isfile(SCRIPT):
            self.skipTest(f"nincs meg: {SCRIPT}")
        self.run_ = subprocess.run(
            [sys.executable, SCRIPT, "--json"],
            capture_output=True, text=True, timeout=60,
        )

    def test_stdout_is_parseable_json(self):
        """A STDOUT egeszben ertelmezheto JSON -- nem csak 'tartalmaz' JSON-t."""
        self.assertEqual(self.run_.returncode, 0, self.run_.stderr[-400:])
        try:
            d = json.loads(self.run_.stdout)
        except json.JSONDecodeError as e:
            self.fail(
                "a --json stdoutja NEM ervenyes JSON (ez a hiba, amit a hook nem "
                f"tudott volna megnevezni): {e}\n"
                f"az elso 120 karakter: {self.run_.stdout[:120]!r}"
            )
        # POZITIV oldal: egy ures dict is atmenne a fenti parse-on.
        self.assertIn("claude", d)
        self.assertIn("generated_at", d)

    def test_no_leading_non_json_line(self):
        """A legelso NEM-URES sor `{`-rel kezdodjon.

        Kulon allitas a parse mellett, mert egy szennyezo sor a JSON UTAN nem
        feltetlenul rontja el a parse-t minden olvasonal -- ez a valodi horgony.
        """
        elso = next((l for l in self.run_.stdout.splitlines() if l.strip()), "")
        self.assertTrue(
            elso.lstrip().startswith("{"),
            f"a stdout elso nem-ures sora nem JSON-kezdet: {elso[:120]!r}",
        )

    def test_warnings_go_to_stderr_not_stdout(self):
        """A figyelmeztetesek a stderr-re mennek.

        NEM azt allitja, hogy VAN figyelmeztetes -- az kornyezet-fuggo. Azt allitja,
        hogy ha van, akkor nem a stdouton van. Ezert a stdout-oldali tiltas a horgony.
        """
        self.assertNotIn("keychain refresh failed", self.run_.stdout)
        self.assertNotIn("(keychain", self.run_.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)

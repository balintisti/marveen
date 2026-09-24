#!/usr/bin/env python3
"""safety-core-drift-check.py -- card 432df9a5.

The measured case this pins: on 2026-09-24 the template was BEHIND the pages (the 09-20 Telegram
section stood on 7/7 pages and 0 times in the template). A check that only asks "is every template
line on the page" passes that case green, because every template line IS there. So both directions
are tested here, each with a control, plus the two ways the check must refuse to answer.
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "safety-core-drift-check.py")

TEMPLATE = """# SAFETY CORE
### 1. PUSH
{{OWNER_NAME}} forkja a fork remote.
git push fork <ag>
### 2. ADAT
Irni csak {{OWNER_NAME}} kulon szavaval.
chat_id: {{CHAT_ID}}
c = connect('file:{{INSTALL_DIR}}/store/db?mode=ro')
### 3. KAPU
a kapu tuzel
"""

INSERTED = ["### 2b. UJ SZAKASZ", "egy uj szabaly, ami a lapokon mar all", "es a sablonban meg nem"]


def rendered(root):
    return (TEMPLATE.replace("{{OWNER_NAME}}", "Tulaj").replace("{{CHAT_ID}}", "12345")
            .replace("{{INSTALL_DIR}}", root))


class DriftCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(os.path.join(self.root, "templates"))
        with open(os.path.join(self.root, "templates", "SAFETY-CORE.template"), "w") as f:
            f.write(TEMPLATE)
        with open(os.path.join(self.root, ".env"), "w") as f:
            f.write("OWNER_NAME=Tulaj\nALLOWED_CHAT_ID=12345\n")

    def tearDown(self):
        self.tmp.cleanup()

    def page(self, agent, body):
        d = os.path.join(self.root, "agents", agent)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "CLAUDE.md"), "w") as f:
            f.write("# " + agent + "\nsajat bevezeto\n\n" + body + "\nsajat zaras\n")

    def run_check(self):
        return subprocess.run([sys.executable, SCRIPT, "--root", self.root], capture_output=True, text=True)

    def with_insert(self):
        lines = rendered(self.root).splitlines()
        cut = lines.index("### 3. KAPU")
        return "\n".join(lines[:cut] + INSERTED + lines[cut:])

    def test_identical_pages_are_clean(self):
        self.page("a", rendered(self.root))
        self.page("b", rendered(self.root))
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("MINDEN LAP EGYEZIK", r.stdout)

    def test_missing_template_line_is_drift(self):
        self.page("a", rendered(self.root))
        self.page("b", rendered(self.root).replace("a kapu tuzel\n", ""))
        r = self.run_check()
        self.assertEqual(r.returncode, 3, r.stdout)
        self.assertIn("HIANYZIK: a kapu tuzel", r.stdout)

    def test_template_behind_pages_is_drift_THE_0920_CASE(self):
        # every template line is present on both pages -- the one-directional check is blind here
        self.page("a", self.with_insert())
        self.page("b", self.with_insert())
        r = self.run_check()
        self.assertEqual(r.returncode, 3, r.stdout)
        self.assertIn("A SABLON LE VAN MARADVA", r.stdout)
        self.assertIn("egy uj szabaly, ami a lapokon mar all", r.stdout)

    def test_a_stray_copy_higher_up_does_not_open_the_block(self):
        # the template's tail also stands near the top of both pages (quoted elsewhere); the real
        # block has the 09-20-shaped insert. Only the insert may be reported -- not the pages'
        # own intro text that lies between the stray copy and the block.
        stray = "### 3. KAPU\na kapu tuzel\n"
        self.page("a", stray + "kozos sajat szoveg\n" + self.with_insert())
        self.page("b", stray + "kozos sajat szoveg\n" + self.with_insert())
        r = self.run_check()
        self.assertEqual(r.returncode, 3, r.stdout)
        self.assertIn("egy uj szabaly, ami a lapokon mar all", r.stdout)
        self.assertNotIn("kozos sajat szoveg", r.stdout)

    def test_CONTROL_insert_on_ONE_page_is_only_noted(self):
        self.page("a", self.with_insert())
        self.page("b", rendered(self.root))
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("egy-lapos betet", r.stdout)
        self.assertNotIn("LE VAN MARADVA", r.stdout)

    def test_unresolved_placeholder_is_NOT_MEASURED_not_drift(self):
        # the 09-19 false drift number came from comparing without substitution
        with open(os.path.join(self.root, ".env"), "w") as f:
            f.write("OWNER_NAME=Tulaj\n")
        self.page("a", rendered(self.root))
        r = self.run_check()
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("{{CHAT_ID}}", r.stdout)
        self.assertNotIn("12345", r.stdout)

    def test_no_pages_is_NOT_MEASURED(self):
        r = self.run_check()
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("egyetlen agens-lap sincs", r.stdout)

    def test_a_named_exception_is_itself_checked(self):
        # dexter's four allowed lines do not exist in this fixture template: an exception for a
        # line the template no longer has must surface, or the list grows silently
        self.page("dexter", rendered(self.root))
        r = self.run_check()
        self.assertEqual(r.returncode, 3, r.stdout)
        self.assertIn("KIVETEL, AMI MAR NINCS A SABLONBAN", r.stdout)

    def test_values_are_never_printed(self):
        self.page("a", rendered(self.root).replace("a kapu tuzel\n", ""))
        r = self.run_check()
        self.assertNotIn("12345", r.stdout + r.stderr)

    def test_it_writes_nothing(self):
        self.page("a", rendered(self.root).replace("a kapu tuzel\n", ""))
        self.page("b", self.with_insert())

        def snapshot():
            out = {}
            for d, _, files in os.walk(self.root):
                for n in files:
                    p = os.path.join(d, n)
                    with open(p, "rb") as f:
                        out[p] = (f.read(), os.stat(p).st_mtime_ns)
            return out

        before = snapshot()
        self.run_check()
        self.assertEqual(before, snapshot())


if __name__ == "__main__":
    unittest.main()

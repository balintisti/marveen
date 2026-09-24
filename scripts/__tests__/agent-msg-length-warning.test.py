#!/usr/bin/env python3
"""The 800-character body warning in agent-msg.sh. Card 504dc397.

marveen's decision (2026-09-24): a WARNING on stderr, not a gate. Same isolation as the
sender-ceiling test: the helper is copied into a throwaway tree with its own store/, and
MARVEEN_WEB_PORT points at a dead port, so no message can reach the live dashboard.

Run: python3 scripts/__tests__/agent-msg-length-warning.test.py   Exit 0 = all pass.
"""
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.join(HERE, "..", "agent-msg.sh")
DEAD_PORT = "59999"
WARN = "FIGYELEM: a torzs"


def make_tree():
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "scripts"))
    os.makedirs(os.path.join(d, "store"))
    shutil.copy(REAL, os.path.join(d, "scripts", "agent-msg.sh"))
    with open(os.path.join(d, "store", ".dashboard-token"), "w") as fh:
        fh.write("test-token\n")
    c = sqlite3.connect(os.path.join(d, "store", "claudeclaw.db"))
    c.execute("create table agent_messages (id integer primary key, from_agent text,"
              " to_agent text, content text, status text, created_at integer)")
    c.commit()
    c.close()
    return d


class LengthWarning(unittest.TestCase):
    def setUp(self):
        self.tree = make_tree()

    def tearDown(self):
        shutil.rmtree(self.tree, ignore_errors=True)

    def send(self, body, env=None):
        e = dict(os.environ, MARVEEN_WEB_PORT=DEAD_PORT)
        e.update(env or {})
        p = subprocess.run(["bash", os.path.join(self.tree, "scripts", "agent-msg.sh"),
                            "friday", "marveen", "-"], input=body,
                           capture_output=True, text=True, timeout=60, env=e)
        return p.returncode, p.stderr

    def test_801_characters_warn_and_name_the_number(self):
        rc, err = self.send("x" * 801)
        self.assertIn(WARN + " 801 karakter (a korlat 800)", err)

    def test_CONTROL_800_is_the_limit_itself_and_stays_silent(self):
        rc, err = self.send("x" * 800)
        self.assertNotIn(WARN, err)

    def test_characters_not_bytes(self):
        # 700 accented characters are 1400 bytes; `wc -c` would have warned
        body = "é" * 700
        self.assertGreater(len(body.encode("utf-8")), 800)
        rc, err = self.send(body)
        self.assertNotIn(WARN, err)

    def test_the_footer_the_tool_appends_is_not_counted(self):
        # the footer adds ~70 characters; a 790-character body must stay silent
        rc, err = self.send("y" * 790)
        self.assertNotIn(WARN, err)

    def test_it_is_a_warning_not_a_gate(self):
        # both reach the send and fail the same way on the dead port -- the warning changes nothing
        rc_long, _ = self.send("z" * 2000)
        rc_short, _ = self.send("z" * 10)
        self.assertEqual(rc_long, rc_short)

    def test_the_limit_is_overridable_for_measurement(self):
        rc, err = self.send("x" * 101, env={"AGENT_MSG_SOFT_LIMIT": "100"})
        self.assertIn(WARN + " 101 karakter (a korlat 100)", err)


if __name__ == "__main__":
    unittest.main(verbosity=1)

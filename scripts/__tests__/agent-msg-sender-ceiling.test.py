#!/usr/bin/env python3
"""Contract tests for the SENDER-side delivery ceiling in agent-msg.sh. Card cc1d957f.

WHAT IT IS AND WHAT IT IS NOT. The existing gate watches the RECIPIENT's backlog
(pending >= 3). This one watches the SENDER's own rate to ONE recipient in one hour,
which nothing did before -- the page has carried "there is no gate on the sender's own
count" as a stated gap for weeks.

THE NUMBER IS 7 AND THE CARD ASKED FOR 3. Simulated on the real 24h stream, with the
refusal modelled properly (a refused message never enters the window): N=3 would refuse
52.2% of all traffic. That is a wall, and a permanently-firing gate is indistinguishable
from a disabled one. There is also NO N that separates waste from work, because the
burst-size distribution is FLAT from 1 to 6 -- so the ceiling is justified by DELIVERY
CAPACITY (the recipient cannot take up an 7th letter in an hour), not by any claim about
the message's content. That is marveen's framing and it is what survives the flatness.

ISOLATION IS STRUCTURAL, NOT PROMISED. agent-msg.sh derives BASE from its own location,
so the tests copy it into a throwaway tree with its own store/. MARVEEN_WEB_PORT points
at a dead port so that even a test that gets PAST the gate cannot reach the live
dashboard. Every test asserts against the fake DB, and one test proves the fake is
actually the one being read -- otherwise a green run here would say nothing about the
gate, which is the trap card b786b93b records.
"""
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.join(HERE, "..", "agent-msg.sh")
DEAD_PORT = "59999"          # nothing listens; a POST cannot reach the live dashboard


def make_tree(pairs):
    """A throwaway BASE with its own store/ and a copy of the helper.

    `pairs` is a list of (from, to, age_seconds) rows to seed.
    """
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "scripts"))
    os.makedirs(os.path.join(d, "store"))
    shutil.copy(REAL, os.path.join(d, "scripts", "agent-msg.sh"))
    with open(os.path.join(d, "store", ".dashboard-token"), "w") as fh:
        fh.write("test-token\n")
    db = os.path.join(d, "store", "claudeclaw.db")
    c = sqlite3.connect(db)
    c.execute("create table agent_messages (id integer primary key, from_agent text,"
              " to_agent text, content text, status text, created_at integer)")
    now = int(time.time())
    for f, t, age in pairs:
        c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at)"
                  " values (?,?,?,?,?)", (f, t, "x" * 50, "delivered", now - age))
    c.commit()
    return d


def run(tree, frm="friday", to="marveen", extra=None, env=None):
    e = dict(os.environ, MARVEEN_WEB_PORT=DEAD_PORT)
    e.update(env or {})
    p = subprocess.run(["bash", os.path.join(tree, "scripts", "agent-msg.sh"),
                        frm, to, "proba-uzenet"] + (extra or []),
                       capture_output=True, text=True, timeout=60, env=e)
    return p.returncode, p.stdout, p.stderr


class SenderCeiling(unittest.TestCase):

    def tearDown(self):
        for d in getattr(self, "_trees", []):
            shutil.rmtree(d, ignore_errors=True)

    def tree(self, pairs):
        d = make_tree(pairs)
        self._trees = getattr(self, "_trees", []) + [d]
        return d

    # --- the fixture itself, before anything relies on it ------------------

    def test_the_fake_tree_is_the_one_being_read(self):
        """Without this, a green suite says nothing: if the helper read the LIVE database
        every assertion below would be about the wrong numbers."""
        d = self.tree([("friday", "marveen", 60)] * 7)
        rc, _, err = run(d)
        self.assertEqual(rc, 2)
        self.assertIn("mar 7 uzenetet kuldtem", err,
                      "the count must come from the seeded tree, not from anywhere else")
        empty = self.tree([])
        rc2, _, err2 = run(empty)
        self.assertNotIn("KEZBESITESI PLAFON", err2,
                         "an empty tree must not trip the ceiling -- the meter discriminates")

    # --- the boundary ------------------------------------------------------

    def test_six_in_the_hour_passes_the_ceiling(self):
        d = self.tree([("friday", "marveen", 100 + i) for i in range(6)])
        rc, _, err = run(d)
        self.assertNotIn("KEZBESITESI PLAFON", err, "the 7th is the first one refused")

    def test_the_seventh_is_refused(self):
        d = self.tree([("friday", "marveen", 100 + i) for i in range(7)])
        rc, _, err = run(d)
        self.assertEqual(rc, 2)
        self.assertIn("KEZBESITESI PLAFON", err)

    def test_the_window_is_one_hour_not_three(self):
        """Seven messages, but older than an hour: the ceiling must not fire. The
        neighbouring numbers in this helper use a 3-hour window, so a copy-paste of the
        wrong `since` is the likely mistake."""
        d = self.tree([("friday", "marveen", 3700 + i) for i in range(7)])
        rc, _, err = run(d)
        self.assertNotIn("KEZBESITESI PLAFON", err)

    def test_it_is_per_recipient(self):
        """Seven messages spread over three recipients must not block a fourth one."""
        d = self.tree([("friday", "didi", 100), ("friday", "didi", 101),
                       ("friday", "dexter", 102), ("friday", "dexter", 103),
                       ("friday", "mandark", 104), ("friday", "mandark", 105),
                       ("friday", "mandark", 106)])
        rc, _, err = run(d, to="marveen")
        self.assertNotIn("KEZBESITESI PLAFON", err)

    def test_it_is_per_sender(self):
        """Somebody else's seven must not block mine."""
        d = self.tree([("dexter", "marveen", 100 + i) for i in range(7)])
        rc, _, err = run(d)
        self.assertNotIn("KEZBESITESI PLAFON", err)

    # --- what the refusal has to say ---------------------------------------

    def test_the_refusal_names_the_card_path_and_refuses_to_claim_the_quota(self):
        """marveen's explicit requirement: whoever reads this must not take it as the
        answer to the quota question. Pinned because that sentence is exactly what a later
        edit trims as 'noise'."""
        d = self.tree([("friday", "marveen", 100 + i) for i in range(7)])
        _, _, err = run(d)
        self.assertIn("kartyara kommentkent", err)
        self.assertIn("NEM OLD MEG: a KERETET", err)
        # A MERT szam, nem becsles: 49/842 = 5,8%. Eloszor ~12%-ot irtam ide a
        # burst-eloszlas kumulativjabol extrapolalva, es ez a sor fogta meg, amikor
        # a szoveget a rendes szimulaciora javitottam.
        self.assertIn("5,8%", err)
        self.assertIn("49 uzenetet fog meg 842-bol", err)
        self.assertIn("nem minosites", err,
                      "it must not read as a judgement about this message")

    def test_force_still_gets_through(self):
        d = self.tree([("friday", "marveen", 100 + i) for i in range(7)])
        rc, _, err = run(d, extra=["--force"])
        self.assertNotIn("KEZBESITESI PLAFON", err)
        # It then fails on the dead port, which is the POINT: the gate was bypassed and the
        # send was attempted. A refusal and a network failure are different exits.
        self.assertNotEqual(rc, 2)

    def test_the_recipient_gate_still_wins_when_both_apply(self):
        """The recipient's backlog is the stronger statement -- they have not read the last
        three. Both branches firing on one send would print two reasons for one refusal."""
        rows = [("friday", "marveen", 100 + i) for i in range(7)]
        d = self.tree(rows)
        c = sqlite3.connect(os.path.join(d, "store", "claudeclaw.db"))
        for i in range(3):
            c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at)"
                      " values (?,?,?,?,?)", ("didi", "marveen", "x", "pending", int(time.time())))
        c.commit()
        rc, _, err = run(d)
        self.assertEqual(rc, 2)
        self.assertIn("soraban mar", err)
        self.assertNotIn("KEZBESITESI PLAFON", err)

    def test_the_threshold_is_overridable_for_measurement(self):
        d = self.tree([("friday", "marveen", 100 + i) for i in range(3)])
        rc, _, err = run(d, env={"SENDER_HOUR_CEILING": "3"})
        self.assertEqual(rc, 2)
        self.assertIn("plafon: 3", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)

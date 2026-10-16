#!/usr/bin/env python3
"""Contract tests for the STALL-vs-CONGESTION split of the recipient gate in agent-msg.sh.
Card 4f2b2d8e.

THE GATE (`pending >= 3` -> "NEM KULDTEM") treats every backlog as congestion. A stalled
recipient -- the router has not been able to deliver for hours -- looks identical in the count,
and refusing there blocks the one thing that would put a letter in the queue when the stall ends.
The split is measured, not guessed: oldest pending >= 120 min AND nothing delivered to the
recipient for >= 60 min (thresholds and the simulation on 26144 real rows are in the comment
block next to STALL_AGE_MIN in agent-msg.sh).

ISOLATION IS STRUCTURAL: agent-msg.sh derives BASE from its own location, so every test copies
it into a throwaway tree with its own store/. Sends go to a local stub server that answers
{"id": 4242}, so "it sent" is asserted as `OK id=4242`, not inferred from a missing refusal.
"""
import http.server
import os
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.join(HERE, "..", "agent-msg.sh")
MIN = 60


class Stub(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        body = b'{"id": 4242}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def make_tree(rows, with_delivered_at=True, with_wake=False):
    """A throwaway BASE. `rows`: (from, to, status, created_age_min, delivered_age_min|None[, wake]).
    `with_wake` adds the wake column (card a85a9acd); a row without a 6th field wakes (1)."""
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "scripts"))
    os.makedirs(os.path.join(d, "store"))
    shutil.copy(REAL, os.path.join(d, "scripts", "agent-msg.sh"))
    with open(os.path.join(d, "store", ".dashboard-token"), "w") as fh:
        fh.write("test-token\n")
    c = sqlite3.connect(os.path.join(d, "store", "claudeclaw.db"))
    cols = "id integer primary key, from_agent text, to_agent text, content text, status text, created_at integer"
    if with_delivered_at:
        cols += ", delivered_at integer"
    if with_wake:
        cols += ", wake integer not null default 1"
    c.execute("create table agent_messages (%s)" % cols)
    now = int(time.time())
    for row in rows:
        f, t, st, age, dage = row[:5]
        wake = row[5] if len(row) > 5 else 1
        if with_wake:
            c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at,delivered_at,wake)"
                      " values (?,?,?,?,?,?,?)",
                      (f, t, "x" * 50, st, now - age * MIN, None if dage is None else now - dage * MIN, wake))
        elif with_delivered_at:
            c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at,delivered_at)"
                      " values (?,?,?,?,?,?)",
                      (f, t, "x" * 50, st, now - age * MIN, None if dage is None else now - dage * MIN))
        else:
            c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at)"
                      " values (?,?,?,?,?)", (f, t, "x" * 50, st, now - age * MIN))
    c.commit()
    return d


def pending3(oldest_min, delivered_min_ago, to="deeper"):
    """Three pending rows (the oldest `oldest_min` old) and one delivered row that landed
    `delivered_min_ago` ago; the delivered row is older than the pending ones, as it is for a
    recipient that took something and then went quiet."""
    rows = [("marveen", to, "pending", oldest_min, None),
            ("marveen", to, "pending", max(oldest_min - 5, 1), None),
            ("marveen", to, "pending", max(oldest_min - 10, 1), None)]
    if delivered_min_ago is not None:
        rows.append(("marveen", to, "delivered", delivered_min_ago + 1, delivered_min_ago))
    return rows


class StallGate(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        cls.port = str(cls.srv.server_address[1])
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def tearDown(self):
        for d in getattr(self, "_trees", []):
            shutil.rmtree(d, ignore_errors=True)

    def run_gate(self, rows, to="deeper", env=None, extra=None, with_delivered_at=True, with_wake=False):
        d = make_tree(rows, with_delivered_at, with_wake)
        self._trees = getattr(self, "_trees", []) + [d]
        e = dict(os.environ, MARVEEN_WEB_PORT=self.port)
        e.update(env or {})
        p = subprocess.run(["bash", os.path.join(d, "scripts", "agent-msg.sh"), "friday", to,
                            "-"] + (extra or []), input="proba-uzenet",
                           capture_output=True, text=True, timeout=60, env=e)
        return p.returncode, p.stdout, p.stderr

    # --- the fixture, before anything relies on it --------------------------

    def test_the_stub_is_the_one_answering(self):
        """A send into an empty tree must come back `OK id=4242`; otherwise 'it sent' below
        would be asserted against nothing."""
        rc, out, _ = self.run_gate([])
        self.assertEqual(rc, 0)
        self.assertIn("OK id=4242", out)

    # --- congestion keeps refusing ------------------------------------------

    def test_congestion_young_backlog_is_refused(self):
        """deeper 2026-09-20 11:41: oldest pending 43 min, last delivery long ago. Not a stall
        by the measured criterion (age < 120): the refusal must stay."""
        rc, out, err = self.run_gate(pending3(43, 2533))
        self.assertEqual(rc, 2)
        self.assertIn("NEM KULDTEM. deeper soraban mar 3", err)
        self.assertNotIn("OK id=", out)
        self.assertNotIn("ALLASBAN", err)

    def test_old_backlog_but_recent_delivery_is_still_congestion(self):
        """deeper 2026-09-20 13:25: oldest 131 min, but something was delivered 36 min ago, so
        the router is alive and busy-gating. The quiet leg must hold the refusal."""
        rc, out, err = self.run_gate(pending3(131, 36))
        self.assertEqual(rc, 2)
        self.assertIn("NEM KULDTEM", err)
        self.assertNotIn("ALLASBAN", err)

    def test_the_boundary_is_inclusive_at_both_thresholds(self):
        rc, out, _ = self.run_gate(pending3(120, 60))
        self.assertEqual(rc, 0, "exactly 120/60 is a stall (>=)")
        rc2, _, err2 = self.run_gate(pending3(119, 60))
        self.assertEqual(rc2, 2, "one minute younger is congestion")
        rc3, _, err3 = self.run_gate(pending3(120, 59))
        self.assertEqual(rc3, 2, "one minute less quiet is congestion")

    # --- a stall sends, loudly ----------------------------------------------

    def test_stall_sends_and_warns(self):
        rc, out, err = self.run_gate(pending3(200, 150))
        self.assertEqual(rc, 0)
        self.assertIn("OK id=4242", out)
        self.assertNotIn("NEM KULDTEM", err)
        self.assertIn("KEZBESITESI ALLASBAN", err)
        self.assertIn("deeper soraban 3 uzenet var", err)
        self.assertIn("legregebbi 200 perce", err)
        self.assertIn("ennyi perce: 150", err)
        self.assertIn("kartyara IS", err)
        self.assertIn("alert-coordinator.sh", err)

    def test_stall_with_no_delivery_ever_is_a_stall(self):
        rc, out, err = self.run_gate(pending3(200, None))
        self.assertEqual(rc, 0)
        self.assertIn("OK id=4242", out)
        self.assertIn("utolso kezbesites neki: soha", err)

    def test_another_recipients_fresh_delivery_does_not_hide_the_stall(self):
        """The last-delivery probe is PER RECIPIENT. In the live fleet somebody always got a
        letter within the hour; if the to_agent filter fell out, the fleet-wide last delivery
        would be fresh and the stall would never fire (trillian, card 4f2b2d8e comment 31671)."""
        rows = pending3(200, 150) + [("marveen", "dexter", "delivered", 2, 1)]
        rc, out, err = self.run_gate(rows)
        self.assertEqual(rc, 0)
        self.assertIn("OK id=4242", out)
        self.assertIn("KEZBESITESI ALLASBAN", err)
        self.assertIn("ennyi perce: 150", err)

    def test_stall_does_not_bypass_the_sender_ceiling(self):
        """The sender-side ceiling (7 per hour to one recipient) is a separate statement and
        must still bind during a stall -- otherwise a stall would be an open door."""
        # Seven of MY letters inside the hour that never delivered (failed): they count for the
        # ceiling but neither as pending nor as a recent delivery, so the stall still holds.
        rows = pending3(200, 150) + [("friday", "deeper", "failed", 5 + i, None) for i in range(7)]
        rc, out, err = self.run_gate(rows)
        self.assertEqual(rc, 2)
        self.assertIn("KEZBESITESI PLAFON", err)
        self.assertNotIn("OK id=", out)

    def test_thresholds_are_overridable_for_measurement(self):
        rc, out, _ = self.run_gate(pending3(43, 2533), env={"STALL_AGE_MIN": "30"})
        self.assertEqual(rc, 0)
        self.assertIn("OK id=4242", out)

    # --- quiet (wake=0) notices do not close the gate (card a85a9acd) --------

    def test_quiet_rows_do_not_count_toward_the_depth_gate(self):
        """Three QUIET notices pending are not a backlog: nothing waits to be delivered on
        their account, so the send goes through."""
        quiet3 = [("system", "deeper", "pending", 30 + i, None, 0) for i in range(3)]
        rc, out, err = self.run_gate(quiet3, with_wake=True)
        self.assertEqual(rc, 0, err)
        self.assertIn("OK id=4242", out)
        self.assertNotIn("NEM KULDTEM", err)

    def test_positive_control_the_same_rows_waking_are_refused(self):
        """Same three rows with wake=1: the gate must still refuse, or the test above proves
        nothing about the filter."""
        waking3 = [("system", "deeper", "pending", 30 + i, None, 1) for i in range(3)]
        rc, out, err = self.run_gate(waking3, with_wake=True)
        self.assertEqual(rc, 2)
        self.assertIn("NEM KULDTEM. deeper soraban mar 3", err)

    def test_a_quiet_row_does_not_age_into_a_stall_warning(self):
        """Two waking rows (young) plus one day-old QUIET row: the oldest pending that the
        stall sign reads is the waking one, so no stall warning and the depth is 2."""
        rows = [("marveen", "deeper", "pending", 5, None, 1),
                ("marveen", "deeper", "pending", 4, None, 1),
                ("system", "deeper", "pending", 1400, None, 0)]
        rc, out, err = self.run_gate(rows, with_wake=True)
        self.assertEqual(rc, 0, err)
        self.assertNotIn("ALLASBAN", err)
        self.assertIn("deeper: 2 var", err.replace("[sor] ", ""))

    def test_a_quiet_row_cannot_turn_congestion_into_a_stall(self):
        """Three young WAKING rows are congestion (refused). A day-old QUIET row beside them must
        not become 'the oldest pending' and flip the refusal into a stall send."""
        rows = [("marveen", "deeper", "pending", 5, None, 1),
                ("marveen", "deeper", "pending", 4, None, 1),
                ("marveen", "deeper", "pending", 3, None, 1),
                ("system", "deeper", "pending", 1400, None, 0)]
        rc, out, err = self.run_gate(rows, with_wake=True)
        self.assertEqual(rc, 2)
        self.assertIn("NEM KULDTEM. deeper soraban mar 3", err)
        self.assertNotIn("ALLASBAN", err)

    # --- failing closed on a measurement problem ----------------------------

    def test_unreadable_delivered_at_keeps_the_old_refusal(self):
        """No delivered_at column: the stall probe cannot run. It must NOT turn into 'stall';
        the legacy refusal stands, and the queue depth (read before) must survive."""
        rc, out, err = self.run_gate(pending3(200, None)[:3], with_delivered_at=False)
        self.assertEqual(rc, 2)
        self.assertIn("NEM KULDTEM. deeper soraban mar 3", err)

    def test_failed_rows_are_not_counted_as_pending(self):
        rows = [("marveen", "deeper", "failed", 300, None)] * 3
        rc, out, err = self.run_gate(rows)
        self.assertEqual(rc, 0)
        self.assertNotIn("ALLASBAN", err)

    def test_force_skips_everything(self):
        rc, out, err = self.run_gate(pending3(43, 2533), extra=["--force"])
        self.assertEqual(rc, 0)
        self.assertNotIn("ALLASBAN", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)

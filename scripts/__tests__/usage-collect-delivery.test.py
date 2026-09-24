#!/usr/bin/env python3
"""Delivery of the OVERUSE forecast and the held-task list to the coordinator (card 1fe8e8c5).

Run: python3 scripts/__tests__/usage-collect-delivery.test.py   Exit 0 = all pass.
Nothing here touches the network or the live store: `deliver` is exercised with urlopen
patched, and every file path is a temp one.
"""
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("usage_collect", os.path.join(HERE, "..", "usage-collect.py"))
uc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(uc)

T0 = 1_790_000_000.0
H = 3600
OVER = "ALERT: OVERUSE: weekly limit 45% used at 15% elapsed (pace 3.0x). At this pace it will run out around X."
OVER_HIGH = "ALERT: OVERUSE: weekly limit 95% used at 60% elapsed (pace 1.6x). At this pace it will run out around Y."
NEAR = "ALERT: weekly limit nearly exhausted: 93% used."
UNDER = "ALERT: UNDERUSE: Fable weekly only 3% at 60% elapsed (pace 0.1x) -- plenty of unused quota."
HELD = [{"name": "flotta-feloldas", "agent": "marveen", "since_ms": (T0 - 170 * H) * 1000}]


class PlanDelivery(unittest.TestCase):
    def test_an_overuse_episode_is_said_once_then_at_most_every_12h(self):
        text, st = uc.plan_delivery([OVER], [], {}, T0)
        self.assertIn("OVERUSE forecast (new episode): weekly limit 45% used", text)
        # the alert itself refires every 45 min while the episode lasts -- feed it at that cadence
        sent = []
        t = T0
        while t < T0 + 12 * H + 45 * 60:
            t += 45 * 60
            text, st = uc.plan_delivery([OVER], [], st, t)
            if text:
                sent.append((t - T0, text))
        self.assertEqual(len(sent), 1, sent)
        self.assertGreaterEqual(sent[0][0], 12 * H)
        self.assertIn("(still on)", sent[0][1])

    def test_a_gap_of_3h_starts_a_new_episode(self):
        _, st = uc.plan_delivery([OVER], [], {}, T0)
        text, _ = uc.plan_delivery([OVER], [], st, T0 + 3 * H)
        self.assertIn("(new episode)", text)

    def test_CONTROL_just_under_the_gap_is_the_same_episode(self):
        _, st = uc.plan_delivery([OVER], [], {}, T0)
        text, _ = uc.plan_delivery([OVER], [], st, T0 + 3 * H - 1)
        self.assertIsNone(text)

    def test_past_the_backstop_the_forecast_is_not_delivered(self):
        text, _ = uc.plan_delivery([OVER_HIGH], [], {}, T0)
        self.assertIsNone(text)

    def test_near_exhaustion_and_underuse_are_not_delivered(self):
        text, _ = uc.plan_delivery([NEAR, UNDER], [], {}, T0)
        self.assertIsNone(text)

    def test_a_newly_held_task_is_announced_once(self):
        text, st = uc.plan_delivery([], HELD, {}, T0)
        self.assertIn("HELD by the quota gate", text)
        self.assertIn("flotta-feloldas (marveen)", text)
        self.assertIn("170 h", text)
        again, st = uc.plan_delivery([], HELD, st, T0 + H)
        self.assertIsNone(again)

    def test_a_task_held_AGAIN_after_release_is_announced_again(self):
        _, st = uc.plan_delivery([], HELD, {}, T0)
        _, st = uc.plan_delivery([], [], st, T0 + H)
        text, _ = uc.plan_delivery([], HELD, st, T0 + 2 * H)
        self.assertIn("flotta-feloldas", text)

    def test_an_unreadable_board_is_said_and_does_not_forget(self):
        _, st = uc.plan_delivery([], HELD, {}, T0)
        text, st2 = uc.plan_delivery([], [], st, T0 + H, held_error="database is locked")
        self.assertIn("HELD TASKS NOT MEASURED this tick: database is locked", text)
        self.assertEqual(st2["held_sent"], ["flotta-feloldas"],
                         "not measuring is not 'nothing held' -- or the next reading re-announces")


class RunDelivery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.tmp.name, "state.json")
        self.p = [mock.patch.object(uc, "DELIVERY_STATE_PATH", self.state),
                  mock.patch.object(uc, "held_tasks", return_value=[])]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in self.p:
            p.stop()
        self.tmp.cleanup()

    def test_a_failed_send_does_not_advance_the_state(self):
        uc.run_delivery([OVER], now_ts=T0, deliver_fn=lambda t: (False, "HTTP 401"))
        self.assertFalse(os.path.exists(self.state))
        sent = []
        uc.run_delivery([OVER], now_ts=T0 + 600, deliver_fn=lambda t: (sent.append(t) or True, "id=1"))
        self.assertEqual(len(sent), 1, "the retry must carry the message the failure dropped")

    def test_a_verified_send_advances_it(self):
        uc.run_delivery([OVER], now_ts=T0, deliver_fn=lambda t: (True, "id=1"))
        with open(self.state) as fh:
            self.assertIn("weekly limit", json.load(fh)["over"])


class Deliver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tok = os.path.join(self.tmp.name, "tok")
        with open(self.tok, "w") as fh:
            fh.write("t")

    def tearDown(self):
        self.tmp.cleanup()

    def _resp(self, status, body):
        r = mock.MagicMock()
        r.status = status
        r.read.return_value = body.encode()
        r.__enter__.return_value = r
        return r

    def test_only_a_2xx_WITH_an_id_is_a_delivery(self):
        with mock.patch.object(uc.urllib.request, "urlopen", return_value=self._resp(200, '{"id": 42}')):
            self.assertEqual(uc.deliver("x", token_path=self.tok), (True, "id=42"))
        with mock.patch.object(uc.urllib.request, "urlopen", return_value=self._resp(200, "{}")):
            self.assertFalse(uc.deliver("x", token_path=self.tok)[0])
        err = urllib.error.HTTPError("u", 401, "no", {}, None)
        with mock.patch.object(uc.urllib.request, "urlopen", side_effect=err):
            self.assertEqual(uc.deliver("x", token_path=self.tok), (False, "HTTP 401"))

    def test_a_missing_token_is_a_failure_not_a_send(self):
        ok, why = uc.deliver("x", token_path=os.path.join(self.tmp.name, "nope"))
        self.assertFalse(ok)
        self.assertIn("token unreadable", why)


class HeldTasks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "db.sqlite")
        self.tasks = os.path.join(self.tmp.name, "tasks")
        c = sqlite3.connect(self.db)
        c.execute("CREATE TABLE task_runs (id INTEGER PRIMARY KEY, name TEXT, agent TEXT, ts INTEGER, status TEXT, reason TEXT)")
        c.commit()
        c.close()

    def tearDown(self):
        self.tmp.cleanup()

    def task(self, name, enabled=True):
        d = os.path.join(self.tasks, name)
        os.makedirs(d)
        with open(os.path.join(d, "task-config.json"), "w") as fh:
            json.dump({"enabled": enabled, "agent": "a1"}, fh)

    def runs(self, name, rows):
        c = sqlite3.connect(self.db)
        c.executemany("INSERT INTO task_runs (name, agent, ts, status, reason) VALUES (?, 'a1', ?, ?, ?)",
                      [(name, int(ts * 1000), st, rs) for ts, st, rs in rows])
        c.commit()
        c.close()

    def held(self):
        return [h["name"] for h in uc.held_tasks(self.db, self.tasks, now_ms=T0 * 1000)]

    def test_the_rule_and_its_four_controls(self):
        self.task("held")
        self.runs("held", [(T0 - 20 * H, "fired", None), (T0 - 8 * H, "skipped", "quota"),
                           (T0 - 4 * H, "skipped", None), (T0 - 1 * H, "skipped", "quota")])
        self.task("short")                       # streak only 2 h old
        self.runs("short", [(T0 - 5 * H, "fired", None), (T0 - 2 * H, "skipped", "quota")])
        self.task("ran")                         # last row fired
        self.runs("ran", [(T0 - 9 * H, "skipped", "quota"), (T0 - 1 * H, "fired", None)])
        self.task("off", enabled=False)          # disabled
        self.runs("off", [(T0 - 30 * H, "skipped", "quota")])
        self.task("late")                        # fired_late breaks the streak too
        self.runs("late", [(T0 - 30 * H, "skipped", "quota"), (T0 - 3 * H, "fired_late", None),
                           (T0 - 1 * H, "skipped", "quota")])
        self.assertEqual(self.held(), ["held"])

    def test_an_unreadable_database_raises_instead_of_reporting_none(self):
        self.task("x")
        with self.assertRaises(Exception):
            uc.held_tasks(os.path.join(self.tmp.name, "missing.sqlite"), self.tasks, now_ms=T0 * 1000)


class NoDeliveryWithoutTheFlag(unittest.TestCase):
    def test_a_default_run_never_delivers(self):
        with mock.patch.object(uc, "build_snapshot", return_value={"claude": {}, "codex": {}}), \
             mock.patch.object(uc, "render_summary", return_value=""), \
             mock.patch.object(uc, "_load_state", return_value={}), \
             mock.patch.object(uc, "_save_state"), \
             mock.patch.object(uc, "compute_alerts", return_value=[OVER]), \
             mock.patch.object(uc, "run_delivery") as rd, \
             mock.patch.object(uc, "HISTORY_PATH", os.devnull), \
             mock.patch.object(uc, "LATEST_PATH", os.path.join(tempfile.mkdtemp(), "l.json")), \
             mock.patch.object(sys, "argv", ["usage-collect.py"]):
            uc._run()
        rd.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=1)

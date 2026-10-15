#!/usr/bin/env python3
"""The Claude numbers must be the FLEET plan's, not the host login's (card 9d4f3ac7).

WHY THIS EXISTS. scripts/usage-collect.py reads the usage through the HOST keychain token, i.e. the
host login's plan ("elso"). The fleet runs on another plan ("masodik": store/claude-plans-state.json
`activePlanByAgent`), so every consumer of store/usage-latest.json (quota gate, the Fable strip, the
napindito KERET line, /usage, the rotation heartbeat, the data-source alarm) was reading the wrong
account's numbers while saying `authoritative`. The collector now builds the `claude` section from
the fleet plan's probe when the two plans differ.

WHAT THE CASES PIN (each one is a way this goes wrong silently):
  - a different plan's snapshot is NEVER reused by the 90-minute cache, and the host numbers are
    NEVER a fallback for the fleet plan (a failed probe is `probe-failed` / ok false, no windows);
  - a probe is a reading only when `lastProbe.at == observedAt` (and ok, or rate_limited): a
    failed probe leaves the PREVIOUS numbers behind with a newer `lastProbe`;
  - `seven_day_opus` is not copied from the host (the probe has no Fable window);
  - history lines and the pace-alert state carry the plan, so two accounts never mix in one series.

Run: python3 scripts/__tests__/usage-collect-fleet-plan.test.py   Exit 0 = all pass.
Nothing here touches the network, the keychain, the claude CLI or the live store: the host reading
is patched, the probe command is a stub script, every path is a temp one.
"""
import contextlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SCRIPTS, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


uc = _load("usage_collect", "usage-collect.py")
ns = _load("napindito_sections", "napindito-sections.py")

HOST_OPUS = 44.0
HOST_WINDOWS = {
    "five_hour": {"used_percent": 11.0, "resets_at": 0},      # resets_at filled per test
    "seven_day": {"used_percent": 22.0, "resets_at": 0},
    "seven_day_opus": {"used_percent": HOST_OPUS, "resets_at": 0},
}

# The probe stub: records the call, then (unless told to fail) writes the state it is configured with.
STUB = '''#!/usr/bin/env python3
import os, sys, time
with open(os.environ["STUB_CALLS"], "a") as f:
    f.write(sys.argv[1] + "\\n")
mode = os.environ.get("STUB_MODE", "write")
if mode == "sleep":
    time.sleep(5)
if mode == "fail":
    sys.exit(1)
if mode == "write":
    import shutil
    shutil.copy(os.environ["STUB_PAYLOAD"], os.environ["STUB_STATE_OUT"])
'''


def _now_ms():
    return int(time.time() * 1000)


def _plan_entry(observed_ms, at=None, ok=True, error=None, source="probe", with_last=True, windows=None):
    reset = int(time.time()) + 3 * 3600
    e = {
        "observedAt": observed_ms,
        "source": source,
        "windows": windows if windows is not None else {
            "five_hour": {"usedPercent": 61.5, "resetsAt": reset, "status": "allowed"},
            "seven_day": {"usedPercent": 77.25, "resetsAt": reset + 4 * 86400, "status": "allowed"},
        },
        "overallStatus": "allowed",
    }
    if with_last:
        lp = {"at": observed_ms if at is None else at, "ok": ok}
        if error:
            lp["error"] = error
        e["lastProbe"] = lp
    return e


def _state(entry, active="masodik", agent="marveen", other=None):
    plans = {active: entry}
    if other:
        plans.update(other)
    return {"activePlanByAgent": {agent: active}, "plans": plans}


class Env(unittest.TestCase):
    """A temp store, every module path pointed at it, the host reading stubbed."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="uc-fleet-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        j = lambda n: os.path.join(self.tmp, n)
        self.paths = {
            "STORE_DIR": self.tmp,
            "LATEST_PATH": j("usage-latest.json"),
            "HISTORY_PATH": j("usage-history.jsonl"),
            "STATE_PATH": j("usage-alert-state.json"),
            "PLANS_STATE_PATH": j("claude-plans-state.json"),
        }
        self.calls = j("probe-calls.log")
        self.stub = j("stub.py")
        with open(self.stub, "w") as f:
            f.write(STUB)
        self.payload = j("payload.json")
        self.env = {
            "USAGE_COLLECT_PROBE_CMD": f"{sys.executable} {self.stub}",
            "STUB_CALLS": self.calls,
            "STUB_PAYLOAD": self.payload,
            "STUB_STATE_OUT": self.paths["PLANS_STATE_PATH"],
            "STUB_MODE": "write",
            "MAIN_AGENT_ID": "marveen",
            "USAGE_COLLECT_HOST_PLAN": "elso",
        }
        # _run() sets the run deadline module-wide; restore it so one test's budget never reaches the next
        for k, v in {**self.paths, "_run_deadline": None}.items():
            p = mock.patch.object(uc, k, v)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.dict(os.environ, self.env)
        p.start()
        self.addCleanup(p.stop)
        reset = time.time() + 2 * 3600
        self.host_windows = {k: dict(v, resets_at=reset) for k, v in HOST_WINDOWS.items()}
        for name, ret in (
            ("_collect_claude_authoritative", (self.host_windows, None, None)),
            ("_read_claude_token", ("fake-token", "test")),
            ("_claude_cli_version", "1.2.3"),
        ):
            p = mock.patch.object(uc, name, return_value=ret)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(uc, "collect_codex", return_value={"provider": "codex", "ok": False, "error": "stub"})
        p.start()
        self.addCleanup(p.stop)

    def env_patch(self, key, value):
        p = mock.patch.dict(os.environ, {key: value})
        p.start()
        self.addCleanup(p.stop)

    def write_state(self, state):
        with open(self.paths["PLANS_STATE_PATH"], "w") as f:
            json.dump(state, f)

    def set_payload(self, state):
        with open(self.payload, "w") as f:
            json.dump(state, f)

    def probe_calls(self):
        try:
            with open(self.calls) as f:
                return [l.strip() for l in f if l.strip()]
        except OSError:
            return []

    def run_main(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["usage-collect.py", *argv]), contextlib.redirect_stdout(out):
            uc._run()
        return out.getvalue()

    def read_json(self, name):
        with open(os.path.join(self.tmp, name)) as f:
            return json.load(f)


class SamePlanOrNoState(Env):
    """(a) behaviour exactly as before, plus a `plan` field."""

    def test_no_state_file_is_the_host_reading_with_plan(self):
        c = uc.collect_claude()
        self.assertEqual(c["source"], "authoritative")
        self.assertEqual(c["plan"], "elso")
        self.assertEqual(c["windows"]["seven_day_opus"]["used_percent"], HOST_OPUS)
        self.assertEqual(self.probe_calls(), [])

    def test_fleet_on_the_host_plan_is_the_host_reading(self):
        self.write_state(_state(_plan_entry(_now_ms()), active="elso"))
        host_out = {}
        c = uc.collect_claude(host_out)
        self.assertEqual((c["source"], c["plan"]), ("authoritative", "elso"))
        self.assertEqual(c["windows"]["seven_day"]["used_percent"], 22.0)
        self.assertEqual(self.probe_calls(), [], "the probe is for a plan the keychain cannot read")
        self.assertEqual(host_out, {}, "no separate host snapshot when it IS the fleet snapshot")

    def test_a_state_without_the_main_agent_falls_back_to_the_host_plan(self):
        self.write_state(_state(_plan_entry(_now_ms()), active="masodik", agent="someone-else"))
        self.assertEqual(uc.collect_claude()["plan"], "elso")

    def test_unreadable_state_file_is_no_state(self):
        with open(self.paths["PLANS_STATE_PATH"], "w") as f:
            f.write("{not json")
        self.assertEqual(uc.collect_claude()["plan"], "elso")

    def test_a_bad_plan_id_in_the_state_is_ignored(self):
        self.write_state(_state(_plan_entry(_now_ms()), active="../evil"))
        self.assertEqual(uc.collect_claude()["plan"], "elso")


class FleetPlanFromProbe(Env):
    def test_b_fresh_valid_probe_becomes_the_claude_section(self):
        observed = _now_ms() - 3 * 60_000
        self.write_state(_state(_plan_entry(observed), other={"elso": _plan_entry(observed)}))
        host_out = {}
        c = uc.collect_claude(host_out)
        self.assertEqual(self.probe_calls(), [], "a 3-minute-old valid probe must not be re-run")
        self.assertEqual((c["source"], c["ok"], c["plan"]), ("authoritative", True, "masodik"))
        # the SAME shape the keychain path writes: used_percent + resets_at (epoch seconds)
        self.assertEqual(c["windows"]["five_hour"]["used_percent"], 61.5)
        self.assertEqual(c["windows"]["seven_day"]["used_percent"], 77.25)
        self.assertIsInstance(c["windows"]["seven_day"]["resets_at"], int)
        self.assertTrue({"used_percent", "resets_at"} <= set(c["windows"]["five_hour"]))
        self.assertEqual(
            datetime.fromisoformat(c["authoritative_at"]),
            datetime.fromtimestamp(observed / 1000.0, timezone.utc),
            "authoritative_at is the PROBE's time, not now",
        )
        # nothing of the host's numbers leaked in
        self.assertNotIn(11.0, [w["used_percent"] for w in c["windows"].values()])
        # the host reading is handed back separately
        self.assertEqual(host_out["claude"]["plan"], "elso")
        self.assertEqual(host_out["claude"]["windows"]["seven_day"]["used_percent"], 22.0)

    def test_b_end_to_end_files(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        self.run_main()
        latest = self.read_json("usage-latest.json")
        self.assertEqual(latest["claude"]["plan"], "masodik")
        self.assertEqual(latest["claude"]["windows"]["seven_day"]["used_percent"], 77.25)
        host = self.read_json("usage-latest-elso.json")
        self.assertEqual(host["claude"]["plan"], "elso")
        self.assertEqual(host["claude"]["windows"]["seven_day"]["used_percent"], 22.0)
        self.assertEqual(host["plan"], "elso")

    def test_c_stale_probe_is_refreshed_once_then_used(self):
        old = _now_ms() - 20 * 60_000
        self.write_state(_state(_plan_entry(old)))
        fresh_ms = _now_ms()
        fresh = _plan_entry(fresh_ms, windows={
            "five_hour": {"usedPercent": 5.0, "resetsAt": int(time.time()) + 3600},
            "seven_day": {"usedPercent": 6.0, "resetsAt": int(time.time()) + 86400},
        })
        self.set_payload(_state(fresh))
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"], "exactly one probe run, with the fleet plan id")
        self.assertEqual((c["source"], c["plan"]), ("authoritative", "masodik"))
        self.assertEqual(c["windows"]["seven_day"]["used_percent"], 6.0)

    def test_c_no_probe_recorded_at_all_runs_the_probe(self):
        self.write_state({"activePlanByAgent": {"marveen": "masodik"}, "plans": {}})
        self.set_payload(_state(_plan_entry(_now_ms())))
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual(c["source"], "authoritative")

    def test_d_probe_command_failure_is_not_authoritative_and_has_no_host_numbers(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.env_patch("STUB_MODE", "fail")
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual((c["source"], c["ok"], c["plan"]), ("probe-failed", False, "masodik"))
        self.assertNotIn("windows", c)
        self.assertIn("exited 1", c["error"])
        self.assertEqual(c["error"], c["auth_error"], "the data-source alarm prints auth_error")
        dumped = json.dumps(c)
        for host_number in ("22.0", "44.0", "11.0"):
            self.assertNotIn(host_number, dumped)

    def test_d_probe_command_timeout_is_probe_failed(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.env_patch("STUB_MODE", "sleep")
        with mock.patch.object(uc, "PROBE_TIMEOUT_SEC", 0.5):
            t0 = time.time()
            c = uc.collect_claude()
        self.assertLess(time.time() - t0, 4, "the timeout must cut the 5 s sleep short")
        self.assertEqual((c["source"], c["ok"]), ("probe-failed", False))
        self.assertIn("timed out", c["error"])

    def test_d_probe_timeout_is_capped_by_the_run_budget(self):
        # PROBE_TIMEOUT_SEC stays 30: only the time left of the run can cut the 5 s sleep short
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.env_patch("STUB_MODE", "sleep")
        with mock.patch.object(uc, "PROBE_MIN_SEC", 0.1), \
                mock.patch.object(uc, "_run_deadline", time.monotonic() + 0.8):
            t0 = time.time()
            c = uc.collect_claude()
        self.assertLess(time.time() - t0, 4, "the run budget must cut the probe short")
        self.assertEqual((c["source"], c["ok"]), ("probe-failed", False))
        self.assertIn("timed out after 1s", c["error"])

    def test_d_probe_not_started_when_the_run_budget_is_spent(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        with mock.patch.object(uc, "_run_deadline", time.monotonic() + 2):
            c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), [])
        self.assertEqual((c["source"], c["ok"]), ("probe-failed", False))
        self.assertIn("probe not started", c["error"])

    def test_d_spent_budget_keeps_a_still_valid_reading(self):
        # 10 min old: due for the refresh (8), still valid (12) -> the skipped probe changes nothing
        self.write_state(_state(_plan_entry(_now_ms() - 10 * 60_000)))
        with mock.patch.object(uc, "_run_deadline", time.monotonic() + 2):
            c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), [])
        self.assertEqual((c["source"], c["ok"]), ("authoritative", True))

    def test_d_scheduled_run_sets_the_budget_and_still_writes_the_snapshot(self):
        # control for the wiring: the same run with the default budget probes (stub writes a reading)
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.env_patch("USAGE_COLLECT_RUN_BUDGET_SEC", "3")
        self.run_main()
        self.assertEqual(self.probe_calls(), [], "a 3 s budget leaves no 5 s for the probe")
        latest = self.read_json("usage-latest.json")
        self.assertEqual(latest["claude"]["source"], "probe-failed")
        self.assertIn("run budget", latest["claude"]["error"])

    def test_d_scheduled_run_with_the_default_budget_probes(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.set_payload(_state(_plan_entry(_now_ms())))
        self.run_main()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual(self.read_json("usage-latest.json")["claude"]["source"], "authoritative")

    def test_d_default_run_budget_stays_under_the_task_timeout(self):
        # The scheduler kills the run at the usage-snapshot task's timeoutMs; the budget must end
        # before it with room for the snapshot write. Read the live config when it exists, else the
        # 60 s it carried when the budget was set (2026-10-15).
        path = os.path.expanduser("~/.claude/scheduled-tasks/usage-snapshot/task-config.json")
        timeout_sec = 60.0
        if os.path.exists(path):
            with open(path) as f:
                timeout_sec = json.load(f)["timeoutMs"] / 1000.0
        margin_sec = 10.0
        self.assertLessEqual(uc.RUN_BUDGET_SEC_DEFAULT + margin_sec, timeout_sec)
        self.assertLess(uc.PROBE_MIN_SEC, uc.PROBE_TIMEOUT_SEC)
        self.assertLessEqual(uc.PROBE_TIMEOUT_SEC, uc.RUN_BUDGET_SEC_DEFAULT)

    def test_d_probe_command_missing_is_probe_failed(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.env_patch("USAGE_COLLECT_PROBE_CMD", os.path.join(self.tmp, "nope-does-not-exist"))
        c = uc.collect_claude()
        self.assertEqual((c["source"], c["ok"]), ("probe-failed", False))
        self.assertIn("could not start", c["error"])

    def test_d_a_probe_that_exits_0_but_wrote_nothing_fresh_is_still_failed(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.set_payload(_state(_plan_entry(_now_ms() - 30 * 60_000)))   # "success" that left old data
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual(c["source"], "probe-failed")
        self.assertIn("min old", c["error"])

    def test_d_host_failure_does_not_break_the_fleet_snapshot(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        with mock.patch.object(uc, "_collect_claude_raw", side_effect=RuntimeError("keychain exploded")):
            host_out = {}
            c = uc.collect_claude(host_out)
        self.assertEqual((c["source"], c["plan"]), ("authoritative", "masodik"))
        self.assertEqual(host_out, {})


class ProbeValidity(Env):
    """(e) what counts as a reading."""

    def _read(self, entry):
        self.write_state(_state(entry))
        self.env_patch_fail()
        return uc.collect_claude()

    def env_patch_fail(self):
        p = mock.patch.dict(os.environ, {"STUB_MODE": "fail"})
        p.start()
        self.addCleanup(p.stop)

    def test_e_lastprobe_at_not_equal_observedat_is_invalid(self):
        # a recent observedAt (3 min) whose latest probe is NEWER: it returned no usage, the numbers
        # are the previous ones -- quota-ceiling-guard.sh's rule, shared on purpose
        obs = _now_ms() - 3 * 60_000
        c = self._read(_plan_entry(obs, at=obs + 120_000, ok=False, error="invalid_token"))
        self.assertEqual(c["source"], "probe-failed")
        self.assertEqual(self.probe_calls(), ["masodik"], "an invalid reading triggers the refresh")
        self.assertIn("no usage", c["error"])

    def test_e_lastprobe_missing_is_invalid(self):
        c = self._read(_plan_entry(_now_ms() - 60_000, with_last=False))
        self.assertEqual(c["source"], "probe-failed")

    def test_e_a_non_probe_observation_is_invalid(self):
        # the rotation heartbeat writes the ACTIVE plan with source=authoritative and no lastProbe
        c = self._read(_plan_entry(_now_ms() - 60_000, source="authoritative", with_last=False))
        self.assertEqual(c["source"], "probe-failed")
        self.assertIn("not a probe", c["error"])

    def test_e_a_failed_probe_with_equal_stamps_is_invalid_unless_rate_limited(self):
        obs = _now_ms() - 60_000
        c = self._read(_plan_entry(obs, ok=False, error="network"))
        self.assertEqual(c["source"], "probe-failed")

    def test_e_rate_limited_probe_still_carries_usage_and_is_a_reading(self):
        # an exhausted plan answers 429 WITH the unified headers: "100% until X" must not become "unknown"
        obs = _now_ms() - 60_000
        entry = _plan_entry(obs, ok=False, error="rate_limited", windows={
            "five_hour": {"usedPercent": 100.0, "resetsAt": int(time.time()) + 1800},
            "seven_day": {"usedPercent": 100.0, "resetsAt": int(time.time()) + 86400},
        })
        c = self._read(entry)
        self.assertEqual((c["source"], c["ok"]), ("authoritative", True))
        self.assertEqual(c["windows"]["seven_day"]["used_percent"], 100.0)
        self.assertEqual(self.probe_calls(), [])

    def test_e_an_observation_without_usable_windows_is_invalid(self):
        c = self._read(_plan_entry(_now_ms() - 60_000, windows={"five_hour": {"usedPercent": "x"}}))
        self.assertEqual(c["source"], "probe-failed")
        self.assertIn("no usable window", c["error"])

    def test_e_only_the_valid_windows_are_mapped(self):
        c = self._read(_plan_entry(_now_ms() - 60_000, windows={
            "seven_day": {"usedPercent": 9.0, "resetsAt": int(time.time()) + 86400},
            "five_hour": {"usedPercent": None, "resetsAt": 1},
        }))
        self.assertEqual(list(c["windows"]), ["seven_day"])

    def test_e_the_age_limit_is_configurable_and_the_boundary_is_12_minutes(self):
        # validity only: the refresh-ahead limit is lifted to the validity limit here
        self.env_patch("USAGE_COLLECT_PROBE_REFRESH_MIN", "1000")
        self.write_state(_state(_plan_entry(_now_ms() - 11 * 60_000)))
        self.assertEqual(uc.collect_claude()["source"], "authoritative")
        self.assertEqual(self.probe_calls(), [])
        self.write_state(_state(_plan_entry(_now_ms() - 13 * 60_000)))
        self.set_payload(_state(_plan_entry(_now_ms())))
        uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        with mock.patch.dict(os.environ, {"USAGE_COLLECT_PROBE_MAX_AGE_MIN": "30"}):
            self.write_state(_state(_plan_entry(_now_ms() - 20 * 60_000)))
            uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"], "30 min limit: a 20-min-old probe is fresh")


    def test_e_a_future_dated_probe_is_not_a_reading(self):
        # a clock-skewed observation 5 min in the future must not count as fresh (60 s tolerance)
        self.write_state(_state(_plan_entry(_now_ms() + 5 * 60_000)))
        self.env_patch("STUB_MODE", "fail")
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual((c["source"], c["ok"]), ("probe-failed", False))
        self.assertNotIn("windows", c)

    def test_e_control_a_probe_30_s_in_the_future_is_within_the_tolerance(self):
        self.write_state(_state(_plan_entry(_now_ms() + 30_000)))
        self.assertEqual(uc.collect_claude()["source"], "authoritative")
        self.assertEqual(self.probe_calls(), [])


class RefreshAheadAndReadOnly(Env):
    """The scheduled run refreshes past 8 min; --json never runs the probe (didi 34818)."""

    def test_i_a_9_min_reading_is_refreshed_ahead_and_the_new_one_used(self):
        self.write_state(_state(_plan_entry(_now_ms() - 9 * 60_000)))
        self.set_payload(_state(_plan_entry(_now_ms(), windows={
            "five_hour": {"usedPercent": 5.0, "resetsAt": int(time.time()) + 3600},
            "seven_day": {"usedPercent": 6.0, "resetsAt": int(time.time()) + 86400},
        })))
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual(c["windows"]["seven_day"]["used_percent"], 6.0)

    def test_i_a_refresh_command_that_records_nothing_leaves_the_valid_reading(self):
        self.write_state(_state(_plan_entry(_now_ms() - 9 * 60_000)))
        self.env_patch("STUB_MODE", "fail")
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual((c["source"], c["ok"]), ("authoritative", True))

    def test_i_a_refresh_that_records_a_failure_is_probe_failed(self):
        # the probe stamps a newer, failed lastProbe over the 9-min numbers: no longer a reading
        old = _now_ms() - 9 * 60_000
        self.write_state(_state(_plan_entry(old)))
        self.set_payload(_state(_plan_entry(old, at=_now_ms(), ok=False, error="401")))
        c = uc.collect_claude()
        self.assertEqual(self.probe_calls(), ["masodik"])
        self.assertEqual((c["source"], c["ok"]), ("probe-failed", False))
        self.assertNotIn("windows", c)

    def test_i_a_7_min_reading_is_not_refreshed(self):
        self.write_state(_state(_plan_entry(_now_ms() - 7 * 60_000)))
        self.assertEqual(uc.collect_claude()["source"], "authoritative")
        self.assertEqual(self.probe_calls(), [])

    def test_i_json_never_runs_the_probe_and_reports_the_stale_reading_as_failed(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.set_payload(_state(_plan_entry(_now_ms())))
        d = json.loads(self.run_main("--json"))
        self.assertEqual(self.probe_calls(), [], "--json is read-only: no live probe")
        self.assertEqual((d["claude"]["source"], d["claude"]["ok"]), ("probe-failed", False))
        self.assertIn("read-only", d["claude"]["error"])
        self.assertNotIn("windows", d["claude"])

    def test_i_json_serves_a_valid_reading_without_a_refresh(self):
        self.write_state(_state(_plan_entry(_now_ms() - 10 * 60_000)))
        d = json.loads(self.run_main("--json"))
        self.assertEqual(self.probe_calls(), [])
        self.assertEqual(d["claude"]["source"], "authoritative")

    def test_i_control_the_default_run_does_run_the_probe_on_the_same_state(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.set_payload(_state(_plan_entry(_now_ms())))
        self.run_main()
        self.assertEqual(self.probe_calls(), ["masodik"])

    def test_i_an_exception_in_the_fleet_reading_is_probe_failed_not_host(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        with mock.patch.object(uc, "_collect_claude_fleet", side_effect=RuntimeError("boom")):
            c = uc.collect_claude()
        self.assertEqual((c["source"], c["ok"], c["plan"]), ("probe-failed", False, "masodik"))
        self.assertNotIn("windows", c)
        self.assertIn("RuntimeError", c["error"])
        self.assertEqual(c["error"], c["auth_error"])


class OpusIsNeverCopied(Env):
    def test_f_fleet_snapshot_has_no_opus_window_and_no_host_value(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        c = uc.collect_claude()
        self.assertNotIn("seven_day_opus", c["windows"])
        self.assertNotIn("seven_day_sonnet", c["windows"])
        self.assertEqual(c["seven_day_opus_unavailable"], "probe carries no Fable window")
        self.assertNotIn(str(HOST_OPUS), json.dumps(c))

    def test_f_consumers_tolerate_the_missing_window(self):
        # napindito KERET line: reads usage-latest.json from <root>/store
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        self.run_main()
        text = "\n".join(ns.section_quota(root=self._root()))
        self.assertIn("heti: 77.25%", text)   # the fleet numbers are shown
        self.assertIn("heti opus: NEM MERHETO", text)
        # the host's opus value nowhere as a percentage (a bare "44" would also match a reset at :44)
        self.assertNotIn(f"{HOST_OPUS:g}%", text)
        self.assertNotIn(f"{HOST_OPUS}%", text)

    def _root(self):
        root = os.path.join(self.tmp, "root")
        os.makedirs(os.path.join(root, "store"))
        os.replace(self.paths["LATEST_PATH"], os.path.join(root, "store", "usage-latest.json"))
        return root

    def test_f_probe_failed_is_reported_as_not_measurable_by_napindito(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        os.environ["STUB_MODE"] = "fail"
        self.run_main()
        text = "\n".join(ns.section_quota(root=self._root()))
        self.assertIn("NEM MERHETO", text)
        self.assertNotIn("22", text)
        self.assertNotIn("44", text)


class ReuseNeverCrossesPlans(Env):
    """(g) the 90-minute authoritative cache."""

    def _write(self, name, plan, source="authoritative", minutes_ago=5):
        ts = datetime.fromtimestamp(time.time() - minutes_ago * 60, timezone.utc).isoformat()
        claude = {"source": source, "windows": {"five_hour": {"used_percent": 55.0, "resets_at": time.time() + 7200}}}
        if plan:
            claude["plan"] = plan
        with open(os.path.join(self.tmp, name), "w") as f:
            json.dump({"generated_at": ts, "claude": claude}, f)

    def _make_host_429(self):
        p = mock.patch.object(uc, "_collect_claude_authoritative", return_value=(None, "HTTP 429", "transient"))
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(uc, "_collect_claude_estimate", return_value={"five_hour_est_tokens": 1})
        self.est = p.start()
        self.addCleanup(p.stop)

    def test_g_a_snapshot_of_another_plan_is_not_reused_on_the_host_path(self):
        self._write("usage-latest.json", "masodik")
        self._make_host_429()
        c = uc.collect_claude()
        self.assertEqual(c["source"], "estimate", "a fresh authoritative file of ANOTHER plan must not be served")
        self.assertNotIn("windows", c)

    def test_g_control_a_legacy_snapshot_without_plan_is_the_host_plans_and_is_reused(self):
        self._write("usage-latest.json", None)
        self._make_host_429()
        c = uc.collect_claude()
        self.assertEqual(c["source"], "authoritative_cached")
        self.assertEqual(c["plan"], "elso")

    def test_g_control_same_plan_snapshot_is_reused(self):
        self._write("usage-latest.json", "elso")
        self._make_host_429()
        self.assertEqual(uc.collect_claude()["source"], "authoritative_cached")

    def test_g_fleet_on_another_plan_host_cache_comes_from_the_host_file_only(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        self._write("usage-latest.json", "masodik")          # the fleet's own previous snapshot
        self._make_host_429()
        host_out = {}
        uc.collect_claude(host_out)
        self.assertEqual(host_out["claude"]["source"], "estimate", "the fleet snapshot is not the host's cache")
        self._write("usage-latest-elso.json", "elso")
        host_out = {}
        uc.collect_claude(host_out)
        self.assertEqual(host_out["claude"]["source"], "authoritative_cached")

    def test_g_the_fleet_path_never_serves_a_cache(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        self.env_patch_fail()
        self._write("usage-latest.json", "masodik", minutes_ago=2)   # same plan, fresh, authoritative
        c = uc.collect_claude()
        self.assertEqual(c["source"], "probe-failed")

    def env_patch_fail(self):
        p = mock.patch.dict(os.environ, {"STUB_MODE": "fail"})
        p.start()
        self.addCleanup(p.stop)

    def test_g_direct_plan_filter(self):
        self._write("usage-latest.json", "masodik")
        self.assertEqual(uc._read_cached_claude_authoritative(90, plan="elso"), (None, None, None))
        self.assertIsNotNone(uc._read_cached_claude_authoritative(90, plan="masodik")[0])
        self.assertIsNotNone(uc._read_cached_claude_authoritative(90)[0], "no plan given: unchanged behaviour")


class HistoryAndAlertState(Env):
    def _history(self):
        with open(self.paths["HISTORY_PATH"]) as f:
            return [json.loads(l) for l in f if l.strip()]

    def test_h_history_line_carries_the_fleet_plan(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        self.run_main()
        (line,) = self._history()
        self.assertEqual(line["plan"], "masodik")
        self.assertEqual(line["claude"]["plan"], "masodik")
        self.assertEqual(line["claude"]["windows"]["seven_day"]["used_percent"], 77.25)

    def test_h_history_line_without_a_state_carries_the_host_plan(self):
        self.run_main()
        (line,) = self._history()
        self.assertEqual((line["plan"], line["claude"]["plan"]), ("elso", "elso"))

    def test_h_probe_failed_line_has_the_plan_and_no_numbers(self):
        self.write_state(_state(_plan_entry(_now_ms() - 30 * 60_000)))
        os.environ["STUB_MODE"] = "fail"
        self.run_main()
        (line,) = self._history()
        self.assertEqual((line["plan"], line["claude"]["source"]), ("masodik", "probe-failed"))
        self.assertNotIn("windows", line["claude"])

    # A `marker` key is used as the probe: compute_alerts rewrites the real window flags on every run
    # whatever the state held, so only a key it never touches shows whether the state was RESET.
    def test_alert_state_is_reset_when_the_plan_behind_the_snapshot_changes(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        with open(self.paths["STATE_PATH"], "w") as f:
            json.dump({"_plan": "elso", "marker": {"active": True, "last_fired": 1.0}}, f)
        self.run_main()
        st = self.read_json("usage-alert-state.json")
        self.assertEqual(st["_plan"], "masodik")
        self.assertNotIn("marker", st, "the elso series' dedup state must not survive into the masodik series")

    def test_legacy_alert_state_without_plan_is_the_host_plans(self):
        flag = {"active": True, "last_fired": 1.0}
        with open(self.paths["STATE_PATH"], "w") as f:
            json.dump({"marker": flag}, f)
        # no plans state -> host plan -> the legacy state is kept (it is elso's)
        self.run_main()
        st = self.read_json("usage-alert-state.json")
        self.assertEqual(st["_plan"], "elso")
        self.assertIn("marker", st)
        # ... but a fleet on masodik starts clean
        with open(self.paths["STATE_PATH"], "w") as f:
            json.dump({"marker": flag}, f)
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        self.run_main()
        st = self.read_json("usage-alert-state.json")
        self.assertEqual(st["_plan"], "masodik")
        self.assertNotIn("marker", st)

    def test_alert_state_is_kept_while_the_plan_stays_the_same(self):
        self.write_state(_state(_plan_entry(_now_ms() - 60_000)))
        with open(self.paths["STATE_PATH"], "w") as f:
            json.dump({"_plan": "masodik", "marker": {"active": True, "last_fired": 7.0}}, f)
        self.run_main()
        self.assertEqual(self.read_json("usage-alert-state.json")["marker"]["last_fired"], 7.0)

    def test_pace_alerts_are_computed_on_the_fleet_numbers(self):
        # masodik at 99% of the weekly window -> near-exhaustion alert; the host's 22% would give none
        reset = int(time.time()) + 86400
        self.write_state(_state(_plan_entry(_now_ms() - 60_000, windows={
            "seven_day": {"usedPercent": 99.0, "resetsAt": reset},
        })))
        out = self.run_main()
        self.assertIn("weekly limit nearly exhausted (99%)", out)
        self.assertIn("Claude (source: authoritative, plan: masodik):", out)


class JsonModeStaysPure(unittest.TestCase):
    """--json: stdout is ONLY the snapshot, also on the fleet-plan branch (usage-collect-json-purity)."""

    def test_json_stdout_is_pure_on_the_fleet_branch(self):
        tmp = tempfile.mkdtemp(prefix="uc-fleet-json-")
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        home = os.path.join(tmp, "home")
        bindir = os.path.join(tmp, "bin")
        os.makedirs(home)
        os.makedirs(bindir)
        # `security` and `claude` are stubbed so the host reading cannot reach the keychain or the CLI
        for name, body in (("security", "#!/bin/sh\nexit 44\n"), ("claude", "#!/bin/sh\necho 1.0.0\n")):
            p = os.path.join(bindir, name)
            with open(p, "w") as f:
                f.write(body)
            os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
        state_path = os.path.join(tmp, "plans.json")
        with open(state_path, "w") as f:
            json.dump(_state(_plan_entry(_now_ms() - 30_000)), f)
        stub = os.path.join(tmp, "stub.py")
        with open(stub, "w") as f:
            f.write(STUB)
        env = {
            "PATH": bindir + os.pathsep + "/usr/bin:/bin",
            "HOME": home,
            "USAGE_COLLECT_PLANS_STATE": state_path,
            "USAGE_COLLECT_PROBE_CMD": f"{sys.executable} {stub}",
            "STUB_CALLS": os.path.join(tmp, "calls.log"),
            "MAIN_AGENT_ID": "marveen",
            "MARVEEN_USAGE_NO_REFRESH": "1",
        }
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "usage-collect.py"), "--json"],
                           capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        d = json.loads(r.stdout)                       # the WHOLE stdout parses
        self.assertTrue(r.stdout.lstrip().startswith("{"))
        self.assertEqual(d["claude"]["plan"], "masodik")
        self.assertEqual(d["claude"]["source"], "authoritative")
        self.assertEqual(d["claude"]["windows"]["seven_day"]["used_percent"], 77.25)
        self.assertNotIn("seven_day_opus", d["claude"]["windows"])

    def test_probe_stub_stdout_never_reaches_json_stdout(self):
        # a noisy probe command (prints to stdout AND stderr) must not pollute --json
        tmp = tempfile.mkdtemp(prefix="uc-fleet-json2-")
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        home = os.path.join(tmp, "home")
        bindir = os.path.join(tmp, "bin")
        os.makedirs(home)
        os.makedirs(bindir)
        for name, body in (("security", "#!/bin/sh\nexit 44\n"), ("claude", "#!/bin/sh\necho 1.0.0\n")):
            p = os.path.join(bindir, name)
            with open(p, "w") as f:
                f.write(body)
            os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
        state_path = os.path.join(tmp, "plans.json")
        with open(state_path, "w") as f:
            json.dump(_state(_plan_entry(_now_ms() - 30 * 60_000)), f)    # stale; --json must not run the probe
        noisy = os.path.join(tmp, "noisy.py")
        with open(noisy, "w") as f:
            f.write("import sys\nprint('PROBE STDOUT NOISE')\nprint('probe stderr noise', file=sys.stderr)\nsys.exit(1)\n")
        env = {
            "PATH": bindir + os.pathsep + "/usr/bin:/bin",
            "HOME": home,
            "USAGE_COLLECT_PLANS_STATE": state_path,
            "USAGE_COLLECT_PROBE_CMD": f"{sys.executable} {noisy}",
            "MAIN_AGENT_ID": "marveen",
            "MARVEEN_USAGE_NO_REFRESH": "1",
        }
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "usage-collect.py"), "--json"],
                           capture_output=True, text=True, timeout=60, env=env)
        d = json.loads(r.stdout)
        self.assertNotIn("NOISE", r.stdout)
        self.assertEqual(d["claude"]["source"], "probe-failed")
        self.assertNotIn("NOISE", d["claude"]["error"])
        self.assertIn("read-only", d["claude"]["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

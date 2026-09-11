#!/usr/bin/env python3
"""Contract tests for scripts/expiry-check.py. Card b91eb75f.

WHAT THESE PIN, AND WHY THESE AND NOT THE HAPPY PATH. The defect this checker
exists to prevent is not "a date passed". It is that a credential nobody could
measure looked exactly like a credential that was fine. So the load-bearing
assertions are the ones that separate those two:

    an UNKNOWN item with nothing due must NOT exit 0        (test_unknown_alone_is_not_green)
    a FAILED probe must NOT be folded into NO_EXPIRY        (test_probe_failure_is_not_no_expiry)
    the summary must never read as all-clear while unmeasured  (test_summary_never_claims_all_clear)
    an empty inventory must refuse, not report a clean run  (test_empty_inventory_refuses)

A checker that got all four wrong would still pass a happy-path test, and would
still print a plausible green every morning.

No mocks: probes are real subprocesses (python3 -c), so the process boundary the
real probes cross is the one under test.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "expiry-check.py")
NOW = "2026-09-11T00:00:00Z"


def emit(payload):
    """A probe command that prints `payload` as JSON on stdout."""
    return ["python3", "-c", f"import json;print(json.dumps({payload!r}))"]


def emit_raw(text, rc=0):
    return ["python3", "-c", f"import sys;sys.stdout.write({text!r});sys.exit({rc})"]


def run(items, threshold=14, now=NOW, as_json=True, env=None, extra=None, scan=None):
    inv = {"threshold_days": threshold, "items": items}
    if scan is not None:
        inv["scan"] = scan
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(inv, fh)
        path = fh.name
    try:
        cmd = [sys.executable, SCRIPT, "--inventory", path, "--now", now]
        if as_json:
            cmd.append("--json")
        cmd.extend(extra or [])
        e = dict(os.environ, **(env or {}))
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=e)
        return p.returncode, p.stdout, p.stderr
    finally:
        os.unlink(path)


def item(iid, probe, **kw):
    base = {"id": iid, "what": iid, "renewed_by": "friday", "renew": "n/a", "probe": probe}
    base.update(kw)
    return base


def json_probe_at(iso):
    return {"kind": "json_cmd", "cmd": emit({"session": {"expiresAt": iso}}), "path": "session.expiresAt"}


NO_EXPIRY_ITEM = item("static", {"kind": "none_by_construction", "why": "no expiry"})


class SchedulerExit(unittest.TestCase):
    """--scheduler-exit: the ladder is a REPORT SHAPE, an alarm threshold is a FAILURE signal,
    and binding one to the other mislabels every real finding as a broken tool.

    Measured on src/web/command-task.ts: a non-zero exit makes the runner treat the command as
    FAILED, the alert fires once and then goes quiet, it reaches the OWNER's Telegram as
    "<label> nem valaszol", the detail carries only stderr (this tool prints to stdout), and a
    later success sends "Helyreallt" -- a false all-clear. So the alarm must mean "the checker
    broke", nothing else."""

    def test_a_finding_is_not_a_failure(self):
        for probe, name in ((json_probe_at("2026-01-01T00:00:00Z"), "due"),
                            ({"kind": "not_queryable", "why": "x"}, "unknown")):
            with self.subTest(case=name):
                bare, _, _ = run([item(name, probe)], as_json=False)
                self.assertNotEqual(bare, 0, "control: the report code is non-zero on its own")
                sched, _, err = run([item(name, probe)], as_json=False,
                                    extra=["--scheduler-exit"])
                self.assertEqual(sched, 0, "a run that found something is not a broken run")
                self.assertIn("a meres LEFUTOTT", err)

    def test_a_broken_checker_IS_a_failure(self):
        """The hole my own first cut had: main() has five separate `return 2` paths, and a
        mapping written next to the final return misses every one of them."""
        p = subprocess.run([sys.executable, SCRIPT, "--scheduler-exit",
                            "--inventory", "/definitely/not/here.json"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 1, "an unreadable inventory must reach the alarm")
        self.assertIn("AZ ELLENORZO TORT EL", p.stderr)

    def test_the_flag_is_opt_in_and_the_raw_ladder_is_untouched(self):
        p = subprocess.run([sys.executable, SCRIPT, "--inventory", "/definitely/not/here.json"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 2, "without the flag the report code is unchanged")
        self.assertNotIn("SCHEDULER:", p.stderr)

    def test_a_clean_run_is_zero_either_way(self):
        it = item("static", {"kind": "none_by_construction", "why": "x"})
        self.assertEqual(run([it], as_json=False)[0], 0)
        self.assertEqual(run([it], as_json=False, extra=["--scheduler-exit"])[0], 0)

    def test_the_mapping_announces_itself(self):
        """A translated exit code that says nothing is how the meaning gets lost again."""
        _, _, err = run([item("old", json_probe_at("2026-01-01T00:00:00Z"))],
                        as_json=False, extra=["--scheduler-exit"])
        self.assertIn("a belso kilepesi kod 3", err,
                      "the original code must stay visible in the log")


class Sweep(unittest.TestCase):
    """The SIXTH state: a credential that exists and is not on the list.

    The five states partition WHAT WE ASKED ABOUT. An unlisted credential yields no DUE, no
    UNKNOWN, no FAILED -- nothing at all -- and therefore looks exactly like a healthy one,
    which is this checker's own opening sentence turned on itself.

    The load-bearing test here is test_missing_scan_dir_is_loud: a sweep over a directory that
    does not exist finds nothing, and "found nothing" is byte-identical to "everything is
    claimed". Rename the directory and the gate goes quiet in the reassuring direction.
    """

    def setUp(self):
        self.d = tempfile.mkdtemp()
        with open(os.path.join(self.d, "known.json"), "w") as fh:
            fh.write("{}")

    def _scan(self, d=None):
        return [{"dir": d or self.d, "glob": "*.json", "why": "test"}]

    def _claimed(self, extra_cover=None):
        it = item("static", {"kind": "none_by_construction", "why": "x"})
        it["covers"] = [os.path.join(self.d, "known.json")] + (extra_cover or [])
        return it

    def test_unclaimed_file_is_reported_and_sets_exit_5(self):
        rc, out, _ = run([item("static", {"kind": "none_by_construction", "why": "x"})],
                         scan=self._scan())
        d = json.loads(out)
        self.assertEqual(rc, 5, "an existing, unlisted credential must not be a clean run")
        self.assertEqual(d["unlisted"], 1)

    def test_a_claimed_file_produces_no_finding(self):
        rc, out, _ = run([self._claimed()], scan=self._scan())
        d = json.loads(out)
        self.assertEqual(rc, 0)
        self.assertEqual(d["unlisted"], 0)
        self.assertEqual(d["sweep_failed"], 0)

    def test_missing_scan_dir_is_loud(self):
        """A sweep that sweeps nothing must never read as a clean sweep."""
        rc, out, _ = run([self._claimed()], scan=self._scan(d=os.path.join(self.d, "gone")))
        d = json.loads(out)
        self.assertEqual(rc, 5, "a sweep that could not run must not contribute a silent zero")
        self.assertEqual(d["sweep_failed"], 1)
        self.assertEqual(d["unlisted"], 0, "a missing dir is not the same claim as an unlisted file")

    def test_no_scan_section_means_no_sweep(self):
        """Backward compatible: an inventory without `scan` behaves exactly as before."""
        rc, out, _ = run([item("static", {"kind": "none_by_construction", "why": "x"})])
        d = json.loads(out)
        self.assertEqual(rc, 0)
        self.assertEqual(d["unlisted"], 0)
        self.assertEqual(d["swept"], [])

    def test_the_swept_population_is_always_printed(self):
        """A completeness claim without its denominator repeats the bug it fixes."""
        rc, out, _ = run([self._claimed()], scan=self._scan(), as_json=False)
        self.assertIn("DEKLARALT HELYEK SOPRESE", out)
        self.assertIn("NEM gep-szintu cenzus", out, "the limit of the sweep must be stated")
        self.assertRegex(out, r"1 fajl")

    def test_due_outranks_unlisted_but_unlisted_is_still_counted(self):
        rc, out, _ = run([item("old", json_probe_at("2026-01-01T00:00:00Z"))], scan=self._scan())
        d = json.loads(out)
        self.assertEqual(rc, 3, "a concrete expiry leads")
        self.assertEqual(d["unlisted"], 1, "and the incomplete list is still reported")

    def test_unlisted_outranks_unknown(self):
        """An UNKNOWN is a gap we chose to carry; an unlisted file means the POPULATION is
        wrong, and every other number is conditional on it."""
        rc, out, _ = run([item("opaque", {"kind": "not_queryable", "why": "x"})],
                         scan=self._scan())
        d = json.loads(out)
        self.assertEqual(rc, 5)
        self.assertEqual(d["unmeasured"], 1)

    def test_summary_says_the_list_is_incomplete(self):
        rc, out, _ = run([self._claimed()], scan=self._scan(d=os.path.join(self.d, "gone")),
                         as_json=False)
        self.assertIn("NINCS A LELTARBAN", out)
        self.assertIn("NEM TELJES", out)

    def test_an_unreadable_dir_is_not_the_same_as_an_empty_one(self):
        """THE FOURTH STATE (didi, 2026-09-11). The first cut separated three: readable,
        missing, and "0 files". But "exists and is genuinely empty" and "exists, unreadable,
        hiding any number of credentials" both produced `0 fajl` -- byte-identical, and the
        second one is the dangerous half.

        THE FIXTURE IS ASSERTED FIRST, because a chmod that did not take would make this
        test pass while proving nothing -- the exact failure mode it is about."""
        unreadable = os.path.join(self.d, "locked")
        os.makedirs(unreadable)
        with open(os.path.join(unreadable, "secret.json"), "w") as fh:
            fh.write("{}")
        os.chmod(unreadable, 0)
        try:
            # FIXTURE CONTROL: prove the directory really is unreadable, and that the same
            # call succeeds on a readable one. Without both halves this proves nothing.
            with self.assertRaises(OSError, msg="the chmod did not take -- fixture is void"):
                os.listdir(unreadable)
            self.assertIn("known.json", os.listdir(self.d),
                          "the same call must succeed on a readable dir")

            rc, out, _ = run([self._claimed()],
                             scan=[{"dir": unreadable, "glob": "*.json", "why": "t"}])
            d = json.loads(out)
            self.assertEqual(rc, 5, "an unreadable location must not read as a clean sweep")
            self.assertEqual(d["sweep_failed"], 1)
            self.assertTrue(any("NEM OLVASHATO" in s for s in d["swept"]),
                            f"the swept line must say so, got {d['swept']}")
        finally:
            os.chmod(unreadable, 0o700)

    def test_unreadable_empty_and_missing_produce_three_different_lines(self):
        """All three must be distinguishable in the OUTPUT, not only in the exit code --
        the exit code collapses two of them into 5 by design."""
        empty = os.path.join(self.d, "empty"); os.makedirs(empty)
        locked = os.path.join(self.d, "locked2"); os.makedirs(locked)
        os.chmod(locked, 0)
        missing = os.path.join(self.d, "gone")
        try:
            lines = {}
            for tag, path in (("empty", empty), ("locked", locked), ("missing", missing)):
                _, out, _ = run([self._claimed()],
                                scan=[{"dir": path, "glob": "*.json", "why": "t"}])
                lines[tag] = json.loads(out)["swept"][0].split(": ", 1)[1]
            self.assertEqual(lines["empty"], "0 fajl")
            self.assertNotEqual(lines["locked"], lines["empty"],
                                "unreadable must not look like empty")
            self.assertNotEqual(lines["locked"], lines["missing"],
                                "unreadable must not look like missing either")
        finally:
            os.chmod(locked, 0o700)

    def test_a_genuinely_empty_dir_is_still_a_clean_sweep(self):
        """The negative control for the two above: tightening the unreadable case must not
        turn an honestly empty location into a finding."""
        empty = os.path.join(self.d, "really-empty")
        os.makedirs(empty)
        rc, out, _ = run([self._claimed()], scan=[{"dir": empty, "glob": "*.json", "why": "t"}])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["sweep_failed"], 0)

    def test_a_newly_appearing_credential_breaks_the_silence(self):
        """The sweep result is part of the remembered state.

        Without this the daily run would report a new unlisted credential ONCE and then fall
        silent about it -- and a suppressed finding on a credential nobody listed is exactly
        the silence this whole card is about, rebuilt inside the noise control."""
        sp = os.path.join(tempfile.mkdtemp(), "state.json")
        claimed = self._claimed()
        # first run: everything claimed, and it records that
        rc1, out1, _ = run([claimed], scan=self._scan(), as_json=False,
                           extra=["--quiet-unless-changed", sp])
        # second run, unchanged -> silent
        rc2, out2, _ = run([claimed], scan=self._scan(), as_json=False,
                           extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc2, 0)
        self.assertIn("ELNEMITVA", out2)
        # now a new credential appears in the swept directory
        with open(os.path.join(self.d, "surprise.json"), "w") as fh:
            fh.write("{}")
        rc3, out3, _ = run([claimed], scan=self._scan(), as_json=False,
                           extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc3, 5, "a credential appearing on disk is a CHANGE, not noise")
        self.assertNotIn("ELNEMITVA", out3)
        self.assertIn("valtozott az allapot", out3)

    def test_shipped_inventory_declares_a_scan_and_covers_what_it_names(self):
        inv_path = os.path.join(HERE, "..", "expiry-inventory.json")
        with open(inv_path, encoding="utf-8") as fh:
            inv = json.load(fh)
        self.assertTrue(inv.get("scan"), "the shipped inventory must declare where it sweeps")
        for sc in inv["scan"]:
            for field in ("dir", "glob", "why"):
                self.assertIn(field, sc, "a scan location without a stated reason is a guess")
        covers = [c for it in inv["items"] for c in it.get("covers", [])]
        self.assertIn("~/.config/marveen/gmail-imap.json", covers,
                      "the entry that was found MISSING must stay claimed")


class ExpiryCheck(unittest.TestCase):

    # --- the four load-bearing ones ---------------------------------------

    def test_unknown_alone_is_not_green(self):
        """An item declared not queryable, with nothing due, must not exit 0."""
        rc, out, _ = run([NO_EXPIRY_ITEM, item("opaque", {"kind": "not_queryable", "why": "no field"})])
        self.assertEqual(rc, 4, "a not-queryable item must not read as a clean run")
        d = json.loads(out)
        self.assertEqual(d["unmeasured"], 1)
        self.assertEqual(d["due"], 0)

    def test_probe_failure_is_not_no_expiry(self):
        """A probe that cannot answer is FAILED, never NO_EXPIRY."""
        cases = {
            "non_json": {"kind": "json_cmd", "cmd": emit_raw("not json at all"), "path": "a.b"},
            "missing_path": {"kind": "json_cmd", "cmd": emit({"session": {}}), "path": "session.expiresAt"},
            "unparseable": {"kind": "json_cmd", "cmd": emit({"s": {"e": "soon-ish"}}), "path": "s.e"},
            "no_such_cmd": {"kind": "json_cmd", "cmd": ["definitely-not-a-real-binary-xyz"], "path": "a"},
        }
        for name, probe in cases.items():
            with self.subTest(case=name):
                rc, out, _ = run([item(name, probe)])
                states = {i["id"]: i["state"] for i in json.loads(out)["items"]}
                self.assertEqual(states[name], "FAILED", f"{name} must be FAILED")
                self.assertEqual(rc, 4)

    def test_summary_never_claims_all_clear(self):
        """Human output must name the unmeasured count, not bury it."""
        rc, out, _ = run([NO_EXPIRY_ITEM, item("opaque", {"kind": "not_queryable", "why": "x"})],
                         as_json=False)
        self.assertEqual(rc, 4)
        self.assertIn("NEM MERHETO", out)
        self.assertIn("1 NEM MERHETO", out)
        # and the reassuring count must not stand alone as the whole verdict
        self.assertRegex(out, r"NEM 'rendben'")

    def test_empty_inventory_refuses(self):
        for bad in ([], None):
            with self.subTest(items=bad):
                rc, _, err = run(bad if bad is not None else [])
                self.assertEqual(rc, 2)
                self.assertIn("refusing", err.lower())

    # --- states and the exit-code ladder ----------------------------------

    def test_expired_is_due(self):
        rc, out, _ = run([item("old", json_probe_at("2026-08-07T00:00:00Z"))])
        d = json.loads(out)
        self.assertEqual(rc, 3)
        self.assertEqual(d["items"][0]["state"], "DUE")
        self.assertLess(d["items"][0]["days_left"], 0)
        self.assertEqual(d["items"][0]["note"], "EXPIRED")

    def test_far_future_is_ok_and_green(self):
        rc, out, _ = run([item("far", json_probe_at("2028-01-01T00:00:00Z"))])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["items"][0]["state"], "OK")

    def test_threshold_boundary(self):
        """Inside the window is DUE; on the far side it is OK."""
        # 13 days out -> due; 15 days out -> ok. (14 is the boundary itself.)
        rc_in, out_in, _ = run([item("soon", json_probe_at("2026-09-24T00:00:00Z"))])
        rc_out, out_out, _ = run([item("later", json_probe_at("2026-09-26T00:00:00Z"))])
        self.assertEqual(rc_in, 3, "13 days out must be due")
        self.assertEqual(json.loads(out_in)["items"][0]["state"], "DUE")
        self.assertEqual(rc_out, 0, "15 days out must not be due")
        self.assertEqual(json.loads(out_out)["items"][0]["state"], "OK")

    def test_due_outranks_unmeasured_in_exit_code(self):
        """Both are reported; the concrete, actionable one sets the exit code."""
        rc, out, _ = run([
            item("old", json_probe_at("2026-01-01T00:00:00Z")),
            item("opaque", {"kind": "not_queryable", "why": "x"}),
        ])
        d = json.loads(out)
        self.assertEqual(rc, 3)
        self.assertEqual(d["due"], 1)
        self.assertEqual(d["unmeasured"], 1, "the unmeasured item must still be counted")

    def test_all_measured_and_fine_is_zero(self):
        rc, out, _ = run([NO_EXPIRY_ITEM, item("far", json_probe_at("2030-01-01T00:00:00Z"))])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["unmeasured"], 0)

    def test_unknown_probe_kind_fails_loudly(self):
        rc, out, _ = run([item("weird", {"kind": "telepathy"})])
        self.assertEqual(rc, 4)
        self.assertEqual(json.loads(out)["items"][0]["state"], "FAILED")

    # --- http_header: absent vs present-but-empty -------------------------

    def test_absent_header_is_no_expiry_but_empty_header_is_failure(self):
        absent = {"kind": "http_header",
                  "cmd": emit_raw("HTTP/2 200\nx-other: 1\n"),
                  "header": "github-authentication-token-expiration"}
        empty = {"kind": "http_header",
                 "cmd": emit_raw("HTTP/2 200\ngithub-authentication-token-expiration:\n"),
                 "header": "github-authentication-token-expiration"}
        rc_a, out_a, _ = run([item("absent", absent)])
        self.assertEqual(rc_a, 0)
        self.assertEqual(json.loads(out_a)["items"][0]["state"], "NO_EXPIRY")
        rc_e, out_e, _ = run([item("empty", empty)])
        self.assertEqual(rc_e, 4, "a present-but-empty header is an absence of answer, not a 'never'")
        self.assertEqual(json.loads(out_e)["items"][0]["state"], "FAILED")

    def test_header_with_a_real_date_is_used(self):
        probe = {"kind": "http_header",
                 "cmd": emit_raw("HTTP/2 200\nGithub-Authentication-Token-Expiration: 2026-09-15T10:00:00Z\n"),
                 "header": "github-authentication-token-expiration"}
        rc, out, _ = run([item("gh", probe)])
        self.assertEqual(rc, 3, "a date inside the window must be due even though it came from a header")
        self.assertEqual(json.loads(out)["items"][0]["state"], "DUE")

    # --- --quiet-unless-changed: suppression that cannot go silent ---------
    #
    # This is the most dangerous code in the script, because its failure mode is
    # silence -- a broken suppressor produces no output to be suspicious of. Every
    # path to silence is pinned, and so is every path that must REFUSE to be silent.

    DUE_ITEM = staticmethod(lambda: item("old", json_probe_at("2026-01-01T00:00:00Z")))

    def _state_path(self):
        d = tempfile.mkdtemp()
        return os.path.join(d, "nested", "state.json")   # nested: dir must be created

    def test_first_run_reports_and_records(self):
        """With no previous state there is nothing to compare, so it must report."""
        sp = self._state_path()
        rc, out, _ = run([self.DUE_ITEM()], as_json=False, extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc, 3, "a first run must never be silent")
        self.assertIn("nincs korabbi allapot", out)
        self.assertTrue(os.path.exists(sp), "the snapshot must be written")
        with open(sp, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["states"], {"old": "DUE"})

    def test_second_identical_run_is_silent_but_says_so(self):
        sp = self._state_path()
        run([self.DUE_ITEM()], as_json=False, extra=["--quiet-unless-changed", sp])
        rc, out, _ = run([self.DUE_ITEM()], as_json=False, extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc, 0, "an unchanged state must not re-fire")
        self.assertIn("ELNEMITVA", out)
        self.assertIn("A kilepesi kod 3 helyett 0", out,
                      "the withheld verdict must be named, not just hidden")
        self.assertIn("LEJART", out, "the table itself must still be printed")

    def test_changed_state_reports_again(self):
        sp = self._state_path()
        run([self.DUE_ITEM()], as_json=False, extra=["--quiet-unless-changed", sp])
        rc, out, _ = run([self.DUE_ITEM(), item("new", {"kind": "not_queryable", "why": "x"})],
                         as_json=False, extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc, 3)
        self.assertIn("valtozott az allapot", out)

    def test_silence_has_a_ceiling(self):
        """Identical state, but the last report is older than the ceiling: report."""
        sp = self._state_path()
        run([self.DUE_ITEM()], as_json=False, now="2026-09-01T00:00:00Z",
            extra=["--quiet-unless-changed", sp])
        # 6 days later: still silent. 8 days later: forced out of silence.
        rc6, out6, _ = run([self.DUE_ITEM()], as_json=False, now="2026-09-07T00:00:00Z",
                           extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc6, 0, "inside the ceiling it may stay silent")
        self.assertIn("ELNEMITVA", out6)
        # re-seed the old timestamp, since the run above refreshed it
        with open(sp, "w", encoding="utf-8") as fh:
            json.dump({"checked_at": "2026-09-01T00:00:00+00:00", "states": {"old": "DUE"}}, fh)
        rc8, out8, _ = run([self.DUE_ITEM()], as_json=False, now="2026-09-09T00:00:00Z",
                           extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc8, 3, "past the ceiling the report is forced")
        self.assertIn("napos", out8)

    def test_corrupt_or_unreadable_state_reports(self):
        for content in ("{not json", '{"states": "not a dict"}', '{"states": {"old": "DUE"}}'):
            with self.subTest(content=content[:20]):
                sp = self._state_path()
                os.makedirs(os.path.dirname(sp), exist_ok=True)
                with open(sp, "w", encoding="utf-8") as fh:
                    fh.write(content)
                rc, out, _ = run([self.DUE_ITEM()], as_json=False,
                                 extra=["--quiet-unless-changed", sp])
                self.assertEqual(rc, 3, f"a state file it cannot trust must not buy silence: {content[:20]}")
                self.assertNotIn("ELNEMITVA", out)

    def test_unwritable_state_reports(self):
        """If it cannot remember this run, it must not be silent about this one
        either -- otherwise the next run compares against a stale snapshot."""
        sp = os.path.join(tempfile.mkdtemp(), "state.json")
        os.makedirs(sp)  # a DIRECTORY where the file should go: open() for write fails
        rc, out, _ = run([self.DUE_ITEM()], as_json=False, extra=["--quiet-unless-changed", sp])
        self.assertEqual(rc, 3)
        self.assertIn("nem mentheto", out)

    def test_suppression_is_opt_in(self):
        """Without the flag nothing is ever suppressed, whatever files exist."""
        rc, out, _ = run([self.DUE_ITEM()], as_json=False)
        self.assertEqual(rc, 3)
        self.assertNotIn("ELNEMITVA", out)

    # --- gcloud_sa_key: the key IN USE, not the first one listed -----------

    def _sa_fixture(self, listed):
        """A key file plus a fake `gcloud` on PATH returning `listed`."""
        d = tempfile.mkdtemp()
        keyfile = os.path.join(d, "sa.json")
        with open(keyfile, "w", encoding="utf-8") as fh:
            json.dump({"private_key_id": "INUSE0001",
                       "client_email": "svc@example.iam.gserviceaccount.com"}, fh)
        shim = os.path.join(d, "gcloud")
        with open(shim, "w", encoding="utf-8") as fh:
            fh.write("#!/usr/bin/env python3\nimport json,sys\n"
                     f"print(json.dumps({listed!r}))\n")
        os.chmod(shim, 0o755)
        return d, keyfile

    def test_sa_probe_matches_the_key_in_use_not_the_first_listed(self):
        """MEASURED 2026-09-11: the account carries three keys. The one actually
        read by the service never expires; two siblings expire in 2028. A probe
        that took the first entry would report a real, plausible date belonging
        to a key nothing reads -- wrong in the reassuring direction, and
        invisible. This pins the private_key_id match."""
        d, keyfile = self._sa_fixture([
            {"name": "projects/p/serviceAccounts/s/keys/OTHER0001",
             "validBeforeTime": "2026-09-14T00:00:00Z"},   # decoy: inside the window
            {"name": "projects/p/serviceAccounts/s/keys/INUSE0001",
             "validBeforeTime": "2030-01-01T00:00:00Z"},   # the one in use: far away
        ])
        rc, out, _ = run([item("sa", {"kind": "gcloud_sa_key", "key_file": keyfile})],
                         env={"PATH": d + os.pathsep + os.environ["PATH"]})
        got = json.loads(out)["items"][0]
        self.assertEqual(got["state"], "OK", "must read the key in use, not the decoy")
        self.assertTrue(got["expires_at"].startswith("2030"),
                        f"reported {got['expires_at']}, i.e. the wrong key")
        self.assertEqual(rc, 0)

    def test_sa_probe_reports_the_key_in_use_when_it_is_the_one_expiring(self):
        """Control for the test above: with the dates swapped the same probe must
        say DUE. Without this, a probe hard-wired to 'always pick the far date'
        would pass the previous test."""
        d, keyfile = self._sa_fixture([
            {"name": "projects/p/serviceAccounts/s/keys/OTHER0001",
             "validBeforeTime": "2030-01-01T00:00:00Z"},
            {"name": "projects/p/serviceAccounts/s/keys/INUSE0001",
             "validBeforeTime": "2026-09-14T00:00:00Z"},
        ])
        rc, out, _ = run([item("sa", {"kind": "gcloud_sa_key", "key_file": keyfile})],
                         env={"PATH": d + os.pathsep + os.environ["PATH"]})
        got = json.loads(out)["items"][0]
        self.assertEqual(got["state"], "DUE")
        self.assertEqual(rc, 3)

    def test_sa_probe_year_9999_is_no_expiry(self):
        d, keyfile = self._sa_fixture([
            {"name": "projects/p/serviceAccounts/s/keys/INUSE0001",
             "validBeforeTime": "9999-12-31T23:59:59Z"},
        ])
        rc, out, _ = run([item("sa", {"kind": "gcloud_sa_key", "key_file": keyfile})],
                         env={"PATH": d + os.pathsep + os.environ["PATH"]})
        self.assertEqual(json.loads(out)["items"][0]["state"], "NO_EXPIRY")
        self.assertEqual(rc, 0)

    def test_sa_probe_missing_key_is_a_failure_not_a_pass(self):
        """A key that is not listed was rotated or revoked. That is the loudest
        possible state, and it must never read as 'no expiry'."""
        d, keyfile = self._sa_fixture([
            {"name": "projects/p/serviceAccounts/s/keys/SOMEONEELSE",
             "validBeforeTime": "2030-01-01T00:00:00Z"},
        ])
        rc, out, _ = run([item("sa", {"kind": "gcloud_sa_key", "key_file": keyfile})],
                         env={"PATH": d + os.pathsep + os.environ["PATH"]})
        self.assertEqual(json.loads(out)["items"][0]["state"], "FAILED")
        self.assertEqual(rc, 4)

    # --- the real inventory shipped in this repo ---------------------------

    def test_shipped_inventory_is_valid_and_populated(self):
        inv_path = os.path.join(HERE, "..", "expiry-inventory.json")
        with open(inv_path, encoding="utf-8") as fh:
            inv = json.load(fh)
        self.assertGreaterEqual(len(inv["items"]), 1)
        self.assertIsInstance(inv["threshold_days"], int)
        known = {"json_cmd", "http_header", "gcloud_sa_key", "not_queryable", "none_by_construction"}
        seen = set()
        for it in inv["items"]:
            for field in ("id", "what", "where", "renewed_by", "probe"):
                self.assertIn(field, it, f"{it.get('id')} is missing {field}")
            kind = it["probe"].get("kind")
            self.assertIn(kind, known, f"{it['id']} has unknown probe kind {kind!r}")
            # Every non-probing item must say WHY -- an undeclared gap is the
            # thing this card is about.
            if kind in ("not_queryable", "none_by_construction"):
                self.assertTrue(it["probe"].get("why"), f"{it['id']} must state why")
            seen.add(it["id"])
        self.assertEqual(len(seen), len(inv["items"]), "duplicate item ids")


if __name__ == "__main__":
    unittest.main(verbosity=2)

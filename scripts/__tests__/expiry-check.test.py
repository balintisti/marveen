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


def run(items, threshold=14, now=NOW, as_json=True, env=None):
    inv = {"threshold_days": threshold, "items": items}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(inv, fh)
        path = fh.name
    try:
        cmd = [sys.executable, SCRIPT, "--inventory", path, "--now", now]
        if as_json:
            cmd.append("--json")
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

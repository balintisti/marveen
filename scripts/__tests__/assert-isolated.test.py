#!/usr/bin/env python3
"""Contract tests for scripts/assert-isolated.py. Card b786b93b.

THE LOAD-BEARING TEST IS test_untouched_scratch_is_not_a_pass. Everything else here is
arithmetic; that one is the defect. My real measurement produced an empty scratch
directory and I read it as "the subject stayed silent" -- the answer I wanted. It is
byte-identical to "the redirect never took, so nothing could have appeared there", and
from the scratch directory alone the two cannot be told apart. A tool that returns 0 for
that case is not a weaker guard, it is the bug with a green light on it.

The subjects are real subprocesses writing real files, because the whole question is
where the bytes went.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "assert-isolated.py")

BROKEN, NOT_PROVEN, ISOLATED, USAGE = 3, 4, 0, 2


def writer(path, text="x"):
    """A command that appends to `path`."""
    return ["python3", "-c",
            f"import os;os.makedirs(os.path.dirname({path!r}),exist_ok=True);"
            f"open({path!r},'a').write({text!r})"]


NOOP = ["python3", "-c", "pass"]
FAILS = ["python3", "-c", "import sys;sys.exit(7)"]


def run(scratch, lives, cmd, extra=None):
    argv = [sys.executable, SCRIPT, "--scratch", scratch]
    for l in lives:
        argv += ["--live", l]
    argv += (extra or []) + ["--"] + cmd
    p = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout, p.stderr


class AssertIsolated(unittest.TestCase):

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.scratch = os.path.join(self.root, "scratch")
        self.live = os.path.join(self.root, "live")
        os.makedirs(self.scratch)
        os.makedirs(self.live)

    # --- the one that matters ---------------------------------------------

    def test_untouched_scratch_is_not_a_pass(self):
        rc, _, err = run(self.scratch, [self.live], NOOP)
        self.assertEqual(rc, NOT_PROVEN,
                         "an untouched scratch dir must never be reported as isolated")
        self.assertIn("NEM BIZONYITOTT", err)
        self.assertNotIn("IZOLALT:", err)

    # --- the other two outcomes -------------------------------------------

    def test_writing_to_live_is_broken_and_names_the_file(self):
        rc, _, err = run(self.scratch, [self.live], writer(os.path.join(self.live, "debug.log")))
        self.assertEqual(rc, BROKEN)
        self.assertIn("IZOLACIO MEGTORT", err)
        self.assertIn("debug.log", err)

    def test_writing_to_scratch_only_is_isolated(self):
        rc, _, err = run(self.scratch, [self.live], writer(os.path.join(self.scratch, "out.log")))
        self.assertEqual(rc, ISOLATED)
        self.assertIn("IZOLALT", err)
        self.assertIn("AKTIVITAST mutat", err)

    def test_live_wins_over_scratch_when_both_are_written(self):
        """Touching live is decisive; a busy scratch dir does not buy it off."""
        both = ["python3", "-c",
                f"open({os.path.join(self.scratch,'a')!r},'w').write('x');"
                f"open({os.path.join(self.live,'b')!r},'w').write('x')"]
        rc, _, err = run(self.scratch, [self.live], both)
        self.assertEqual(rc, BROKEN)

    # --- the attribution limit is stated, not implied ----------------------

    def test_the_report_does_not_claim_the_command_caused_the_live_change(self):
        rc, _, err = run(self.scratch, [self.live], writer(os.path.join(self.live, "x")))
        self.assertEqual(rc, BROKEN)
        self.assertIn("NEM allitom, hogy ezt a parancs okozta", err,
                      "the fleet runs during the window; attribution is not proven")

    # --- change detection --------------------------------------------------

    def test_a_modified_file_counts_not_only_a_new_one(self):
        target = os.path.join(self.live, "existing")
        with open(target, "w") as fh:
            fh.write("before")
        rc, _, err = run(self.scratch, [self.live], writer(target, "after"))
        self.assertEqual(rc, BROKEN)
        self.assertIn("modosult", err)

    def test_a_deleted_file_counts(self):
        target = os.path.join(self.live, "doomed")
        with open(target, "w") as fh:
            fh.write("x")
        rc, _, err = run(self.scratch, [self.live],
                         ["python3", "-c", f"import os;os.remove({target!r})"])
        self.assertEqual(rc, BROKEN)
        self.assertIn("torolve", err)

    def test_a_live_dir_that_does_not_exist_and_stays_missing_is_not_a_change(self):
        missing = os.path.join(self.root, "never-existed")
        rc, _, _ = run(self.scratch, [missing], writer(os.path.join(self.scratch, "o")))
        self.assertEqual(rc, ISOLATED)

    def test_any_one_of_several_live_dirs_is_enough(self):
        second = os.path.join(self.root, "live2")
        os.makedirs(second)
        rc, _, err = run(self.scratch, [self.live, second],
                         writer(os.path.join(second, "leak")))
        self.assertEqual(rc, BROKEN)
        self.assertIn("leak", err)

    def test_nested_files_are_seen(self):
        deep = os.path.join(self.live, "a", "b", "c.log")
        rc, _, err = run(self.scratch, [self.live], writer(deep))
        self.assertEqual(rc, BROKEN)
        self.assertIn("c.log", err)

    # --- refusals ----------------------------------------------------------

    def test_scratch_equal_to_live_is_refused(self):
        rc, _, err = run(self.scratch, [self.scratch], NOOP)
        self.assertEqual(rc, USAGE)
        self.assertIn("nem izolacio", err)

    def test_no_command_is_refused(self):
        p = subprocess.run([sys.executable, SCRIPT, "--scratch", self.scratch,
                            "--live", self.live], capture_output=True, text=True)
        self.assertEqual(p.returncode, USAGE)

    # --- the escape hatch, and its honesty ---------------------------------

    def test_allow_empty_scratch_passes_but_says_it_proves_nothing(self):
        rc, _, err = run(self.scratch, [self.live], NOOP, extra=["--allow-empty-scratch"])
        self.assertEqual(rc, ISOLATED)
        self.assertIn("NEM bizonyitja", err,
                      "the escape hatch must not read as a proof of isolation")

    def test_allow_empty_scratch_does_NOT_excuse_touching_live(self):
        """The hatch relaxes the positive half only. Writing to live is still fatal."""
        rc, _, _ = run(self.scratch, [self.live], writer(os.path.join(self.live, "x")),
                       extra=["--allow-empty-scratch"])
        self.assertEqual(rc, BROKEN)

    # --- the verdict is about isolation, not about the command --------------

    def test_a_failing_command_with_clean_isolation_still_reports_isolation(self):
        """The subject's own exit code must not be mistaken for the isolation verdict --
        a probe that legitimately fails is still a probe that stayed in its sandbox."""
        cmd = ["python3", "-c",
               f"open({os.path.join(self.scratch,'o')!r},'w').write('x');"
               "import sys;sys.exit(7)"]
        rc, _, err = run(self.scratch, [self.live], cmd)
        self.assertEqual(rc, ISOLATED)
        self.assertIn("kilepesi kodja: 7", err, "the command's own rc must still be visible")

    def test_a_successful_command_does_not_buy_isolation(self):
        rc, _, _ = run(self.scratch, [self.live], writer(os.path.join(self.live, "x")))
        self.assertEqual(rc, BROKEN, "exit 0 from the subject proves nothing about where it wrote")


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Contract tests for scripts/landed-check.py. Card 7eb6a490.

THE LOAD-BEARING TESTS ARE THE TWO THAT KEEP A CARD OUT OF THE CANDIDATE LIST.
Anything can report "this SHA is not an ancestor" -- that leg is exact and cheap. The whole
reason this tool exists in two legs is the pre-measurement: on the naive single-leg form, FIVE
of twelve flagged cards had in fact shipped under a different SHA (42% false positive), and the
direction is the expensive one -- it manufactures work on a finished card, and after a few
rounds nobody believes the gate. So test_subject_on_trunk_clears_the_card and
test_a_hex_token_that_is_not_a_commit_here_is_not_a_candidate are the defect; the rest is
arithmetic.

test_card_id_is_not_a_commit is the third: our card ids are 8 hex characters, so a bare
[0-9a-f]{7,40} census answers 99% where the truth is 78%. A meter whose error looks exactly
like a healthy answer.

The subjects are real git repositories and a real sqlite file, because the question is what git
and the board actually contain.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "landed-check.py")

NO_CANDIDATE, CANDIDATE_FOUND, UNREADABLE, NOT_ESTABLISHED = 0, 3, 2, 4


def git(cwd, *args):
    return subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True, text=True)


class LandedCheck(unittest.TestCase):

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.repo = os.path.join(self.root, "repo")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q", "-b", "trunk")
        git(self.repo, "config", "user.email", "t@example.invalid")
        git(self.repo, "config", "user.name", "t")
        self.db = os.path.join(self.root, "board.db")
        c = sqlite3.connect(self.db)
        c.execute("create table kanban_cards (id text, title text, description text, "
                  "status text, project text)")
        c.execute("create table kanban_comments (id integer, card_id text, author text, "
                  "content text, created_at integer)")
        c.commit()
        c.close()

    def tearDown(self):
        subprocess.run(["rm", "-rf", self.root])

    # --- fixture helpers -------------------------------------------------------------

    def commit(self, subject, fname=None):
        fname = fname or subject.replace(" ", "_")[:20]
        with open(os.path.join(self.repo, fname), "a") as fh:
            fh.write("x")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", subject)
        return git(self.repo, "rev-parse", "HEAD").stdout.strip()

    def card(self, cid, body, title="proba"):
        c = sqlite3.connect(self.db)
        c.execute("insert into kanban_cards values (?,?,?,?,?)",
                  (cid, title, body, "done", "marveen"))
        c.commit()
        c.close()

    def run_tool(self, *extra):
        p = subprocess.run([sys.executable, SCRIPT, "--db", self.db, "--repo", self.repo,
                            "--trunk", "trunk", "--json", *extra],
                           capture_output=True, text=True, timeout=120)
        try:
            return p.returncode, json.loads(p.stdout)
        except ValueError:
            return p.returncode, {"stdout": p.stdout, "stderr": p.stderr}

    # --- a KONTROLL eloszor, mert a szerszam maga tagadja meg a valaszt nelkule -------

    def test_control_passes_on_a_real_repo(self):
        self.commit("elso")
        p = subprocess.run([sys.executable, SCRIPT, "--db", self.db, "--repo", self.repo,
                            "--trunk", "trunk", "--control"], capture_output=True, text=True)
        self.assertEqual(p.returncode, NO_CANDIDATE, p.stdout + p.stderr)
        self.assertIn("KONTROLL: OK", p.stdout)

    # --- az egyszeru irany -----------------------------------------------------------

    def test_a_commit_on_the_trunk_is_landed(self):
        sha = self.commit("a munka")
        self.card("aaaaaaaa", f"kesz, commit {sha[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, NO_CANDIDATE, out)
        self.assertEqual(out["counts"]["LANDED"], 1)
        self.assertEqual(out["counts"]["CANDIDATE"], 0)

    def test_a_commit_that_never_reached_the_trunk_is_a_candidate(self):
        self.commit("alap")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        sha = self.commit("ez sosem olvadt be")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("bbbbbbbb", f"kesz, commit {sha[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, CANDIDATE_FOUND, out)
        self.assertEqual([c["card"] for c in out["candidates"]], ["bbbbbbbb"])

    # --- A VEDO LAB: a 42%-os hamis pozitiv, amiert ez a szerszam ket labon all -------

    def test_subject_on_trunk_clears_the_card(self):
        """A hash elavult (rebase/ujraalkotas), a MUNKA leszallt -- ez NEM jelolt."""
        self.commit("alap")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        sha = self.commit("feat: ugyanaz a targy")
        git(self.repo, "checkout", "-q", "trunk")
        self.commit("feat: ugyanaz a targy", fname="masik_fajl")   # MAS SHA, AZONOS targy
        self.card("cccccccc", f"kesz, commit {sha[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, NO_CANDIDATE, out)
        self.assertEqual(out["counts"]["LANDED_UNDER_ANOTHER_SHA"], 1)
        self.assertEqual(out["counts"]["CANDIDATE"], 0)

    def test_a_hex_token_that_is_not_a_commit_here_is_not_a_candidate(self):
        """Egy MASIK repo hashe (tipikusan Delta-CRM) nem hianyzo munka."""
        self.commit("alap")
        self.card("dddddddd", "kesz, a Delta-CRM oldalan: b53a0836ff11")
        rc, out = self.run_tool()
        self.assertEqual(rc, NO_CANDIDATE, out)
        self.assertEqual(out["counts"]["NAMES_NO_KNOWN_COMMIT"], 1)
        self.assertEqual(out["counts"]["CANDIDATE"], 0)

    def test_card_id_is_not_a_commit(self):
        """A 8 hexkarakteres kartya-id NEM commit -- ez vitte a naiv merot 99%-ra."""
        self.commit("alap")
        self.card("eeeeeeee", "lasd meg a ff00ff00 kartyat")
        self.card("ff00ff00", "egy masik kartya")
        rc, out = self.run_tool()
        self.assertEqual(rc, NO_CANDIDATE, out)
        self.assertEqual(out["counts"]["NAMES_NO_COMMIT"], 2, out)

    def test_the_same_commit_in_two_lengths_is_reported_once(self):
        self.commit("alap")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        sha = self.commit("csak az agon")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("11111111", f"a commit {sha[:7]}, teljesen: {sha[:12]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, CANDIDATE_FOUND, out)
        self.assertEqual(len(out["candidates"][0]["shas"]), 1, out["candidates"])

    def test_any_landed_sha_clears_the_card(self):
        """Egy kartya MAS emberek commitjait is idezi -- ha BARMELYIK leszallt, nem jelolt."""
        landed = self.commit("az en munkam")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        idegen = self.commit("valaki mase, sosem olvadt be")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("22222222", f"az enyem {landed[:8]}, hivatkozas: {idegen[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, NO_CANDIDATE, out)
        self.assertEqual(out["counts"]["LANDED"], 1)

    # --- a komment is szoveg, nem csak a leiras ---------------------------------------

    def test_a_sha_named_only_in_a_comment_is_found(self):
        self.commit("alap")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        sha = self.commit("csak kommentben nevezve")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("33333333", "a leirasban nincs hash")
        c = sqlite3.connect(self.db)
        c.execute("insert into kanban_comments values (?,?,?,?,?)",
                  (1, "33333333", "friday", f"kesz, commit {sha[:8]}", 0))
        c.commit()
        c.close()
        rc, out = self.run_tool()
        self.assertEqual(rc, CANDIDATE_FOUND, out)

    # --- az allapotfajl: a VALTOZAS a hir, nem a lista ---------------------------------

    def test_state_file_reports_once_and_then_stays_quiet(self):
        self.commit("alap")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        sha = self.commit("sosem olvadt be")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("44444444", f"commit {sha[:8]}")
        state = os.path.join(self.root, "state.json")
        self.assertEqual(self.run_tool("--state", state)[0], CANDIDATE_FOUND)
        self.assertEqual(self.run_tool("--state", state)[0], NO_CANDIDATE)
        # ES EGY UJ JELOLT UJRA MEGSZOLAL -- kulonben az elnemitas orokre szol
        git(self.repo, "checkout", "-q", "oldalag")
        sha2 = self.commit("egy masodik, szinten kint")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("55555555", f"commit {sha2[:8]}")
        self.assertEqual(self.run_tool("--state", state)[0], CANDIDATE_FOUND)

    # --- a bemenet, ami nem olvashato, NEM ugyanaz, mint "nincs jelolt" ----------------

    def test_a_missing_db_is_2_not_0(self):
        self.commit("alap")
        p = subprocess.run([sys.executable, SCRIPT, "--db", os.path.join(self.root, "nincs.db"),
                            "--repo", self.repo, "--trunk", "trunk"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, UNREADABLE, p.stdout + p.stderr)

    def test_an_unknown_trunk_ref_is_2_not_0(self):
        self.commit("alap")
        p = subprocess.run([sys.executable, SCRIPT, "--db", self.db, "--repo", self.repo,
                            "--trunk", "nincs-ilyen-ag"], capture_output=True, text=True)
        self.assertEqual(p.returncode, UNREADABLE, p.stdout + p.stderr)

    # --- es a nulla, aminek nincs kontrollja, nem allitas ------------------------------

    def test_zero_candidates_says_the_negative_leg_was_never_exercised(self):
        sha = self.commit("minden rendben")
        self.card("66666666", f"commit {sha[:8]}")
        p = subprocess.run([sys.executable, SCRIPT, "--db", self.db, "--repo", self.repo,
                            "--trunk", "trunk"], capture_output=True, text=True)
        self.assertEqual(p.returncode, NO_CANDIDATE, p.stdout + p.stderr)
        self.assertIn("EGYSZER SEM mondott nemet", p.stdout)


    # --- A SZIGORU SZABALY KULONBSEGE, KULON OSZLOPBAN (didi merese 2026-09-11) ----------
    #
    # didi megmerte a teljes tablan, amit en meretlennek neveztem: a LOOSE szabaly
    # ("barmelyik megnevezett commit landolt -> LANDED") es a SZIGORU ("MINDEN landoljon")
    # 534 kartyan mond mast -- 37% a loose halmazbol. Ez a NEZETELTERES rataja, NEM a
    # szigoru alak hamis-pozitiv rataja: egy `LANDED`, ami mellett all egy nem-landolt SHA,
    # ketfele lehet (idezett idegen commit kontra kint maradt sajat munka), es a kettot csak
    # a kartya elolvasasa valasztja szet.
    #
    # EZERT OSZLOP ES NEM VERDIKT. A ket alabbi teszt pontosan ezt rogziti: a szam megjelenik,
    # a VERDIKT pedig NEM valtozik. Aki a szigorura cserelne a szabalyt, az elso tesztet tori el.

    def test_a_quoted_unlanded_sha_does_not_change_the_verdict(self):
        """A kartya KET commitot nevez: egyik landolt, a masik nem -> a verdikt LANDED marad."""
        landed = self.commit("az en munkam")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        kint = self.commit("valaki mase, sosem olvadt be")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("77777777", f"kesz: {landed[:8]}, es idezem ezt is: {kint[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, NO_CANDIDATE, out)
        self.assertEqual(out["counts"]["LANDED"], 1)
        self.assertEqual(out["counts"]["CANDIDATE"], 0)

    def test_the_same_card_is_counted_as_a_strict_disagreement(self):
        """...ES ugyanaz a kartya megjelenik a szigoru nezetelteres oszlopban."""
        landed = self.commit("az en munkam")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        kint = self.commit("valaki mase, sosem olvadt be")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("88888888", f"kesz: {landed[:8]}, es idezem ezt is: {kint[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(out["strict_disagreement"], 1, out)
        self.assertEqual(out["strict_disagreement_cards"], ["88888888"])

    def test_a_card_whose_every_named_commit_landed_is_no_disagreement(self):
        """KONTROLL: ha MINDEN megnevezett commit a fan van, a ket szabaly EGYETERT."""
        a = self.commit("elso")
        b = self.commit("masodik")
        self.card("99999999", f"kesz: {a[:8]} es {b[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(out["counts"]["LANDED"], 1)
        self.assertEqual(out["strict_disagreement"], 0, out)

    def test_a_candidate_is_not_a_disagreement(self):
        """KONTROLL a MASIK iranyba: ahol EGYIK sem landolt, a ket szabaly szinten EGYETERT."""
        self.commit("alap")
        git(self.repo, "checkout", "-q", "-b", "oldalag")
        kint = self.commit("sosem olvadt be")
        git(self.repo, "checkout", "-q", "trunk")
        self.card("aaaa1111", f"commit {kint[:8]}")
        rc, out = self.run_tool()
        self.assertEqual(rc, CANDIDATE_FOUND, out)
        self.assertEqual(out["strict_disagreement"], 0, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Contract tests for scripts/batch-candidates.py.

EVERY CASE HERE IS A TRAP THE MEASUREMENT ACTUALLY FOUND, not an invented edge. The
numbers behind them are in the script's docblock and on card 0d49c045: three inferred
meters refusing 43% / 5% / 24% of 88 real candidates, and a declared trailer refusing
0% by construction. The tests pin the BOUNDARY between mention and declaration, because
that boundary is the entire reason the script exists.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import importlib
bc = importlib.import_module('batch-candidates')


class Extraction(unittest.TestCase):
    def test_bare_id_in_prose_is_NOT_a_dependency(self):
        # THE WHOLE POINT. A citation reads exactly like a coupling, so only the
        # trailer counts. Inferring from this line is the 43%-refusal meter.
        ids, bad = bc.declared_deps('fix(x): same shape as 3714f235, see also 1c99e33f')
        self.assertEqual(ids, set())
        self.assertEqual(bad, [])

    def test_trailer_is_a_dependency(self):
        ids, bad = bc.declared_deps('fix(x): thing\n\nDepends-On: 3714f235\n')
        self.assertEqual(ids, {'3714f235'})
        self.assertEqual(bad, [])

    def test_trailer_must_start_the_line(self):
        # An indented or mid-sentence mention is QUOTATION, the same rule the kanban
        # VERDIKT convention uses for its own anchor.
        ids, _ = bc.declared_deps('body\n    Depends-On: 3714f235\n')
        self.assertEqual(ids, set())
        ids, _ = bc.declared_deps('we said Depends-On: 3714f235 earlier\n')
        self.assertEqual(ids, set())

    def test_one_trailer_may_list_several(self):
        ids, _ = bc.declared_deps('x\n\nDepends-On: 3714f235, 1c99e33f\n')
        self.assertEqual(ids, {'3714f235', '1c99e33f'})

    def test_several_trailers(self):
        ids, _ = bc.declared_deps('x\n\nDepends-On: 3714f235\nDepends-On: 1c99e33f\n')
        self.assertEqual(ids, {'3714f235', '1c99e33f'})

    def test_trailer_name_is_case_insensitive(self):
        ids, _ = bc.declared_deps('x\n\ndepends-on: 3714f235\n')
        self.assertEqual(ids, {'3714f235'})

    def test_malformed_trailer_is_REPORTED_not_dropped(self):
        # The first version of the function returned a bare set and swallowed this
        # line. A hole in the net that reports as clean is the failure mode the whole
        # script is against, so it must surface.
        ids, bad = bc.declared_deps('x\n\nDepends-On: the phone normaliser card\n')
        self.assertEqual(ids, set())
        self.assertEqual(bad, ['Depends-On: the phone normaliser card'])

    def test_nine_hex_is_not_a_card_id(self):
        # A short SHA is longer; the 8-hex word boundary is what keeps them apart.
        ids, bad = bc.declared_deps('x\n\nDepends-On: 3714f2350\n')
        self.assertEqual(ids, set())
        self.assertEqual(len(bad), 1)


class Classify(unittest.TestCase):
    FRESH, OLD, MAX = 1.0, 30.0, 7.0

    def test_own_card_done_and_no_deps_is_eligible(self):
        v, _ = bc.classify('fix/e52985ed-x', 'done', {}, self.FRESH, self.MAX)
        self.assertEqual(v, bc.ELIGIBLE)

    def test_own_card_open_refuses(self):
        v, why = bc.classify('fix/e52985ed-x', 'testing', {}, self.FRESH, self.MAX)
        self.assertEqual(v, bc.OWN_OPEN)
        self.assertEqual(why, ['e52985ed=testing'])

    def test_branch_without_slug_is_not_considered(self):
        v, _ = bc.classify('didi-pair', None, {}, self.FRESH, self.MAX)
        self.assertEqual(v, bc.NO_OWN_CARD)

    def test_the_named_condition_this_script_was_built_for(self):
        # fix/e52985ed-unaccent-index-parity depends on 3714f235, which was `testing`
        # on 2026-09-12. Own card `done`, so every earlier rule let it through.
        v, why = bc.classify('fix/e52985ed-unaccent-index-parity', 'done',
                             {'3714f235': 'testing'}, self.FRESH, self.MAX)
        self.assertEqual(v, bc.DEP_OPEN)
        self.assertEqual(why, ['3714f235=testing'])

    def test_dependency_done_passes(self):
        v, _ = bc.classify('fix/e52985ed-x', 'done', {'3714f235': 'done'},
                           self.FRESH, self.MAX)
        self.assertEqual(v, bc.ELIGIBLE)

    def test_unresolvable_declared_id_FAILS_CLOSED(self):
        # In an INFERRED token a non-match is noise. In a DECLARATION the author meant
        # a card, so a typo must refuse -- passing it is the partial net again.
        v, why = bc.classify('fix/e52985ed-x', 'done', {'deadbeef': None},
                             self.FRESH, self.MAX)
        self.assertEqual(v, bc.DEP_UNKNOWN)
        self.assertEqual(why, ['deadbeef'])

    def test_malformed_trailer_refuses_even_with_clean_deps(self):
        v, why = bc.classify('fix/e52985ed-x', 'done', {'3714f235': 'done'},
                             self.FRESH, self.MAX, malformed=['Depends-On: the card'])
        self.assertEqual(v, bc.DEP_UNKNOWN)
        self.assertIn('olvashatatlan: Depends-On: the card', why)

    def test_stale_branch_refuses_before_dependencies_are_read(self):
        v, _ = bc.classify('fix/e52985ed-x', 'done', {'3714f235': 'testing'},
                           self.OLD, self.MAX)
        self.assertEqual(v, bc.STALE)

    def test_age_filter_can_be_switched_off(self):
        v, _ = bc.classify('fix/e52985ed-x', 'done', {}, self.OLD, None)
        self.assertEqual(v, bc.ELIGIBLE)


class Slug(unittest.TestCase):
    def test_reads_the_card_from_the_branch_name(self):
        self.assertEqual(bc.own_card('fix/1c99e33f-formula-validation'), '1c99e33f')
        self.assertEqual(bc.own_card('design/5c9aac65-token-reconnect'), '5c9aac65')

    def test_integration_and_bare_names_have_none(self):
        self.assertIsNone(bc.own_card('integration/2026-09-12-midday'))
        self.assertIsNone(bc.own_card('didi-pair'))
        self.assertIsNone(bc.own_card('fix/nothex12-thing'))


if __name__ == '__main__':
    unittest.main(verbosity=2)

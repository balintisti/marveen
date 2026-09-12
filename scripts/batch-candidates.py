#!/usr/bin/env python3
"""Which branches may enter a shipping batch -- as a PREDICATE, not a remembered list.

WHY THIS EXISTS. The batch rule lived only in prose and was re-derived by hand every
time a batch was composed. didi measured the same shape once before for the kanban
VERDIKT convention: a rule that only exists as prose is re-invented, slightly
differently, by each reader. This is that rule in code.

THE RULE HAS TWO HALVES AND ONLY THE FIRST WAS EVER MECHANICAL:

  1. the branch's OWN card is `done`               -- derived from the branch slug
  2. nothing the branch DEPENDS ON is still open   -- and this half had no mechanism

The second half is the one that bit us: a branch whose own card is `done` can carry
work whose sibling card is still `testing`, and shipping it puts open work on main.

WHY THE COUPLING MUST BE DECLARED AND NOT INFERRED (marveen measured 2026-09-12, on
dexter's proposal, card 0d49c045). The obvious mechanism is to read 8-hex card ids out
of the commit messages in `main..branch`. It finds the real case -- and it is a WALL.
Measured on 88 real candidates (own card `done`, tip < 7 days, not on main):

    bare 8-hex over the whole range ..... refuses 38/88 (43%)
    branch-UNIQUE commits ............... refuses  4/88 ( 5%)  <- control kills it
    --first-parent --no-merges .......... refuses 21/88 (24%)  <- control clean
    anchored `Card <id>` form ........... 44% -> 45%, no rescue

The 5% variant looks best and is the worst: average own-commit count 0.8, because
"unreachable from any other branch" silently excludes everything already sitting in an
integration branch. It passes VACUOUSLY. Under `--first-parent` no branch measures
empty (0 of 88, average 2.7), so that is the honest inferred meter -- and it still
blocks one candidate in four.

THE REASON NO EXTRACTION RULE CAN WORK: a bare id measures MENTION, the predicate needs
DEPENDENCY, and we cite cards for context constantly ("same shape as X"). The two are
written identically. And the 43% meter would have refused the 2026-09-12 midday batch,
which was measurably green -- a gate that refuses a green batch is a wall.

So the signal is OPT-IN and TYPED: a `Depends-On:` trailer. A citation never writes
one, so the false-refusal rate is zero by construction. The name was measured before it
was chosen (last 400 commits of Delta-CRM): Depends-On 0, Blocked-By 0, Requires 7,
Refs: 37, and Co-Authored-By 964 as the positive control that the meter sees trailers
at all. The namespace was free and the habit already exists.

THE COST, SAID OUT LOUD, BECAUSE IT IS THE OPPOSITE TRADE: a declared signal
UNDER-refuses. A branch whose author forgets the trailer passes. That direction is
deliberate: a batch is re-measured on the seam regardless, so an over-refusing gate
costs real work while an under-refusing one costs a seam run we were going to pay for.

AND THE COVERAGE NUMBER SHIPS WITH THE VERDICT, NOT UNDER IT. dexter's sentence is the
reason: "a partial net that looks total is worse than none". If two candidates out of
ninety declared anything, the clean verdict means almost nothing, and the reader has to
see that in the same breath as the verdict -- not in a footnote they may not open.

USAGE
    python3 scripts/batch-candidates.py --repo /path/to/repo [--main main]
                                        [--max-age-days 7] [--json]
"""
import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time

DB = '/Users/isti/marveen/store/claudeclaw.db'

# A branch slug names its own card: `fix/1c99e33f-formula-validation-fail-open`.
SLUG = re.compile(r'^(?:fix|feat|test|chore|docs|design|def|probe|refactor|perf|build|ci)/'
                  r'([0-9a-f]{8})-')
# LINE-ANCHORED. A `Depends-On:` inside prose is not a declaration, and the anchor is
# what separates this from the mention-counting meters the docblock rejects.
# CAPTURES THE WHOLE LINE, not just the value: when a declaration is malformed the
# reader has to find it again, and a full line is greppable while a fragment is not.
TRAILER = re.compile(r'^(Depends-On:\s*.+?)\s*$', re.M | re.I)
HEX8 = re.compile(r'\b[0-9a-f]{8}\b')

ELIGIBLE, NO_OWN_CARD, OWN_OPEN, STALE, DEP_OPEN, DEP_UNKNOWN = (
    'ELIGIBLE', 'NO_OWN_CARD', 'OWN_CARD_OPEN', 'STALE', 'DEPENDENCY_OPEN',
    'DEPENDENCY_UNRESOLVED')


def own_card(branch):
    """The card id a branch names in its own slug, or None."""
    m = SLUG.match(branch)
    return m.group(1) if m else None


def declared_deps(bodies):
    """Card ids declared via `Depends-On:` trailers. One trailer may list several.

    Returns (ids, malformed) -- and the second half is not decoration. A
    `Depends-On:` line carrying no 8-hex token at all is a MALFORMED DECLARATION, and
    dropping it silently would rebuild the exact failure this whole script exists to
    avoid: a net with a hole in it that reports as clean. The author wrote the trailer,
    so they meant a dependency; if we cannot read it, we refuse rather than pass.
    (Found by writing the test, not by reading the code -- the first version returned a
    bare set and swallowed these.)
    """
    ids, malformed = set(), []
    for line in TRAILER.findall(bodies or ''):
        found = HEX8.findall(line)
        if found:
            ids.update(found)
        else:
            malformed.append(line.strip())
    return ids, malformed


def card_declared_deps(description):
    """Dependencies declared on the CARD, not in a commit.

    TWO SITES, ONE TOKEN, and the reason is measured. The commit trailer is the durable
    form, but it only exists once someone writes a commit -- and the coupling is usually
    known BEFORE that, at the moment the cards are split. The card description is where
    it actually gets written: dexter put `*** CSATOLT KARTYA -- NE MOZGASD EGYEDUL ***`
    as the first line of both coupled cards on 2026-09-12, and that banner is correct
    and load-bearing FOR A HUMAN -- the person moving a card reads the description.

    It is invisible to a parser, which is the same split the rulebook already records
    for `workcheck.json`: the card keeps the reason for the human, and a machine-shaped
    line carries it for the tool. So the banner stays and a `Depends-On:` line is added
    beside it, rather than the parser learning to read prose -- a prose detector is the
    false-positive family this fleet has stopped eight times.
    """
    return declared_deps(description)


def classify(branch, own_status, dep_status, age_days, max_age_days, malformed=()):
    """The predicate itself. Pure, so the tests do not need a repo or a database.

    `own_status` is the branch's own card status or None; `dep_status` maps each
    DECLARED dependency id to its status, or to None when no such card exists.
    """
    if own_status is None:
        return NO_OWN_CARD, []
    if own_status != 'done':
        return OWN_OPEN, [own_card(branch) + '=' + own_status]
    if max_age_days is not None and age_days > max_age_days:
        return STALE, ['%.1f nap' % age_days]
    # FAIL-CLOSED on a typo. With an inferred token an unresolvable id is noise; in a
    # DECLARATION the author meant a card, so passing it silently is the partial net.
    unknown = sorted(i for i, s in dep_status.items() if s is None)
    if unknown or malformed:
        return DEP_UNKNOWN, unknown + ['olvashatatlan: ' + m for m in malformed]
    open_ = sorted('%s=%s' % (i, s) for i, s in dep_status.items() if s != 'done')
    if open_:
        return DEP_OPEN, open_
    return ELIGIBLE, []


def _git(repo, *args):
    r = subprocess.run(['git', '-C', repo] + list(args),
                       capture_output=True, text=True)
    return r.stdout


def _is_ancestor(repo, a, b):
    return subprocess.run(['git', '-C', repo, 'merge-base', '--is-ancestor', a, b],
                          capture_output=True).returncode == 0


def load_cards():
    con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    rows = list(con.execute('select id, status, description from kanban_cards'))
    return ({r[0][:8]: r[1] for r in rows},
            {r[0][:8]: (r[2] or '') for r in rows})


def scan(repo, main, max_age_days, cards, descriptions=None):
    descriptions = descriptions or {}
    main_sha = _git(repo, 'rev-parse', main).strip()
    if not main_sha:
        raise SystemExit('NEM MERHETO: a `%s` ref nem oldodik fel a %s repoban' % (main, repo))
    rows = []
    now = time.time()
    listing = _git(repo, 'for-each-ref',
                   '--format=%(refname:short)\t%(objectname)\t%(committerdate:unix)',
                   'refs/heads/')
    for line in listing.strip().split('\n'):
        if not line:
            continue
        name, sha, when = line.split('\t')
        if name == main or name.startswith(('integration/', 'develop')):
            continue
        if _is_ancestor(repo, sha, main_sha):
            continue                       # already shipped
        oc = own_card(name)
        bodies = _git(repo, 'log', '--first-parent', '--no-merges', '--format=%B',
                      main_sha + '..' + sha)
        deps, malformed = declared_deps(bodies)
        # The card is the SECOND declaration site -- see card_declared_deps. A coupling
        # is usually known when the cards are split, which is before any commit exists.
        if oc and oc in descriptions:
            cd, cm = card_declared_deps(descriptions[oc])
            deps |= cd
            malformed += cm
        dep_status = {d: cards.get(d) for d in deps}
        verdict, why = classify(name, cards.get(oc) if oc else None, dep_status,
                                (now - int(when)) / 86400.0, max_age_days, malformed)
        rows.append({'branch': name, 'sha': sha[:9], 'own_card': oc,
                     'verdict': verdict, 'why': why, 'declared': sorted(deps)})
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--repo', required=True)
    p.add_argument('--main', default='main')
    p.add_argument('--max-age-days', type=float, default=7.0)
    p.add_argument('--json', action='store_true')
    a = p.parse_args()
    if not os.path.isdir(a.repo):
        raise SystemExit('NEM MERHETO: nincs ilyen konyvtar: %s' % a.repo)
    cards, descriptions = load_cards()
    rows = scan(a.repo, a.main, a.max_age_days, cards, descriptions)
    considered = [r for r in rows if r['verdict'] != NO_OWN_CARD]
    declared = [r for r in considered if r['declared']]
    elig = [r for r in considered if r['verdict'] == ELIGIBLE]
    cov = (100.0 * len(declared) / len(considered)) if considered else 0.0
    if a.json:
        print(json.dumps({'eligible': [r['branch'] for r in elig],
                          'rows': rows,
                          'coverage_declared': len(declared),
                          'coverage_denominator': len(considered)}, indent=2))
        return
    for r in sorted(rows, key=lambda x: (x['verdict'], x['branch'])):
        if r['verdict'] == NO_OWN_CARD:
            continue
        print('  %-22s %-46s %s' % (r['verdict'], r['branch'][:46],
                                    ', '.join(r['why'])))
    # THE COVERAGE STANDS BESIDE THE VERDICT, NOT UNDER IT. A clean result over two
    # declarations in ninety branches is not a clean result, and the reader must not
    # have to open a footnote to learn that.
    print('\n  FELVEHETO: %d / %d' % (len(elig), len(considered)))
    print('  LEFEDETTSEG: %d jelolt deklaralt `Depends-On:` trailert a %d-bol (%.0f%%)'
          % (len(declared), len(considered), cov))
    if cov < 10:
        print('  FIGYELEM: a lefedettseg ennyire alacsony, hogy a tiszta verdikt '
              'keveset allit -- reszleges halo, ami teljesnek latszik.')


if __name__ == '__main__':
    main()

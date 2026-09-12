#!/usr/bin/env python3
"""Ask of every CLOSED card whether the commit it names actually reached the trunk. Card 7eb6a490.

Stdlib only. Read-only against store/claudeclaw.db and the git repo; writes nothing but a
--state file.

WHY THIS EXISTS, AND WHY IT REPORTS INSTEAD OF BLOCKING. Measured 2026-08-25 (card b53a0836):
65 commits were nowhere on the Delta-CRM line, and 21 of them sat under cards the board calls
DONE and VERIFIED. `done` here means the work AND its review are finished -- it has never meant
shipped, and that is correct. The gap is that a closed card LEAVES the field of view, and after
that nothing asks whether its commit landed. Twenty-one commits sat on that for three to five
days. Isti approved the proposal on 2026-08-25 08:44.

WHY NOT THE HARD GATE THE CARD ORIGINALLY ASKED FOR ("not on the trunk -> waiting, not done"):
the pre-measurement this card demanded BEFORE implementation says the naive form cannot carry
that weight. Measured 2026-09-11 on 342 marveen-project `done` cards:

    names a REAL, existing commit ....... 266 (78%)   -- so the mechanism can fire at all
    of those, the SHA is on the tree .... 254 (95%)
    NOT on the tree ..................... 12  (5%)    -- a gate, not a wall
    of those 12, the SUBJECT is on the tree under a DIFFERENT SHA ... 5

Five of twelve is a 42% false positive rate on the naive question, and the direction is the
worse one: it manufactures work on a finished card, and after a few rounds nobody believes the
gate. The rulebook's rule for a detector above ~50% is to report the DETECTOR rather than the
number. So this tool answers the question and names the candidates; moving a card is a human
decision, and turning it into a blocking gate is a policy decision for the coordinator.

WHY TWO LEGS AND NOT ONE. Ancestry is NECESSARY but not SUFFICIENT: after a rebase or a
re-created branch the work is on the trunk under a different hash, and the card still quotes the
old one. So a NEGATIVE ancestry result is confirmed against a second leg -- the commit SUBJECT
-- before the card is named. Measured: the second leg clears 5 of the 12, leaving 7 (2.6% of 266).

WHY SUBJECT AND NOT PATCH-ID: patch-id was measured unreliable here on 2026-08-23, and a rebase
across a moved context changes it. The subject survives cherry-pick and rebase alike.

WHAT THE SECOND LEG DOES NOT PROVE, stated because it is a proxy too: two different commits can
carry the same subject, and work that truly never shipped but was later REWRITTEN under a new
subject still reads as a candidate. The remaining set is therefore CANDIDATES, not findings.

WHY THE CARD-ID EXCLUSION IS NOT COSMETIC. Our card ids are 8 hex characters, so a bare
`[0-9a-f]{7,40}` census counts card ids as commits. Measured: that form answered 99%; the real
figure after excluding card ids AND requiring the object to exist is 78%. A meter whose error
looks exactly like a healthy answer.

WHY A CARD COUNTS AS LANDED IF ANY named commit landed. Cards quote other people's commits and
upstream hashes that will never be on our trunk; requiring every named SHA would flag those. The
conservative form -- candidate only when NOTHING it names reached the trunk -- is the one the
pre-measurement used, and its numbers are the ones above.

Usage:
  python3 scripts/landed-check.py                     -- report, exit 3 if any candidate
  python3 scripts/landed-check.py --json              -- machine-readable
  python3 scripts/landed-check.py --control           -- self-check of both meters
  python3 scripts/landed-check.py --project delta-crm --repo /path --trunk origin/main
  python3 scripts/landed-check.py --state FILE        -- print only when the candidate set CHANGES

Exit codes:  0 = no candidate   3 = at least one candidate   2 = input unreadable
             4 = the candidate set could not be established (meter did not discriminate)
"""
import argparse, json, os, re, sqlite3, subprocess, sys

DB = '/Users/isti/marveen/store/claudeclaw.db'
REPO = '/Users/isti/marveen'
HEX = re.compile(r'\b[0-9a-f]{7,40}\b')

LANDED, OTHER_SHA, CANDIDATE, NO_REF, SHA_UNKNOWN = (
    'LANDED', 'LANDED_UNDER_ANOTHER_SHA', 'CANDIDATE', 'NAMES_NO_COMMIT', 'NAMES_NO_KNOWN_COMMIT')


def git(repo, *args):
    r = subprocess.run(['git'] + list(args), cwd=repo, capture_output=True, text=True)
    return r.returncode, r.stdout


def is_commit(repo, sha):
    return subprocess.run(['git', 'cat-file', '-e', sha + '^{commit}'],
                          cwd=repo, capture_output=True).returncode == 0


def is_ancestor(repo, sha, trunk):
    return subprocess.run(['git', 'merge-base', '--is-ancestor', sha, trunk],
                          cwd=repo, capture_output=True).returncode == 0


def out_of_scope_counts(db, project):
    """Hany `done` kartya esik a MERT projekten KIVUL, es mennyi belőlük MERHETETLEN.

    UGYANAZON A POPULACION szamol, mint a `load_cards` (`status='done'`, az archivaltakat
    IS beleertve) -- kulonben a ket szam KET NEVEZORE vonatkozna, es a kulonbseguk
    ertelmezhetetlen lenne. Ez a fajl mashol is ezt a hibat rogziti.

    A `projectless` NEM esik ki a populaciobol: a `load_cards` URES project eseten
    `where = 'status=?'`-re valt, tehat egy `--project ''` futas BELEERTI oket, megszamolja
    es oszinte aranyt ad rajuk. Amit NEM lehet, az a REPO MEGVALASZTASA: project nelkul
    nincs mihez kotni a `--repo`-t, tehat AHHOZ a fahoz merodnek, amit az adott futas
    hasznalt.

    A KET ALLITAS KULON: BENNE VAN-E a merésben (igen) es VALASZTHATO-E hozza fa (nem).
    Az elso alakomban ezek ossze voltak mosva -- didi vonta vissza a sajat allitasat es
    az enyemet is, 2026-09-12 04:28 (kartya 7eb6a490, 22. komment). Merve: a nem-szukitett
    futasban a nem-marveen populaciobol 39 kartya LANDED-kent oldodik fel (314 - 275),
    tehat a „merhetetlen" atalanyban tul eros volt.
    """
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    total = c.execute("select count(*) from kanban_cards where status='done'").fetchone()[0]
    none_proj = c.execute(
        "select count(*) from kanban_cards where status='done'"
        " and (project is null or trim(project)='')").fetchone()[0]
    in_scope = total if not project else c.execute(
        "select count(*) from kanban_cards where status='done' and project=?",
        (project,)).fetchone()[0]
    c.close()
    return total - in_scope, none_proj


def load_cards(db, project):
    """A `done` kartyak, a szovegukkel EGYUTT -- leiras + MINDEN komment.

    A zaro komment ONMAGABAN nem eleg: a commit-hash gyakran egy korabbi jelentesben all,
    es a lezaras csak hivatkozik ra. Merve: a szukitett alak a 266-bol 90 ala vinne.
    """
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    ids = {r[0] for r in c.execute('select id from kanban_cards')}
    where = 'status=? and project=?' if project else 'status=?'
    args = ('done', project) if project else ('done',)
    cards = []
    for cid, title, desc, proj in c.execute(
            f'select id, title, description, project from kanban_cards where {where}', args):
        body = ' '.join([title or '', desc or ''] +
                        [r[0] or '' for r in c.execute(
                            'select content from kanban_comments where card_id=?', (cid,))])
        # A PROJECT AZERT UTAZIK EGYUTT A KARTYAVAL, mert ez a mero EGY REPOT mer, es egy
        # MASIK repo kartyaja itt szerkezetileg merhetetlen -- nem hibas. Lasd a
        # `unresolved_by_project` oszlopot lentebb.
        cards.append((cid, title or '', body, proj or ''))
    return cards, ids


def trunk_subjects(repo, trunk):
    rc, out = git(repo, 'log', '--format=%s', trunk)
    return (set(out.splitlines()), rc)


def classify(repo, trunk, subjects, body, card_ids):
    """HAROM allapot, es a harmadik nem a masodik gyengebb valtozata.

    A `NAMES_NO_KNOWN_COMMIT` NEM azt mondja, hogy a munka nem szallt le -- azt mondja, hogy
    EBBEN a repoban nincs ilyen objektum (tipikusan egy Delta-CRM hash egy marveen kartyan,
    vagy egy amend utan eltunt hash). Egy kapu, ami ezt a `CANDIDATE`-tel osszevonja, a
    MASIK repo munkajat jelentene hianyzonak.
    """
    toks = [t for t in dict.fromkeys(HEX.findall(body)) if t not in card_ids]
    if not toks:
        return NO_REF, [], []
    # DEDUPE A TELJES SHA-N, NEM A LEIRT ALAKON. Egy kartya ugyanazt a commitot gyakran ket
    # hosszban idezi (`92465f5` es `92465f54`), es a jelentesben ketszer jelent meg -- ket
    # hianyzo commitnak latszott ott, ahol egy van.
    shas, seen = [], set()
    for t in toks:
        if not is_commit(repo, t):
            continue
        full = git(repo, 'rev-parse', t + '^{commit}')[1].strip() or t
        if full not in seen:
            seen.add(full)
            shas.append(t)
    if not shas:
        return SHA_UNKNOWN, [], []
    # A VERDIKT VALTOZATLAN (barmelyik landolt -> LANDED). Ami valtozott: NEM terunk vissza az
    # ELSO landolt SHA-nal, mert akkor a tobbirol semmit nem tudnank -- es epp az a kulonbseg,
    # amit a SZIGORU szabaly ("MINDEN megnevezett landoljon") mer. Lasd a `strict` oszlopot.
    landed, missing = [], []
    for s in shas:
        (landed if is_ancestor(repo, s, trunk) else missing).append(s)
    if landed:
        return LANDED, missing, landed
    for s in missing:
        rc, subj = git(repo, 'log', '-1', '--format=%s', s)
        if rc == 0 and subj.strip() and subj.strip() in subjects:
            return OTHER_SHA, missing, landed
    return CANDIDATE, missing, landed


def control(repo, trunk, subjects):
    """A KET MERO ONELLENORZESE, es KULON mondja ki, melyik iranyt NEM probalta ki.

    A targy-lab mindket iranyba probalhato ingyen. Az OSSODES-lab pozitiv iranya szinten
    (a trunk csucsa onmaga ose), a NEGATIV irany viszont ADATFUGGO: ha a fan minden megnevezett
    commit rajta van, nincs mivel bizonyitani, hogy a mero tud nemet mondani. Ilyenkor ezt
    KIIRJUK, nem hallgatjuk el -- egy nulla, aminek nincs kontrollja, nem allitas.
    """
    rc, tip = git(repo, 'rev-parse', trunk)
    tip = tip.strip()
    lines, ok = [], True
    pos = bool(tip) and is_ancestor(repo, tip, trunk)
    lines.append(f'  ossodes-lab, POZITIV (a csucs onmaga ose) ... {"OK" if pos else "BUKOTT"}')
    ok &= pos
    rc, subj = git(repo, 'log', '-1', '--format=%s', trunk)
    sp = subj.strip() in subjects
    sn = 'nincs-ilyen-targy-' + '0' * 12 not in subjects
    lines.append(f'  targy-lab, POZITIV (a csucs targya a halmazban) ... {"OK" if sp else "BUKOTT"}')
    lines.append(f'  targy-lab, NEGATIV (kitalalt targy NINCS benne) ... {"OK" if sn else "BUKOTT"}')
    ok &= sp and sn
    lines.append(f'  a trunk targy-halmaza: {len(subjects)} sor')
    return ok, lines


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--db', default=DB)
    ap.add_argument('--repo', default=REPO)
    ap.add_argument('--trunk', default='HEAD')
    ap.add_argument('--project', default='marveen')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--control', action='store_true')
    ap.add_argument('--state', default=None)
    a = ap.parse_args()

    # A `--project` ALAPERTELMEZESE NEM VALASZTAS, ES EDDIG UGY NEZETT KI (didi merte
    # 2026-09-12). Kapcsolo nelkul futtatva a kimenet `marveen`-t irt, mintha valaki
    # azt kerte volna -- a szerszam egy HATOKORT allitott, amit senki nem valasztott.
    # Ugyanaz az alak, amit ez a fajl mashol mar rogzit: egy szam a nevezoje nelkul.
    project_explicit = any(x == '--project' or x.startswith('--project=')
                           for x in sys.argv[1:])

    if not os.path.exists(a.db):
        print(f'a tabla nem olvashato: {a.db}', file=sys.stderr)
        return 2
    if git(a.repo, 'rev-parse', a.trunk)[0] != 0:
        print(f'a trunk-ref nem letezik ebben a repoban: {a.trunk} @ {a.repo}', file=sys.stderr)
        return 2

    subjects, rc = trunk_subjects(a.repo, a.trunk)
    if rc != 0 or not subjects:
        print('a trunk targy-halmaza ures -- a masodik lab nem allithato elo.', file=sys.stderr)
        return 2

    ok, clines = control(a.repo, a.trunk, subjects)
    if a.control:
        print('\n'.join(clines))
        print('KONTROLL:', 'OK' if ok else 'BUKOTT')
        return 0 if ok else 4
    if not ok:
        print('a kontroll ELBUKOTT -- a szam kiadasa megtagadva:', file=sys.stderr)
        print('\n'.join(clines), file=sys.stderr)
        return 4

    cards, card_ids = load_cards(a.db, a.project)
    buckets = {k: [] for k in (LANDED, OTHER_SHA, CANDIDATE, NO_REF, SHA_UNKNOWN)}
    detail = {}
    strict_gap = []
    unresolved_by_project = {}
    cards_by_project = {}
    for cid, title, body, proj in cards:
        cards_by_project[proj] = cards_by_project.get(proj, 0) + 1
        st, missing, landed = classify(a.repo, a.trunk, subjects, body, card_ids)
        if st == SHA_UNKNOWN:
            unresolved_by_project[proj] = unresolved_by_project.get(proj, 0) + 1
        # SZIGORU NEZETELTERES: a LOOSE szabaly szerint LANDED, de NEM minden megnevezett
        # commit van a fan. Ez a ket szabaly kulonbsegenek a SZAMA -- NEM hiba-lista.
        if st == LANDED and missing:
            strict_gap.append((cid, len(landed), len(missing)))
        buckets[st].append(cid)
        if st in (CANDIDATE, OTHER_SHA):
            detail[cid] = {'title': title[:90], 'shas': missing}

    cand = sorted(buckets[CANDIDATE])
    payload = {
        'project': a.project, 'repo': a.repo, 'trunk': a.trunk,
        'done_cards': len(cards),
        'counts': {k: len(v) for k, v in buckets.items()},
        'ancestry_leg_said_no': len(buckets[CANDIDATE]) + len(buckets[OTHER_SHA]),
        # A KET SZABALY KULONBSEGE, KULON OSZLOPBAN ES VERDIKT NELKUL (didi merese 2026-09-11:
        # a teljes tablan 37% a nezetelteres). Azert NEM verdikt, mert egy `LANDED`, ami mellett
        # all egy nem-landolt SHA, KETFELE lehet: a kartya IDEGEN commitot IDEZ (a loose szabaly
        # helyes), vagy a SAJAT munkaja maradt kint (a szigoru lenne helyes). A kettot csak a
        # kartya elolvasasa valasztja szet -- egy automatikus cimke itt proxy lenne.
        'strict_disagreement': len(strict_gap),
        'strict_disagreement_cards': [c for c, _, _ in sorted(strict_gap)],
        # A MERO EGY REPOT MER, ES EZ EDDIG SEHOL NEM ALLT A KIMENETBEN. Egy MASIK repo
        # kartyaja itt `NAMES_NO_KNOWN_COMMIT`-ba esik -- ami LELET-ALAKU, pedig a helyes
        # olvasata "NEM MERHETO ITT". Merve 2026-09-11, `--project ''` mellett: 1242 `done`
        # kartyabol 685 delta-crm, es abbol 633 kerult ebbe a rekeszbe (92%), miközben a
        # marveen szeleten ugyanez 25/345 (7%). Az ARANY a diszkriminator, es a szerszam
        # semmit nem tud a repo-terkeprol: a SZAM mondja meg.
        'unresolved_by_project': {
            k: {'cards': cards_by_project[k], 'unresolved': v,
                'rate': round(v / cards_by_project[k], 3)}
            for k, v in sorted(unresolved_by_project.items())
        },
        'candidates': [{'card': c, **detail[c]} for c in cand],
    }
    if a.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        outside, projectless = out_of_scope_counts(a.db, a.project)
        scope = a.project or '(mind)'
        if not project_explicit:
            scope += ' -- ALAPERTELMEZES, nem valasztas'
        print(f'`done` kartya ({scope}): {len(cards)} | trunk: {a.trunk} @ {a.repo}')
        # ES AMI EZEN A FUTASON KIVUL ESIK -- KULONBEN A SZAM TELJESNEK OLVASODIK.
        # A project NELKULI kartyak nem csak kimaradnak: NEM IS MERHETOK, mert a
        # `--project` egy hozza tartozo `--repo`-t kivan, es egy project nelkuli
        # kartyahoz nincs fa, amihez merni lehetne. Ez a lap "ures project mezo"
        # torvenye, ezen a szerszamon: egy egesz foliens csendben kiesik a fedesbol.
        # KET KULON TENY, NEM RESZHALMAZ. Az elso alakom "{outside} kartya, EBBOL
        # {projectless}"-t irt, es `--project ''` mellett ez "0, ebbol 213"-at adott --
        # a projectlenek ott BENNE vannak a merésben, csak attol meg nem merhetok.
        # Egy reszhalmaz-allitas ket fuggetlen szamra: a cimke lett hamis, nem a szam.
        if outside:
            print(f'  HATOKORON KIVUL: {outside} `done` kartya MAS projekten -- ez a futas'
                  f' nem mond roluk semmit.')
        if projectless:
            print(f'  ES NEM VALASZTHATO HOZZAJUK FA: {projectless} `done` kartya NEM HORDOZ'
                  f' projectet, tehat nincs mihez kotni a `--repo`-t -- ahhoz a fahoz'
                  f' merodnek, amit EZ a futas hasznalt. BENNE VANNAK a nem-szukitett'
                  f" (`--project ''`) futasban; amit nem lehet, az a repo MEGVALASZTASA."
                  f' Ez NEM lelet, hanem a meres hatara.')
        for k in (LANDED, OTHER_SHA, CANDIDATE, SHA_UNKNOWN, NO_REF):
            print(f'  {k:<26} {len(buckets[k])}')
        sg = payload['strict_disagreement']
        print(f'  -- a SZIGORU szabaly ("MINDEN megnevezett commit landoljon") {sg} kartyan')
        print(f'     mondana mast. NEM hiba-lista: egy idezett idegen SHA ugyanigy nez ki,')
        print(f'     mint a kartya sajat, kint maradt munkaja -- a ketto csak olvasassal valik szet.')
        # CSAK TOBB-PROJEKTES FUTASNAL: egy szuk futasnal a bontas onmagat ismetelne, es egy
        # minden korben megjeleno sor par kor utan zaj.
        ubp = payload['unresolved_by_project']
        if len(cards_by_project) > 1:
            print('  -- FELOLDATLAN HASH projektenkent (ez a mero EGY repot mer):')
            for k, v in sorted(ubp.items(), key=lambda kv: -kv[1]['rate']):
                print(f"     {k or '(nincs project)':<14} {v['unresolved']:>4} / {v['cards']:<5}"
                      f" {v['rate']:.0%}")
            print('     Egy majdnem TELJES arany itt nem hanyagsag es nem lelet: azok a')
            print('     kartyak MASIK repo commitjait nevezik meg, tehat ezen a fan NEM')
            print('     MERHETOK. A verdikt es a kilepesi kod valtozatlan.')
        neg = payload['ancestry_leg_said_no']
        print(f'  -- az ossodes-lab {neg} kartyara mondott NEMET; ebbol {len(buckets[OTHER_SHA])}-at'
              f' a targy-lab zart ki (a munka MAS SHA alatt leszallt).')
        if neg == 0:
            print('  FIGYELEM: az ossodes-lab EGYSZER SEM mondott nemet ebben a futasban, tehat a')
            print('  negativ iranya NINCS kiprobalva. A nulla jelolt ezert nem allitas.')
        for c in cand:
            print(f'\n  JELOLT {c} -- {detail[c]["title"]}')
            for s in detail[c]['shas']:
                print(f'     {s}  {git(a.repo, "log", "-1", "--format=%s", s)[1].strip()[:80]}')
        if cand:
            print('\n  JELOLT, NEM LELET: a targy-lab proxy. Mielott barmelyiket `waiting`-be teszed,')
            print('  nezd meg az agat, amit a kartya nevez -- lehet, hogy uj targgyal szallt le.')

    if a.state:
        prev = None
        try:
            prev = json.load(open(a.state, encoding='utf-8')).get('candidates')
        except (OSError, ValueError):
            prev = None
        cur = cand
        changed = prev is None or sorted(prev) != cur
        try:
            json.dump({'candidates': cur}, open(a.state, 'w', encoding='utf-8'))
        except OSError as e:
            print(f'az allapotfajl nem irhato: {e}', file=sys.stderr)
        if not changed:
            return 0

    return 3 if cand else 0


if __name__ == '__main__':
    sys.exit(main())

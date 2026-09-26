#!/usr/bin/env python3
"""safety-core-drift-check.py -- all egyutt-e a SAFETY-CORE sablon es az agens-lapok? (kartya 432df9a5)

CSAK OLVAS. Soha nem ir: se a sablonba, se egy agens-lapra. Az elteres JELENTES, a dontes azé,
aki a kontextust ismeri -- ugyanaz az elv, mint az `installed-drift-check.ts`-nel.

MIERT NEM ELOSZTO (marveen dontese, 2026-09-24, a kartyan): friday merte, hogy a sablon a lapok
MOGOTT allt -- a 09-20-i Telegram-jovahagyasi szakasz (73067c29) 7/7 lapon megvolt, a sablonban
0-szor. Egy sablonbol IRO elosztó tehat pont a legfrissebb szabalyt torolte volna mind a het
lapról, csendben, zold futassal. Ma a LAPOK az elo forras; ez az ellenorzes azt mondja meg, ha a
ketto kozott uj res nyilik, MIELOTT valaki a sablonra epitene.

MIT MER: a sablon minden NEM URES sorat, a helyorzok behelyettesitese UTAN, szo szerint keresi
minden `agents/<n>/CLAUDE.md`-ben. Az agens-lapokat GLOBBAL talalja, nem nevlistabol: egy uj
agens, akinek nincs meg a mag, pont az az eset, amit egy kezzel irt lista kihagyna.

A HELYORZOK: `{{OWNER_NAME}}` es `{{CHAT_ID}}` a repo `.env`-jebol (OWNER_NAME, ALLOWED_CHAT_ID),
`{{INSTALL_DIR}}` a repo gyokere. Az ertekeket SOHA nem irja ki. Ha egy helyorzo feloldatlan
marad, az eredmeny NEM MERT (kilepesi kod 2), nem zold: a behelyettesites hianya volt a 09-19-i
hamis drift-szam oka (marveen, 17213), es egy feloldatlan helyorzo MINDEN lapon hianyt mutatna.

A SZANDEKOS ELTERESEK NEVESITVE ALLNAK LENT, okkal -- es ELLENORIZVE: ha egy kivetel-sor megis
ott van a lapon, a kivetel elavult, es az is elteres. Egy kivetel-lista, amit senki nem mer,
csendben novekszik, amig mindent elnyel.

Kilepesi kod: 0 = nincs elteres | 3 = elteres | 2 = NEM MERT (nincs lap, feloldatlan helyorzo,
olvashatatlan sablon).
"""
import argparse
import glob
import os
import re
import sys

# Agensenkent SZANDEKOS elteres: a sablon-sor, ami a lapon NEM all, es miert.
KNOWN_DEVIATIONS = {
    'dexter': {
        'reason': 'a worktree-kerites dexter lapjan szandekosan at van irva (09-19, marveen ellenorizte)',
        'lines': [
            '`git checkout -b <új> origin/main` EGYÜTT beállít egy upstreamet. SHA-val nem:',
            'git worktree add ../marveen-wt-<topic> -b <branch> "$(git rev-parse HEAD)"',
            'git branch --unset-upstream <branch>       # ha mar letrejott rosszul',
            'cp -Rc node_modules ../marveen-wt-<topic>/ # KLONOZD, NE symlinkeld (lasd lentebb)',
        ],
    },
}

PLACEHOLDER_RX = re.compile(r'\{\{[A-Z_]+\}\}')


def read_env(path):
    out = {}
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def render(template, env, root):
    chat = (env.get('ALLOWED_CHAT_ID') or '').split(',')[0].strip()
    values = {
        '{{OWNER_NAME}}': env.get('OWNER_NAME', ''),
        '{{CHAT_ID}}': chat,
        '{{INSTALL_DIR}}': root,
        '{{PROJECT_ROOT}}': root,
    }
    for k, v in values.items():
        if v:
            template = template.replace(k, v)
    return template


def spans(template_lines, page_lines):
    """Where the template sits on the page: a list of (page_start, length) runs, in template order.

    Greedy longest-run matching by POSITION, not `list.index`: the first version of this
    measurement used `index()`, which returns the FIRST occurrence, and on repeated lines
    (code fences) it said "scattered" even for a page holding the template in one block.
    On a tie the run that CONTINUES after the previous one wins: a stray copy of a template line
    higher up the page (a code fence, a heading quoted elsewhere) must not pull the block open."""
    n, j, out, prev_end = len(template_lines), 0, [], 0
    while j < n:
        best, at = 0, None
        for i in range(len(page_lines)):
            k = 0
            while i + k < len(page_lines) and j + k < n and page_lines[i + k] == template_lines[j + k]:
                k += 1
            in_order = i >= prev_end
            if k > best or (k == best and k > 0 and in_order and (at is None or at < prev_end)):
                best, at = k, i
        if best:
            out.append((at, best))
            prev_end = at + best
            j += best
        else:
            j += 1
    return out


def interior(page_lines, runs):
    """Page lines INSIDE the template's block that belong to no run -- text inserted into the core.

    The first version trusted only runs of 3+ lines as the block's edges, and its own test showed
    the cost: a section inserted near the END of the template leaves a short tail run, and the
    cutoff made exactly that insertion invisible. The tie-break in `spans` is what keeps stray
    matches out instead."""
    if len(runs) < 2:
        return []
    covered = set()
    for a, k in runs:
        covered.update(range(a, a + k))
    lo = min(a for a, _ in runs)
    hi = max(a + k for a, k in runs)
    return [page_lines[i] for i in range(lo, hi) if i not in covered]


def main(argv=None):
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description='Read-only drift check: SAFETY-CORE template vs agent pages.')
    ap.add_argument('--root', default=here, help='repo root (default: the tree this script is in)')
    ap.add_argument('--template', default=None,
                    help='template file to compare (default: <root>/templates/SAFETY-CORE.template); '
                         'for checking a changed template in a worktree against the live pages')
    args = ap.parse_args(argv)
    root = args.root

    tpath = args.template or os.path.join(root, 'templates', 'SAFETY-CORE.template')
    try:
        raw = open(tpath, encoding='utf-8').read()
    except OSError as e:
        print(f'NEM MERT: a sablon olvashatatlan ({tpath}: {e.strerror})')
        return 2
    rendered = render(raw, read_env(os.path.join(root, '.env')), root)
    left = sorted(set(PLACEHOLDER_RX.findall(rendered)))
    if left:
        print(f'NEM MERT: feloldatlan helyorzo a sablonban: {", ".join(left)} '
              '(hianyzik a .env-bol?) -- enelkul MINDEN lap hianyt mutatna')
        return 2
    tl = [l for l in rendered.splitlines() if l.strip()]

    pages = sorted(glob.glob(os.path.join(root, 'agents', '*', 'CLAUDE.md')))
    if not pages:
        print(f'NEM MERT: egyetlen agens-lap sincs ({os.path.join(root, "agents", "*", "CLAUDE.md")})')
        return 2

    print(f'SAFETY-CORE drift: {len(tl)} nem ures sablon-sor, {len(pages)} agens-lap. A tool NEM IR SEMMIT.\n')
    drift = 0
    inserted = {}
    for p in pages:
        agent = os.path.basename(os.path.dirname(p))
        try:
            page = [l for l in open(p, encoding='utf-8').read().splitlines() if l.strip()]
        except OSError as e:
            print(f'  {agent:12} OLVASHATATLAN ({e.strerror})')
            drift += 1
            continue
        have = set(page)
        dev = KNOWN_DEVIATIONS.get(agent, {'lines': [], 'reason': ''})
        allowed = set(dev['lines'])
        missing = [l for l in tl if l not in have and l not in allowed]
        stale = [l for l in dev['lines'] if l in have]
        unknown_allowed = [l for l in dev['lines'] if l not in tl]
        present = sum(1 for l in tl if l in have)
        runs = spans(tl, page)
        inserted[agent] = interior(page, runs)
        bad = bool(missing or stale or unknown_allowed)
        drift += bad
        note = f'  (szandekos: {len(allowed)} sor -- {dev["reason"]})' if allowed else ''
        print(f'  {agent:12} {present}/{len(tl)}  darab: {len(runs)}{note}')
        for l in missing[:5]:
            print(f'      HIANYZIK: {l[:100]}')
        if len(missing) > 5:
            print(f'      ...es meg {len(missing) - 5} sor')
        for l in stale:
            print(f'      ELAVULT KIVETEL (a sor MEGIS a lapon all): {l[:90]}')
        for l in unknown_allowed:
            print(f'      KIVETEL, AMI MAR NINCS A SABLONBAN: {l[:90]}')

    # A MASIK IRANY, ES EZ AZ, AMI 09-20-AN TORTENT: a lapok hordoznak a mag BELSEJEBEN egy sort,
    # ami a sablonbol hianyzik. Ha ugyanaz a sor KET VAGY TOBB lapon all, az nem lap-sajatossag,
    # hanem a SABLON van lemaradva -- a fenti "megvan-e minden sablon-sor" proba erre VAK, mert
    # a sablon minden sora megvan. Egyetlen lapon allo betet csak listazodik (pl. dexter atirasa).
    common = {}
    for agent, lines in inserted.items():
        for l in set(lines):
            common.setdefault(l, []).append(agent)
    behind = {l: a for l, a in common.items() if len(a) >= 2}
    if behind:
        print(f'\n  A SABLON LE VAN MARADVA: {len(behind)} sor all a mag BELSEJEBEN legalabb ket lapon, '
              'es a sablonban nincs:')
        for l, a in list(behind.items())[:5]:
            print(f'      {len(a)} lapon ({", ".join(sorted(a))}): {l[:90]}')
        if len(behind) > 5:
            print(f'      ...es meg {len(behind) - 5} sor')
    single = {l: a[0] for l, a in common.items() if len(a) == 1}
    if single:
        print(f'\n  egy-lapos betet a mag belsejeben (NEM elteres, csak tudnivalo): {len(single)} sor, '
              + ', '.join(sorted({a for a in single.values()})))

    # KONTROLL: a mero tudjon NEMET mondani -- egy ures lapon minden sor hianyozna
    print(f'\n  KONTROLL (ures lap): {sum(1 for l in tl if l not in set())}/{len(tl)} hianyozna -> a mero diszkriminal')
    if drift or behind:
        what = []
        if drift:
            what.append(f'{drift} lapon ELTERES')
        if behind:
            what.append(f'a sablon {len(behind)} soral LE VAN MARADVA')
        print(f'\n!!! {" es ".join(what)}. Dontes: a LAP a forras (hozd be a sablont), vagy a sablon '
              '(javitsd a lapot KEZZEL) -- ez a tool egyiket sem teszi meg.')
        return 3
    print('\nMINDEN LAP EGYEZIK a sablonnal (a nevesitett, ellenorzott kivetelekkel).')
    return 0


if __name__ == '__main__':
    sys.exit(main())

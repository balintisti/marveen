#!/usr/bin/env python3
"""
decision-index.py -- GENERALT index a scripts/ fejleceiben allo DONTESEKROL.

MIERT LETEZIK (kartya 72edf070). A scripts/ fejlecei dontes-alaku valaszokat hordoznak
-- "miert EZ es nem AZ" --, es a nagy reszuk EGYIK kozos lapon sem szerepel. Aki a
CLAUDE.md-t olvassa, nem tud roluk; aki a szkriptet megnyitja, igen. marveen dontese
(2026-09-03 01:00): GENERALT fajl a repoban, es EGY sor a lapon -- nem szekcio. A lap
307 KB, es minden agens betolti minden munkamenet elejen; 195 script-fejlec KERESESI
anyag, nem szabaly.

MIERT GENERALT ES NEM KEZI LISTA: egy kezi lista ugyanugy elavul, mint minden mas szam
ezen a lapon, es senki nem meri ujra, hogy meg egyezik-e.

MIERT NINCS IDOBELYEG A GENERALT FAJLBAN, es ez SZANDEKOS elteres a skill-index.sh-tol:
egy "Generalva: <datum>" sor minden futasnal megvaltoztatja a fajlt, tehat a `--check`
(elavult-e a kovetett peldany) SOSEM tudna nullat mondani. Egy generalt artefaktum, amit
nem lehet diffelni, nem ellenorizheto -- es akkor pontosan az a kezi lista, ami ellen
keszult, csak egy generatorral mellette.

MIERT NINCS A "lapon nevezik-e" OSZLOP A GENERALT FAJLBAN. A bemenete a repon KIVUL van
(`/Users/isti/CLAUDE.md`) es KOVETETLEN (`/Users/isti/marveen/CLAUDE.md` a .gitignore 82.
soraban all). Egy repo-kovetett fajl, aminek a tartalma egy repon kivuli, verziozatlan
fajltol fugg, minden gepen mast adna, es a drift-ellenorzes a repon kivuli valtozastol
bukna. Ezert a lap-oszlop ELO LEKERDEZES marad (`--unnamed`), nem artefaktum.

A DEFINICIO, KIIRVA, mert egy szam a populacioja nelkul nem allitas:
  DONTES-FEJLEC = a fajl fejleckommentjeben all egy sor, ami
    (a) MIERT/WHY-val kezdodik ES a "letezik / exists / nem / not / and not /
        kulon / szerszam" valamelyiket tartalmazza, VAGY
    (b) "Governance control"-lal kezdodik.
  A fejlec = a shebang utani osszefuggo komment-blokk (max 60 sor).
  A populacio = `git ls-files scripts/` (KOVETETT fajlok), nem a lemez tartalma.

Hasznalat:
  python3 scripts/decision-index.py            -- ujragenerálja docs/scripts-decisions.md
  python3 scripts/decision-index.py --check    -- elavult-e a kovetett peldany (exit 3, ha igen)
  python3 scripts/decision-index.py --unnamed  -- ELO: amit egyik kozos lap sem nevez
  python3 scripts/decision-index.py --control  -- a lap-mero onellenorzese

ONELLENORZES, ES MOSTANTOL NEM OPCIONALIS. A `--unnamed` a szam KIIRASA ELOTT lefuttatja a
kontrollt, es MEGTAGADJA a valaszt, ha az elbukik. Mert eset (2026-09-03): egy WORKTREEBOL
futtatva a regi valtozat a `<checkout>/CLAUDE.md`-t kereste, ami ott nem letezik -- a szam
23-rol 29-re ugrott, NEMAN, es a magasabb szam hihetobbnek is latszott. A lap-utak ezert
ABSZOLUTAK es checkout-fuggetlenek.
"""
import os, re, subprocess, sys

INSTALL_ROOT = '/Users/isti/marveen'
# Checkout-FUGGETLEN: egy worktreebol a `<checkout>/CLAUDE.md` nem letezik, es a hianya
# nem hiba, hanem egy csendben szukebb populacio. Lasd a docstring mert eseteet.
PAGES = ['/Users/isti/CLAUDE.md', os.path.join(INSTALL_ROOT, 'CLAUDE.md')]
OUT_REL = 'docs/scripts-decisions.md'

CMT  = re.compile(r'^\s*(#|//)\s?(.*)$')
HEAD = re.compile(r'^\s*(MIERT|MIÉRT|WHY|Miert|Miért|Why)\b[^.]{0,90}?'
                  r'(LETEZIK|EXISTS|NEM |NOT |AND NOT|and not|nem a|SZERSZAM|KULON)', re.I)
GOV  = re.compile(r'^\s*Governance control\b')


def repo_root():
    r = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print('nem git-fa -- a populacio (`git ls-files`) nem allithato elo.', file=sys.stderr)
        sys.exit(2)
    return r.stdout.strip()


def pages_blob():
    out = []
    for p in PAGES:
        try:
            out.append(open(p, encoding='utf-8', errors='replace').read())
        except OSError:
            pass
    return '\n'.join(out), len(out)


def header(path):
    try:
        lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
    except OSError:
        return []
    hdr = []
    for i, l in enumerate(lines[:60]):
        if i == 0 and l.startswith('#!'):
            continue
        m = CMT.match(l)
        if m:
            hdr.append(m.group(2))
        elif not l.strip() and hdr:
            continue
        elif hdr:
            break
    return hdr


def scan(root):
    files = [f for f in subprocess.run(['git', 'ls-files', 'scripts/'], cwd=root,
             capture_output=True, text=True).stdout.split()
             if os.path.isfile(os.path.join(root, f))]
    rows = []
    for f in files:
        hdr = header(os.path.join(root, f))
        dec = []
        for i, h in enumerate(hdr):
            if not (HEAD.match(h) or GOV.match(h)):
                continue
            # A CIM ONMAGABAN is allhat egy soron (quota-ceiling-guard.sh): ilyenkor a VALASZ
            # a kovetkezo nem-ures kommentsor. Mechanikus, tehat a generalt jelleg megmarad.
            line = h.strip()
            if len(line) < 40 and i + 1 < len(hdr) and hdr[i + 1].strip():
                line = line + '  /  ' + hdr[i + 1].strip()
            dec.append(line)
        if dec:
            rows.append((f, dec))
    return sorted(rows), len(files)


def render(rows, nfiles):
    L = []
    L.append('# A `scripts/` fejleceiben allo dontesek')
    L.append('')
    L.append('**GENERALT FAJL -- ne szerkeszd kezzel.** Ujrageneralas:')
    L.append('')
    L.append('```bash')
    L.append('python3 scripts/decision-index.py            # ujrageneralja ezt a fajlt')
    L.append('python3 scripts/decision-index.py --check    # elavult-e (exit 3, ha igen)')
    L.append('python3 scripts/decision-index.py --unnamed  # ELO: amit egyik kozos lap sem nevez')
    L.append('```')
    L.append('')
    L.append('Miert letezik, mit szamol es mit NEM: `scripts/decision-index.py` fejlece.')
    L.append('Roviden: ezek a sorok DONTESEK -- "miert EZ es nem AZ" --, es a nagy reszuk')
    L.append('egyetlen kozos lapon sem szerepel. Ez a lista a keresheto masodik lista;')
    L.append('a valasz maga a szkript fejlecben all, teljes indoklassal.')
    L.append('')
    L.append('**Nincs benne idobelyeg** (hogy diffelheto legyen) es **nincs benne**')
    L.append('**"lapon nevezik-e" oszlop** (a bemenete a repon kivuli, kovetetlen fajl).')
    L.append('')
    L.append(f'Populacio: `git ls-files scripts/` = **{nfiles}** kovetett fajl, ebbol')
    L.append(f'**{len(rows)}** hordoz dontes-fejlecet.')
    L.append('')
    for f, dec in rows:
        L.append(f'### `{f}`')
        L.append('')
        for d in dec:
            L.append(f'- {d}')
        L.append('')
    return '\n'.join(L).rstrip() + '\n'


def control():
    blob, npages = pages_blob()
    pos = 'card-comment.sh' in blob
    neg = 'git-at.sh' in blob
    ok = pos and not neg
    lines = [
        f"lapok olvasva: {npages}/{len(PAGES)}  ({', '.join(PAGES)})",
        f"POZITIV kontroll  card-comment.sh a lapokon: {'IGEN' if pos else 'NEM'}  (IGEN a helyes)",
        f"NEGATIV kontroll  git-at.sh a lapokon:       {'IGEN' if neg else 'NEM'}  (NEM a helyes)",
        'A lap-mero ' + ('MUKODIK.' if ok else 'ELROMLOTT -- a szamai nem hasznalhatok.'),
    ]
    return ok, '\n'.join(lines)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ''
    root = repo_root()
    out_abs = os.path.join(root, OUT_REL)

    if arg == '--control':
        ok, txt = control()
        print(txt)
        return 0

    if arg == '--unnamed':
        # A KONTROLL A SZAM ELOTT FUT, ES MEGTAGAD. Egy elromlott lap-mero magasabb,
        # tehat hihetobb szamot ad -- ezert nem eleg opcionalisan felkinalni.
        ok, txt = control()
        print(txt, file=sys.stderr)
        if not ok:
            print('MEGTAGADVA: a lap-mero elbukott a sajat kontrolljan, szamot nem irok ki.',
                  file=sys.stderr)
            return 3
        rows, nfiles = scan(root)
        blob, _ = pages_blob()
        unnamed = [(f, d) for f, d in rows
                   if os.path.basename(f) not in blob and f not in blob]
        print(f'dontes-fejleces: {len(rows)}   EGYIK lap sem nevezi: {len(unnamed)}')
        for f, dec in unnamed:
            print(f'  {f}')
            for d in dec[:1]:
                print(f'      {d[:100]}')
        return 0

    rows, nfiles = scan(root)
    body = render(rows, nfiles)

    if arg == '--check':
        try:
            cur = open(out_abs, encoding='utf-8').read()
        except OSError:
            print(f'{OUT_REL} HIANYZIK -- futtasd: python3 scripts/decision-index.py',
                  file=sys.stderr)
            return 3
        if cur != body:
            print(f'{OUT_REL} ELAVULT a scripts/ fejlecekhez kepest.', file=sys.stderr)
            print('Javitas: python3 scripts/decision-index.py', file=sys.stderr)
            return 3
        print(f'{OUT_REL} naprakesz ({len(rows)} dontes-fejlec / {nfiles} kovetett fajl).')
        return 0

    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    open(out_abs, 'w', encoding='utf-8').write(body)
    print(f'{OUT_REL} generalva: {len(rows)} dontes-fejlec / {nfiles} kovetett scripts/ fajl.')
    return 0


sys.exit(main())

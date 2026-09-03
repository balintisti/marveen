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

CMT  = re.compile(r'^\s*(#|//|/\*+|\*(?!/))\s?(.*?)\s*(?:\*/)?$')
# A `/* ... */` ag MERT (2026-09-03): a `update-suite-baseline.mjs` JSDoc-fejlece
# ` * MIERT LETEZIK.`-kel kezdodik, es a `#`/`//` minta azt SZERKEZETILEG nem latta.
# Harom fejlec-alak van a scripts/-ben, nem ketto: sor-komment, docstring, blokk.
# A FRAZIS-MINTA TAGITASA MERT, NEM ERZESRE (2026-09-03). Az elso alak WHY/MIERT UTAN
# egy kulcsszo-listat is kovetelt (LETEZIK/EXISTS/NEM/...), es ezzel kihagyott olyan
# tankonyvi dontes-fejleceket, mint a `WHY a separate timer when the dashboard already
# has an in-process watchdog`. A tagitas precizitasa MERVE: 15 uj jelolt ezen a fan,
# mind a 15 ELOLVASVA, mind valodi dontes-fejlec. A `decision`/`dontes` PUSZTA SZAVA
# SZANDEKOSAN NINCS BENNE: azzal probalva 17 jeloltbol tobb mint a fele hamis volt
# (`log-decision --recommendation`, `review decision`, `decision JSON`) -- proza, nem fejlec.
HEAD = re.compile(r'^(WHY|MIERT|MIÉRT|Why|Miert|Miért)\b', re.I)
NEG  = re.compile(r'\b(MIERT NEM|MIÉRT NEM|WHY NOT|Miert nem)\b', re.I)
GOV  = re.compile(r'^\s*Governance control\b')
DQ3 = chr(34) * 3
SQ3 = chr(39) * 3


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
    """A fejlec-blokk kiolvasasa, KET alakban.

    A DOCSTRING-AG MERT DEFEKTUS-JAVITAS (2026-09-03). Az elso valtozat csak `#` es `//`
    kommentet olvasott. Megmerve: a `scripts/` 52 kovetett `.py` fajljabol MIND AZ 52
    docstringgel fejlecel es EGY SEM `#`-kel -- vagyis a mero a konyvtar 27%-at
    SZERKEZETILEG nem latta, es a hianya nem hibakent jelent meg, hanem egy kisebb,
    teljesen hiheto szamkent. Az irany a kenyelmes fele vitt: kevesebb nevezetlen dontes,
    mint amennyi van. Nyolc dontes esett ki, koztuk ket governance-kapu
    (db-destructive-gate.py, outgoing-copy-gate.py).
    """
    try:
        lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
    except OSError:
        return []

    body = lines[1:] if lines and lines[0].startswith('#!') else lines
    first = next((i for i, l in enumerate(body[:10]) if l.strip()), None)
    if first is not None:
        q = body[first].lstrip()[:3]
        if q in (DQ3, SQ3):
            hdr, rest = [], body[first].lstrip()[3:]
            if rest.strip().endswith(q):
                one = rest.strip()[:-3].strip()
                return [one] if one else []
            if rest.strip():
                hdr.append(rest.strip())
            for l in body[first + 1:first + 61]:
                if q in l:
                    head = l.split(q)[0].strip()
                    if head:
                        hdr.append(head)
                    break
                hdr.append(l.strip())
            return hdr

    hdr = []
    for i, l in enumerate(body[:60]):
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
    rows, unparsed = [], []
    for f in files:
        hdr = header(os.path.join(root, f))
        dec = []
        for i, h in enumerate(hdr):
            if not (HEAD.match(h.strip()) or NEG.search(h) or GOV.match(h)):
                continue
            # A CIM ONMAGABAN is allhat egy soron (quota-ceiling-guard.sh): ilyenkor a VALASZ
            # a kovetkezo nem-ures kommentsor. Mechanikus, tehat a generalt jelleg megmarad.
            line = h.strip()
            if len(line) < 40 and i + 1 < len(hdr) and hdr[i + 1].strip():
                line = line + '  /  ' + hdr[i + 1].strip()
            dec.append(line)
        if dec:
            rows.append((f, dec))
            continue
        # NEM OLVASOTT FEJLEC-ALAK, NYERS FRAZIS-SZUROVEL. Harom alakot olvasunk
        # (sor-komment, docstring, blokk); a `scripts/` 24 fajlja egyiket sem hasznalja
        # (.template, .service, .timer, .txt, .sql, .md). Mervez 2026-09-03: kozuluk PONTOSAN
        # EGY hordoz dontes-sort. Egy negyedik parser-ag egyetlen fajlert nem eri meg -- de a
        # HALLGATAS sem: az index celja epp az, hogy a dontes MEGTALALHATO legyen. Ezert ezek
        # GEPIESEN, kulon szakaszban jelennek meg, nem kezzel irt kivetelkent.
        if not hdr:
            try:
                raw = open(os.path.join(root, f), encoding='utf-8',
                           errors='replace').read().splitlines()[:60]
            except OSError:
                raw = []
            for l in raw:
                t = l.strip().lstrip('<!-').strip()
                if HEAD.match(t) or NEG.search(t):
                    unparsed.append((f, t[:120]))
                    break
    return sorted(rows), len(files), sorted(unparsed)


def render(rows, nfiles, unparsed):
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
    if unparsed:
        L.append(f'## Nem olvasott fejlec-alak ({len(unparsed)})')
        L.append('')
        L.append('Ezek a fajlok egyik olvasott fejlec-alakot sem hasznaljak (sor-komment,')
        L.append('docstring, blokk-komment), de a fejlec-tartomanyukban all dontes-alaku sor.')
        L.append('Nyers frazis-szuro, nem parser -- ezert kulon szakasz.')
        L.append('')
        for f, d in unparsed:
            L.append(f'- `{f}` -- {d}')
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
        rows, nfiles, _unp = scan(root)
        blob, _ = pages_blob()
        unnamed = [(f, d) for f, d in rows
                   if os.path.basename(f) not in blob and f not in blob]
        print(f'dontes-fejleces: {len(rows)}   EGYIK lap sem nevezi: {len(unnamed)}')
        for f, dec in unnamed:
            print(f'  {f}')
            for d in dec[:1]:
                print(f'      {d[:100]}')
        return 0

    rows, nfiles, unparsed = scan(root)
    body = render(rows, nfiles, unparsed)

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

    # A POPULACIO A GIT INDEX, NEM A LEMEZ -- es ez egy MERT csapdat rejt (2026-09-03, sajat
    # eset). Aki uj scriptet ir es a `git add` ELOTT generál, olyan artefaktumot commitol, ami
    # nem irja le azt a fat, amibe bekerul: a sajat fajlja meg nincs az indexben. A `--check`
    # ezt utolag megfogja, de csak ha valaki lefuttatja -- egy PR nelkuli feature-agon semmi
    # nem futtatja. Ezert a hiany itt, a generalas pillanataban kap NEVET.
    untracked = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard', 'scripts/'],
                               cwd=root, capture_output=True, text=True).stdout.split()
    pending = [f for f in untracked
               if os.path.isfile(os.path.join(root, f))
               and any(HEAD.match(h.strip()) or NEG.search(h) or GOV.match(h)
                       for h in header(os.path.join(root, f)))]
    if pending:
        print(f'FIGYELEM: {len(pending)} KOVETETLEN scripts/ fajl hordoz dontes-fejlecet, tehat '
              f'NINCS BENNE a generalt indexben:', file=sys.stderr)
        for f in pending:
            print(f'  {f}', file=sys.stderr)
        print('  -> `git add` UTAN generálj ujra, kulonben az artefaktum mast ir le, mint a commit.',
              file=sys.stderr)
    return 0


sys.exit(main())

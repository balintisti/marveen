#!/usr/bin/env python3
"""agent-core-check.py -- minden AGENS-lap hordozza-e a teherhordo mondatokat? (kartya 2028900e)

MIERT: Isti dontese (2026-09-18) szerint minden agens a SAJAT lapjat olvassa, nem a kozoset.
Ettol a kozos lap megszunik halonak lenni: ami eddig egy helyen allt, annak MOST het helyen
kell allnia. Ez az ellenorzes az, ami a levalasztas ELOTT megmondja, hogy tenyleg ott van-e.

A KOORDINATOR-KIZARAS KIMONDVA, mert egy nema kizaras ugyanaz a hiba, mint egy nema veszteseg:
a `melyik agens PANELJE all uresen` a KOORDINATOR munkaja (o meri a flotta tetlenseget), nem
minden agense. Ezert NEM hianynak szamit egy agens-lapon. Barmi MAS hiany az.

HAROM MERO (kartya 83c47d59, marveen (A) dontese 2026-10-20):
  1. kanari ...... claude-md-canary.txt (a FO lap kanarija, a koordinator-only sor nelkul)
  2. szakasz ..... fleet-sections.txt: a kezzel masolt flotta-szakaszok horgonyai; ezeket a
                   cenzusig SEMMI nem orizte, a BIZTONSAGI blokkon kivul
  3. generalt .... a futo dist/web/agent-scaffold.js minden `BEGIN/END GENERATED: <nev>`
                   jelolojenek parja. Hiany = a lapot kezzel irtak at, vagy az agens azota
                   nem indult ujra, hogy a builder valtozott.

AZ AGENS-LISTA A FABOL JON, NEM KODBOL: `agents/*/` minden konyvtara. 2026-10-07-en a beegetett
lista kezzel kapott ket uj nevet (ford, trillian) a futo fan, commit nelkul; addig a ket lapot
semmi nem nezte. Egy konyvtar CLAUDE.md nelkul hiany, nem kihagyas.

--self-test: a mero tudjon NEMET mondani mindharom iranyban, valodi lap nelkul.
"""
import glob, importlib.util as u, os, re, sys

COORD_ONLY = ["melyik ágens PANELJE áll üresen"]
ROOT = '/Users/isti/marveen'
SECTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fleet-sections.txt')  # a szkript mellol
SCAFFOLD = os.path.join(ROOT, 'dist/web/agent-scaffold.js')


class Unavailable(Exception):
    """Egy hianyzo vagy ures forras NEM ures kovetelmeny: a mero ilyenkor megtagad."""


def load_sections(path):
    """-> (szakaszok {kulcs: [horgony, ...]}, ismert hiany {agens: {kulcs}}). Hibas sorra kivetel."""
    try:
        lines = open(path, encoding='utf-8').read().splitlines()
    except OSError as e:
        raise Unavailable(f"a szakasz-lista NEM OLVASHATO ({path}): {e}") from e
    secs, known = {}, {}
    for n, raw in enumerate(lines, 1):
        l = raw.strip()
        if not l or l.startswith('#'):
            continue
        if l.startswith('!known '):
            who, _, keys = l[len('!known '):].partition(':')
            ks = {k.strip() for k in keys.split(',') if k.strip()}
            if not who.strip() or not ks:
                raise Unavailable(f"{path}:{n}: hibas !known sor: {raw!r}")
            known.setdefault(who.strip(), set()).update(ks)
            continue
        key, sep, rest = l.partition('|')
        anchors = [a.strip() for a in rest.split('||') if a.strip()]
        if not sep or not key.strip() or not anchors:
            raise Unavailable(f"{path}:{n}: hibas sor (alak: kulcs | horgony || horgony): {raw!r}")
        if key.strip() in secs:
            raise Unavailable(f"{path}:{n}: ketszer szereplo kulcs: {key.strip()}")
        secs[key.strip()] = anchors
    if not secs:
        raise Unavailable(f"a szakasz-lista URES ({path})")
    bad = sorted(f"{a}:{k}" for a, ks in known.items() for k in ks if k not in secs)
    if bad:
        raise Unavailable(f"!known ismeretlen kulcsra mutat: {', '.join(bad)}")
    return secs, known


def generated_names(path):
    try:
        src = open(path, encoding='utf-8').read()
    except OSError as e:
        raise Unavailable(f"a futo scaffold NEM OLVASHATO ({path}): {e}") from e
    names = sorted(set(re.findall(r'BEGIN GENERATED: ([a-z][a-z-]*)', src)))
    if not names:
        raise Unavailable(f"0 generalt blokk-nev a {path}-ban: a mero nem tudna mit kerni")
    return names


def check_page(s, canary, secs, gen):
    """-> (hianyzo kanari, hianyzo szakasz-kulcsok, hianyzo generalt nevek)."""
    return ([c for c in canary if c not in s],
            [k for k, anchors in secs.items() if not any(a in s for a in anchors)],
            [g for g in gen if f'BEGIN GENERATED: {g} ' not in s or f'END GENERATED: {g} ' not in s])


def judge(agent, s, canary, secs, known, gen):
    """-> (bukott-e, sor). A sor alakja `  <nev> <N> kar.` -- a fleet-page-guard.sh erre horgonyoz."""
    mc, ms, mg = check_page(s, canary, secs, gen)
    exempt = known.get(agent, set())
    new = [k for k in ms if k not in exempt]
    stale = sorted(k for k in exempt if k not in ms)
    line = (f"  {agent:12} {len(s):8,} kar.  kanari {len(canary)-len(mc)}/{len(canary)}, "
            f"szakasz {len(secs)-len(ms)}/{len(secs)}, generalt {len(gen)-len(mg)}/{len(gen)}")
    notes = []
    if mc: notes.append('HIANYZIK kanari: ' + ' | '.join(x[:38] for x in mc[:3]))
    if new: notes.append('HIANYZIK szakasz: ' + ', '.join(new))
    if mg: notes.append('HIANYZIK generalt: ' + ', '.join(mg))
    if exempt & set(ms): notes.append('ismert hiany: ' + ', '.join(sorted(exempt & set(ms))))
    if stale: notes.append('ELAVULT !known (mar megvan, torolheto): ' + ', '.join(stale))
    return bool(mc or new or mg), line + ('' if not notes else '\n' + ''.join(f"      {x}\n" for x in notes).rstrip('\n'))


def self_test():
    canary = ['Nincs gondolatjel (em dash). Soha.']
    secs = {'a': ['ALPHA'], 'b': ['BETA1', 'BETA2']}
    gen = ['blk']
    blk = '<!-- BEGIN GENERATED: blk (x) -->\n<!-- END GENERATED: blk -->'
    full = '\n'.join([canary[0], 'ALPHA', 'BETA2', blk])
    cases = [  # (nev, lap, ismert hiany, elvart bukas, a sorban kotelezo szoveg)
        ('teljes lap atmegy', full, {}, False, 'szakasz 2/2'),
        ('a masodik horgony is eleg', full.replace('BETA2', 'BETA1'), {}, False, 'szakasz 2/2'),
        ('hianyzo szakasz bukik', full.replace('ALPHA', ''), {}, True, 'HIANYZIK szakasz: a'),
        ('hianyzo kanari bukik', full.replace(canary[0], ''), {}, True, 'HIANYZIK kanari'),
        ('csak BEGIN, END nelkul bukik', full.replace('END GENERATED: blk', ''), {}, True,
         'HIANYZIK generalt: blk'),
        ('ismert hiany atmegy, de latszik', full.replace('ALPHA', ''), {'x': {'a'}}, False,
         'ismert hiany: a'),
        ('ismert hiany NEM takar mast', full.replace('ALPHA', '').replace('BETA2', ''),
         {'x': {'a'}}, True, 'HIANYZIK szakasz: b'),
        ('elavult !known kiirva', full, {'x': {'a'}}, False, 'ELAVULT !known'),
        ('ures lap bukik', '', {}, True, 'kanari 0/1, szakasz 0/2, generalt 0/1'),
    ]
    ok = 0
    for name, page, known, want, must in cases:
        bad, line = judge('x', page, canary, secs, known, gen)
        good = bad == want and must in line
        ok += good
        print(f"  {'PASS' if good else 'FAIL'}  {name}" + ('' if good else f"\n{line}"))
    # a forrasok a MEGNYUGTATO iranyba nem degradalhatnak: hianyzo/ures/hibas lista = kivetel
    import tempfile
    refusals = 0
    with tempfile.TemporaryDirectory() as d:
        for body in ['', '# csak komment\n', 'kulcs nelkul horgony\n', 'a | X\n!known y: nincsilyen\n']:
            p = os.path.join(d, 'f.txt'); open(p, 'w', encoding='utf-8').write(body)
            try: load_sections(p)
            except Unavailable: refusals += 1
        try: load_sections(os.path.join(d, 'nincs.txt'))
        except Unavailable: refusals += 1
        p = os.path.join(d, 's.js'); open(p, 'w').write('nincs jelolo')
        try: generated_names(p)
        except Unavailable: refusals += 1
    good = refusals == 6
    ok += good
    print(f"  {'PASS' if good else 'FAIL'}  hibas forrasra megtagad ({refusals}/6)")
    n = len(cases) + 1
    print(f"SELF-TEST {'PASS' if ok == n else 'FAIL'} ({ok}/{n})")
    return 0 if ok == n else 1


def main():
    sp = u.spec_from_file_location('cme', os.path.join(ROOT, 'scripts/claude-md-edit.py'))
    m = u.module_from_spec(sp); sp.loader.exec_module(m)
    canary = [c for c in m.canary_lines() if c not in COORD_ONLY]
    secs, known = load_sections(SECTIONS)
    gen = generated_names(SCAFFOLD)
    agents = sorted(os.path.basename(p.rstrip('/')) for p in glob.glob(f'{ROOT}/agents/*/'))
    if not agents:
        raise Unavailable(f"0 agens-konyvtar a {ROOT}/agents alatt")
    orphan = sorted(set(known) - set(agents))
    print(f"agens-lap: {len(agents)} (agents/*/)  kanari: {len(canary)} "
          f"(a teljes {len(m.canary_lines())}, ebbol {len(COORD_ONLY)} koordinator-only)  "
          f"szakasz: {len(secs)}  generalt blokk: {len(gen)} ({os.path.relpath(SCAFFOLD, ROOT)})\n")
    bad = 0
    for a in agents:
        p = f'{ROOT}/agents/{a}/CLAUDE.md'
        try:
            s = open(p, encoding='utf-8').read()
        except FileNotFoundError:
            print(f"  {a:12} NINCS LAP"); bad += 1; continue
        fail, line = judge(a, s, canary, secs, known, gen)
        bad += fail
        print(line)
    if orphan:
        print(f"\n  ELAVULT !known: nincs ilyen agens: {', '.join(orphan)}")
    # KONTROLL: a mero tudjon NEMET is mondani
    mc, ms, mg = check_page("teljesen ures szoveg", canary, secs, gen)
    print(f"\n  KONTROLL (ures szoveg): kanari {len(mc)}/{len(canary)}, szakasz {len(ms)}/{len(secs)}, "
          f"generalt {len(mg)}/{len(gen)} hianyzana -> a mero diszkriminal")
    print("\n" + (f"MIND A {len(agents)} LAP TELJES" if bad == 0
                  else f"!!! {bad} LAP HIANYOS -- a hianyzo szakaszt a nevezett lapba ird vissza"))
    return 0 if bad == 0 else 3


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        sys.exit(self_test())
    try:
        sys.exit(main())
    except Unavailable as e:
        print(f"!!! A MERO NEM FUTOTT: {e}")
        sys.exit(4)

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
                   jelolojenek parja. A blokkot az IRO (a futo dashboard) irja a lapra, az
                   agens INDULASAKOR. Ezert egy hianyzo blokk KET kulon dolog (kartya 074149c2):
                     - a munkamenet az iro ELOTT indult, vagy az agens nem fut: a kovetkezo
                       indulas megirja. NEM hiba, nem megy rola uzenet, a naplo viszi.
                     - a munkamenet az iro UTAN indult, megsincs ott: HIBA (az iro nem irta meg,
                       vagy a lapot kezzel atirtak). Kezzel potolni ezt sem kell: az a resz az iroe.
                   Ami NEM MERHETO (tmux vagy a dashboard folyamata nem valaszol), az HIBA marad:
                   egy ketseg itt sem olvashato megnyugtatonak.

AZ AGENS-LISTA A FABOL JON, NEM KODBOL: `agents/*/` minden konyvtara. 2026-10-07-en a beegetett
lista kezzel kapott ket uj nevet (ford, trillian) a futo fan, commit nelkul; addig a ket lapot
semmi nem nezte. Egy konyvtar CLAUDE.md nelkul hiany, nem kihagyas.

--self-test: a mero tudjon NEMET mondani mindharom iranyban, valodi lap nelkul.
"""
import glob, importlib.util as u, os, re, subprocess, sys, time

COORD_ONLY = ["melyik ágens PANELJE áll üresen"]
ROOT = '/Users/isti/marveen'
SECTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fleet-sections.txt')  # a szkript mellol
SCAFFOLD = os.path.join(ROOT, 'dist/web/agent-scaffold.js')
PIDFILE = os.path.join(ROOT, 'store/claudeclaw.pid')
UNKNOWN = 'NEM MERHETO'  # orszem-ertek: `is`-szel hasonlitva, SOHA nem olvashato megnyugtatonak


class Unavailable(Exception):
    """Egy hianyzo vagy ures forras NEM ures kovetelmeny: a mero ilyenkor megtagad."""


def load_sections(path):
    """-> (szakaszok {kulcs: [horgony, ...]}, ismert hiany {agens: {kulcs}}). Hibas sorra kivetel."""
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().splitlines()
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
        with open(path, encoding='utf-8') as f:
            src = f.read()
    except OSError as e:
        raise Unavailable(f"a futo scaffold NEM OLVASHATO ({path}): {e}") from e
    names = sorted(set(re.findall(r'BEGIN GENERATED: ([a-z][a-z-]*)', src)))
    if not names:
        raise Unavailable(f"0 generalt blokk-nev a {path}-ban: a mero nem tudna mit kerni")
    return names


def parse_etime(s):
    """A `ps -o etime=` kimenete ([[nap-]ora:]perc:mp) masodpercben. Mas alakra ValueError."""
    m = re.fullmatch(r'(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)', s.strip())
    if not m:
        raise ValueError(f"nem etime alak: {s!r}")
    d, h, mi, se = (int(x) if x else 0 for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + se


def _ps(field, pid):
    r = subprocess.run(['ps', '-o', f'{field}=', '-p', str(pid)], capture_output=True, text=True,
                       timeout=10, env=dict(os.environ, LC_ALL='C'))
    if r.returncode != 0 or not r.stdout.strip():
        raise ValueError(f"ps {field} pid {pid}: rc={r.returncode}")
    return r.stdout.strip()


def writer_since(now=None):
    """Mikortol irja a FUTO dashboard az EBBEN a buildben levo blokkokat (epoch mp): a build es a
    folyamat indulasa kozul a KESOBBI. Egy friss build, amit a futo folyamat meg nem toltott be,
    semmit nem ir: ezert nem eleg a fajl ideje. Nem merheto -> UNKNOWN."""
    try:
        built = os.path.getmtime(SCAFFOLD)
        with open(PIDFILE, encoding='utf-8') as f:
            pid = int(f.read().strip())
        if 'dist/index.js' not in _ps('command', pid):
            return UNKNOWN  # a pid-fajl mas folyamatra mutat: az iro indulasa nem ismert
        started = (time.time() if now is None else now) - parse_etime(_ps('etime', pid))
        return max(built, started)
    except (OSError, ValueError, subprocess.SubprocessError):
        return UNKNOWN


def session_starts():
    """-> {tmux-munkamenet neve: indulasa (epoch mp)}, vagy UNKNOWN, ha a tmux nem valaszolt.
    Az URES lista is UNKNOWN: a futo flottan az nem meres, hanem egy el nem ert tmux."""
    try:
        r = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name} #{session_created}'],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return UNKNOWN
    if r.returncode != 0:
        return UNKNOWN
    out = {}
    for l in r.stdout.splitlines():
        name, _, ts = l.rpartition(' ')
        if name and ts.isdigit():
            out[name] = int(ts)
    return out or UNKNOWN


def _hm(ts):
    return time.strftime('%m-%d %H:%M', time.localtime(ts))


def generated_wait(start, since):
    """Egy HIANYZO generalt blokk megerkezik-e magatol? -> (True, miert): a kovetkezo indulas
    megirja; (False, miert): HIBA. `start`: a munkamenet indulasa (epoch mp), None = nincs futo
    munkamenet, UNKNOWN = nem merheto. `since`: writer_since()."""
    if start is UNKNOWN or since is UNKNOWN:
        return False, 'az indulas ideje NEM MERHETO, ezert hibanak szamit'
    if start is None:
        return True, 'nincs futo munkamenete'
    if start < since:
        return True, f'a munkamenet {_hm(start)}-kor indult, az iro {_hm(since)} ota fut ezzel a builddel'
    return False, f'a munkamenet {_hm(start)}-kor indult, az iro mar {_hm(since)} ota fut, megsem irta meg'


def check_page(s, canary, secs, gen):
    """-> (hianyzo kanari, hianyzo szakasz-kulcsok, hianyzo generalt nevek)."""
    return ([c for c in canary if c not in s],
            [k for k, anchors in secs.items() if not any(a in s for a in anchors)],
            [g for g in gen if f'BEGIN GENERATED: {g} ' not in s or f'END GENERATED: {g} ' not in s])


def judge(agent, s, canary, secs, known, gen, wait=(False, '')):
    """-> (bukott-e, sor, var-e generalt blokkra). A sor alakja `  <nev> <N> kar.` -- a
    fleet-page-guard.sh erre horgonyoz. `wait`: generated_wait() valasza erre az agensre; az
    alapertek a szigoru (minden hianyzo generalt blokk hiba)."""
    mc, ms, mg = check_page(s, canary, secs, gen)
    arrives, why = wait
    pending = bool(mg) and arrives
    exempt = known.get(agent, set())
    new = [k for k in ms if k not in exempt]
    stale = sorted(k for k in exempt if k not in ms)
    line = (f"  {agent:12} {len(s):8,} kar.  kanari {len(canary)-len(mc)}/{len(canary)}, "
            f"szakasz {len(secs)-len(ms)}/{len(secs)}, generalt {len(gen)-len(mg)}/{len(gen)}")
    notes = []
    if mc: notes.append('HIANYZIK kanari: ' + ' | '.join(x[:38] for x in mc[:3]))
    if new: notes.append('HIANYZIK szakasz: ' + ', '.join(new))
    if pending:
        notes.append(f"KESOBB ERKEZIK generalt: {', '.join(mg)} ({why}): a kovetkezo indulas megirja, teendo nincs")
    elif mg:
        notes.append(f"HIANYZIK generalt: {', '.join(mg)}" + (f" ({why})" if why else '')
                     + " -- KEZZEL NE potold: ez a resz az iroe")
    if exempt & set(ms): notes.append('ismert hiany: ' + ', '.join(sorted(exempt & set(ms))))
    if stale: notes.append('ELAVULT !known (mar megvan, torolheto): ' + ', '.join(stale))
    return (bool(mc or new or (mg and not pending)),
            line + ('' if not notes else '\n' + ''.join(f"      {x}\n" for x in notes).rstrip('\n')),
            pending)


def summary(total, bad, pending):
    """A zaro sor(ok). `bad` es `pending` agens-nevek listaja. A `HIBAS-LAPOK: ` sort a
    fleet-page-guard.sh GEPPEL olvassa (ebbol tudja a cimzett-valaszto, kikrol szol a jelzes),
    es az src/front-desk.ts ugyanezt az alakot varja: a harom egyutt valtozik."""
    wait = (f"{len(pending)} lapra generalt blokk a kovetkezo indulasnal erkezik ({', '.join(pending)})"
            if pending else '')
    if not bad:
        return f"MIND A {total} LAP TELJES" if not pending else f"NINCS HIBAS LAP ({total} lap): {wait}"
    return (f"!!! {len(bad)} LAP HIANYOS -- kanarit es szakaszt a nevezett lapba irj vissza; GENERALT blokkot "
            f"kezzel NE, azt az iro irja az agens indulasakor" + (f"\n    ({wait})" if wait else '')
            + f"\nHIBAS-LAPOK: {', '.join(bad)}")


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
        bad, line, _ = judge('x', page, canary, secs, known, gen)
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
    # GENERALT blokk: var-e ra a lap, vagy hiba? (kartya 074149c2)
    noblk = full.replace(blk, '')
    waits = [  # (nev, lap, munkamenet indulasa, iro, elvart bukas, elvart varas, kotelezo szoveg)
        ('az iro ELOTT indult: var, nem bukik', noblk, 100, 200, False, True, 'KESOBB ERKEZIK generalt: blk'),
        ('nem fut: var, nem bukik', noblk, None, 200, False, True, 'nincs futo munkamenete'),
        ('az iro UTAN indult: bukik', noblk, 300, 200, True, False, 'HIANYZIK generalt: blk'),
        ('ugyanabban a masodpercben: bukik', noblk, 200, 200, True, False, 'HIANYZIK generalt: blk'),
        ('a munkamenet nem merheto: bukik', noblk, UNKNOWN, 200, True, False, 'NEM MERHETO'),
        ('az iro nem merheto: bukik', noblk, 100, UNKNOWN, True, False, 'NEM MERHETO'),
        ('nem fut, de az iro nem merheto: bukik', noblk, None, UNKNOWN, True, False, 'NEM MERHETO'),
        ('a varas NEM takar szakasz-hianyt', noblk.replace('ALPHA', ''), 100, 200, True, True,
         'HIANYZIK szakasz: a'),
        ('teljes lapon a varas semmit nem mond', full, 100, 200, False, False, 'generalt 1/1'),
    ]
    for name, page, start, since, want, want_wait, must in waits:
        bad, line, pend = judge('x', page, canary, secs, {}, gen, generated_wait(start, since))
        good = bad == want and pend == want_wait and must in line
        ok += good
        print(f"  {'PASS' if good else 'FAIL'}  {name}" + ('' if good else f"\n{line}"))
    sums = [
        ('minden teljes', summary(3, [], []), 'MIND A 3 LAP TELJES', None),
        ('csak varo lap: nincs HIBAS-LAPOK sor', summary(3, [], ['a']), 'NINCS HIBAS LAP (3 lap): 1 lapra', 'HIBAS-LAPOK'),
        ('hibas lap: a nevek az utolso sorban', summary(3, ['b', 'c'], ['a']).splitlines()[-1], 'HIBAS-LAPOK: b, c', None),
        ('hibas lap mellett a varo is latszik', summary(3, ['b'], ['a']), '1 lapra generalt blokk', None),
    ]
    for name, text, must, must_not in sums:
        good = must in text and (must_not is None or must_not not in text)
        ok += good
        print(f"  {'PASS' if good else 'FAIL'}  {name}" + ('' if good else f"\n{text}"))
    et = [('05:07', 307), ('01:05:07', 3907), ('2-01:05:07', 176707)]
    good = all(parse_etime(a) == b for a, b in et)
    try:
        parse_etime('K nov. 10'); good = False
    except ValueError:
        pass
    ok += good
    print(f"  {'PASS' if good else 'FAIL'}  etime: harom alak, a negyedikre megtagad")
    n = len(cases) + 1 + len(waits) + len(sums) + 1
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
    starts, since = session_starts(), writer_since()
    bad, pending = [], []
    for a in agents:
        p = f'{ROOT}/agents/{a}/CLAUDE.md'
        try:
            with open(p, encoding='utf-8') as f:
                s = f.read()
        except FileNotFoundError:
            print(f"  {a:12} NINCS LAP"); bad.append(a); continue
        start = UNKNOWN if starts is UNKNOWN else starts.get(f'agent-{a}')
        fail, line, waits = judge(a, s, canary, secs, known, gen, generated_wait(start, since))
        if fail: bad.append(a)
        if waits: pending.append(a)
        print(line)
    if orphan:
        print(f"\n  ELAVULT !known: nincs ilyen agens: {', '.join(orphan)}")
    # KONTROLL: a mero tudjon NEMET is mondani
    mc, ms, mg = check_page("teljesen ures szoveg", canary, secs, gen)
    print(f"\n  KONTROLL (ures szoveg): kanari {len(mc)}/{len(canary)}, szakasz {len(ms)}/{len(secs)}, "
          f"generalt {len(mg)}/{len(gen)} hianyzana -> a mero diszkriminal")
    print("\n" + summary(len(agents), bad, pending))
    return 0 if not bad else 3


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        sys.exit(self_test())
    try:
        sys.exit(main())
    except Unavailable as e:
        print(f"!!! A MERO NEM FUTOTT: {e}")
        sys.exit(4)

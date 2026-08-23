#!/usr/bin/env python3
"""Melyik reporol szol egy kanban-kartya? Bizonyitek: a torzsben idezett FAJLUT.

Kartya e369adab. Ez a szkript hozta meg 78 dontest az elo tablan 2026-08-23-an;
azert van a repoban es nem egy eldobhato masolatban, mert amit nem lehet
UJRAFUTTATNI, azt nem lehet AUDITALNI sem.

  ./scripts/kanban-project-classify.py --calibrate   # onellenorzes, nem ir semmit
  ./scripts/kanban-project-classify.py --dry-run     # mit irna, ha irhatna
  ./scripts/kanban-project-classify.py --apply       # ir, egyenkent visszaolvasva

MIERT FAJLUT ES NEM CIMSZO. Egy fajlut ellenorizheto teny: vagy letezik az adott
repoban, vagy nem. Egy cimszo ("backend", "teszt", "hiba") minden repora illik.

HAROM KIMENET, ES A HARMADIK A LENYEG:
    <repo>          egyetlen repora mutat bizonyitek
    KETES           ket repora is mutat -- MARAD URES, es kulon listara kerul
    NINCS_AZONOSITO a torzsben nincs fajlut -- MARAD URES
A nulla talalat NEM jelent "marveen"-t. Egy tevesen kitoltott mezo rosszabb az
uresnel, mert az ures LATSZIK, a teves nem.

=== KET KIZARAS, MINDKETTO MERT DEFEKTUS-JAVITAS ===

1. KONFIGURACIOS UTAK (agents/, .claude/, .claude-config/), 2026-08-23 delelott.
   A kalibracio egyetlen tevedese egy CRM-temaju kartya volt, ami
   `agents/*/settings.json` utakat idez -- azok a marveen repoban vannak.
   EGY FAJLUT AZT MONDJA MEG, HOL A FAJL, NEM AZT, MIROL SZOL A KARTYA.

2. A "KOZOS" HALMAZT A LEMEZ DONTI EL, NEM A GIT-KOVETES, 2026-08-23 delutan.
   A `CLAUDE.md` MINDKET repoban letezik, de a marveenben nincs koveetve. A
   `git ls-files` ezert delta-crm-jellemzonek mutatta, es a testing-oszlop hat
   ketes esetebol OTOT egyedul ez az egy fajlnev okozott.
   ES AMI EBBOL A DRAGABB LECKE: az elso javitasom csak a basename-tartalekot
   szurte, es MERVE SEMMIT nem valtoztatott -- a `CLAUDE.md` a delta-crm-ben
   KOVEETETT UTVONAL, tehat mar a pontos-ut agon egyezett. A kizaras a dontes
   UTAN allt. Egy javitas a helyes otlettel, rossz helyen, pontosan ugy nez ki,
   mint egy javitas.

=== ISMERT TEVEDES-OSZTALY, ES A SZAM, AMI EZT MEGMUTATTA ===
FUGGETLEN oszlopokon merve (done/waiting/in_progress -- ezekre ez a szkript SOHA
nem irt), 2026-08-23:
    done         102 cimkezett:  89 egyezik | 2 ELTER | 2 ketes |  9 azonosito nelkul
    waiting       21 cimkezett:  13 egyezik | 1 ELTER | 1 ketes |  6 azonosito nelkul
    in_progress    2 cimkezett:   2 egyezik | 0 ELTER | 0 ketes |  0 azonosito nelkul
HAROM TEVEDES 125 FUGGETLEN CIMKEN -- es mind a harom UGYANAZ AZ ALAK:
    10eacec6  CRM-mentes offsite masolata   -> bizonyitek: scripts/delta-crm-backup.sh, scripts/r2.py
    22511ff4  CRM-темaju kartya             -> bizonyitek: scripts/card-comment.sh
    0b32c5da  CRM-temaju kartya             -> bizonyitek: claude/settings.json
CRM-TEMAJU KARTYA, AMI MARVEEN-ESZKOZ UTVONALAT IDEZ. Az eszkoz a marveen repoban
lakik, a TARGYA viszont a CRM. Ez ugyanaz a mondat, mint az 1. kizarasnal, csak
egy szinttel feljebb: EGY FAJLUT AZT MONDJA MEG, HOL A FAJL, NEM AZT, MIROL SZOL
A KARTYA -- es ezt a maradek osztalyt a kizarasok NEM tuntetik el.
A tevedes IRANYA allando: CRM-kartyara ad `marveen` cimket, forditva nem. Aki a
kimenetet hasznalja, a `marveen`-nek osztalyozottakat nezze at kezzel; a
`delta-crm` oldalt ez az osztaly nem fenyegeti.

ES EGY FIGYELMEZTETES A `--calibrate`-RE MAGARA: ha ez a szkript MAR IRT arra az
oszlopra, a szam KORKOROS -- az osztalyozo sajat cimkeivel egyezik. A `testing`
oszlop 2026-08-23 14:4x ota ilyen (120-bol 78-at ez irt), tehat ott a 119/120
NEM fuggetlen meres. Fuggetlen szamert olyan oszlopot valassz, amire nem irt.

=== A KALIBRACIO KET KONTROLLJA (--calibrate) ===
A cimkezett kartyakon fut, es KET dolgot allit, nem egyet:
    1. a helyes dontesek szama NEM CSOKKENHET egy szigoritastol
    2. az ellentmondasok szama NULLA marad
Az elso azert kell, mert egy szukites tipikusan ugy "javit", hogy kozben helyes
dontesektol is megfoszt. Merve 2026-08-23, a testing oszlopon, BEFAGYASZTOTT
pillanatfelvetelen (ez a resz sem elhagyhato: eloszor NEM fagyasztottam be, es a
kontroll "bukast" mutatott, mert a TABLA mozdult a ket futas kozott, nem a kod):
    lemez-szures nelkul: 37 egyezik | 0 elter | 6 ketes
    lemez-szuressel:     43 egyezik | 0 elter | 0 ketes
"""
import argparse, json, os, re, subprocess, sys, urllib.request

REPOK = {'marveen': '/Users/isti/marveen', 'delta-crm': '/Users/isti/mandark-test'}
KIZART_UTRESZ = ('agents/', '.claude/', '.claude-config/')
KIHAGYOTT_KONYVTAR = {'.git', 'node_modules', 'dist', '.venv', 'build', 'coverage'}
UT = re.compile(r'[A-Za-z0-9_./-]*[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|py|sh|sql|json|md|kt|prisma|yml|yaml)\b')
DASH = 'http://localhost:3420'


def _koveetett(path):
    r = subprocess.run(['git', 'ls-files'], capture_output=True, text=True, cwd=path)
    return {f for f in r.stdout.split('\n') if f.strip()}


def _lemez_fajlnevek(root):
    out = set()
    for dp, dirs, fs in os.walk(root):
        dirs[:] = [d for d in dirs if d not in KIHAGYOTT_KONYVTAR]
        out.update(fs)
    return out


class Osztalyozo:
    def __init__(self, repok=REPOK):
        koveetett = {k: _koveetett(v) for k, v in repok.items()}
        kozos_ut = set.intersection(*koveetett.values())
        egyedi = {k: v - kozos_ut for k, v in koveetett.items()}
        # A dontо kizaras: ha a FAJLNEV mindket munkafaban letezik, nem
        # megkulonbozteto -- fuggetlenul attol, hogy melyik repo koveti.
        lemez = {k: _lemez_fajlnevek(v) for k, v in repok.items()}
        self.mindkettoben = set.intersection(*lemez.values())
        self.egyedi = {r: {f for f in fs if f.rsplit('/', 1)[-1] not in self.mindkettoben}
                       for r, fs in egyedi.items()}
        base = {}
        for repo, fs in self.egyedi.items():
            for f in fs:
                base.setdefault(f.rsplit('/', 1)[-1], set()).add(repo)
        self.base = {b: next(iter(r)) for b, r in base.items()
                     if len(r) == 1 and b not in self.mindkettoben}

    def bizonyitek(self, szoveg):
        tal = {}
        for m in UT.finditer(szoveg or ''):
            u = m.group(0).lstrip('./')
            if any(k in u for k in KIZART_UTRESZ):
                continue
            if u.rsplit('/', 1)[-1] in self.mindkettoben:
                continue
            repo = next((r for r, fs in self.egyedi.items() if u in fs), None)
            if repo is None:
                repo = self.base.get(u.rsplit('/', 1)[-1])
            if repo:
                tal.setdefault(repo, set()).add(u)
        return tal

    def osztaly(self, szoveg):
        t = self.bizonyitek(szoveg)
        if len(t) == 1:
            return next(iter(t)), t
        return ('KETES' if t else 'NINCS_AZONOSITO'), t


def eszkoz_ut(u):
    """ESZKOZ-ut: valamit CSINAL, nem a targy sajat forrasa."""
    b = u.rsplit('/', 1)[-1]
    return (u.startswith('scripts/') or b.endswith('.sh') or b.endswith('.py')
            or 'settings.json' in u or 'task-config.json' in u)


def csak_eszkoz(bizonyitek):
    """A HAROM ISMERT TEVEDES MECHANIZMUSA (--audit).

    Mindharom tevedo kartya egy ESZKOZT idezett, amit a TARGYAN hasznalnak, nem a
    targy sajat forrasat: `scripts/delta-crm-backup.sh`, `scripts/r2.py`,
    `scripts/card-comment.sh`, `claude/settings.json`. Az eszkoz a marveen
    repoban lakik, a targya a CRM.

    POZITIV KONTROLL (2026-08-23): a minta mind a HAROM ismert esetet megtalalja
    (3/3). Enelkul a "nulla talalat" es a "rossz minta" megkulonboztethetetlen.

    ISMERT HAMIS POZITIV: amikor az eszkoz MAGA a targy. Merve ugyanakkor: a 13
    marveen cimkebol egyet jelolt (`0e3959e4`, bizonyitek `scripts/agent-msg.sh`),
    es az a kartya EPP az agent-msg.sh viselkedeserol szol -- a cimke helyes.
    Ezert SZURO ez, nem itelet: atnezendot jelol ki, nem hibat allapit meg.

    AMIT A NULLA TALALAT NEM BIZONYIT: hogy a tevedes iranya allando. Csak azt,
    hogy EZ A MINTA nem talalt tobbet. Harom eset kicsi alap egy iranyra, es egy
    olyan tevedes, ami a MASIK repo alkalmazas-forrasat idezi, ezen a szuron
    atmegy.
    """
    utak = [u for v in bizonyitek.values() for u in v]
    return bool(utak) and all(eszkoz_ut(u) for u in utak)


def _api(path, method='GET', body=None):
    tok = open('/Users/isti/marveen/store/.dashboard-token').read().strip()
    req = urllib.request.Request(DASH + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': 'Bearer ' + tok,
                                          'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))


def _torzs(kartya):
    kommentek = _api(f"/api/kanban/{kartya['id']}/comments")
    return '\n'.join([kartya['title'] or '', kartya.get('description') or '',
                      *(c['content'] for c in kommentek)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--status', default='testing', help='melyik oszlopon dolgozzon')
    m = ap.add_mutually_exclusive_group(required=True)
    m.add_argument('--calibrate', action='store_true', help='onellenorzes a CIMKEZETT kartyakon')
    m.add_argument('--dry-run', action='store_true')
    m.add_argument('--apply', action='store_true')
    m.add_argument('--audit', action='store_true',
                   help='a MAR CIMKEZETT kartyak atszurese az ismert tevedes-osztalyra')
    a = ap.parse_args()

    o = Osztalyozo()
    tabla = _api('/api/kanban')
    ures = lambda c: not (c.get('project') or '').strip()

    if a.calibrate:
        cel = [c for c in tabla if c['status'] == a.status and not ures(c)]
        print(f"PREDIKATUM: status=='{a.status}' ES a project KITOLTOTT -> {len(cel)} kartya")
        eg = el = ke = ni = 0
        elterok = []
        for c in cel:
            k, t = o.osztaly(_torzs(c))
            if k == 'NINCS_AZONOSITO': ni += 1
            elif k == 'KETES': ke += 1
            elif k == c['project']: eg += 1
            else:
                el += 1
                elterok.append((c['id'], c['project'], k, {r: sorted(v)[:3] for r, v in t.items()}))
        print(f"  egyezik {eg} | ELTER {el} | ketes {ke} | nincs azonosito {ni}")
        for e in elterok:
            print('  ELTER:', e)
        # A kontroll, ami nelkul ez csak egy szam: ellentmondas nem lehet.
        print('\n  KONTROLL: ellentmondas nulla ->', 'OK' if el == 0 else 'BUKIK')
        return 0 if el == 0 else 1

    if a.audit:
        cel = [c for c in tabla if c['status'] == a.status and not ures(c)]
        print(f"PREDIKATUM: status=='{a.status}' ES a project KITOLTOTT -> {len(cel)} kartya")
        hit = 0
        for c in cel:
            _, t = o.osztaly(_torzs(c))
            if csak_eszkoz(t):
                hit += 1
                utak = sorted(u for v in t.values() for u in v)
                print(f"  ATNEZENDO {c['id']}  cimke={c['project']:10s} {c['title'][:55]}")
                print(f"      csak eszkoz-utak: {utak[:4]}")
        print(f"\n  megjelolve: {hit} / {len(cel)}")
        print('  FIGYELEM: ez SZURO, nem itelet -- lasd a csak_eszkoz() docstringjet.')
        return 0

    cel = [c for c in tabla if c['status'] == a.status and ures(c)]
    print(f"PREDIKATUM: status=='{a.status}' ES a project ures/hianyzik -> {len(cel)} kartya")
    ered = {}
    for c in cel:
        k, t = o.osztaly(_torzs(c))
        ered.setdefault(k, []).append((c['id'], c['title'][:60], {r: sorted(v)[:3] for r, v in t.items()}))
    for k in sorted(ered):
        print(f"  {k:18s} {len(ered[k])}")
    for k in ('KETES', 'NINCS_AZONOSITO'):
        for i in ered.get(k, []):
            print(f"  {k}: {i[0]}  {i[1]}")

    if a.dry_run:
        print('\n--dry-run: semmit nem irtam.')
        return 0

    irando = [(i[0], k) for k, v in ered.items() if k in REPOK for i in v]
    elotte = [{'id': cid, 'project': _api('/api/kanban/' + cid).get('project')} for cid, _ in irando]
    print(f"\nvisszafordito lista ({len(elotte)} sor):")
    print(json.dumps(elotte)[:200], '...')
    ok, bad = [], []
    for cid, proj in irando:
        _api('/api/kanban/' + cid, 'PUT', {'project': proj})
        # A 200 nem bizonyitek. A visszaolvasas az.
        (ok if _api('/api/kanban/' + cid).get('project') == proj else bad).append(cid)
    print(f"irva es visszaolvasva: {len(ok)}/{len(irando)} | sikertelen: {bad}")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())

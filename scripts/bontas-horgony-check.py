#!/usr/bin/env python3
"""bontas-horgony-check.py -- a CLAUDE.md bontas utani (c) probaja, GEPIESEN.

MIERT LETEZIK. 2026-09-17-en hat szakaszt bontottam ki a `CLAUDE.md`-bol, es a bontas utani
"megvan-e meg minden teherhordo horgony a magban" probam HAROMSZOR adott HAMIS HIANYT -- es
egyszer sem a munka volt a hibas:

    1. bontas: EKEZET-erzekeny illesztes      -> 4 hamis hiany (MAGYARORSZAG kontra MAGYARORSZÁG)
    2. bontas: a horgony SORTORESEN ivelt at  -> 1 hamis hiany
    6. bontas: ugyanaz a sortores, PLUSZ ket elgepeles a horgonyban -> 3 hamis hiany

A 2. utan kiirtam a szabalyt ("ekezet-foldolt ES soron beluli horgony"), es a 6.-nal SAJAT MAGAM
szegtem meg. Ez a lap sajat torvenye: egy szabaly, ami IRASKOR tuzel, csak a hanyagot fogja meg.
Ezert nem szabaly lett belole, hanem ez a fajl.

A HAMIS HIANY IRANYA A RIASZTO: azt allitja, hogy egy EP bontas elvesztett valamit, es a
kezenfekvo reakcio a visszaallitas -- vagyis egy jo munka visszacsinalasa egy rossz meres miatt.

MIT CSINAL. Mindket oldalt normalizalja, MIELOTT illesztene:
    - ekezet-foldolas (NFD + a kombinalo jelek eldobasa) es kisbetusites
    - MINDEN whitespace-futam egyetlen szokozze (igy a sortores nem szamit)
Igy a horgonynak sem ekezethelyesnek, sem soron belulinek nem kell lennie.

HASZNALAT:
    python3 scripts/bontas-horgony-check.py <mag-fajl> <horgony-fajl>
        a horgony-fajl: soronkent EGY horgony; ures sor es `#`-kezdetu sor kimarad
    python3 scripts/bontas-horgony-check.py --self-test

KILEPESI KOD: 0 = minden horgony megvan | 1 = hianyzik | 2 = hasznalati hiba
"""
import sys, unicodedata, re

def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip().lower()

def check(core: str, anchors: list[str]):
    c = norm(core)
    return [a for a in anchors if norm(a) not in c]

def self_test() -> int:
    core = "A MAGYARORSZÁG EU-TAG sor.\nEgy mondat, ami\nsortörésen ível át.\n"
    cases = [
        ("ekezet-fuggetlen",      "magyarorszag eu-tag",            True),
        ("ekezet-fuggetlen/2",    "MAGYARORSZÁG EU-TAG",            True),
        ("sortoresen ativelo",    "ami sortörésen ível át",         True),
        ("sortores + ekezet",     "ami sortoresen ivel at",         True),
        ("NEGATIV kontroll",      "ez a horgony nem letezik sehol", False),
    ]
    bad = 0
    for nev, horgony, vart in cases:
        megvan = not check(core, [horgony])
        ok = (megvan == vart)
        print(f"  {'OK  ' if ok else 'BUKO'}  {nev:22} vart={vart} kapott={megvan}")
        bad += 0 if ok else 1
    # A NEGATIV kontroll a lenyeg: enelkul egy 'mindenre igent mondo' mero is atmenne.
    print(f"\n{'SELF-TEST PASS' if not bad else 'SELF-TEST FAIL'} ({len(cases)-bad}/{len(cases)})")
    return 0 if not bad else 1

def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        return self_test()
    if len(sys.argv) != 3:
        print(__doc__.split('HASZNALAT:')[1].strip(), file=sys.stderr)
        return 2
    core = open(sys.argv[1], encoding='utf-8').read()
    anchors = [l.strip() for l in open(sys.argv[2], encoding='utf-8')
               if l.strip() and not l.lstrip().startswith('#')]
    if not anchors:
        print("NINCS HORGONY a fajlban -- egy ures horgony-lista MINDIG atmenne. ALLJ.", file=sys.stderr)
        return 2
    miss = check(core, anchors)
    for a in anchors:
        print(('  OK       ' if a not in miss else '  HIANYZIK ') + a[:90])
    print(f"\n{len(anchors)-len(miss)}/{len(anchors)} horgony megvan a magban.")
    if miss:
        # A stdout-ot KI KELL URITENI eloszor: kulonben a figyelmeztetes a LISTA ELE kerul,
        # es egy rossz helyen megjeleno uzenetet az olvaso mashoz koti. (Merve az elso futason.)
        sys.stdout.flush()
        print("\nHIANYZO HORGONYOK -- es MIELOTT visszaallitasz: 2026-09-17-en HAROM hamis hiany", file=sys.stderr)
        print("volt, es MIND A HAROM a merobol jott, nem a munkabol. Nezd meg a SZOVEGET, mielott", file=sys.stderr)
        print("leletet irsz vagy visszaallitasz.", file=sys.stderr)
    return 1 if miss else 0

if __name__ == '__main__':
    sys.exit(main())

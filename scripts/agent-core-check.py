#!/usr/bin/env python3
"""agent-core-check.py -- minden AGENS-lap hordozza-e a teherhordo mondatokat? (kartya 2028900e)

MIERT: Isti dontese (2026-09-18) szerint minden agens a SAJAT lapjat olvassa, nem a kozoset.
Ettol a kozos lap megszunik halonak lenni: ami eddig egy helyen allt, annak MOST het helyen
kell allnia. Ez az ellenorzes az, ami a levalasztas ELOTT megmondja, hogy tenyleg ott van-e.

A KOORDINATOR-KIZARAS KIMONDVA, mert egy nema kizaras ugyanaz a hiba, mint egy nema veszteseg:
a `melyik agens PANELJE all uresen` a KOORDINATOR munkaja (o meri a flotta tetlenseget), nem
minden agense. Ezert NEM hianynak szamit egy agens-lapon. Barmi MAS hiany az.
"""
import importlib.util as u, sys, os

COORD_ONLY = ["melyik ágens PANELJE áll üresen"]
AGENTS = ['dexter','didi','computress','deeper','friday','jarvis','mandark']
ROOT = '/Users/isti/marveen'

sp = u.spec_from_file_location('cme', os.path.join(ROOT, 'scripts/claude-md-edit.py'))
m = u.module_from_spec(sp); sp.loader.exec_module(m)
required = [c for c in m.canary_lines() if c not in COORD_ONLY]

print(f"kotelezo mondat agens-laponkent: {len(required)}  "
      f"(a teljes kanari {len(m.canary_lines())}, ebbol {len(COORD_ONLY)} koordinator-only)\n")
bad = 0
for a in AGENTS:
    p = f'{ROOT}/agents/{a}/CLAUDE.md'
    try:
        s = open(p, encoding='utf-8').read()
    except FileNotFoundError:
        print(f"  {a:12} NINCS LAP"); bad += 1; continue
    miss = [c for c in required if c not in s]
    bad += 1 if miss else 0
    print(f"  {a:12} {len(s):8,} kar.  {len(required)-len(miss)}/{len(required)}"
          f"{'' if not miss else '   HIANYZIK: ' + ' | '.join(x[:38] for x in miss[:3])}")
# KONTROLL: a mero tudjon NEMET is mondani
ctl = [c for c in required if c not in "teljesen ures szoveg"]
print(f"\n  KONTROLL (ures szoveg): {len(ctl)}/{len(required)} hianyzana -> a mero diszkriminal")
print("\n" + ("MIND A HET LAP TELJES -- a levalasztas biztonsagos" if bad == 0
              else f"!!! {bad} LAP HIANYOS -- NE valaszd le oket"))
sys.exit(0 if bad == 0 else 3)

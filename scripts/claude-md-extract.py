#!/usr/bin/env python3
"""claude-md-extract.py -- egy ### blokk kivitele a kozos lapbol a rulebook archivumba.

ASSERT-THEN-DELETE (friday alakja, 2026-09-04): a blokk MEGLETET az archivumban ALLITJUK,
MIELOTT a magbol toroljuk. Forditva az ellenorzes arrol szol, ami TULELT, nem arrol, ami
elveszhetett -- ezert nez mindig jonak.

A mag helyere a hivo ad egy KONDENZALT szoveget. jarvis merese (2026-08-27): egy bontas
eldobhatja a TEHERHORDO mondatot, es a meret-kapu ezt SZERKEZETILEG nem latja -- ezert a
kondenzalt szoveg a hivo ITELETE, nem generalt.

Hasznalat:
  claude-md-extract.py --heading-file H --archive rulebook/x.md --core-file C [--dry-run]
"""
import argparse, fcntl, os, sys, re, time

PAGE = os.environ.get("CLAUDE_MD_PATH", "/Users/isti/marveen/CLAUDE.md")
ROOT = "/Users/isti/marveen"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--heading-file", required=True)
    ap.add_argument("--archive", required=True)
    ap.add_argument("--core-file", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    heading = open(a.heading_file, encoding="utf-8").read().strip("\n")
    core    = open(a.core_file, encoding="utf-8").read()
    arch    = a.archive if os.path.isabs(a.archive) else os.path.join(ROOT, a.archive)

    fd = os.open(PAGE, os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        with os.fdopen(os.dup(fd), encoding="utf-8") as f:
            s = f.read()

        if s.count(heading) != 1:
            print(f"NEM MOZGATTAM: a fejlec {s.count(heading)}-szer illeszkedik, 1 kell.", file=sys.stderr); return 65
        start = s.index(heading)
        # a blokk a kovetkezo ## vagy ### fejlecig tart
        # A blokk hatara egy KOVETKEZO fejlec VAGY egy GENERALT szakasz nyitasa. A masodik
        # ag KETSZER hianyzott (2026-09-18): a kivitel elvitte a `BEGIN GENERATED` jelolot,
        # es ARVA `END` maradt a lapon -- amit a kovetkezo generalas nemán elrontott volna.
        nxt = re.search(r'(?m)^(?:#{2,3}(?!#)\s|<!-- BEGIN GENERATED)', s[start+len(heading):])
        end = start + len(heading) + (nxt.start() if nxt else len(s)-start-len(heading))
        block = s[start:end]

        # egy DISZTINKT horgony a blokkbol, amin az assert fut (a leghosszabb sor)
        cand = [l.strip() for l in block.splitlines() if 40 < len(l.strip()) < 200]
        if not cand:
            print("NEM MOZGATTAM: nincs elég disztinkt sor az assert-hez", file=sys.stderr); return 66
        probe = max(cand, key=len)

        print(f"blokk: {len(block):,} kar.  ->  {a.archive}")
        print(f"mag helyere: {len(core):,} kar.   NYERESEG: {len(block)-len(core):+,}")

        # A KIVITEL IS NOVESZTHETI A LAPOT, ES KETSZER MEG IS TETTE (2026-09-18): a `##` szakasz
        # merete a KOVETKEZO `##`-ig szamol, a blokk viszont a kovetkezo `###`-nel VEGET er --
        # tehat egy kondenzalt mag, ami a lentebbi `###` alszakaszokat is osszefoglalja, DUPLIKAL.
        # Mindketszer en irtam, es a meret-kapu fogta meg, nem en. Ezert a kapu IDE is kell:
        # egy kivitel, ami NOVELI a lapot, majdnem biztosan duplikatum.
        if len(core) > len(block):
            print(f"NEM MOZGATTAM: a mag NAGYOBB a blokknal ({len(core):,} > {len(block):,}).", file=sys.stderr)
            print("  Ez tipikusan azt jelenti, hogy a mag olyan `###` alszakaszokat is osszefoglal,", file=sys.stderr)
            print("  amik a lapon LENTEBB MEG MEGVANNAK -- tehat duplikalnal. Ellenorizd a `###`", file=sys.stderr)
            print("  fejleceket a szakaszban, mielott ujraprobalod.", file=sys.stderr)
            return 68
        print(f"assert-horgony: {probe[:90]}")
        if a.dry_run:
            print("(dry-run, nem irtam)"); return 0

        # 1. ARCHIVUMBA
        os.makedirs(os.path.dirname(arch), exist_ok=True)
        pre = open(arch, encoding="utf-8").read() if os.path.exists(arch) else ""
        with open(arch, "a", encoding="utf-8") as f:
            if pre and not pre.endswith("\n"): f.write("\n")
            f.write(f"\n\n<!-- kivive a kozos CLAUDE.md-bol {time.strftime('%Y-%m-%d %H:%M')} "
                    f"(kartya 2028900e) -->\n{block.rstrip()}\n")

        # 2. ASSERT: tenyleg ott van-e, MIELOTT torolnenk
        got = open(arch, encoding="utf-8").read()
        if probe not in got:
            print("NEM TOROLTEM: az archivum NEM tartalmazza a horgonyt az iras utan.", file=sys.stderr); return 67
        print(f"assert OK: az archivum tartalmazza ({len(got):,} kar.)")

        # 3. KANARI: a kivitel NE vihessen el teherhordo mondatot. Ez a PATH okozta a
        # 2026-09-18-i veszteseget (Isti viselkedesi szabalyai), ezert itt is kell.
        new_s = s[:start] + core + s[end:]
        try:
            import importlib.util as _u
            _sp = _u.spec_from_file_location("_cme", os.path.join(os.path.dirname(os.path.abspath(__file__)), "claude-md-edit.py"))
            _m = _u.module_from_spec(_sp); _sp.loader.exec_module(_m)
            missing = _m.check_canary(new_s)
        except Exception as e:
            print(f"NEM TOROLTEM: a kanari-ellenorzes nem futott le ({type(e).__name__}) -- "
                  f"fail-closed, mert enelkul nem tudom, mit vinnel el.", file=sys.stderr)
            return 70
        if missing:
            print(f"NEM TOROLTEM: a kivitel {len(missing)} TEHERHORDO mondatot vinne el:", file=sys.stderr)
            for mm in missing:
                print(f"    - {mm}", file=sys.stderr)
            print("  (az archivumba MAR bekerult -- a lapot nem modositottam, tehat nincs vesztes)", file=sys.stderr)
            return 69
        os.lseek(fd, 0, 0); os.ftruncate(fd, 0); os.write(fd, new_s.encode("utf-8"))
        print(f"lap: {len(s):,} -> {len(new_s):,} ({len(new_s)-len(s):+,})")
        return 0
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)

if __name__ == "__main__":
    sys.exit(main())

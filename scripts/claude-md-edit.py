#!/usr/bin/env python3
"""claude-md-edit.py -- a kozos CLAUDE.md EGYETLEN irasi utja, meret-racsnival (kartya 30169f86).

MIERT LETEZIK. A lapot ketszer vagtuk le es ketszer nott vissza, MERVE:
    09-11 este  -37 292 kar. 105 perc alatt  ->  2 nap alatt +14 208 (a vagas 41%-a)
    09-17       242 966 -> 206 545           ->  EGY EJSZAKA alatt 245 325 (a TELJES nyereseg)
Egyik hozzaadas sem latszott irasakor tulzasnak. A problema az OSSZEG, es az osszeget SOHA nem
latja az, aki a kovetkezo bekezdest irja. Egy skill-fajlt (EGY olvaso) or ved; ezt a lapot
(NYOLC olvaso, tehat 8x koltseg) eddig SEMMI.

EZERT NEM FIGYELMEZTET, HANEM MEGTAGAD. A lap sajat merese: az "irj kevesebbet" SZANDEK ket meres
kozott nem mozditott semmit; a `exit 2` MECHANIZMUS ugyanaznap otszor teritette at a forgalmat.
Novekedeshez KIMONDOTT dontes kell (`--grow "<indok>"`), es az indok a naploba kerul.

RACSNI: az alapvonal csak SZORULHAT. alapvonal := min(mert, regi). Egy bontas nyeresege igy nem
valik novekedesi kerette -- ez a hiba MAR MEGTORTENT a skilleknel (549->491 vagas, 513 alapvonal
maradt, a fajl 528-ig nohetett volna hang nelkul).

KARAKTER, NEM BAJT. A `wc -c` bajtot szamol, es ezen a lapon minden ekezet 2 bajt -- egy meret-or,
ami bajtot jelent karakterkent, MAGA VOLT a mert defektus (38221eef). Itt: len(f.read()).

HORGONYOS CSERE, NEM SORSZAM. A horgony PONTOSAN egyszer illeszkedjen, kulonben megall.
FLOCK: ket agens percen belul irta mar ezt a fajlt.

Hasznalat:
  claude-md-edit.py --check
  claude-md-edit.py --anchor-file A --replace-file B      # A PONTOSAN egyszer illeszkedjen
  claude-md-edit.py --anchor-file A --replace-file B --grow "miert no"
  claude-md-edit.py --set-baseline --reason "bontas utan"
"""
import argparse, fcntl, os, subprocess, sys, time

PAGE = os.environ.get("CLAUDE_MD_PATH", "/Users/isti/marveen/CLAUDE.md")
BASE = os.environ.get("CLAUDE_MD_BASELINE", "/Users/isti/marveen/scripts/claude-md-baseline.txt")
LOG  = "/Users/isti/marveen/store/claude-md-size.log"

def size(p):
    with open(p, encoding="utf-8") as f:
        return len(f.read())

def read_baseline():
    try:
        with open(BASE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    return int(line.split()[0])
    except FileNotFoundError:
        return None
    return None

def write_baseline(n, reason):
    prev = read_baseline()
    # RACSNI: csak szorulhat, kiveve kimondott novelest (ott a hivo mar dontott)
    with open(BASE, "w", encoding="utf-8") as f:
        f.write("# A kozos CLAUDE.md meret-alapvonala KARAKTERBEN (kartya 30169f86).\n")
        f.write("# RACSNI: alapvonal := min(mert, regi). Novelni csak kimondott indokkal szabad.\n")
        f.write(f"# elozo: {prev}  uj: {n}  indok: {reason}\n")
        f.write(f"# {time.strftime('%Y-%m-%d %H:%M:%S %Z')}\n")
        f.write(f"{n}\n")
    return prev

CANARY = os.environ.get("CLAUDE_MD_CANARY", "/Users/isti/marveen/scripts/claude-md-canary.txt")

class CanaryUnavailable(RuntimeError):
    """A kanari-lista nem olvashato -- FAIL-CLOSED, nem ures lista."""


def canary_lines():
    """A teherhordo mondatok. HIANYZO FAJLRA KIVETELT DOB, NEM URES LISTAT.

    didi merte 2026-09-18, egyetlen valtozoval, a FUTO valtozaton:
        letezo kanarival ... rc=69, NEM irt
        a fajl hianyzik .... `OK: 53 -> 32 karakter` -- a teherhordo sor ELTUNT,
                             a kapu SIKERT jelentett, es a racsni meg szorult is
    Vagyis az ures lista a MEGNYUGTATO iranyba degradalt: a `--check` sem fogta meg.
    Ez a lap sajat torvenye -- egy or, ami ROSSZ SZAMMA degradalodik, rosszabb annal,
    amelyik MEGTAGADJA --, a sajat oromon. Es a hordozo is lelet volt: a fajl
    KOVETETLEN allt (`git ls-files` -> 0; kontroll: a baseline-fajl KOVETETT), tehat
    egy `git clean` vagy egy uj gep nyomtalanul elvitte volna a vedelmet.
    """
    try:
        with open(CANARY, encoding="utf-8") as f:
            lines = [l.rstrip("\n") for l in f
                     if l.strip() and not l.lstrip().startswith("#")]
    except OSError as e:
        raise CanaryUnavailable(
            f"a kanari-lista NEM OLVASHATO ({CANARY}): {e}. "
            f"Egy hianyzo lista NEM ures lista -- nem tudom, mit vinnel el, tehat nem irok.") from e
    if not lines:
        raise CanaryUnavailable(
            f"a kanari-lista URES ({CANARY}). Ha tenyleg nincs vedendo mondat, az DONTES -- "
            f"irj bele egy kommentet es legalabb egy sort.")
    return lines

def check_canary(text):
    """A HIANYZO teherhordo mondatok listaja. Ures lista = minden megvan."""
    return [c for c in canary_lines() if c not in text]

def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--anchor-file"); ap.add_argument("--replace-file")
    ap.add_argument("--grow"); ap.add_argument("--set-baseline", action="store_true")
    ap.add_argument("--reason", default="")
    a = ap.parse_args()

    cur = size(PAGE); base = read_baseline()

    if a.check:
        print(f"CLAUDE.md: {cur:,} karakter")
        if base is None:
            print("alapvonal: NINCS -- allitsd be: --set-baseline --reason '...'"); return 0
        d = cur - base
        print(f"alapvonal: {base:,}   kulonbseg: {d:+,}")
        print("OK, a plafon alatt." if d <= 0 else f"A LAP {d:,} KARAKTERREL A PLAFON FOLOTT.")
        return 0 if d <= 0 else 3

    if a.set_baseline:
        if not a.reason:
            print("NEM ALLITOTTAM: --reason kotelezo (a racsni indoka naploba kerul)", file=sys.stderr); return 64
        prev = write_baseline(cur if base is None else min(cur, base), a.reason)
        new = read_baseline()
        print(f"alapvonal: {prev} -> {new}  ({a.reason})")
        log(f"BASELINE {prev} -> {new} :: {a.reason}")
        return 0

    if not (a.anchor_file and a.replace_file):
        print("NEM IRTAM: --anchor-file es --replace-file kell (vagy --check / --set-baseline)", file=sys.stderr); return 64

    anchor = open(a.anchor_file, encoding="utf-8").read()
    repl   = open(a.replace_file, encoding="utf-8").read()
    if not anchor:
        print("NEM IRTAM: ures horgony -- az mindenre illeszkedik", file=sys.stderr); return 64

    fd = os.open(PAGE, os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        with os.fdopen(os.dup(fd), encoding="utf-8") as f:
            s = f.read()
        n = s.count(anchor)
        if n != 1:
            print(f"NEM IRTAM: a horgony {n}-szer illeszkedik, PONTOSAN 1 kell.", file=sys.stderr)
            return 65
        new_s = s.replace(anchor, repl)
        new_n = len(new_s)
        if base is not None and new_n > base and not a.grow:
            print(f"NEM IRTAM: {len(s):,} -> {new_n:,}, az alapvonal {base:,}.", file=sys.stderr)
            print(f"  A valtozas {new_n - base:,} karakterrel vinne a plafon fole.", file=sys.stderr)
            print("  Ez NYOLC olvasot terhel minden fordulóban, nem egyet.", file=sys.stderr)
            print("  Ha tenyleg uj MERT alak (nem atfogalmazas): --grow \"<indok>\"", file=sys.stderr)
            log(f"REFUSED {len(s)} -> {new_n} (baseline {base})")
            return 2
        # KANARI: a teherhordo mondatok NE tunhessenek el egy vagassal. 2026-09-18-an egy
        # blokk kivitele elvitte Isti viselkedesi szabalyait, es csak veletlenul vettem eszre.
        try:
            missing = check_canary(new_s)
        except CanaryUnavailable as e:
            print(f"NEM IRTAM: {e}", file=sys.stderr)
            return 70
        if missing:
            print(f"NEM IRTAM: a valtozas {len(missing)} TEHERHORDO mondatot vinne el:", file=sys.stderr)
            for m in missing:
                print(f"    - {m}", file=sys.stderr)
            print("  Ezek a `scripts/claude-md-canary.txt`-ben vannak felsorolva. Ha egy sor", file=sys.stderr)
            print("  SZANDEKOSAN valtozik, eloszor a kanari-listat javitsd, aztan a lapot.", file=sys.stderr)
            log(f"CANARY REFUSED: {missing}")
            return 69
        os.lseek(fd, 0, 0); os.ftruncate(fd, 0)
        os.write(fd, new_s.encode("utf-8"))
        print(f"OK: {len(s):,} -> {new_n:,} karakter ({new_n - len(s):+,})")
        # MINDEN irast naplozunk merettel. didi merte 2026-09-18: a snapshot-hook 60 PERCES
        # lyukat hagyott PONT a vagas folott (21:23:40 -> 22:23:56), tehat a lap merete egy adott
        # percben nem volt visszakereshero -- es emiatt egy pont-becslesbol BRACKET lett
        # (1,70-2,36 kar/token 2,0 helyett). Egy sor ide olcsobb, mint egy elveszett meres.
        log(f"WRITE {len(s)} -> {new_n} ({new_n - len(s):+d})")
        if a.grow:
            print(f"NOVEKEDES KIMONDVA: {a.grow}")
            log(f"GROW {len(s)} -> {new_n} :: {a.grow}")
            write_baseline(new_n, f"kimondott noveles: {a.grow}")
        elif base is not None and new_n < base:
            write_baseline(new_n, "racsni: csokkenes utan automatikusan szorul")
            print(f"alapvonal szorult: {base:,} -> {new_n:,}")
        return 0
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)

if __name__ == "__main__":
    sys.exit(main())

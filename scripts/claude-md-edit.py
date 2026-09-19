#!/usr/bin/env python3
"""claude-md-edit.py -- a kozos CLAUDE.md EGYETLEN irasi utja, meret-racsnival (kartya 30169f86).

MIERT LETEZIK. A lapot ketszer vagtuk le es ketszer nott vissza, MERVE:
    09-11 este  -37 292 kar. 105 perc alatt  ->  2 nap alatt +14 208 (a vagas 41%-a)
    09-17       242 966 -> 206 545           ->  EGY EJSZAKA alatt 245 325 (a TELJES nyereseg)
Egyik hozzaadas sem latszott irasakor tulzasnak. A problema az OSSZEG, es az osszeget SOHA nem
latja az, aki a kovetkezo bekezdest irja. Egy skill-fajlt (EGY olvaso) or ved; ezt a lapot
(EGY olvaso: a koordinator sessionje -- a flotta agensei a SAJAT lapjukat toltik, lasd
lent) eddig SEMMI.

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
# A LOG-ot is env-bol lehet feluldefinialni. didi merte 2026-09-18 (kartya 144cb784):
# a `PAGE`/`BASE`/`CANARY` mind feluldefinialhato volt, a `LOG` NEM -- tehat a proba-futasok
# a VALODI naplóba irtak (`WRITE 73 -> 51`, `53 -> 32`), mikozben a lap 196 190 karakteren allt.
# Ez pont azt a kerdest teszi megvalaszolhatatlanna, amiert a naplo letezik: a lap
# meret-tortenetet. Egy mero, aminek a PROBAJA meghamisitja a mert mennyiseget.
LOG  = os.environ.get("CLAUDE_MD_LOG", "/Users/isti/marveen/store/claude-md-size.log")

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

def baseline_uncommitted(base_path=None):
    """Az alapvonal-fajl elter-e a HEAD-tol? Egy sor, es a SZERKESZTES UTAN tuzel.

    MIERT LETEZIK (merve 2026-09-19, KETSZER UGYANAZON A NAPON). Ez a fajl a racsni
    OPERATIV erteke, es a szerszam MINDEN szerkesztesnel ujrairja -- a FO CHECKOUTBA, ahol a
    `prod-tree-guard` a commitot TILTJA. Tehat konstrukciobol gyulik: reggel 22 794 karakternyi
    szoritas allt egyetlen commitolatlan munkafa-fajlban, delelott ujabb 3 544 negy kimondott
    novekedesbol. Mindket alkalommal MAS vette eszre, nem a szerszam.

    Ez az "otodik allapot" egy valtozata: nem egy elfelejtett fajl, hanem egy MINDEN
    HASZNALATTAL UJRATERMELODO allapot. Fegyelemmel nem javithato, mert nem a figyelem fogy el,
    hanem a commit-lehetoseg hianyzik ott, ahol az ertek keletkezik.

    NEM BLOKKOL, es ez szandekos: a szerkesztes mar megtortent, a lap mar helyes. Ami hianyzik,
    az a TARTOSSAG -- es egy `exit`, ami egy sikeres irast hibanak mutat, rosszabb a resnel.
    """
    import subprocess as _sp, os as _os
    p = base_path or BASE
    try:
        root = _sp.run(["git", "-C", _os.path.dirname(p) or ".", "rev-parse", "--show-toplevel"],
                       capture_output=True, text=True, timeout=10)
        if root.returncode != 0:
            # NEM `None`. A "nem tudom megmondani" es a "rendben van" KET KULONBOZO allitas, es
            # a `None` a hivonal "rendben"-kent olvasodik -- a MEGNYUGTATO iranyba. Merve
            # 2026-09-19: a sajat pozitiv kontrollom egy repon KIVULI fajlra "commitolva: igen"-t
            # adott, tehat a detektor NEM TUDOTT tuzelni, es ezt nem mondta meg.
            return "NEM MERHETO: az alapvonal-fajl nincs git-repoban"
        top = root.stdout.strip()
        rel = _os.path.relpath(p, top)
        head = _sp.run(["git", "-C", top, "show", f"HEAD:{rel}"],
                       capture_output=True, text=True, timeout=10)
        if head.returncode != 0:
            return "a fajl NINCS a HEAD-en"
        with open(p, encoding="utf-8") as f:
            cur = f.read()
        if cur != head.stdout:
            def _val(t):
                for line in t.splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        return line.split()[0]
                return "?"
            cv, hv = _val(cur), _val(head.stdout)
            # A MONDAT NE ALLITSON OLYAN OSSZEVETEST, AMIT NEM VEGZETT EL (deeper torvenye):
            # a tartalom elterhet ugy is, hogy a SZAM azonos -- egy kommentsor eleg hozza. Ha
            # ilyenkor "munkafa X kontra HEAD X"-et irnank, az olvaso egy nem letezo
            # szam-eltereset keresne, es a valodi ok (a fajl tobbi resze) sehol nem latszana.
            if cv == hv:
                return f"a szam AZONOS ({cv}), de a fajl TARTALMA elter a HEAD-tol"
            return f"munkafa {cv} kontra HEAD {hv}"
        return None
    except Exception as e:
        return f"NEM MERHETO: {type(e).__name__}"


def check_generated_markers(path=None):
    """A GENERALT blokkok BEGIN/END jeloloi parban es SORRENDBEN alljanak.

    MIERT LETEZIK (merve 2026-09-19). A `claude-md-extract.py` 2026-09-18-an KETSZER
    elvitte egy generalt blokk `BEGIN` jelolojet, es ARVA `END` maradt a lapon. A szkriptet
    kijavitottak (a `BEGIN GENERATED` ma blokk-hatar), de a TORMELEKET senki nem takaritotta
    ki -- es a defektus HATASA ettol meg elt:

        a kovetkezo dashboard-ujrainditas nem talalt ervenyes BEGIN..END part,
        ugy dontott, hogy a blokk HIANYZIK, es UJRA HOZZAFUZTE a lap vegehez.
        +2019 karakter, a meret-racsni MEGKERULESEVEL, es a naploban RES marad,
        mert ez az ut nem ezen a szkripten at ir.

    Vagyis a lap NEMAN nott minden ujrainditaskor. Ez a legvaloszinubb magyarazat arra,
    amit a modul fenti docblockja rogzit: hogy a lapot ketszer levagtuk es ketszer visszanott.

    A javitas ott ment, ahol a hibat BEJELENTETTEK (a kivonatolo), es soha nem futott le
    ujra az a meres, amelyik a leletet MEGTALALTA (a lap allapota). Ezert all ez itt: a
    `--check` MINDEN hivasnal ujrafuttatja azt a merest.

    A KONTROLL, ami ingyen van: a HIBA IRANYA a megnyugtato. Egy arva `END` semmit nem tor
    el -- a lap olvashato marad, a szoveg a helyen van, es csak a KOVETKEZO generalaskor
    derul ki, akkor is csak egy meret-ugrasbol, amit senki nem nez.
    """
    import re as _re
    with open(path or PAGE, encoding="utf-8") as f:
        s = f.read()
    jelolok = [(m.group(1), m.group(2).split(" (")[0], m.start())
               for m in _re.finditer(r"<!-- (BEGIN|END) GENERATED: ([^>]+?) -->", s)]
    bajok = []
    nevek = sorted({n for _, n, _ in jelolok})
    for nev in nevek:
        sajat = [(t, o) for t, n, o in jelolok if n == nev]
        be = [o for t, o in sajat if t == "BEGIN"]
        en = [o for t, o in sajat if t == "END"]
        if len(be) != 1 or len(en) != 1:
            bajok.append(f"{nev}: BEGIN={len(be)} END={len(en)} (1-1 kell)")
        elif en[0] < be[0]:
            bajok.append(f"{nev}: az END a BEGIN ELOTT all (offset {en[0]} < {be[0]})")
    return nevek, bajok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--anchor-file"); ap.add_argument("--replace-file")
    ap.add_argument("--grow"); ap.add_argument("--set-baseline", action="store_true")
    ap.add_argument("--reason", default="")
    a = ap.parse_args()

    # A `--grow` ELLENORZESE ITT ALL, A PARSE UTAN, ES NEM AZ IRAS MELLETT.
    # Elso alakjaban a kapu az iras UTAN tuzelt: helyes hibauzenetet adott, exit 5-ot
    # adott -- es a lap KOZBEN MAR AT VOLT IRVA. Egy or, ami pontosan jelent es kesve
    # cselekszik, a kart nem elozi meg, csak dokumentalja. A sajat tesztje fogta meg.
    #
    # MIERT LETEZIK (marveen magan, 2026-09-19): harom novekedest `--grow 430`,
    # `--grow 338`, `--grow 683` alakban hivtam meg -- a szam kezenfekvobb volt --, es a
    # valodi indokot a `--reason`-be irtam, amit az iras-ag SOSEM OLVAS. A naploba igy
    # szam kerult oda, ahol korabban tobb mondatos indoklas all, es egy szam abban az
    # oszlopban HIHETONEK latszik. A meret a fajlbol visszamerheto; az INDOK nem.
    if a.grow:
        _csak_szam = lambda x: x.replace(",", "").replace(" ", "").isdigit()
        indok = a.grow.strip()
        if a.reason.strip() and (_csak_szam(indok) or len(indok) < 25):
            # A hivo LEIRTA az indokot, csak rossz kapcsoloba. Ne dobjuk el.
            indok = a.reason.strip() if _csak_szam(indok) else f"{indok} -- {a.reason.strip()}"
        if _csak_szam(indok):
            print("NEM IRTAM: a --grow az INDOK SZOVEGE, nem a novekmeny szama.", file=sys.stderr)
            print(f"  Kaptam: {a.grow!r}. A meret a fajlbol barmikor visszamerheto; az OK nem.", file=sys.stderr)
            print('  Helyesen: --grow "miert no a lap, egy MERT alakkal"', file=sys.stderr)
            sys.exit(5)
        if len(indok) < 25:
            print(f"NEM IRTAM: a --grow indoka tul rovid ({len(indok)} karakter, a minimum 25).", file=sys.stderr)
            print("  Egy indok, amit a kovetkezo olvaso nem tud ertelmezni, nem indok.", file=sys.stderr)
            sys.exit(5)
        a.grow = indok

    cur = size(PAGE); base = read_baseline()

    if a.check:
        print(f"CLAUDE.md: {cur:,} karakter")
        if base is None:
            print("alapvonal: NINCS -- allitsd be: --set-baseline --reason '...'"); return 0
        d = cur - base
        print(f"alapvonal: {base:,}   kulonbseg: {d:+,}")
        print("OK, a plafon alatt." if d <= 0 else f"A LAP {d:,} KARAKTERREL A PLAFON FOLOTT.")
        drift = baseline_uncommitted()
        print(f"alapvonal commitolva: {'NEM -- ' + drift if drift else 'igen'}")
        nevek, bajok = check_generated_markers()
        print(f"generalt blokk: {len(nevek)} ({', '.join(nevek) if nevek else 'nincs'})")
        if bajok:
            for b in bajok:
                print(f"  JELOLO-HIBA: {b}", file=sys.stderr)
            print("  Egy arva jelolo a KOVETKEZO ujrainditaskor UJRA HOZZAFUZI a blokkot,", file=sys.stderr)
            print("  a racsni megkerulesevel. Javitsd, mielott a lapot tovabb szerkeszted.", file=sys.stderr)
            return 4
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
            # MERVE 2026-09-19: EZ A LAP EGY OLVASOT TERHEL, NEM NYOLCAT.
            # Itt tizenket napig az allt, hogy "NYOLC olvasot terhel minden fordulóban".
            # HAMIS 2026-09-07 ota: a flotta agensei akkor koltoztek ki a
            # /Users/isti/marveen hierarchiabol (Deeper 265,4k betoltott lapja = a sajat
            # ablakanak 133%-a), es azota a /Users/Shared/marveen-<nev>/ alatt futnak, ahol
            # a SAJAT lapjukat toltik. Merve mind a HET agensre a nyilvantartasbol
            # (agents/*/), nem nev-mintabol: 39 135 .. 143 026 karakter, es a fo lap szovege
            # EGYIKBEN SINCS benne (kontroll: a fo lapon 1 talalat).
            #
            # A DONTES (szorits, ha lehet) VALTOZATLAN -- de az INDOKA nem a 8x koltseg,
            # hanem hogy ez a 179 e karakter EGY session ablakabol megy el, es az a session
            # az, amelyik a flottat routeolja. A kovetkezo dontest az INDOKBOL hozzak.
            print("  Ez a lap EGY olvasot terhel -- a koordinator sessionjet -- minden fordulóban.", file=sys.stderr)
            print("  (A flotta tobbi agense a SAJAT lapjat tolti, /Users/Shared/marveen-<nev>/.)", file=sys.stderr)
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
        drift = baseline_uncommitted()
        if drift:
            print(f"FIGYELEM: az alapvonal COMMITOLATLAN ({drift}).", file=sys.stderr)
            print("  A racsni operativ erteke egy munkafa-fajlban all. Egy agvaltas elviszi.",
                  file=sys.stderr)
            print("  Commitold, vagy vidd worktree-be. (Ez NEM hiba: az iras sikerult.)",
                  file=sys.stderr)
        return 0
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)

if __name__ == "__main__":
    sys.exit(main())

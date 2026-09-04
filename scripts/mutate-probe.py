#!/usr/bin/env python3
"""mutate-probe.py -- egy mutacios proba TOBB KONTROLLAL, HAROM kilepesi koddal.

A KONTROLLOK SZAMA SZANDEKOSAN NEM ALL ITT: szamold meg a lentebbi
"N. KONTROLL" blokkokat. Ez a cim "HAROM kontrollal"-t mondott, mikozben a torzse
mar egy NEGYEDIKET (fedettseg) es egy OTODIKET (a SIGKILL-t tulelo jelzo) is
dokumental -- a letrehozo commit (`41a9e43`) sajat targysora is OTOT mond. friday
2026-09-04-en EBBOL a cimbol adta tovabb tevesen, hogy az eszkoznek harom kontrollja
van. A szam eltavolitasa nem kozmetika: igy nincs mi elavuljon a kovetkezo
hozzatoldaskor. (A HAROM KILEPESI KOD marad, mert az szerkezeti -- harom konstans.)

MIERT LETEZIK. Egy mutacios proba akkor er valamit, ha a ZOLD eredmeny EGY dolgot
jelent. 2026-08-24-en egy nap alatt HAROM kulonbozo mechanizmus adott zoldet
ugyanazon a fan, es csak az egyik volt lelet:

    (a) a teszt tenyleg nem allit semmit a mutalt sorrol   -> LELET
    (b) a mutacio NEM ALKALMAZODOTT (rossz behuzas, tipus-sor, tobbsoros
        kifejezes, nem illeszkedo minta)                    -> ERVENYTELEN PROBA
    (c) a mutacio a BETOLTEST torte el, tehat a tesztek EL SEM INDULTAK
        (a futott darabszam CSOKKENT)                       -> ERVENYTELEN PROBA

A (b) negyszer fordult elo egyetlen napon, es mindannyiszor egy zold futas
kovette, amit majdnem leletnek olvastunk. A (c) egyszer: egy kontroll 4172
helyett 4153 tesztet futtatott, es a "zold" semmit nem allitott.

Ezert a kimenet HAROM allapot, nem ketto:
    0 = a mutacio DISZKRIMINAL  (a teszt megfogja -> a sor VEDVE van)
    1 = TULELTE                 (a teszt nem allit rola semmit -> LELET)
    2 = ERVENYTELEN PROBA       (a PROBAVAL van baj, nem a teszttel)

A ketto kozotti kulonbseg a lenyeg: a 2 azt mondja, hogy MEG NEM TUDJUK.

A NEGYEDIK KONTROLL, computress otlete (Delta-CRM, mutate-probe.py): a mutalt
sornak FEDETTNEK kell lennie a lefedettsegi riport szerint. Egy soha le nem futo
sor mutacioja termeszetesen tulel -- az a valasz csak azt mondja vissza, amit mar
tudtunk. Opcionalis, mert lefedettsegi riport nem mindig van kez alatt.

AZ OTODIK KONTROLL: A `finally` NEM ELI TUL A KILLT (merve, 2026-08-27).
A visszaallitas eddig egyetlen `finally`-n allt. Az egy KIVETELT tul-el, egy
SIGKILL-t nem -- a context-guard pedig pont oli a panelt, ha telitodik. 2026-08-27
reggel a friday-probe2 munkafaban BENN MARADT egy mutacio (schedule-runner.ts:600,
`!sessionExistsOnHost` -> `sessionExistsOnHost`): a polaritas megforditva, a `git
status` egyetlen ` M` sora mellett, ami egy szerkesztestol megkulonboztethetetlen.

Ezert a mutacio ELOTT egy JELZO-FAJL keletkezik a cel MELLETT, benne az EREDETI
szoveggel:  <fajl>.mutate-probe-inflight.json
  - a visszaallitas utan TORLODIK, tehat a letezese onmagaban azt jelenti, hogy
    egy proba FELBESZAKADT, es a fan MUTALT kod all
  - a kovetkezo proba ELUTASITJA az indulast, amig ez ott van (nem hallgat rola)
  - `--recover` visszaallit belole, `--check` megkeresi az egesz fan
A jelzo SZANDEKOSAN a forrasfajl mellett all, nem a temp-ben: igy a `git status`
egy ISMERETLEN fajlt is mutat a modositott forras mellett -- ket fuggetlen jel ott,
ahol az ember amugy is nez.

A HORGONY ES A CSERE FAJLBOL JON, NEM ARGUMENTUMBOL. Szabad szoveg
hej-argumentumkent parancshelyettesitesre fut (visszaperjel, $), es NEMAN csonkul
-- 2026-08-24-en ugyanez a mechanizmus futtatott le egy `npm ci`-t egy ELO
telepitesben es kiuritette a node_modules-t.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

OK_DISCRIMINATES = 0
SURVIVED = 1
INVALID_PROBE = 2

# Sor-eleji komment-alakok. A horgony ellenorzesehez kell: egy kommentben talalt
# horgony nem kod, es egy ra epulo proba a sajat magyarazatat mutalna.
COMMENT_PREFIXES = ("//", "#", "*", "/*")


def strip_comment_lines(text: str) -> str:
    """A sor-eleji kommenteket URES sorra csereli -- a SORSZAMOZAS marad."""
    out = []
    for line in text.split("\n"):
        out.append("" if line.lstrip().startswith(COMMENT_PREFIXES) else line)
    return "\n".join(out)


# Az OSSZEGZO sor, SOR ELEJERE horgonyozva: `Tests  9 passed | 1 failed (10)`.
#
# MIERT NEM ELEG a `.split("Tests")[-1]` (merve 2026-08-27, ez a szerszam adott
# rossz verdiktet tole): a vitest a bukas-reszletezot a STDERR-re irja, az
# osszegzot a STDOUT-ra, es a ketto osszefuzese utan az UTOLSO "Tests" elofordulas
# a `--- Failed Tests 1 ---` BANNERBEN van, nem az osszegzoben. A probа igy a
# ` 1 ---` sztringben kereste a "failed" szot, nem talalta, es HAROM valodi
# leletet jelentett TULELTNEK. Az iranya a rosszabbik: egy mukodo teszt-keszletrol
# allitotta, hogy nem allit semmit.
SUMMARY_RX = re.compile(r"^[^\S\n]*Tests[^\S\n]+(.*)$", re.M)


def summary_line(out: str) -> str | None:
    """A LEGUTOLSO olyan `Tests ...` sor, ami tenyleg osszegzes.

    A banner (`--- Failed Tests 1 ---`) nem sor eleji, es nincs benne darabszam-
    kulcsszo -- mindket szures kell, mert a banner behuzasa valtozhat.
    """
    hits = [m.group(1).strip() for m in SUMMARY_RX.finditer(out)]
    hits = [h for h in hits if any(k in h for k in ("passed", "failed", "skipped", "no tests"))]
    return hits[-1] if hits else None


def count_tests(cmd: str, cwd: Path) -> tuple[int | None, str]:
    """A futtato kimenetebol kiolvassa az OSSZLETSZAMOT.

    A `Tests  N passed (M)` alak M-je a GYUJTOTT szam -- ez az, aminek nem szabad
    csokkennie. Ha nem talalunk ilyet, `None`-t adunk vissza: a hianyzo szam NEM
    nulla, es nem is 'rendben'.
    """
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    out = r.stdout + r.stderr
    line = summary_line(out)
    m = re.search(r"\((\d+)\)", line) if line else None
    return (int(m.group(1)) if m else None), out


def line_is_covered(report: Path, target: Path, lineno: int) -> bool | None:
    """Fedett-e a sor a v8/istanbul json-summary riport szerint.

    `None` = nem tudjuk (nincs riport, vagy a fajl nincs benne). A 'nem tudjuk'
    SOSEM szamit fedettnek.
    """
    try:
        data = json.loads(report.read_text())
    except Exception:
        return None
    key = next((k for k in data if Path(k).resolve() == target.resolve()), None)
    if key is None:
        return None
    stmt_map = data[key].get("statementMap") or {}
    counts = data[key].get("s") or {}
    for sid, loc in stmt_map.items():
        if loc.get("start", {}).get("line") == lineno:
            return counts.get(sid, 0) > 0
    return None


SENTINEL_SUFFIX = ".mutate-probe-inflight.json"


def sentinel_for(target: Path) -> Path:
    return target.with_name(target.name + SENTINEL_SUFFIX)


def sentinel_write(target: Path, original: str, anchor: str) -> Path:
    """A mutacio ELOTT: eredeti szoveg + kontextus a cel MELLE."""
    s = sentinel_for(target)
    s.write_text(json.dumps({
        "file": str(target),
        "original": original,
        "anchor": anchor,
        "pid": os.getpid(),
        "started_at": datetime.now().isoformat(timespec="seconds"),
    }, ensure_ascii=False))
    return s


def sentinel_restore(sent: Path) -> tuple[bool, str]:
    """Visszaallit egy felbeszakadt probat. (sikerult, uzenet)"""
    try:
        data = json.loads(sent.read_text())
        target = Path(data["file"])
        original = data["original"]
    except Exception as e:
        return False, f"a jelzo olvashatatlan ({sent}): {e}"
    if not target.is_file():
        return False, f"a cel-fajl eltunt: {target}"
    if target.read_text() == original:
        sent.unlink()
        return True, f"{target} MAR az eredeti volt -- a jelzot toroltem"
    target.write_text(original)
    sent.unlink()
    return True, f"{target} visszaallitva ({data.get('started_at', '?')} ota allt mutalva)"


def sentinel_scan(root: Path) -> list[Path]:
    """Felbeszakadt probak a fan. A node_modules es a .git KIMARAD."""
    skip = {"node_modules", ".git", "dist", ".next", "coverage"}
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip]  # a nagy fak METSZVE
        for f in filenames:
            if f.endswith(SENTINEL_SUFFIX):
                out.append(Path(dirpath) / f)
    return sorted(out)


def fail(msg: str) -> int:
    print(f"ERVENYTELEN PROBA: {msg}", file=sys.stderr)
    return INVALID_PROBE


def main() -> int:
    p = argparse.ArgumentParser(description="Egy mutacios proba harom kontrollal.")
    p.add_argument("--file", help="a mutalando forrasfajl")
    p.add_argument("--anchor-file", help="a horgony SZOVEGE, fajlbol")
    p.add_argument("--replacement-file", help="a csere SZOVEGE, fajlbol")
    p.add_argument("--cmd", default=os.environ.get("MUTATE_PROBE_CMD", "npx vitest run"),
                   help="a teszt-futtato parancs (env: MUTATE_PROBE_CMD)")
    p.add_argument("--coverage", default=os.environ.get("MUTATE_PROBE_COV"),
                   help="json-summary riport a fedettseg-kontrollhoz (env: MUTATE_PROBE_COV)")
    p.add_argument("--cwd", default=".", help="a futtatas konyvtara")
    p.add_argument("--recover", action="store_true",
                   help="egy felbeszakadt proba visszaallitasa a jelzo-fajlbol, futtatas nelkul")
    p.add_argument("--check", action="store_true",
                   help="felbeszakadt probak keresese a fan (--cwd alatt), futtatas nelkul")
    a = p.parse_args()

    cwd = Path(a.cwd).resolve()

    # --- --check: az egesz fa, meg mielott barmit tennenk ---
    if a.check:
        left = sentinel_scan(cwd)
        if not left:
            print(f"nincs felbeszakadt proba {cwd} alatt")
            return OK_DISCRIMINATES
        for s_ in left:
            print(f"FELBESZAKADT PROBA: {s_}", file=sys.stderr)
        print(f"{len(left)} felbeszakadt proba -- `--recover` allitja vissza", file=sys.stderr)
        return INVALID_PROBE

    if not a.file:
        return fail("a --file kotelezo (kiveve `--check`)")
    target = Path(a.file)
    if not target.is_absolute():
        target = cwd / target
    if not target.is_file():
        return fail(f"a fajl nem letezik: {target}")

    sent = sentinel_for(target)
    if a.recover:
        if not sent.is_file():
            print(f"nincs mit visszaallitani: {sent} nem letezik")
            return OK_DISCRIMINATES
        ok, msg = sentinel_restore(sent)
        print(("VISSZAALLITVA: " if ok else "NEM SIKERULT: ") + msg, file=sys.stdout if ok else sys.stderr)
        return OK_DISCRIMINATES if ok else INVALID_PROBE
    if sent.is_file():
        return fail(
            f"EGY KORABBI PROBA FELBESZAKADT es a fan MUTALT kod allhat ({sent}). "
            f"Allitsd vissza eloszor:  {Path(sys.argv[0]).name} --file {a.file} --recover"
        )

    if not a.anchor_file or not a.replacement_file:
        return fail("a --anchor-file es a --replacement-file kotelezo (kiveve `--check` / `--recover`)")
    anchor = Path(a.anchor_file).read_text().rstrip("\n")
    replacement = Path(a.replacement_file).read_text().rstrip("\n")
    if not anchor:
        return fail("a horgony URES")

    original = target.read_text()

    # --- 1. KONTROLL: a horgony pontosan egyszer, NEM kommentben, es a csere
    #     nem tartalmazza (kulonben a mutacio no-op) ---
    code_only = strip_comment_lines(original)
    hits = code_only.count(anchor)
    if hits == 0:
        in_comment = original.count(anchor)
        extra = " (csak KOMMENTBEN szerepel)" if in_comment else ""
        return fail(f"a horgony nem talalhato a KODBAN{extra}")
    if hits > 1:
        return fail(f"a horgony {hits}-szor szerepel a kodban -- nem egyertelmu, melyiket mutalnank")
    if anchor in replacement:
        return fail("a csere TARTALMAZZA a horgonyt -- a mutacio no-op lenne")

    lineno = code_only[: code_only.index(anchor)].count("\n") + 1

    # --- 4. KONTROLL (opcionalis): a mutalt sor legyen FEDETT ---
    if a.coverage:
        covered = line_is_covered(Path(a.coverage), target, lineno)
        if covered is None:
            return fail(f"a fedettseg nem allapithato meg a(z) {a.file}:{lineno} sorra")
        if not covered:
            return fail(f"a(z) {a.file}:{lineno} sor NEM FEDETT -- a tulelese semmit nem allitana")

    # --- alapvonal: a mutacio ELOTTI darabszam ---
    base_n, _ = count_tests(a.cmd, cwd)
    if base_n is None:
        return fail("az alapvonal darabszama nem olvashato ki a futtato kimenetebol")

    # --- 5. KONTROLL: a jelzo a mutacio ELOTT keletkezik, es CSAK a sikeres
    #     visszaallitas utan tunik el. Ha a folyamatot megoljak, ez marad a fan.
    sentinel_write(target, original, anchor)
    target.write_text(original.replace(anchor, replacement, 1))
    try:
        mut_n, mut_out = count_tests(a.cmd, cwd)
    finally:
        target.write_text(original)  # a forras MINDIG visszaall
        sent.unlink(missing_ok=True)  # ...es CSAK ezutan tunik el a jelzo

    # --- 2. KONTROLL: az osszletszam ne csokkenjen ---
    if mut_n is None:
        return fail("a mutalt futas darabszama nem olvashato ki -- valoszinuleg el sem indult")
    if mut_n < base_n:
        return fail(f"az osszletszam CSOKKENT ({base_n} -> {mut_n}) -- a mutacio a BETOLTEST torte el")

    summary = summary_line(mut_out) or ""
    if "failed" in summary:
        print(f"DISZKRIMINAL: {a.file}:{lineno} -- a teszt megfogja a mutaciot ({base_n} teszt)")
        return OK_DISCRIMINATES
    print(f"TULELTE: {a.file}:{lineno} -- a teszt NEM allit rola semmit ({base_n} teszt)")
    return SURVIVED


if __name__ == "__main__":
    sys.exit(main())

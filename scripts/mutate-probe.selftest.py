#!/usr/bin/env python3
"""mutate-probe.selftest.py -- a proba SAJAT fixture-jein, vitest nelkul.

Egy szerszam, ami a "zold haromfelet jelenthet" problemat oldja meg, nem
bizonyithatja magat egy zold futassal. Ezert mind a HAROM kilepesi kodra van
eset, ES a negy ERVENYTELEN-agra kulon-kulon -- kulonben a 2-es kod ugyanaz a
gyujto-fiok lenne, mint amit meg akar szuntetni.

A "teszt-futtato" itt egy nehany soros szkript, ami a forrasfajlt olvassa: ha a
mutalt szoveg benne van, PIROSAT ir, kulonben ZOLDET. Igy a proba viselkedese
merheto anelkul, hogy barmilyen valodi keszlet kellene hozza.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

PROBE = Path(__file__).with_name("mutate-probe.py")
OK, SURVIVED, INVALID = 0, 1, 2


def run_case(name, src, anchor, replacement, runner_body, expect, expect_restore=True):
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        target = d / "forras.ts"
        target.write_text(src)
        (d / "anchor.txt").write_text(anchor)
        (d / "repl.txt").write_text(replacement)
        runner = d / "runner.py"
        runner.write_text(runner_body)
        r = subprocess.run(
            [sys.executable, str(PROBE),
             "--file", str(target),
             "--anchor-file", str(d / "anchor.txt"),
             "--replacement-file", str(d / "repl.txt"),
             "--cmd", f"{sys.executable} {runner} {target}",
             "--cwd", str(d)],
            capture_output=True, text=True)
        ok = r.returncode == expect
        restored = target.read_text() == src
        detail = ""
        if not ok:
            detail = f" (kapott: {r.returncode}; stderr: {r.stderr.strip()[:70]})"
        if expect_restore and not restored:
            ok, detail = False, " (a FORRAS NEM ALLT VISSZA)"
        print(f"  {'OK  ' if ok else 'BUKIK'}  {name}{detail}")
        return ok


# A futtato: ha a mutalt szoveg BENNE van a forrasban -> 1 failed, kulonben zold.
RUNNER_SENSITIVE = (
    "import sys\n"
    "src=open(sys.argv[1]).read()\n"
    "print('Tests  %s (10)' % ('9 passed | 1 failed' if 'MUTALT' in src else '10 passed'))\n"
)
# A futtato, ami a mutaciot NEM veszi eszre -- mindig zold.
RUNNER_BLIND = (
    "import sys\n"
    "open(sys.argv[1]).read()\n"
    "print('Tests  10 passed (10)')\n"
)
# A futtato, ami a mutaciotol KEVESEBB tesztet gyujt (betoltesi hiba).
RUNNER_SHRINK = (
    "import sys\n"
    "src=open(sys.argv[1]).read()\n"
    "print('Tests  %s' % ('7 passed (7)' if 'MUTALT' in src else '10 passed (10)'))\n"
)
# A futtato, aminek a kimeneteben NINCS darabszam.
RUNNER_NONUMBER = "print('nincs itt semmilyen szam')\n"
# A VALODI vitest alak: az osszegzo a STDOUT-ra megy, a bukas-banner a STDERR-re,
# es a banner IS tartalmazza a "Tests" szot. Osszefuzve tehat az UTOLSO "Tests"
# elofordulas a BANNERBEN van. 2026-08-27-ig a probа ebbol olvasta ki a verdiktet,
# es HAROM valodi leletet jelentett TULELTNEK -- a megnyugtato irany.
RUNNER_VITEST_SHAPE = (
    "import sys\n"
    "src=open(sys.argv[1]).read()\n"
    "bad = 'MUTALT' in src\n"
    "print('Tests  %s (10)' % ('9 passed | 1 failed' if bad else '10 passed'))\n"
    "if bad:\n"
    "    sys.stderr.write('\\u23af\\u23af\\u23af Failed Tests 1 \\u23af\\u23af\\u23af\\n')\n"
)

SRC = "const a = 1\nif (x > 0) {\n  hasznos()\n}\n"

# A futtato, ami MEGOLI a probat menet kozben -- a jelzo `pid` mezojebol.
# Ez a SIGKILL-eset EMPIRIKUS bizonyitasa: a `finally` nem fut le tole.
# Az ALAPVONAL futasakor a jelzo meg nem letezik -- akkor egyszeruen zoldet ir.
# A MUTALT futasnal viszont mar ott van, es abbol veszi a megolendo pid-et.
RUNNER_KILL = (
    "import sys, os, json, signal\n"
    "t = sys.argv[1]\n"
    "s = t + '.mutate-probe-inflight.json'\n"
    "if os.path.exists(s):\n"
    "    os.kill(json.load(open(s))['pid'], signal.SIGKILL)\n"
    "print('Tests  10 passed (10)')\n"
)


def sentinel_cases() -> list[bool]:
    """Az OTODIK kontroll: a megolt proba nyomot hagy, es a nyom visszaallithato."""
    results = []
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        target = d / "forras.ts"
        target.write_text(SRC)
        (d / "anchor.txt").write_text("if (x > 0)")
        (d / "repl.txt").write_text("if (MUTALT)")
        runner = d / "runner.py"
        runner.write_text(RUNNER_KILL)
        sent = target.with_name(target.name + ".mutate-probe-inflight.json")
        base = [sys.executable, str(PROBE), "--file", str(target), "--cwd", str(d)]
        probe = base + ["--anchor-file", str(d / "anchor.txt"),
                        "--replacement-file", str(d / "repl.txt"),
                        "--cmd", f"{sys.executable} {runner} {target}"]

        # POZITIV KONTROLL: a proba MEGHAL, es a fan MUTALT kod marad.
        # Ha ez az eset zoldet adna, a tobbi nem allitana semmit.
        r = subprocess.run(probe, capture_output=True, text=True)
        killed = r.returncode < 0
        mutated = "MUTALT" in target.read_text()
        results.append(report("a megolt proba MUTALT kodot hagy a fan (SIGKILL)",
                              killed and mutated,
                              f"(returncode={r.returncode}, mutalt={mutated})"))
        results.append(report("...ES a jelzo-fajl ott marad", sent.is_file()))

        # A jelzo jelenleteben egy UJ proba ELUTASIT -- nem hallgat rola.
        r2 = subprocess.run(probe, capture_output=True, text=True)
        results.append(report("a jelzo jelenleteben a proba ELUTASIT -> 2",
                              r2.returncode == INVALID and "FELBESZAKADT" in r2.stderr,
                              f"(kapott: {r2.returncode})"))

        # --check megtalalja a fan.
        r3 = subprocess.run(base + ["--check"], capture_output=True, text=True)
        results.append(report("--check megtalalja -> 2",
                              r3.returncode == INVALID and str(sent) in r3.stderr,
                              f"(kapott: {r3.returncode})"))

        # --recover visszaallit, es a jelzot torli.
        r4 = subprocess.run(base + ["--recover"], capture_output=True, text=True)
        results.append(report("--recover visszaallitja az EREDETIT",
                              r4.returncode == OK and target.read_text() == SRC,
                              f"(kapott: {r4.returncode})"))
        results.append(report("...ES a jelzot torli", not sent.is_file()))

        # --check tiszta fan 0-t ad (kulonben mindig riasztana).
        r5 = subprocess.run(base + ["--check"], capture_output=True, text=True)
        results.append(report("--check tiszta fan -> 0", r5.returncode == OK,
                              f"(kapott: {r5.returncode})"))

        # ...es a sikeres proba UTAN nem marad jelzo.
        runner.write_text(RUNNER_SENSITIVE)
        r6 = subprocess.run(probe, capture_output=True, text=True)
        results.append(report("a SIKERES proba utan nincs jelzo",
                              r6.returncode == OK and not sent.is_file(),
                              f"(kapott: {r6.returncode})"))
    return results


def report(name: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'OK  ' if ok else 'BUKIK'}  {name}{'' if ok else ' ' + detail}")
    return ok


def main() -> int:
    results = [
        run_case("DISZKRIMINAL -> 0", SRC, "if (x > 0)", "if (MUTALT)", RUNNER_SENSITIVE, OK),
        run_case("TULELTE -> 1", SRC, "if (x > 0)", "if (MUTALT)", RUNNER_BLIND, SURVIVED),
        run_case("a horgony CSAK KOMMENTBEN -> 2",
                 "// if (x > 0) igy nezne ki\nconst a = 1\n",
                 "if (x > 0)", "if (MUTALT)", RUNNER_SENSITIVE, INVALID),
        run_case("a horgony KETSZER -> 2",
                 "if (x > 0) {}\nif (x > 0) {}\n",
                 "if (x > 0)", "if (MUTALT)", RUNNER_SENSITIVE, INVALID),
        run_case("a csere TARTALMAZZA a horgonyt (no-op) -> 2",
                 SRC, "if (x > 0)", "if (x > 0) /* MUTALT */", RUNNER_SENSITIVE, INVALID),
        run_case("a horgony NINCS SEHOL -> 2", SRC, "if (nincs ilyen)", "akarmi", RUNNER_SENSITIVE, INVALID),
        run_case("az OSSZLETSZAM CSOKKEN -> 2", SRC, "if (x > 0)", "if (MUTALT)", RUNNER_SHRINK, INVALID),
        run_case("nincs KIOLVASHATO darabszam -> 2", SRC, "if (x > 0)", "if (MUTALT)", RUNNER_NONUMBER, INVALID),
        run_case("a bukas-BANNER a stderr-en NEM nyomja el az osszegzot -> 0",
                 SRC, "if (x > 0)", "if (MUTALT)", RUNNER_VITEST_SHAPE, OK),
    ]
    results += sentinel_cases()
    bad = results.count(False)
    print(f"\n  {len(results)-bad}/{len(results)} eset rendben")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

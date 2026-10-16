#!/usr/bin/env python3
"""PreToolUse gate on Bash: refuse `git clean` and `git reset --hard` when the tree
they would act on is the MAIN checkout (card 468cf59a).

WHY (measured 2026-09-19 ~06:45 CEST): two backticked command names inside a
double-quoted `echo` ran as command substitution IN THE MAIN CHECKOUT:

    echo -n "  `git clean -fd` ellen vedve: "
    echo -n "  `git reset --hard` ellen: "

`clean -fd` took the untracked files, `reset --hard` the staged ones that were not
in HEAD: 10 live files gone, 9 restored, 1 (scripts/worktree-uj.sh) lost for good.
The prod-tree guard did not fire: it blocks a COMMIT, and these are not commits.

WHY A HOOK AND NOT A DENY RULE (marveen 2026-10-16 10:12): in a worktree these two
commands are legitimate routine (resetting after a mutation round), and a `Bash(...)`
deny rule is a literal prefix on the raw command string -- it would forbid them
everywhere and still miss the backticked form above. Only the TARGET separates the
two cases, and only code can resolve a target. Not a git hook either: `.git/hooks` is
shared with every linked worktree, and git has no pre-clean / pre-reset hook anyway.

HOW IT MATCHES: every `git` word in the RAW command text is examined, quotes and
backticks included -- the 09-19 command was inside a quoted string, so blanking
quoted text (as the db gate's command-position view does) would have let it through.
The price is that prose such as `git commit -m "... git clean ..."` run from the main
checkout is refused too. A false refusal is loud and costs one line; a false pass
cost a file that no backup had.

HOW IT RESOLVES THE TARGET, per invocation: the payload's cwd, then the last literal
`cd`/`pushd` before the invocation, then `-C` (several compose), `--work-tree`,
`--git-dir`. The tree is `git rev-parse --show-toplevel` of that directory. A linked
worktree has its own toplevel and passes untouched. A target that holds a variable or
a substitution cannot be resolved here: from the main checkout it is refused (say the
path literally, or use `git -C <worktree>`); from anywhere else it passes.

FAIL-OPEN on an internal error, with a log line -- the db gate's argument: this runs
on every Bash call of every agent, and a crash that refuses everything is an outage.

Override (logged): MARVEEN_GIT_GUARD=allow <command>.
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OVERRIDE = re.compile(r"(^|[\s;&|(`])MARVEEN_GIT_GUARD=allow(\s|$)")
_GIT = re.compile(r"(?<![\w.-])git(?=\s)")  # `/opt/homebrew/bin/git` counts, `.git` does not
_CD = re.compile(r"(?:^|[;&|\n(`]|\$\()\s*(?:cd|pushd)\s+((?:\"[^\"]*\"|'[^']*'|[^\s;&|)`])+)")
_STOP = set(";&|\n`)")
_UNRESOLVABLE = object()


def main_checkout():
    """The main worktree of the repo this file lives in (the common git dir's parent),
    so the same file in a linked worktree still guards the MAIN checkout."""
    override = os.environ.get("MARVEEN_GIT_GUARD_MAIN")
    if override:
        return os.path.realpath(override)
    out = subprocess.run(
        ["git", "-C", HERE, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True, text=True, timeout=5,
    )
    common = out.stdout.strip()
    if out.returncode != 0 or not common:
        raise RuntimeError("cannot find the git common dir of %s" % HERE)
    return os.path.realpath(os.path.dirname(common))


LOG_NAME = "main-checkout-git-guard.log"


def log(kind, detail, command=""):
    """Append one line next to the db gate's log. Never raises."""
    try:
        path = os.path.join(main_checkout(), "store", LOG_NAME)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("%s\t%s\t%s\t%s\n" % (
                time.strftime("%Y-%m-%d %H:%M:%S %Z"), kind,
                detail.replace("\t", " ").replace("\n", " "),
                command[:400].replace("\t", " ").replace("\n", " "),
            ))
    except Exception:
        pass


def _tokens(text, start):
    """Words of one git invocation from `start` to its end. A quote opens a word only
    after whitespace; any other quote closes an enclosing string (`bash -c 'git ...'`)
    and ends the invocation."""
    toks, i, n = [], start, len(text)
    while i < n:
        while i < n and text[i] in " \t":
            i += 1
        if i >= n or text[i] in _STOP or text.startswith("$(", i):
            break
        ch = text[i]
        if ch in "\"'":
            if i > start and text[i - 1] not in " \t":
                break
            end = text.find(ch, i + 1)
            if end < 0:
                break
            toks.append(text[i + 1:end])
            i = end + 1
            continue
        j = i
        while j < n and text[j] not in " \t\"'" and text[j] not in _STOP:
            j += 1
        toks.append(text[i:j])
        i = j
    return toks


def _literal(path, base):
    """`path` resolved against `base`, or _UNRESOLVABLE when the shell would have to
    expand something first (a variable, a substitution) or `base` is unresolvable."""
    if "$" in path or "`" in path:
        return _UNRESOLVABLE
    path = os.path.expanduser(path)
    if os.path.isabs(path):
        return os.path.normpath(path)
    return _UNRESOLVABLE if base is _UNRESOLVABLE else os.path.normpath(os.path.join(base, path))


def destructive(toks):
    """(verb, -C dirs, work_tree, git_dir) or None if not clean / reset --hard."""
    dirs, work_tree, git_dir, i = [], None, None, 0
    while i < len(toks):
        t = toks[i]
        if t == "-C" and i + 1 < len(toks):
            dirs.append(toks[i + 1]); i += 2; continue
        if t in ("-c", "--git-dir", "--work-tree", "--namespace") and i + 1 < len(toks):
            if t == "--git-dir":
                git_dir = toks[i + 1]
            elif t == "--work-tree":
                work_tree = toks[i + 1]
            i += 2; continue
        if t.startswith("--git-dir="):
            git_dir = t.split("=", 1)[1]; i += 1; continue
        if t.startswith("--work-tree="):
            work_tree = t.split("=", 1)[1]; i += 1; continue
        if t.startswith("-"):
            i += 1; continue
        break
    if i >= len(toks):
        return None
    verb, rest = toks[i], toks[i + 1:]
    if verb == "clean":
        if any(a in ("-n", "--dry-run") or (re.fullmatch(r"-[A-Za-z]+", a) and "n" in a) for a in rest):
            return None
        return ("git clean", dirs, work_tree, git_dir)
    if verb == "reset" and "--hard" in rest:
        return ("git reset --hard", dirs, work_tree, git_dir)
    return None


def toplevel(path):
    if not os.path.isdir(path):
        return None
    out = subprocess.run(["git", "-C", path, "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, timeout=5)
    return os.path.realpath(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None


def _inside(path, root):
    path = os.path.realpath(path)
    return path == root or path.startswith(root + os.sep)


def find_hits(command, cwd, main):
    """Every clean / reset --hard whose target is the main checkout, as text lines."""
    hits = []
    cwd_top = toplevel(cwd) if cwd else None
    for m in _GIT.finditer(command):
        found = destructive(_tokens(command, m.end()))
        if not found:
            continue
        verb, dirs, work_tree, git_dir = found
        base = cwd or os.getcwd()
        cds = [c for c in _CD.finditer(command, 0, m.start())]
        if cds:
            arg = cds[-1].group(1)
            if len(arg) >= 2 and arg[0] == arg[-1] and arg[0] in "\"'":
                arg = arg[1:-1]
            base = _literal(arg, base)
        for d in dirs:
            base = _literal(d, base)
        if work_tree is not None:
            wt = _literal(work_tree, base)
            target = wt if wt is _UNRESOLVABLE else ("main" if _inside(wt, main) else "other")
        elif git_dir is not None:
            gd = _literal(git_dir, base)
            target = gd if gd is _UNRESOLVABLE else (
                "main" if os.path.realpath(gd) == os.path.join(main, ".git") else "other")
        elif base is _UNRESOLVABLE:
            target = _UNRESOLVABLE
        else:
            top = toplevel(base)
            target = "main" if top == main else "other"
        if target == "main":
            hits.append("%s -> %s" % (verb, main))
        elif target is _UNRESOLVABLE and cwd_top == main:
            hits.append("%s -> target not resolvable here (variable or substitution), cwd is %s" % (verb, main))
    return hits


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        log("FAIL-OPEN", "unparseable hook payload: %s" % exc)
        sys.exit(0)
    if str(payload.get("tool_name") or "") != "Bash":
        sys.exit(0)
    try:
        command = str((payload.get("tool_input") or {}).get("command") or "")
        if not any(destructive(_tokens(command, m.end())) for m in _GIT.finditer(command)):
            sys.exit(0)
        main_root = main_checkout()
        hits = find_hits(command, str(payload.get("cwd") or "") or os.getcwd(), main_root)
        if not hits:
            sys.exit(0)
        if OVERRIDE.search(command):
            log("OVERRIDE", "; ".join(hits), command)
            sys.stderr.write("GIT-OR: ATENGEDVE MARVEEN_GIT_GUARD=allow miatt (naplozva).\n")
            sys.exit(0)
        log("DENY", "; ".join(hits), command)
    except SystemExit:
        raise
    except Exception as exc:
        log("FAIL-OPEN", "internal error: %s" % exc)
        sys.exit(0)
    sys.stderr.write(
        "GIT-OR: TILTVA -- `git clean` / `git reset --hard` a FO CHECKOUTON (kartya 468cf59a).\n\n"
        + "\n".join("  - %s" % h for h in hits)
        + "\n\n"
        "A fo checkout MAGA a futo rendszer: a scripts/ es a web/ innen fut, es ami itt\n"
        "untracked vagy stage-elt, arrol gyakran NINCS masik peldany (2026-09-19: 10 fajl\n"
        "tunt el, 1 vegleg).\n\n"
        "HA A PARANCS SZOVEGBEN VAN (echo, commit-uzenet, heredoc): a kapu az idezojelen\n"
        "BELUL is illeszt, mert a 09-19-es parancs is ott futott le (visszaperjel egy dupla\n"
        "idezojeles echo-ban). Ird a szoveget aposztrofos heredoc-kal fajlba, vagy\n"
        "fogalmazd at.\n"
        "HA EGY WORKTREE-T AKARSZ VISSZAALLITANI: `git -C <worktree-ut> reset --hard`,\n"
        "SZO SZERINTI uttal (valtozoban allo celt a fo checkoutbol nem tudok feloldani).\n"
        "HA TENYLEG A FO CHECKOUTON KELL (es a felelosseg a tied, a naplo megorzi):\n"
        "    MARVEEN_GIT_GUARD=allow <a parancs>\n"
    )
    sys.exit(2)


if __name__ == "__main__":
    main()

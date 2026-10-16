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
# A cd counts after a separator, a quote or brace that opens a nested command line
# (`bash -c 'cd X && ...'`, `{ cd X; ...; }`), and after a shell keyword (`if cd X;
# then ...`) -- didi measured all of these passing on 2026-10-16.
_CD = re.compile(
    r"(?:^|[;&|\n(`'\"{!]|\$\(|(?<![\w-])(?:if|then|else|elif|do|time)(?=\s))"
    r"\s*(?:cd|pushd)\s+((?:\"[^\"]*\"|'[^']*'|[^\s;&|)`])+)")
# NAME=value written literally in the same command (`R=/x; git -C $R clean`), and the
# git environment variables that move the target (`GIT_DIR=... git clean`).
_ASSIGN = re.compile(
    r"(?:^|[\s;&|(`'\"{])(?:export\s+)?([A-Za-z_]\w*)=(\"[^\"$`]*\"|'[^']*'|[^\s;&|()`'\"$]*)(?=[\s;&|)'\"]|$)")
_VAR = re.compile(r"\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)")
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
            # a substitution (or an opening backtick: an even count of backticks before
            # it) ends the words we can see; leave a marker so the pathspec check knows
            # something unreadable follows (`git checkout -- $(pwd)`)
            if i < n and (text.startswith("$(", i) or (text[i] == "`" and text.count("`", 0, i) % 2 == 0)):
                toks.append("$(")
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


def _assignments(command, end):
    """Literal NAME=value assignments before `end`, the last one winning, over HOME."""
    env = {"HOME": os.path.expanduser("~")}
    for a in _ASSIGN.finditer(command, 0, end):
        val = a.group(2)
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        env[a.group(1)] = val
    return env


def _expand(path, env):
    """$NAME / ${NAME} from `env`; anything left for the shell keeps its `$`."""
    return _VAR.sub(lambda v: env.get(v.group(1) or v.group(2), v.group(0)), path)


def _closed_before(command, start, end):
    """True when a `(` group open at `start` closes before `end`: a cd in `(cd X)`
    or `$(cd X)` does not move the shell that runs the later git."""
    depth = 0
    for ch in command[start:end]:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return True
    return False


def _literal(path, base, env=None):
    """`path` resolved against `base`, or _UNRESOLVABLE when the shell would have to
    expand something first (a variable, a substitution) or `base` is unresolvable."""
    path = _expand(path, env or {})
    # quote removal over the whole word, as the shell does it: "$HOME"/x and, inside a
    # double-quoted bash -c body, \"$HOME/x\" are both the word $HOME/x (didi N10, N12)
    path = re.sub(r"\\?[\"']", "", path)
    if "$" in path or "`" in path:
        return _UNRESOLVABLE
    path = os.path.expanduser(path)
    if os.path.isabs(path):
        return os.path.normpath(path)
    return _UNRESOLVABLE if base is _UNRESOLVABLE else os.path.normpath(os.path.join(base, path))


def destructive(toks):
    """(verb, -C dirs, work_tree, git_dir) or None if not clean / reset --hard / a whole-tree checkout or restore."""
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
        return ("git clean", dirs, work_tree, git_dir, None)
    if verb == "reset" and any(a in ("--ha", "--har", "--hard") for a in rest):  # git takes a unique prefix
        return ("git reset --hard", dirs, work_tree, git_dir, None)
    # Discarding the WHOLE tree's changes (marveen 2026-10-16 13:09, msg 30585): on 09-19
    # 44 modified files would have gone this way. One named file is a deliberate act and
    # passes; `restore --staged` alone touches only the index and passes. Whether a
    # pathspec IS the whole tree depends on the directory it is read from, so it is
    # decided in find_hits (_spec_state), not here.
    if verb in ("checkout", "restore"):
        if verb == "restore" and _flag(rest, "S", "--staged") and not _flag(rest, "W", "--worktree"):
            return None
        specs = _pathspecs(verb, rest)
        if specs:
            return ("git %s <whole tree>" % verb, dirs, work_tree, git_dir, specs)
    return None


# The spellings refused on sight, whatever directory they are read from (the first
# version of this guard; kept so a subdirectory `git checkout -- .` still refuses).
# Every OTHER spelling of the tree root (`./.`, `:(top)`, `:/:`, `scripts/..`) is caught
# by normalisation in _spec_state -- an enumeration cannot be complete (didi, card
# 468cf59a comment 36845).
_WHOLE_TREE = {".", "./", "*", "./*", ":", ":/", ":/*", ":/."}
_VALUE_FLAGS = ("-s", "--source")  # `git restore -s <tree>`: the next word is not a pathspec


def _pathspecs(verb, rest):
    """[(word, lenient)]: the words of a checkout/restore that are pathspecs. Lenient =
    may really be a branch (`git checkout $BRANCH`), so when it cannot be resolved it
    passes instead of refusing."""
    if "--" in rest:
        return [(a, False) for a in rest[rest.index("--") + 1:]]
    out, skip = [], False
    for a in rest:
        if skip:
            skip = False
            continue
        if a == "--pathspec-from-file" or a.startswith("--pathspec-from-file="):
            out.append(("$(pathspec-from-file)", False))  # a file we do not read
            skip = a == "--pathspec-from-file"
            continue
        if a in _VALUE_FLAGS or (re.fullmatch(r"-[A-Za-z]*s", a) and verb == "restore"):
            skip = True
            continue
        if a.startswith("-"):
            continue
        out.append((a, verb == "checkout"))
    return out


def _flag(args, short, long_):
    return any(a == long_ or (re.fullmatch(r"-[A-Za-z]+", a) and short in a) for a in args)


def _strip_magic(spec):
    """(top, exclude, path): pathspec magic removed. `:(top)x`, `:/x`, `:/:x` anchor at
    the repo root; `:(exclude)x`, `:!x`, `:^x` subtract (an exclude-only pathspec means
    "everything except x")."""
    top = exclude = False
    if spec.startswith(":(") and ")" in spec:
        close = spec.index(")")
        words = spec[2:close].split(",")
        top, exclude = "top" in words, "exclude" in words
        return top, exclude, spec[close + 1:]
    if len(spec) > 1 and spec[0] == ":" and spec[1] in "/!^":
        i = 1
        while i < len(spec) and spec[i] in "/!^":
            top = top or spec[i] == "/"
            exclude = exclude or spec[i] in "!^"
            i += 1
        if i < len(spec) and spec[i] == ":":
            i += 1
        return top, exclude, spec[i:]
    return False, False, spec


def _covers(path, root):
    """True when `path` is the repo root or an ancestor of it."""
    return path == root or root.startswith(path.rstrip(os.sep) + os.sep)


def _spec_state(spec, lenient, base, root, env):
    """"whole" when this pathspec discards the whole tree rooted at `root` (or cannot be
    shown not to), "unresolvable" when it holds a variable/substitution that only the
    shell can expand, else None. `base` is the directory the git command runs in."""
    spec = _expand(spec, env)
    spec = re.sub(r"\\?[\"']", "", spec)
    if "$" in spec or "`" in spec:
        return None if lenient else "unresolvable"
    if spec in _WHOLE_TREE:
        return "whole"
    top, exclude, rest = _strip_magic(spec)
    if exclude:
        return "whole"  # an exclude-only pathspec is "everything except ..."
    rest = os.path.expanduser(rest) if rest.startswith("~") else rest
    if top and not os.path.isabs(rest):
        cands = [os.path.normpath(os.path.join(root, rest))]
    elif os.path.isabs(rest):
        cands = [os.path.normpath(rest)]
    elif base is _UNRESOLVABLE:
        # directory unknown: only a path that stays below it is surely not the root
        n = os.path.normpath(rest) if rest else "."
        if os.path.basename(n) in ("*", "**"):
            n = os.path.dirname(n) or "."
        return "whole" if n == "." or n == ".." or n.startswith("../") else None
    else:
        cands = [os.path.normpath(os.path.join(os.path.realpath(base), rest))]
    for c in cands:
        for cand in (c, os.path.realpath(c)):
            if os.path.basename(cand) in ("*", "**"):  # a glob over the directory itself
                cand = os.path.dirname(cand)
            if _covers(cand, root):
                return "whole"
    return None


def _specs_state(specs, base, root, env):
    states = [_spec_state(w, lenient, base, root, env) for w, lenient in specs]
    return "whole" if "whole" in states else ("unresolvable" if "unresolvable" in states else None)


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
        verb, dirs, work_tree, git_dir, specs = found
        base = cwd or os.getcwd()
        env = _assignments(command, m.start())
        work_tree = work_tree if work_tree is not None else env.get("GIT_WORK_TREE")
        git_dir = git_dir if git_dir is not None else env.get("GIT_DIR")
        cds = [c for c in _CD.finditer(command, 0, m.start()) if not _closed_before(command, c.end(), m.start())]
        if cds:
            base = _literal(cds[-1].group(1), base, env)
            # a cd that fails leaves the shell where it was: say so, do not guess "other"
            if base is not _UNRESOLVABLE and not os.path.isdir(base):
                base = _UNRESOLVABLE
        for d in dirs:
            base = _literal(d, base, env)
        root = main
        if work_tree is not None:
            wt = _literal(work_tree, base, env)
            target = wt if wt is _UNRESOLVABLE else ("main" if _inside(wt, main) else "other")
            if target == "main":
                root = os.path.realpath(wt)
        elif git_dir is not None:
            gd = _literal(git_dir, base, env)
            target = gd if gd is _UNRESOLVABLE else (
                "main" if os.path.realpath(gd) == os.path.join(main, ".git") else "other")
        elif base is _UNRESOLVABLE:
            target = _UNRESOLVABLE
        else:
            top = toplevel(base)
            target = "main" if top == main else "other"
        unresolved_target = target is _UNRESOLVABLE and cwd_top == main
        if target != "main" and not unresolved_target:
            continue
        # checkout / restore: only a pathspec that IS the whole tree counts
        why = ""
        if specs is not None:
            state = _specs_state(specs, base, root, env)
            if state is None:
                continue
            why = (" (the pathspec resolves to the repo root)" if state == "whole" else
                   " (a pathspec holds a variable or substitution, cannot be shown not to be the repo root)")
        if target == "main":
            hits.append("%s -> %s%s" % (verb, main, why))
        else:
            hits.append("%s -> target not resolvable here (variable or substitution), cwd is %s%s" % (verb, main, why))
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
        "GIT-OR: TILTVA -- `git clean` / `git reset --hard` / `git checkout -- .` / `git restore .`\n"
        "a FO CHECKOUTON (kartya 468cf59a).\n\n"
        + "\n".join("  - %s" % h for h in hits)
        + "\n\n"
        "A fo checkout MAGA a futo rendszer: a scripts/ es a web/ innen fut, es ami itt\n"
        "untracked vagy stage-elt, arrol gyakran NINCS masik peldany (2026-09-19: 10 fajl\n"
        "tunt el, 1 vegleg).\n\n"
        "HA A PARANCS SZOVEGBEN VAN (echo, commit-uzenet, heredoc, grep-minta): a kapu az idezojelen\n"
        "BELUL is illeszt, mert a 09-19-es parancs is ott futott le (visszaperjel egy dupla\n"
        "idezojeles echo-ban). Ird a szoveget aposztrofos heredoc-kal fajlba, vagy\n"
        "fogalmazd at.\n"
        "HA EGY WORKTREE-T AKARSZ VISSZAALLITANI: `git -C <worktree-ut> reset --hard`,\n"
        "SZO SZERINTI uttal (valtozoban allo celt a fo checkoutbol nem tudok feloldani).\n"
        "A `checkout --` / `restore` PATHSPEC-JE: a kapu normalizalja (`./.`, `:(top)`, `:/:`,\n"
        "`scripts/..` mind a gyoker), es ami valtozot vagy $(...)-t tartalmaz, azt a fo\n"
        "checkouton nem tudja megmutatni, hogy nem a gyoker: irj SZO SZERINTI fajlnevet.\n"
        "HA TENYLEG A FO CHECKOUTON KELL (es a felelosseg a tied, a naplo megorzi):\n"
        "    MARVEEN_GIT_GUARD=allow <a parancs>\n"
    )
    sys.exit(2)


if __name__ == "__main__":
    main()

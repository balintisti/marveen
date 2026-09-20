#!/usr/bin/env bash
# agent-cwd-detach.sh -- egy agens munkakonyvtarat KIVISZI a kozos CLAUDE.md hierarchiajabol.
#
# MIERT. A Claude Code a cwd-tol a GYOKERIG minden szinten betolti a CLAUDE.md-t, es erre NINCS
# kapcsolo (merve a cli.js-ben: a cwdLevelDirs gyujtes `while (z !== root)`, hatarolas nelkul).
# A `CLAUDE_CODE_DISABLE_CLAUDE_MDS` letezik, de MINDET kikapcsolja -- a sajatot is. Tehat az
# egyetlen ut: a munkakonyvtar fizikai kivitele a nagy lap ala tartozo fabol.
#
# MERT HATAS (deeper, ugyanaz az agens, elotte/utana):  325 291 -> 91 036 token indulaskor.
#
# A SYMLINK AZERT MUKODIK, mert a Node a FIZIKAI utat oldja fel: a shell PWD a symlink-ut, de a
# `process.cwd()` a valodi. Igy a `cd "${dir}"` a launch-parancsban VALTOZATLAN maradhat -- ez a
# valtoztatas NEM igenyel kodmodositast, buildet vagy a szolgaltatas ujrainditasat.
#
# ELOFELTETEL, es a szkript MEGTAGADJA nelkule: az agens sajat lapja hordozza a teherhordo
# mondatokat (scripts/agent-core-check.py). A levalasztas utan a kozos lap MAR NEM halo.
#
# Hasznalat:  bash scripts/agent-cwd-detach.sh <agens>        [--dry-run]
set -uo pipefail
A="${1:?agens nev kell}"; DRY="${2:-}"
ROOT=/Users/isti/marveen; SRC="$ROOT/agents/$A"; DST="/Users/Shared/marveen-$A"
T=$(cat "$ROOT/store/.dashboard-token")
say(){ printf '  %s\n' "$*"; }

[ -L "$SRC" ] && { say "MAR LEVALASZTVA (symlink) -- nincs teendo"; exit 0; }
[ -d "$SRC" ] || { say "NINCS ilyen agens-konyvtar: $SRC"; exit 1; }
[ -e "$DST" ] && { say "A CEL MAR LETEZIK: $DST -- ALLJ"; exit 1; }

# 1. ELOFELTETEL: a sajat lap teljes-e
#
# A HORGONY A KAPU SAJAT JELOLOJE, NEM EGY SZAM. Itt eddig `grep -q "22/22"` allt, es az a
# szam a kanari-lista MERETE volt -- vagyis minden egyes uj teherhordo mondattal elavult.
# deeper merte 2026-09-20 (17520): a lista 23-ra nott, a kapu `23/23`-at nyomtat, tehat a
# `22/22` minta MAR EGYETLEN AGENSRE SEM illeszkedett.
#
# A hiba IRANYA FAIL-CLOSED volt, es ezt kulon meg kellett merni, mert nem magatol ertetodo:
#     minden mondat megvan  -> `23/23`  -> a regi minta NEM illeszkedik -> MEGTAGAD
#     egy mondat hianyzik   -> `22/23`  -> a regi minta NEM illeszkedik -> MEGTAGAD
# Vagyis nem engedett at rosszat; MINDENT megtagadott volna, egy FELREVEZETO indoklassal
# ("a lapja NEM teljes"), miutan a lap teljes. Az koltsege nem adatveszteés, hanem hogy valaki
# elkezdene "javitani" egy hibatlan lapot.
#
# EZERT A SZAMOT A JELOLO VALTJA FEL: a kapu a hianyt `HIANYZIK:` elotaggal irja ki. Egy URES
# sor (nincs ilyen agens a kimenetben) szinten MEGTAGADAS -- a csend itt nem valasz.
LINE=$(python3 "$ROOT/scripts/agent-core-check.py" 2>/dev/null | grep "^  $A ")
if [ -z "$LINE" ]; then
  say "NEM VISZEM KI: $A NEM SZEREPEL az agent-core-check kimeneteben."
  say "Vedd fel az AGENTS listaba (scripts/agent-core-check.py), kulonben a kapu vak ra."; exit 3
fi
case "$LINE" in
  *HIANYZIK*)
    say "NEM VISZEM KI: $A sajat lapja NEM teljes (agent-core-check):"
    say "  $LINE"
    say "A levalasztas utan a kozos lap nem potolja -- eloszor a mag."; exit 3 ;;
esac
say "eloferteltel OK: $LINE"

# 2. A CEL-HIERARCHIA legyen TISZTA (kulonben a kivitel semmit nem er)
for d in /Users/Shared /Users /; do
  [ -f "$d/CLAUDE.md" ] && { say "A CELUTON VAN CLAUDE.md: $d -- ALLJ"; exit 4; }
done
say "cel-hierarchia tiszta (/Users/Shared, /Users, /)"

[ "$DRY" = "--dry-run" ] && { say "(dry-run: itt allnek meg)"; exit 0; }

# 3. LEALLITAS
curl -s -X POST -H "Authorization: Bearer $T" "http://localhost:3420/api/agents/$A/stop" >/dev/null
sleep 4
tmux has-session -t "agent-$A" 2>/dev/null && { say "A SESSION MEG EL -- ALLJ, nem mozgatok"; exit 5; }
say "leallitva"

# 4. MOZGATAS + SYMLINK, fajlszam-ellenorzessel
BEFORE=$(find "$SRC" | wc -l | tr -d ' ')
mv "$SRC" "$DST" || { say "A MOZGATAS ELHASALT -- ALLJ"; exit 6; }
chmod 700 "$DST"
ln -s "$DST" "$SRC" || { say "SYMLINK HIBA -- VISSZAALLITAS"; mv "$DST" "$SRC"; exit 7; }
AFTER=$(find "$SRC/" | wc -l | tr -d ' ')
[ "$BEFORE" = "$AFTER" ] || { say "FAJLSZAM ELTER ($BEFORE -> $AFTER) -- NEZD MEG KEZZEL"; exit 8; }
say "mozgatva: $BEFORE fajl, symlink all"

# 5. TRUST-BELYEG az UJ FIZIKAI utra (kulonben a Claude Code trust-dialogot varna)
python3 - "$A" "$DST" <<'PY'
import json, shutil, sys, os, time
a, dst = sys.argv[1], sys.argv[2]
p = f"{dst}/.claude-config/.claude.json"
if not os.path.exists(p): print(f"  FIGYELEM: nincs {p} -- a trust-belyeg kimaradt"); raise SystemExit(0)
shutil.copy2(p, p + '.bak-cwdmove-' + time.strftime('%Y%m%d-%H%M%S'))
d = json.load(open(p, encoding='utf-8')); projs = d.setdefault('projects', {})
base = dict(projs.get(f"/Users/isti/marveen/agents/{a}", {}))
base['hasTrustDialogAccepted'] = True
projs[dst] = base
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
json.load(open(p, encoding='utf-8'))   # visszaolvasas: ervenyes JSON maradt-e
print(f"  trust-belyeg: {dst} -> True")
PY

# 6. INDITAS (fresh: `--continue` egy channel-agensnel SUKET sessiont ad)
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"fresh":true}' "http://localhost:3420/api/agents/$A/start" >/dev/null
sleep 12
tmux has-session -t "agent-$A" 2>/dev/null || { say "NEM INDULT EL -- NEZD MEG AZONNAL"; exit 9; }
CWD=$(tmux capture-pane -t "agent-$A" -p 2>/dev/null | grep -m1 -o '/Users/Shared/marveen-[a-z]*')
say "elindult, panel cwd: ${CWD:-'(nem olvashato)'}"
tmux capture-pane -t "agent-$A" -p 2>/dev/null | grep -qi 'channels' && say "a channels plugin betoltott" || say "FIGYELEM: a channels plugin NEM latszik a panelen"
say "KESZ: $A levalasztva"

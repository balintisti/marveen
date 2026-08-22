#!/bin/bash
# Skill Index Generator
# Generates a Level 0 index of all available skills (name + description only)
# This keeps token usage low while making all skills discoverable
#
# Usage: skill-index.sh [AGENT_DIR]
#   Without arg: generates global index at ~/.claude/skills/.skill-index.md
#   With AGENT_DIR: generates merged index (global + agent-specific) at
#                   <AGENT_DIR>/.claude/skills/.skill-index.md
#                   (backward-compatible format for no-arg callers)

GLOBAL_SKILLS_DIR="$HOME/.claude/skills"

if [ $# -ge 1 ]; then
  AGENT_DIR="$1"
  AGENT_SKILLS_DIR="$AGENT_DIR/.claude/skills"
  OUTPUT="$AGENT_SKILLS_DIR/.skill-index.md"
  MERGED=1
  mkdir -p "$AGENT_SKILLS_DIR"
else
  AGENT_DIR=""
  AGENT_SKILLS_DIR=""
  OUTPUT="$GLOBAL_SKILLS_DIR/.skill-index.md"
  MERGED=0
fi

if [ ! -d "$GLOBAL_SKILLS_DIR" ]; then
  echo "No global skills directory found at $GLOBAL_SKILLS_DIR"
  exit 0
fi

echo "# Skill Index (Level 0)" > "$OUTPUT"
echo "" >> "$OUTPUT"

if [ "$MERGED" = "1" ]; then
  echo "Ez az ágensspecifikus skill index: globális (~/.claude/skills) és ágensspecifikus (.claude/skills) skilleket egyaránt tartalmaz." >> "$OUTPUT"
  echo "Ha egy skill releváns, olvasd be a teljes SKILL.md-t (Level 1)." >> "$OUTPUT"
  echo "Ha segédfájlokra is szükség van, nézd meg a scripts/ és references/ mappákat (Level 2)." >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "| Skill | Leírás | Scope |" >> "$OUTPUT"
  echo "|-------|--------|-------|" >> "$OUTPUT"
else
  echo "Ez az összes elérhető skill rövid indexe. Csak a nevet és leírást tartalmazza (Level 0)." >> "$OUTPUT"
  echo "Ha egy skill releváns, olvasd be a teljes SKILL.md-t (Level 1)." >> "$OUTPUT"
  echo "Ha segédfájlokra is szükség van, nézd meg a scripts/ és references/ mappákat (Level 2)." >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "| Skill | Leírás |" >> "$OUTPUT"
  echo "|-------|--------|" >> "$OUTPUT"
fi

SKILL_COUNT=0

index_skills_dir() {
  local dir="$1"
  local scope="$2"  # only used when MERGED=1
  for skill_dir in "$dir"/*/; do
    [ -d "$skill_dir" ] || continue
    local skill_md="$skill_dir/SKILL.md"
    [ -f "$skill_md" ] || continue

    local name
    name=$(grep -m1 "^name:" "$skill_md" 2>/dev/null | sed 's/^name: *//' | tr -d '"' | tr -d "'")
    if [ -z "$name" ]; then
      name=$(basename "$skill_dir")
    fi

    local desc
    desc=$(grep -m1 "^description:" "$skill_md" 2>/dev/null | sed 's/^description: *//' | tr -d '"' | tr -d "'" | cut -c1-120)
    if [ -z "$desc" ]; then
      desc="(nincs leírás)"
    fi

    if [ "$MERGED" = "1" ]; then
      echo "| \`$name\` | $desc | $scope |" >> "$OUTPUT"
    else
      echo "| \`$name\` | $desc |" >> "$OUTPUT"
    fi
    SKILL_COUNT=$((SKILL_COUNT + 1))
  done
}

index_skills_dir "$GLOBAL_SKILLS_DIR" "global"

if [ "$MERGED" = "1" ] && [ -d "$AGENT_SKILLS_DIR" ]; then
  index_skills_dir "$AGENT_SKILLS_DIR" "agent"
fi

echo "" >> "$OUTPUT"
echo "_${SKILL_COUNT} skill indexelve. Generálva: $(date '+%Y-%m-%d %H:%M')_" >> "$OUTPUT"

echo "Skill index generated: $OUTPUT ($SKILL_COUNT skills)"

# ---- meret-or -------------------------------------------------------------
# MIERT: a skill-hatar (500 sor) eddig CSAK azon allt, hogy valakinek eszebe jut
# megmerni. 2026-08-21 13:45-kor jelentettem, hogy a harom bontott skill 132/226/186
# sor -- 2026-08-22 04:30-ra az egyik 576 lett, es a hatar-atlepes SEHOL nem latszott.
# Isti szabalya: ha egy megoldas azon all, hogy valaki megjegyez valamit, az nem megoldas.
SKILL_LINE_LIMIT="${SKILL_LINE_LIMIT:-500}"
OVER_LIMIT=0
OVER_LIST=""
for f in "$GLOBAL_SKILLS_DIR"/*/SKILL.md; do
  [ -f "$f" ] || continue
  n=$(wc -l < "$f" | tr -d ' ')
  if [ "$n" -gt "$SKILL_LINE_LIMIT" ]; then
    OVER_LIMIT=$((OVER_LIMIT+1))
    OVER_LIST="${OVER_LIST}  $(basename "$(dirname "$f")")  ${n} sor\n"
  fi
done

# POZITIV KONTROLL: egy or, ami sosem tud tuzelni, ugyanugy "mukodik", mint egy helyes.
# Ellenorizzuk, hogy a szamlalo-ag EGYALTALAN elerheto-e egy biztosan tullepo bemenettel.
_probe=$(printf 'x\n%.0s' $(seq 1 $((SKILL_LINE_LIMIT+1))) | wc -l | tr -d ' ')
if [ "$_probe" -le "$SKILL_LINE_LIMIT" ]; then
  echo "MERET-OR: a pozitiv kontroll ELBUKOTT (a szamlalas nem mukodik) -- az or NEM megbizhato." >&2
elif [ "$OVER_LIMIT" -gt 0 ]; then
  echo "" >&2
  echo "MERET-OR: ${OVER_LIMIT} skill lepte tul a ${SKILL_LINE_LIMIT} soros hatart:" >&2
  printf "%b" "$OVER_LIST" >&2
  echo "  -> references/ bontas javasolt. A LEGFRISSEBB szekciok vannak a fajl vegen," >&2
  echo "     tehat epp azok jutnak el a legkevesebb olvasohoz." >&2
else
  echo "MERET-OR: minden skill a ${SKILL_LINE_LIMIT} soros hatar alatt (pozitiv kontroll: OK)."
fi

# ES A LEPES, AMI NELKUL A FENTI EGESZ NEMA MARADHAT (2026-08-22, merve, es a hiba az enyem):
# a figyelmeztetes stderr-re megy, ami HELYES -- de ma ejjel ketszer futtattam ezt a szkriptet
# `>/dev/null 2>&1` alakban, hogy az "index generated" sort elrejtsem, es ezzel a FIGYELMEZTETEST
# is eldobtam. Ugyanabban a ket fordulóban vittem a felderites-ket-listas-proba fajlt 611 -> 634 ->
# 643 sorra. Az or hibatlanul dolgozott, es senki nem hallotta.
#
# Egy uzenet, ami CSAK szoveg, annyira hangos, amennyire a HIVO engedi. Egy kilepesi kod nem az:
# tulel egy `>/dev/null 2>&1`-et is, es megallit egy `&&` lancot. Ezert a hatar-atlepes mostantol
# 3-as kilepesi kod. A 3 SAJAT ertek, nem 1: egy valodi generalasi hiba tovabbra is megkulonboztetheto
# marad attol, hogy az index elkeszult ES a hatar-or talalt valamit.
if [ "${OVER_LIMIT}" -gt 0 ]; then
  exit 3
fi

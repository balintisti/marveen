#!/usr/bin/env bash
# card-comment.sh -- kanban komment kiirasa FAJLBOL vagy STDIN-rol, hej-behelyettesites NELKUL.
#
# MIERT LETEZIK. Ket ismetlodo hibat zar le egyszerre, es mindketto MERT eset
# 2026-08-22-rol, harom kulonbozo agensnel:
#
#   1. HEJ-BEHELYETTESITES. Idezojel nelkuli heredoccal (<<EOF) irt kommentben a hej a
#      backtickeket PARANCSHELYETTESITESKENT futtatja. A komment 200-at ad es olvashatonak
#      latszik, kozben hianyzik belole egy szo -- vagy ami rosszabb, BEKERUL egy parancs
#      kimenete. Mandark ketszer futott bele egy nap; masodszor az `id` kimenete (uid/gid/
#      csoportlista) kerult egy kartyara, ahonnan komment-torlo vegpont hijan nem lehet
#      eltavolitani. Marveen ugyanaznap a `date` szon fogott, EPP ABBAN A MONDATBAN, amelyik
#      ezt a szabalyt mondta ki masnak.
#
#   2. BECSULT IDOBELYEG. Az agensnek nincs oraja: a fordulok kozott nem telik szamara ido,
#      tehat az eltelt ido becslese talalgatas, es az iranya allando (mindig kesobbre).
#      Mandark megmerte a sajat napjat: 11 hibas fejlec, +3-tol +117 percig monoton novekvo
#      sodrodassal. Egy kartyan az idobelyeg BIZONYITEK -- ket agens fuggetlen merese percre
#      egymas mellett mast jelent, mint ket oraval kesobb.
#
# A megoldas egyik esetben sem "figyelj jobban": a fajl BINARISAN megy at pythonba (nincs hej-
# ertelmezes sehol), az idobelyeget pedig a script teszi ki egy __STAMP__ helyorzore.
#
# HASZNALAT:
#   bash scripts/card-comment.sh <AGENS> <KARTYA_ID> <FAJL>
#   ... | bash scripts/card-comment.sh <AGENS> <KARTYA_ID> -
#   A komment szovegeben a __STAMP__ helyere a valodi ido kerul.
#
# Eredetije: agents/mandark/bin/card-comment.sh (mandark irta, o ajanlotta fel kozosbe).
set -euo pipefail
AGENT="${1:?agens nev kell}"; CARD="${2:?kartya id kell}"; SRC="${3:?fajl vagy - kell}"
TOKEN_FILE=/Users/isti/marveen/store/.dashboard-token
[ -r "$TOKEN_FILE" ] || { echo "NEM KULDTEM: nincs token ($TOKEN_FILE)" >&2; exit 1; }
# A DOKUMENTALT `-` (STDIN) MOD 2026-09-04-IG SZERKEZETILEG LEHETETLEN VOLT, es NEMAN.
# A python PROGRAM MAGA megy a stdin-en (`python3 - ... <<'PY'`), tehat mire a `sys.stdin.read()`
# lefutott volna, a stdin-t mar a heredoc foglalta: a torzs URES lett. Merve, kontrollal:
#   fajl modban 22 bajt | `-` modban 0 bajt | ugyanaz a python heredoc NELKUL, stdin-rol 22 bajt
# Az utolso sor a kontroll: az olvaso jo, a heredoc az ok.
# ES HANGOSAN BUKIK, NEM NEMAN -- ezt friday merte elesben, es az en elso jellemzesem tobbet
# allitott a mertnel. A szerver kapuzza az ures tartalmat (`kanban.ts:668`:
# `if (!author || !content) -> 400`), tehat ures komment NEM keletkezik, es a visszaolvasas
# szoba sem kerul: a script a HTTPError agon lep ki.
# A KAR EZERT NEM ADATVESZTES, HANEM FELREVEZETES: a hibauzenet `Szerzo es tartalom kotelezo`,
# vagyis a HIVOT okolja egy rossz argumentumert, mikozben az ok az, hogy a heredoc ette meg a
# stdin-t. friday sajat szava: "the message blames missing author/content instead of naming the
# cause". Ez a javitas ezert nem egy nema hibat tesz hangossa, hanem egy HANGOS, de ROSSZ FELE
# MUTATO hibat tesz pontossa -- es a kaput a HTTP hivas ELE teszi.
# A javitas: a stdin-t a HEJ olvassa be, mielott a heredoc elindul.
if [ "$SRC" = "-" ]; then
  STDIN_TMP="$(mktemp)"; trap 'rm -f "$STDIN_TMP"' EXIT
  cat > "$STDIN_TMP"
  SRC="$STDIN_TMP"
fi
[ -s "$SRC" ] || { echo "NEM KULDTEM: a komment-torzs URES ($SRC)" >&2; exit 1; }
STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
python3 - "$AGENT" "$CARD" "$SRC" "$STAMP" "$TOKEN_FILE" <<'PY'
import sys, json, re, urllib.request, urllib.error
agent, card, src, stamp, tokfile = sys.argv[1:6]
body = open(src, encoding='utf-8').read()
# MASODIK, FUGGETLEN KAPU: a hej `-s`-e egy csupa-szokoz fajlra is igazat ad, es egy
# whitespace-komment ugyanolyan hasznalhatatlan artefaktum egy append-only vegponton.
if not body.strip():
    print('NEM KULDTEM: a komment-torzs URES vagy csak szokoz'); sys.exit(1)
body = body.replace('__STAMP__', stamp)
tok = open(tokfile).read().strip()
base = 'http://localhost:3420/api/kanban/%s/comments' % card
req = urllib.request.Request(
    base, data=json.dumps({'author': agent, 'content': body}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
try:
    r = urllib.request.urlopen(req)
except urllib.error.HTTPError as e:
    print('NEM KULDTEM: HTTP %d %r' % (e.code, e.read()[:200])); sys.exit(1)
if r.status != 200:
    print('NEM KULDTEM: HTTP %d' % r.status); sys.exit(1)
# VISSZAOLVASAS. A 200 nem bizonyitek: a komment-vegpont visszhangozza a beküldött
# card_id-t, tehat a valasz azt adja vissza, amit te kuldtel. A bizonyitek egy MASIK hivas.
chk = urllib.request.Request(base, headers={'Authorization': 'Bearer ' + tok})
cs = json.load(urllib.request.urlopen(chk))
last = cs[-1]['content'] if cs else ''
# A SZERVER JOGOSAN NORMALIZAL: egy LETEZO kartyara mutato `#<8hex>` hivatkozast atirja a
# kartya olvashato sorszamara (`#779`). Merve 2026-08-23: 101 -> 96 karakter, `#7d50804c` ->
# `#779`, mikozben a nem letezo `#deadbeef` valtozatlan maradt.
# Bajt-osszehasonlitas ezert HAMIS RIASZTAST adott pontosan a HELYES hasznalatra -- es a
# jelentes-sablonunk EPP ezt irja elo ("Kesz: <mit> (#<kartya>)"). Egy or, ami a helyes
# hasznalatra riaszt, feleli a sajat bizalmat: a kovetkezo IGAZI elterest is zajnak nezik.
# (computress talalta, marveen reprodukalta es javitotta.)
def _canon(t):
    return re.sub(r'#(?:[0-9a-f]{8}|[0-9]+)\b', '#REF', t)
ok = _canon(last) == _canon(body)
print('%s kartya=%s komment=%d stamp=%s' % ('OK' if ok else 'GYANUS', card, len(cs), stamp))
if not ok:
    print('  a visszaolvasott utolso komment NEM egyezik a kuldottel -- nezd meg kezzel')
    print('  (a `#<kartya>` -> `#<sorszam>` csere VARHATO, azt nem jelzi; barmi mas elteres valodi)')
    print('  hossz: kuldott=%d visszaolvasott=%d' % (len(body), len(last)))
    sys.exit(1)
PY

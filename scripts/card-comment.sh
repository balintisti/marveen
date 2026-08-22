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
STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
python3 - "$AGENT" "$CARD" "$SRC" "$STAMP" "$TOKEN_FILE" <<'PY'
import sys, json, urllib.request, urllib.error
agent, card, src, stamp, tokfile = sys.argv[1:6]
body = sys.stdin.read() if src == '-' else open(src, encoding='utf-8').read()
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
ok = last[:200] == body[:200]
print('%s kartya=%s komment=%d stamp=%s' % ('OK' if ok else 'GYANUS', card, len(cs), stamp))
if not ok:
    print('  a visszaolvasott utolso komment NEM egyezik a kuldottel -- nezd meg kezzel')
    sys.exit(1)
PY

#!/usr/bin/env bash
# Titok atadasa Marveennek, biztonsagosan.
#
# MIERT NEM TELEGRAMON: az uzenet ott marad a beszelgetesben, a telefonodon, a
# szerveren es a mentesekben. Ez a szkript a beirt erteket SOHA nem irja ki, nem
# teszi a shell-elozmenybe, es titkositva tarolja a marveen vaultjaban.
#
# Hasznalat:
#   bash scripts/titok.sh                 -> interaktiv (kerdez)
#   bash scripts/titok.sh lista           -> a mar tarolt titkok NEVE (ertek nelkul)
#   bash scripts/titok.sh torol <azonosito>
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/web/vault.js ]; then
  echo "HIBA: a dist/web/vault.js hianyzik. Eloszor: npm run build" >&2
  exit 1
fi

cmd="${1:-uj}"

if [ "$cmd" = "lista" ]; then
  node --input-type=module -e "
    const { listSecrets } = await import('$PWD/dist/web/vault.js')
    const rows = listSecrets()
    if (!rows.length) { console.log('(a vault ures)'); process.exit(0) }
    console.log('Tarolt titkok (az ERTEKUK nem jelenik meg):')
    for (const r of rows) console.log('  ' + r.id.padEnd(28) + r.label)
  "
  exit 0
fi

if [ "$cmd" = "torol" ]; then
  id="${2:-}"
  [ -z "$id" ] && { echo "Hasznalat: bash scripts/titok.sh torol <azonosito>" >&2; exit 1; }
  node --input-type=module -e "
    const { deleteSecret } = await import('$PWD/dist/web/vault.js')
    deleteSecret('$id'); console.log('Torolve: $id')
  "
  exit 0
fi

echo "Titok felvetele a vaultba. Amit beirsz, NEM jelenik meg a kepernyon."
echo
printf "Azonosito (pl. gmail_app_jelszo, csak betu/szam/alulvonas): "
read -r SECRET_ID
if ! printf '%s' "$SECRET_ID" | grep -qE '^[a-zA-Z0-9_]+$'; then
  echo "HIBA: az azonositoban csak betu, szam es alulvonas lehet." >&2; exit 1
fi
printf "Rovid leiras (mihez valo): "
read -r SECRET_LABEL
printf "Az ertek (nem fog latszani, Enterrel zarod): "
read -rs SECRET_VALUE
echo
if [ -z "$SECRET_VALUE" ]; then echo "HIBA: ures ertek, nem mentettem semmit." >&2; exit 1; fi

SECRET_ID="$SECRET_ID" SECRET_LABEL="$SECRET_LABEL" SECRET_VALUE="$SECRET_VALUE" \
node --input-type=module -e "
  const { setSecret } = await import('$PWD/dist/web/vault.js')
  setSecret(process.env.SECRET_ID, process.env.SECRET_LABEL || process.env.SECRET_ID, process.env.SECRET_VALUE)
  console.log('Elmentve titkositva: ' + process.env.SECRET_ID)
"
unset SECRET_VALUE
echo
echo "Kesz. Szolj Marveennek az AZONOSITOVAL (az erteket ne kuldd el sehova)."

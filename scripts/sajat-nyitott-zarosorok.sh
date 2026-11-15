#!/usr/bin/env bash
# sajat-nyitott-zarosorok.sh <ugynok> [--fixture FAJL]
# Felsorolja azokat a kartyakat, ahol az ugynok UTOLSO "VERDIKT:" sora NYITOTT TETEL, es utana
# egy MAS szerzo "VERDIKT: NINCS NYITOTT TETEL" sort irt. CSAK LISTA: semmit nem zar le, nem ir.
# A logika, az olvasat es a kimenet leirasa: scripts/sajat_nyitott_zarosorok.py (fejlec). Kartya: a31c7af0.
# A TOVABBITVA: sorral jelzett (jarvis altal tovabbitott) verdikt NEM szamit verdiktnek.
# Kilepes: 0 lefutott | 1 API/fixture nem olvashato | 2 hasznalat | 3 NULLA kartya olvasva.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -lt 1 ]; then
  sed -n '2,6p' "${BASH_SOURCE[0]}" >&2
  exit 2
fi
exec python3 "$HERE/sajat_nyitott_zarosorok.py" "$@"

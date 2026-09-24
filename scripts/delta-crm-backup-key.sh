#!/bin/bash
# Offsite backup key administration. Card 3acc137f.
#
#   status   where the key lives and whether the Keychain answers. Never the value.
#   init     generate a key and store it in the Keychain. Refuses if one exists.
#   show     print the key ONCE, for Isti to write down off the machine.
#   verify   type the paper copy back in; says whether it matches the Keychain.
#   check-paper  type the paper copy in; says whether its CHECKSUM holds. Needs
#            no Keychain -- this is the check that still works after a disaster.
#
# The key is 15 BIP39 words with a built-in checksum (scripts/lib/backup_key_words.py).
#
# WHY `show` REFUSES UNLESS BOTH STDIN AND STDOUT ARE A TERMINAL: every agent's
# shell tool runs on pipes, and whatever reaches a pipe ends up in a transcript,
# a log or a message. With this check an agent cannot print the key by accident
# -- measured: in an agent's tool `[ -t 1 ]` is false, under script(1) it is true.
# That is also the limit, stated rather than hidden: script(1) fakes a terminal,
# so this stops an ACCIDENT, not someone set on getting the key out.
#
# BEFORE YOU HAND THIS KEY TO ANYONE: the unsafe step here was once proposed by
# someone who knew the rule and had quoted it two paragraphs earlier. The pull
# came from thinking about DELIVERY ("Isti must end up holding this") and
# reaching for the usual channel without asking what travels on it and where it
# stays. A chat message is its server, our log and the transcript at once. Ask
# "what does this channel keep?" before "where does this need to arrive?".
#
# `verify` exists so the paper copy can be checked WITHOUT printing the key a
# second time: a copy nobody has checked is a hope, and the day it is needed is
# the worst day to learn one symbol was misread.

set -uo pipefail

LIB="$(dirname "${BASH_SOURCE[0]}")/lib/backup-key.sh"
[ -f "$LIB" ] || LIB="/Users/isti/marveen/scripts/lib/backup-key.sh"
[ -f "$LIB" ] || { echo "hianyzik: scripts/lib/backup-key.sh" >&2; exit 1; }
# shellcheck source=/dev/null
. "$LIB"

WHERE="macOS Keychain, service=$BACKUP_KEY_SERVICE account=$BACKUP_KEY_ACCOUNT"

need_terminal() {
  if [ ! -t 0 ] || [ ! -t 1 ]; then
    echo "ELUTASITVA: a '$1' csak terminalon fut (stdin es stdout is terminal kell)." >&2
    echo "Ez szandekos: csovon vagy naploban a kulcs nem jelenhet meg." >&2
    exit 3
  fi
}

case "${1:-}" in
  status)
    K=""
    backup_key_read K
    echo "hely:    $WHERE"
    echo "allapot: $BACKUP_KEY_STATUS"
    [ "$BACKUP_KEY_STATUS" = "ok" ]
    ;;

  init)
    K=""
    backup_key_generate K || { echo "a kulcs-generalas nem sikerult" >&2; exit 1; }
    if backup_key_store K; then
      echo "KESZ: uj offsite kulcs a helyen: $WHERE"
      echo "Az erteket ez a parancs NEM irta ki."
      echo "Kovetkezo lepes (Isti, terminalon): bash $0 show   -- aztan: bash $0 verify"
    else
      exit 1
    fi
    ;;

  show)
    need_terminal show
    K=""
    backup_key_read K || { echo "a kulcs nem olvashato ($BACKUP_KEY_STATUS) -- $WHERE" >&2; exit 1; }
    printf 'Ez az offsite mentes kulcsa. Ird le PAPIRRA, a gepen kivulre.\n'
    printf 'Ha ez a gep elvesz, ez az EGYETLEN ut a mentesekhez.\n\n'
    printf 'Folytatod? Ird be: IGEN  > '
    read -r ANSWER
    [ "$ANSWER" = "IGEN" ] || { echo "megszakitva, semmi nem jelent meg"; exit 1; }
    printf '\n'
    printf '%s' "$K" | "$BACKUP_KEY_PY" "$BACKUP_KEY_WORDS" grid || exit 1
    printf '\n15 angol szo, ebben a sorrendben. Ha egy szo vege elmosodik, az elso negy betuje is eleg.\n'
    printf 'Leirtad? Ellenorizd: bash %s verify\n' "$0"
    printf 'Nyomj Entert, es a kepernyo torlodik.'
    read -r _
    clear 2>/dev/null || printf '\033[2J\033[H'
    ;;

  verify)
    need_terminal verify
    K=""
    backup_key_read K || { echo "a kulcs nem olvashato ($BACKUP_KEY_STATUS) -- $WHERE" >&2; exit 1; }
    printf 'Gepeld be a papiron levo kulcsot (nem jelenik meg): '
    read -rs TYPED; echo
    N=""
    if ! backup_key_normalize N "$TYPED"; then
      echo "NEM EGYEZIK: a papiron levo szavak nem epek (lasd fent). Nezd meg ujra a papirt."; exit 1
    fi
    if [ "$N" = "$K" ]; then
      echo "EGYEZIK. A papiron levo masolat helyes."
    else
      echo "NEM EGYEZIK. A papiron levo masolat HIBAS -- javitsd a 'show' alapjan."; exit 1
    fi
    ;;

  check-paper)
    need_terminal check-paper
    printf 'Gepeld be a papiron levo 15 szot (nem jelenik meg): '
    read -rs TYPED; echo
    N=""
    if backup_key_normalize N "$TYPED"; then
      echo "EP: a 15 szo ellenorzo osszege rendben. (A Keychainnel a 'verify' veti ossze.)"
    else
      echo "HIBAS: a papiron levo masolat nem ep -- nezd meg a fenti okot."; exit 1
    fi
    ;;

  *)
    echo "hasznalat: $0 status|init|show|verify|check-paper" >&2
    exit 2
    ;;
esac

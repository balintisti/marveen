# Offsite backup passphrase: where it lives, how it is read, how it encrypts.
# Card 3acc137f. Sourced by delta-crm-backup.sh, delta-crm-backup-key.sh and
# delta-crm-restore-offsite.sh.
#
# THE RULE EVERYTHING HERE FOLLOWS: the key never lives next to the backup. If
# one event takes both, the encryption protected nothing and only made our own
# backup unreadable. So there are TWO copies in two trust domains:
#   1. macOS Keychain on this machine (service/account below) -- the automated
#      path, so the nightly run and a restore need no human.
#   2. ONE hand-written copy with Isti, OFF the machine -- because the Keychain
#      dies with exactly the machine the offsite copy exists to survive.
# Neither alone is enough.
#
# NEVER PRINT THE VALUE. Name its location. The functions below hand it back
# only into a shell variable, and pass it to gpg over a PIPE:
#   - /bin/bash on macOS is 3.2, which writes heredocs and here-strings to a
#     temp file, so a secret fed that way touches disk;
#   - `printf` is a builtin, so the value never reaches any process's argv.
#
# WHY gpg AND NOT OUR OWN AES-GCM (vault.ts has one): the restore that matters
# most happens on a NEW machine, after this one is dead, with nothing but the
# paper key. `gpg -d` needs no code of ours. Measured (gpg 2.5.18): a wrong
# passphrase exits 2 and writes no output file; one flipped byte in the
# ciphertext exits 2 ("the encrypted message was manipulated") -- BUT WRITES
# THE OUTPUT FILE ANYWAY, because gpg streams the plaintext and only learns at
# the end that it was tampered with. The first version of this comment said
# "no output in either case"; I had measured the exit code and not the file,
# and this card's own test caught it. So backup_decrypt deletes OUT on any
# failure: a caller must never find a plausible dump that failed its check.
#
# ABSOLUTE PATHS, because launchd runs the backup with PATH=/usr/bin:/bin:
# /usr/sbin:/sbin and Homebrew's gpg is not on it. A bare `gpg` would work in
# every interactive test and fail at 03:30.

BACKUP_KEY_SERVICE="com.marveen.delta-crm-backup"
BACKUP_KEY_ACCOUNT="offsite-passphrase"
BACKUP_KEY_SECURITY_BIN="${BACKUP_KEY_SECURITY_BIN:-/usr/bin/security}"
BACKUP_KEY_TIMEOUT="${BACKUP_KEY_TIMEOUT:-5}"
BACKUP_GPG_BIN="${BACKUP_GPG_BIN:-/opt/homebrew/bin/gpg}"
BACKUP_GPGCONF_BIN="${BACKUP_GPGCONF_BIN:-/opt/homebrew/bin/gpgconf}"

# THE KEY IS 15 BIP39 WORDS (160 bits + a 5-bit checksum), lowercase, joined by
# single spaces -- see backup_key_words.py for why words and not characters. All
# encoding, checksum and parsing lives there; this file only moves the value
# between the Keychain, gpg and a shell variable, always over stdin/stdout.
BACKUP_KEY_PY="${BACKUP_KEY_PY:-/usr/bin/python3}"
BACKUP_KEY_WORDS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup_key_words.py"

# backup_key_read VAR
#   Sets BACKUP_KEY_STATUS to one of:
#     ok           the Keychain answered with a well-formed key (now in VAR)
#     empty        the Keychain ANSWERED and there is no such item
#     unavailable  it did not answer: locked, timed out, denied
#     invalid      it answered with something that is not a key of ours
#     no-helper    backup_key_words.py or its word list is missing: the KEY may
#                  be fine, the install is not -- and saying "invalid" there
#                  would send someone to regenerate a key that needs no repair
#   Returns 0 only for ok. The split matters: "empty" and "unavailable" call for
#   different repairs, and treating a locked Keychain as "no key" is the exact
#   shape that nearly orphaned 49 vault secrets (VAULTUJKULCS822).
#   The timeout is `perl -e alarm` because stock macOS has no `timeout`, and a
#   locked Keychain can block on a GUI prompt nobody will ever click.
backup_key_read() {
  local __var="$1" __out __rc
  if [ ! -f "$BACKUP_KEY_WORDS" ] || [ ! -f "$(dirname "$BACKUP_KEY_WORDS")/bip39-english.txt" ]; then
    BACKUP_KEY_STATUS=no-helper; return 1
  fi
  __out=$(/usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$BACKUP_KEY_TIMEOUT" \
    "$BACKUP_KEY_SECURITY_BIN" find-generic-password \
    -s "$BACKUP_KEY_SERVICE" -a "$BACKUP_KEY_ACCOUNT" -w 2>/dev/null)
  __rc=$?
  if [ "$__rc" -eq 44 ]; then BACKUP_KEY_STATUS=empty; return 1; fi
  if [ "$__rc" -ne 0 ]; then BACKUP_KEY_STATUS=unavailable; return 1; fi
  if ! printf '%s' "$__out" | "$BACKUP_KEY_PY" "$BACKUP_KEY_WORDS" check; then
    BACKUP_KEY_STATUS=invalid; return 1
  fi
  printf -v "$__var" '%s' "$__out"
  BACKUP_KEY_STATUS=ok
  return 0
}

# backup_key_normalize VAR INPUT
#   Turns what a person types from paper into the canonical key: case and
#   separators do not matter, and a word may be given by its first four letters
#   (unique in the BIP39 list). Returns 1 -- with the reason on stderr, naming a
#   POSITION and never a word -- when the words are not 15 listed words whose
#   checksum holds. A typo must fail HERE, not after a gpg run that reports
#   "bad session key" and sends someone hunting for a corrupted backup.
backup_key_normalize() {
  local __var="$1" __c
  __c=$(printf '%s' "$2" | "$BACKUP_KEY_PY" "$BACKUP_KEY_WORDS" normalize) || return 1
  printf -v "$__var" '%s' "$__c"
}

# backup_key_generate VAR -- a fresh key, canonical form, into VAR only.
backup_key_generate() {
  local __k
  __k=$("$BACKUP_KEY_PY" "$BACKUP_KEY_WORDS" generate) || return 1
  printf '%s' "$__k" | "$BACKUP_KEY_PY" "$BACKUP_KEY_WORDS" check || return 1
  printf -v "$1" '%s' "$__k"
}

# backup_key_store VAR
#   Writes the key into the Keychain, then READS IT BACK and compares: a 0 exit
#   from `security` is not proof, the read-back is. Refuses unless the item is
#   absent: overwriting a key orphans every backup already encrypted with it,
#   and the paper copy would then restore nothing.
#   The value travels on STDIN of `security -i`, never on argv (the vault's own
#   keychainStore passes it as `-w <value>`, readable in `ps` for the duration).
backup_key_store() {
  local __new="${!1}" __back
  backup_key_read __back
  case "$BACKUP_KEY_STATUS" in
    empty) ;;
    ok|invalid) echo "backup-key: an item already exists at $BACKUP_KEY_SERVICE/$BACKUP_KEY_ACCOUNT -- refusing to overwrite it" >&2; return 1 ;;
    *) echo "backup-key: the Keychain did not answer ($BACKUP_KEY_STATUS) -- refusing, nothing was written" >&2; return 1 ;;
  esac
  printf '%s' "$__new" | "$BACKUP_KEY_PY" "$BACKUP_KEY_WORDS" check \
    || { echo "backup-key: refusing to store a malformed key" >&2; return 1; }
  # Quoted: the key has spaces. Measured on the real `security -i` with a
  # throwaway item: "alpha beta gamma" is stored and read back byte-identical.
  printf 'add-generic-password -s %s -a %s -T %s -w "%s"\n' \
    "$BACKUP_KEY_SERVICE" "$BACKUP_KEY_ACCOUNT" "$BACKUP_KEY_SECURITY_BIN" "$__new" \
    | "$BACKUP_KEY_SECURITY_BIN" -i >/dev/null 2>&1
  __back=""
  if ! backup_key_read __back || [ "$__back" != "$__new" ]; then
    echo "backup-key: stored, but the read-back does not match ($BACKUP_KEY_STATUS) -- treat the key as NOT stored" >&2
    return 1
  fi
  return 0
}

# _backup_gpg KEYVAR ARGS... -- one gpg run in a throwaway homedir, passphrase
# on fd 0. A private homedir means no agent state, no cached passphrase and no
# keyring of the user's is involved; --no-symkey-cache on top so a cache can
# never turn a wrong key into a success.
_backup_gpg() {
  local __key="${!1}" __home __rc; shift
  __home=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/bk-gpg.XXXXXX") || return 1
  /bin/chmod 700 "$__home"
  printf '%s' "$__key" | LC_ALL=C "$BACKUP_GPG_BIN" --homedir "$__home" --batch --yes --quiet \
    --no-symkey-cache --pinentry-mode loopback --passphrase-fd 0 "$@"
  __rc=$?
  "$BACKUP_GPGCONF_BIN" --homedir "$__home" --kill gpg-agent >/dev/null 2>&1
  /bin/rm -rf "$__home"
  return "$__rc"
}

# backup_encrypt KEYVAR IN OUT
backup_encrypt() {
  _backup_gpg "$1" --symmetric --cipher-algo AES256 \
    --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 \
    --output "$3" "$2"
}

# backup_decrypt KEYVAR IN OUT -- exits non-zero on a wrong key or a tampered
# file, and leaves NO OUT in either case. gpg itself leaves one behind on a
# tampered file (see the header), so the guarantee lives here, once, rather
# than in every caller's memory.
backup_decrypt() {
  local __rc
  /bin/rm -f "$3"
  _backup_gpg "$1" --decrypt --output "$3" "$2"
  __rc=$?
  [ "$__rc" -eq 0 ] || /bin/rm -f "$3"
  return "$__rc"
}

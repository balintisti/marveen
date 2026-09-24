"""Offsite backup key as a BIP39 word list. Card 3acc137f.

The key is 15 English words: 160 bits of entropy plus a 5-bit checksum, encoded
exactly as BIP39 does (ENT=160, CS=5, MS=15). The canonical passphrase gpg gets
is those 15 words, lowercase, joined by single spaces.

WHY WORDS AND NOT RANDOM CHARACTERS (marveen's ruling, and the reason is the
checksum, not looks): a hand-copied random string can be silently wrong, and the
day that shows is the day of the restore. With a checksum the PAPER COPY ITSELF
says whether it is intact -- without the Keychain, which is exactly what is gone
in the disaster this copy exists for. And BIP39's list has a unique first four
letters for every word, so a smudged ending still resolves.

Standard, on purpose: any BIP39 tool can check these words, and `gpg -d` needs
nothing of ours. The encoding is pinned to the official test vectors in the test.

THE KEY NEVER TRAVELS ON argv: generate writes it to stdout, the others read it
from stdin. Error messages name a POSITION, never a word -- a typed word is key
material, and stderr goes to logs.

  generate    print a fresh canonical key
  normalize   stdin -> canonical key (tolerates case, separators, 4-letter prefixes)
  check       exit 0 iff stdin is ALREADY canonical and its checksum holds
  grid        stdin (canonical) -> numbered grid for writing down
  encode HEX  entropy hex -> words (test vectors only; never used with the real key)
"""
import hashlib
import os
import re
import secrets
import sys

WORDLIST_SHA256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"
ENT_BYTES = 20
N_WORDS = 15


def die(msg, code=1):
    sys.stderr.write("backup-key: " + msg + "\n")
    sys.exit(code)


def load_words():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bip39-english.txt")
    try:
        raw = open(path, "rb").read()
    except OSError:
        die("missing word list: " + path, 3)
    # A damaged list would decode a correct paper copy into a WRONG key, and gpg
    # would then report "bad session key" -- indistinguishable from a bad backup.
    if hashlib.sha256(raw).hexdigest() != WORDLIST_SHA256:
        die("word list integrity check FAILED (sha256 mismatch): " + path, 3)
    words = raw.decode("ascii").split("\n")
    if words and words[-1] == "":
        words = words[:-1]
    return words


def encode(entropy, words):
    ent_bits = len(entropy) * 8
    cs_bits = ent_bits // 32
    h = hashlib.sha256(entropy).digest()
    total = (int.from_bytes(entropy, "big") << cs_bits) | (h[0] >> (8 - cs_bits))
    n = (ent_bits + cs_bits) // 11
    return [words[(total >> (11 * (n - 1 - i))) & 2047] for i in range(n)]


def decode_checked(tokens, words):
    """tokens -> canonical list, or an error naming a POSITION only."""
    if len(tokens) != N_WORDS:
        return None, "expected %d words, got %d" % (N_WORDS, len(tokens))
    index = {w: i for i, w in enumerate(words)}
    idx = []
    for pos, t in enumerate(tokens, 1):
        if t in index:
            idx.append(index[t])
            continue
        hits = [i for i, w in enumerate(words) if len(t) >= 4 and w.startswith(t[:4])]
        if len(hits) != 1:
            return None, "word %d is not on the list" % pos
        idx.append(hits[0])
    total = 0
    for i in idx:
        total = (total << 11) | i
    cs_bits = ENT_BYTES * 8 // 32
    entropy = (total >> cs_bits).to_bytes(ENT_BYTES, "big")
    if (total & ((1 << cs_bits) - 1)) != (hashlib.sha256(entropy).digest()[0] >> (8 - cs_bits)):
        return None, "checksum does not match -- a word is wrong or two are swapped"
    return [words[i] for i in idx], None


def main():
    if len(sys.argv) < 2:
        die("usage: generate|normalize|check|grid|encode HEX", 2)
    cmd = sys.argv[1]
    words = load_words()

    if cmd == "generate":
        sys.stdout.write(" ".join(encode(secrets.token_bytes(ENT_BYTES), words)))
        return
    if cmd == "encode":
        sys.stdout.write(" ".join(encode(bytes.fromhex(sys.argv[2]), words)))
        return

    data = sys.stdin.read()
    if cmd == "check":
        canon, err = decode_checked(data.split(" "), words)
        sys.exit(0 if canon and " ".join(canon) == data else 1)
    if cmd == "normalize":
        # Everything that is not a letter separates words; case is ignored.
        canon, err = decode_checked(re.findall(r"[a-z]+", data.lower()), words)
        if err:
            die(err)
        sys.stdout.write(" ".join(canon))
        return
    if cmd == "grid":
        canon, err = decode_checked(data.split(" "), words)
        if err:
            die(err)
        for row in range(5):
            sys.stdout.write("    " + "".join(
                "%2d. %-10s" % (row * 3 + c + 1, canon[row * 3 + c]) for c in range(3)) + "\n")
        return
    die("unknown command: " + cmd, 2)


if __name__ == "__main__":
    main()

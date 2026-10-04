#!/bin/bash
# Card 3acc137f -- the offsite copy of the Delta-CRM backup is encrypted, and
# the four things marveen asked to see PROVEN, not asserted:
#   1. the key never appears in a log, an argv, or anything the agent tool prints
#   2. a restore is actually PERFORMED (into a throwaway Postgres, rows compared)
#   3. a WRONG KEY FAILS LOUDLY -- and a tampered file too -- writing no output
#   4. after a backup the key is NOT inside it, by object name AND by content
# plus the one the old code got wrong: no key -> NOTHING uploaded, never plaintext.
#
# Nothing here touches production, the real Keychain or the real bucket:
# `security` and `r2.py` are stubs, the database is a temp cluster on a socket.
# The scripts under test run under /bin/bash (3.2), because that is what launchd
# runs them with; a pass under Homebrew's bash 5 would prove nothing about 03:30.
#
# Run: bash scripts/__tests__/delta-crm-offsite-encryption.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d)
PGBIN_SRV=/opt/homebrew/bin
PGBIN_CLI=/opt/homebrew/opt/libpq/bin
PORT=54391
cleanup() {
  [ -d "$TMP/pg" ] && "$PGBIN_SRV/pg_ctl" -D "$TMP/pg" -m immediate stop >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT
PASS=0; FAIL=0
ok(){ printf '  ok   %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  FAIL %s\n' "$1"; FAIL=$((FAIL+1)); }

# ---------------------------------------------------------------------------
# stubs
# ---------------------------------------------------------------------------
KC="$TMP/kc"; mkdir -p "$KC"
SEC="$TMP/security"
cat > "$SEC" <<EOF
#!/bin/bash
# Keychain stand-in. Every argv is logged so the test can prove the key never
# reached one. \`-i\` reads commands on stdin, like the real tool.
printf '%s\n' "\$*" >> "$KC/argv.log"
case "\$1" in
  find-generic-password)
    [ -f "$KC/hang" ] && exec sleep 30
    [ -f "$KC/value" ] || exit 44
    cat "$KC/value"; echo; exit 0 ;;
  -i)
    line=\$(cat); v=\${line##* -w }; v=\${v#\\"}; v=\${v%\\"}
    [ -f "$KC/corrupt-store" ] && v="\${v}X"
    printf '%s' "\$v" > "$KC/value"; exit 0 ;;
esac
exit 1
EOF
chmod +x "$SEC"
export BACKUP_KEY_SECURITY_BIN="$SEC"

BUCKET="$TMP/bucket"; mkdir -p "$BUCKET"
R2="$TMP/r2.py"
cat > "$R2" <<EOF
import os, shutil, sys
b = "$BUCKET"
cmd = sys.argv[1]
# failure switches for case 13: one object's put fails, or the listing fails the
# way the real r2.py does (a HIBA line on stdout, rc 1)
if cmd == "put" and os.environ.get("R2_FAIL_PUT") and os.environ["R2_FAIL_PUT"] in sys.argv[4]:
    sys.exit(1)
if cmd == "list" and os.environ.get("R2_FAIL_LIST"):
    print("HIBA 500: stub list failure"); sys.exit(1)
if cmd == "put":
    shutil.copyfile(sys.argv[3], os.path.join(b, sys.argv[4]))
elif cmd == "list":
    for n in sorted(os.listdir(b)):
        print("%10d  2026-01-01T00:00:00Z  %s" % (os.path.getsize(os.path.join(b, n)), n))
elif cmd == "get":
    shutil.copyfile(os.path.join(b, sys.argv[3]), sys.argv[4])
elif cmd == "delete":
    os.remove(os.path.join(b, sys.argv[3]))
EOF

NOTIFIED="$TMP/notified.txt"
STUBN="$TMP/notify.sh"
printf '#!/bin/bash\necho "$*" >> "%s"\nexit 0\n' "$NOTIFIED" > "$STUBN"; chmod +x "$STUBN"

# a runnable copy of the backup script with every path pointed into $TMP
mkdir -p "$TMP/scripts/lib" "$TMP/backups"
# every file the copy sources or runs -- the word helper and its list included,
# or the copy fails closed with `no-helper` and every case below measures that
cp "$HERE/lib/backup-key.sh" "$HERE/lib/pg-argv-safe.sh" "$HERE/lib/backup_key_words.py" \
   "$HERE/lib/bip39-english.txt" "$HERE/lib/backup-retention.sh" "$TMP/scripts/lib/"
cp "$HERE/delta-crm-backup-key.sh" "$HERE/delta-crm-restore-offsite.sh" "$TMP/scripts/"
sed -i '' -e "s|^R2_SCRIPT=.*|R2_SCRIPT=\"$R2\"|" "$TMP/scripts/delta-crm-restore-offsite.sh"
ENVF="$TMP/.env"; echo 'DATABASE_URL=postgresql://u:p@nincs-ilyen.invalid:5432/db' > "$ENVF"
: > "$TMP/r2-key"
FAKEBIN="$TMP/fakebin"; mkdir -p "$FAKEBIN"
sed -e "s|^ENV_FILE=.*|ENV_FILE=\"$ENVF\"|" \
    -e "s|^BACKUP_DIR=.*|BACKUP_DIR=\"$TMP/backups\"|" \
    -e "s|^NOTIFY_SCRIPT=.*|NOTIFY_SCRIPT=\"$STUBN\"|" \
    -e "s|^DASHBOARD_TOKEN_FILE=.*|DASHBOARD_TOKEN_FILE=\"$TMP/nincs-token\"|" \
    -e "s|^R2_KEY_FILE=.*|R2_KEY_FILE=\"$TMP/r2-key\"|" \
    -e "s|^R2_SCRIPT=.*|R2_SCRIPT=\"$R2\"|" \
    -e "s|^PG_BIN=.*|PG_BIN=\"$FAKEBIN\"|" \
    "$HERE/delta-crm-backup.sh" > "$TMP/scripts/delta-crm-backup.sh"

# ---------------------------------------------------------------------------
# a REAL custom-format dump, from a throwaway cluster: the backup script checks
# the archive with pg_restore and wants >= 50 tables, so a fake file would stop
# it long before the part under test.
# ---------------------------------------------------------------------------
for b in "$PGBIN_SRV/initdb" "$PGBIN_SRV/pg_ctl" "$PGBIN_CLI/pg_dump" "$PGBIN_CLI/pg_restore" "$PGBIN_CLI/psql"; do
  [ -x "$b" ] || { echo "HIANYZO ESZKOZ: $b -- a teszt nem tud valodi mentest es visszaallitast merni"; exit 1; }
done
"$PGBIN_SRV/initdb" -D "$TMP/pg" -U t --auth=trust >/dev/null 2>&1 || { echo "initdb bukott"; exit 1; }
mkdir -p "$TMP/sock"
"$PGBIN_SRV/pg_ctl" -D "$TMP/pg" -l "$TMP/pg.log" -w \
  -o "-k $TMP/sock -p $PORT -c listen_addresses=''" start >/dev/null 2>&1 || { echo "pg_ctl start bukott"; exit 1; }
PSQL="$PGBIN_CLI/psql -h $TMP/sock -p $PORT -U t -q -v ON_ERROR_STOP=1"
$PSQL -d postgres -c 'CREATE DATABASE src' -c 'CREATE DATABASE dst' || { echo "createdb bukott"; exit 1; }
{
  for i in $(seq 1 55); do echo "CREATE TABLE t$i (id int primary key, v text);"; done
  echo "INSERT INTO t1 SELECT g, md5(g::text) FROM generate_series(1,5402) g;"
  echo "INSERT INTO t2 SELECT g, 'x' FROM generate_series(1,77) g;"
} | $PSQL -d src || { echo "fixture feltoltes bukott"; exit 1; }
"$PGBIN_CLI/pg_dump" -h "$TMP/sock" -p $PORT -U t --format=custom --compress=9 --no-owner \
  --no-privileges --schema=public --file="$TMP/fixture.dump" src || { echo "fixture dump bukott"; exit 1; }

# fake pg_dump for the backup script: copy the fixture to --file=
cat > "$FAKEBIN/pg_dump" <<EOF
#!/bin/bash
for a in "\$@"; do case "\$a" in --file=*) cp "$TMP/fixture.dump" "\${a#--file=}";; esac; done
EOF
chmod +x "$FAKEBIN/pg_dump"
ln -s "$PGBIN_CLI/pg_restore" "$FAKEBIN/pg_restore"

. "$HERE/lib/backup-key.sh"

# key_in KEY TEXT -> "True" when the 15 words appear IN ORDER among the letter
# tokens of TEXT. `show` prints them in a numbered grid, so a grep for the
# space-joined key could never match there, and "the key did not appear" would
# pass BLIND. This detector sees the grid and the joined form alike.
key_in() {
  printf '%s' "$2" | python3 -c 'import re,sys
t=re.findall("[a-z]+",sys.stdin.read()); k=sys.argv[1].split()
print(any(t[i:i+len(k)]==k for i in range(len(t))))' "$1"
}

echo "== 1. a kulcs olvasasa: negy allapot, es egyik sem keveredik a masikkal =="
rm -f "$KC/value"; V=""
backup_key_read V; [ "$BACKUP_KEY_STATUS" = empty ] && ok 'nincs elem -> empty' || no "nincs elem -> $BACKUP_KEY_STATUS"
printf 'nem-kulcs' > "$KC/value"
backup_key_read V; [ "$BACKUP_KEY_STATUS" = invalid ] && ok 'rossz alaku ertek -> invalid' || no "rossz alak -> $BACKUP_KEY_STATUS"
rm -f "$KC/value"; touch "$KC/hang"
T0=$(date +%s); BACKUP_KEY_TIMEOUT=1 backup_key_read V; T1=$(date +%s)
[ "$BACKUP_KEY_STATUS" = unavailable ] && ok 'lefagyo Keychain -> unavailable, NEM empty' || no "lefagyas -> $BACKUP_KEY_STATUS"
[ $((T1 - T0)) -le 4 ] && ok "a lefagyast az idokorlat vagja el ($((T1 - T0))s)" || no "a lefagyas $((T1 - T0))s-ig tartott"
rm -f "$KC/hang"

echo "== 2. generalas, papirrol visszagepeles, ellenorzo osszeg =="
W="$HERE/lib/backup_key_words.py"
# The encoding must be EXACTLY BIP39, or "any BIP39 tool can check the paper"
# is false. Official vectors (Trezor), two lengths:
V1=$(python3 "$W" encode 00000000000000000000000000000000)
[ "$V1" = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" ] \
  && ok 'BIP39 hivatalos vektor (128 bit, nulla)' || no "BIP39 vektor elter: $V1"
V2=$(python3 "$W" encode 7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f)
[ "$V2" = "legal winner thank year wave sausage worth useful legal winner thank yellow" ] \
  && ok 'BIP39 hivatalos vektor (128 bit, 7f)' || no "BIP39 vektor elter: $V2"
K1=""; K2=""; backup_key_generate K1; backup_key_generate K2
[ "$(printf '%s' "$K1" | wc -w | tr -d ' ')" = 15 ] && ok 'a generalt kulcs 15 szo' || no 'a generalt kulcs nem 15 szo'
printf '%s' "$K1" | python3 "$W" check && ok 'a generalt kulcs ellenorzo osszege rendben' || no 'a generalt kulcs NEM ep'
[ "$K1" != "$K2" ] && ok 'ket generalas kulonbozo' || no 'ket generalas AZONOS'
SLOPPY=$(printf '%s' "$K1" | tr '[:lower:]' '[:upper:]' | sed 's/ /  -  /g')
N=""; backup_key_normalize N "$SLOPPY" && [ "$N" = "$K1" ] && ok 'nagybetu + kotojel + tobb szokoz -> ugyanaz a kulcs' || no 'a normalizalas nem adta vissza'
PREF=$(printf '%s' "$K1" | awk '{for(i=1;i<=NF;i++) printf "%s ", substr($i,1,4)}')
N=""; backup_key_normalize N "$PREF" && [ "$N" = "$K1" ] && ok 'csak az elso negy betu -> ugyanaz a kulcs' || no 'a 4-betus elotag nem oldodott fel'
Z=$(python3 "$W" encode 0000000000000000000000000000000000000000)
BAD=$(printf '%s' "$Z" | sed 's/^abandon/ability/')
ERR=$(backup_key_normalize N "$BAD" 2>&1 >/dev/null); RC=$?
[ "$RC" -ne 0 ] && ok 'egy rossz szo -> az ellenorzo osszeg elkapja' || no 'EGY ROSSZ SZOT ELFOGADOTT'
printf '%s' "$ERR" | grep -q 'checksum' && ok 'az ok: checksum' || no "az ok nem a checksum: $ERR"
printf '%s' "$ERR" | grep -qE 'ability|abandon' && no 'A HIBAUZENET SZOT IDEZ (kulcs-anyag a naploban)' || ok 'a hibauzenet nem idez szot'
backup_key_normalize N "${K1% *}" 2>/dev/null && no '14 szot ELFOGADOTT' || ok '14 szo -> elutasitva, meg a gpg elott'
ERR=$(backup_key_normalize N "$(printf '%s' "$K1" | sed 's/^[a-z]*/qqqq/')" 2>&1 >/dev/null)
printf '%s' "$ERR" | grep -q 'word 1 is not on the list' && ok 'ismeretlen szo -> a POZICIOJAT nevezi meg' || no "ismeretlen szo uzenete: $ERR"
# on a COPY: a test that edits the source tree leaves it broken if it dies midway
mkdir -p "$TMP/wl"; cp "$W" "$HERE/lib/bip39-english.txt" "$TMP/wl/"
python3 "$TMP/wl/backup_key_words.py" generate >/dev/null 2>&1 && ok 'KONTROLL: az ep masolattal mukodik' || no 'KONTROLL: az ep masolat sem mukodik'
printf 'x' >> "$TMP/wl/bip39-english.txt"
python3 "$TMP/wl/backup_key_words.py" generate >/dev/null 2>&1 && no 'SERULT szolistaval is generalt' || ok 'serult szolista -> megtagad (sha256 rogzitve)'

echo "== 3. tarolas: stdin-en, visszaolvasva, felulirast megtagad =="
rm -f "$KC/value" "$KC/argv.log"
backup_key_store K1 2>/dev/null && ok 'ures helyre tarol' || no 'nem tarolt ures helyre'
grep -qF "$K1" "$KC/argv.log" && no 'A KULCS AZ ARGV-N VOLT' || ok 'a kulcs egyetlen argv-ban sem jelent meg'
grep -qF -- "-i" "$KC/argv.log" && ok 'KONTROLL: az argv-naplo tenyleg rogzit (a -i ott van)' || no 'KONTROLL: az argv-naplo ures, a fenti ok semmit nem jelent'
backup_key_store K2 2>/dev/null && no 'FELULIRT egy meglevo kulcsot' || ok 'meglevo kulcsot nem ir felul'
V=""; backup_key_read V; [ "$V" = "$K1" ] && ok 'a meglevo kulcs erintetlen maradt' || no 'a meglevo kulcs megvaltozott'
rm -f "$KC/value"; touch "$KC/corrupt-store"
backup_key_store K1 2>/dev/null && no 'eltero visszaolvasasnal SIKERT mondott' || ok 'eltero visszaolvasas -> NEM tarolt'
rm -f "$KC/corrupt-store"; printf '%s' "$K1" > "$KC/value"

echo "== 4. rossz kulcs es hamisitott fajl HANGOSAN bukik, kimenet nelkul =="
backup_encrypt K1 "$TMP/fixture.dump" "$TMP/f.gpg" 2>/dev/null && ok 'titkosit' || no 'nem titkosit'
backup_decrypt K1 "$TMP/f.gpg" "$TMP/f.ok" 2>/dev/null && cmp -s "$TMP/f.ok" "$TMP/fixture.dump" \
  && ok 'KONTROLL: a jo kulcs byte-azonosat ad (a mero tud igent mondani)' || no 'a jo kulcs sem allitja vissza'
backup_decrypt K2 "$TMP/f.gpg" "$TMP/f.bad" 2>/dev/null && no 'ROSSZ KULCCSAL SIKERT ADOTT' || ok 'rossz kulcs -> nem nulla kilepes'
[ -e "$TMP/f.bad" ] && no 'rossz kulcsnal kimeneti fajl keletkezett' || ok 'rossz kulcsnal NINCS kimeneti fajl'
python3 -c "import sys;b=bytearray(open(sys.argv[1],'rb').read());b[len(b)//2]^=1;open(sys.argv[2],'wb').write(b)" "$TMP/f.gpg" "$TMP/t.gpg"
backup_decrypt K1 "$TMP/t.gpg" "$TMP/t.out" 2>/dev/null && no 'HAMISITOTT fajlra SIKERT adott' || ok 'egy bit atforditva -> bukik'
[ -e "$TMP/t.out" ] && no 'hamisitott fajlnal kimeneti fajl keletkezett' || ok 'hamisitott fajlnal NINCS kimeneti fajl'
cmp -s "$TMP/f.gpg" "$TMP/fixture.dump" && no 'a titkositott fajl AZONOS a nyers mentessel' || ok 'a titkositott fajl nem a nyers mentes'

echo "== 5. show: az agens eszkozebol NEM irja ki a kulcsot =="
OUTP=$(printf 'IGEN\n\n' | /bin/bash "$TMP/scripts/delta-crm-backup-key.sh" show 2>&1); RC=$?
[ "$RC" -eq 3 ] && ok "csovon hivva megtagad (rc=$RC)" || no "csovon hivva rc=$RC"
[ "$(key_in "$K1" "$OUTP")" = False ] && ok 'a kulcs nem jelent meg a kimenetben' || no 'A KULCS MEGJELENT A KIMENETBEN'
# The control needs a REAL terminal that answers only AFTER the prompt: script(1)
# pushes piped input into the pty before the prompt and appends ^D, so `read`
# never sees "IGEN" -- a first version of this control failed for exactly that
# reason and said nothing about `show`. A pty driver waits, then types.
TTYOUT=$(python3 - "$TMP/scripts/delta-crm-backup-key.sh" <<'PYDRV'
import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv("/bin/bash", ["/bin/bash", sys.argv[1], "show"])
buf = b""
def until(tok, t=20):
    global buf
    end = time.time() + t
    while tok not in buf and time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: buf += os.read(fd, 4096)
            except OSError: return
until(b"IGEN  >"); os.write(fd, b"IGEN\r")
until(b"Enter"); os.write(fd, b"\r")
until(b"__never__", 2)
os.waitpid(pid, 0)
sys.stdout.write(buf.decode("utf-8", "replace"))
PYDRV
)
[ "$(key_in "$K1" "$TTYOUT")" = True ] && ok 'KONTROLL: terminalon MEGJELENIK (a tiltas a tty-feltetel, nem egy torott szkript)' \
  || no 'KONTROLL: terminalon sem jelenik meg -- a fenti tiltas nem a tty miatt tortent'
ST=$(/bin/bash "$TMP/scripts/delta-crm-backup-key.sh" status 2>&1)
[ "$(key_in "$K1" "$ST")" = False ] && ok 'a status csak a helyet nevezi meg' || no 'a status KIIRTA a kulcsot'

echo "== 6. a mentes: titkositva megy fel, nyersen soha =="
: > "$TMP/backups/backup.log"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1; RC=$?
[ "$RC" -eq 0 ] && ok 'a futas sikeres' || no "a futas rc=$RC"
LOCAL=$(ls "$TMP/backups" | grep -E '^delta-crm-.*-public\.dump$' | head -1)
[ -n "$LOCAL" ] && ok "helyi mentes megvan ($LOCAL)" || no 'nincs helyi mentes'
[ -f "$BUCKET/$LOCAL.gpg" ] && ok 'a bucketben a .gpg van' || no 'nincs .gpg a bucketben'
[ -f "$BUCKET/$LOCAL" ] && no 'A BUCKETBE NYERS MENTES KERULT' || ok 'nyers .dump nem kerult a bucketbe'
backup_decrypt K1 "$BUCKET/$LOCAL.gpg" "$TMP/rt.dump" 2>/dev/null && cmp -s "$TMP/rt.dump" "$TMP/backups/$LOCAL" \
  && ok 'a feltoltott objektum a Keychain-kulccsal a helyi mentesre fejtodik vissza' || no 'a feltoltott objektum nem ad vissza a helyi mentest'
ls -a "$TMP/backups" | grep -qE '\.(tmp|check)$' && no 'titkositasi maradvany maradt a mappaban' || ok 'nem maradt .tmp/.check fajl'
[ "$(key_in "$K1" "$(cat "$TMP/backups/backup.log")")" = False ] && ok 'a kulcs nincs a naploban' || no 'A KULCS A NAPLOBAN VAN'

echo "== 7. a kulcs NINCS a mentesben: nev es tartalom szerint =="
printf 'elotte %s utana' "$K1" > "$TMP/probe"
grep -qF "$K1" "$TMP/probe" && ok 'KONTROLL: a kereses megtalalja a kulcsot, ahol ott van' || no 'KONTROLL: a kereses VAK'
NOBJ=$(ls "$BUCKET" | wc -l | tr -d ' ')
[ "$NOBJ" -ge 1 ] && ok "ELOFELTETEL: a bucketben $NOBJ objektum van (uresen a lenti ket proba vakon menne at)" || no 'ELOFELTETEL: a bucket URES, a lenti probak semmit nem mernek'
ls "$BUCKET" | grep -qiE "key|kulcs|passphrase|${K1%% *}" && no 'egy objektum neve kulcsra utal' || ok 'egyetlen objektum neve sem kulcs'
HIT=0
for f in "$BUCKET"/* "$TMP/rt.dump"; do grep -qaF "$K1" "$f" && HIT=1; done
"$PGBIN_CLI/pg_restore" --file=- "$TMP/rt.dump" 2>/dev/null | grep -qF "$K1" && HIT=1
[ "$HIT" -eq 0 ] && ok 'a kulcs egyik objektumban, a visszafejtett mentesben es annak SQL-jeben sincs' || no 'A KULCS BENNE VAN A MENTESBEN'

echo "== 6b. ha a titkositott masolat NEM fejtheto vissza, NEM megy fel =="
# A gpg wrapper that encrypts correctly and then flips one byte of what it wrote:
# the object that WOULD be uploaded no longer decrypts. Without the round trip in
# delta-crm-backup.sh that corrupt object would reach the bucket and the first
# person to learn of it would be the one restoring.
GW="$TMP/gpg-corrupting"
cat > "$GW" <<EOF
#!/bin/bash
/opt/homebrew/bin/gpg "\$@"; rc=\$?
out=""; prev=""; enc=0
for a in "\$@"; do [ "\$prev" = "--output" ] && out="\$a"; [ "\$a" = "--symmetric" ] && enc=1; prev="\$a"; done
if [ "\$enc" = 1 ] && [ -n "\$out" ] && [ -f "\$out" ]; then
  python3 -c "import sys;p=sys.argv[1];b=bytearray(open(p,'rb').read());b[len(b)//2]^=1;open(p,'wb').write(b)" "\$out"
fi
exit \$rc
EOF
chmod +x "$GW"
rm -f "$BUCKET"/* "$NOTIFIED"
sleep 1; BACKUP_GPG_BIN="$GW" /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ -z "$(ls "$BUCKET")" ] && ok 'serult titkositott masolat -> NEM ment fel' || no "serult masolat FELMENT: $(ls "$BUCKET")"
grep -q 'oda-vissza ellenorzese NEM egyezett' "$TMP/backups/backup.log" && ok 'a naplo megnevezi az oda-vissza hibat' || no 'az oda-vissza hiba nincs a naploban'
[ -f "$NOTIFIED" ] && ok 'riasztas ment' || no 'nem ment riasztas a serult masolatrol'

echo "== 8. nincs kulcs -> NEM tolt fel, riaszt (a regi kod nyersen toltott fel) =="
rm -f "$BUCKET"/* "$NOTIFIED"; rm -f "$KC/value"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ -z "$(ls "$BUCKET")" ] && ok 'ures Keychain -> SEMMI nem ment fel' || no "ures Keychain mellett feltoltott: $(ls "$BUCKET")"
grep -q 'KIHAGYVA.*empty' "$TMP/backups/backup.log" && ok 'a naplo megnevezi: empty' || no 'a naplo nem nevezi meg az okot'
[ -f "$NOTIFIED" ] && grep -q 'NEM ment fel' "$NOTIFIED" && ok 'riasztas ment' || no 'nem ment riasztas'
rm -f "$NOTIFIED"; touch "$KC/hang"
sleep 1; BACKUP_KEY_TIMEOUT=1 /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ -z "$(ls "$BUCKET")" ] && ok 'lefagyo Keychain -> SEMMI nem ment fel' || no 'lefagyo Keychain mellett feltoltott'
grep -q 'KIHAGYVA.*unavailable' "$TMP/backups/backup.log" && ok 'a naplo megnevezi: unavailable' || no 'unavailable nincs a naploban'
rm -f "$KC/hang"; printf '%s' "$K1" > "$KC/value"
mv "$TMP/scripts/lib/backup_key_words.py" "$TMP/helper.away"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ -z "$(ls "$BUCKET")" ] && ok 'hianyzo segedprogram -> SEMMI nem ment fel' || no 'hianyzo segedprogram mellett feltoltott'
grep -q 'KIHAGYVA.*no-helper' "$TMP/backups/backup.log" && ok 'a naplo no-helper-t mond, nem invalid-ot' || no 'a naplo nem nevezi meg a hianyzo segedprogramot'
mv "$TMP/helper.away" "$TMP/scripts/lib/backup_key_words.py"

echo "== 9. a bucket-tukor mindket utotagot kezeli =="
rm -f "$BUCKET"/*
ls "$TMP/backups"/delta-crm-*.dump | head -1 | xargs -I{} basename {} > "$TMP/keepname"
KEEP=$(cat "$TMP/keepname")
: > "$BUCKET/$KEEP"                                     # regi, nyers, helyi parja van
: > "$BUCKET/delta-crm-20200101-000000-public.dump"      # regi, nyers, helyi par NINCS
: > "$BUCKET/delta-crm-20200102-000000-public.dump.gpg"  # titkositott, helyi par NINCS
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
LC=$(ls "$TMP/backups" | grep -cE '\.dump$')
if [ "$LC" -ge 3 ]; then
  [ -f "$BUCKET/$KEEP" ] && ok 'nyers objektum, aminek VAN helyi parja: marad' || no 'torolt egy objektumot, aminek van helyi parja'
  [ -f "$BUCKET/delta-crm-20200101-000000-public.dump" ] && no 'a par nelkuli NYERS objektum maradt' || ok 'a par nelkuli nyers objektum torolve'
  [ -f "$BUCKET/delta-crm-20200102-000000-public.dump.gpg" ] && no 'a par nelkuli .gpg objektum maradt' || ok 'a par nelkuli .gpg objektum torolve'
else
  no "a tukor-proba elofeltetele nem all: $LC helyi mentes (min 3)"
fi

echo "== 10. VISSZAALLITAS, tenylegesen: bucket -> visszafejtes -> eldobhato adatbazis =="
OUTD="$TMP/restore"
MIN_TABLES=50 /bin/bash "$TMP/scripts/delta-crm-restore-offsite.sh" --latest "$OUTD" >"$TMP/r.out" 2>&1; RC=$?
[ "$RC" -eq 0 ] && ok 'a --latest visszaallitas sikeres' || { no "a --latest rc=$RC"; cat "$TMP/r.out"; }
RD=$(ls "$OUTD"/*.dump 2>/dev/null | head -1)
# STRICT load (ON_ERROR_STOP) with ONE named exclusion: pg_dump 17+ writes
# `SET transaction_timeout`, which this box's PG15 server does not know. That is
# client/server version skew in the TEST rig, not a property of the backup; it is
# filtered by exact line so that any OTHER error still fails the load.
# The dump also CREATEs schema public (--schema=public), so the throwaway target
# drops its own empty one first -- the same step the restore header names.
$PSQL -d dst -c 'DROP SCHEMA public CASCADE'
if [ -n "$RD" ] && "$PGBIN_CLI/pg_restore" --no-owner --no-privileges --file=- "$RD" 2>"$TMP/restore.err" \
     | grep -v '^SET transaction_timeout = 0;$' \
     | $PSQL -d dst 2>>"$TMP/restore.err"; then
  ok 'a visszafejtett mentes SZIGORUAN betoltodott egy eldobhato adatbazisba'
else
  no "a betoltes bukott: $(head -c 200 "$TMP/restore.err" 2>/dev/null)"
fi
A=$($PSQL -d dst -tA -c 'SELECT count(*) FROM t1')
B=$($PSQL -d dst -tA -c 'SELECT count(*) FROM t2')
S=$($PSQL -d src -tA -c 'SELECT md5(string_agg(v, '"','"' ORDER BY id)) FROM t1')
D=$($PSQL -d dst -tA -c 'SELECT md5(string_agg(v, '"','"' ORDER BY id)) FROM t1')
[ "$A" = "5402" ] && [ "$B" = "77" ] && ok "sorszam egyezik (t1=$A, t2=$B)" || no "sorszam elter (t1=$A, t2=$B)"
[ -n "$S" ] && [ "$S" = "$D" ] && ok 'a t1 tartalma byte-szinten azonos a forrassal' || no 'a t1 tartalma elter'

echo "== 11. papir-ut: kulcs stdin-rol, hanyagul gepelve; elgepelve; es rossz kulccsal =="
rm -rf "$OUTD"
printf '%s\n' "$SLOPPY" | MIN_TABLES=50 /bin/bash "$TMP/scripts/delta-crm-restore-offsite.sh" --key-from-stdin --latest "$OUTD" >/dev/null 2>&1 \
  && ok 'kisbetus, szokozos papir-kulccsal visszaall' || no 'a papir-kulccsal nem all vissza'
rm -rf "$OUTD"
printf '%s\n' "$BAD" | MIN_TABLES=50 /bin/bash "$TMP/scripts/delta-crm-restore-offsite.sh" --key-from-stdin --latest "$OUTD" >/dev/null 2>"$TMP/typo.err"; RC=$?
[ "$RC" -ne 0 ] && grep -q 'checksum' "$TMP/typo.err" && ok 'papir-elgepeles -> a checksum megfogja, meg a letoltes elott' || no "papir-elgepeles: rc=$RC $(cat "$TMP/typo.err")"
ls "$OUTD"/*.gpg >/dev/null 2>&1 && no 'elgepelt kulccsal mar letoltott' || ok 'elgepelt kulccsal semmi nem toltodott le'
rm -rf "$OUTD"
printf '%s\n' "$K2" | MIN_TABLES=50 /bin/bash "$TMP/scripts/delta-crm-restore-offsite.sh" --key-from-stdin --latest "$OUTD" >/dev/null 2>"$TMP/w.err"; RC=$?
[ "$RC" -ne 0 ] && ok "rossz papir-kulcs -> bukik (rc=$RC)" || no 'ROSSZ PAPIR-KULCCSAL SIKERT ADOTT'
grep -q 'rossz kulcs VAGY serult' "$TMP/w.err" && ok 'az uzenet megnevezi a ket lehetseges okot' || no 'a hibauzenet nem mondja meg, mi tortent'
ls "$OUTD"/*.dump >/dev/null 2>&1 && no 'rossz kulcsnal .dump maradt a kimeneti mappaban' || ok 'rossz kulcsnal nem maradt .dump'

echo "== 12. hianyzo megtartasi segedprogram -> SEMMIT nem torol, riaszt (78870ea3) =="
# Measured 2026-10-04: a copy without lib/backup-retention.sh deleted EVERY local
# dump, tonight's too, rc=0, no alert -- and this file went 12 red on it unnoticed,
# because the harness above did not copy the helper. The copy's second resolution
# is the live install, which HAS the helper, so case b points it at nothing.
OLD="delta-crm-20200101-033000-public.dump"
: > "$TMP/backups/$OLD"
# 14 newer fillers, or the 14-day window keeps $OLD as a daily and the control
# below fails for a reason that has nothing to do with the helper.
for d in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do : > "$TMP/backups/delta-crm-202501$d-033000-public.dump"; done
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ -f "$TMP/backups/$OLD" ] && no 'KONTROLL: ep segedprogrammal sem torolte a regi mentest -- a lenti proba vak' \
  || ok 'KONTROLL: ep segedprogrammal a regi mentes torlodik (a proba tud nemet mondani)'
: > "$TMP/backups/$OLD"
BEFORE=$(ls "$TMP/backups" | grep -cE '\.dump$')
sed -e "s|/Users/isti/marveen/scripts/lib/backup-retention.sh|$TMP/nincs-ilyen-lib.sh|" \
  "$TMP/scripts/delta-crm-backup.sh" > "$TMP/scripts/delta-crm-backup-noret.sh"
mv "$TMP/scripts/lib/backup-retention.sh" "$TMP/retention.away"
rm -f "$NOTIFIED"; : > "$TMP/backups/backup.log"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup-noret.sh" >/dev/null 2>&1
mv "$TMP/retention.away" "$TMP/scripts/lib/backup-retention.sh"
AFTER=$(ls "$TMP/backups" | grep -cE '\.dump$')
[ "$AFTER" -eq $((BEFORE + 1)) ] && ok "segedprogram nelkul semmi nem torlodott ($BEFORE -> $AFTER, +1 a mai)" \
  || no "segedprogram nelkul a helyi mentesek szama $BEFORE -> $AFTER"
[ -f "$TMP/backups/$OLD" ] && ok 'a regi mentes megmaradt' || no 'segedprogram nelkul TOROLTE a regi mentest'
grep -q 'PRUNE KIHAGYVA' "$TMP/backups/backup.log" && ok 'a naplo megnevezi a kihagyott torlest' || no 'a kihagyott torles nincs a naploban'
grep -q '^.* PRUNE delta' "$TMP/backups/backup.log" && no 'segedprogram nelkul PRUNE sor van a naploban' || ok 'egyetlen PRUNE sor sincs'
[ -f "$NOTIFIED" ] && grep -q 'torlese kimaradt' "$NOTIFIED" && ok 'riasztas ment' || no 'nem ment riasztas a kihagyott torlesrol'
# c) the helper EXISTS but returns a broken list (here: empty, rc=0). Only the
#    result check catches this -- the file-exists test above is satisfied.
: > "$TMP/backups/$OLD"
BEFORE=$(ls "$TMP/backups" | grep -cE '\.dump$')
mv "$TMP/scripts/lib/backup-retention.sh" "$TMP/retention.away"
printf 'backup_keep_list() { cat >/dev/null; return 0; }\nbackup_month_cutoff() { echo 202001; }\n' > "$TMP/scripts/lib/backup-retention.sh"
rm -f "$NOTIFIED"; : > "$TMP/backups/backup.log"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
mv "$TMP/retention.away" "$TMP/scripts/lib/backup-retention.sh"
AFTER=$(ls "$TMP/backups" | grep -cE '\.dump$')
[ "$AFTER" -eq $((BEFORE + 1)) ] && ok "ures megtartasi lista -> semmi nem torlodott ($BEFORE -> $AFTER)" \
  || no "ures megtartasi listaval a helyi mentesek szama $BEFORE -> $AFTER"
grep -q 'PRUNE KIHAGYVA' "$TMP/backups/backup.log" && ok 'ures listanal is a kihagyott torlest naplozza' || no 'ures listanal nincs PRUNE KIHAGYVA'
rm -f "$TMP/backups/$OLD" "$TMP/backups"/delta-crm-202501*

echo "== 13. potlas: minden helyi mentes, ami a bucketbol hianyzik, felmegy (78870ea3) =="
# has_copy NAME -> the bucket holds NAME.gpg or a legacy plaintext NAME
has_copy() { [ -f "$BUCKET/$1.gpg" ] || [ -f "$BUCKET/$1" ]; }
locals() { ls "$TMP/backups" | grep -E '^delta-crm-.*-public\.dump$'; }
missing() { n=0; for f in $(locals); do has_copy "$f" || n=$((n+1)); done; echo $n; }
rm -f "$BUCKET"/* "$NOTIFIED"; : > "$TMP/backups/backup.log"
NL=$(locals | wc -l | tr -d ' ')
[ "$NL" -ge 3 ] && ok "ELOFELTETEL: $NL helyi mentes, ures bucket" || no "ELOFELTETEL: csak $NL helyi mentes"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ "$(missing)" = 0 ] && ok "a) ures bucket -> mind a $((NL + 1)) helyi mentesnek van masolata" || no "a) $(missing) helyi mentes hianyzik a bucketbol"
P=$(grep -c 'R2 POTOLVA' "$TMP/backups/backup.log")
[ "$P" = "$NL" ] && ok "a) a naplo $P potlast nevez meg, kulon a mai R2 OK-tol" || no "a) $P POTOLVA sor, $NL vart"
OLDEST=$(locals | head -1)
backup_decrypt K1 "$BUCKET/$OLDEST.gpg" "$TMP/old.rt" 2>/dev/null && cmp -s "$TMP/old.rt" "$TMP/backups/$OLDEST" \
  && ok 'a) egy potolt objektum a helyi mentesre fejtodik vissza' || no 'a) a potolt objektum nem adja vissza a helyi mentest'
[ ! -f "$BUCKET/$OLDEST" ] && ok 'a) nyers .dump nem kerult fel' || no 'a) NYERS objektum kerult a bucketbe'

# b) one old dump's put keeps failing: tonight and the rest still go up, the
#    stray remote object is still pruned (the gate is TONIGHT, not the catch-up),
#    the failure is named and alerted -- and the next clean run fills it.
rm -f "$BUCKET"/* "$NOTIFIED"; : > "$TMP/backups/backup.log"
: > "$BUCKET/delta-crm-20200103-000000-public.dump.gpg"
STUCK=$(locals | head -1)
sleep 1; R2_FAIL_PUT="$STUCK" /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
TN=$(locals | tail -1)
has_copy "$TN" && ok 'b) a mai mentes felment' || no 'b) a mai mentes NEM ment fel'
has_copy "$STUCK" && no 'b) a bukott feltoltes megis felment (a stub nem tuzelt)' || ok 'b) a bukott feltoltes hianyzik (a stub tuzelt)'
[ "$(missing)" = 1 ] && ok 'b) pontosan egy hianyzik, a tobbi felment' || no "b) $(missing) hianyzik, 1 vart"
grep -q "R2 HIBA: a feltoltes nem sikerult: $STUCK" "$TMP/backups/backup.log" && ok 'b) a naplo megnevezi a bukott mentest' || no 'b) a naplo nem nevezi meg a bukott mentest'
[ -f "$NOTIFIED" ] && grep -q '(1 mentes)' "$NOTIFIED" && ok 'b) riasztas ment, a darabszammal' || no 'b) nincs riasztas vagy rossz a darabszam'
[ -f "$BUCKET/delta-crm-20200103-000000-public.dump.gpg" ] && no 'b) a par nelkuli objektum maradt (a potlas bukasa blokkolta a tukrot)' \
  || ok 'b) a par nelkuli objektum torolve, a potlas bukasa ellenere'
rm -f "$NOTIFIED"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
has_copy "$STUCK" && ok 'b) a kovetkezo tiszta futas potolta' || no 'b) a kovetkezo futas sem potolta'
[ "$(missing)" = 0 ] && ok 'b) utana semmi nem hianyzik' || no "b) utana is $(missing) hianyzik"

# c) the listing fails: tonight's dump is still tried, nothing else is guessed
rm -f "$BUCKET"/* "$NOTIFIED"; : > "$TMP/backups/backup.log"
sleep 1; R2_FAIL_LIST=1 /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
TN=$(locals | tail -1)
[ -f "$BUCKET/$TN.gpg" ] && ok 'c) lista-hiba mellett a mai mentes felment' || no 'c) lista-hiba mellett a mai mentes sem ment fel'
[ "$(ls "$BUCKET" | wc -l | tr -d ' ')" = 1 ] && ok 'c) csak a mai ment fel' || no "c) $(ls "$BUCKET" | wc -l | tr -d ' ') objektum ment fel"
grep -q 'listaja nem olvashato (HIBA 500: stub list failure)' "$TMP/backups/backup.log" && ok 'c) a naplo megnevezi a lista-hibat, az okkal' || no 'c) a lista-hiba nincs a naploban'

# d) a legacy plaintext object counts as present and is not uploaded again
rm -f "$BUCKET"/*; : > "$TMP/backups/backup.log"
LEG=$(locals | head -1); cp "$TMP/backups/$LEG" "$BUCKET/$LEG"
sleep 1; /bin/bash "$TMP/scripts/delta-crm-backup.sh" >/dev/null 2>&1
[ -f "$BUCKET/$LEG" ] && [ ! -f "$BUCKET/$LEG.gpg" ] && ok 'd) a regi nyers objektumot nem duplazza .gpg-vel' || no 'd) a regi nyers objektum melle .gpg is felment'
[ "$(missing)" = 0 ] && ok 'd) a tobbi felment' || no "d) $(missing) hianyzik"

echo
echo "  $PASS ok, $FAIL bukott"
[ "$FAIL" -eq 0 ]

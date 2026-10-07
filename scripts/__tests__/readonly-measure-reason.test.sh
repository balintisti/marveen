#!/usr/bin/env bash
# readonly-measure.sh: a NYITO kapu hianyanak ket oka ket kulonbozo szoveget kap -- kartya 15d61c9d.
#
# A hiba: minden futas, ahol a nyito kapu nem tuzelt, azt mondta, „a kapcsolat NEM csak-olvaso",
# egy DNS-hiba utan is, amikor kapcsolat sem volt. A visszautasitas helyes (fail-closed), az INDOK
# volt hamis, es egy nem letezo csak-olvaso hibat kezdtek keresni.
#
# Egy `psql` ALLVANY van a PATH-on, ami elore megirt kimenetet ad (STUB_MODE): igy a teszt offline
# es hatarozott, es MINDKET agat tudja (a (b) agnak egy valodi, NEM csak-olvaso szerver kellene).
# A valodi psql-lel futo ket eset (DNS, lezart port) AKKOR megy, ha van `psql`; ha nincs, hangosan
# kiirja, hogy kimaradt -- nem csendben.
# Az URL-ek KITALALTAK; valodi adatbazishoz a teszt sehol nem csatlakozik.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../readonly-measure.sh"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 -- got '$2', want '$3'"; fail=$((fail+1)); fi; }

T="$(mktemp -d "${TMPDIR:-/tmp}/ro-reason.XXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
echo "SELECT 1;" > "$T/m.sql"

# A kapu-tuzeles sora: pontosan ez a minta, amit a script a kimenetben szamol.
GATE_LINE='psql:/x/wrapped.sql:5: ERROR:  cannot execute UPDATE in a read-only transaction'
cat > "$T/bin/psql" <<'STUB'
#!/usr/bin/env bash
case "${STUB_MODE:-}" in
  dns)      echo 'psql: error: could not translate host name "db.invalid-host.test" to address: nodename nor servname provided, or not known' >&2; exit 2 ;;
  refused)  echo 'psql: error: connection to server at "127.0.0.1", port 5432 failed: Connection refused' >&2; echo '	Is the server running on that host and accepting TCP/IP connections?' >&2; exit 2 ;;
  timeout)  echo 'psql: error: connection to server at "10.255.255.1", port 5432 failed: timeout expired' >&2; exit 2 ;;
  old)      echo 'psql: could not connect to server: No route to host' >&2; exit 2 ;;
  noreadonly) echo BEGIN; echo SAVEPOINT; echo 'UPDATE 0'; echo ROLLBACK; echo SAVEPOINT; echo 'UPDATE 0'; echo ROLLBACK; echo ROLLBACK ;;
  scripterr)  echo BEGIN; echo SAVEPOINT; echo 'UPDATE 0'; echo ROLLBACK; echo 'psql:/x/m.sql:1: ERROR:  operator does not exist: uuid = integer'; exit 0 ;;
  one)      echo "$STUB_GATE" >&2; echo 'psql:/x/m.sql:1: ERROR:  syntax error'; echo ROLLBACK ;;
  two)      echo "$STUB_GATE" >&2; echo "$STUB_GATE" >&2; echo ROLLBACK ;;
esac
STUB
chmod +x "$T/bin/psql"

# A kimenet (stdout+stderr) a $T/<nev>.out-ba megy, a kilepesi kod a stdout-on.
run() { # $1 nev  $2 PATH-prefix  $3.. env-felulirasok
  local name="$1" pp="$2"; shift 2
  env PATH="$pp:$PATH" "$@" bash "$SCRIPT" --sql "$T/m.sql" --url "postgresql://u@db.invalid-host.test:5432/d" \
    --gate-table User --gate-column id > "$T/$name.out" 2>&1
  echo $?
}
has() { grep -c -- "$2" "$T/$1.out" || true; }

for mode in dns refused timeout old; do
  rc="$(run "$mode" "$T/bin" STUB_MODE="$mode" STUB_GATE="$GATE_LINE")"
  check "$mode: fail-closed, exit 3" "$rc" "3"
  check "$mode: names the connection failure" "$(has "$mode" 'NEM MERTEM: nincs kapcsolat')" "1"
  check "$mode: does NOT claim the connection is not read-only" "$(has "$mode" 'NEM csak-olvaso')" "0"
  check "$mode: carries the first psql stderr line" "$(grep -c '^  psql: ' "$T/$mode.out" || true)" "1"
done

# (b) kapcsolat volt, a kapu nem tuzelt: a mai szoveg valtozatlanul.
rc="$(run noreadonly "$T/bin" STUB_MODE=noreadonly STUB_GATE="$GATE_LINE")"
check "connected, gate silent: exit 3" "$rc" "3"
check "connected, gate silent: today's text" "$(has noreadonly 'a NYITO kapu sem tuzelt -- a kapcsolat NEM csak-olvaso')" "1"
check "connected, gate silent: NOT called a connection failure" "$(has noreadonly 'nincs kapcsolat')" "0"

# Szkript-hiba (`psql:<fajl>:<sor>: ERROR:`) kapu nelkul: NEM csatlakozasi hiba.
rc="$(run scripterr "$T/bin" STUB_MODE=scripterr STUB_GATE="$GATE_LINE")"
check "script error, gate silent: exit 3" "$rc" "3"
check "script error is NOT mistaken for a connection failure" "$(has scripterr 'nincs kapcsolat')" "0"
check "script error keeps the read-only text" "$(has scripterr 'NEM csak-olvaso')" "1"

# A tobbi ag valtozatlan: 2 kapu = siker (pozitiv kontroll), 1 kapu = a zaro kapu hianya (exit 4).
rc="$(run two "$T/bin" STUB_MODE=two STUB_GATE="$GATE_LINE")"
check "two gate hits: exit 0 (positive control)" "$rc" "0"
rc="$(run one "$T/bin" STUB_MODE=one STUB_GATE="$GATE_LINE")"
check "one gate hit: exit 4, unchanged" "$rc" "4"

# Valodi psql, ha van: lezart port (Connection refused) es .invalid hoszt (DNS). Offline, nincs szerver.
if command -v psql >/dev/null 2>&1; then
  for case in "closed-port|postgresql://u@127.0.0.1:1/d" "dns|postgresql://u@no-such-host.invalid:5432/d"; do
    name="real-${case%%|*}"; url="${case#*|}"
    bash "$SCRIPT" --sql "$T/m.sql" --url "$url" --gate-table User --gate-column id > "$T/$name.out" 2>&1; rc=$?
    check "$name (real psql): exit 3" "$rc" "3"
    check "$name (real psql): names the connection failure" "$(has "$name" 'NEM MERTEM: nincs kapcsolat')" "1"
    check "$name (real psql): not called read-only failure" "$(has "$name" 'NEM csak-olvaso')" "0"
  done
else
  echo "SKIP real-psql cases: psql not installed on this machine"
fi

echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]

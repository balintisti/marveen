# Which Delta-CRM dumps to keep -- card fe4d8ccc. Sourced by scripts/delta-crm-backup.sh.
#
#   backup_keep_list <daily_keep> <cutoff_yyyymm>   (file names on stdin)
#
# Prints the names to KEEP: the newest <daily_keep> dumps, plus the first dump of every
# month from <cutoff_yyyymm> on. Names are delta-crm-YYYYMMDD-HHMMSS.dump, so name order
# is time order. Everything else is pruned by the caller (and the R2 bucket mirrors it).
#
# WHY A LIMIT (Isti 5121, 2026-10-03 17:00, marveen 27062/27069): the monthly archive used
# to be kept FOREVER, so a deleted customer's data stayed in the archives indefinitely --
# against the terms' 30-day deletion promise and data minimisation. Now 12 months, and the
# terms say "the backups lose the data at the latest after 12 months".
#
#   bash scripts/lib/backup-retention.sh --self-test
backup_keep_list() {
  local daily_keep="$1" cutoff="$2" names
  names=$(sort)
  [ -n "$names" ] || return 0
  {
    printf '%s\n' "$names" | tail -n "$daily_keep"
    printf '%s\n' "$names" | awk -v cutoff="$cutoff" '
      match($0, /delta-crm-[0-9]{6}/) {
        month = substr($0, RSTART + 10, 6)
        if (month >= cutoff && !(month in seen)) { seen[month] = 1; print }
      }'
  } | sort -u
}

# The first month to keep for <monthly_keep> months, counting the current one.
backup_month_cutoff() {
  date -v-"$(( $1 - 1 ))"m +%Y%m
}

if [ "${1:-}" = "--self-test" ]; then
  pass=0 fail=0
  check() { if [ "$2" = "$3" ]; then pass=$((pass + 1)); echo "PASS $1"; else fail=$((fail + 1)); echo "FAIL $1"; echo "  want: $(echo "$3" | tr '\n' ' ')"; echo "  got:  $(echo "$2" | tr '\n' ' ')"; fi; }
  # Two years of monthly firsts + 16 days in the newest month.
  NAMES=$( { for m in 202410 202411 202412 202501 202502 202503 202504 202505 202506 202507 202508 202509 \
                       202510 202511 202512 202601 202602 202603 202604 202605 202606 202607 202608 202609; do
               echo "delta-crm-${m}01-033000.dump"; echo "delta-crm-${m}15-033000.dump"; done
             for d in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16; do echo "delta-crm-202610${d}-033000.dump"; done; } )
  KEPT=$(printf '%s\n' "$NAMES" | backup_keep_list 14 202511)
  check "the newest 14 dailies are kept" "$(printf '%s\n' "$KEPT" | grep -c '^delta-crm-202610')" "15"
  check "monthly firsts kept exactly for 202511..202610" \
    "$(printf '%s\n' "$KEPT" | grep -E -- '-[0-9]{6}01-' | sed -E 's/delta-crm-([0-9]{6}).*/\1/' | tr '\n' ' ')" \
    "202511 202512 202601 202602 202603 202604 202605 202606 202607 202608 202609 202610 "
  check "nothing from before the cutoff survives" "$(printf '%s\n' "$KEPT" | grep -cE 'delta-crm-(2024|20250)')" "0"
  check "a mid-month dump of an old month is not kept" "$(printf '%s\n' "$KEPT" | grep -c 'delta-crm-20260815')" "0"
  # CONTROL: with a cutoff two years back every monthly first survives -- the limit is what prunes.
  ALL=$(printf '%s\n' "$NAMES" | backup_keep_list 14 202410)
  check "CONTROL: an old cutoff keeps all 25 monthly firsts" "$(printf '%s\n' "$ALL" | grep -cE -- '-[0-9]{6}01-')" "25"
  check "empty directory keeps nothing and does not fail" "$(printf '' | backup_keep_list 14 202511)" ""
  check "cutoff for 12 months counts the current month" "$(backup_month_cutoff 12)" "$(date -v-11m +%Y%m)"
  echo "SELF-TEST $([ $fail = 0 ] && echo PASS || echo FAIL) ($pass/$((pass + fail)))"
  [ $fail = 0 ]
fi

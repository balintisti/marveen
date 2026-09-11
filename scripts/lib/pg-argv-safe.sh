#!/usr/bin/env bash
# KEEP THE PASSWORD OFF THE ARGUMENT VECTOR. Card 38bd8366.
#
# `pg_dump "$URL"` and `psql "$URL"` put the whole connection string on argv, and
# **argv is world-readable on the machine**: any process can run `ps -eo args`
# and read it. Measured 2026-09-05 by marveen, who was not looking for it -- the
# live DATABASE_URL, password included, was simply in front of him in a `ps`
# while re-running the daily backup. The backup alone is ~100 seconds a day plus
# every manual run, so the window is repeating and predictable.
#
# WHY THE SCRIPTS WERE NOT CARELESS. `delta-crm-backup.sh`'s own header says
# "Credentials are read at runtime from ..." -- the author DID think about not
# hard-coding the secret, and solved that. Keeping it off argv is a DIFFERENT
# axis, and the right answer to the first question does not answer the second.
#
# libpq reads the password from `PGPASSWORD` when the connection string does not
# carry one, so splitting the URL keeps every other part identical -- host, port,
# database, and the query parameters the callers deliberately tuned.
#
# ONE DEFINITION, sourced by both callers, because this repository's own rule is
# that two copies of a rule drift: `delta-crm-backup.sh` and
# `readonly-measure.sh` both had the same shape, and only one of them was on the
# card. A second hand-written split would be the thing that goes stale.

# Splits a postgres URL. Sets PG_URL_NOPASS, and exports PGPASSWORD when there
# was one. Leaves both untouched shapes alone: a URL with no userinfo and a URL
# with a user but no password come back unchanged, with PGPASSWORD unset.
pg_split_password() {
  local url="$1"
  PG_URL_NOPASS="$url"

  case "$url" in *://*) ;; *) return 0 ;; esac

  local scheme rest userinfo hostpart
  scheme="${url%%://*}://"
  rest="${url#*://}"

  # No userinfo at all -> nothing to strip.
  case "$rest" in *@*) ;; *) return 0 ;; esac

  # SPLIT ON THE LAST `@`, not the first. A password may legitimately contain an
  # encoded `@` (`%40`), and a host may not contain one at all, so the last `@`
  # is the only separator that cannot be fooled by the secret's own content.
  userinfo="${rest%@*}"
  hostpart="${rest##*@}"

  # A user with no password: leave it, and do NOT export an empty PGPASSWORD --
  # an empty one is a VALUE to libpq, not an absence, and would override a
  # legitimate .pgpass entry.
  case "$userinfo" in
    *:*) ;;
    *) return 0 ;;
  esac

  local user pass
  user="${userinfo%%:*}"
  pass="${userinfo#*:}"

  PG_URL_NOPASS="${scheme}${user}@${hostpart}"
  export PGPASSWORD="$pass"
}

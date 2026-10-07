#!/bin/bash
# sentry-or PRE-CHECK (card 669341dc, marveen decision 29588).
#
# WHY: the `sentry-or` heartbeat wakes the model every 3 hours (8 turns a day) to find out, nearly
# always, that there is no new Sentry issue. The question "is there a NEW issue" is deterministic,
# so a script asks it and the model wakes ONLY on a yes (or when the script cannot tell).
#
# THE runPreCheck CONTRACT (src/web/schedule-runner.ts; the runner calls `bash <this file>`, 10 s):
#   stdout exactly "SKIP", exit 0 ..... no turn
#   anything else on stdout, exit 0 ... the turn RUNS, stdout is injected as `[Pre-check eredmeny]`
#   exit != 0 / crash / timeout ....... fail-open, the turn RUNS
# So EVERY path below that cannot prove "nothing new" prints a reason and the turn runs. SKIP is
# printed in exactly one place: the API answered 200 for the org list AND for every org's issue
# list, every payload had the expected shape, and every unresolved shortId is already in the
# state file. A missing state file, a bad token, a 4xx/5xx, a payload that is not a list, a
# full page (the list may be cut), a timeout: all WAKE the model.
#
# NEW = an unresolved issue whose shortId is in no `reported_issue_ids` entry of
# store/sentry-watch-state.json (the file the sentry-or round itself writes at its step 5).
# This script does NOT consume state: it never writes. The model's round stays the only writer,
# so a hit is not "spent" by the check (skill utemezett-feladat-precheck, step 4).
#
# THE TOKEN is read in-process from the vault (dist/web/vault.js, key sentry_olvaso_token) and
# sent in an Authorization header; it is never an argv element and never printed. The script
# must NOT call the dashboard API: the runner runs it with spawnSync INSIDE the dashboard
# process, so a call to :3420 would wait for the very event loop it is blocking (card e82234e0).
#
# WHAT IS INJECTED into the model: only validated shortIds, org slugs, a level from a fixed
# list, a count and a firstSeen. Never the title or culprit: those are text an outsider can
# influence, and this output lands in an LLM prompt.
#
# Test seams (scripts/__tests__/sentry-or-precheck.test.sh): SENTRY_PRECHECK_STATE,
# SENTRY_PRECHECK_API_ROOT, SENTRY_PRECHECK_TOKEN_CMD, SENTRY_PRECHECK_HTTP_TIMEOUT.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
export SENTRY_PRECHECK_ROOT="${SENTRY_PRECHECK_ROOT:-$(cd "$HERE/.." && pwd)}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[sentry-or-precheck] FUTTAT: nincs python3, a kapu nem tudott dontenni"
  exit 0
fi

exec python3 - <<'PY'
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

ROOT = os.environ['SENTRY_PRECHECK_ROOT']
STATE = os.environ.get('SENTRY_PRECHECK_STATE', os.path.join(ROOT, 'store', 'sentry-watch-state.json'))
API = os.environ.get('SENTRY_PRECHECK_API_ROOT', 'https://sentry.io/api/0').rstrip('/')
HTTP_TIMEOUT = float(os.environ.get('SENTRY_PRECHECK_HTTP_TIMEOUT', '3'))
BUDGET = 7.5            # the runner kills at 10 s; stay under it on our own terms
PAGE_LIMIT = 100        # Sentry's page cap on this endpoint
TAG = '[sentry-or-precheck]'
START = time.monotonic()
SHORT_ID = re.compile(r'^[A-Za-z][A-Za-z0-9_]*-[0-9A-Za-z]+$')
ORG_SLUG = re.compile(r'^[a-z0-9][a-z0-9_-]*$')
LEVELS = {'fatal', 'error', 'warning', 'info', 'debug'}


def wake(reason):
    print(f'{TAG} FUTTAT: {reason}')
    print('A kapu NEM tudta bizonyitani, hogy nincs uj issue: a forduloban a szokasos modon merj (SKILL.md), es ird ki, hogy a kapu miert nem donthetett.')
    sys.exit(0)


def default_token_cmd():
    js = ("const m = await import(process.env.VAULT_JS);"
          "const t = m.getSecret('sentry_olvaso_token');"
          "if (!t) process.exit(3); process.stdout.write(t);")
    node = next((p for p in ('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node') if os.access(p, os.X_OK)), 'node')
    return [node, '--input-type=module', '-e', js]


def read_token():
    custom = os.environ.get('SENTRY_PRECHECK_TOKEN_CMD')
    env = dict(os.environ, VAULT_JS=os.path.join(ROOT, 'dist', 'web', 'vault.js'))
    cmd = ['bash', '-c', custom] if custom else default_token_cmd()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=5, env=env, cwd=ROOT, stdin=subprocess.DEVNULL)
    except Exception as e:  # noqa: BLE001 - every failure is the same answer: cannot decide
        wake(f'a Sentry-token olvasasa elbukott ({type(e).__name__})')
    tok = r.stdout.strip()
    if r.returncode != 0 or not tok:
        wake(f'a Sentry-token nem olvashato a vaultbol (exit {r.returncode}, vault entry: sentry_olvaso_token)')
    return tok


def load_known():
    try:
        with open(STATE, encoding='utf-8') as f:
            d = json.load(f)
    except FileNotFoundError:
        wake(f'az allapotfajl hianyzik ({os.path.basename(STATE)}): nem lehet megmondani, mi az uj')
    except (OSError, ValueError) as e:
        wake(f'az allapotfajl nem olvashato ({type(e).__name__}): nem lehet megmondani, mi az uj')
    rep = d.get('reported_issue_ids') if isinstance(d, dict) else None
    if not isinstance(rep, dict):
        wake('az allapotfajlban nincs reported_issue_ids objektum')
    known = set()
    for k, v in rep.items():
        if isinstance(v, list):                      # {"<org>": ["BACKEND-1", ...]}
            known.update(x for x in v if isinstance(x, str))
        if isinstance(k, str) and SHORT_ID.match(k):  # {"BACKEND-1J": "note"} entries the rounds also wrote
            known.add(k)
    return known


def get_json(path, token):
    left = BUDGET - (time.monotonic() - START)
    if left <= 0.5:
        wake('idotullepes: a kapu nem fert bele a 10 masodperces keretbe')
    req = urllib.request.Request(API + path, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=min(HTTP_TIMEOUT, left)) as r:
            if r.status != 200:
                wake(f'HTTP {r.status} ettol: {path.split("?")[0]}')
            return json.load(r)
    except urllib.error.HTTPError as e:
        wake(f'HTTP {e.code} ettol: {path.split("?")[0]}')
    except Exception as e:  # noqa: BLE001 - timeout, DNS, TLS, bad JSON
        wake(f'a hivas elbukott ({type(e).__name__}) ettol: {path.split("?")[0]}')


known = load_known()
token = read_token()

orgs_payload = get_json('/organizations/', token)
orgs = [o.get('slug') for o in orgs_payload if isinstance(o, dict)] if isinstance(orgs_payload, list) else []
orgs = [s for s in orgs if isinstance(s, str) and ORG_SLUG.match(s)]
if not orgs:
    wake('a szervezet-lista ures vagy nem ertelmezheto: nincs mit merni')

new = []
total = 0
for org in orgs:
    items = get_json(f'/organizations/{org}/issues/?query=is:unresolved&statsPeriod=90d&sort=new&limit={PAGE_LIMIT}', token)
    if not isinstance(items, list):
        wake(f'a(z) {org} issue-listaja nem lista')
    if len(items) >= PAGE_LIMIT:
        wake(f'a(z) {org} issue-listaja megtelt ({len(items)}/{PAGE_LIMIT}): lehet, hogy levagott')
    for it in items:
        sid = it.get('shortId') if isinstance(it, dict) else None
        if not isinstance(sid, str) or not SHORT_ID.match(sid):
            wake(f'a(z) {org} egy issue-jan nincs ertelmezheto shortId')
        total += 1
        if sid not in known:
            lvl = it.get('level') if it.get('level') in LEVELS else '?'
            cnt = str(it.get('count')) if str(it.get('count', '')).isdigit() else '?'
            fs = it.get('firstSeen') if isinstance(it.get('firstSeen'), str) and re.match(r'^[0-9T:.\-Z+]{10,32}$', it['firstSeen']) else '?'
            new.append(f'  {org} {sid} level={lvl} count={cnt} firstSeen={fs}')

if not new:
    print('SKIP')
    sys.exit(0)

print(f'{TAG} UJ ISSUE: {len(new)} nem jelentett shortId (a {len(orgs)} szervezet {total} nyitott issue-jabol; az allapotfajlban {len(known)} azonosito volt):')
print('\n'.join(new))
print('Ebbol a blokkbol dolgozz (a kapu mar lekerdezte a Sentryt, ne futtasd ujra). A SKILL.md szerinti vizsgalat (diszkriminator, revizio-csere) a te dolgod; a vegen MINDEN fenti azonositot ird a reported_issue_ids koze (4-5. lepes), kulonben a kapu minden fordulon ujra felebreszt.')
PY

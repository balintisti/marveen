#!/bin/bash
# VAN-E EGYALTALAN FEK A KOORDINATORON -- ES TULELI-E A KOVETKEZO INDULAST? (kartya caaf32a4)
#
# MIERT LETEZIK, KET MERT ESEMENYBOL:
#
#  1. A koordinatornak NULLA deny-tetele volt, mikozben hat alagensnek 13-24 -- es a
#     deny-listat maga a koordinator irta elo. A hiany EPP ott volt, ahol a hatokor a
#     legszelesebb (telepitesi fa, azonnal eles scripts/, o inditja a telepiteseket).
#
#  2. Amikor a lista bekerult, a RENDSZER TOROLTE 41 perccel kesobb. Nem ember es nem
#     agens: a fo-agens indulasi provisioningja (agent-process.ts) a MEGOSZTOTT
#     ~/.claude/settings.json-t masolja az izolalt config-ra, es a sajat kulcsok csak
#     akkor elik tul, ha a megosztott NEM ismeri oket (`!(key in settings)`). A
#     megosztott fajlban VAN `permissions`, tehat az egesz blokk felulirodik -- a
#     `deny` alkulccsal egyutt. A veszteseg tehat ALKULCS-szintu, a merge viszont
#     felszines.
#
# EZERT NEM ELEG MEGNEZNI, HANY TETEL VAN MOST. Ez a szkript HARMAT mond:
#   - hany tetel all a koordinator izolalt listajan  (van-e fek MA)
#   - milyen kapcsolok allnak mellette               (kell-e egyaltalan fek)
#   - TULELI-E a kovetkezo indulast                  (lesz-e fek HOLNAP)
# A harmadik az uj: egy or, ami csak a mai allapotot meri, ugyanugy elnemul, ahogy a
# lista maga eltunt -- csak eggyel kesobb.
#
# CONTRACT: mindig `KULCS|szoveg` sorokat ir, mindig 0-val lep ki. A hivo dont.
set -uo pipefail

INSTALL_ROOT="${MARVEEN_INSTALL_ROOT:-/Users/isti/marveen}"
ISOLATED="${1:-$INSTALL_ROOT/.channels-config/settings.json}"
SHARED="${2:-$HOME/.claude/settings.json}"

if [ ! -f "$ISOLATED" ]; then
  echo "SKIP|nincs izolalt koordinator-konfig ($ISOLATED) -- NEM MERVE, nem 'rendben'"
  exit 0
fi

python3 - "$ISOLATED" "$SHARED" <<'PY'
import json, sys

def load(path):
    try:
        with open(path, encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else None
    except FileNotFoundError:
        return None
    except Exception:
        return False  # letezik, de nem olvashato -- ez NEM ugyanaz, mint a hiany

iso_path, shared_path = sys.argv[1], sys.argv[2]
iso, shared = load(iso_path), load(shared_path)

if iso is False:
    print("FAIL|az izolalt konfig nem ertelmezheto JSON (%s) -- a fek allapota ISMERETLEN" % iso_path)
    raise SystemExit(0)

perm = iso.get('permissions') or {}
deny = perm.get('deny') or []
print("INFO|izolalt konfig: %s" % iso_path)

# 1. VAN-E FEK MA -- es a kapcsolok dontik el, mennyire sulyos a hiany.
auto = str(perm.get('defaultMode', '')).lower() == 'auto'
skip_prompt = iso.get('skipDangerousModePermissionPrompt') is True
if len(deny) == 0:
    if auto or skip_prompt:
        # Ez a sulyos alak: nincs kerdes, amit valaki megvalaszolna, ES nincs tiltas.
        print("FAIL|a koordinatornak NULLA deny-tetele van, ES nincs kerdes sem "
              "(defaultMode=%s, skipDangerousModePermissionPrompt=%s) -- nincs fek"
              % (perm.get('defaultMode'), iso.get('skipDangerousModePermissionPrompt')))
    else:
        print("FAIL|a koordinatornak NULLA deny-tetele van")
else:
    print("OK|a koordinator deny-listaja %d tetel" % len(deny))

# 2. TULELI-E A KOVETKEZO INDULAST. Ez a resze az, amit egy darabszam-or nem mond meg.
if shared is None:
    print("INFO|nincs megosztott settings.json (%s) -- a provisioning nem tud felulirni" % shared_path)
elif shared is False:
    print("WARN|a megosztott settings.json nem ertelmezheto -- a tulelest NEM tudom megmondani")
else:
    if 'permissions' in shared:
        s_deny = (shared.get('permissions') or {}).get('deny') or []
        if len(deny) > 0 and len(s_deny) < len(deny):
            print("FAIL|A LISTA NEM ELI TUL A KOVETKEZO INDULAST: a megosztott konfig is definial "
                  "`permissions`-t (deny=%d), es a provisioning EGESZ BLOKKOT masol -- az izolalt "
                  "%d tetel elveszik. Merve: agent-process.ts, `!(key in settings)`." % (len(s_deny), len(deny)))
        elif len(deny) == 0:
            print("INFO|a megosztott konfig is definial `permissions`-t -- egy ide irt deny-lista "
                  "a kovetkezo indulaskor ELVESZNE (a provisioning az egesz blokkot masolja)")
    else:
        print("INFO|a megosztott konfig NEM definial `permissions`-t -- egy ide irt lista tulel "
              "(a provisioning csak a megosztott altal NEM ismert kulcsokat hagyja meg)")

print("OSSZEGZES|deny=%d auto=%s skipPrompt=%s" % (len(deny), auto, skip_prompt))
PY
exit 0

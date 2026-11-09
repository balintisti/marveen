#!/usr/bin/env python3
"""PreToolUse gate on the MAIN agent's outbound email: Hungarian copy QA.

Why this exists (Szabi, 2026-08-10 12:57): a licence-delivery email went out to a
client with every accent stripped ("Szia Balint, itt van a Marveen licenckulcsod
es a telepito"). It was the second accent incident that day -- the first was a
client-facing spreadsheet the same morning. Szabi asked for a gate that inspects
outgoing copy BEFORE the send and rejects it if something is wrong.

Note the seam this fills. `scripts/email-send-gate.mjs` already gates outbound
email, but it gates SUB-AGENTS (it is wired by writeAgentSettingsFromProfile()
guarded by `name !== MAIN_AGENT_ID`) and it is a hard deny, not a content check.
Nothing at all ran on the main agent's own sends -- and the main agent is the one
that actually writes to customers.

What it checks, all three from standing owner rules in CLAUDE.md:
  1. Hungarian text that is missing its accents (the incident above).
  2. Em dash (U+2014) -- forbidden in every deliverable.
  3. Owner-specific NAME rules (misspelled surnames etc.) -- loaded from an
     untracked local rules file (GATEPERSIST816), never hardcoded here.

FAIL-CLOSED ON AN UNREADABLE BODY. If the call looks like a send but the body
cannot be recovered (e.g. `send.py ... < $SP/body.txt`, where $SP is a shell
variable this hook cannot resolve), the gate BLOCKS. A send whose content cannot
be inspected defeats the point of the gate, so "I could not read it" must not
mean "let it through". The block message says how to make it inspectable.

Contract: PreToolUse. Reads the hook payload on stdin, exit 0 = allow,
exit 2 = block (stderr goes back to the model).
"""
import html
import json
import os
import re
import stat
import sys

# --- what counts as an email send -------------------------------------------
# KAPUHATOKOR822 (2026-08-22, NEGY hamis pozitiv egy delutanon, HAROM
# muvelet-tipuson: inter-agent uzenet, sqlite-iras, fajl-OLVASAS): a korabbi
# szures a TELJES parancs-stringben kereste a kuldes-mintakat, igy egy
# inter-agent curl JSON-torzse ('"to":' a boritekban + 'send.py' a szoveg
# TARTALMABAN), egy hirlevel-szoveget iro sqlite-parancs vagy a send-script
# puszta elolvasasa is kuldesnek latszott. A kapu levelnek olvasta azt, ami
# uzenet A RENDSZERROL -- es pont arrol a temarol nemitotta volna el a
# flottat, amirol a legfontosabb beszelni (Iris tetje: egy valodi incidenst
# nem lehetne jelenteni rola).
#
# A szures ezert PARANCS-POZICIORA megy, nem tartalomra: elobb kivagjuk a
# heredoc-torzseket es az idezett stringeket (a tartalom igy nem tud parancs-
# nak latszani), majd pipeline/szekvencia-szegmensenkent a MEGHIVOTT programot
# nezzuk. Kuldes az, ahol a kuldo program fut:
#   - sendmail / msmtp / swaks a program-pozicioban (ezek csak kuldeni tudnak);
#   - send.py TENYLEGES futtatasa (python vagy kozvetlen ut) --to cimzettel a
#     SAJAT szegmenseben (a --help/olvasas igy nem trigger);
#   - graph-mail futtatasa `send` alparanccsal;
#   - curl/wget, amelynek IDEZETLEN URL-tokenje az api.resend.com-ra mutat
#     (a -d payloadban idezett elofordulas nem szamit -- az tartalom).
# MASODIK KOR (Marveen adverzarialis merese, msg 14282): az elso valtozat a
# quoted stringeket VAKON vagta ki, ezert ket hamis negativot nyitott -- az
# IDEZOJELES URL a curl sajat argumentum-helyen (a curl SZOKASOS irasmodja!)
# es a burkolo hejj `-c` string-argumentuma atment. A gyoker: az idezojel a
# TARTALOM ellen jo hatar, de nem mondja meg, hogy a token URL- vagy
# PROGRAM-POZICIOBAN all-e. Ezert a kivagas helyett QUOTE-TUDATOS tokenizalas
# fut (shlex): az idezett token EGY tokenkent, poziciojaval egyutt erkezik --
# a curl idezojeles URL-argumentuma igy vizsgalhato, mikozben egy -d payload
# belsejeben emlitett domain tovabbra is csak tartalom (az URL-minta a token
# ELEJERE horgonyzott). A wrapper hejj (`sh -c "..."`) string-argumentuma
# rekurzivan elemzodik.
# A heredoc-kivagas SORREND-FUGGETLEN (Marveen 3. kore, msg 14286): a
# hatarolo utani SOR-MARADEK (pl. atiranyitas: <<EOF > fajl) a parancs
# resze es MEGMARAD -- csak a torzs esik ki. Enelkul (a) forditott
# sorrendnel a torzs parancsnak latszott (FP), (b) a bevezeto sor
# eldobasa a heredoc-taplalt VALODI kuldot vesztette volna el (FN).
_HEREDOC = re.compile(r"(<<-?\s*'?(\w+)'?[^\n]*)\n.*?\n\2(?=\s|$)", re.S)
_ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*=")
# KWSPLIT924: shell reserved words that put the NEXT word in command position.
# The segmenter splits on operators only, so `if true; then sendmail x; fi`
# gave the segment [then, sendmail, x] whose "program" was `then`: the send was
# not recognised and the copy audit was silently skipped (same for do / else /
# elif / { / !, and the condition after if / while / until). They are stripped
# ONLY at the head of a segment, i.e. in command position, never as separators:
# `echo then sendmail x` stays a single echo. `in` is deliberately NOT here: the
# words after it are data, and `for m in sendmail msmtp; do which $m; done` must
# stay false. `for` / `case` are not here either: the word after them is a name
# or a subject, not a command. Mirrored in email-send-gate.mjs (CMD_POSITION_KEYWORDS);
# the shared send-invocation-cases.json binds the two.
_CMD_POSITION_KEYWORDS = frozenset(("if", "then", "else", "elif", "do", "while", "until", "{", "!"))
_SENDER_PROG = re.compile(r"^(sendmail|msmtp|swaks)$", re.I)
_SENDPY = re.compile(r"^send\.py$", re.I)
# python3.12 is the same python (didi, 6525aba3 50742). Twin: PYTHON in email-send-gate.mjs.
_PYTHON = re.compile(r"^python3?(?:\.\d+)?$", re.I)
# A ket kapu (ez + scripts/email-send-gate.mjs) SZANDEKOSAN azonos
# felismeres-szemantikat visel, es ezt kozos eset-lista orzi
# (send-invocation-cases.json + konformancia-teszt): a divergencia
# teszt-hibakent jelenjen meg, ne incidenskent (Marveen, msg 14289).
_NODEISH = re.compile(r"^(node|tsx|ts-node|deno|bun|npx)$", re.I)
_GRAPHMAIL = re.compile(r"^graph-mail(\.ts|\.js)?$", re.I)
_WRAPPER_SHELL = re.compile(r"^(sh|bash|zsh|dash)$", re.I)
# httpie ships two commands, `http` and `https` (812bd946, didi 55346): both are senders.
_CURLISH = re.compile(r"^(curl|wget|https?)$", re.I)
# Interpreter kod-string argumentum (python -c / node -e): az interpreternek
# atadott kod MUVELET, nem tartalom -- a kod-szintu kuldes-hivasokra szurunk.
#
# KIMONDOTT HATAR (Marveen, msg 14298): tetszoleges interpreter-kod statikus
# elemzese eldonthetetlen -- ez a kapu a VELETLEN kuldest fogja meg, nem egy
# elszant kikerulot. A lenti exec-heurisztika a NAIV alakokat fedi (a kod
# process-inditast ES kuldo-programnevet egyutt tartalmaz); ennel tobbet nem
# allit, es nem is allithat.
# A `smtplib\.` es a `mail\.send\s*\(` HASZNALAT-horgony, nem EMLITES-horgony (card 980ebc8c):
# a ket csupasz alak 4 valodi, CSAK-OLVASO cenzus-parancsot blokkolt (didi N2-N5, attribucioval
# es mutacioval: `imaplib` es `mailsend` atengedve, tehat pontosan ez a ket token fogott).
# Az `import\s+smtplib` ag MERES ALAPJAN KELL, es a k5-ben becsult ara NEM all fenn:
# a `smtplib\.` horgony ONMAGABAN ATENGEDTE ezt a VALODI kuldest --
#     python3 -c "import smtplib as m; c=m.SMTP_SSL('h',465); c.login(...); c.send_message(msg)"
# nincs benne `smtplib.` (aliasolva) es nincs benne `SMTP(` (mert `SMTP_SSL(`), tehat a csupasz
# alak eltavolitasa UJ rest nyitott volna. A becsult ar (`grep 'import smtplib'` blokkolodik) azert
# nem all fenn, mert ez a minta KIZAROLAG interpreter-kod-sztringre fut, nem a teljes parancsra --
# merve: a grep-alaku cenzusok ATENGEDNEK. KIMONDOTT MARADEK: egy `python3 -c "import smtplib; ..."`
# alaku introspekcio blokkolodik; egy `grep`/`rg` alaku nem.
_CODE_SEND = re.compile(
    r"\bsmtplib\.|\bimport\s+smtplib\b|SMTP\s*\(|\bsendMail\s*\(|\bsendEmail\s*\(|\bmail\.send\s*\("
    # The Resend SDK call (`resend.emails.send(`). It was in email-send-gate.mjs only, so the
    # twins split on 2 of 14 970 real commands (6525aba3; marveen 50880: align to the stricter).
    r"|\bresend\b(?!-\w)[^\n]{0,80}\.\s*send\s*\(",
    re.I,
)
# Issue #1853 (stylnet): the support-mail sender LOADED AS A MODULE, not run by its
# file name -- `import send`, `from send import main`, runpy, __import__/import_module,
# or a spec built from send.py. The file-name rule below never saw these, so the call
# went past the approval gate. Case-sensitive on purpose (Python names are), and
# `send` must be the whole module name: `import sendgrid_x` or a "send" word in a
# string stays out. Mirrored in email-send-gate.mjs (CODE_SEND_MODULE).
_CODE_SEND_MODULE = re.compile(
    r"\bimport\s+(?:[\w.]+\s*,\s*)*send\b(?![\w.])"
    r"|\bfrom\s+send\s+import\b"
    r"|\brunpy\b[^\n]*\bsend\b"
    r"|\b(?:__import__|import_module)\s*\(\s*['\"]send['\"]"
    r"|\bspec_from_file_location\b[^\n]*\bsend\.py\b"
    # The same class on the Graph sender (src/graph-mail.ts, export sendMail): renamed on
    # import, or reached by a string key -- the call itself then never reads `sendMail(`.
    r"|\bsendMail\s+as\b|\[\s*['\"]sendMail['\"]\s*\]"
)
_CODE_EXECISH = re.compile(
    r"\bsubprocess\b|os\.system|\bpopen\b|child_process|\bexec[A-Za-z]*\s*\(|\bspawn[A-Za-z]*\s*\(",
    re.I,
)
_CODE_SENDER_LIT = re.compile(r"sendmail|msmtp|swaks|send\.py", re.I)


# A RESEND MAIL POST WRITTEN AS CODE (card 5768a25d, didi 55349): the host and an `/emails` path
# named anywhere in the code text are a send, matched on the RAW text (the URL is a string literal;
# the bc98d6d5 blanking would erase it). Full note and the named cost: resendMailInCode in
# email-send-gate.mjs. `/emails/receiving` (the inbound-mail read) is skipped per occurrence.
_RESEND_HOST_IN_CODE = re.compile(r"api\.resend\.com(?![\w-])", re.I)
_RESEND_MAIL_PATH_IN_CODE = re.compile(r"/emails(?!/receiving(?![\w-]))(?![\w-])", re.I)


def _resend_mail_in_code(code: str) -> bool:
    return bool(_RESEND_HOST_IN_CODE.search(code) and _RESEND_MAIL_PATH_IN_CODE.search(code))


def _code_string_sends(code: str) -> bool:
    if _CODE_SEND.search(code) or _CODE_SEND_MODULE.search(code) or _resend_mail_in_code(code):
        return True
    return bool(_CODE_EXECISH.search(code) and _CODE_SENDER_LIT.search(code))
# Token-ELEJERE horgonyzott cel-minta: egy URL-argumentum vagy csupasz
# domain/utvonal illik ra; egy JSON-payload ('{...api.resend.com...}') nem.
# RESENDHOST926 (card 0ca64c14, didi's probe 2026-09-26): the host is matched
# in its NORMALIZED shape -- optional `--url=` glue, optional userinfo
# (`x@`), trailing root dots (`api.resend.com.`), an optional port (`:443`),
# and `?`/`#` right after the host. All of these reach the same provider, and
# the old pattern let a real mail POST through as "not a send". The userinfo
# may not contain whitespace or `/`, so an address inside a message payload
# ('... x@api.resend.com') still does not qualify. The twin in
# email-send-gate.mjs is identical; send-invocation-cases.json pins both.
_RESEND_TARGET = re.compile(
    r"^(--url=)?(https?://)?([^/?#@\s]*@)?([^/?#@\s]*\.)?api\.resend\.com\.*(:\d*)?([/?#]|\s|$)",
    re.I,
)

# RESENDGATE826: a resend-celu curl/wget csak akkor KULDES, ha a METODUS az.
# A korabbi minta metodus-vak volt, es egy read-only GET /domains (nincs torzs,
# nincs cimzett) ugyanugy fail-closed elutasitast kapott -- pont egy domain-
# verifikacios MERES akadt el rajta. A szukites iranya szigoru: a metodust
# FELISMERNI kell (explicit -X/--request/--method, vagy implicit POST a
# torzs-flagekbol); ha nem allapithato meg (valtozo, config-fajl, csonka flag),
# marad a fail-closed. Egy "nincs felismerheto torzs -> atmegy" szabaly a
# kaput utne ki, ezert ILYEN AG NINCS.
# 2026-11-02 (didi 51624 T2, marveen 10006089): a READ verdict mar NEM enged at a
# kuldes-dontesben (a JS iker metodus-vak, es a szigorubb iker a helyes); a verdikt
# mar csak a csatorna-feed GET-hez kell (a RESENDCFG926 kivetel 2026-11-06 ota nincs).
_CURL_BODY_OPTS = {
    "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode",
    "--data-ascii", "-F", "--form", "--form-string", "--json",
    "-T", "--upload-file",
    # wget torzs-flagek
    "--post-data", "--post-file", "--body-data", "--body-file",
}
_SAFE_METHODS = {"GET", "HEAD"}


# RESENDCFG926 is gone (card 6525aba3, marveen 10009481, 2026-11-06): the Resend
# CONFIG exemption (POST /webhooks, /domains) made this twin pass what the JS twin
# denies, and where the twins differ the stricter one is right. Every curl/wget to
# api.resend.com is a send in both, config included; configuring Resend goes
# through a gate exception the owner grants, not through a parser carve-out.
# send-invocation-cases.json pins POST /domains, POST /webhooks, DELETE /domains/abc.


_CURL_VALUE_SHORT = set("HdXoOwuAebcmFTEKrYyzCPQtx")
_CURL_VALUE_LONG = {
    "--header", "--data", "--data-raw", "--data-binary", "--data-urlencode",
    "--data-ascii", "--json", "--output", "--write-out", "--request", "--method",
    "--user", "--user-agent", "--referer", "--cookie", "--cookie-jar",
    "--max-time", "--connect-timeout", "--retry", "--form", "--form-string",
    "--upload-file", "--config", "--cert", "--key", "--cacert", "--proxy",
    "--resolve", "--connect-to", "--range", "--time-cond", "--oauth2-bearer",
}


# RESENDGETTWIN1010: a httpie (`http`, `https`) metodusa POZICIONALIS (http POST URL),
# a torzse `kulcs=ertek` / `kulcs:=json` elem -- egyiket sem ismeri az alabbi
# curl/wget flag-olvaso, ezert a `http POST .../emails to=...` "read" lett, es a
# kapu atengedte. A httpie-re a metodus itt nem dontheto: fail-closed.
# FORK (812bd946): csak ezek a sorok jottek az upstream 63a392c8-bol; a JS iker
# (email-send-gate.mjs) a httpie-t mar a bazison is kuldesnek veszi.
_HTTPIE = re.compile(r"^https?$", re.I)  # http and https: both httpie


def _curl_resend_verdict(prog, rest):
    """'read' | 'send' | 'unknown' -- unknown a hivo oldalon fail-closed."""
    if _HTTPIE.match(prog):
        return "unknown"
    method = None
    has_body = False
    get_forced = False
    i, n = 0, len(rest)
    while i < n:
        t = rest[i]
        if t in ("-X", "--request", "--method"):
            if i + 1 >= n or not rest[i + 1].isalpha():
                return "unknown"  # csonka vagy valtozo ($METHOD) -- nem dontheto
            method = rest[i + 1].upper()
            i += 2
            continue
        if t.startswith("--request=") or t.startswith("--method="):
            m = t.split("=", 1)[1]
            if not m.isalpha():
                return "unknown"
            method = m.upper()
            i += 1
            continue
        if t in ("-G", "--get"):
            get_forced = True
            i += 1
            continue
        if t in ("-K", "--config"):
            return "unknown"  # a config-fajl rejtett metodust/torzset hordozhat
        if t in _CURL_BODY_OPTS or any(
            t.startswith(o + "=") for o in _CURL_BODY_OPTS if o.startswith("--")
        ):
            has_body = True
            i += 1
            continue
        if t.startswith("-") and not t.startswith("--") and len(t) > 1:
            # egy-kotojeles cluster (-sS, -sX POST, -sd '{}'): a betuk kotegelve
            letters = t[1:]
            if "X" in letters:
                after = letters.split("X", 1)[1]
                if after:
                    if not after.isalpha():
                        return "unknown"
                    method = after.upper()
                else:
                    if i + 1 >= n or not rest[i + 1].isalpha():
                        return "unknown"
                    method = rest[i + 1].upper()
                    i += 1
            elif "d" in letters or "F" in letters or "T" in letters:
                has_body = True
            elif "G" in letters:
                get_forced = True
            elif "K" in letters:
                return "unknown"
            i += 1
            continue
        i += 1
    if method is not None and method not in _SAFE_METHODS:
        return "send"
    if has_body and not get_forced:
        # implicit POST (curl -d/-F/--json/-T alapertelmezese), vagy egy
        # gyanus "GET torzzsel" alak -- mindketto kuldeskent kezelve
        return "send"
    return "read"
# VARURL926 (card cb63ddb4, didi's review of 0ca64c14): a Resend URL held in
# a shell variable or built by a command substitution -- `API=...; curl -X
# POST $API/emails -d ...`, `curl $(cat f)/emails ...` -- never matched
# _RESEND_TARGET, so a real mail POST passed as "not a send" in both gates.
# The host is unknowable before the shell runs, so the rule is a NARROW
# fail-closed on the BODY instead: a curl/wget whose URL (a positional arg or
# --url) contains an unresolved `$`, AND whose request body carries BOTH a
# `to` key AND a `subject` key, is a send. Why `subject`: the provider's send
# endpoint requires it, and our inter-agent payload (from/to/content) never
# has it -- a rule on `to` alone would block our own messaging. Only BODY
# option values are read, never headers, so `Reply-To:` does not count.
# Stated limits that stay: IP + Host header, httpie, python requests, a body
# from a file or stdin (`-d @f`), a body itself in a variable.
# Twin: varUrlSend in email-send-gate.mjs; send-invocation-cases.json pins both.
_VARURL_BODY_LONG = {
    "--data", "--data-raw", "--data-binary", "--data-urlencode", "--data-ascii",
    "--json", "--form", "--form-string", "--post-data", "--body-data",
}
# A KEY, not a word: a DOUBLE-quoted JSON key (`"to":`; JSON keys never take
# single quotes, and prose quoting 'to': must not count -- didi, cb63ddb4) or a form field at the start
# of a value or after `&` (`to=`, `a=1&subject=x`). Prose inside a message
# ("... subject: x ...") does not count.
_VARURL_TO = re.compile(r"\"to\"\s*:|(?:^|&)to=", re.I | re.M)
_VARURL_SUBJECT = re.compile(r"\"subject\"\s*:|(?:^|&)subject=", re.I | re.M)


def _collapse_subst(cmd: str) -> str:
    """`$(...)` and backtick substitutions -> the placeholder `$__SUBST__`, so
    the URL they build stays ONE token carrying an unresolved `$` (the segment
    splitter would otherwise cut the curl command in two)."""
    out = []
    i, n = 0, len(cmd)
    q = None
    while i < n:
        ch = cmd[i]
        if q == "'":
            if ch == "'":
                q = None
            out.append(ch); i += 1; continue
        if ch == "\\" and i + 1 < n:
            out.append(cmd[i:i + 2]); i += 2; continue
        if ch == "'" and q is None:
            q = "'"; out.append(ch); i += 1; continue
        if ch == '"':
            q = None if q == '"' else '"'
            out.append(ch); i += 1; continue
        if ch == "$" and i + 1 < n and cmd[i + 1] == "(":
            depth, j = 1, i + 2
            while j < n and depth:
                depth += {"(": 1, ")": -1}.get(cmd[j], 0)
                j += 1
            out.append("$__SUBST__"); i = j; continue
        if ch == "`":
            j = cmd.find("`", i + 1)
            j = n if j < 0 else j + 1
            out.append("$__SUBST__"); i = j; continue
        out.append(ch); i += 1
    return "".join(out)


def _curl_urls_and_bodies(rest):
    """(positional/--url values, body-option values) of a curl/wget arg list."""
    urls, bodies = [], []
    i, n = 0, len(rest)
    while i < n:
        t = rest[i]
        if t == "--url" and i + 1 < n:
            urls.append(rest[i + 1]); i += 2; continue
        if t.startswith("--url="):
            urls.append(t.split("=", 1)[1]); i += 1; continue
        if t.startswith("--"):
            name = t.split("=", 1)[0]
            if "=" in t:
                if name in _VARURL_BODY_LONG:
                    bodies.append(t.split("=", 1)[1])
                i += 1; continue
            if t in _CURL_VALUE_LONG or t in _VARURL_BODY_LONG:
                if t in _VARURL_BODY_LONG and i + 1 < n:
                    bodies.append(rest[i + 1])
                i += 2; continue
            i += 1; continue
        if t.startswith("-") and len(t) > 1:
            letters = t[1:]
            k = next((j for j, ch in enumerate(letters) if ch in _CURL_VALUE_SHORT), None)
            if k is None:
                i += 1; continue
            glued = letters[k + 1:]
            is_body = letters[k] in "dF"
            if glued:
                if is_body:
                    bodies.append(glued)
                i += 1; continue
            if is_body and i + 1 < n:
                bodies.append(rest[i + 1])
            i += 2; continue
        urls.append(t)
        i += 1
    return urls, bodies


def _var_url_send(cmd: str, depth: int) -> bool:
    try:
        segments = _segments_tokens(_collapse_subst(cmd))
    except ValueError:
        return False
    for toks in segments:
        for h in _command_heads(toks):
            if not h or not _CURLISH.match(_basename(h[0])):
                continue
            urls, bodies = _curl_urls_and_bodies(h[1:])
            if not any("$" in u for u in urls):
                continue
            body = "\n".join(bodies)
            if _VARURL_TO.search(body) and _VARURL_SUBJECT.search(body):
                return True
    return False


# A tovabbi kuldes-jellegu literalok, amikre a parse-hiba eseten (es CSAK
# akkor) konzervativan visszaesunk -- lasd is_send_invocation vegen.
#
# A HATAR EZEN A LISTAN A HIVAS-ALAK, NEM A TOKEN (kartya b6f78436). A `\s*\(`
# horgony valasztja szet a HASZNALATOT az EMLITESTOL, es ez a repo mar eldontotte
# ezt a hatart: a kozos eset-korpusz (`send-invocation-cases.json`) a
# `...sendEmail({...})` hivast `expected: true`-nak, a `'sendEmail' in ...` alaku
# cenzus-szkennelest `expected: false`-nak veszi. A parszolt ut (`_CODE_SEND`) ezt
# megvalositja; a fallback 2026-09-06-ig CSAK a `sendMail(`-re -- a masik ket
# hivas-alak kimaradt, es ezzel ket VALODI kuldest atengedett parszolhatatlan
# bemeneten. Ez a fallback SAJAT kikotesenek mondott ellent („egy fura, de valodi
# kuldes nem csuszik at neman").
#
# AMI SZANDEKOSAN KIMARAD, ES AMIT NE TEGYEL BE: a CSUPASZ `sendEmail` / `mail.send`
# token. Az ebben a repoban cenzus-grep alak, es a `de5e1709` pin ezt kifejezetten
# rogziti (`outgoing-copy-gate-scope.test.ts`). Merve a valtoztatas elott es utan:
# a ket csupasz eset MINDKET allapotban `false`, a `sendmail` kontroll MINDKETTOBEN
# `true` -- tehat ez a sor a KET MEGNEVEZETT ALAKOT celozta, nem a politikat.
# A `9ebde77b` dontes (a ket kapu ELTER, ne igazitsd ossze) ERINTETLEN.
#
# === A PARSZOLT UT ES EZ A LISTA ELTERNEK, ES EZ DONTES (kartya 980ebc8c) =====
#
# marveen dontese, 2026-09-06, jarvis meresebol es dexter ujramerésébol. A
# bekezdes azert all itt, mert egy kesobbi cenzus KI FOGJA MERNI ezt az elterest,
# es allitas nelkul DEFEKTUSNAK olvassa -- ugyanaz az ok, amiert a ket
# mail-kapu divergenciaja is le van irva (fe418df).
#
# A SZAMOK, es a metrikajuk kiirva, mert ket ertelmes olvasat van es ELTERO
# szamot adnak. Korpusz: a kapu SAJAT eset-keszlete (send-invocation-cases.json),
# minden esetet a fo uton ES egy paratlan idezojellel (ami a fallbackbe kenyszerit):
#
#                        esetek   fallback TOBBET   fallback KEVESEBBET   osszes
#                                   blokkol           blokkol
#   ez a fa (fe418df)       51          16                 1               17
#   + a 980ebc8c javitas    57          18                 2               20
#
#   KONTROLL: `ls -la` egy paratlan idezojellel -> a fallback False. Enelkul a
#   fenti szamok a meroröl szolnanak. Es a fo ut MINDKET fan hibatlan a SAJAT
#   korpuszan (51/51, illetve 57/57 az `expected` cimke ellen).
#
#   A KET SZAM-PAR NEM ELLENTMONDAS: 16/18 az EGYIRANYU olvasat (jarvise),
#   17/20 a KETIRANYU (dexteré). Ugyanaz a fa, ugyanaz a korpusz, mas metrika --
#   megmerve, nem kibekitve. Aki ujramer, irja oda, MELYIKET szamolja.
#
# MIERT MARAD IGY -- marveen negy indoka:
#   1. ez az ag KIZAROLAG parszolhatatlan bemeneten fut: ritka, sajat okozasu, es
#      HANGOS. Az agens latja a blokkot es ujraidezi.
#   2. a szukitese azt jelentene, hogy "nem tudtuk elolvasni, tehat KEVESEBBET
#      ellenorzunk" -- a NOT SCANNED THEREFORE NOT CLEARED megforditva. E fajl
#      sajat kommentje mondja ki, hogy a fallback azert van, hogy egy
#      furcsa-de-valodi kuldes ne csusszon at csendben.
#   3. aszimmetria: egy hamis pozitiv ara EGY lathato blokkolt parancs,
#      kezenfekvo orvossaggal; a szukitese ara egy atcsuszo kuldes PONTOSAN azon
#      a bemeneten, amit nem tudtunk elemezni.
#   4. a cenzus-esetnek van olcsobb javitasa, ami a kaput nem erinti: egy
#      paratlan idezojelu cenzus-grep maga is torott parancs, es a hej amugy is
#      kikenyszeriti a javitasat.
#
# ES AMIT A KETIRANYU OLVASAT MUTAT MEG, AMIT AZ EGYIRANYU NEM LAT: ez a lista
# nem egyszeruen SZELESEBB a parszolt utnal. Ket eseten SZUKEBB, es mindketto
# `expected: true` -- vagyis valodi kuldes, amit a fallback ATENGED:
#
#   `node -e "...sendEmail({...})"`  -- a fo ut ismeri a `sendEmail` alakot,
#                                      ez a lista `sendMail\s*\(`-t ismer, ami MAS token
#   egy M365 CLI kimeno alparancs   -- mar a fe418df-en is, a 980ebc8c elott
#
# Ez NEM cafolja a fenti dontest (a 2. indok epp ez ellen ved), de kimondja a
# hataraat: a fallback nem "mindig biztonsagosabb", hanem MASIK halmazt fog meg.
# Ha valaha bovul, ez a ket alak a bemenet -- es akkor is a fenti negy indok
# marad ervenyben arra, hogy SZUKITENI nem szabad.
#
# DEXTER KIMONDOTT MERESI HIBAJA, mert a szam nelkule ujratermelodne: az elso
# futasomban a MODULT mindket farol toltottem be, de a KORPUSZT csak a futo
# farol -- holott a 980ebc8c aga HAT esettel bovíti. A kereszt-parositas 17/17-et
# adott, vagyis "a ket fa azonos"-t, es epp a novekedest tuntette el. Ket bemenet,
# ket fa: mindket bemenetet UGYANARROL a farol kell venni.
#
# SEAM (marveen-koteg 2026-10-18, friday): a fenti "ket eseten SZUKEBB" bekezdes
# `sendEmail({...})` sora a b6f78436 ELOTTI allapotot irja. A b6f78436 (a fenti
# blokk) a `sendEmail\s*\(` es `mail\.send\s*\(` hivas-alakot felvette, tehat a
# fallback ezt mar MEGFOGJA; az M365 CLI alparancs-eset tovabbra is all.
# =============================================================================
_FALLBACK_LITERALS = re.compile(
    r"send\.py|api\.resend\.com|\bsendmail\b|\bmsmtp\b|\bswaks\b"
    r"|\bsmtplib\b|\bsendMail\s*\(|\bsendEmail\s*\(|\bmail\.send\s*\(", re.I
)


def _basename(tok: str) -> str:
    return tok.rsplit("/", 1)[-1]


def _mask_subshell_markers(cmd: str) -> str:
    """Idezojelen KIVULI ujsor/`$(`/backtick -> `;` szeparator, hogy a shlex
    szegmens-hatarkent lassa; idezojelen BELUL a szoveg erintetlen (tartalom)."""
    out = []
    q = None  # None | "'" | '"'
    i, n = 0, len(cmd)
    while i < n:
        ch = cmd[i]
        if q:
            if ch == "\\" and q == '"' and i + 1 < n:
                out.append(cmd[i:i + 2]); i += 2; continue
            if ch == q:
                q = None
            out.append(ch); i += 1; continue
        if ch in "'\"":
            q = ch; out.append(ch); i += 1; continue
        if ch == "\\" and i + 1 < n:
            out.append(cmd[i:i + 2]); i += 2; continue
        if ch == "\n" or ch == "`":
            out.append(";"); i += 1; continue
        if ch == "$" and i + 1 < n and cmd[i + 1] == "(":
            out.append(";"); i += 2; continue
        out.append(ch); i += 1
    return "".join(out)


def _segments_tokens(cmd: str):
    """[[token, ...], ...] szegmensenkent -- quote-tudatosan, poziciot orizve."""
    import shlex
    lex = shlex.shlex(_mask_subshell_markers(_HEREDOC.sub(r"\1", cmd)),
                      posix=True, punctuation_chars="();|&")
    lex.whitespace_split = True
    # HASHCOMMENT6525: no comments. shlex's default commenter took ANY unquoted `#`
    # (`${a#b}`, `$#`, `a#b`, `echo hi # c`) and dropped the rest of the command,
    # newlines included, so a send on the next line went unseen while the JS twin
    # denied it (didi 51494). A bash-faithful cut (a word-start `#` up to the newline)
    # was measured and rejected: the JS twin has no comment notion, so
    # `echo hi # x; sendmail a@b.hu` is a send there and the cut made this twin the
    # weaker one (marveen 50880/51498: same final decision, align to the stricter).
    lex.commenters = ""
    segments, cur = [], []
    for tok in lex:
        # SEGSPLIT923: shlex(punctuation_chars) returns a RUN of operator
        # characters as ONE token, so `$(date); sendmail ...` (after the
        # subshell mask: `;date); sendmail`) yielded the token ");" -- not in
        # the list, so it did not split, `sendmail` landed mid-segment, and the
        # send was NOT recognised: the copy audit was silently skipped. The JS
        # twin (email-send-gate.mjs) said true on the same input; nothing in
        # the conformance list covered it. A token made ONLY of operator
        # characters is always an operator sequence, so it separates.
        if tok in ("|", "||", "&", "&&", ";", "(", ")", ";;", "|&") or (tok and set(tok) <= set("();|&")):
            if cur:
                segments.append(cur)
            cur = []
        else:
            cur.append(tok)
    if cur:
        segments.append(cur)
    return segments


# SENDWRAP924: a wrapper in front of the sender -- `sudo sendmail x`,
# `time -p sendmail x`, `env -i sendmail x`, `timeout 10 sendmail x` -- made
# the wrapper the "program", so the send was not recognised and the copy audit
# was silently skipped (13 measured shapes, both copies). A wrapper is stepped
# over WITH its own flags: a flag that takes a value consumes it, so in
# `sudo -u sendmail true` the program is `true`, not `sendmail`.
# name -> (short flags taking a value, long flags taking a value, positional
# arguments before the command). An UNKNOWN long flag without `=` may or may
# not take a value, so both readings are tried and either one being a send
# counts: an unknown flag errs toward auditing, never toward skipping.
# `command -v/-V` looks a name up and runs nothing. `function NAME` and
# `coproc [NAME]` put their body in command position. Mirrored in
# email-send-gate.mjs (WRAPPERS / commandHeads); send-invocation-cases.json
# binds the two.
_WRAPPERS = {
    "time": ("fo", ("format", "output"), 0),
    "sudo": ("ughpCUrtDRT", ("user", "group", "host", "prompt", "close-from", "other-user",
                             "role", "type", "chdir", "chroot", "command-timeout"), 0),
    "env": ("uCS", ("unset", "chdir", "split-string"), 0),
    "nohup": ("", (), 0),
    "nice": ("n", ("adjustment",), 0),
    "exec": ("a", (), 0),
    "command": ("", (), 0),
    "xargs": ("ILnPsdEa", ("arg-file", "delimiter", "eof", "replace", "max-lines", "max-args",
                           "max-procs", "max-chars", "process-slot-var"), 0),
    "timeout": ("sk", ("signal", "kill-after"), 1),
    # setsid: for future use and symmetry. NOT measured local traffic: the hits the
    # first count found all sat inside quoted remote (ssh) command strings or heredoc
    # bodies, and that pattern was not quote-aware (Marveen's correction, 2026-09-24).
    "setsid": ("", (), 0),
}
_HEAD_DEPTH = 8


def _command_heads(toks, _d: int = 0):
    """Every token list that can be the real command of this segment, after the
    leading assignments, command-position keywords and wrappers are stepped over."""
    while toks and (_ENV_ASSIGN.match(toks[0]) or toks[0] in _CMD_POSITION_KEYWORDS):
        toks = toks[1:]
    if not toks:
        return [toks]
    w = _basename(toks[0])
    if _d >= _HEAD_DEPTH:
        # Still a wrapper at the depth bound: the real command is out of sight,
        # so it counts as a send (None) -- the bound errs toward auditing, like
        # an unknown flag does. It used to return the wrapper itself, and nine
        # nested wrappers + sendmail was silently skipped (Samu, #1521 review).
        return [None] if (w in _WRAPPERS or w in ("function", "coproc")) else [toks]
    if w == "function":
        return _command_heads(toks[2:], _d + 1)
    if w == "coproc":
        return _command_heads(toks[1:], _d + 1) + _command_heads(toks[2:], _d + 1)
    spec = _WRAPPERS.get(w)
    if spec is None:
        return [toks]
    short_val, long_val, positionals = spec
    i, starts = 1, []
    while i < len(toks):
        t = toks[i]
        if t == "--":
            i += 1
            break
        if t.startswith("--"):
            if "=" not in t and t[2:] in long_val:
                i += 2
                continue
            if "=" not in t:
                starts.append(i + 2)
            i += 1
            continue
        if t.startswith("-") and len(t) > 1:
            if w == "command" and ("v" in t or "V" in t):
                return []
            k = next((j for j, ch in enumerate(t[1:], 1) if ch in short_val), -1)
            i += 2 if k == len(t) - 1 else 1
            continue
        break
    starts.insert(0, i)
    heads = []
    for s in starts:
        heads += _command_heads(toks[s + positionals:], _d + 1)
    return heads


def _segment_is_send(toks, depth: int, ctx=None) -> bool:
    return any(_head_is_send(h, depth, ctx) for h in _command_heads(toks))


# A SCRIPT FILE RUN BY AN INTERPRETER IS JUDGED ON ITS CONTENT (card a4ae5970). The full
# rationale, the measurement and the NOT COVERED list stand at scriptOperands in
# email-send-gate.mjs (the twin); send-invocation-cases.json binds the two. The runner walk is
# the twin's executedNames walk, ported here for this one use.
_RUNNER = re.compile(r"^(node|tsx|ts-node|deno|bun|bunx|npx|pnpx|npm|pnpm|yarn|uv|uvx|python3?(?:\.\d+)?|sh|bash|zsh|dash)$", re.I)
_RUNNER_SUBCOMMANDS = {
    "npm": ("exec", "x", "run", "run-script"), "pnpm": ("dlx", "exec", "run"), "yarn": ("dlx", "exec", "run"),
    "uv": ("run", "tool"), "deno": ("run",), "bun": ("run", "x"),
}
_RUNNER_BOOLEAN_LONG = re.compile(
    r"^--(yes|no-[\w-]+|quiet|silent|verbose|inspect|inspect-brk|trace-[\w-]+|experimental-[\w-]+|enable-source-maps"
    r"|watch|preserve-symlinks|frozen-lockfile|offline|ignore-scripts|if-present)$", re.I)
_RUNNER_VALUE_OPTS = frozenset((
    "-p", "--package", "-r", "--require", "--import", "--loader", "--tsconfig", "-m", "--from", "--with",
    "-X", "-W", "--env-file", "-o", "-O", "--prefix",
))
_SCRIPT_RUN_OPTS = frozenset(("-r", "--require", "--import", "--loader"))


def _runner_option(prog: str, t: str) -> bool:
    """An option of the runner: `-x`, and for a shell also `+o name`. Twin: runnerOption."""
    return t != "-" and (t.startswith("-") or bool(_WRAPPER_SHELL.match(prog) and re.match(r"^\+[a-zA-Z]+$", t)))


def _value_count(prog: str, t: str) -> int:
    """How many of the next tokens are its values, clusters included (`-euo pipefail`, `-uX utf8`).

    A shell gives one to EVERY o/O of a short cluster, in order, wherever it stands
    (`-oc pipefail '<code>'`, `-euoc pipefail`, `-ooc a b`): reading only a final o took
    pipefail for the code (didi 59145). Twin: valueCount."""
    if t in _RUNNER_VALUE_OPTS:
        return 1
    if _WRAPPER_SHELL.match(prog) and re.match(r"^[-+][a-zA-Z]+$", t):
        return len(re.findall(r"[oO]", t))
    if _PYTHON.match(prog) and re.match(r"^-[a-zA-Z]*[XW]$", t):
        return 1
    return 0


# Python reads a short cluster left to right: any flag letter may stand before the c or m, until
# one that takes the rest as its value (X, W). A fixed letter list missed -P and -R (didi 59145).
_PY_FLAGS_BEFORE_CODE = "[abd-ln-zA-VYZ]*"
_SCRIPT_MAX_BYTES = 1_000_000
_JS_RUNNER = re.compile(r"^(node|tsx|ts-node|deno|bun)$", re.I)
_NO_CTX = {"cwd": None, "files": True}


def _script_ext_kind(t: str):
    if re.search(r"\.py$", t, re.I):
        return "py"
    if re.search(r"\.[mc]?[jt]s$", t, re.I):
        return "js"
    if re.search(r"\.(?:sh|bash|zsh)$", t, re.I):
        return "sh"
    return None


def _runner_kind(prog: str) -> str:
    if _PYTHON.match(prog):
        return "py"
    if _WRAPPER_SHELL.match(prog):
        return "sh"
    return "js" if _JS_RUNNER.match(prog) else "any"


def _code_opt_stops(prog: str, t: str) -> bool:
    """The option that turns the rest into a code string or a module name, per runner."""
    if _PYTHON.match(prog):
        return bool(re.match(rf"^-{_PY_FLAGS_BEFORE_CODE}[cm]", t))
    if _WRAPPER_SHELL.match(prog):
        return bool(re.match(r"^-[a-z]*[cs]", t, re.I))
    if _JS_RUNNER.match(prog):
        return bool(re.match(r"^(?:-[ep]{1,2}|--eval|--print)(?:=|$)", t))
    return False


def _script_operands(toks):
    """The files a command RUNS, each with the kind its content is judged as. Twin: scriptOperands."""
    out = []
    if not toks:
        return out
    if toks[0] in ("source", "."):
        if len(toks) > 1:
            out.append((toks[1], _script_ext_kind(toks[1]) or "sh"))
        return out
    if "/" in toks[0] and _script_ext_kind(toks[0]):
        out.append((toks[0], _script_ext_kind(toks[0])))
    prog, i, hop = _basename(toks[0]), 1, 0
    while hop < 4 and _RUNNER.match(prog):
        subs = _RUNNER_SUBCOMMANDS.get(prog.lower())
        if subs and i < len(toks) and toks[i] in subs:
            i += 1
        while i < len(toks) and _runner_option(prog, toks[i]):
            t = toks[i]
            if t == "--":
                i += 1
                break
            if _code_opt_stops(prog, t):
                return out
            unknown_long = t.startswith("--") and "=" not in t and not _RUNNER_BOOLEAN_LONG.match(t)
            n = 1 if unknown_long else _value_count(prog, t)
            if n > 0 and i + n < len(toks) and not toks[i + 1].startswith("-"):
                # A preload runs; so may the value of a long flag we do not know (it may be a boolean).
                if t in _SCRIPT_RUN_OPTS or unknown_long:
                    out.append((toks[i + 1], _script_ext_kind(toks[i + 1]) or _runner_kind(prog)))
                i += 1 + n
                continue
            i += 1
        if i >= len(toks):
            break
        out.append((toks[i], _script_ext_kind(toks[i]) or _runner_kind(prog)))
        prog = _basename(toks[i])
        i += 1
        hop += 1
    return out


def _resolve_script_path(tok: str, cwd):
    """The absolute path a token names, or None when it is not known. Twin: resolveScriptPath."""
    if not tok or re.search(r"[$`*?\[{]", tok):
        return None
    if tok == "~" or tok.startswith("~/"):
        return os.path.join(os.path.expanduser("~"), tok[2:]) if tok != "~" else os.path.expanduser("~")
    if os.path.isabs(tok):
        return tok
    return os.path.normpath(os.path.join(cwd, tok)) if cwd else None


def _read_script(path: str):
    try:
        st = os.stat(path)
        if not stat.S_ISREG(st.st_mode) or st.st_size > _SCRIPT_MAX_BYTES:
            return None
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def _script_file_sends(toks, depth: int, ctx) -> bool:
    if not ctx["files"]:
        return False
    for path, kind in _script_operands(toks):
        file = _resolve_script_path(path, ctx["cwd"])
        body = _read_script(file) if file else None
        if body is None:
            continue
        if kind in ("py", "any") and _python_body_sends(body, True):
            return True
        if kind in ("js", "any") and _heredoc_body_sends(body):
            return True
        if kind in ("sh", "any") and depth < 3 and is_send_invocation(body, _depth=depth + 1, ctx=ctx):
            return True
    return False


def _cwd_after(toks, cwd, old_cwd=None):
    """The cwd after a segment: a literal cd/pushd moves it, anything unresolvable clears it.
    `cd -` goes to the cwd before the last move in this command, else clears. Twin: cwdAfter."""
    if toks[0] not in ("cd", "pushd"):
        return cwd
    args = [t for t in toks[1:] if t != "--" and not re.match(r"^-[LPe@]+$", t)]
    if not args:
        return os.path.expanduser("~")
    if args[0] == "-":
        return old_cwd
    return _resolve_script_path(args[0], cwd)


def _code_strings(prog: str, rest) -> list:
    """The code strings a runner is handed by its code option. Twin: codeStrings.

    A shell reads the c anywhere in a short cluster (`-lc`, `-ec`, `-c -l`, `-co pipefail`,
    `-oc pipefail`) and runs the first operand left after every option has taken its values.
    Python takes the code glued (`-cprint(1)`) or as the next word, in a cluster too (`-Ic`,
    `-IPc`). Node takes -e/--eval and -p/--print, also `-pe` and
    `--eval=code`. Matching the bare `-c` only let `bash -lc '<send>'`, the fleet's usual
    login-shell form, pass both gates (didi 59096, card 003d0866)."""
    out = []
    for i, t in enumerate(rest):
        if _WRAPPER_SHELL.match(prog):
            if not re.match(r"^-[a-zA-Z]*c[a-zA-Z]*$", t):
                continue
            j = i + 1 + _value_count(prog, t)
            while j < len(rest) and _runner_option(prog, rest[j]):
                if rest[j] == "--":
                    j += 1
                    break
                j += 1 + _value_count(prog, rest[j])
            if j < len(rest):
                out.append(rest[j])
        elif _PYTHON.match(prog):
            m = re.match(rf"^-{_PY_FLAGS_BEFORE_CODE}c(.*)$", t, re.S)
            if m and m.group(1):
                out.append(m.group(1))
            elif m and i + 1 < len(rest):
                out.append(rest[i + 1])
        elif _NODEISH.match(prog):
            # -p is --package to npx: -p/--print count only on the runners where they run code
            m = re.match(r"^(-e|--eval|-p|--print|-pe|-ep)(?:=(.*))?$", t, re.S)
            if not m or (not re.match(r"^(node|tsx|ts-node|bun)$", prog, re.I)
                         and m.group(1) not in ("-e", "--eval")):
                continue
            if m.group(2) is not None:
                out.append(m.group(2))
            elif i + 1 < len(rest):
                out.append(rest[i + 1])
    return out


def _head_is_send(toks, depth: int, ctx=None) -> bool:
    ctx = ctx or _NO_CTX
    if toks is None:  # the depth bound was hit on a wrapper: audit it
        return True
    if not toks:
        return False
    prog = _basename(toks[0])
    rest = toks[1:]
    if _SENDER_PROG.match(prog):
        return True
    # burkolo hejj: a -c string-argumentum maga is parancs -- rekurzio
    if _WRAPPER_SHELL.match(prog) and depth < 3:
        if any(is_send_invocation(code, _depth=depth + 1, ctx=ctx) for code in _code_strings(prog, rest)):
            return True
    # interpreter kod-string: python -c / node -e / --eval, ami kuldest hiv
    if _PYTHON.match(prog) or _NODEISH.match(prog):
        if any(_code_string_sends(code) for code in _code_strings(prog, rest)):
            return True
    # send.py futtatasa (kozvetlenul, vagy python/runner utan) --to cimzettel
    candidates = [prog] + (
        [_basename(rest[0])] if rest and (_PYTHON.match(prog) or _NODEISH.match(prog)) else []
    )
    # Issue #1853: `python3 -m send` (or -m pkg.send) is the same sender run by module
    # name; it gets the same --to rule as the file-name form.
    if _PYTHON.match(prog):
        for i, t in enumerate(rest):
            # -m send, and the glued -msend python accepts too
            mod = (rest[i + 1] if i + 1 < len(rest) else None) if t == "-m" else (t[2:] if t.startswith("-m") and len(t) > 2 else None)
            if mod is not None and mod.rsplit(".", 1)[-1] == "send":
                candidates.append("send.py")
    if any(_SENDPY.match(c) for c in candidates) and any(
        t == "--to" or t.startswith("--to=") for t in rest
    ):
        return True
    # graph-mail kimeno alparanccsal (tsx/node runner utan is)
    if any(_GRAPHMAIL.match(_basename(t)) for t in toks) and "send" in rest:
        return True
    # curl/wget: a cel-token akkor is muvelet, ha idezojelben allt -- a
    # horgonyzott minta valasztja el a payload-belseji emlitestol.
    # RESENDGATE826: csak a TENYLEGES kuldes (POST/PUT/... vagy torzs) akad
    # fenn; a read-only GET/HEAD lekerdezes atmegy; a nem-donthato metodus
    # tovabbra is fail-closed.
    if _CURLISH.match(prog) and any(_RESEND_TARGET.match(t) for t in rest):
        # didi 51624 T2, marveen 10006089: where the twins differ, the stricter one is right.
        # The JS hook denies every curl/wget to api.resend.com, so a read (GET/HEAD, -G) is
        # a send here too (RESENDGATE826's read pass is gone), and so is a config call
        # (RESENDCFG926 is gone, marveen 10009481).
        return True
    return _script_file_sends(toks, depth, ctx)


def wrapper_depth_hit(cmd: str, ctx=None) -> bool:
    """True when some segment is still a wrapper at the depth bound, so it was
    counted as a send without the real command being seen (HEADDEPTH924). The
    gate uses it to say WHY it blocks: "I could not audit the letter" is the
    wrong reason for `nohup x9 git status` (Marveen, #1522 review)."""
    # Only when the depth bound is the WHOLE reason: if a visible segment is a
    # send on its own (`sendmail x; sudo x9 true`), that send is the reason,
    # and the ordinary wording must stay (Samu, #1523 review).
    try:
        segments = _segments_tokens(cmd)
    except ValueError:
        return False
    heads = [h for toks in segments for h in _command_heads(toks)]
    return any(h is None for h in heads) and not any(
        h is not None and _head_is_send(h, 0, ctx) for h in heads)


# Issue #1853, the heredoc form: the segmenter drops every heredoc BODY (it is data
# to the shell), but when the command that opens it is an interpreter
# (`python3 - <<'PY'`, `node <<EOF`) the body IS the program, and a send in it went
# unseen. The opening line is read up to its `<<`; when its last command word there
# is python/node-ish, the body is judged with the -c / -e code rule. A heuristic
# of the same naive class as the -c rule (see the boundary note above).
# NARROWED (Geri's #1855 review, a 14-day replay: 1 real catch, 17 false): inside a heredoc
# body the program is mostly PROSE that a script writes (an hourly report whose text held a
# card id with SENDMAIL in it, next to `subprocess`). So the exec + sender-literal half of the
# code rule takes the literal here only as a lowercase, QUOTED command word: a string that
# starts with sendmail/msmtp/swaks or ends a path in send.py, as an argv item or an os.system
# command is written. The real catch (`['python3', '.../send.py', '--to', ...]`) keeps it.
# Development heredocs that patch or test the gates, and mention `import send` in a string,
# still hit the module rule: that is the price of a naive rule, accepted.
# NOT COVERED, named so nobody counts them as covered: a program the classifier never reads --
# `python3 < /tmp/x.py`, `cat /tmp/x.py | python3 -`, and
# `python3 -c "exec(open('/tmp/x.py').read())"` (a file RUN as `python3 /tmp/x.py` is read since
# card a4ae5970, see _script_operands); also a here-string fed to an interpreter
# (`python3 <<<'import send'`) and a CommonJS destructuring rename of the Graph sender
# (`const { sendMail: s } = require(...)`).
# A heredoc fed to a SHELL (`bash <<EOF`, `sh -s <<EOF`) is a shell program: its body is
# judged with this classifier itself, one level deeper (Geri/Samu, #1855).
# WRITTEN, THEN RUN IN THE SAME COMMAND (Samu/Geri, #1855: two of the three real gate-passing
# sends in the sample had this shape): `cat > $S/x.py <<'EOF' ... EOF; python3 $S/x.py`. When a
# heredoc writes a file (`cat > P <<TAG` or `cat <<TAG > P`) and the same command runs an
# interpreter or a shell on the same path token P, the body is judged as if it had been fed to
# that program directly. The match is by the exact token: `./x.py` and `x.py` are different. A
# file written by one Bash call and run by ANOTHER stays out of reach (named above). Also NOT
# COVERED yet: a heredoc PIPED on to an interpreter or a shell (`cat <<'EOF' | bash`,
# `cat <<'EOF' | python3 -`) -- a follow-up to #1855.
_HEREDOC_SENDER_ARGV = re.compile(r"""['"](?:[^'"\s]*/)?(?:sendmail|msmtp|swaks|send\.py)(?=['"\s])""")


def _heredoc_body_sends(body: str) -> bool:
    if _CODE_SEND.search(body) or _CODE_SEND_MODULE.search(body) or _resend_mail_in_code(body):
        return True
    return bool(_CODE_EXECISH.search(body) and _HEREDOC_SENDER_ARGV.search(body))


# A PYTHON BODY IS JUDGED ON ITS CODE, NOT ON ITS STRINGS (card bc98d6d5): string-literal
# contents and comments blanked, fail-closed on a runner word, a script-path literal, an
# f/t-string or an open literal. Full note and the named cost: pythonCodeText in
# email-send-gate.mjs.
_PY_RUNNER = re.compile(
    r"\bsubprocess\b|os\.system|\bpopen\b|child_process|\bexec[A-Za-z]*\s*\(|\bspawn[A-Za-z]*\s*\("
    r"|\beval\s*\(|(?<![\w.])compile\s*\(|__import__|__builtins__|\bbuiltins\b|\bimportlib\b"
    r"|\brunpy\b|\bpickle\b|\bmarshal\b|\bcodecs\b",
    re.I,
)
_PY_SCRIPT_PATH_LIT = re.compile(r"""['"][^'"\n]*\.(?:py|sh|bash|zsh|js|mjs|cjs)['"]""", re.I)
_PY_STRING_PREFIX = re.compile(r"(?<!\w)[rRbBuUfFtT]{1,2}$")


def _python_code_text(body: str):
    """The body with string contents and comments blanked; None = judge it whole."""
    if _PY_RUNNER.search(body) or _PY_SCRIPT_PATH_LIT.search(body):
        return None
    out, i, n = [], 0, len(body)
    while i < n:
        ch = body[i]
        if ch == "#":
            nl = body.find("\n", i)
            i = n if nl < 0 else nl
            continue
        if ch in "'\"":
            pre = _PY_STRING_PREFIX.search("".join(out[-3:]))
            if pre and re.search(r"[fFtT]", pre.group(0)):
                return None
            q = ch * 3 if body.startswith(ch * 3, i) else ch
            j = i + len(q)
            while j < n and not body.startswith(q, j):
                if body[j] == "\\":
                    j += 2
                    continue
                if len(q) == 1 and body[j] == "\n":
                    return None
                j += 1
            if j >= n:
                return None
            out.append(q + q)
            i = j + len(q)
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _python_body_sends(body: str, quoted: bool) -> bool:
    # didi 55349: only a QUOTED delimiter (<<'X', <<"X", <<\X) hands Python the body as
    # written. Under <<X the shell first halves backslashes (and expands $, `), so the
    # raw text lexes to other strings than Python sees: `s = "\\\"; import resend; ...`
    # reads as one literal here and as a closed literal plus a real send to Python.
    # An unquoted body is judged whole. Twin: pythonBodySends.
    if not quoted or _resend_mail_in_code(body):  # the URL is judged on the raw body (5768a25d)
        return _heredoc_body_sends(body)
    code = _python_code_text(body)
    return _heredoc_body_sends(body if code is None else code)


# WHO READS THE HEREDOC (didi's K1, 6525aba3 50742; N1/N2, 50772): only the heredoc's OWN
# command, the text after the last ; & | of the innermost command context open at the <<,
# found by a quote-aware walk in which $( , ( and a backtick open a new command (inside
# double quotes too) and their closing returns to the outer one. Inside it, ANY word
# naming an interpreter or a shell makes the body a program, whatever launches it (an
# unknown launcher stays fail-closed; no second wrapper list). Full note and the named
# cost: heredocHeadKinds in email-send-gate.mjs.
_HEREDOC_READER_WORD = re.compile(
    r"""(?:^|[\s/'"`$(=;&|])(python3?(?:\.\d+)?|node|tsx|ts-node|deno|bun|sh|bash|zsh|dash)(?=$|[\s'"`);&|])""",
    re.I)


def _heredoc_own_command(head: str) -> str:
    s = head.replace("|&", "|")
    s = re.sub(r"\d*[<>]&\d*-?|&>>?|\d*>\|", " ", s)
    frames, start, q, i = [], 0, None, 0
    while i < len(s):
        ch = s[i]
        if q == "'":
            if ch == "'":
                q = None
        elif ch == "\\":
            i += 1
        elif ch == "$" and s[i + 1:i + 2] == "(":
            frames.append((start, q, ")"))
            start, q = i + 2, None
            i += 1
        elif ch == "`":
            if frames and frames[-1][2] == "`" and q is None:
                start, q, _ = frames.pop()
            else:
                frames.append((start, q, "`"))
                start, q = i + 1, None
        elif q == '"':
            if ch == '"':
                q = None
        elif ch in ("'", '"'):
            q = ch
        elif ch == "(":
            frames.append((start, q, ")"))
            start = i + 1
        elif ch == ")":
            if frames and frames[-1][2] == ")":
                start, q, _ = frames.pop()
        elif ch in ";&|\n":
            start = i + 1
        i += 1
    return s[start:]


# A reader word followed by a script FILE runs that file, and the heredoc is the script's stdin:
# data, not a program (`bash agent-msg.sh a b - <<'VEGE'`, the fleet's message form). Only an
# operand that is plainly a file counts (a / or a script extension); no operand, `-`, `-s`, or
# any other word keeps the reader, fail-closed. Twin: readerRunsScriptFile in email-send-gate.mjs.
_SCRIPT_FILE_OPERAND = re.compile(r"/|\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|mts|cts)$", re.I)


def _reader_runs_script_file(rest: str) -> bool:
    for raw in rest.split():
        t = re.sub(r"""^['"]+|['"]+$""", "", raw)
        if not t:
            continue
        if t == "-":
            return False
        if re.match(r"[-+]", t):
            continue
        if re.match(r"\d*[<>]", t):
            return False
        return bool(_SCRIPT_FILE_OPERAND.search(t))
    return False


def _heredoc_head_kinds(head: str):
    """(py, js, shell): every reader word counts, not the first (didi's F2, 6525aba3 50861),
    except one that runs a script file (the body is that script's stdin data).

    Twin: heredocHeadKinds in email-send-gate.mjs.
    """
    py = js = shell = False
    own = _heredoc_own_command(head)
    for m in _HEREDOC_READER_WORD.finditer(own):
        if _reader_runs_script_file(own[m.end():]):
            continue
        if _WRAPPER_SHELL.match(m.group(1)):
            shell = True
        elif _PYTHON.match(m.group(1)):
            py = True
        else:
            js = True
    return py, js, shell


# THE HEREDOC FORMS BASH RUNS (didi's K2, 6525aba3 50742): <<"EOF", <<\EOF, a - or . in the
# tag, a <<- body closed by a TAB-indented tag, an unterminated heredoc (body to the end).
# Used only where a body is judged as a program; _segments_tokens keeps _HEREDOC.
# Twin: heredocSpans in email-send-gate.mjs.
_HEREDOC_OPEN = re.compile(r"(?<!<)<<(?!<)(-?)[ \t]*(?:'([\w.-]+)'|\"([\w.-]+)\"|\\?([\w.-]+))[^\n]*", re.A)


def _heredoc_spans(cmd: str):
    """[(start, intro, body, end, quoted), ...] for every heredoc bash would read.
    quoted: the delimiter is quoted (<<'X', <<"X", <<\\X), so bash reads the body as written."""
    spans, pos = [], 0
    while True:
        m = _HEREDOC_OPEN.search(cmd, pos)
        if not m:
            return spans
        nl = m.end()
        if nl >= len(cmd):
            return spans  # no body line at all
        tag = m.group(2) or m.group(3) or m.group(4)
        term = re.compile(r"\n" + (r"\t*" if m.group(1) else "") + re.escape(tag) + r"(?=\s|$)")
        t = term.search(cmd, nl)
        quoted = m.group(4) is None or re.match(r"<<-?[ \t]*\\", m.group(0)) is not None
        spans.append((m.start(), m.group(0), cmd[nl + 1:t.start() + 1 if t else len(cmd)], t.end() if t else len(cmd), quoted))
        pos = t.end() if t else len(cmd)


# `cat > P <<TAG`, `cat <<TAG > P`, `cat <<TAG | tee P`, and a bare `tee P <<TAG` (didi).
_HEREDOC_REDIRECT = re.compile(
    r"(?:^|[\s;&|(])(?:cat\b[^\n]*?(?:>>?|\btee(?:\s+-a)?)|tee(?:\s+-a)?(?=\s))\s*(['\"]?)([^\s'\"<>;&|]+)\1"
)


def _written_then_run(cmd: str, written: dict, depth: int, ctx=None) -> bool:
    """A heredoc body written to a file that the same command then runs (see the note above)."""
    if not written:
        return False
    try:
        segments = _segments_tokens(cmd)
    except ValueError:
        return False
    for toks in segments:
        for head in _command_heads(toks):
            if not head:
                continue
            prog = _basename(head[0])
            args = [t for t in head[1:] if not t.startswith("-")]
            if prog.lower() == "npx" and args:
                args = args[1:]  # npx <runner> <file>
            if not args or args[0] not in written:
                continue
            body, quoted = written[args[0]]
            if _PYTHON.match(prog) and _python_body_sends(body, quoted):
                return True
            if _NODEISH.match(prog) and _heredoc_body_sends(body):
                return True
            if _WRAPPER_SHELL.match(prog) and depth < 3 and is_send_invocation(body, _depth=depth + 1, ctx=ctx):
                return True
    return False


def _heredoc_program_sends(cmd: str, depth: int = 0, gate=None) -> bool:
    written = {}
    # didi's F1 (6525aba3 50861): the walk gets everything before the <<, earlier heredoc
    # bodies cut out, not the opener's line alone. Twin: heredocProgramSends.
    ctx, frm = "", 0
    for start, intro, body, end, quoted in _heredoc_spans(cmd):
        head = cmd[cmd.rfind("\n", 0, start) + 1:start]
        w = _HEREDOC_REDIRECT.search(head + intro)
        if w:
            written[w.group(2)] = (body, quoted)
        ctx += cmd[frm:start]
        py, js, shell = _heredoc_head_kinds(ctx)
        if js and _heredoc_body_sends(body):
            return True
        if py and _python_body_sends(body, quoted):
            return True
        if shell and depth < 3 and is_send_invocation(body, _depth=depth + 1, ctx=gate):
            return True
        ctx += intro + "\n"
        frm = end
    return _written_then_run(cmd, written, depth, gate)


def is_send_invocation(cmd: str, _depth: int = 0, ctx=None) -> bool:
    """ctx: {"cwd", "files"}; cwd is where relative script paths resolve (the hook payload's
    cwd), files=False judges the command without reading any script file (card a4ae5970)."""
    ctx = ctx or _NO_CTX
    return _heredoc_program_sends(cmd, _depth, ctx) or _command_text_sends(cmd, _depth, ctx)


# The way out when a heredoc body read as a program is the WHOLE reason (marveen 50880,
# 6525aba3). Twin: heredocBodyHit / HEREDOC_BODY_WAY_OUT in email-send-gate.mjs.
# Running the script as a file is no longer one (card a4ae5970); the data-file way out is.
_DATA_FILE_WAY_OUT = (
    "Ha NEM kuldeni akartal (patch- vagy teszt-szkript): a kuldes-alaku SZOVEGET tedd adatfajlba "
    "(.json vagy .txt, a fajliro eszkozzel), es a szkript onnan olvassa be, vagy a celfajlt "
    "szerkeszd kozvetlenul a fajliro eszkozzel. A kapu a futtatott szkriptet olvassa, az adatfajlt nem."
)
_HEREDOC_BODY_WAY_OUT = (
    "A heredoc torzse kodnak olvasodik, es egy kuldo-szo all benne (akar egy sztringben is). "
    + _DATA_FILE_WAY_OUT
)
# Twin: SCRIPT_FILE_WAY_OUT / scriptFileHit in email-send-gate.mjs.
_SCRIPT_FILE_WAY_OUT = (
    "A futtatott szkriptfajl tartalma kodnak olvasodik, es egy kuldo-szo all benne (akar egy sztringben is). "
    + _DATA_FILE_WAY_OUT
)


def heredoc_body_hit(cmd: str, ctx=None) -> bool:
    ctx = ctx or _NO_CTX
    return _heredoc_program_sends(cmd, 0, ctx) and not _command_text_sends(cmd, 0, ctx)


def script_file_hit(cmd: str, ctx=None) -> bool:
    """A script file's content is the WHOLE reason: without reading files it is not a send."""
    ctx = ctx or _NO_CTX
    return is_send_invocation(cmd, ctx=ctx) and not is_send_invocation(cmd, ctx={**ctx, "files": False})


def _command_text_sends(cmd: str, _depth: int, ctx=None) -> bool:
    try:
        segments = _segments_tokens(cmd)
    except ValueError:
        # Parse-hiba (pl. lezaratlan idezojel): nem tudunk poziciot mondani.
        # Konzervativ visszaeses: csak akkor auditalunk, ha eros kuldes-literal
        # all a szovegben -- igy egy fura, de valodi kuldes nem csuszik at
        # neman, a tipikus belso parancsok viszont nem kapnak hamis pozitivot.
        #
        # EZ SZUKEBB, MINT A PARSZOLT UT, ES A TESTVER-KAPU (email-send-gate.mjs)
        # PONT AZ ELLENKEZOJET TESZI: az parse-hibanal a TELJES legacy keszletre
        # esik vissza ("never weaker"). A ket kapu ELTER, es ez DONTES, nem
        # elnezes -- didi merte 2026-09-06-an (kartya 9ebde77b), marveen dontott.
        # Aki egy cenzusban ezt elteresnek talalja: NE igazitsa ossze. Harom ok,
        # mindharom merve:
        #
        #   1. MAS POPULACIO. Az .mjs a SUB-AGENSEKET tiltja (kemeny deny,
        #      governance); ez a kapu a FO agens sajat kimeno szovegen fut.
        #   2. MAS AR. Ott egy hamis pozitiv egy fordulo a sub-agensnek. ITT a
        #      kapu is fail-closed, tehat egy hamis pozitiv MEGALLITJA a
        #      koordinator normal, csak-olvaso cenzus-munkajat.
        #   3. AMIT A SZUK LISTA ELEJT, AZ NEM KULDO. A repo EGYETLEN Bash-uton
        #      elerheto kuldoje a scripts/support-mail/send.py, es az BENNE VAN
        #      (`send.py` ES `smtplib`). Ami kimarad -- CSUPASZ `sendEmail`,
        #      `mail.send` --, az ebben a repoban CENZUS-GREP alak, nem kuldes.
        #      **A CSUPASZ SZO A KIKOTES, NEM A TOKEN** (kartya b6f78436): a
        #      HIVAS-alak (`sendEmail(`, `mail.send(`) 2026-09-06 ota RAJTA VAN a
        #      listan, mert az hasznalat, nem emlites -- ugyanaz a hatar, amit a
        #      parszolt ut es a kozos eset-korpusz mar hasznal. A csupasz alak
        #      tovabbra sem szerepel, es a `de5e1709` pin ezt orzi.
        #
        # ES AMIERT EZ OLCSO: a fo agens VALODI kuldesei (telegram __reply es a
        # send_email MCP tool) a fenti entrypointban KULON agra mennek, es soha
        # nem ernek ide -- tehat az akcentus-kockazat, amiert ez a kapu letezik,
        # nem ezen a fallbacken utazik. (Merve: az entrypoint-blokkban
        # is_send_invocation 1 elofordulas, a Bash agon.)
        return bool(_FALLBACK_LITERALS.search(cmd))
    ctx = ctx or _NO_CTX
    cwd, old_cwd = ctx["cwd"], None
    for toks in segments:
        if _segment_is_send(toks, _depth, ctx if cwd == ctx["cwd"] else {**ctx, "cwd": cwd}):
            return True
        nxt = _cwd_after(toks, cwd, old_cwd)
        if toks and toks[0] in ("cd", "pushd"):
            old_cwd = cwd
        cwd = nxt
    return _var_url_send(cmd, _depth)

# --- Hungarian detection (accent-insensitive markers) -----------------------
# These fire on both the correct and the stripped spelling, so a transliterated
# mail is still recognised as Hungarian -- that is the whole point.
HU_MARKERS = [
    "hogy", "nem", "vagy", "amit", "ami", "mert", "ezt", "ez a", "van", "lesz",
    "kell", "tehat", "tehát", "koszonom", "köszönöm", "szia", "sziasztok",
    "kerlek", "kérlek", "csatolva", "udvozlettel", "üdvözlettel", "levelet",
    "kuldom", "küldöm", "jelezz", "irj", "írj", "mar", "már", "csak",
]
# A puszta "level" 2026-08-26-an kikerult a markerek kozul. Magyar markerkent
# gyenge (a gyakori alak a "levelet", az mar bent van), viszont az ANGOL "level"
# minden elofordulasa magyar-pontot adott egy angol szovegnek, es igy indithatta
# el az ekezet-vizsgalatot olyan uzeneten, ami nem is magyar.

# Accentless spellings of frequent Hungarian words -> the correct form. Every
# entry is a word that CANNOT be spelled without its accent, so a hit inside
# Hungarian text is an error, not a style choice.
ACCENTLESS = {
    "es": "és", "tehat": "tehát", "koszonom": "köszönöm", "koszi": "köszi",
    "koszonjuk": "köszönjük", "kerlek": "kérlek", "kerem": "kérem",
    "kerjuk": "kérjük", "kerdes": "kérdés", "kerdesem": "kérdésem",
    "valasz": "válasz", "valaszt": "választ", "valaszol": "válaszol",
    # "levelet" NEM tartozik ide (2026-08-11, hamis pozitiv eles levelen):
    # a szotar invarianca az, hogy minden bejegyzes olyan szo, amit ekezet
    # NELKUL nem lehet leirni. A "levelet" (levél -> levelet) pont ilyen helyes
    # alak, ezert onmagara mutato bejegyzeskent allt itt, es minden korrekt
    # magyar levelet megblokkolt "levelet -> levelet" javaslattal. A "levelét"
    # (birtokos) ekezetlen alakja EGYBEESIK vele, tehat szabalykent nem is
    # eldontheto -- ezt a kapu nem tudja megfogni, es nem is szabad neki.
    "level": "levél", "levelre": "levélre",
    "elore": "előre", "elott": "előtt", "utan": "után", "kozott": "között",
    "kesz": "kész", "keszult": "készült", "keszen": "készen",
    "ervenyes": "érvényes", "ervenytelen": "érvénytelen",
    "telepito": "telepítő", "telepites": "telepítés", "telepiteni": "telepíteni",
    "ujra": "újra", "uj": "új", "ujat": "újat", "igy": "így", "ugy": "úgy",
    "tobb": "több", "tobbi": "többi", "kulon": "külön", "kuldom": "küldöm",
    "kuldtem": "küldtem", "kuldes": "küldés", "kuldunk": "küldünk",
    "fajl": "fájl", "fajlt": "fájlt", "fajlok": "fájlok",
    "hatarido": "határidő", "hataridot": "határidőt",
    "lehetoseg": "lehetőség", "lehetoseget": "lehetőséget",
    "szukseges": "szükséges", "szuksege": "szüksége",
    "mukodik": "működik", "mukodes": "működés", "muszaki": "műszaki",
    "beallitas": "beállítás", "beallitani": "beállítani",
    "elofizetes": "előfizetés", "elofizetest": "előfizetést",
    "szamla": "számla", "szamlat": "számlát", "szamlazas": "számlázás",
    "arajanlat": "árajánlat", "ar": "ár", "arak": "árak",
    "ora": "óra", "orakor": "órakor", "ev": "év", "evi": "évi",
    "honap": "hónap", "het": "hét", "hetfo": "hétfő", "csutortok": "csütörtök",
    "pentek": "péntek", "januar": "január", "februar": "február",
    "marcius": "március", "aprilis": "április", "majus": "május",
    "junius": "június", "julius": "július", "oktober": "október",
    "ket": "két", "harom": "három", "negy": "négy", "ot": "öt",
    "szivesen": "szívesen", "erteket": "értéket", "ertem": "értem",
    "jol": "jól", "rovid": "rövid", "hosszu": "hosszú", "biztonsagos": "biztonságos",
    # "megnyitni" ugyanaz a hibaosztaly, mint a fenti "levelet": onmagara mutato
    # bejegyzes egy olyan szonal, ami ekezet nelkul is helyes. Kiveve 2026-08-11,
    # MIELOTT eles levelen elsult volna.
    "eleresi": "elérési", "elerheto": "elérhető",
    "sajat": "saját", "tovabbi": "további", "tovabb": "tovább",
    "figyelmeztetes": "figyelmeztetés", "ellenorizd": "ellenőrizd",
    "ellenorzes": "ellenőrzés", "reszletek": "részletek", "resz": "rész",
    "vegen": "végén", "vegre": "végre", "elinditja": "elindítja",
    "inditas": "indítás", "masold": "másold", "masolat": "másolat",
    "gepre": "gépre", "gep": "gép", "gepen": "gépen",
    "ervenyesites": "érvényesítés", "aktivalas": "aktiválás",
    "hozzajarulas": "hozzájárulás", "elofordul": "előfordul",
    # +48 bejegyzes 2026-08-13 (EKEZETLISTA812, Szabi GO: "Vedd"). A jeloltek a
    # sajat magyar szovegeinkbol jottek (69 fajl, 60 gyakori ekezetes szo, amit a
    # lista addig nem fogott); a szures KET lepcsos volt: lokalis modell (Muse
    # Glimmer 30B) itelete + sajat felulvizsgalat. SZANDEKOSAN KIMARADT, mert az
    # ekezetlen alak onmagaban is letezo magyar szo: mar (marni), meg (igekoto),
    # kor (eletkor/korszak), fonok (fonni), var (a seb varja), kod (kod ES kod),
    # hozza, meres, lepes, szamlazz, jon, tovabbra. Az "all" -> "áll" TUDATOS
    # kivetel: nem magyar szo, de gyakori ANGOL szo; a kapu csak magyarnak mert
    # szovegen fut, ezert Szabi vallalta a kockazatot.
    "elso": "első", "ezert": "ezért", "valodi": "valódi",
    "nelkul": "nélkül", "miert": "miért", "utana": "utána",
    "kovetkezo": "következő", "szekcio": "szekció", "tenyleg": "tényleg",
    "videot": "videót", "video": "videó", "azert": "azért",
    "hivas": "hívás", "szam": "szám", "szoveg": "szöveg",
    "mas": "más", "kulso": "külső", "dontes": "döntés",
    "letezik": "létezik", "kozvetlenul": "közvetlenül", "felhasznalo": "felhasználó",
    "nema": "néma", "verzio": "verzió", "erdemes": "érdemes",
    "irja": "írja", "mostantol": "mostantól", "latszik": "látszik",
    "szoval": "szóval", "kozos": "közös", "netto": "nettó",
    "cim": "cím", "futo": "futó", "javitas": "javítás",
    "kockazat": "kockázat", "ebbol": "ebből", "mindket": "mindkét",
    "eleg": "elég", "regi": "régi", "kulonbozo": "különböző",
    "kezzel": "kézzel", "peldaul": "például", "izolalt": "izolált",
    "kozben": "közben", "udvozlettel": "üdvözlettel", "oket": "őket",
    "afa": "áfa", "allapot": "állapot", "all": "áll",
}

# GATEHOMOGLIF816 (2026-08-16, Marveen merese): 33 cirill homoglifa ult a
# memoria-sorokban es kartya-cimekben -- olvasva lathatatlan, de a grep/FTS
# nema nulla-talalatot ad, ami hianyzo emleknek latszik, nem serult adatnak.
# A szabaly a VEGYES SZORA vonatkozik (egy szon belul latin ES nem-latin betu),
# nem a cirill puszta jelenletere -- egy szandekosan idegen nyelvu idezet
# tiszta nem-latin szavai atmennek. Unicode-tudatos tokenizalas kell: a WORD
# regex latin-only, egy homoglifas szot darabokra vagna.
# THE RULE ITSELF LIVES IN scripts/lib/mixed_script.py, and is imported, not
# copied. Measured 2026-09-24 (review of #1541): the inter-agent send gate had
# re-implemented it as "any Cyrillic or Greek letter" and refused a plain
# Russian quote and a standalone Greek symbol, both of which THIS path passes.
# Two gates disagreeing about what is legitimate teach the sender that the rule
# depends on which script they called. One source, so they cannot drift.
#
# AND THE #1548 EXCEPTION MOVED WITH IT. SCRIPT_NEUTRAL (HOMOGLYPHMICRO924:
# the micro sign, superscripts and subscripts, so "40 µs", "100 m²" and
# "H₂O" are not mixed-script words) lived in THIS file until the extraction.
# It now lives in the shared module, so both paths get it -- before, only
# this one did. It is imported here too, so an importer of this module keeps
# seeing the name. This is the exception a rebase silently drops if only the
# hook-side conflict is resolved, which is why the test suite measures
# "40 µs" and "H₂O" on BOTH paths rather than trusting a green rebase.
#
# GUARDED, for the same reason as the email_extract import below, and measured
# the same way: a bare ImportError fires during MODULE LOAD, escapes the
# __main__ net and exits 1 -- and PreToolUse reads 1 as NON-blocking, so the
# send would run UNCHECKED. That is the one outcome a gate must never have.
# scripts/__tests__/email-extract-parity.test.py copies this file to a
# directory where neither module resolves and requires exit 2; before this
# guard the extraction turned that case from BLOCKED into a crash.
#
# The stub does NOT invent a fallback rule. A gate that cannot load its rule
# has no verdict, and "no verdict" here means BLOCK, not pass: the call sites
# turn MixedScriptUnavailable into a refusal that says the rule could not be
# loaded, instead of a homoglyph finding that was never measured.
class MixedScriptUnavailable(RuntimeError):
    """The shared mixed-script rule could not be imported."""


try:
    sys.path.insert(0, os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
    from mixed_script import (  # noqa: E402
        UWORD, SCRIPT_NEUTRAL, char_script, mixed_script_words,
    )
except Exception as _mixed_exc:  # noqa: BLE001 -- deliberate fail-closed stub
    _MIXED_ERR = repr(_mixed_exc)
    UWORD = re.compile(r"[^\W\d_]+", re.UNICODE)
    SCRIPT_NEUTRAL = frozenset()

    def char_script(ch: str) -> str:
        return "UNKNOWN"

    def mixed_script_words(text: str):
        raise MixedScriptUnavailable(_MIXED_ERR)

_char_script = char_script   # the name this file used before the extraction


# --- FOREIGNLETTER924 (card c61d5270): a letter from the right script, but the wrong one --
# The two checks above cover DECOMPOSITION (base + combining mark) and SUBSTITUTION (a
# foreign-script letter inside a Latin word). deeper measured a third class on 2026-09-24
# that passes both: `fordìtott` with U+00EC (i WITH GRAVE) where Hungarian has U+00ED
# (i WITH ACUTE). The name of U+00EC starts with LATIN, so mixed_script_words cannot fire
# on it BY CONSTRUCTION (friday, measured: specimen 0 hits, Cyrillic U+0456 control 1 hit).
# An accent-DIRECTION slip is the likeliest shape of this class, and the word still looks
# accented, which is why it survives.
#
# THE RULE: a non-ASCII LETTER (Unicode category L*) that is not one of the eighteen
# Hungarian accented letters, plus U+FFFD (the decoder's replacement mark, a corruption
# signal that is not a letter). It WARNS, it never blocks (marveen, 2026-09-24): c-caron,
# s-caron, d-bar, z-caron are real letters in real names, the owner's contacts are in
# Serbia, and a block would refuse correct text about actual customers.
#
# WHY LETTERS AND NOT A WHOLE-CHARACTER ALLOWLIST, measured before building:
#   whole-character allowlist, last 30 days of owner-facing Telegram (n=857): 7.4% of
#     messages flagged, almost all emoji (U+1F916 alone in 37) -- a warning on most
#     briefings, which trains the reader to skip it.
#   letters only, same population: 1.6%; inter-agent 7 days (n=1801): 0.9%. Its hits
#     include a real slip (a Cyrillic ie inside a Hungarian word) and real names
#     (Jalapeno with n-tilde, Markovic with c-acute, Serbian "sasije").
# A symbol cannot be the mis-spelling of a letter, which is the same reason the class
# never needed an entry for punctuation.
#
# THE HUNGARIAN QUOTES, AND WHICH HALF IS A MEASUREMENT: U+201E (opening) was MEASURED,
# 13 of 200 inter-agent messages; U+201D (closing) was DECIDED, 0 of 200, admitted because
# Hungarian uses the pair and allowing only the opener would alarm on every closed quote.
# Under the letters-only rule neither is a letter, so neither can fire -- the decision is
# kept here so that a future widening to symbols does not silently re-decide it. The inner
# pair (U+00BB / U+00AB) was NOT decided either way.
#
# THE SET MAY ONLY GROW BY DECISION (deeper's asymmetry): a letter MISSING from it is a false
# alarm, a letter ADDED to it lets a real defect through. It prints the CHARACTERS, never a
# bare count: deeper's own first set held six uppercase letters where Hungarian has nine,
# and only the printed characters showed five correct words among the "hits".
#
# TWO LIMITS, stated where the next check will be added:
#  (1) IT IS BLIND TO SPELLING. `kezbesít` for `kézbesít` (deeper, same day: a MISSING
#      accent, all legitimate codepoints) is green here and on every other codepoint check.
#      Its claim is WRONG CODEPOINTS, not correct Hungarian.
#  (2) ON THE INTER-AGENT PATH IT INHERITS THE FAIL-OPEN BRANCH: an uninterpretable body
#      (unreadable @file, unresolved $-path, run-time substitution, non-JSON) passes with
#      a systemMessage to the SENDER and a gate-log line, and then no check runs at all --
#      this one included. Upstream's replay: 38 of 1157 = 3.3%. The sender is the only
#      witness.
HU_ACCENTED_LETTERS = frozenset("áéíóöőúüűÁÉÍÓÖŐÚÜŰ")
CORRUPTION_MARKS = frozenset("\ufffd")


def foreign_letter_words(text: str):
    """[(token, char, "NAME (U+XXXX)"), ...], one entry per distinct (token, char)."""
    import unicodedata
    out, seen = [], set()
    for tok in text.split():
        for ch in tok:
            if ord(ch) < 128 or ch in HU_ACCENTED_LETTERS:
                continue
            if not (unicodedata.category(ch).startswith("L") or ch in CORRUPTION_MARKS):
                continue
            key = (tok, ch)
            if key in seen:
                continue
            seen.add(key)
            out.append((tok.strip(".,;:!?()[]{}\"'`"), ch,
                        f"{unicodedata.name(ch, 'UNKNOWN')} (U+{ord(ch):04X})"))
    return out


def foreign_letter_warning(text: str):
    """The named warning text, or None. Never a block (see above)."""
    hits = foreign_letter_words(text)
    if not hits:
        return None
    shown = "; ".join(f"{w!r} -- benne {name}" for w, _c, name in hits[:5])
    more = f" (+{len(hits) - 5} tovabbi)" if len(hits) > 5 else ""
    return ("outgoing-copy-gate FIGYELMEZTETES (nem tiltas): NEM MAGYAR BETU, "
            f"{len(hits)} db: {shown}{more}. Ha nev (pl. szerb), rendben van; ha elgepeles "
            "(pl. i-grave az i-ekezetes helyett), javitsd. A kapu helyesirast NEM ellenoriz.")


def emit_system_messages(msgs) -> None:
    """One hook stdout JSON for every non-blocking message of this call."""
    msgs = [m for m in msgs if m]
    if msgs:
        print(json.dumps({"systemMessage": "\n".join(msgs)}))


EM_DASH = "—"

# GATEPERSIST816: owner-specific NAME rules load from an UNTRACKED local file,
# not from this (public-repo) script. The generic checks (accents, em dash,
# double hyphen, mixed-script) are universal Hungarian-copy QA and ship in the
# repo; a personal-name rule names a private third party, and that must not be
# published as a side effect of persisting the gate. A missing rules file is
# NOT silent: every run appends a loud line to the gate log, because a
# protection whose absence is invisible only protects until someone touches
# the tree. File shape: {"bad_name_patterns": ["<python-regex>", ...]}
_LOCAL_RULES = os.environ.get(
    "OUTGOING_COPY_GATE_RULES",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                 "store", "outgoing-copy-gate-rules.json"),
)

_GATE_LOG = os.path.join(os.path.dirname(_LOCAL_RULES), "outgoing-copy-gate.log")


def _gate_log(message: str) -> None:
    """Append one TIMESTAMPED line to the gate log.

    The log used to carry bare text. Measured 2026-09-05: 8005 lines, four
    distinct messages, and one of them recorded a FAIL-OPEN pass-through on the
    Telegram branch -- a message that went out unaudited -- with no way to tell
    which day it happened on, let alone which message it was. A gate log whose
    entries cannot be placed in time cannot be used to check anything. Local
    time with the offset, never UTC.
    """
    try:
        from datetime import datetime
        stamp = datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
        with open(_GATE_LOG, "a", encoding="utf-8") as fh:
            fh.write(f"{stamp} {message.rstrip()}\n")
    except OSError:
        pass


# CLCOPYGATEHIANY902 (owner decision, TG 14442) MERGED WITH GATEPERSIST816/3
# (PDB install, 2026-08-19). Two independent fixes to the same question, from
# opposite directions, so the merged policy has FIVE states:
#
#   "ok"         -> patterns loaded, the name check enforces as before.
#   "sanctioned" -> the file EXISTS and explicitly says "no_name_rule": true.
#                   Reported by the PDB install, 2026-08-19: their rules file
#                   was lost with no backup, and the owner decided not to
#                   reconstruct it. That is a taken decision, not a loss, and
#                   an install that has made it should not be nagged about it
#                   on every send. So this state is silent
#                   EVERYWHERE: no log line, no systemMessage, no block. Note
#                   the early return BELOW, which deliberately skips the
#                   logging tail. An ordinary empty list WITHOUT the flag does
#                   NOT reach this state, so a file emptied by accident can
#                   never masquerade as the sanctioned one.
#   "empty"      -> no patterns and no flag: the check is OFF.
#   "missing"    -> file absent, which is EVERY fresh customer install, since
#                   the file names a private person and is deliberately not
#                   shipped. Both of these fail-OPEN with a LOUD, user-visible
#                   warning on every send: the old fail-closed email path left
#                   a paying customer unable to send mail at all (Nova,
#                   2026-09-02).
#   "invalid"    -> the file EXISTS but cannot be used (bad JSON, wrong schema,
#                   uncompilable regex). Somebody TRIED to configure it and got
#                   it wrong: the email path stays fail-CLOSED until repaired.
#
# WHY THE MERGE IS NOT A CHOICE BETWEEN THE TWO: without the sanctioned state,
# a live rules file carrying the flag with an empty pattern list reads as
# "empty", and a loud warning gets stamped on EVERY outgoing letter, customer
# mail included. Without the missing/empty/invalid split, a fresh install with
# no file at all cannot send mail at all. Each half is wrong exactly where the
# other one is right, which is why both are here.
RULES_OK = "ok"
RULES_SANCTIONED = "sanctioned"
RULES_EMPTY = "empty"
RULES_MISSING = "missing"
RULES_INVALID = "invalid"

# The states where the name check does not run AND that is not a taken
# decision: the ones that must stay loud.
RULES_LOUD = (RULES_MISSING, RULES_EMPTY, RULES_INVALID)


# A NAME PATTERN THAT MATCHES ORDINARY TEXT MATCHES EVERY MESSAGE (card 3c753513).
# audit() reports any hit of BAD_NAME.search(), so one over-broad line in the rules file makes
# every Telegram reply a FOUND problem (rc 2, where the fail-open for internal errors does not
# apply) -- on all eight sessions once the gate is wired into the sub-agents.
# The first version (didi 18748) rejected only ZERO-WIDTH patterns ("" / ".*" / "x?" / "\b").
# didi then showed "." "\w" "e" "[a-z]" still block every clean reply (comment 22): that fix
# closed an instance, not the class. The class is "matches text that names nobody", so the test
# is exactly that (marveen 02:3x): a pattern is INVALID if it matches a NEUTRAL sentence. The
# sentences hold no proper name on purpose -- a real rule targets a name, and a probe that
# contained one would reject a legitimate rule. The empty string stays in for patterns that match
# only an empty message ("^$").
_NEUTRAL_PROBES = (
    "Rendben, köszönöm szépen, holnap küldöm a részleteket.",
    "Ok, thanks, I will send the details tomorrow.",
    "12:30-kor jó lesz, a dokumentum a mappában van.",
)
_INVALID_REASON = ""


def _too_broad_index(compiled):
    """Index of the first pattern that matches a neutral sentence or only-empty text, or None."""
    for i, rx in enumerate(compiled):
        if rx.search("") is not None or any(rx.search(p) is not None for p in _NEUTRAL_PROBES):
            return i
    return None


def load_bad_name():
    """Return (compiled_regex_or_None, state) -- see the RULES_* names above."""
    global _INVALID_REASON
    try:
        with open(_LOCAL_RULES, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            state = RULES_INVALID
        else:
            pats = data.get("bad_name_patterns") or []
            if not isinstance(pats, list) or not all(isinstance(x, str) for x in pats):
                state = RULES_INVALID
            elif pats:
                # the pattern's INDEX, never its text: a name rule names a private person
                zw = _too_broad_index([re.compile(x) for x in pats])
                if zw is None:
                    return (re.compile("|".join(pats)), RULES_OK)
                _INVALID_REASON = (f"a(z) {zw + 1}. minta egy SEMLEGES, nevet nem tartalmazo mondatra "
                                   "is illeszkedik (pl. \".\", \"\\w\", \"e\", \"[a-z]\", \".*\"), "
                                   "ami MINDEN uzenetet elkapna")
                state = RULES_INVALID
            elif data.get("no_name_rule") is True or data.get("name_check_disabled") is True:
                # Returns HERE, before the logging tail, on purpose: a taken
                # decision must not write a "the protection is gone" line into
                # the ledger on every single run. An alarm that can never be
                # answered is the one people learn to ignore -- it was drowning
                # the real signals in the same log (571 lines here by
                # 2026-09-04, CLCOPYGATEDONTES904).
                # TWO spellings of the SAME decision are accepted, because two
                # installs each documented one before the branches met:
                #   {"no_name_rule": true, "no_name_rule_reason": "why"}
                #     (GATEPERSIST816/3, the PDB install)
                #   {"bad_name_patterns": [], "name_check_disabled": true,
                #    "decided_at": "2026-09-04", "note": "why"}
                #     (CLCOPYGATEDONTES904)
                # Dropping either spelling would silently turn that install's
                # recorded decision back into a loud "empty".
                return (None, RULES_SANCTIONED)
            else:
                state = RULES_EMPTY
    except FileNotFoundError:
        state = RULES_MISSING
    except Exception:
        # Present but unusable: unreadable (permissions), unparseable JSON,
        # or an uncompilable pattern. All of these mean someone TRIED to
        # configure the rule and failed -- that must stay loud AND closed.
        state = RULES_INVALID
    # ONE logging tail for EVERY loud state (Marveen review on #1156: the
    # first cut logged only the exception branches, so empty/schema-invalid
    # left no log line while missing did -- same event class, inconsistent
    # ledger).
    _gate_log(f"outgoing-copy-gate: NEV-SZABALY {state.upper()} ({_LOCAL_RULES}) -- "
              "a nev-ellenorzes NEM fut." + (f" Ok: {_INVALID_REASON}." if _INVALID_REASON else ""))
    return (None, state)


def _name_correction() -> str:
    try:
        with open(_LOCAL_RULES, encoding="utf-8") as fh:
            corr = json.load(fh).get("correction") or ""
        return (" " + corr) if corr else ""
    except Exception:
        return ""


BAD_NAME, RULES_STATE = load_bad_name()
ACCENTED = set("áéíóöőúüűÁÉÍÓÖŐÚÜŰ")
TAG = re.compile(r"<[^>]+>")

# GATEKOTOJEL817 + GATEHYPH816 (2026-08-19 este, ket hamis pozitiv elo
# gazda-beszelgetesben, ot perc alatt): a kapu nem tett kulonbseget PROZA es
# AZONOSITO kozott. (1) `Drive-ot` -- az idegen tulajdonnevhez a magyar
# toldalek kotojellel kapcsolodik (ez a HELYES iras), de a betu-only WORD
# tokenizalo a kotojelnel vagott, es a maradek `ot` darabot onallo magyar
# szonak nezte (ot -> öt). (2) `Video atalakitas` -- egy Drive-mappa NEVE a
# szovegben: mondatkozi nagybetus szo, azonosito, nem proza. A javitas a
# TOKENIZALAS, nem a szotar (szo-kivetel a valodi hibakat is atengedne):
#   - kotojeles alaknal a TELJES szoalak vizsgalando (a `drive-ot` egeszkent
#     nincs a szotarban -> atmegy; az onallo `ot` prozaban tovabbra is bukik);
#   - a MONDATKOZI nagybetus szo azonosito/tulajdonnev -> kimarad; mondat
#     elejen (. ! ? : ujsor vagy lista-jel utan) a nagybetu normal proza,
#     ott tovabbra is vizsgaljuk.
# ADC93F84 (2026-08-28): a fenti tokenizalas-javitas a BETUVEL kezdodo alakra
# terjedt ki, a SZAMMAL kezdodore nem -- pedig magyarban a szam utani toldalek
# ugyanugy kotojellel kapcsolodik, es ugyanugy HELYES iras. Merve: `Drive-ot`
# atment, `176-ot` es `19-es` ELBUKOTT (ot -> öt, es -> és), mert a betu-only
# minta a kotojelnel vagott es a maradek toredeket onallo szonak nezte.
#
# ES A JAVASLATA HIBAS MAGYART ADOTT: a `176-öt` es a `19-és` rossz. Ez a kapu
# epp azert letezik, mert egy ekezet nelkuli level kiment egy ugyfelnek -- egy
# ROSSZ ekezetet javaslo kapu a sajat celjat asa ala. Aki szo szerint koveti,
# javit egy valodi hibat es BEVEZET egy ujat.
#
# A masodik ag SZANDEKOSAN kotelezove teszi a kotojelet (`+`, nem `*`): egy
# csupasz szam NEM lesz token, tehat a szamokra vonatkozo mai viselkedes nem
# valtozik. Az `5-os` eddig is atment, de VELETLENUL -- az `os` nincs a
# szotarban --; mostantol azert megy at, amiert a `Drive-ot`: egeszkent nezzuk.
#
# 93CC58FC (2026-09-25): the letter class was HUNGARIAN-ONLY (`a-záéíóöőúüű...`), so a
# foreign letter CUT a word in two and the fragment was audited as a standalone
# Hungarian word. Measured live: "Nimčević" -> ['Nim', 'evi'], and "evi" is the
# accent-stripped "évi" -> exit 2 on a correct Telegram report about a customer.
# deeper: every -ević surname trips it (Nimčević, Nišević, Kovačević, Đorđević).
# The fix is the TOKENIZER, not a surname allowlist (a name census never closes):
# any Unicode letter is a word character, so a foreign name is ONE token and is
# never in ACCENTLESS. `[^\W\d_]` = a letter; `[^\W_]` = a letter or a digit.
# Script mixing is not this regex's job: mixed_script_words tokenizes with UWORD.
HYPHEN_WORD = re.compile(
    r"[^\W\d_]+(?:-[^\W_]+)*"
    r"|[0-9]+(?:-[^\W_]+)+"
)


def _at_sentence_start(text: str, idx: int) -> bool:
    i = idx - 1
    while i >= 0 and text[i] in " \t\"'([{":
        i -= 1
    if i < 0:
        return True
    ch = text[i]
    if ch in ".!?:\n":
        return True
    if ch in "-*•":
        j = i - 1
        while j >= 0 and text[j] in " \t":
            j -= 1
        return j < 0 or text[j] == "\n"
    return False


def accent_check_tokens(prose: str):
    """(lowercase alak, kezdo-pozicio) parok az ekezet-vizsgalathoz."""
    out = []
    for m in HYPHEN_WORD.finditer(prose):
        tok = m.group(0)
        # DIGIT-HYPHEN SUFFIX (429-es, 403-as, 2026-os, 3420-as). HYPHEN_WORD only
        # admits LETTERS around the hyphen, so a Hungarian suffix attached to a
        # NUMBER is seen as a standalone word -- and "es" is then read as the
        # accent-stripped "és". These are not prose words; they carry no accent.
        # (2026-08-21: the gate blocked a correct message reading "429-es vagy
        # 403-as". GATEKOTOJEL817 covered letter-hyphen-letter forms, not this one.)
        if m.start() >= 2 and prose[m.start() - 1] == "-" and prose[m.start() - 2].isdigit():
            continue
        if "-" not in tok and tok[0].isupper() and not _at_sentence_start(prose, m.start()):
            continue
        out.append((tok.lower(), m.start()))
    return out


def _hit_context(prose: str, pos: int, length: int) -> str:
    """A talalat elotti/utani 3-3 szo + karakter-pozicio (GATEHYPH816 (B):
    elo beszelgetes kozben ne kelljen greppelni, melyik szorol van szo)."""
    before = prose[:pos].split()[-3:]
    token = prose[pos:pos + length]
    after = prose[pos + length:].split()[:3]
    frag = " ".join(before + [token] + after)
    return f'"...{frag}..." @{pos}'


# Technikai tokenek maszkolasa AZ EKEZET-ELLENORZES ELOTT. Merve 2026-08-13, a
# +48-as bovites negativ kontrolljan: egy HIBATLANUL ekezetezett eles level
# fennakadt a `video_view` esemenynevben levo "video"-n. A szobonto az aláhúzást
# hataroljelnek veszi, tehat minden snake_case azonosito, fajlnev, URL-slug es
# domain beszallit egy "magyar szot", ami ott ekezet nelkul HELYES. Ugyanaz az
# osztaly, mint a 2026-08-11-i `level` fajlnev-talalat. Ugyanide tartozik a
# 2026-08-25-i talalat ugyanebbol az osztalybol: a TULAJDONNEV + kotojeles toldalek
# ("Chrome-ot", "Drive-ra") is puszta "ot"/"ra" tokenre esik szet, es az "ot" benne
# van a szotarban (-> "ot"). Ezert a maszk a nagybetuvel kezdodo tovet is elfogadja,
# de CSAK ha a kotojel utan legfeljebb negy kisbetu all: egy valodi magyar osszetett
# szo masodik tagja ("Telegram-hidam") tipikusan hosszabb, tehat az tovabbra is fennakad.
# 2026-08-26-i talalat, HARMADIK a sorozatban, de mas alosztaly: nem toldalek volt,
# hanem egy ANGOL SZO, ami veletlenul egy ekezetes magyar szo ekezetlen alakja.
# A "level 1" (autonomia-szint) alak a szotarban "level -> level" javaslatot valtott ki,
# es ketszer blokkolta a reggeli uzenetet. A szotarbol NEM vettem ki a bejegyzest, mert
# a magyar "level" tenyleg hibas alak; a maszk csak a SZAM ELOTTI angol hasznalatot vagja ki.
# Ami igy is fennakad: az idezojelbe tett, magarol beszelo "level" szo. Arra a kod-span
# (backtick) a kijarat, az ugyanis maszkolva van.
# 2026-08-27, NEGYEDIK a sorozatban: a KOTOJELES KISBETUS AZONOSITO. Az utemezett
# feladatok es skillek nevei (folyamatos-ellenorzes, mentes-lemaradas-ellenorzes,
# kontextus-atadas-visszaallitas) ekezet nelkuli magyar szavakbol allnak, mert fajl- es
# mappanevek. A szotar ezeket valodi talalatnak latja, pedig AZONOSITOK, nem proza --
# a gazdanak pont igy, betuhiven kell leirni oket, kulonben nem talalja meg a gepen.
# A maszk ezert kivagja a legalabb ket tagu, csupa kisbetus, kotojellel osszekotott
# alakokat. Egy valodi magyar mondat nem all ilyen alakbol, es a NAGYBETUS kezdetu
# osszetetelekre (Chrome-ot) mar van kulon, szigorubb szabaly folotte.
# 2026-08-24-i talalat: a szambol es kotojeles magyar toldalekbol allo alak
# ("8:09-es", "2-es", "17:06-kor") a szobontonal puszta "es"/"kor" tokenne esik
# szet, amit a szotar hibanak lat -- pedig ott toldalek, nem szo. A javitas nem a szotarbol
# vesz ki (az elrontana a valodi talalatokat is), hanem a technikai regiokat
# vagja ki a vizsgalt szovegbol. A gondolatjel-ellenorzes NEM ezen fut (az a nyers
# szovegen mer), a nev-ellenorzes pedig a SAJAT, szukebb maszkjan -- lasd NAME_MASK.
#
# GATENEVSTRIP921 (kulso bejelentes 2026-09-21, sajat visszameres 2026-09-22):
# KET SZABALY, AMI UGYANARRA A SZOVEGRE NEZ, NEM UGYANAZT A MASZKOT AKARJA.
# A bejelentes az volt, hogy a nev-szabaly a NYERS szovegen fut, ezert URL-ben,
# kod-spanban vagy utvonalban allo nevalak is megallitja a teljes uzenetet
# (harom ilyen hamis pozitiv reprodukalva). A kezenfekvo javitas -- a nev-szabaly
# athelyezese a strip_technical UTANRA -- viszont LYUKAT NYIT, mert az alabbi ket
# alternativa a NEVET magat vagja ki a szovegbol a toldalekaval egyutt:
#   "Nev-val" / "Nev-nak" / "Nev-fele"  ->  a tulajdonnev+toldalek ag eszi meg
# Merve a sajat mintankon (kartya-komment 17237): harom prozai alakbol harom tunt
# el a strip utan, vagyis csendben ATMENTEK volna. Ezert a nev-szabaly a kozos,
# egyertelmuen technikai regiokat kapja meg maszknak (_TECH_COMMON), a toldalek-
# es azonosito-agakat NEM. Ezek az agak a token- es ekezet-vizsgalatnak kellenek,
# ahol epp az a dolguk, hogy a toldalek-toredeket ne nezzek onallo szonak.
#
# A KET MASZK EGY FORRASBOL EPUL, hogy ne drifteljenek szet: ha valaki uj
# technikai regiot vesz fel, a _TECH_COMMON-ba irva MINDKET ellenorzes latja.
# A CLI-KAPCSOLO AG KULON CSOPORT (88c366f2 merge, P7; marveen 2026-09-28): a "--"-hoz
# ragasztott nevet ("--Nev", "--Nev-mod") a kapcsolo-ag a nevvel egyutt kivagna, es a
# nev-szabaly nem latna. A DUPLA KOTOJEL szabalynak viszont kell (card 3973a0c7), ezert csak
# a TECHNICAL kapja meg, a NAME_MASK nem -- ugyanugy, mint a _TECH_SUFFIXED agakat.
_TECH_FLAG = r"""
        (?<![\w-])--[A-Za-z][\w-]*(?:=\S*)?   # CLI kapcsolo (--env-file, --x=y), a KET KOTOJELLEL
                                    # EGYUTT: kulonben a kotojeles-azonosito ag a betutol vag, es
                                    # a "--" arvan marad szokozok kozott -> hamis DUPLA KOTOJEL
                                    # (card 3973a0c7). Prozai " -- " utan szokoz all, nem betu.
"""
_TECH_COMMON = r"""
        https?://\S+                # URL
      | [\w.+-]+@[\w-]+\.[\w.]+     # email
      | `[^`]*`                     # kod-span
      | \b\w+(?:_\w+)+\b            # snake_case azonosito
      | \b\w+\.[A-Za-z]{2,10}(?:-[a-záéíóöőúüű]{1,4})?\b   # fajlnev / domain, magyar toldalekkal (video.mp4, marveen.io, Mail.app-ot)
      | \b[\w-]*/[\w/-]+            # utvonal / slug
"""
# CSAK a token-/ekezet-vizsgalat vaghatja ki ezeket: mindharom ag kepes egy
# tulajdonnevet a toldalekaval egyutt elnyelni, ezert a nev-szabaly nem kapja meg.
_TECH_SUFFIXED = r"""
        \d+(?:[.:,]\d+)*-[^\W\d_]+   # szam + magyar toldalek (8:09-es, 2-es, 17:06-kor)
      | \b[A-ZÁÉÍÓÖŐÚÜŰ][^\W\d_]*-[a-záéíóöőúüű]{1,4}\b   # tulajdonnev + toldalek (Chrome-ot, Drive-ra)
      | \blevel\s+\d+\b            # angol "level 1" (autonomia-szint, log-szint)
      | \b[a-z]+(?:-[a-z]+){1,4}\b    # kotojeles kisbetus azonosito (feladat- es skill-nevek)
"""
TECHNICAL = re.compile(_TECH_FLAG + "|" + _TECH_COMMON + "|" + _TECH_SUFFIXED, re.X)
NAME_MASK = re.compile(_TECH_COMMON, re.X)


def strip_technical(text: str) -> str:
    return TECHNICAL.sub(" ", text)


def strip_for_name(text: str) -> str:
    """A nev-ellenorzes maszkja: csak az egyertelmuen technikai regiok esnek ki."""
    return NAME_MASK.sub(" ", text)


def is_hungarian(text: str) -> bool:
    low = text.lower()
    return sum(1 for m in HU_MARKERS if m in low) >= 3


# GATETG816 (2026-08-16, Marveen merese): az is_hungarian() funkcionalis szavakra
# szur, ezert a TOMOR, tenykozol, felsorolasos magyar uzenet (pont a fo agens
# Telegram-stilusa) nem eri el a 3 markert, es az ekezet-vizsgalat el sem indul --
# a mai napindito elso bekezdese ekezetlenul atment. A nyelv-detektor ezert nem
# EGYEDULI kapu tobbe: egyetlen olyan szotar-talalat, ami magyarul ekezet nelkul
# NEM letezik ES angol/technikai szokent sem ertelmezheto, onmagaban eleg ok a
# vizsgalatra. Az alabbi kizaras CSAK a triggerre vonatkozik: ha a szoveg mas
# uton magyarnak bizonyult, ezek a talalatok is jelentesre kerulnek -- de egyedul
# nem ranthatnak be egy angol szoveget az auditba ("the all-new level editor").
AMBIGUOUS_TRIGGER = {
    "es", "ar", "arak", "ev", "evi", "ot", "uj", "ujat", "het", "ora", "mas",
    "all", "level", "video", "netto",
}


def accentless_evidence(words):
    return {w for w in words if w in ACCENTLESS and w not in AMBIGUOUS_TRIGGER}


# collect_bash_body / collect_mcp_body moved VERBATIM to email_extract.py
# (EMAILKAPU901 PR1): the level-2 approval gate hashes the same letter this
# gate audits, so the extraction must have exactly one implementation.
# Byte-parity with the pre-move behavior is pinned by
# scripts/__tests__/email-extract-parity.test.py against a golden captured
# from the pre-move code.
# GUARDED import: a bare ImportError would escape the __main__ net (it fires
# during module load), exit 1, and PreToolUse treats 1 as NON-blocking -- the
# send would run UNCHECKED. The stubs keep the email path fail-closed through
# the existing unreadable branch, and leave the telegram path (which never
# calls these) fail-open as designed.
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from email_extract import collect_bash_body, collect_mcp_body  # noqa: E402
except Exception as _extract_exc:  # noqa: BLE001 -- deliberate fail-closed stub
    _EXTRACT_ERR = repr(_extract_exc)

    def collect_bash_body(cmd: str):
        return ("", f"az email_extract modul nem toltheto be ({_EXTRACT_ERR})")

    def collect_mcp_body(tool_input: dict):
        return ""


# --- Telegram reply (GATETG816) ---------------------------------------------
# The reply tool sends MarkdownV2, where every special char arrives escaped
# (\. \( \) \-). Those backslashes sit inside the prose the audit reads, and
# they can split technical tokens or glue fragments in ways the email path
# never sees. Un-escape (backslash before a non-word char) BEFORE auditing --
# this is analysis-only, the outgoing payload is untouched.
MDV2_ESCAPE = re.compile(r"\\([^\w\s])")


# --- Human-facing HTTP channels via curl (GATEHTTP924) ------------------------
# The Bash arm recognised exactly one kind of send: email. Every other outbound
# path that a human reads, and that an agent can reach with a plain curl, left
# the machine with no audit at all. Measured 2026-09-24 with a synthetic em-dash
# payload: a comment to the community API, a post to Discord's REST API and a
# Telegram Bot API sendMessage all passed exit 0, while the SAME text through
# the Telegram reply tool was blocked. The gate was not failing on these paths,
# it simply had no door there.
#
# Covered here, each only when the method is a SEND (POST/PUT/PATCH or an
# implicit POST from a data flag; GET/HEAD reads pass untouched):
#   - the community agent API (api.marveen.io): feed posts, comments, mention
#     replies. Written from a vault-held base URL in practice ($B/feed/...), so
#     the path shape counts even when the host is an unresolved variable;
#   - Discord REST: .../channels/<id>/messages[/<id>];
#   - Telegram Bot API: .../bot<token>/send*|edit*.
# NOT covered, deliberately: /api/messages (inter-agent and federation). That
# channel is agent-to-agent, its traffic is written without accents, and it
# already has its own homoglyph-only gate (INTERAGENTHOMOGLIF923) above.
#
# Failure direction follows the email branch, not the Telegram one: a body the
# hook cannot read BLOCKS. These are deferrable writes (a community post is
# even queued for owner approval), and a public text that skipped the audit
# costs more than a retry with a readable body. An INTERNAL error still passes
# loudly, like every channel arm.
_HTTP_CHANNEL_TARGETS = (
    ("marveen.io", re.compile(
        r"^((https?://)?([^/\s]*\.)?api\.marveen\.io|\$\{?\w+\}?)(/[^\s]*)?"
        r"/(feed/posts(/[^/\s]+/comments)?|mentions/[^/\s]+/reply)/?(\?\S*)?$", re.I)),
    ("Discord API", re.compile(
        r"^(https?://)?([^/\s]*\.)?discord(app)?\.com/api(/v\d+)?/channels/[^/\s]+/messages(/[^/\s]+)?/?(\?\S*)?$",
        re.I)),
    ("Telegram API", re.compile(
        r"^(https?://)?api\.telegram\.org/bot[^/\s]+/(send|edit)\w*/?(\?\S*)?$", re.I)),
)
# Only the prose a human reads. ids, chat ids, parse modes and urls stay out:
# auditing them would block on tokens nobody reads as text.
_HTTP_TEXT_FIELDS = ("title", "content", "text", "caption", "message")


def _http_channel_segment(cmd: str):
    """(label, tokens) of the first curl segment that SENDS to a covered
    human-facing HTTP channel, or (None, None)."""
    try:
        segments = _segments_tokens(cmd)
    except ValueError:
        return None, None
    for toks in segments:
        while toks and _ENV_ASSIGN.match(toks[0]):
            toks = toks[1:]
        if not toks or not _CURLISH.match(_basename(toks[0])):
            continue
        rest = toks[1:]
        for label, target in _HTTP_CHANNEL_TARGETS:
            if any(target.match(t) for t in rest):
                if _curl_resend_verdict(_basename(toks[0]), rest) == "read":
                    return None, None  # a GET of the feed: nothing is sent
                return label, toks
    return None, None


def _http_channel_text(raw: str) -> str:
    """The human-read prose of a channel body: JSON object fields, or the same
    fields form-encoded (Telegram accepts both). Unknown shape: the raw body."""
    try:
        obj = json.loads(raw)
    except ValueError:
        obj = None
    if isinstance(obj, dict):
        return "\n".join(str(obj[f]) for f in _HTTP_TEXT_FIELDS
                         if isinstance(obj.get(f), str) and obj.get(f))
    if obj is None:
        from urllib.parse import parse_qs
        form = parse_qs(raw, keep_blank_values=False)
        got = [v for f in _HTTP_TEXT_FIELDS for v in form.get(f, [])]
        if got:
            return "\n".join(got)
    return raw


# curl's short options that take an argument (curl(1)). Only these end a
# cluster: a letter missing here is read on as a flag, so a later body letter
# still blocks (the safe side). O, s, S, v, G, L, I, k... take none.
_CURL_ARG_LETTERS = frozenset("AbcCdDeEFHKmoPQrtTuUwxXyYz")


def _http_channel_unread_body(toks):
    """Why a channel send carries body text that _curl_payload_raw does not
    read, or None. Card 050196cf: the reader knows curl's
    -d/--data/--data-binary/--data-raw/--data-ascii/--json only, and what it
    did not read was simply not audited: httpie items or stdin, wget
    --post-data, curl --data-urlencode, -F, --form-string, -T and a -sd
    cluster all passed exit 0 with an em dash (measured 2026-11-01, 8 shapes;
    --data-urlencode even beside a read `-d chat_id=1`). The default is now
    NO: any program other than curl, and any curl body option the reader does
    not read, is unreadable (fail-closed), whether or not another flag WAS
    read. A curl with no body option at all stays a bare POST."""
    prog = _basename(toks[0])
    if prog.lower() != "curl":
        return f"a(z) {prog} kuldes torzset a kapu nem olvassa (csak a curl -d/--data*/--json alakot)"
    # didi 55347: the cluster check read ANY d/F/T of a token, so an option VALUE
    # (-XPOST, -o/dev/null, -w'%{http_code}', -HContent-Type:..., the '-Fun' after
    # -d) was taken for a body flag and the send was denied with a false reason.
    # Now curl's own reading: letters left to right, the first letter that takes
    # an argument ends the cluster (the rest is its value), and a value-taking
    # option that ends its token eats the next token, which is then not scanned.
    rest = toks[1:]
    i, n = 0, len(rest)
    while i < n:
        t = rest[i]
        opt = t.split("=", 1)[0] if t.startswith("--") else t
        if opt in _CURL_BODY_OPTS and opt not in _IA_DATA_FLAGS:
            return f"a torzs a(z) {opt} flaggel megy, ezt a kapu nem olvassa"
        if t.startswith("--"):
            i += 2 if ("=" not in t and (opt in _CURL_VALUE_LONG or opt in _CURL_BODY_OPTS)) else 1
            continue
        if t.startswith("-") and len(t) > 1:
            letters = t[1:]
            for k, ch in enumerate(letters):
                # a body letter in a cluster (-sd, -sF, -sT): the reader takes
                # only a leading -d, with its value next or glued on (-dtext=...)
                if ch in "FT" or (ch == "d" and k > 0):
                    return f"a torzs egy osszevont flag-csoportban megy ({t}), ezt a kapu nem olvassa"
                if ch in _CURL_ARG_LETTERS:
                    i += 2 if k == len(letters) - 1 else 1
                    break
            else:
                i += 1
            continue
        i += 1
    return None


def http_channel_gate(cmd: str) -> None:
    """Exit 2 on a copy problem or an unreadable body, exit 0 when clean.
    RETURNS (does not exit) when the command is not a covered HTTP send, so
    the caller's other arms still run."""
    label, toks = _http_channel_segment(cmd)
    if label is None:
        return
    try:
        raw, unreadable = _curl_payload_raw(cmd, toks, all_flags=True)
        if not unreadable:
            unreadable = _http_channel_unread_body(toks)
        if unreadable:
            sys.stderr.write(
                f"KIMENO-SZOVEG KAPU ({label}): TILTVA, mert a kimeno szoveget nem tudtam "
                f"megvizsgalni.\nOk: {unreadable}.\n\n"
                "Ez szandekosan fail-closed: egy vizsgalhatatlan kuldes pont a kaput utne ki.\n"
                "Vizsgalhato alak: idezett heredoc (--data-binary @- <<'JSON'), "
                "@/abszolut/ut.json, vagy inline -d '...' behelyettesites nelkul.\n")
            sys.exit(2)
        if raw is None:
            sys.exit(0)  # a bare POST: nothing of ours is being sent
        text = _http_channel_text(raw)
        if not text.strip():
            sys.exit(0)
        problems = audit(text)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 -- deliberate blanket: fail-open-loud
        warn = f"outgoing-copy-gate: HTTP-csatorna-ag ({label}) belso hiba, FAIL-OPEN atengedes: {exc!r}"
        sys.stderr.write(warn + "\n")
        _gate_log(warn)
        sys.exit(0)
    if problems:
        sys.stderr.write(
            f"KIMENO-SZOVEG KAPU ({label}): TILTVA, az uzenet nem mehet ki igy.\n\n"
            + "\n".join(f"  - {p}" for p in problems)
            + "\n\nJavitsd a szoveget es kuldd ujra.\n")
        sys.exit(2)
    # FOREIGNLETTER924 on this path too (88c366f2 merge, P6; marveen 2026-09-28): our commit said
    # "every outgoing path", and upstream's HTTP channel path arrived without the warning. It never
    # blocks, exactly as on the Telegram, email and inter-agent paths.
    emit_system_messages([foreign_letter_warning(text)])
    sys.exit(0)


def collect_channel_body(tool_input: dict, unescape_mdv2: bool) -> str:
    """Text of a channel reply. GATEDISCORD905: both the Telegram and the
    Discord reply tool put the prose in `text` (schema-checked, not guessed);
    `caption`/`message` stay in the list because they cost nothing and a
    missed field here is a SILENT ZERO -- empty text exits 0, i.e. fail-open.
    Only Telegram's MarkdownV2 escapes get undone: on Discord a backslash is
    a literal the author wrote, not gate noise."""
    fields = ("text", "caption", "message")
    got = [str(tool_input[f]) for f in fields if tool_input.get(f)]
    # c67f5f34: the Telegram reply tool's one-tap answer buttons (a Marveen patch
    # of the plugin, scripts/patch-telegram-plugin.py) are outgoing text too: the
    # tapped label is what the recipient sees and sends back. A label this gate
    # did not read would be the silent zero above, so every label joins the body;
    # a value that is not a list is read as it is (the loud side).
    buttons = tool_input.get("buttons")
    if isinstance(buttons, (list, tuple)):
        got += [str(b) for b in buttons if str(b).strip()]
    elif buttons:
        got.append(str(buttons))
    joined = "\n".join(got)
    return MDV2_ESCAPE.sub(r"\1", joined) if unescape_mdv2 else joined


def channel_gate(tool_input: dict, label: str, unescape_mdv2: bool) -> None:
    """Audit a channel reply (Telegram or Discord). FAIL-OPEN on any internal
    error (exit 0 + loud log): email is deferrable, but these are the owner's
    ONLY supervision channels -- a gate crash that silences one costs more
    than a slipped accent. A FOUND problem still blocks (exit 2): that is the
    gate's whole point."""
    try:
        text = collect_channel_body(tool_input, unescape_mdv2)
        if not text.strip():
            sys.exit(0)  # files-only reply or empty text: nothing to audit
        # GATECOPY827: a masolhato kodblokk CSAK markdownv2 modban lesz
        # kodblokk. A reply tool `format` parametere alapertelmezesben "text",
        # es plain textben a Telegram nem parsolja a harom backtickot, tehat
        # nincs copy gomb -- a szoveg nyersen, a backslash-escape-ekkel egyutt
        # jelenik meg. Ez 2026-08-17 ota OTSZOR ment ki igy (a memoriaban
        # feedback_telegram_codeblock_needs_markdownv2, plusz a kotelezove tett
        # telegram-copy-gomb skill), es egyik alkalommal sem tudashiany volt,
        # hanem kihagyott lepes. Ezert innentol gepi kapu allitja meg, nem
        # emlekezet. A vizsgalat a NYERS szovegen fut, mert a fence-t a
        # MDV2_ESCAPE feloldas nem erinti.
        raw = "\n".join(str(tool_input[f]) for f in ("text", "caption", "message")
                        if tool_input.get(f))
        # This rule is TELEGRAM-SPECIFIC: the copy button depends on MarkdownV2
        # parsing. Discord renders a triple-backtick block natively in a plain
        # message and its reply tool has no markdownv2 format value at all, so on
        # that branch the rule would block a problem that does not exist -- and,
        # before the label existed, would have named the wrong channel while doing
        # it. The condition therefore filters on the label explicitly, not on
        # unescape_mdv2: those two only happen to coincide today, and the intent
        # here is the channel.
        if (label == "Telegram" and "```" in raw
                and str(tool_input.get("format", "")).lower() != "markdownv2"):
            sys.stderr.write(
                "KIMENO-SZOVEG KAPU (Telegram): TILTVA, a kodblokk nem lenne masolhato.\n\n"
                "  - A szoveg harom backtickes kodblokkot tartalmaz, de a hivasban\n"
                "    format=\"" + str(tool_input.get("format") or "text") + "\". Plain textben a Telegram nem ad copy gombot,\n"
                "    es a MarkdownV2 escape-ek (\\. \\- \\() nyersen latszanak.\n\n"
                "Kuldd ujra ugyanezt a szoveget format=\"markdownv2\"-vel. Kodblokkon\n"
                "belul csak a backtickot es a backslasht kell escapelni, a blokkon\n"
                "kivuli prozat viszont teljesen (_*[]()~`>#+-=|{}.!).\n"
            )
            sys.exit(2)
        problems = audit(text)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 -- deliberate blanket: fail-open path
        warn = f"outgoing-copy-gate: {label.upper()}-ag belso hiba, FAIL-OPEN atengedes: {exc!r}"
        sys.stderr.write(warn + "\n")
        _gate_log(warn)
        sys.exit(0)
    if problems:
        sys.stderr.write(
            f"KIMENO-SZOVEG KAPU ({label}): TILTVA, az uzenet nem mehet ki igy.\n\n"
            + "\n".join(f"  - {p}" for p in problems)
            + "\n\nJavitsd a szoveget es kuldd ujra (a MarkdownV2 escape-eket a kapu "
              "az ellenorzes elott feloldja, azok nem szamitanak hibanak).\n"
        )
        sys.exit(2)
    # GATEPERSIST816(2): a hianyzo nev-szabaly a csatorna-agon fail-open marad,
    # de a figyelmeztetes ODA megy, ahol a session tenyleg latja -- a hook
    # stdout systemMessage mezoje a futo sessionben jelenik meg, nem egy
    # logfajlban, amit senki nem olvas.
    # GATEPERSIST816/3 + CLCOPYGATEDONTES904: a tudatosan felfuggesztett
    # szabaly (RULES_SANCTIONED, barmelyik flag-irassal) mar nem veszteseg,
    # nincs mit jelezni, a Telegram-ag ott csendben marad. Minden mas nem-ok
    # allapot (missing/empty/invalid) figyelmeztetest kap.
    # FOREIGNLETTER924: the named foreign-letter warning rides in the SAME stdout JSON --
    # a hook prints one object, so two separate prints would be one unparseable line.
    emit_system_messages([
        (("outgoing-copy-gate: a NEV-SZABALY fajl ERVENYTELEN "
          f"({_LOCAL_RULES}"
          + (f"; {_INVALID_REASON}" if _INVALID_REASON else "")
          + ") -- a nev-ellenorzes NEM fut a kimeno uzeneteken. Javitsd a fajlt.")
         if RULES_STATE == RULES_INVALID else
         ("outgoing-copy-gate: a NEV-SZABALY fajl hianyzik/ures "
          f"({_LOCAL_RULES}) -- a nev-ellenorzes NEM fut a kimeno uzeneteken. "
          "Potold a store/outgoing-copy-gate-rules.json-t.") if RULES_STATE in RULES_LOUD else None),
        foreign_letter_warning(text),
    ])
    sys.exit(0)


def audit(text: str):
    """Return a list of human-readable problems."""
    # COPYGATEENT914 (Marveen merese, 2026-09-14, egy VALODI vevo-levelen): a
    # tag-kiszedes onmagaban megkerulheto HTML-ENTITASSAL. A `&mdash;` (es a
    # szamos `&#8212;` / hex `&#x2014;` alak) atment a kapun, a cimzettnel
    # viszont gondolatjelkent renderel -- vagyis a kapu zoldet mondott arra,
    # amit tilt. Merve mind a harom alakon.
    # A SORREND SZANDEKOS: eloszor a tageket szedjuk ki, AZUTAN dekodolunk.
    # Forditva egy szovegkent mutatott, escape-elt jelolo (`&lt;b&gt;`) valodi
    # tagge dekodolodna, es a TAG.sub kitorolne a szoveg egy darabjat.
    plain = html.unescape(TAG.sub(" ", text))
    problems = []
    if EM_DASH in plain:
        problems.append(
            f"GONDOLATJEL (em dash, U+2014) {plain.count(EM_DASH)} helyen -- allo szabaly, soha nem mehet ki."
        )
    # GATENEVSTRIP921: a nev-szabaly a SAJAT maszkjan fut (NAME_MASK), nem a
    # nyers szovegen es nem a strip_technical kimeneten -- lasd a NAME_MASK
    # feletti indoklast. Igy a kod-spanban/URL-ben allo nevalak atmegy, a
    # toldalekos prozai alak ("Nev-val") viszont tovabbra is bukik.
    bad = BAD_NAME.search(strip_for_name(plain)) if BAD_NAME else None
    if bad:
        problems.append(
            f"HELYTELEN NEV: {bad.group(0)!r} -- a lokal nev-szabaly (store/outgoing-copy-gate-rules.json) szerint helytelen alak; a helyes irast a szabaly-fajl correction mezoje adja." + _name_correction()
        )
    prose = strip_technical(plain)
    # DUPLA KOTOJEL gondolatjel-potlokent (Szabi 2. eszrevetele, 2026-08-16): a
    # " -- " prozaban ugyanugy zavaro, mint a tiltott em dash. A PROZAN merjuk
    # (strip_technical utan), igy a kodreszletek/parancsok --flag alakjai nem
    # erintettek -- azok amugy sem " -- " alakuak (nincs szokoz a kotojelek
    # utan), de a technikai regiok kivagasa a biztos hatar.
    dh = prose.count(" -- ")
    if dh:
        problems.append(
            f"DUPLA KOTOJEL gondolatjel-potlokent {dh} helyen (' -- ') -- Szabi jelzese: "
            "ugyanugy zavaro, mint az em dash. Ird at kotojel nelkul: kettospont, zarojel, vagy uj mondat."
        )
    # SZOKOZOS NAGYKOTOJEL (" – ", U+2013) -- card e57af6ec, marveen, a szabaly gazdaja:
    # Isti szabalya "Nincs gondolatjel", es a magyar gondolatjel leggyakoribb alakja epp ez; a
    # kapu eddig ket PELDANYT sorolt (em dash, " -- "), a mechanizmust nem. A PROZAN merjuk,
    # mint a " -- "-t. A szokoz lehet nem-toro is (U+00A0, U+202F): a gondos magyar tipografia
    # epp azt teszi a kotojel ele, es az a rendes alak.
    #   TILTOTT: szo utan szokoz + nagykotojel + szokoz        "rendben – kesz"
    #            szo utan szokoz + nagykotojel + SORVEG        "rendben –\nkesz" (ugyanaz, sortoressel)
    #   ATMEGY:  szokoz nelkul (tartomany)                     "10–20", "2026–2027"
    #            SOR ELEJEN, akar behuzva (felsorolas/parbeszed) "\n– elso pont", "\n  – pont"
    # A sor eleji alak dontese (a kartya kerte): 1524 kimeno uzenetben a harom szokozos alak
    # egyike sem fordult elo (merve 2026-09-25), tehat a meres nem dont; a sor eleji "– " a
    # magyarban felsorolas- es parbeszedjel, nem mondatkozi gondolatjel, ezert atengedjuk.
    spaced_en = len(re.findall(r"(?<=\S)[ \u00a0\u202f]\u2013(?:[ \u00a0\u202f]|(?=\n)|$)", prose))
    if spaced_en:
        problems.append(
            f"GONDOLATJEL (szokozos nagykotojel, ' \u2013 ') {spaced_en} helyen -- allo szabaly, "
            "ugyanaz, mint az em dash. Tartomanyt (10\u201320) szokoz nelkul irj; kulonben kettospont, zarojel vagy uj mondat."
        )
    # 4. ellenorzes (GATEHOMOGLIF816): vegyes irasrendszeru szo. SZANDEKOSAN
    # NEM magyar-kapuzott (elteres Marveen specjetol, ervvel): az FP-vedelem
    # maga a VEGYES-szo szabaly -- egy legitim idegen idezet szavai TISZTA
    # nem-latin betusek, sosem vegyesek. A magyar-kapu itt semmit nem vedene,
    # viszont lyukat utne: egy 2-markeres, hibatlanul ekezetes magyar szoveg
    # homoglifaja atcsuszna (merve: a 'kerlek+koszonom' paros keves a
    # nyelv-detektorhoz). A konkret szot ES karaktert nevezzuk meg, mert a
    # hiba szemre lathatatlan -- enelkul a javitas talalgatas lenne.
    try:
        mixed = mixed_script_words(prose)
    except MixedScriptUnavailable as exc:
        problems.append(
            "A VEGYES-IRASRENDSZER SZABALY NEM TOLTHETO BE "
            f"(scripts/lib/mixed_script.py: {exc}). Ez NEM homoglifa-talalat: a "
            "szabaly meg sem futott, tehat a szovegrol semmit nem tudunk. "
            "Szandekosan fail-closed."
        )
        mixed = []
    if mixed:
        shown = "; ".join(f"{w!r} -- benne {name}" for w, _c, name in mixed[:5])
        more = f" (+{len(mixed) - 5} tovabbi)" if len(mixed) > 5 else ""
        problems.append(
            f"VEGYES IRASRENDSZERU SZO (homoglifa), {len(mixed)} db: {shown}{more}. "
            "Latin szoba keveredett nem-latin betu: olvasva lathatatlan, de a keresest/grepet neman eltori."
        )
    tok_pos = accent_check_tokens(prose)
    words = [w for w, _ in tok_pos]
    if is_hungarian(plain) or accentless_evidence(words):
        hits = sorted({w for w in words if w in ACCENTLESS})
        # Az aranyot is a prozan merjuk: a technikai tokenekben nincs ekezet, tehat
        # egy kodban gazdag, egyebkent helyes level aranyat lefele huznak.
        letters = sum(1 for ch in prose if ch.isalpha())
        acc = sum(1 for ch in prose if ch in ACCENTED)
        ratio = (acc / letters) if letters else 0.0
        if hits:
            first_pos = {}
            for w, p in tok_pos:
                if w in ACCENTLESS and w not in first_pos:
                    first_pos[w] = p
            shown = ", ".join(
                f"{h} -> {ACCENTLESS[h]} ({_hit_context(prose, first_pos[h], len(h))})"
                for h in hits[:12]
            )
            more = f" (+{len(hits) - 12} tovabbi)" if len(hits) > 12 else ""
            problems.append(f"HIANYZO EKEZETEK, {len(hits)} szo: {shown}{more}")
        elif letters > 200 and ratio < 0.01:
            problems.append(
                f"MAGYAR SZOVEG GYAKORLATILAG EKEZET NELKUL (ekezet-arany {ratio:.3%}, {letters} betun). "
                "A szolistam nem talalt konkret talalatot, de az arany onmagaban gepi atirasra utal -- olvasd vissza."
            )
    return problems


# Outbound-shaped operations of the multiplexed manage_email tool. Everything
# else it does (search, read, labels, trash, getAttachment...) produces no text
# of ours, so the gate must not touch it -- classifying those as sends is how
# the sibling email gate once denied plain mailbox READS (MANAGEOP904).
MANAGE_EMAIL_OUTBOUND_OPS = {"send", "reply", "replyall", "forward"}

# Dedicated (non-multiplexed) outbound tools: the draft tools and the Gmail
# connector's three separate send-shaped tools. Kept in step with the matcher
# this hook is registered under in settings.json.
# GMAILCONNECTOR914: the server segment is NOT always exactly "gmail" -- the
# claude.ai connector is mcp__claude_ai_Gmail__send_message, one underscore
# before Gmail, and `(^|__)gmail__` never matched it, so its sends fell through
# to sys.exit(0) with no audit (measured 2026-08-30, 2026-09-08). Anything
# ending in "gmail__<send-shaped tool>" is a send now, whatever the prefix.
EMAIL_TOOL_RE = re.compile(
    r"(send_email|create_draft|draft_email|update_draft"
    r"|gmail__(reply|reply_all|send_message|forward)$)",
    re.I,
)


# --- Inter-agent messages: HOMOGLYPH-ONLY (INTERAGENTHOMOGLIF923) -----------
# `curl .../api/messages` is NOT an email send (send-invocation-cases.json pins
# it expected:false, and that stays), so none of the copy rules below ever ran
# on it: no accent audit, no name rule, no em dash -- correctly, because the
# fleet's internal traffic is written WITHOUT accents and the full audit would
# block most of it. One dimension is added here and nothing else: a MIXED-SCRIPT
# word (homoglyph). The fleet coordinates by card ids, agent names and file
# paths passed in messages; a Cyrillic 'a' in one of those does not look wrong,
# it silently points at something that does not exist. Measured 2026-09-16:
# four such characters in the lead agent's own messages, caught only by a
# manual scan.
#
# FAILURE DIRECTION IS THE OPPOSITE OF THE EMAIL BRANCH (Marveen, msg 28870):
#   - homoglyph FOUND           -> BLOCK (exit 2), naming the word and the char;
#   - body NOT INTERPRETABLE     -> PASS, with a loud named systemMessage and a
#     (unreadable path, $-path,     gate-log line. On this channel a false block
#     run-time substitution,        mutes an agent (the fleet's coordination
#     non-object JSON, unknown      backbone); the threat is our own agent
#     shape)                        emitting a lookalike by accident, not an
#                                   attacker, so fail-open-loud is the right side.
# All three shapes are covered, or the concept is not closed: quoted heredoc
# (`--data-binary @- <<'JSON'`), `@file`, and inline `-d '...'`.
_IA_TARGET = re.compile(r"^(https?://)?[^/\s]*/api/messages/?(\?\S*)?$", re.I)
_IA_DATA_FLAGS = ("-d", "--data", "--data-binary", "--data-raw", "--data-ascii", "--json")
_IA_SUBST = re.compile(r"\$\(|`|\$\{?\w")


def _ia_segment(cmd: str):
    """Tokens of the curl segment that POSTs to /api/messages, or None."""
    try:
        segments = _segments_tokens(cmd)
    except ValueError:
        return None
    for toks in segments:
        while toks and _ENV_ASSIGN.match(toks[0]):
            toks = toks[1:]
        if toks and _CURLISH.match(_basename(toks[0])) and any(_IA_TARGET.match(t) for t in toks[1:]):
            return toks
    return None


# The fleet's everyday form is `S=/abs/scratch; ... --data-binary @$S/m.json`:
# the variable is assigned a LITERAL earlier in the SAME command string. That
# is deterministic, so it is resolved here instead of warned about. Measured
# 2026-09-23 over 1153 real inter-agent POSTs: without this, most of the
# warnings were exactly this shape, and a warning that fires on half the
# traffic is noise. Only a plain literal value counts (no quotes-with-$,
# no substitution); anything else stays unresolved and is warned about.
_IA_ASSIGN = re.compile(r"""(?:^|[;&|\n(]\s*|\s)(?:export\s+)?([A-Za-z_]\w*)=(?:"([^"$`]*)"|'([^']*)'|([^\s;&|$`'"()]+))""")


def _ia_resolve_local_vars(cmd: str, ref: str) -> str:
    local = {}
    for m in _IA_ASSIGN.finditer(cmd):
        local[m.group(1)] = next(g for g in m.groups()[1:] if g is not None)
    def sub(m):
        name = m.group(1) or m.group(2)
        return local.get(name, m.group(0))
    return re.sub(r"\$\{(\w+)\}|\$(\w+)", sub, ref)


def _curl_payload_raw(cmd: str, toks, all_flags: bool = False):
    """(raw_body, unreadable_reason) of a curl data flag, from the three shapes
    (inline -d, @file, quoted heredoc via @-). raw_body is None when the call
    carries no data flag at all. Shared by the inter-agent homoglyph gate and
    the HTTP channel gate (GATEHTTP924), so both read the SAME body the same way.
    all_flags: curl joins repeated -d values with '&' (a form body such as
    `-d chat_id=1 -d text=...`); the HTTP gate needs every part, or the text
    field hides behind the first flag. The inter-agent gate keeps first-only."""
    raw = None
    parts = []
    for i, t in enumerate(toks):
        val = None
        for f in _IA_DATA_FLAGS:
            if t == f and i + 1 < len(toks):
                val = toks[i + 1]
            elif t.startswith(f + "="):
                val = t[len(f) + 1:]
            elif f == "-d" and t.startswith("-d") and len(t) > 2 and not t.startswith("--"):
                val = t[2:]
            if val is not None:
                is_raw_flag = f == "--data-raw"
                break
        if val is None:
            continue
        if val.startswith("@") and not is_raw_flag:
            ref = val[1:]
            if ref == "-":
                m = re.search(r"<<-?\s*'?(\w+)'?[^\n]*\n(.*?)\n\1(?=\s|$)", cmd, re.S)
                if not m:
                    return None, "a torzs stdin-rol jon (@-), heredoc nelkul"
                if not re.search(r"<<-?\s*'", cmd) and _IA_SUBST.search(m.group(2)):
                    return None, "a heredoc NEM idezett, es shell-behelyettesitest tartalmaz"
                raw = m.group(2)
            else:
                path = os.path.expandvars(os.path.expanduser(_ia_resolve_local_vars(cmd, ref)))
                if "$" in path:
                    return None, f"a torzs fel nem oldhato @utvonalrol jon (@{ref})"
                try:
                    with open(path, encoding="utf-8", errors="replace") as fh:
                        raw = fh.read()
                except OSError as exc:
                    return None, f"a torzs-fajl (@{ref}) nem olvashato ({exc.strerror or exc})"
        else:
            if _IA_SUBST.search(val):
                return None, "az inline torzs shell-behelyettesitest tartalmaz, futasidoben dol el"
            raw = val
        if not all_flags:
            break
        parts.append(raw)
    if all_flags and parts:
        return "&".join(parts), None
    return raw, None


def _ia_payload(cmd: str, toks):
    """(text, unreadable_reason) of the message body, from the three shapes."""
    raw, unreadable = _curl_payload_raw(cmd, toks)
    if unreadable:
        return None, unreadable
    if raw is None:
        # No data flag at all: a GET of the queue (the most frequent call on this
        # path) or a bare POST. Nothing is being SENT, so nothing to scan and
        # nothing to warn about -- a warning here would fire on every queue read.
        return "", None
    try:
        obj = json.loads(raw)
    except ValueError:
        return None, "a torzs nem ervenyes JSON"
    if not isinstance(obj, dict):
        return None, "a torzs JSON, de nem objektum"
    # EVERY string field: a lookalike in `to` misroutes as silently as one in
    # `content` misleads.
    strings = [str(v) for v in obj.values() if isinstance(v, str)]
    return "\n".join(strings), None


def inter_agent_homoglyph_gate(cmd: str) -> None:
    """Exit 2 on a homoglyph, exit 0 otherwise (loudly when unreadable).
    Only called for a command that is NOT an email send."""
    toks = _ia_segment(cmd)
    if toks is None:
        sys.exit(0)
    text, unreadable = _ia_payload(cmd, toks)
    if unreadable:
        msg = ("outgoing-copy-gate (inter-agent, homoglifa): a torzs NEM vizsgalhato -- "
               f"{unreadable}. Az uzenet ATMENT, homoglifa-ellenorzes NELKUL. "
               "Vizsgalhato alak: idezett heredoc (--data-binary @- <<'JSON') vagy @/abszolut/ut.json.")
        _gate_log(msg)
        print(json.dumps({"systemMessage": msg}))
        sys.exit(0)
    try:
        mixed = mixed_script_words(text)
    except MixedScriptUnavailable as exc:
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU (inter-agent): TILTVA -- a vegyes-irasrendszer szabaly "
            f"NEM TOLTHETO BE (scripts/lib/mixed_script.py: {exc}).\n"
            "Ez nem a szovegrol szol: a szabaly meg sem futott. Szandekosan fail-closed, "
            "mert egy le nem futott ellenorzes nem 'rendben'.\n"
        )
        sys.exit(2)
    if mixed:
        shown = "; ".join(f"{w!r} -- benne {name}" for w, _c, name in mixed[:5])
        more = f" (+{len(mixed) - 5} tovabbi)" if len(mixed) > 5 else ""
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU (inter-agent): TILTVA -- VEGYES IRASRENDSZERU SZO (homoglifa), "
            f"{len(mixed)} db: {shown}{more}.\n"
            "Egy kartya-azonositoban, agens-nevben vagy utvonalban ez neman felreiranyit. "
            "Javitsd a szoveget es kuldd ujra. (Itt CSAK a homoglifa fut, ekezet- es copy-szabaly nem.)\n"
        )
        sys.exit(2)
    # FOREIGNLETTER924: after the homoglyph BLOCK, the foreign-letter WARNING. It never
    # blocks, and it inherits the fail-open branch above (see the limits at its definition).
    emit_system_messages([foreign_letter_warning(text)])
    sys.exit(0)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # unparseable payload must not wedge the session

    tool = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input") or {}
    # A tool_input that is not a dict crashed every branch on its first .get(),
    # which the Telegram arm then reported as an internal gate error and passed
    # through fail-open. Measured 2026-09-05: the log holds exactly one such
    # line, AttributeError("'int' object has no attribute 'get'"), and a payload
    # with an integer tool_input reproduces it byte for byte. Name the real
    # cause instead of the symptom, and keep each arm's designed failure
    # direction: nothing of ours is readable, so Telegram (the owner's only
    # supervision channel) still passes, email still blocks.
    if not isinstance(tool_input, dict):
        shape = type(tool_input).__name__
        gated = (re.search(r"telegram.*__reply$", tool, re.I)
                 or re.search(r"(^|__)manage_email$", tool, re.I)
                 or EMAIL_TOOL_RE.search(tool)
                 or tool == "Bash")
        if not gated:
            sys.exit(0)  # not a send: the net must never widen the gate
        _gate_log(f"outgoing-copy-gate: a tool_input nem szotar, hanem {shape} "
                  f"-- a vizsgalat nem futtathato (tool={tool!r}).")
        if re.search(r"telegram.*__reply$", tool, re.I):
            sys.exit(0)  # Telegram stays fail-open by design
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA, a hivas tool_input mezoje nem szotar, hanem "
            f"{shape} -- a kimeno szoveg igy nem olvashato ki, tehat nem vizsgalhato.\n"
            "Fail-closed: egy vizsgalhatatlan kuldes pont a kaput utne ki. "
            "Hivd ujra rendes parameterekkel.\n"
        )
        sys.exit(2)

    # GATECOPY828 (#1184): the scaffold wires this hook onto reply AND
    # edit_message (an edit can replace a working code block with a broken
    # one). The dispatch must recognise BOTH, or the edit half of the matcher
    # invokes a hook that exits 0 without auditing anything.
    if re.search(r"telegram.*__(reply|edit_message)$", tool, re.I):
        channel_gate(tool_input, "Telegram", unescape_mdv2=True)  # exits; never falls through
        # UNREACHABLE TODAY, AND THAT IS THE POINT (card 9106d8e6). Every path in
        # channel_gate (the former telegram_gate, generalised upstream by GATEDISCORD905)
        # exits -- measured 2026-09-06 on telegram_gate: five exits, all hard (bare return 0,
        # sys.exit 4, raise 1), so a return would be a deliberate edit, not a slip.
        #
        # But if one is ever added, control falls PAST this branch: a telegram tool name
        # does not match `send_email`, is not `Bash`, and lands in `else: sys.exit(0)` --
        # a SILENT pass-through on precisely the path that inspects user-facing text.
        #
        # `elif` does NOT fix that (marveen's ruling; didi measured the mechanism): it
        # closes the chain, control resumes after it with `text`/`unreadable` unassigned,
        # and the hook dies with exit 1 + traceback. Per this file's own contract that is
        # not a block -- it is a hook error, and the call proceeds. Loud pass-through
        # instead of silent, with the pass-through intact.
        #
        # So the fail-closed form is an explicit exit 2 -- NOT merely "non-zero", which
        # would ship exactly the exit-1 behaviour this card rejects.
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA -- a channel_gate visszatert (Telegram).\n"
            "Ez nem tortenhet meg: a csatorna-ag minden utja kilep. Ha valaki `return`-t\n"
            "irt bele, a kapu innentol NEM vizsgalja a kimeno szoveget, ezert megtagadom.\n"
        )
        sys.exit(2)
    if re.search(r"discord.*__(reply|edit_message)$", tool, re.I):
        # GATEDISCORD905: an install whose owner DM and every working thread run
        # on Discord had no gate on that path at all -- same audit, no MarkdownV2
        # unescaping (on Discord a backslash is a literal the author typed).
        channel_gate(tool_input, "Discord", unescape_mdv2=False)  # exits; never falls through
        # Same seam as the Telegram arm above (card 9106d8e6): a returning
        # channel_gate must BLOCK with exit 2, never fall through to sys.exit(0).
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA -- a channel_gate visszatert (Discord).\n"
            "Ez nem tortenhet meg: a csatorna-ag minden utja kilep. Ha valaki `return`-t\n"
            "irt bele, a kapu innentol NEM vizsgalja a kimeno szoveget, ezert megtagadom.\n"
        )
        sys.exit(2)
    # COPYGATEMATCHER904: the hook is REGISTERED for manage_email, create_draft,
    # update_draft and the Gmail connector's reply/send_message/forward tools,
    # but this dispatch only ever recognised a tool NAME containing
    # "send_email" -- so on an install whose email tool is the multiplexed
    # mcp__google-workspace__manage_email, every letter fell through to
    # sys.exit(0) and the copy audit NEVER ran on an outgoing email. Measured
    # 2026-09-04: an em dash in a manage_email draft body passed the gate,
    # while the same text was blocked on the Telegram path. Same class as the
    # email-send-gate's MANAGEOP904 fix: a multiplexer cannot be classified by
    # its name, only by the operation it was asked to perform.
    if re.search(r"(^|__)manage_email$", tool, re.I):
        op = str(tool_input.get("operation") or tool_input.get("action") or "").strip().lower()
        if op not in MANAGE_EMAIL_OUTBOUND_OPS:
            sys.exit(0)  # search/read/labels/trash...: no outgoing text of ours
        # A bare forward carries someone else's text and an EMPTY note: there is
        # nothing of ours to audit, and the fail-closed "unreadable" branch below
        # would block it for no reason.
        if op == "forward" and not str(tool_input.get("body") or "").strip():
            sys.exit(0)
        text, unreadable = collect_mcp_body(tool_input), None
    elif EMAIL_TOOL_RE.search(tool):
        text, unreadable = collect_mcp_body(tool_input), None
    elif tool == "Bash":
        cmd = str(tool_input.get("command") or "")
        # Relative script paths resolve against the session's cwd (card a4ae5970).
        gate_ctx = {"cwd": str(payload.get("cwd") or "") or os.getcwd(), "files": True}
        if not is_send_invocation(cmd, ctx=gate_ctx):
            http_channel_gate(cmd)  # exits if it is a human-facing HTTP send; else returns
            inter_agent_homoglyph_gate(cmd)  # exits; a no-op pass for anything else
        text, unreadable = collect_bash_body(cmd)
        # bc98d6d5 T1 (didi 51624, marveen 10006089): a send that stands ONLY in a heredoc
        # body read as a program has no letter to audit: the body is code, and auditing it
        # as prose let a real send through (exit 0) while the hard-gate twin denied it.
        # Where the twins differ, the stricter one is right: deny, with the way out.
        if not unreadable and heredoc_body_hit(cmd, gate_ctx):
            unreadable = "a kuldes egy kodkent olvasott heredoc torzsben all, abbol nem valaszthato le a level szovege"
        # a4ae5970: the same for a send that stands only in a script file the command runs.
        elif not unreadable and script_file_hit(cmd, gate_ctx):
            unreadable = "a kuldes egy futtatott szkriptfajlban all, abbol nem valaszthato le a level szovege"
    else:
        sys.exit(0)

    if unreadable or not text.strip():
        if tool == "Bash" and wrapper_depth_hit(cmd, gate_ctx):
            sys.stderr.write(
                "KIMENO-SZOVEG KAPU: TILTVA, mert a parancs valodi fejet nem latom.\n"
                f"Ok: a parancs a burkolo-korlatnal ({_HEAD_DEPTH} egymasba agyazott burkolo: sudo, "
                "time, env, nohup, nice, timeout...) is meg burkolo, tehat nem tudom eldonteni, "
                "hogy levelkuldes-e. Ez szandekosan fail-closed.\n\n"
                f"Ha ez NEM levelkuldes: csokkentsd a burkolok szamat {_HEAD_DEPTH} vagy kevesebb ala.\n"
                "Ha levelkuldes: tedd vizsgalhatova -- ABSZOLUT utvonalu stdin-atiranyitas "
                "(< /teljes/ut/body.txt), vagy --body-ban atadott szoveg.\n"
            )
            sys.exit(2)
        reason = unreadable or "a hook nem talalt vizsgalhato szoveget a hivasban"
        way_out = ""
        if tool == "Bash" and heredoc_body_hit(cmd, gate_ctx):
            way_out = _HEREDOC_BODY_WAY_OUT + "\n"
        elif tool == "Bash" and script_file_hit(cmd, gate_ctx):
            way_out = _SCRIPT_FILE_WAY_OUT + "\n"
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA, mert a levelet nem tudtam megvizsgalni.\n"
            f"Ok: {reason}.\n\n"
            + way_out +
            "Ez szandekosan fail-closed: egy vizsgalhatatlan kuldes pont a kaput utne ki.\n"
            "Tedd vizsgalhatova, aztan kuldd ujra -- ABSZOLUT utvonalu stdin-atiranyitas "
            "(< /teljes/ut/body.txt, shell-valtozo NELKUL), vagy --body-ban atadott szoveg.\n"
        )
        sys.exit(2)

    # GATEPERSIST816(2): az EMAIL ut a hianyzo nev-szabalyra FAIL-CLOSED. A
    # level halaszthato, es pont a vevo fele a legdragabb a rossz nev -- egy
    # csendben lealit nev-ellenorzes mellett kuldeni rosszabb, mint megvarni a
    # szabaly-fajl potlasat. (A telegram-ag fail-open marad systemMessage
    # figyelmeztetessel: az a felugyeleti csatorna, ott a nemulas a dragabb.)
    if RULES_STATE == RULES_INVALID:
        # The file EXISTS but cannot be used: someone configured it and got it
        # wrong. Silent enforcement-loss here would be invisible, so this stays
        # fail-closed until the file is repaired (negative control in tests).
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA -- a NEV-SZABALY fajl LETEZIK, de "
            f"ervenytelen ({_LOCAL_RULES}): "
            + (_INVALID_REASON if _INVALID_REASON else
               "nem parse-olhato JSON, rossz sema vagy hibas regex")
            + ".\n"
            "Javitsd a fajlt (bad_name_patterns: [regex, ...] + correction), "
            "aztan kuldd ujra.\n"
        )
        sys.exit(2)

    problems = audit(text)
    if problems:
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA, a levél nem mehet ki így.\n\n"
            + "\n".join(f"  - {p}" for p in problems)
            + "\n\nJavitsd a szoveget es kuldd ujra. Ekezetes magyar szoveg a vevo fele "
              "nem stiluskerdes: Szabi 2026-08-10-en ket kulon esetben kerte szamon.\n"
        )
        sys.exit(2)

    # Fail-OPEN on a missing/empty rules file, but never silent: the send goes out WITHOUT
    # the name check, and the user must see that on the surface they are using -- a log
    # line nobody reads is the same as nothing (CLCOPYGATEHIANY902). FOREIGNLETTER924 adds
    # the named foreign-letter warning to the SAME stdout JSON.
    emit_system_messages([
        ("outgoing-copy-gate: a NEV-SZABALY fajl "
         + ("HIANYZIK" if RULES_STATE == RULES_MISSING else "URES (nincs minta)")
         + f" ({_LOCAL_RULES}) -- ez a level a nev-ellenorzes NELKUL ment ki. "
         "Ha kell a vedelem, hozd letre a fajlt: "
         '{"bad_name_patterns": ["<python-regex>"], "correction": "<helyes alak>"}.')
        if RULES_STATE in (RULES_MISSING, RULES_EMPTY) else None,
        foreign_letter_warning(text),
    ])
    sys.exit(0)


class _StderrTail:
    """Pass stderr through untouched, and keep a copy for the denial log line."""

    def __init__(self, inner):
        self.inner = inner
        self.parts = []

    def write(self, text):
        self.parts.append(text)
        return self.inner.write(text)

    def flush(self):
        return self.inner.flush()

    def __getattr__(self, name):
        return getattr(self.inner, name)


def _log_denial(stop: SystemExit, said: str) -> None:
    """One gate-log line per DENIAL (card acba3c6f).

    The exit-2 branches told the agent why and logged nothing, so how often the
    gate blocks, and which rule blocks, could not be measured. Logged HERE, once,
    rather than at each branch: there are over a dozen exit-2 sites, and a new
    one would have to remember. The site is the function and line that called
    sys.exit(2); the reason is the first line the gate wrote, which is its own
    header ("KIMENO-SZOVEG KAPU (...): TILTVA ..."), not the outgoing text.
    """
    tb = stop.__traceback__
    while tb is not None and tb.tb_next is not None:
        tb = tb.tb_next
    site = f"{tb.tb_frame.f_code.co_name}:{tb.tb_lineno}" if tb is not None else "?"
    first = next((ln.strip() for ln in said.splitlines() if ln.strip()), "(no reason written)")
    _gate_log(f"outgoing-copy-gate: DENY (exit 2) at {site} -- {first[:160]}")


def _run() -> None:
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 -- deliberate blanket: fail-closed net
        # An unhandled crash exits 1, and PreToolUse treats 1 as NON-blocking,
        # so the send would run UNCHECKED -- the exact opposite of the email
        # path's fail-closed contract (e.g. a non-dict tool_input used to
        # AttributeError inside collect_mcp_body). The channel paths never
        # reach here: channel_gate() catches its own errors and exits 0
        # (fail-open by design), so this net only ever catches the email/Bash
        # send paths, where blocking is the safe failure mode.
        sys.stderr.write(
            "KIMENO-SZOVEG KAPU: TILTVA, belso hiba a vizsgalat kozben "
            f"({exc!r}).\n"
            "Fail-closed: egy vizsgalhatatlan kuldes pont a kaput utne ki. "
            "Tedd vizsgalhatova a hivast, aztan kuldd ujra.\n"
        )
        sys.exit(2)


if __name__ == "__main__":
    sys.stderr = _tail = _StderrTail(sys.stderr)
    try:
        _run()
    except SystemExit as stop:
        if stop.code == 2:
            _log_denial(stop, "".join(_tail.parts))
        raise

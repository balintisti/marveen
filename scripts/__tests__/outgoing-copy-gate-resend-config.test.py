#!/usr/bin/env python3
"""RESENDCFG926 (card a38fdb42): a Resend CONFIG call (webhooks, domains) is not
a mail send; everything else toward api.resend.com keeps the old verdict.

The probe list is didi's review list from the card: what must pass, and every
shape that must STAY a send (path smuggled in a query, traversal, %-encoding,
host tricks, case/slash variants, two URLs, --url and -X ordering, /emails/batch,
unparseable URL). NOT here, on purpose: `api.resend.com:443/...` and
`api.resend.com@evil/...` -- the TARGET pattern upstream of this exemption does
not match them at all, so they never reach it (a pre-existing gap, reported on
the card, not pinned here: a test must not pin a hole). Each case runs through is_send_invocation, the function the
hook itself calls. Run: python3 <thisfile>   Exit 0 = all pass.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(os.path.dirname(HERE), "hooks", "outgoing-copy-gate.py")
spec = importlib.util.spec_from_file_location("gate", GATE)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

A = "-H 'Authorization: Bearer X' -H 'Content-Type: application/json'"
BODY = "-d '{\"endpoint\":\"https://api.deltacrm.io/api/v1/email/events/resend\",\"events\":[\"email.bounced\"]}'"

# (name, command, expected is_send)
CASES = [
    # --- must PASS (config, not a send) ---
    ("POST /webhooks", f"curl -s -X POST https://api.resend.com/webhooks {A} {BODY}", False),
    ("POST /webhooks, quoted URL, -o and -w", f"curl -s -o /tmp/x.json -w 'http=%{{http_code}}' -X POST 'https://api.resend.com/webhooks' {A} {BODY}", False),
    ("POST /webhooks via --url", f"curl -s -X POST --url https://api.resend.com/webhooks {A} {BODY}", False),
    ("-X after the URL", f"curl -s https://api.resend.com/webhooks -X POST {A} {BODY}", False),
    ("PATCH /webhooks/<id>", f"curl -s -X PATCH https://api.resend.com/webhooks/e3cf6f6a-60ff {A} {BODY}", False),
    ("DELETE /webhooks/<id>", "curl -s -X DELETE https://api.resend.com/webhooks/e3cf6f6a-60ff -H 'Authorization: Bearer X'", False),
    ("POST /domains", f"curl -s -X POST https://api.resend.com/domains {A} -d '{{\"name\":\"x.hu\"}}'", False),
    ("POST /domains/<id>/verify", "curl -s -X POST https://api.resend.com/domains/abc123/verify -H 'Authorization: Bearer X'", False),
    ("GET /webhooks still passes", "curl -s https://api.resend.com/webhooks -H 'Authorization: Bearer X'", False),
    # --- must STAY a send ---
    ("POST /emails", f"curl -s -X POST https://api.resend.com/emails {A} -d '{{\"to\":\"a@b.hu\"}}'", True),
    ("POST /emails/batch", f"curl -s -X POST https://api.resend.com/emails/batch {A} -d '[]'", True),
    ("POST /broadcasts", f"curl -s -X POST https://api.resend.com/broadcasts {A} -d '{{}}'", True),
    ("path hidden in query", f"curl -s -X POST 'https://api.resend.com/emails?x=/webhooks' {A} -d '{{}}'", True),
    ("fragment", f"curl -s -X POST 'https://api.resend.com/emails#/webhooks' {A} -d '{{}}'", True),
    ("traversal", f"curl -s -X POST https://api.resend.com/webhooks/../emails {A} -d '{{}}'", True),
    ("percent-encoding", f"curl -s -X POST https://api.resend.com/%65mails {A} -d '{{}}'", True),
    ("percent-encoded slash", f"curl -s -X POST https://api.resend.com/webhooks%2F..%2Femails {A} -d '{{}}'", True),
    ("uppercase path", f"curl -s -X POST https://api.resend.com/Emails {A} -d '{{}}'", True),
    ("Webhooks capitalised is not on the list", f"curl -s -X POST https://api.resend.com/Webhooks {A} -d '{{}}'", True),
    ("double slash", f"curl -s -X POST https://api.resend.com//emails {A} -d '{{}}'", True),
    ("double slash before webhooks", f"curl -s -X POST https://api.resend.com//webhooks {A} -d '{{}}'", True),
    ("two URLs, config first", f"curl -s -X POST https://api.resend.com/webhooks https://api.resend.com/emails {A} -d '{{}}'", True),
    ("two URLs, emails first", f"curl -s -X POST https://api.resend.com/emails https://api.resend.com/webhooks {A} -d '{{}}'", True),
    ("second URL via --url", f"curl -s -X POST https://api.resend.com/webhooks --url https://api.resend.com/emails {A} -d '{{}}'", True),
    ("plain http", f"curl -s -X POST http://api.resend.com/webhooks {A} -d '{{}}'", True),
    ("webhook sub-sub path", f"curl -s -X POST https://api.resend.com/webhooks/a/b {A} -d '{{}}'", True),
    ("method from a variable, emails", f"curl -s -X $M https://api.resend.com/emails {A}", True),
    ("-K config file may carry its own URL", f"curl -K /tmp/curlrc -X POST https://api.resend.com/webhooks {A} {BODY}", True),
    ("method from a variable on /webhooks stays closed", f"curl -X \"$M\" https://api.resend.com/webhooks {A} {BODY}", True),
    ("wget POST /emails", "wget --post-data='{}' https://api.resend.com/emails", True),
    ("host suffix trick", f"curl -s -X POST https://api.resend.com.evil.example/webhooks https://api.resend.com/emails {A} -d '{{}}'", True),
    ("subdomain is not the API host", f"curl -s -X POST https://x.api.resend.com/webhooks {A} -d '{{}}'", True),
]


def main():
    bad = 0
    for name, cmd, exp in CASES:
        got = g.is_send_invocation(cmd)
        ok = got == exp
        bad += not ok
        print(("PASS " if ok else "FAIL ") + f"{name}: expected {exp}, got {got}")
    print(f"{len(CASES) - bad}/{len(CASES)} passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

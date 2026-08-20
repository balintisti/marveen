#!/usr/bin/env python3
"""Recent INBOX messages as JSON, over IMAP.

WHY THIS EXISTS (2026-08-20). The heartbeat gathers calendar and kanban data
NATIVELY and hands them to the sub-agent as data, but for email it asked the
sub-agent to call an MCP tool (`search_emails`). That made email the only
source whose absence is invisible: a missing calendar logs an error, a missing
MCP tool just produces no email section, which is indistinguishable from "no
mail". It had already failed that way once -- see the 2026-06-02 note in
heartbeat.ts about Gmail OAuth being lost when the isolated config dir came up
empty.

Reading it here puts email on the same footing as everything else: gathered in
code, and loud when it breaks.

WHY PYTHON AND NOT NODE: Node has no IMAP client in its standard library, and
this project deliberately carries no npm dependency for it. python3 is a hard
requirement of the installer and ships imaplib in the standard library, and the
codebase already shells out for this kind of thing.

WHY IMAP AND NOT THE GMAIL API: the OAuth app is stuck in Google's "Testing"
state, where a refresh token dies every 7 days, and publishing it is gated
behind verification because reading mail is a RESTRICTED scope. An app password
over IMAP does not expire. See ~/.config/marveen/gmail-imap.json.

Usage:  gmail-recent.py [--minutes N] [--limit N] [--unread-only]
Output: {"ok":true,"messages":[{from,subject,date,unread,age_minutes}]}
        {"ok":false,"error":"..."}   -- always exit 0 so the caller decides
Credentials never appear in the output, not even on the error path.
"""
import argparse
import email
import imaplib
import json
import os
import sys
from datetime import datetime, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime

CONFIG_PATH = os.path.expanduser('~/.config/marveen/gmail-imap.json')


def decode_field(raw):
    """MIME-decode a header into plain text. Never raises: a malformed header
    is a cosmetic problem, not a reason to lose the whole fetch."""
    if not raw:
        return ''
    try:
        parts = decode_header(raw)
    except Exception:
        return str(raw)
    out = []
    for text, charset in parts:
        if isinstance(text, bytes):
            try:
                out.append(text.decode(charset or 'utf-8', 'replace'))
            except LookupError:
                out.append(text.decode('utf-8', 'replace'))
        else:
            out.append(text)
    return ''.join(out).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--minutes', type=int, default=120)
    ap.add_argument('--limit', type=int, default=20)
    ap.add_argument('--unread-only', action='store_true')
    args = ap.parse_args()

    try:
        cfg = json.load(open(CONFIG_PATH))
    except Exception as e:
        # Name the file, never the contents.
        print(json.dumps({'ok': False, 'error': f'config unreadable ({CONFIG_PATH}): {type(e).__name__}'}))
        return

    now = datetime.now(timezone.utc)
    try:
        M = imaplib.IMAP4_SSL(cfg['host'], cfg.get('port', 993))
        try:
            M.login(cfg['user'], cfg['password'])
            M.select('INBOX', readonly=True)

            # IMAP SINCE is DAY-granular, so it cannot express "last 2 hours".
            # Ask for a day's worth and filter on the real header date below --
            # asking for a narrower window here would silently drop messages
            # whenever the window straddles midnight.
            since = (now.astimezone()).strftime('%d-%b-%Y')
            criteria = ['SINCE', since]
            if args.unread_only:
                criteria.append('UNSEEN')
            typ, data = M.search(None, *criteria)
            ids = data[0].split() if data and data[0] else []

            messages = []
            # Newest first, and stop once we have enough: an INBOX with a
            # thousand messages from today should not cost a thousand fetches.
            for msg_id in reversed(ids):
                if len(messages) >= args.limit:
                    break
                typ, md = M.fetch(msg_id, '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
                if not md or not md[0]:
                    continue
                flags_blob = b' '.join(p if isinstance(p, bytes) else b'' for p in md[0])
                raw = md[0][1]
                if not isinstance(raw, bytes):
                    continue
                msg = email.message_from_string(raw.decode('utf-8', 'replace'))

                sent = None
                try:
                    sent = parsedate_to_datetime(msg.get('Date'))
                    if sent and sent.tzinfo is None:
                        sent = sent.replace(tzinfo=timezone.utc)
                except Exception:
                    sent = None
                # A message with an unparseable Date is kept, not dropped: an
                # age we cannot compute is not a reason to hide the mail.
                age_min = None
                if sent:
                    age_min = int((now - sent).total_seconds() // 60)
                    if age_min > args.minutes:
                        continue

                messages.append({
                    'from': decode_field(msg.get('From')),
                    'subject': decode_field(msg.get('Subject')),
                    'date': sent.isoformat() if sent else None,
                    'age_minutes': age_min,
                    'unread': b'\\Seen' not in flags_blob,
                })
            print(json.dumps({'ok': True, 'messages': messages}, ensure_ascii=False))
        finally:
            try:
                M.logout()
            except Exception:
                pass
    except Exception as e:
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {str(e)[:160]}'}))


if __name__ == '__main__':
    main()
    sys.exit(0)

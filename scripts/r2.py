#!/usr/bin/env python3
"""Minimal S3/R2 client, Python stdlib only.

No aws-cli, no boto3, no rclone on this machine, and installing one just to copy an
8 MB file offsite is not worth the dependency. SigV4 is ~60 lines; this is those lines.

Credentials come from the store files at call time and are never printed:
  store/.r2-key       Access Key ID
  store/.r2-secret    Secret Access Key
  store/.r2-endpoint  https://<account>.r2.cloudflarestorage.com

Usage:
  python3 scripts/r2.py put <bucket> <local-file> [remote-key]
  python3 scripts/r2.py get <bucket> <remote-key> [local-file]
  python3 scripts/r2.py list <bucket> [prefix]
  python3 scripts/r2.py delete <bucket> <remote-key>
"""

import hashlib
import hmac
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

STORE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'store')
REGION = 'auto'  # R2 always signs with "auto"
SERVICE = 's3'


def _read(name: str) -> str:
    with open(os.path.join(STORE, name), encoding='utf-8') as fh:
        return fh.read().strip()


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def _signing_key(secret: str, datestamp: str) -> bytes:
    k = _sign(('AWS4' + secret).encode('utf-8'), datestamp)
    k = _sign(k, REGION)
    k = _sign(k, SERVICE)
    return _sign(k, 'aws4_request')


def request(method: str, bucket: str, key: str = '', query: str = '', body: bytes = b''):
    access_key = _read('.r2-key')
    secret_key = _read('.r2-secret')
    endpoint = _read('.r2-endpoint').rstrip('/')
    host = endpoint.split('://', 1)[1]

    now = datetime.now(timezone.utc)
    amzdate = now.strftime('%Y%m%dT%H%M%SZ')
    datestamp = now.strftime('%Y%m%d')

    # The key is already path-safe in our use (timestamped dump filenames), so the
    # canonical URI is the raw path. Anything exotic would need per-segment quoting.
    canonical_uri = '/' + bucket + ('/' + key if key else '')
    payload_hash = hashlib.sha256(body).hexdigest()

    canonical_headers = (
        f'host:{host}\n'
        f'x-amz-content-sha256:{payload_hash}\n'
        f'x-amz-date:{amzdate}\n'
    )
    signed_headers = 'host;x-amz-content-sha256;x-amz-date'

    canonical_request = '\n'.join([
        method, canonical_uri, query, canonical_headers, signed_headers, payload_hash,
    ])

    scope = f'{datestamp}/{REGION}/{SERVICE}/aws4_request'
    string_to_sign = '\n'.join([
        'AWS4-HMAC-SHA256',
        amzdate,
        scope,
        hashlib.sha256(canonical_request.encode('utf-8')).hexdigest(),
    ])

    signature = hmac.new(
        _signing_key(secret_key, datestamp),
        string_to_sign.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()

    url = f'{endpoint}{canonical_uri}' + (f'?{query}' if query else '')
    req = urllib.request.Request(url, data=body or None, method=method)
    req.add_header('Host', host)
    req.add_header('x-amz-content-sha256', payload_hash)
    req.add_header('x-amz-date', amzdate)
    req.add_header(
        'Authorization',
        f'AWS4-HMAC-SHA256 Credential={access_key}/{scope}, '
        f'SignedHeaders={signed_headers}, Signature={signature}',
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    cmd, bucket = sys.argv[1], sys.argv[2]

    if cmd == 'put':
        local = sys.argv[3]
        remote = sys.argv[4] if len(sys.argv) > 4 else os.path.basename(local)
        with open(local, 'rb') as fh:
            body = fh.read()
        status, out = request('PUT', bucket, remote, body=body)
        if status == 200:
            print(f'OK {remote} ({len(body)} bajt)')
            return 0
        print(f'HIBA {status}: {out.decode("utf-8", "replace")[:400]}')
        return 1

    if cmd == 'list':
        prefix = sys.argv[3] if len(sys.argv) > 3 else ''
        query = 'list-type=2' + (f'&prefix={prefix}' if prefix else '')
        status, out = request('GET', bucket, query=query)
        if status != 200:
            print(f'HIBA {status}: {out.decode("utf-8", "replace")[:400]}')
            return 1
        ns = '{http://s3.amazonaws.com/doc/2006-03-01/}'
        root = ET.fromstring(out)
        total = 0
        for c in root.findall(f'{ns}Contents'):
            key = c.findtext(f'{ns}Key')
            size = int(c.findtext(f'{ns}Size') or 0)
            mtime = c.findtext(f'{ns}LastModified')
            total += size
            print(f'{size:>10}  {mtime}  {key}')
        print(f'-- {len(root.findall(f"{ns}Contents"))} objektum, {total/1048576:.1f} MB')
        return 0

    if cmd == 'get':
        remote = sys.argv[3]
        local = sys.argv[4] if len(sys.argv) > 4 else os.path.basename(remote)
        status, out = request('GET', bucket, remote)
        if status != 200:
            print(f'HIBA {status}: {out.decode("utf-8", "replace")[:400]}')
            return 1
        with open(local, 'wb') as fh:
            fh.write(out)
        print(f'OK {local} ({len(out)} bajt)')
        return 0

    if cmd == 'delete':
        status, out = request('DELETE', bucket, sys.argv[3])
        print('OK' if status in (200, 204) else f'HIBA {status}: {out[:200]!r}')
        return 0 if status in (200, 204) else 1

    print(f'ismeretlen parancs: {cmd}')
    return 2


if __name__ == '__main__':
    sys.exit(main())

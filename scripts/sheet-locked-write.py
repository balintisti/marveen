#!/usr/bin/env python3
"""Write a rule sheet (CLAUDE.md) under the SAME lock the sheet editors take.

    sheet-locked-write.py <page> <sha256 of the text the caller read> [<lock wait, seconds>]
    (the new text comes on stdin)

WHY THIS EXISTS (card 074149c2, coordinator's decision 58301 item C). The sheet editors
(claude-md-edit.py, claude-md-extract.py) take fcntl.flock on the page's OWN file descriptor,
read, and write IN PLACE. The dashboard wrote the same pages with a temp file and a rename, under
no lock. Two ways to lose an edit followed from that:
  - the dashboard read the page, an editor wrote, the dashboard renamed its older text over it;
  - an editor held the lock on the page, the dashboard renamed a new file into place, the editor
    then wrote into a file no path leads to any more.
Node has no flock, so the dashboard's write step is this script. It is a compare-and-swap:

  1. lock the page (wait at most <lock wait>, default 10 s);
  2. the page may have been REPLACED by a rename while we waited: if the descriptor is no longer
     the file the path names, open the path again and start over;
  3. the text under the lock must be the text the caller transformed (the sha256): if not, write
     NOTHING and exit 3; the caller reads the page again and comes back;
  4. write in place: the new bytes first, the cut to length after, so a kill between the two
     leaves the new text followed by the old tail, never an empty sheet.

EXIT: 0 written; 3 the page changed since the caller read it; 4 the lock stayed busy;
5 the page cannot be opened, read or written; 64 called wrongly (an empty text counts: a sheet is
never empty, so an empty stdin is a broken caller).
"""
import fcntl
import hashlib
import os
import sys
import time

DEFAULT_WAIT_S = 10.0


def lock_or_give_up(fd, deadline):
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.02)


def same_file(fd, path):
    a, b = os.fstat(fd), os.stat(path)
    return (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)


def read_all(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    chunks = []
    while True:
        chunk = os.read(fd, 1 << 20)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


def write_in_place(fd, data):
    done = 0
    while done < len(data):
        done += os.pwrite(fd, data[done:], done)
    os.ftruncate(fd, len(data))
    os.fsync(fd)


def main():
    if len(sys.argv) not in (3, 4):
        print(__doc__, file=sys.stderr)
        return 64
    page, want = sys.argv[1], sys.argv[2].lower()
    try:
        wait_s = float(sys.argv[3]) if len(sys.argv) == 4 else DEFAULT_WAIT_S
    except ValueError:
        print(f"NOT WRITTEN: the lock wait is not a number: {sys.argv[3]!r}", file=sys.stderr)
        return 64
    data = sys.stdin.buffer.read()
    if not data:
        print("NOT WRITTEN: empty text on stdin -- a sheet is never empty", file=sys.stderr)
        return 64

    deadline = time.monotonic() + wait_s
    try:
        while True:
            fd = os.open(page, os.O_RDWR)
            try:
                if not lock_or_give_up(fd, deadline):
                    print(f"NOT WRITTEN: {page} stayed locked for {wait_s:g} s", file=sys.stderr)
                    return 4
                try:
                    if not same_file(fd, page):
                        continue
                    if hashlib.sha256(read_all(fd)).hexdigest() != want:
                        print(f"NOT WRITTEN: {page} changed since it was read", file=sys.stderr)
                        return 3
                    write_in_place(fd, data)
                    return 0
                finally:
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
    except OSError as e:
        print(f"NOT WRITTEN: {page}: {e.__class__.__name__}: {e}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Contract for the SUB-AGENT branch of the MEMORY.md write gate (card 8f7ea0be).

marveen's decision (card comment 54158): a sub-agent's own index gets a 6000-character
ceiling; the gate WARNS until it has seen that index at or under the ceiling once, and only
then REFUSES. Every case runs the hook as a SUBPROCESS against a sandbox tree whose path has
the real shape (`.../projects/-Users-Shared-marveen-<agent>/memory/MEMORY.md`), with the
coordinator index and the state file both pointed at temp paths. No live index or live state
file is opened -- asserted in case 0.

THE FIXTURES THAT DISCRIMINATE. Case 2 vs case 4 is the same over-ceiling Edit, warned in one
and refused in the other: the only difference is whether the gate saw the index under the
ceiling first. A gate that always refused (or never did) fails one of them. Case 5 (6000 vs
6001) separates the 6000 ceiling from the coordinator's 24934.
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(os.path.dirname(HERE), 'hooks', 'memory-index-write-gate.py')
LIVE_STATE = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'store',
                          'memory-gate-sub-trimmed.json')
LIVE_SUB = '/Users/isti/.claude/projects/-Users-Shared-marveen-friday/memory/MEMORY.md'

fails = []


def ok(name, cond, detail=''):
    print(('  ok   ' if cond else '  FAIL ') + name + (('  -- ' + detail) if detail else ''))
    if not cond:
        fails.append(name)


def body(n_chars, n_lines=5):
    """An index-shaped file of exactly n_chars characters."""
    head = '\n'.join('- [x%d](m%d.md) hook' % (i, i) for i in range(n_lines))
    pad = 'x' * max(0, n_chars - len(head) - 1)
    return (head + '\n' + pad)[:n_chars]


def put(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)


def mtime(p):
    return os.stat(p).st_mtime_ns if os.path.exists(p) else None


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = os.path.realpath(tmp)
        state = os.path.join(tmp, 'state.json')
        coord = os.path.join(tmp, 'coord', 'memory')
        put(os.path.join(coord, 'MEMORY.md'), body(1000))
        proj = os.path.join(tmp, 'home', '.claude', 'projects')
        idx = os.path.join(proj, '-Users-Shared-marveen-testagent', 'memory', 'MEMORY.md')
        before = (mtime(LIVE_STATE), mtime(LIVE_SUB))

        def run(tool, ti, env_extra=None):
            env = dict(os.environ)
            env['MARVEEN_MEMORY_DIR'] = coord
            env['MARVEEN_MEMORY_GATE_STATE'] = state
            env.pop('MARVEEN_MEMORY_GATE', None)
            if env_extra:
                env.update(env_extra)
            p = subprocess.run([sys.executable, GATE],
                               input=json.dumps({'tool_name': tool, 'tool_input': ti}),
                               capture_output=True, text=True, env=env)
            return p.returncode, p.stdout, p.stderr

        def marked(path=idx):
            try:
                with open(state, encoding='utf-8') as fh:
                    return os.path.realpath(path) in json.load(fh)
            except (OSError, ValueError):
                return False

        def warned(out):
            try:
                d = json.loads(out)
            except ValueError:
                return False
            ctx = (d.get('hookSpecificOutput') or {}).get('additionalContext') or ''
            return ('FIGYELMEZTETES' in ctx and d['hookSpecificOutput'].get('hookEventName')
                    == 'PreToolUse' and 'permissionDecision' not in d['hookSpecificOutput'])

        # 1. over today, never seen under: an Edit that adds a line -> PASSES with a warning
        put(idx, body(7000))
        rc, out, _ = run('Edit', {'file_path': idx, 'old_string': 'xxxx', 'new_string': 'x' * 100})
        ok('1. sosem latott a plafon alatt, FOLE ir -> enged + figyelmeztet', rc == 0 and warned(out),
           'rc=%d out=%r' % (rc, out[:80]))
        ok('1b. es NEM jelolte vagottnak', not marked())

        # 2. the trim itself: strictly smaller, still over -> passes
        rc, out, _ = run('Write', {'file_path': idx, 'content': body(6500)})
        ok('2. vagas, meg folotte de kisebb -> enged', rc == 0, 'rc=%d' % rc)

        # 3. trimmed under: the write passes silently; the NEXT call sees the measured size
        rc, out, _ = run('Write', {'file_path': idx, 'content': body(5900)})
        ok('3. vagas a plafon ala -> enged, csendben', rc == 0 and out.strip() == '', 'rc=%d' % rc)
        ok('3b. a TERV meg nem jeloles (a meg meg nem tortent irasbol nem jelol)', not marked())
        put(idx, body(5900))

        # 4. the SAME over-ceiling Edit as case 1, now refused: the gate saw 5900 first
        rc, out, err = run('Edit', {'file_path': idx, 'old_string': 'xxxx', 'new_string': 'x' * 200})
        ok('4. mar latta a plafon alatt, FOLE ir -> TILT', rc == 2 and 'TILTVA' in err,
           'rc=%d' % rc)
        ok('4b. es most mar vagottnak jelolte (mert 5900-at MERT)', marked())

        # 5. the ceiling is 6000, not the coordinator's 24934: 6000 passes, 6001 is refused
        rc, _, _ = run('Write', {'file_path': idx, 'content': body(6000)})
        ok('5. pont 6000 -> enged', rc == 0, 'rc=%d' % rc)
        rc, _, err = run('Write', {'file_path': idx, 'content': body(6001)})
        ok('5b. 6001 -> TILT (egy 24934-es kapu atengedne)', rc == 2 and '6000' in err, 'rc=%d' % rc)

        # 6. the line ceiling applies here too
        many = '\n'.join('- [a](b.md)' for _ in range(250))
        rc, _, err = run('Write', {'file_path': idx, 'content': many})
        ok('6. 250 sor (karakterben alatta) -> TILT', rc == 2 and 'sor >' in err,
           'rc=%d, %d karakter' % (rc, len(many)))

        # 7. THE WAY OUT once trimmed: over again (override), a shrinking write still passes,
        #    and growing further is refused
        put(idx, body(7000))
        rc, _, _ = run('Write', {'file_path': idx, 'content': body(6800)})
        ok('7. vagott, folotte, SZIGORUAN kisebbre -> enged (a kijarat)', rc == 0, 'rc=%d' % rc)
        rc, _, _ = run('Write', {'file_path': idx, 'content': body(7200)})
        ok('7b. KONTROLL: vagott, folotte, tovabb no -> TILT', rc == 2, 'rc=%d' % rc)

        # 8. the override passes and is honoured on this branch too
        rc, _, _ = run('Write', {'file_path': idx, 'content': body(7200)},
                       {'MARVEEN_MEMORY_GATE': 'allow'})
        ok('8. MARVEEN_MEMORY_GATE=allow -> enged', rc == 0, 'rc=%d' % rc)

        # 9. a SYMLINKED agent path is the same file and the same state key
        put(idx, body(5000))
        link = os.path.join(tmp, 'agents', 'testagent', '.claude-config', 'projects')
        os.makedirs(os.path.dirname(link), exist_ok=True)
        os.symlink(proj, link)
        via = os.path.join(link, '-Users-Shared-marveen-testagent', 'memory', 'MEMORY.md')
        rc, _, _ = run('Write', {'file_path': via, 'content': body(6500)})
        ok('9. SYMLINKELT uton is TILT', rc == 2, 'rc=%d' % rc)

        # 10. CONTROL: the coordinator's project dir is NOT a sub-agent index
        mv = os.path.join(proj, '-Users-isti-marveen', 'memory', 'MEMORY.md')
        put(mv, body(5000))
        rc, out, _ = run('Write', {'file_path': mv, 'content': body(9000)})
        ok('10. KONTROLL: -Users-isti-marveen (koordinator) 9000 -> enged, csendben',
           rc == 0 and out.strip() == '', 'rc=%d' % rc)
        mm = os.path.join(proj, '-Users-Shared-marveen-marveen', 'memory', 'MEMORY.md')
        put(mm, body(5000))
        rc, out, _ = run('Write', {'file_path': mm, 'content': body(9000)})
        ok('10b. KONTROLL: a "marveen" nev a minta alatt sem al-agens -> enged',
           rc == 0 and out.strip() == '', 'rc=%d' % rc)

        # 11. CONTROL: another project's MEMORY.md (the 50-file class) -> silent pass
        other = os.path.join(proj, '-Users-isti-Projektek-sajat-crm', 'memory', 'MEMORY.md')
        put(other, body(5000))
        rc, out, _ = run('Write', {'file_path': other, 'content': body(9000)})
        ok('11. KONTROLL: masik projekt MEMORY.md-je -> enged, csendben',
           rc == 0 and out.strip() == '', 'rc=%d' % rc)

        # 12. CONTROL: a topic file next to the index is not the index
        topic = os.path.join(os.path.dirname(idx), 'some-topic.md')
        rc, out, _ = run('Write', {'file_path': topic, 'content': body(9000)})
        ok('12. KONTROLL: temafajl az index mellett -> enged, csendben',
           rc == 0 and out.strip() == '', 'rc=%d' % rc)

        # 13. a shell write at an over-ceiling sub index: allowed (unsized), with the warning
        put(idx, body(7000))
        rc, out, _ = run('Bash', {'command': 'cat >> %s' % idx})
        ok('13. Bash a folotte levo al-agens indexre -> enged + figyelmeztet',
           rc == 0 and warned(out), 'rc=%d' % rc)
        put(idx, body(3000))
        rc, out, _ = run('Bash', {'command': 'cat >> %s' % idx})
        ok('13b. Bash a plafon alatti indexre -> enged, csendben', rc == 0 and out.strip() == '',
           'rc=%d' % rc)

        # 14. a second agent's index has its OWN state: still in the warning phase
        idx2 = os.path.join(proj, '-Users-Shared-marveen-otheragent', 'memory', 'MEMORY.md')
        put(idx2, body(8000))
        rc, out, _ = run('Edit', {'file_path': idx2, 'old_string': 'xxxx', 'new_string': 'x' * 50})
        ok('14. masik agens, sosem latott alatta -> enged + figyelmeztet (sajat allapot)',
           rc == 0 and warned(out) and not marked(idx2), 'rc=%d' % rc)

        # 15. an unwritable state path fails OPEN, never closed
        put(idx2, body(3000))
        rc, _, _ = run('Write', {'file_path': idx2, 'content': body(3100)},
                       {'MARVEEN_MEMORY_GATE_STATE': '/nonexistent-dir/x/state.json'})
        ok('15. irhatatlan allapotfajl -> enged (fail-open)', rc == 0, 'rc=%d' % rc)

        ok('0. az ELES allapotfajl es az ELES al-agens index erintetlen',
           before == (mtime(LIVE_STATE), mtime(LIVE_SUB)), '%s -> %s' % (
               before, (mtime(LIVE_STATE), mtime(LIVE_SUB))))

    print(('all pass' if not fails else 'FAILED: ' + ', '.join(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())

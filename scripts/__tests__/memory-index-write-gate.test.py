#!/usr/bin/env python3
"""Contract for the MEMORY.md write gate (card c837502c).

Every case runs the hook as a SUBPROCESS against a SANDBOX index (MARVEEN_MEMORY_DIR on a
temp dir). The live index is never opened -- asserted in case 0.

THE FIXTURE THAT DISCRIMINATES (case 3). Sizes between 24934 and 25000 are the only ones
where the correct threshold and the plausible-but-wrong one disagree. A gate set to the
nominal LIMIT=25000 passes such a write; a gate set to the measured window's lower bound
refuses it. Every other size is green on both, so a test that used one would assert nothing.
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(os.path.dirname(HERE), 'hooks', 'memory-index-write-gate.py')
LIVE = '/Users/isti/.claude/projects/-Users-isti-marveen/memory/MEMORY.md'

fails = []


def ok(name, cond, detail=''):
    print(('  ok   ' if cond else '  FAIL ') + name + (('  -- ' + detail) if detail else ''))
    if not cond:
        fails.append(name)


def run(tool, tool_input, memdir, env_extra=None):
    env = dict(os.environ)
    env['MARVEEN_MEMORY_DIR'] = memdir
    env.pop('MARVEEN_MEMORY_GATE', None)
    if env_extra:
        env.update(env_extra)
    p = subprocess.run([sys.executable, GATE],
                       input=json.dumps({'tool_name': tool, 'tool_input': tool_input}),
                       capture_output=True, text=True, env=env)
    return p.returncode, p.stderr


def make(memdir, text):
    os.makedirs(memdir, exist_ok=True)
    path = os.path.join(memdir, 'MEMORY.md')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    return path


def body(n_chars, n_lines=5):
    """An index-shaped file of exactly n_chars characters."""
    head = '\n'.join('- [x%d](m%d.md) hook' % (i, i) for i in range(n_lines))
    pad = 'x' * max(0, n_chars - len(head) - 1)
    return (head + '\n' + pad)[:n_chars]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        memdir = os.path.join(tmp, 'memory')
        idx = make(memdir, body(20000))
        live_before = os.stat(LIVE).st_mtime_ns if os.path.exists(LIVE) else None

        # 1. over the character ceiling -> DENY
        rc, err = run('Write', {'file_path': idx, 'content': body(26000)}, memdir)
        ok('1. Write a plafon FOLE -> TILT', rc == 2 and 'MEMORIA-KAPU' in err, 'rc=%d' % rc)

        # 2. comfortably under -> ALLOW
        rc, _ = run('Write', {'file_path': idx, 'content': body(20000)}, memdir)
        ok('2. Write a plafon ALATT -> enged', rc == 0, 'rc=%d' % rc)

        # 3. THE DISCRIMINATING FIXTURE: inside [24934, 25000).
        #    A gate on the nominal 25000 would PASS this; the measured lower bound refuses.
        rc, err = run('Write', {'file_path': idx, 'content': body(24960)}, memdir)
        ok('3. 24960 karakter (24934 es 25000 KOZOTT) -> TILT', rc == 2 and '24934' in err,
           'rc=%d -- egy 25000-es kapu ATENGEDNE' % rc)

        # 3b. CONTROL for case 3: one character under the real bound passes, so the refusal
        #     in 3 comes from the threshold and not from "everything large is refused".
        rc, _ = run('Write', {'file_path': idx, 'content': body(24934)}, memdir)
        ok('3b. KONTROLL: pont 24934 -> enged', rc == 0, 'rc=%d' % rc)

        # 4. the LINE ceiling is separate from the character ceiling
        many = '\n'.join('- [a](b.md)' for _ in range(250))
        rc, err = run('Write', {'file_path': idx, 'content': many}, memdir)
        ok('4. 250 sor (karakterben boven ALATTA) -> TILT', rc == 2 and 'sor >' in err,
           'rc=%d, %d karakter' % (rc, len(many)))

        # 5. Edit that grows past the ceiling -> DENY
        make(memdir, body(24900))
        rc, _ = run('Edit', {'file_path': idx, 'old_string': 'xxxx',
                             'new_string': 'x' * 200}, memdir)
        ok('5. Edit, ami FOLE noveszti -> TILT', rc == 2, 'rc=%d' % rc)

        # 6. THE WAY OUT: already over, and the write strictly shrinks it -> ALLOW
        make(memdir, body(26000))
        rc, _ = run('Write', {'file_path': idx, 'content': body(25500)}, memdir)
        ok('6. MAR a plafon folott, de SZIGORUAN kisebbre -> enged (a kijarat)', rc == 0,
           'rc=%d' % rc)

        # 6b. CONTROL for 6: already over and growing FURTHER is still refused, so case 6
        #     is not "anything goes once you are over".
        rc, _ = run('Write', {'file_path': idx, 'content': body(26500)}, memdir)
        ok('6b. KONTROLL: mar folotte ES tovabb no -> TILT', rc == 2, 'rc=%d' % rc)

        # 7. a SYMLINKED path to the same file is the same file
        make(memdir, body(20000))
        linkdir = os.path.join(tmp, 'agent', '.claude-config', 'projects', 'p', 'memory')
        os.makedirs(os.path.dirname(linkdir), exist_ok=True)
        os.symlink(memdir, linkdir)
        rc, _ = run('Write', {'file_path': os.path.join(linkdir, 'MEMORY.md'),
                              'content': body(26000)}, memdir)
        ok('7. SYMLINKELT uton is TILT (10 ut mutat ide)', rc == 2, 'rc=%d' % rc)

        # 8. CONTROL: a DIFFERENT project's MEMORY.md is a different inode -> ALLOW.
        #    This is the 50-file class a basename anchor would have flagged.
        other = os.path.join(tmp, 'other', 'memory')
        other_idx = make(other, body(20000))
        rc, _ = run('Write', {'file_path': other_idx, 'content': body(26000)}, memdir)
        ok('8. KONTROLL: MASIK projekt MEMORY.md-je -> enged', rc == 0, 'rc=%d' % rc)

        # 9. shell redirect straight at the file -> DENY
        rc, err = run('Bash', {'command': 'cat >> %s' % idx}, memdir)
        ok('9. Bash atiranyitas a fajlra -> TILT', rc == 2 and 'hej' in err, 'rc=%d' % rc)

        # 10. CONTROL: the helper itself must pass -- it holds the lock and its own ceiling
        rc, _ = run('Bash', {'command': 'python3 scripts/memory-index-add.py friday cold "k" "v"'},
                    memdir)
        ok('10. KONTROLL: a helper hivasa -> enged', rc == 0, 'rc=%d' % rc)

        # 11. CONTROL: reading the index and writing ELSEWHERE must pass
        rc, _ = run('Bash', {'command': 'cp %s /tmp/before.md' % idx}, memdir)
        ok('11. KONTROLL: olvaso cp (masik celba ir) -> enged', rc == 0, 'rc=%d' % rc)

        # 12. the override is honoured and leaves a trace
        rc, _ = run('Write', {'file_path': idx, 'content': body(26000)}, memdir,
                    {'MARVEEN_MEMORY_GATE': 'allow'})
        ok('12. MARVEEN_MEMORY_GATE=allow -> enged', rc == 0, 'rc=%d' % rc)

        # 13. FAIL-OPEN on an unparseable payload, never fail-closed
        env = dict(os.environ); env['MARVEEN_MEMORY_DIR'] = memdir
        p = subprocess.run([sys.executable, GATE], input='{not json',
                           capture_output=True, text=True, env=env)
        ok('13. ertelmezhetetlen payload -> FAIL-OPEN (enged)', p.returncode == 0,
           'rc=%d' % p.returncode)

        # 14. an unrelated tool is none of the gate's business
        rc, _ = run('Read', {'file_path': idx}, memdir)
        ok('14. nem-iro eszkoz -> enged', rc == 0, 'rc=%d' % rc)

        # 0. and the whole run never touched the live index
        live_after = os.stat(LIVE).st_mtime_ns if os.path.exists(LIVE) else None
        ok('0. az ELES MEMORY.md erintetlen', live_before == live_after,
           'mtime %s -> %s' % (live_before, live_after))

    print(('all pass' if not fails else 'FAILED: ' + ', '.join(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())

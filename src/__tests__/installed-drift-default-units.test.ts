// THE DEFAULT UNITS AN INSTALLER SCRIPT WRITES (card 6c22da86).
//
// Measured 2026-09-29: update.sh had not run on this Mac since 08-16, so two units the installers
// put in by DEFAULT (channel-keepalive-probe, main-inbox-observer) were never installed -- and the
// meter could not see it, because lane C only knew plist TEMPLATES. The keepalive's absence cost
// 12 respawns in one night. These tests drive the real script over a built tree
// (INSTALLED_DRIFT_SOURCE_ROOT, LAUNCH_AGENTS_DIR: the documented seams); no installer runs.
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const REPO = join(__dirname, '..', '..')

function run(sourceRoot: string, agentsDir: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(REPO, 'scripts', 'installed-drift-check.ts'), '--plists'], {
    encoding: 'utf-8', timeout: 120_000,
    env: { ...process.env, INSTALLED_DRIFT_SOURCE_ROOT: sourceRoot, LAUNCH_AGENTS_DIR: agentsDir },
  })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

const installer = (label: string) =>
  `#!/bin/bash\nLABEL="${label}"\nPLIST="$HOME/Library/LaunchAgents/$LABEL.plist"\ncat > "$PLIST" <<EOF\n<plist/>\nEOF\n`

/** a: named by install-macos.sh; b: only by update.sh's run_unit_maintenance; c: opt-in, named by neither;
 *  d: named, but not a launchd unit. */
function tree(): string {
  const root = mkTmp('drift-units-')
  execFileSync('git', ['init', '-q', root])
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts', 'com.marveen.tpl.plist.template'), '<plist/>\n')
  writeFileSync(join(root, 'scripts', 'install-a.sh'), installer('com.marveen.a'))
  writeFileSync(join(root, 'scripts', 'install-b.sh'), installer('com.marveen.b'))
  writeFileSync(join(root, 'scripts', 'install-c.sh'), installer('com.marveen.c'))
  // d: named by install-macos.sh and carries a LABEL, but writes a systemd unit, not a LaunchAgents plist
  writeFileSync(join(root, 'scripts', 'install-d.sh'),
    '#!/bin/bash\nLABEL="com.marveen.d"\ncat > "$HOME/.config/systemd/user/$LABEL.service" <<EOF\n[Unit]\nEOF\n')
  writeFileSync(join(root, 'install-macos.sh'), '#!/bin/bash\n"$INSTALL_DIR/scripts/install-a.sh" --load\n"$INSTALL_DIR/scripts/install-d.sh"\n')
  writeFileSync(join(root, 'update.sh'), [
    '#!/bin/bash',
    'install_b() {',
    '  _i="$INSTALL_DIR/scripts/install-b.sh"',
    '  "$_i" --load',
    '}',
    'unrelated() {',
    '  "$INSTALL_DIR/scripts/install-c.sh" --load',
    '}',
    'run_unit_maintenance() {',
    '  install_b "$@"',
    '  return 0',
    '}',
    '',
  ].join('\n'))
  return root
}

function agents(labels: string[]): string {
  const d = mkTmp('drift-units-la-')
  for (const l of labels) writeFileSync(join(d, `${l}.plist`), '<plist/>\n')
  return d
}

describe('installed-drift lane C -- default units written by an installer script', () => {
  it('a unit install-macos.sh installs by default, missing here, is DRIFT (rc 3) and names the fix', () => {
    const r = run(tree(), agents(['com.marveen.b']))
    expect(r.status).toBe(3)
    expect(r.out).toMatch(/C unit com\.marveen\.a .*install-a\.sh \(install-macos\.sh\)/)
    expect(r.out).toMatch(/ALAPERTELMEZETT UNIT HIANYZIK.*bash scripts\/install-a\.sh --load/)
  })

  it('a unit only update.sh run_unit_maintenance installs is expected too, via the step it calls', () => {
    const r = run(tree(), agents(['com.marveen.a']))
    expect(r.status).toBe(3)
    expect(r.out).toMatch(/C unit com\.marveen\.b .*install-b\.sh \(update\.sh install_b\)/)
  })

  it('CONTROL: an opt-in unit (named by no caller, or only outside run_unit_maintenance) is never drift', () => {
    const r = run(tree(), agents(['com.marveen.a', 'com.marveen.b']))
    expect(r.status).toBe(0)
    expect(r.out).not.toMatch(/com\.marveen\.c/)
    expect(r.out).not.toMatch(/com\.marveen\.d/)
    expect(r.out).toMatch(/C unit\s+com\.marveen\.a\s+TELEPITVE/)
    expect(r.out).toMatch(/C unit\s+com\.marveen\.b\s+TELEPITVE/)
  })

  it('the REAL installers yield the two units that were missing on 2026-09-29 (the derivation still parses them)', () => {
    const r = run(REPO, agents([]))
    expect(r.status).toBe(3)
    expect(r.out).toContain('C unit com.marveen.channel-keepalive-probe')
    expect(r.out).toContain('C unit com.marveen.main-inbox-observer')
    expect(r.out).not.toContain('com.marveen.channel-coordinator')
  })
})

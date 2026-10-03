import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card 4fcba090 (didi 26718): the dashboard's NODE_OPTIONS lived ONLY in the
// installed plist. The template and the installer both lacked it, so any
// reinstall removed it silently and the daily drift check flagged the unit
// every day. The dashboard plist has TWO sources -- the template (drift check,
// install-launchd-unit.sh) and install-macos.sh's heredoc (a fresh install) --
// so the test renders BOTH, the way each is really used, and compares the
// results: a value added to one and not the other fails here.

const mkTmp = tmpDirs()
const ROOT = join(__dirname, '..', '..')
const NODE_BIN = '/opt/homebrew/opt/node@22/bin'

function toJson(plistXml: string): Record<string, unknown> {
  const dir = mkTmp('dash-plist-')
  const file = join(dir, 'u.plist')
  writeFileSync(file, plistXml)
  // plutil also rejects a malformed plist, so this is a lint as well.
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf-8' }))
}

function renderTemplate(home: string, root: string): Record<string, unknown> {
  const tpl = readFileSync(join(ROOT, 'scripts', 'com.marveen.dashboard.plist.template'), 'utf-8')
  return toJson(tpl.replaceAll('__MARVEEN_ROOT__', root).replaceAll('__HOME__', home))
}

function renderInstallerHeredoc(home: string, root: string): Record<string, unknown> {
  const src = readFileSync(join(ROOT, 'install-macos.sh'), 'utf-8')
  const open = 'cat > "$PLIST_DIR/${DASHBOARD_PLIST}.plist" << PLISTEOF\n'
  const start = src.indexOf(open)
  if (start < 0) throw new Error('dashboard heredoc not found in install-macos.sh')
  const end = src.indexOf('\nPLISTEOF\n', start + open.length)
  if (end < 0) throw new Error('dashboard heredoc not terminated')
  const body = src.slice(start + open.length, end)
  // Expanded by bash exactly as the installer's unquoted heredoc is.
  const xml = execFileSync('bash', ['-c', 'cat <<PLISTEOF\n' + body + '\nPLISTEOF\n'], {
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: home,
      DASHBOARD_PLIST: 'com.marveen.dashboard',
      NODE_PATH: `${NODE_BIN}/node`,
      NODE_BIN_DIR: NODE_BIN,
      INSTALL_DIR: root,
    },
  })
  return toJson(xml)
}

describe.skipIf(process.platform !== 'darwin')('dashboard launchd unit: template and installer agree (4fcba090)', () => {
  const home = '/Users/someone'
  const root = '/Users/someone/marveen'

  it('the two sources render the SAME unit', () => {
    expect(renderInstallerHeredoc(home, root)).toEqual(renderTemplate(home, root))
  })

  it('and that unit gives each connection attempt 2500 ms', () => {
    const env = renderTemplate(home, root).EnvironmentVariables as Record<string, string>
    expect(env.NODE_OPTIONS).toBe('--network-family-autoselection-attempt-timeout=2500')
  })
})

// A NAPLO MONDJA MEG, MIKOR ES KI -- kartya 5b6a78eb.
//
// A MERT HIANY (didi, 2026-08-28): a `store/rulebook-snapshot.log` egyetlen sora sem tartalmazott
// idobelyeget, es semmi nem mondta meg, MELYIK hivo inditotta a kort. A ket hivo kozul a
// skills-iras hook ráadásul `>/dev/null 2>&1`-gyel indit, tehat a sorai SEHOVA nem jutottak el.
//
// MIERT NEM ELMELETI. 2026-08-27 este harom kulonbozo, egyarant hiheto magyarazat hangzott el a
// csonka commitok burstjere, es mindharmat meressel kellett cafolni -- nem keves adat volt, hanem
// NULLA. Es a `c26193d7` mai kozbenso meresenel ugyanez tert vissza a MASIK iranybol: a ZAR SIKERE
// nem bizonyithato, mert a vesztes peldany uzenete a semmibe megy. A "nem volt verseny" es a
// "volt, es a zar megfogta" ma megkulonboztethetetlen -- ezt a kartyat ez zarja be.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SNAPSHOT = join(ROOT, 'scripts', 'rulebook-snapshot.sh')
const HOOK = join(ROOT, 'scripts', 'hooks', 'skills-snapshot-on-write.sh')

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snaplog-'))
  mkdirSync(join(root, 'src', 'marveen', 'agents', 'x'), { recursive: true })
  mkdirSync(join(root, 'src', 'skills', 's1'), { recursive: true })
  writeFileSync(join(root, 'src', 'marveen', 'CLAUDE.md'), 'x\n')
  writeFileSync(join(root, 'src', 'marveen', 'agents', 'x', 'CLAUDE.md'), 'x\n')
  writeFileSync(join(root, 'src', 'delta.md'), 'x\n')
  writeFileSync(join(root, 'src', 'skills', 's1', 'SKILL.md'), 'skill\n')
  writeFileSync(join(root, 'notify.sh'), '#!/usr/bin/env bash\ntrue\n', { mode: 0o755 })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function runSnapshot(extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [SNAPSHOT], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      RULEBOOK_REPO: join(root, 'repo'),
      RULEBOOK_MARVEEN_ROOT: join(root, 'src', 'marveen'),
      RULEBOOK_DELTA_CLAUDE: join(root, 'src', 'delta.md'),
      RULEBOOK_SKILLS_ROOT: join(root, 'src', 'skills'),
      RULEBOOK_NOTIFY: join(root, 'notify.sh'),
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      ...extra,
    },
  })
  return (r.stdout ?? '') + (r.stderr ?? '')
}

describe('minden naplosor megmondja, MIKOR es KI (5b6a78eb)', () => {
  it('idobelyeg + hivo-cimke minden soron', () => {
    const out = runSnapshot()
    const lines = out.split('\n').filter(l => l.includes('rulebook-snapshot:'))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) {
      expect(l, l).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[[a-z]+\] /)
    }
  })

  it('a HOOK-bol inditva a cimke `hook` -- a hook sajat jelzojebol, plist-modositas nelkul', () => {
    // A `SKILLS_SNAPSHOT_RUNNING`-ot a hook exportalja; ezert nem kellett a telepitett
    // plisthez nyulni (az kulon sav, kulon telepitessel).
    expect(runSnapshot({ SKILLS_SNAPSHOT_RUNNING: '1' })).toMatch(/\[hook\] rulebook-snapshot:/)
  })

  it('hivo-jelzes NELKUL `ismeretlen` -- NEM talalgatunk "launchd"-t', () => {
    // Egy kezi futtatas ugyanigy nezne ki, mint a launchd. A talalgatas itt ugyanaz a hiba
    // lenne, mint a nem-mert nulla: egy ertek, ami tobbet allit, mint amennyit tudunk.
    expect(runSnapshot()).toMatch(/\[ismeretlen\] rulebook-snapshot:/)
  })

  it('a kimondott `RULEBOOK_CALLER` NYER a kikovetkeztetett fole', () => {
    expect(runSnapshot({ SKILLS_SNAPSHOT_RUNNING: '1', RULEBOOK_CALLER: 'launchd' }))
      .toMatch(/\[launchd\] rulebook-snapshot:/)
  })

  it('A ZAR MEGTAGADASA IS NAPLOZODIK -- ez volt a lathatatlan esemeny', () => {
    // Enelkul a "nem volt verseny" es a "volt, es a zar megfogta" ugyanaz a csend.
    runSnapshot()                                    // letrehozza a repot
    mkdirSync(join(root, 'repo.lock'), { recursive: true })
    writeFileSync(join(root, 'repo.lock', 'pid'), `${process.pid}\n`)   // ELO zar
    const out = runSnapshot({ SKILLS_SNAPSHOT_RUNNING: '1' })
    expect(out).toMatch(/\[hook\] rulebook-snapshot: another instance holds the lock/)
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /m)
  })
})

describe('a HOOK a naploba ir, nem a /dev/null-ba (5b6a78eb)', () => {
  // A HOOKNAK KET AGA VAN, es ezen a gepen CSAK AZ EGYIK fut: macOS-en nincs `timeout`, tehat
  // mindig a hatterbe-inditos ag megy. Ezt egy MUTACIO mutatta meg: a `timeout`-os agat
  // visszaallitottam `>/dev/null`-ra, es MIND A HAT teszt zold maradt -- vagyis azt az agat
  // nem mertem. A telepitok Linuxra is celoznak, ahol `timeout` VAN, tehat ott az az ag fut.
  // Ezert a masodik teszt egy `timeout` SHIM-et tesz a PATH elejere, es igy MINDKET ag merve van.
  function runHook(log: string, stub: string, skills: string, extraPath?: string) {
    return spawnSync('bash', [HOOK], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        ...(extraPath ? { PATH: `${extraPath}:${process.env.PATH ?? ''}` } : {}),
        SKILLS_SNAPSHOT_ROOT: skills,
        SKILLS_SNAPSHOT_STAMP: join(root, `stamp-${Math.random().toString(36).slice(2)}`),
        SKILLS_SNAPSHOT_CMD: stub,
        SKILLS_SNAPSHOT_LOG: log,
        SKILLS_SNAPSHOT_RUNNING: '0',
      },
    })
  }

  function fixture(tag: string) {
    const log = join(root, `${tag}.log`)
    const stub = join(root, `${tag}-stub.sh`)
    writeFileSync(stub, `#!/usr/bin/env bash\necho "STUB-SOR ${tag}"\n`, { mode: 0o755 })
    const skills = join(root, `${tag}-skills`)
    mkdirSync(join(skills, 's'), { recursive: true })
    writeFileSync(join(skills, 's', 'SKILL.md'), 'x\n')
    return { log, stub, skills }
  }

  it('a HATTER-ag kimenete megerkezik a naplofajlba (ez fut macOS-en)', () => {
    const f = fixture('hatter')
    const r = runHook(f.log, f.stub, f.skills)
    expect(r.status).toBe(0)                    // a hook fail-open marad
    expect(existsSync(f.log), 'a naplofajl nem jott letre -- a kimenet megint eldobodott').toBe(true)
    expect(readFileSync(f.log, 'utf-8')).toMatch(/STUB-SOR hatter/)
  })

  it('a `timeout`-os ag kimenete IS megerkezik (shim a PATH-on -- Linuxon ez fut)', () => {
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    // A shim eldobja az elso argumentumot (a masodperceket) es futtatja a tobbit.
    writeFileSync(join(bin, 'timeout'), '#!/usr/bin/env bash\nshift\nexec "$@"\n', { mode: 0o755 })
    const f = fixture('timeoutag')
    const r = runHook(f.log, f.stub, f.skills, bin)
    expect(r.status).toBe(0)
    expect(existsSync(f.log), 'a `timeout`-os ag megint /dev/null-ba ir').toBe(true)
    expect(readFileSync(f.log, 'utf-8')).toMatch(/STUB-SOR timeoutag/)
  })

})

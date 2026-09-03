import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  readdirSync,
  chmodSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { enrollAuthorizedKey } from '../remote-enroll-fs.js'
import { buildRestrictedLine, validatePublicKeyLine } from '../remote-enroll-core.js'

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function ed25519Base64(keyByte = 0x42): string {
  const type = Buffer.from('ssh-ed25519', 'utf8')
  const key = Buffer.alloc(32, keyByte)
  const len = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n, 0)
    return b
  }
  return Buffer.concat([len(type.length), type, len(32), key]).toString('base64')
}

const B64 = ed25519Base64()
const RESTRICTED = buildRestrictedLine(
  validatePublicKeyLine(`ssh-ed25519 ${B64} marveen-remote:${UUID}`),
)

describe('enrollAuthorizedKey (filesystem)', () => {
  let root: string
  let sshDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'remote-enroll-'))
    sshDir = join(root, '.ssh')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('creates .ssh (0700) and authorized_keys (0600) when missing', async () => {
    const res = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(res.action).toBe('added')
    expect(statSync(sshDir).mode & 0o777).toBe(0o700)
    const authPath = join(sshDir, 'authorized_keys')
    expect(statSync(authPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(authPath, 'utf8')).toBe(RESTRICTED + '\n')
    expect(res.warnings).toEqual([])
  })

  it('reports keyCount AFTER the merge -- the growth number the pile-up rests on', async () => {
    // Card 717ba23d: ~/.ssh/authorized_keys stood at 646 lines / 646 distinct install ids
    // on 2026-09-03, up from 431 on 08-25, and the enrolment path logged nothing -- so the
    // growth could not be attributed. keyCount is counted here because this is the one place
    // the merged content exists under the lock.
    const first = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(first.keyCount).toBe(1)

    // A DIFFERENT install id adds a line -- this is the growth being measured.
    const other = RESTRICTED.replace(UUID, '11111111-2222-4333-8444-555555555555')
    const second = await enrollAuthorizedKey({
      sshDir, restrictedLine: other, installId: '11111111-2222-4333-8444-555555555555',
    })
    expect(second.keyCount).toBe(2)

    // The SAME install id replaces rather than appends, so the count must NOT move.
    // Without this the field would look right while silently counting duplicates.
    const again = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(again.keyCount).toBe(2)
  })

  it('appends and preserves an existing unrelated key byte-for-byte', async () => {
    mkdirSync(sshDir, { mode: 0o700 })
    const authPath = join(sshDir, 'authorized_keys')
    const prior = 'ssh-rsa AAAA someone@host\n'
    writeFileSync(authPath, prior, { mode: 0o600 })
    const res = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(res.action).toBe('added')
    expect(readFileSync(authPath, 'utf8')).toBe(prior + RESTRICTED + '\n')
  })

  it('replaces by id on re-enrollment', async () => {
    mkdirSync(sshDir, { mode: 0o700 })
    const authPath = join(sshDir, 'authorized_keys')
    const stale = `restrict ssh-ed25519 OLDKEY marveen-remote:${UUID}`
    writeFileSync(authPath, `ssh-rsa AAAA a@h\n${stale}\n`, { mode: 0o600 })
    const res = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(res.action).toBe('replaced')
    const content = readFileSync(authPath, 'utf8')
    expect(content).toBe(`ssh-rsa AAAA a@h\n${RESTRICTED}\n`)
    expect(content).not.toContain('OLDKEY')
  })

  it('warns when .ssh permissions are looser than 0700', async () => {
    mkdirSync(sshDir, { mode: 0o755 })
    chmodSync(sshDir, 0o755)
    const res = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(res.warnings.some((w) => w.includes('0755') && w.includes('0700'))).toBe(true)
  })

  it('warns when existing authorized_keys is looser than 0600 and rewrites 0600', async () => {
    mkdirSync(sshDir, { mode: 0o700 })
    const authPath = join(sshDir, 'authorized_keys')
    writeFileSync(authPath, 'ssh-rsa AAAA a@h\n')
    chmodSync(authPath, 0o644)
    const res = await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    expect(res.warnings.some((w) => w.includes('0644'))).toBe(true)
    expect(statSync(authPath).mode & 0o777).toBe(0o600)
  })

  it('leaves no temp files behind and removes the lockfile', async () => {
    await enrollAuthorizedKey({ sshDir, restrictedLine: RESTRICTED, installId: UUID })
    const entries = readdirSync(sshDir)
    expect(entries).toContain('authorized_keys')
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
    expect(entries).not.toContain('authorized_keys.lock')
  })

  it('fails fast when a fresh (non-stale) lockfile is held', async () => {
    mkdirSync(sshDir, { mode: 0o700 })
    // Simulate a concurrent holder with a current lockfile.
    writeFileSync(join(sshDir, 'authorized_keys.lock'), '99999\n')
    await expect(
      enrollAuthorizedKey({
        sshDir,
        restrictedLine: RESTRICTED,
        installId: UUID,
        lockRetries: 3,
        lockRetryDelayMs: 1,
        staleLockMs: 60000,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/could not acquire/)
  })

  it('breaks a stale lock and proceeds', async () => {
    mkdirSync(sshDir, { mode: 0o700 })
    const lockPath = join(sshDir, 'authorized_keys.lock')
    writeFileSync(lockPath, 'dead\n')
    // Force the lock to look old.
    const past = new Date(Date.now() - 60000)
    // utimesSync needs seconds; use fs
    const { utimesSync } = await import('node:fs')
    utimesSync(lockPath, past, past)
    const res = await enrollAuthorizedKey({
      sshDir,
      restrictedLine: RESTRICTED,
      installId: UUID,
      staleLockMs: 1000,
      sleep: () => Promise.resolve(),
    })
    expect(res.action).toBe('added')
    expect(existsSync(lockPath)).toBe(false)
  })
})

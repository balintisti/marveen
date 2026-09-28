import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

const SECURITY = '/usr/bin/security'
const SERVICE = 'com.marveen.vault'
const ACCOUNT = 'master-key'

// A locked keychain makes `security` pop a GUI unlock prompt and block
// indefinitely; without a timeout that freezes the whole dashboard (measured
// 2026-08-22: 48-minute HTTP outage from exactly this, VAULTKEY822). The
// timeout turns a hung call into a loud 'unavailable' instead.
const SECURITY_TIMEOUT_MS = 5000

// errSecItemNotFound: the keychain ANSWERED and the item does not exist.
// Everything else (timeout, locked keychain, auth failure) means the keychain
// did not answer -- callers must treat that as unavailable, never as "no key".
const EXIT_ITEM_NOT_FOUND = 44

export function isKeychainAvailable(): boolean {
  // Platform gate only. Whether the keychain actually answers is decided by
  // keychainRetrieveStatus() at each decision point -- a platform check alone
  // said "available" on a locked keychain and enabled the silent key swap
  // (VAULTUJKULCS822).
  return platform() === 'darwin'
}

export type KeychainReadStatus = 'ok' | 'empty' | 'unavailable'
export interface KeychainReadResult {
  status: KeychainReadStatus
  value: string | null
}

export function keychainRetrieveStatus(): KeychainReadResult {
  try {
    const out = execFileSync(SECURITY, [
      'find-generic-password',
      '-s', SERVICE,
      '-a', ACCOUNT,
      '-w',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SECURITY_TIMEOUT_MS })
    const value = out.trim()
    return value ? { status: 'ok', value } : { status: 'empty', value: null }
  } catch (err: any) {
    if (err?.status === EXIT_ITEM_NOT_FOUND) return { status: 'empty', value: null }
    return { status: 'unavailable', value: null }
  }
}

export function keychainRetrieve(): string | null {
  return keychainRetrieveStatus().value
}

// The value goes on STDIN of `security -i`, NEVER on argv (card 612bf2f1). As `-w <value>`
// the master key was readable in `ps` by any local process for the duration of the call.
// Measured 2026-09-28 on the real binary with a throwaway item: `-i` passes the inner
// command's exit code through (a duplicate add gives 45 under both forms, an unknown command
// 1), and a base64 value round-trips byte-identical -- so the throw callers rely on survives.
//
// The inner line is parsed by `security`, not a shell: a double quote, backslash or line
// break in the value would change the command it reads. The vault's keys are base64 and can
// hold none of these, so such a value is refused rather than escaped on a guess.
export function keychainStore(value: string): void {
  if (!value || /["\\\r\n]/.test(value)) {
    throw new Error('keychainStore: refusing a value that is empty or holds a quote, backslash or line break')
  }
  execFileSync(SECURITY, ['-i'], {
    input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w "${value}" -A\n`,
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: SECURITY_TIMEOUT_MS,
  })
  // A 0 exit is not proof the item holds THIS value; the read-back is. Both callers in
  // vault.ts act on a return (rename .vault-key away, or drop the only copy of a fresh key),
  // so a store that did not land must throw here, as the argv form did.
  const back = keychainRetrieveStatus()
  if (back.status !== 'ok' || back.value !== value) {
    throw new Error(`keychainStore: stored, but the read-back does not match (${back.status})`)
  }
}

export function keychainDelete(): boolean {
  try {
    execFileSync(SECURITY, [
      'delete-generic-password',
      '-s', SERVICE,
      '-a', ACCOUNT,
    ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: SECURITY_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

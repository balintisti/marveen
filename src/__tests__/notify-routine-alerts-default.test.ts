import { describe, expect, it, vi } from 'vitest'

// Card 87687aca (owner TG 9187, 2026-11-05): on this install routine self-repair
// alerts are OFF unless the key is set. This reads the REAL boot-time const in
// src/config.ts (not the registry entry, which only documents the default), with
// .env stubbed: an install that never sets the key must get false.
const h = vi.hoisted(() => ({ env: {} as Record<string, string> }))

vi.mock('../env.js', async (orig) => {
  const actual = await orig<typeof import('../env.js')>()
  return {
    ...actual,
    readEnvFile: (keys?: string[]) => {
      if (!keys) return { ...h.env }
      return Object.fromEntries(keys.filter((k) => k in h.env).map((k) => [k, h.env[k]]))
    },
  }
})

async function loadSwitch(env: Record<string, string>): Promise<boolean> {
  h.env = env
  vi.resetModules()
  const { NOTIFY_ROUTINE_ALERTS } = await import('../config.js')
  return NOTIFY_ROUTINE_ALERTS
}

describe('NOTIFY_ROUTINE_ALERTS boot-time default (card 87687aca)', () => {
  it('key unset: routine alerts are off', async () => {
    expect(await loadSwitch({})).toBe(false)
  })

  it('explicit 1: routine alerts are on (the way back)', async () => {
    expect(await loadSwitch({ NOTIFY_ROUTINE_ALERTS: '1' })).toBe(true)
  })

  it.each(['0', 'false', 'no', 'off', ' OFF '])('explicit %j: off', async (value) => {
    expect(await loadSwitch({ NOTIFY_ROUTINE_ALERTS: value })).toBe(false)
  })
})

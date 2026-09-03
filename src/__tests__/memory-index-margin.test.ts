import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK = join(REPO, 'scripts', 'hooks', 'memory-index-margin.sh')

// Card 5071c32b. One physical MEMORY.md serves six agents through a symlink and a
// TRUNCATING loader reads it: past 200 lines the tail is dropped, past 25000
// characters it is cut, and the agent that saved gets no signal either way.
// marveen reverted it to a safe value at 13:57 on 2026-09-03; thirty-two minutes
// later it was back at 200/200 lines and 24942/25000 characters.
function indexOf(lines: number, chars: number) {
  const home = mkdtempSync(join(tmpdir(), 'memidx-'))
  const per = Math.max(1, Math.floor(chars / lines))
  const rows: string[] = []
  for (let i = 0; i < lines - 1; i++) rows.push('x'.repeat(per - 1))
  const used = rows.reduce((n, r) => n + r.length + 1, 0)
  rows.push('y'.repeat(Math.max(0, chars - used - 1)))
  const file = join(home, 'MEMORY.md')
  writeFileSync(file, rows.join('\n') + '\n')
  return { home, file }
}

function run(file: string, home: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', [HOOK], {
    encoding: 'utf-8',
    env: { ...process.env, MEMORY_INDEX_PATH: file, MEMORY_INDEX_STAMP: join(home, 'stamp'), ...env },
  })
  return { status: r.status, stderr: r.stderr ?? '' }
}

describe('memory-index-margin hook', () => {
  it('NEVER refuses -- exit 0 even when the index is full', () => {
    // marveen's decision and his reason: refusing an index LINE loses the lesson
    // from the screen, but refusing the memory SAVE means it is never written
    // down at all. This side only ever warns.
    const { home, file } = indexOf(200, 24942)
    try {
      expect(run(file, home).status).toBe(0)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('warns at the real state that prompted the card, with BOTH numbers', () => {
    const { home, file } = indexOf(200, 24942)
    try {
      const { stderr } = run(file, home)
      expect(stderr).toContain('200/200')
      expect(stderr).toContain('24942/25000')
      // A number without its remaining margin is not actionable.
      expect(stderr).toMatch(/maradek/)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('stays SILENT with real headroom -- or it becomes noise and gets muted', () => {
    const { home, file } = indexOf(120, 15000)
    try {
      expect(run(file, home).stderr.trim()).toBe('')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('does not repeat on every tool call', () => {
    // It fires from PostToolUse. Unthrottled it would print on each call and be
    // muted within the hour -- the fate of any guard that is permanently red.
    const { home, file } = indexOf(200, 24942)
    try {
      expect(run(file, home).stderr).not.toBe('')
      expect(run(file, home).stderr.trim()).toBe('')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('carries the trim invariant, not just the number', () => {
    // dexter's point, and the reason it belongs HERE: the refusal message was the
    // place the advice would actually be read, so it was the worst place for bad
    // advice. A naive trim of the ten longest lines drops EIGHT memories, because
    // those lines are long from being CONSOLIDATED and their extra references sit
    // at the end.
    const { home, file } = indexOf(200, 24942)
    try {
      const { stderr } = run(file, home)
      expect(stderr).toContain('.md')
      expect(stderr).toMatch(/PROZAT vagj/)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('says NOTHING rather than a wrong-unit number when it cannot count characters', () => {
    // The mistake this hook exists downstream of: a BYTE figure read as
    // characters. On Hungarian prose they differ by about 6%.
    const { home, file } = indexOf(200, 24942)
    try {
      const r = spawnSync('/bin/bash', [HOOK], {
        encoding: 'utf-8',
        env: { HOME: home, PATH: '/nonexistent', MEMORY_INDEX_PATH: file, MEMORY_INDEX_STAMP: join(home, 'stamp') },
      })
      expect(r.status).toBe(0)
      expect((r.stderr ?? '').trim()).toBe('')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('is silent when the index does not exist at all', () => {
    const home = mkdtempSync(join(tmpdir(), 'memidx-none-'))
    try {
      const r = run(join(home, 'nope.md'), home)
      expect(r.status).toBe(0)
      expect(r.stderr.trim()).toBe('')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})

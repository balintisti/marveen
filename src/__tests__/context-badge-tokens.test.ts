import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Card c6240ab1: a context-guard percent above 100 (the guard's limitTokens is
// smaller than the real window, e.g. a 129% badge) read like an error. The grid
// badge and the settings pane now carry the absolute token count next to the
// percent. The pure helpers are lifted out of web/app.js and run here.
const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'app.js'), 'utf8')

function lift(name: string): string {
  const start = APP.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`function ${name} not found in web/app.js`)
  let depth = 0
  for (let i = APP.indexOf('{', start); i < APP.length; i++) {
    if (APP[i] === '{') depth++
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1)
  }
  throw new Error(`function ${name} not closed`)
}

const make = new Function(
  'agents',
  `${lift('formatContextTokens')}\n${lift('contextBadgeLabel')}\n${lift('contextTokensFor')}\nreturn { formatContextTokens, contextBadgeLabel, contextTokensFor }`,
)

describe('context badge shows absolute tokens over 100%', () => {
  const h = make([
    { name: 'mandark', contextTokens: 258000 },
    { name: 'zero', contextTokens: 0 },
    { name: 'main-agent', autoRestartId: 'marveen', contextTokens: 120000 },
  ])
  it('over 100% the label carries the token count', () => {
    expect(h.contextBadgeLabel(1.29, 258000)).toBe('129% · ≈258k token')
  })
  it('at or under 100% the label is the bare percent, as before', () => {
    expect(h.contextBadgeLabel(1.0, 258000)).toBe('100%')
    expect(h.contextBadgeLabel(0.42, 84000)).toBe('42%')
  })
  it('over 100% without a token count stays a bare percent (no invented number)', () => {
    expect(h.contextBadgeLabel(1.29, null)).toBe('129%')
  })
  it('looks the tokens up by name or by autoRestartId; zero or unknown is null', () => {
    expect(h.contextTokensFor('mandark')).toBe(258000)
    expect(h.contextTokensFor('marveen')).toBe(120000)
    expect(h.contextTokensFor('zero')).toBeNull()
    expect(h.contextTokensFor('nobody')).toBeNull()
  })
})

/**
 * THE LEAN WORKER TYPE (card dc5d2e53, stage B of ecbb62e6).
 *
 * The type starts without the parent's rule sheet, so its BODY is every rule the worker holds.
 * Three things can go wrong without anybody seeing it, and each has a case here:
 *   - the body text drifts from the approved one (didi's text, ecbb62e6 comment 58694, approved
 *     by marveen 58681): pinned by hash, so an edit has to be a decision;
 *   - the frontmatter key that drops the sheet moves or is misspelled: Claude Code ignores an
 *     unknown key without a word;
 *   - a placeholder survives the render and leaves a hole in a boundary rule.
 *
 * NOT PINNED HERE, because no test can: that Claude Code honours the key (the proof is the
 * first-prompt token count of a launch), and that a worker obeys the body. Both are measured
 * on the card, and both have to be measured again after a Claude Code upgrade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const warn = vi.hoisted(() => vi.fn())
vi.mock('../logger.js', () => ({
  logger: { warn, info: () => {}, debug: () => {}, error: () => {} },
}))

const { ensureLeanWorker, resolveTemplatePlaceholders } = await import('../web/agent-scaffold.js')
const { PROJECT_ROOT } = await import('../config.js')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEMPLATE_PATH = join(ROOT, 'templates', 'sub-agents', 'lean-worker.md')
const shipped = readFileSync(TEMPLATE_PATH, 'utf8')

// The install the text was approved on. The template says {{PROJECT_ROOT}} instead, so the
// rendered body is compared with this root put back.
const APPROVED_ROOT = '/Users/isti/marveen'
const APPROVED_BODY_SHA1 = 'f80f9eb86566be0848fbad0d04ec04d1ca5a40a2'

function split(text: string): { frontmatter: string; body: string } {
  expect(text.startsWith('---\n')).toBe(true)
  const end = text.indexOf('\n---\n', 4)
  expect(end).toBeGreaterThan(0)
  return { frontmatter: text.slice(4, end + 1), body: text.slice(end + 5) }
}
const rendered = () => resolveTemplatePlaceholders(shipped)

beforeEach(() => warn.mockClear())

describe('the shipped lean-worker definition', () => {
  it('drops the rule sheet with a root-level key in the frontmatter, not in the body', () => {
    const { frontmatter, body } = split(rendered())
    expect(frontmatter).toMatch(/^name: lean-worker$/m)
    expect(frontmatter).toMatch(/^omitClaudeMd: true$/m)
    expect(body).not.toContain('omitClaudeMd')
  })

  it('has the four file-and-shell tools and nothing that reaches outward or spawns', () => {
    const tools = split(rendered()).frontmatter.match(/^tools: (.*)$/m)?.[1].split(',').map(t => t.trim())
    expect(tools).toEqual(['Bash', 'Read', 'Edit', 'Write'])
  })

  it('tells the PARENT what the type is not for (the description is all the parent sees)', () => {
    const description = split(rendered()).frontmatter.match(/^description: "(.*)"$/m)?.[1] ?? ''
    for (const excluded of ['kanban', 'messages to agents', 'push', 'production', 'web research', 'skill']) {
      expect(description, excluded).toContain(excluded)
    }
    expect(description).toContain('Use general-purpose for those')
  })

  it('the body is the approved text, to the byte', () => {
    const body = split(rendered()).body.split(PROJECT_ROOT).join(APPROVED_ROOT)
    expect(
      createHash('sha1').update(body).digest('hex'),
      'the lean-worker body is not the approved text (ecbb62e6 comment 58694, approved by marveen 58681). ' +
        'A change to it needs a new approval; then update APPROVED_BODY_SHA1.',
    ).toBe(APPROVED_BODY_SHA1)
  })

  it('says in its first lines what it is not for, before any other rule', () => {
    const lines = split(rendered()).body.split('\n')
    expect(lines[0].startsWith('You are a LEAN WORKER sub-agent')).toBe(true)
    const notFor = lines.findIndex(l => l.startsWith('NOT FOR THIS TYPE'))
    const limits = lines.findIndex(l => l.startsWith('HARD LIMITS'))
    expect(notFor).toBeGreaterThan(0)
    expect(notFor).toBeLessThan(5)
    expect(limits).toBeGreaterThan(notFor)
    const excluded = lines.slice(notFor, limits).join('\n')
    for (const word of ['kanban writes', 'inter-agent messages', 'push', 'release', 'live customer data']) {
      expect(excluded, word).toContain(word)
    }
  })

  it('names the install root through the placeholder only, so it survives a host move', () => {
    expect(shipped).not.toContain('/Users/')
    expect(shipped.split('{{PROJECT_ROOT}}').length - 1).toBe(3)
    expect(rendered()).not.toMatch(/\{\{[A-Za-z_]+\}\}/)
    expect(rendered().split(PROJECT_ROOT).length - 1).toBe(3)
  })
})

describe('ensureLeanWorker', () => {
  const setup = () => {
    const root = mkTmp('lean-worker-')
    return { tplPath: TEMPLATE_PATH, destDir: join(root, 'agent', '.claude', 'agents') }
  }
  const deployed = (destDir: string) => join(destDir, 'lean-worker.md')

  it('writes the rendered definition, then reports nothing to do', () => {
    const paths = setup()
    expect(ensureLeanWorker('probe', paths)).toBe(true)
    expect(readFileSync(deployed(paths.destDir), 'utf8')).toBe(rendered())
    expect(ensureLeanWorker('probe', paths)).toBe(false)
  })

  it('replaces a hand-edited copy: a rule removed on disk comes back', () => {
    const paths = setup()
    ensureLeanWorker('probe', paths)
    writeFileSync(deployed(paths.destDir), rendered().replace('NO contact with production at all', 'production is fine'))
    expect(ensureLeanWorker('probe', paths)).toBe(true)
    expect(readFileSync(deployed(paths.destDir), 'utf8')).toBe(rendered())
  })

  it('does not deploy a body with an unresolved placeholder, and says so', () => {
    const paths = setup()
    const broken = join(dirname(paths.destDir), 'broken.md')
    mkdirSync(dirname(broken), { recursive: true })
    writeFileSync(broken, shipped.replace('{{PROJECT_ROOT}}', '{{PROJECT_HOME}}'))
    expect(ensureLeanWorker('probe', { ...paths, tplPath: broken })).toBe(false)
    expect(existsSync(deployed(paths.destDir))).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatchObject({ agent: 'probe', placeholder: '{{PROJECT_HOME}}' })
  })

  it('a missing template deploys nothing and creates nothing', () => {
    const paths = setup()
    expect(ensureLeanWorker('probe', { ...paths, tplPath: join(paths.destDir, 'no-such.md') })).toBe(false)
    expect(existsSync(paths.destDir)).toBe(false)
  })
})

describe('the lean worker is deployed wherever the reader is', () => {
  // Correspondence, not presence: every place that deploys the reader for an agent deploys the
  // lean worker for THE SAME agent on the next line. A new deploy site that forgets it fails here.
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory()
        ? (e.name === '__tests__' ? [] : sources(join(dir, e.name)))
        : (e.name.endsWith('.ts') ? [join(dir, e.name)] : []))

  it('each reader deploy statement is followed by the lean-worker deploy with the same argument', () => {
    const sites: string[] = []
    for (const file of sources(join(ROOT, 'src'))) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const call = line.match(/^\s*ensureQuarantineReader\((\w+)\)\s*$/)
        if (!call) return
        sites.push(file)
        expect(lines[i + 1].trim(), `${file}:${i + 2}`).toBe(`ensureLeanWorker(${call[1]})`)
      })
    }
    // the scaffold of a new agent and the dashboard start: if this count is 0 the pattern matched nothing
    expect(sites.map(f => f.slice(ROOT.length + 1)).sort()).toEqual(['src/web.ts', 'src/web/agent-scaffold.ts'])
  })
})

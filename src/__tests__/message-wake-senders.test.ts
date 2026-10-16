// Card a85a9acd: WHO marks a message quiet. The decision names exactly three senders; every other
// createAgentMessage caller stays waking. The behaviour of each is tested where it can be driven
// (idle-guard-quiet-notices.test.ts); this census pins that nobody else slipped a wake option in,
// and that the three call sites pass the PURE decision rather than a literal.
//
// It reads the syntax tree, not the text: a regex over the source pins presence, not position
// (this repo measured what that is worth), and a `wake:` in a comment must not count.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC_ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') continue
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p)
  }
  return out
}

async function wakeOptionSites(): Promise<Array<{ file: string; option: string }>> {
  const ts = (await import('typescript')).default
  const sites: Array<{ file: string; option: string }> = []
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('createAgentMessage')) continue
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    ;(function visit(n: import('typescript').Node) {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'createAgentMessage' && n.arguments.length >= 6) {
        sites.push({ file: file.slice(SRC_ROOT.length + 1), option: n.arguments[5].getText(sf).replace(/\s+/g, ' ') })
      }
      ts.forEachChild(n, visit)
    })(sf)
  }
  return sites.sort((a, b) => (a.file + a.option).localeCompare(b.file + b.option))
}

describe('createAgentMessage callers that pass a wake option', () => {
  it('are exactly the three decided senders, each passing the pure decision', async () => {
    expect(await wakeOptionSites()).toEqual([
      // (a) context-guard "Ujrainditottam": quiet only when nothing is left to resend
      { file: 'web/context-guard-runner.ts', option: '{ wake: restartNoticeWakes(lossNeedsAction, decision.nextState.handoffStaleMinutes) }' },
      // (b) + (c) the idle guard: the blind-pane report, and the repeated [uzenet-or]
      { file: 'web/idle-agent-watcher.ts', option: '{ wake }' },
      { file: 'web/idle-agent-watcher.ts', option: '{ wake: messageGuardNoticeWakes(msgs, priorCovered) }' },
    ])
  })
})

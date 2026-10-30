// Card 782d9c7f: the context guard's "Ujrainditottam" notice to the coordinator closes itself when
// the restart-window triage is empty, and stays open (delivered to the coordinator) when the triage
// found something to resend or could not measure. Three layers, because nothing drives the runner's
// 'restart' branch as behaviour: the pure decision, the real queue, and the runner's wiring read
// from the syntax tree (position, not presence).
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initDatabase, createAgentMessage, markMessageDone, getAgentMessage, getPendingMessages } from '../db.js'
import { restartNoticeClosesItself, restartNoticeWakes, RESTART_NOTICE_AUTOCLOSED } from '../context-guard.js'

describe('restartNoticeClosesItself: only a MEASURED, EMPTY triage closes the notice', () => {
  it('empty measured window: closes', () => {
    expect(restartNoticeClosesItself(false)).toBe(true)
  })
  it('something to resend: stays open for the coordinator', () => {
    expect(restartNoticeClosesItself(true)).toBe(false)
  })
  it('a failed measurement is NOT an empty triage: stays open', () => {
    expect(restartNoticeClosesItself(null)).toBe(false)
  })
  it('a stale handoff or killed work does not keep an empty triage open (the agent has them in its own resume directive)', () => {
    // restartNoticeWakes is still true for a stale handoff, the closing decision is independent of it.
    expect(restartNoticeWakes(false, 25)).toBe(true)
    expect(restartNoticeClosesItself(false)).toBe(true)
  })
})

describe('a self-closed notice on the real queue', () => {
  beforeAll(() => { initDatabase(':memory:') })

  it('born closed: done, never pending, no delivery work for the router, text and result kept for the audit', () => {
    const to = 'coordinator-782d'
    const notice = createAgentMessage('sirius', to, '[CONTEXT-GUARD] Ujrainditottam a(z) "sirius" agentet', 'context-guard restart notice', undefined, { wake: false })
    expect(getPendingMessages(to).map((m) => m.id)).toContain(notice.id)
    expect(markMessageDone(notice.id, RESTART_NOTICE_AUTOCLOSED)).toBe(true)
    const row = getAgentMessage(notice.id)
    expect(row?.status).toBe('done')
    expect(row?.result).toBe(RESTART_NOTICE_AUTOCLOSED)
    expect(row?.content).toContain('Ujrainditottam')
    expect(getPendingMessages(to).map((m) => m.id)).not.toContain(notice.id)
  })

  it('POSITIVE CONTROL: a notice that is not closed stays pending for the coordinator', () => {
    const to = 'coordinator-782d-open'
    const notice = createAgentMessage('sirius', to, '[CONTEXT-GUARD] Ujrainditottam', 'context-guard restart notice')
    expect(getPendingMessages(to).map((m) => m.id)).toContain(notice.id)
  })
})

describe('the runner closes the notice it just wrote, on the decision and nowhere else', () => {
  it('createAgentMessage(... Ujrainditottam) is assigned to `notice`; the NEXT statement closes it iff restartNoticeClosesItself', async () => {
    const ts = (await import('typescript')).default
    const file = join(__dirname, '..', 'web', 'context-guard-runner.ts')
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const found: string[] = []
    ;(function visit(n: import('typescript').Node) {
      if (ts.isBlock(n)) {
        n.statements.forEach((st, i) => {
          if (!ts.isVariableStatement(st)) return
          const d = st.declarationList.declarations[0]
          const init = d?.initializer
          if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'createAgentMessage') return
          if (!init.getText(sf).includes('Ujrainditottam')) return
          const next = n.statements[i + 1]
          found.push(`${d.name.getText(sf)} | ${next ? next.getText(sf).replace(/\s+/g, ' ') : 'NONE'}`)
        })
      }
      ts.forEachChild(n, visit)
    })(sf)
    expect(found).toEqual([
      'notice | if (restartNoticeClosesItself(lossNeedsAction)) markMessageDone(notice.id, RESTART_NOTICE_AUTOCLOSED)',
    ])
  })

  it('the 6th argument (the wake decision) is untouched: the closing is a separate statement', () => {
    const text = readFileSync(join(__dirname, '..', 'web', 'context-guard-runner.ts'), 'utf8')
    expect(text).toContain('{ wake: restartNoticeWakes(lossNeedsAction, decision.nextState.handoffStaleMinutes) }')
  })
})

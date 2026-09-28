// THE PATHS THE AUTO-WRITTEN SECTIONS PRINT (88c366f2 merge, P13; marveen 20016).
//
// The P13 before/after dump was generated with PROJECT_ROOT mocked to a temp dir, so its token
// path read /var/folders/.../root/store/.dashboard-token. marveen asked for proof that the real
// generator prints the install's path, and for a guard against a temp path ever reaching a sheet.
// These call the section builders with the REAL config (no mock, no file written): tokenPath is
// join(PROJECT_ROOT, 'store', '.dashboard-token'), built once at module load.
//
// One /tmp stays on purpose and is named: the memory-search recipe dumps the response headers to
// /tmp/mem-fejlec-<agent>.txt (upstream's recipe, unchanged by the shortening).
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { PROJECT_ROOT } from '../config.js'
import {
  buildSystemDirectiveAuthBody,
  buildMemorySearchLabelBody,
  buildFleetAuthBody,
  buildEvidenceBody,
  buildMessageCloseBody,
} from '../web/agent-scaffold.js'

const TOKEN = join(PROJECT_ROOT, 'store', '.dashboard-token')
const bodies = (name: string) => ({
  'system-directive-auth': buildSystemDirectiveAuthBody(name),
  'memory-search-label': buildMemorySearchLabelBody(name),
  'fleet-auth': buildFleetAuthBody(),
  'evidence-main': buildEvidenceBody(true),
  'evidence-sub': buildEvidenceBody(false),
  'message-close': buildMessageCloseBody(),
})

describe('generated sections print the install\'s paths, never a temp dir (P13)', () => {
  it('CONTROL: the real PROJECT_ROOT is not itself a temp dir (else the guard below proves nothing)', () => {
    expect(PROJECT_ROOT).not.toMatch(/^\/(?:var\/folders|tmp|private\/tmp)\//)
  })

  it('the three sections with a curl recipe read the token from <PROJECT_ROOT>/store', () => {
    const b = bodies('friday')
    for (const k of ['system-directive-auth', 'memory-search-label', 'message-close'] as const) {
      expect(b[k]).toContain(`cat ${TOKEN}`)
    }
  })

  it('no section contains /var/folders; /tmp only as the named header-dump file', () => {
    for (const [k, body] of Object.entries(bodies('friday'))) {
      expect(body, k).not.toContain('/var/folders')
      const tmp = [...body.matchAll(/\/tmp\/[^\s"'`]*/g)].map((m) => m[0])
      for (const t of tmp) expect(t, `${k}: ${t}`).toMatch(/^\/tmp\/mem-fejlec-friday\.txt$/)
    }
  })
})

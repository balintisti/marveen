#!/usr/bin/env node
// Probe ONE Claude plan's live usage and record it in store/claude-plans-state.json.
//
// Card 9d4f3ac7 (2026-10-06): the per-plan quota guard (QUOTA_CEILING_PLAN in
// scripts/quota-ceiling-guard.sh) needs a fresh reading of the plan the fleet is
// actually on. usage-collect.py cannot give it -- it reads the HOST keychain
// account -- and the rotation check's own probe skips the main agent's ACTIVE
// plan by design, so the plan everyone runs on was the one never probed.
//
// Same mechanism as the dashboard's "Check now": one minimal Messages call with
// the plan's vault token (src/claude-plan-usage-probe.ts), headers parsed, the
// observation recorded. The token never leaves the request header; this script
// prints only the plan id, status and the weekly percent.
//
// Usage: node scripts/claude-plan-probe.mjs <planId>    exit 0 = recorded, 1 = failed
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = (rel) => import(pathToFileURL(join(ROOT, 'dist', rel)).href)

const planId = process.argv[2]
if (!planId || !/^[a-z0-9_-]+$/.test(planId)) {
  console.error('usage: claude-plan-probe.mjs <planId>')
  process.exit(2)
}
const { readClaudePlans } = await mod('web/claude-plans.js')
const { readClaudePlansState, writeClaudePlansState, recordPlanObservation } = await mod('web/claude-plans-state.js')
const { probePlanUsage, observationFromProbe } = await mod('claude-plan-usage-probe.js')
const { getSecret } = await mod('web/vault.js')

const plan = readClaudePlans().find((p) => p.id === planId)
if (!plan || !plan.tokenSecretId) {
  console.error(`claude-plan-probe: plan=${planId} unknown or has no tokenSecretId`)
  process.exit(1)
}
let token = null
try { token = getSecret(plan.tokenSecretId) } catch { token = null }
if (!token) {
  console.error(`claude-plan-probe: plan=${planId} token missing from vault`)
  process.exit(1)
}
const result = await probePlanUsage(token)
token = null
const nowMs = Date.now()
const state = readClaudePlansState()
const obs = observationFromProbe(result, state.plans?.[planId], nowMs)
writeClaudePlansState(recordPlanObservation(state, planId, obs))
const week = obs.windows?.seven_day?.usedPercent
console.log(`claude-plan-probe: plan=${planId} ok=${result.ok}${result.ok ? '' : ` error=${result.error} status=${result.httpStatus ?? '-'}`} seven_day=${week ?? '-'}%`)
process.exit(obs.observedAt === nowMs ? 0 : 1)

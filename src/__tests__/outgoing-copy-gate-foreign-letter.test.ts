import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()
// FOREIGNLETTER924 (card c61d5270): a non-Hungarian LETTER gets a NAMED WARNING on every
// outgoing path, and never a block. The measured specimen is `fordìtott` with U+00EC
// (i WITH GRAVE) where Hungarian has U+00ED (i WITH ACUTE): it passes the homoglyph check
// by construction, because the character's Unicode name starts with LATIN.
//
// What these tests pin, and why each one exists:
//   - the specimen warns, and the warning names the CHARACTER (a bare count once hid five
//     correct words behind a number that looked like a finding);
//   - the correct word is silent (negative control);
//   - a Cyrillic lookalike is still BLOCKED by the homoglyph check, not downgraded to a
//     warning by the new code;
//   - a Serbian name warns and PASSES: a block would refuse correct text about customers;
//   - quotes, arrows and emoji are silent: they are not letters, and the whole-character
//     variant flagged 7.4% of owner-facing Telegram, mostly emoji;
//   - the eighteen Hungarian letters are exactly the allowed set: a missing one is a false
//     alarm, an added one lets a real defect through.
// Every non-ASCII test character is built from its code point, so this file never carries
// a literal lookalike.

const ROOT = join(__dirname, '..', '..')
const GATE = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')
const cp = (...codes: number[]) => String.fromCodePoint(...codes)

const I_GRAVE = cp(0xec)
const I_ACUTE = cp(0xed)
const SPECIMEN = `ford${I_GRAVE}tott`
const CORRECT = `ford${I_ACUTE}tott`
const CYR_I = cp(0x456)
const SERBIAN = `Markovi${cp(0x107)}`
const HU18 = 'áéíóöőúüűÁÉÍÓÖŐÚÜŰ'

// A fully accented Hungarian carrier sentence, so the accent audit on the Telegram and
// email paths has nothing to block and only the new warning can speak.
const carrier = (word: string) =>
  `Szia, a jelentést ${word} sorrendben küldöm, mert így olvashatóbb. Kérlek, nézd meg, és szólj.`

let dir: string
beforeAll(() => { dir = mkTmp('foreignletter-') })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function hook(tool_name: string, tool_input: Record<string, unknown>) {
  const r = spawnSync('python3', [GATE], {
    input: JSON.stringify({ tool_name, tool_input, hook_event_name: 'PreToolUse' }),
    encoding: 'utf-8',
    // hermetic: rules path (and so the gate log) inside the test dir
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, OUTGOING_COPY_GATE_RULES: join(dir, 'rules.json') },
  })
  const out = r.stdout.trim()
  // A hook prints ONE JSON object; two separate prints would not parse as one.
  const msg = out ? (JSON.parse(out) as { systemMessage?: string }).systemMessage ?? '' : ''
  return { code: r.status, out, msg, err: r.stderr }
}
const POST = 'curl -s -X POST http://localhost:3420/api/messages -H "Content-Type: application/json"'
const interAgent = (content: string) =>
  hook('Bash', { command: `${POST} --data-binary @- <<'JSON'\n${JSON.stringify({ from: 'samu', to: 'marveen', content })}\nJSON` })
const telegram = (text: string) => hook('mcp__plugin_telegram_telegram__reply', { chat_id: '1', text })

function words(text: string): Array<[string, string, string]> {
  const out = execFileSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps(g.foreign_letter_words(sys.stdin.read())))
`], { encoding: 'utf-8', input: text })
  return JSON.parse(out)
}

describe('inter-agent path: the specimen WARNS, never blocks', () => {
  it('the measured specimen passes with a warning that names the character', () => {
    const r = interAgent(`A kartya szerint ${SPECIMEN} sorrendben jott.`)
    expect(r.code).toBe(0)
    expect(r.msg).toContain('U+00EC')
    expect(r.msg).toContain(SPECIMEN)
    expect(r.msg).toContain('nem tiltas')
  })
  it('the correct word is silent (negative control)', () => {
    const r = interAgent(`A kartya szerint ${CORRECT} sorrendben jott.`)
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
  })
  it('a Cyrillic lookalike is still BLOCKED by the homoglyph check, not downgraded', () => {
    const r = interAgent(`A kartya szerint ford${CYR_I}tott sorrendben jott.`)
    expect(r.code).toBe(2)
    expect(r.err).toContain('homoglifa')
  })
  it('a Serbian name warns and PASSES', () => {
    const r = interAgent(`${SERBIAN} irt a rendelesrol.`)
    expect(r.code).toBe(0)
    expect(r.msg).toContain('U+0107')
  })
})

describe('Telegram path: warning rides in the same JSON as the rules-file notice', () => {
  it('the specimen passes, and ONE stdout object carries both messages', () => {
    const r = telegram(carrier(SPECIMEN))
    expect(r.code).toBe(0)
    expect(r.msg).toContain('NEV-SZABALY') // the rules file is absent in this hermetic dir
    expect(r.msg).toContain('U+00EC')
  })
  it('the correct word carries only the rules-file notice', () => {
    const r = telegram(carrier(CORRECT))
    expect(r.code).toBe(0)
    expect(r.msg).toContain('NEV-SZABALY')
    expect(r.msg).not.toContain('NEM MAGYAR BETU')
  })
})

describe('email path: warning, and the letter still goes out', () => {
  it('the specimen passes with the warning', () => {
    const r = hook('mcp__gmail__send_email', { to: 'a@b.hu', subject: 'Teszt', body: carrier(SPECIMEN) })
    expect(r.code).toBe(0)
    expect(r.msg).toContain('U+00EC')
  })
})

// 88c366f2 merge, P6: upstream's human-facing HTTP channel path (GATEHTTP924, a curl to the
// Telegram Bot API, Discord or the community API) is an outgoing path like the others.
const httpTelegram = (text: string) =>
  hook('Bash', { command: `curl -s https://api.telegram.org/botXYZ/sendMessage --data-binary @- <<'JSON'\n${JSON.stringify({ chat_id: 1, text })}\nJSON` })

describe('HTTP channel path: warning, and the message still goes out (P6)', () => {
  it('the specimen passes with the warning that names the character', () => {
    const r = httpTelegram(carrier(SPECIMEN))
    expect(r.code).toBe(0)
    expect(r.msg).toContain('NEM MAGYAR BETU')
    expect(r.msg).toContain(SPECIMEN)
  })
  it('the correct word is silent (negative control)', () => {
    const r = httpTelegram(carrier(CORRECT))
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
  })
  it('CONTROL: the path is really audited -- an em dash still BLOCKS', () => {
    expect(httpTelegram(`Szia, ez egy teszt ${cp(0x2014)} gondolatjellel.`).code).toBe(2)
  })
})

describe('the rule itself', () => {
  it('the eighteen Hungarian accented letters never fire -- a missing one is a false alarm', () => {
    expect(words(HU18.split('').join(' '))).toEqual([])
  })
  it('the classic o/u double-acute mojibake and other near-misses always fire -- an added one is a hole', () => {
    // o-tilde and u-circumflex are what a Latin-1 round trip leaves of o/u double acute.
    const near = [cp(0xf5), cp(0xfb), cp(0xd5), cp(0xdb), I_GRAVE, cp(0xf1), cp(0x107), cp(0x161)]
    for (const ch of near) expect(words(`x${ch}x`).map((h) => h[1]), `U+${ch.codePointAt(0)!.toString(16)}`).toEqual([ch])
  })
  it('quotes, arrows and emoji are not letters and stay silent', () => {
    expect(words(`${cp(0x201e)}idézet${cp(0x201d)} ${cp(0xbb)}x${cp(0xab)} ${cp(0x2192)} ${cp(0x2705)} ${cp(0x1f916)}`)).toEqual([])
  })
  it('the decoder replacement mark fires although it is not a letter', () => {
    expect(words(`ab${cp(0xfffd)}c`).map((h) => h[1])).toEqual([cp(0xfffd)])
  })
})

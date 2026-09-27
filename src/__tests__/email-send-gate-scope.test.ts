import { describe, it, expect } from 'vitest'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision } from '../../scripts/email-send-gate.mjs'

// SUBGATEPOZ822: the gate blocked the DELIVERY of the mail-gate fix three
// times in one afternoon (commit message, PR body heredoc, card-comment
// sqlite write) plus five more content hits across the fleet -- all because
// the old trigger matched send-patterns anywhere in the command string. The
// old header premise ("a sub-agent has no legitimate need to invoke these")
// broke: the developer of the mail tooling is a sub-agent. (Writing THIS
// file was itself blocked by the live gate's old patterns -- the eighth
// measured false positive of the day.)
//
// Per Marveen's strict condition (msg 14282): this is a HARD-deny whose
// mistakes act outward, so REAL send attempts must keep failing -- the
// positive controls below are the acceptance bar, not decor.
describe('gateDecision Bash: content about mail no longer denies (the measured FP classes)', () => {
  const bash = (command: string) => gateDecision('Bash', { command })

  it('a git commit whose MESSAGE names the mailer binaries passes', () => {
    expect(bash('git commit -q -m "fix(hooks): sendmail/msmtp/swaks are now matched in program position, send.py needs --to"').deny).toBe(false)
  })

  it('a PR-create with a heredoc body that documents the send patterns passes', () => {
    expect(bash(`gh pr create --title "gate fix" --body-file /tmp/b.md <<'EOF'\nthe old trigger matched sendmail and api.resend.com anywhere\nEOF`).deny).toBe(false)
  })

  it('a card-comment sqlite write quoting the evidence passes', () => {
    expect(bash(`sqlite3 store/claudeclaw.db "INSERT INTO kanban_comments (card_id, author, content) VALUES ('X','Samu','a send.py es a sendmail mintak a tartalomra tuzeltek')"`).deny).toBe(false)
  })

  it('an inter-agent message about the mail infrastructure passes', () => {
    expect(bash(`curl -s -X POST http://localhost:3420/api/messages -d '{"from":"samu","to":"marveen","content":"az api.resend.com kulcs rotalva, a graph-mail send ut tesztelesre var"}'`).deny).toBe(false)
  })

  it('READING the send tooling passes (cat, grep)', () => {
    expect(bash('cat scripts/support-mail/send.py').deny).toBe(false)
    expect(bash('grep -n sendMail scripts/graph-mail.ts').deny).toBe(false)
  })
})

describe('gateDecision Bash: POSITIVE CONTROLS -- real send attempts still deny (msg 14282 acceptance bar)', () => {
  const bash = (command: string) => gateDecision('Bash', { command })

  it('the mail script executed with a recipient denies (python and direct)', () => {
    expect(bash('python3 scripts/support-mail/send.py --to x@y.hu --subject T --body B').deny).toBe(true)
    expect(bash('./scripts/support-mail/send.py --to=x@y.hu < /tmp/b.txt').deny).toBe(true)
  })

  it('the classic mailers deny, also mid-pipeline and behind env prefixes', () => {
    expect(bash('echo hi | sendmail user@host').deny).toBe(true)
    expect(bash('SMTP_DEBUG=1 msmtp a@b.hu < /tmp/m.txt').deny).toBe(true)
    expect(bash('swaks --to a@b.c --server smtp').deny).toBe(true)
  })

  it('a QUOTED provider URL in curl argument position denies (the normal curl spelling)', () => {
    expect(bash(`curl -X POST "https://api.resend.com/emails" -d @/tmp/mail.json`).deny).toBe(true)
    expect(bash(`curl 'https://api.resend.com/emails' -d @/tmp/mail.json`).deny).toBe(true)
  })

  it('a wrapper shell -c string is analyzed recursively and denies', () => {
    expect(bash(`bash -c "python3 scripts/support-mail/send.py --to a@b.hu --subject X"`).deny).toBe(true)
    expect(bash(`sh -c 'echo m | sendmail a@b.hu'`).deny).toBe(true)
  })

  it('interpreter code-strings that send deny (code handed to an interpreter is operation)', () => {
    expect(bash(`python3 -c "import smtplib; s = smtplib.SMTP('smtp.x.hu'); s.sendmail('a','b','m')"`).deny).toBe(true)
    expect(bash(`node -e "require('./src/graph-mail.js').sendMail({to:'a@b.hu'})"`).deny).toBe(true)
  })

  it('naive exec-shape in interpreter code denies; exec alone or mailer-name alone does not (msg 14298)', () => {
    expect(bash(`python3 -c "import subprocess; subprocess.run(['sendmail','-t','a@b.hu'])"`).deny).toBe(true)
    expect(bash(`node -e "require('child_process').execSync('msmtp a@b.hu < /tmp/m.txt')"`).deny).toBe(true)
    expect(bash(`python3 -c "import subprocess; subprocess.run(['ls','-la'])"`).deny).toBe(false)
    expect(bash(`python3 -c "print('a sendmail utvonala regen mas volt')"`).deny).toBe(false)
  })

  it('heredoc stripping is ORDER-INDEPENDENT: marker-first file-writes stay content, heredoc-FED senders still deny (round 3)', () => {
    expect(bash(`cat <<'EOF' > /tmp/notes.md\nsendmail --to x@y.hu is how the legacy path worked\nEOF`).deny).toBe(false)
    expect(bash(`sendmail -t a@b.hu <<'EOF'\ntorzs sora\nEOF`).deny).toBe(true)
  })

  it('an unparseable command falls back to the legacy patterns (never weaker than before)', () => {
    expect(bash(`echo "unbalanced quote and sendmail mentioned`).deny).toBe(true)
    expect(bash(`echo "unbalanced quote, harmless text`).deny).toBe(false)
  })

  // CARD de5e1709 -- WHY THE TEST ABOVE IS NOT ENOUGH, AND WHY THIS ONE IS THE PIN.
  // `sendmail` is on BOTH gates' fallback lists, so the assertions above pin what
  // the two gates AGREE on, and nothing about where they DIFFER. Measured
  // 2026-09-06 on fe418df (didi): deleting the `sendEmail`/`mail.send` pattern
  // from SEND_PATTERNS, and adding those same tokens to the sibling copy gate's
  // _FALLBACK_LITERALS, each left the whole suite (428 files / 5459 tests) green.
  // A "let us make the two gates consistent" refactor passed in BOTH directions.
  //
  // DO NOT ALIGN THE GATES to make this red test pass. The wide fallback is a
  // ruling (card 9ebde77b): this is a HARD deny on sub-agents, and on the one path
  // where it cannot say anything about command POSITION it must not get weaker
  // than the pre-position-analysis gate was. The sibling's narrow list is correct
  // FOR THE SIBLING (main agent, fail-closed on the coordinator's own census work)
  // and wrong here. If this goes red, the change under it narrowed THIS gate --
  // fix the change, not the test.
  it('the unparseable fallback stays WIDE: bare sendEmail / mail.send still deny HERE (card de5e1709)', () => {
    // THE DIVERGENCE TOKENS. On these exact inputs the sibling copy gate passes
    // (pinned in outgoing-copy-gate-scope.test.ts); this hard-gate must deny.
    expect(bash(`echo "unbalanced quote and sendEmail mentioned`).deny).toBe(true)
    expect(bash(`echo "unbalanced quote and mail.send mentioned`).deny).toBe(true)

    // CONTROL 1 -- the fallback really runs, and CONTROL 0 above already shows it
    // can say no: an unparseable command with NO send token passes.
    expect(bash(`echo "unbalanced quote and sendmail mentioned`).deny).toBe(true)
    expect(bash(`echo "unbalanced quote, harmless text`).deny).toBe(false)

    // CONTROL 2 -- and the denies come from the FALLBACK, not from the parsed
    // path: the same sentences with BALANCED quotes are parsed normally, where
    // every one of these tokens is content and passes. That difference IS the
    // fallback, so widening or narrowing it cannot hide behind these lines.
    expect(bash(`echo 'sendEmail mentioned inside a closed quote'`).deny).toBe(false)
    expect(bash(`echo 'sendmail mentioned inside a closed quote'`).deny).toBe(false)
  })
})

// Card a7ea5b8c (didi, 2026-08-22 and 08-27, measured on the real isSendInvocation):
// the filename exemption `(?!-\w)` (card 92e3c22f) was right for ARGUMENTS, but the
// vendor-CLI check only knew the bare `resend`, so a hyphen- or underscore-named Resend
// binary or helper script in COMMAND position walked through. Every one of these was
// GREEN (allowed) before the fix.
describe('gateDecision Bash: a Resend tool or script with its own name, RUN, denies (card a7ea5b8c)', () => {
  const bash = (command: string) => gateDecision('Bash', { command })

  it.each([
    'npx resend-cli send --to a@b.c',
    'npx resend-api send --to a@b.c',
    'node resend-mailer.js --send --to a@b.c',
    'RESEND_API_KEY=x npx resend-send',
    './resend-mailer send --to a@b.c',
    'npx resend_cli send --to a@b.c',
    'npx tsx scripts/resend-mailer.ts --to a@b.c',
  ])('denies: %s', (command) => {
    expect(bash(command).deny).toBe(true)
  })

  it.each([
    // The 92e3c22f reads: a `resend-*` token as an ARGUMENT is content, even next to `send`.
    'wc -l src/common/services/resend-email.service.ts',
    'grep -n send src/common/services/resend-email.service.ts',
    'git log --oneline -- src/common/services/resend-email.service.ts',
    'npx jest src/common/services/resend-email.service.spec.ts',
    'npx eslint src/common/services/resend-email.service.ts',
    // A resend-named tool that is RUN but carries no send signal is not a send.
    'npx resend-cli --help',
    'node resend-domains-report.js --list',
  ])('CONTROL, passes: %s', (command) => {
    expect(bash(command).deny).toBe(false)
  })
})

// didi, second pass on a7ea5b8c: fifteen ordinary shapes still passed, because only
// rest[0] was taken as the executed position. `npx -y` is what agents type by default.
describe('gateDecision Bash: the executed position is found past runner flags and in more runners (card a7ea5b8c, pass 2)', () => {
  const bash = (command: string) => gateDecision('Bash', { command })

  it.each([
    'npx -y resend-cli send --to a@b.c',
    'npx --yes resend-cli send --to a@b.c',
    'npx -p resend-cli resend-cli send',
    'node --env-file=.env resend-mailer.js --to a@b.c',
    'node --no-warnings resend-mailer.js --to a@b.c',
    'tsx --tsconfig tsconfig.json resend-mailer.ts --to a@b.c',
    'python3 -u resend_mailer.py --to a@b.c',
    'python3 -X utf8 resend_mailer.py --to a@b.c',
    'python3 -m resend_cli send --to a@b.c',
    'pnpm dlx resend-cli send --to a@b.c',
    'yarn dlx resend-cli send --to a@b.c',
    'bunx resend-cli send --to a@b.c',
    'uv run resend_mailer.py --to a@b.c',
    'bash resend-mailer.sh --to a@b.c',
    'sh ./resend-send.sh',
    // chains and preloads
    'npx -y tsx scripts/resend-mailer.ts --to a@b.c',
    'node -r ./resend-mailer.js app.js',
  ])('denies: %s', (command) => {
    expect(bash(command).deny).toBe(true)
  })

  it.each([
    'npx -y jest src/common/services/resend-email.service.spec.ts',
    'bash scripts/check.sh resend-email.service.ts',
    'python3 -m pytest tests/test_resend_mailer.py',
    'pnpm dlx prettier --check src/common/services/resend-email.service.ts',
    'python3 -X utf8 scripts/report.py resend-email.service.ts',
  ])('CONTROL, passes (a resend-* name as an ARGUMENT, not what runs): %s', (command) => {
    expect(bash(command).deny).toBe(false)
  })
})

// didi, third pass on a7ea5b8c: four LOW items. A and B were asked for before the merge
// (scripts/ goes live on merge); C and D are the cheap optional pair.
describe('gateDecision Bash: runner walk, third pass (card a7ea5b8c)', () => {
  const bash = (command: string) => gateDecision('Bash', { command })

  it.each([
    // A: Node takes the space-separated VALUE of a flag it knows, then runs the script.
    'node --title didi resend-mailer.js --send',
    'node --disable-warning DEP0040 resend-mailer.js --send',
    'node --inspect-port 9229 resend-mailer.js --send',
    // B: the walk's bound fails CLOSED, like HEAD_DEPTH.
    'npx -y npx -y npx -y npx -y npx -y resend-cli send',
    // C and D.
    'uvx resend-cli send --to a@b.c',
    'npm run resend-send',
    'pnpm run resend-send',
    'yarn resend-send',
  ])('denies: %s', (command) => {
    expect(bash(command).deny).toBe(true)
  })

  it.each([
    // A known boolean long flag does not make the next token a script.
    'npx --yes jest src/common/services/resend-email.service.spec.ts',
    'npx --yes prettier --check resend-email.service.ts',
    'node --no-warnings scripts/report.js resend-email.service.ts',
    'npm run test -- resend-email.service.spec.ts',
    'npm run lint',
    'npm install resend-cli',
    'python3 -m pip install resend',
  ])('CONTROL, passes: %s', (command) => {
    expect(bash(command).deny).toBe(false)
  })
})

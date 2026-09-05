// THE SCHEDULER IS LOCAL-TIME BY DESIGN, SO THE SUITE HAS TO SAY WHICH LOCAL (card 39151cd4).
//
// Cron expressions in this repo are evaluated in the process timezone -- that is the documented
// behaviour, not an accident, and the schedule specs assert it. What they never did was SAY which
// timezone they assert about: they inherited it from whatever machine ran them.
//
// Measured 2026-09-05 on the untouched HEAD, ten files / 69 tests:
//     Europe/Budapest  69 passed        UTC              36 failed
//     Europe/London    37 failed        America/New_York 35 failed
//     Asia/Tokyo       35 failed        Australia/Sydney 35 failed
// Green in exactly one zone: the operator's. UTC is what a GitHub runner uses, and this repo has
// never run one -- `test.yml` exists on the running tree but not on the default branch, and the
// fork has zero Actions runs ever. So nothing has ever contradicted the machine.
//
// The mechanism, on the sharpest case: `cronGapMs('0 9 * * 1', at('2026-08-31T08:59:00+02:00'))`.
// The fixture pins the INSTANT correctly, with an explicit offset. The cron expression is then
// read in the process timezone -- one minute before Monday 09:00 at UTC+2, and 6.7 days before it
// in Tokyo. 60_000 against 579_660_000, which is the failure observed.
//
// WHAT THIS DOES AND DOES NOT DO. It makes the assertions' premise EXPLICIT instead of inherited,
// so the suite is portable and a second machine cannot produce a different verdict. It does NOT
// make the scheduler timezone-correct, and it must not be read that way: a genuine timezone defect
// in the scheduler would still pass here, because these specs assert local-time semantics on
// purpose. That is a separate question and it is not this file's.
process.env.TZ = 'Europe/Budapest'

// Node reads TZ lazily, so the assignment above is enough on the versions we support -- but "is
// enough" is exactly the kind of claim that rots silently across a Node upgrade. If the pin ever
// stops taking effect the suite must fail LOUDLY here, not drift back to inheriting the machine.
const probe = new Date('2026-08-31T08:59:00+02:00').getHours()
if (probe !== 8) {
  throw new Error(
    `pin-timezone: TZ pin did not take effect (expected local hour 8 for 08:59+02:00 in `
    + `Europe/Budapest, got ${probe}). The schedule specs assert local-time cron semantics and `
    + `would fail in a way that looks like a scheduler bug. Fix the pin, do not relax the specs.`,
  )
}

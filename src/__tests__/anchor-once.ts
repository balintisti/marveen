/**
 * Locating a code region by searching this repo's own source text for a marker.
 *
 * WHAT GOES WRONG WITHOUT THIS. Dozens of specs here read a source file and
 * find the region under test with `SRC.indexOf('<some line of code>')`. That
 * call answers "where is the FIRST occurrence", and the spec then treats the
 * answer as "where is THE occurrence". Nothing states the difference, and
 * nothing checks it.
 *
 * MEASURED on origin/develop 8a4cd73: 74 spec files read source text and use
 * 211 `indexOf` anchors. 32 of those pass a start position (a deliberate
 * forward scan) and 65 run on an already-narrowed slice -- both fine. 114 run
 * on the whole file and take the first match; of the 80 that could be resolved
 * to their target file, 71 happen to match exactly once today and 7 ALREADY
 * match more than once, i.e. those seven are inspecting an arbitrary instance
 * right now. (7 is a floor, not a total: 34 anchors did not resolve.)
 *
 * HOW IT FAILS, and why it is worth a helper rather than more care. A second
 * occurrence appearing ABOVE the intended one silently redirects the spec to a
 * different region. Sometimes that is loud -- adding a helper function whose
 * loop header matched three specs' anchor turned all three red, which is how
 * this was found. But it can just as easily be quiet: a newly inserted region
 * that happens to satisfy the assertions passes, and the spec then reports
 * green while never looking at the thing it was written to guard.
 *
 * AND THE ANCHOR'S GENERICITY DOES NOT PREDICT THE RISK -- that heuristic was
 * tried and measured wrong. `'}'` and `'\n}\n'` look like the most dangerous
 * anchors in the tree and are both perfectly safe: one passes a start
 * position, the other runs on a function body already sliced out. Scope, not
 * genericity, is what decides. So the check cannot be a review habit; it has
 * to be an assertion at the point of use.
 *
 * These helpers do not make anchors unique. They make the assumption explicit:
 * the spec says how many matches it expects, and gets a loud, counted failure
 * when that stops being true.
 */

function countOccurrences(haystack: string, marker: string): number {
  if (marker === '') throw new Error('anchor marker must not be empty')
  let n = 0
  let i = haystack.indexOf(marker)
  while (i !== -1) {
    n++
    i = haystack.indexOf(marker, i + marker.length)
  }
  return n
}

function describe(marker: string, label?: string): string {
  const shown = marker.length > 80 ? `${marker.slice(0, 80)}...` : marker
  return label ? `${label} (${JSON.stringify(shown)})` : JSON.stringify(shown)
}

/**
 * Index of the one and only occurrence of `marker`.
 *
 * Throws when it matches zero times (the marker went stale -- renamed,
 * reformatted, deleted) or more than once (the spec can no longer be said to
 * inspect a particular region). Both are reported with the actual count, so
 * the failure names the cause instead of surfacing later as a confusing
 * assertion about the wrong code.
 *
 * Use this for any anchor that is meant to identify a single region -- which
 * is the overwhelming majority of them.
 */
export function anchorOnce(src: string, marker: string, label?: string): number {
  const n = countOccurrences(src, marker)
  if (n !== 1) {
    throw new Error(
      `anchorOnce: expected exactly 1 occurrence of ${describe(marker, label)}, found ${n}. ` +
        (n === 0
          ? 'The marker no longer appears in the source -- it was renamed, reformatted or removed, ' +
            'so this spec is no longer testing what it names.'
          : 'A second occurrence has appeared, so the first match is no longer necessarily the ' +
            'region this spec means. Either narrow the marker until it is unique, or state the ' +
            'ambiguity with anchorNth(src, marker, { nth, of }).'),
    )
  }
  return src.indexOf(marker)
}

/**
 * Index of the `nth` occurrence of a marker that is EXPECTED to be ambiguous,
 * asserting the total count along the way.
 *
 * This exists for anchors that genuinely repeat and where narrowing the marker
 * would mean pinning the spec to incidental wording (a comment, an indent
 * level) that a formatter or a reword can move without changing meaning. Such
 * a spec is not wrong to take the first match -- it is only wrong to leave
 * that unsaid.
 *
 * `of` is required on purpose. The count is the part that goes stale, and a
 * helper that let you write `nth: 1` without declaring how many exist would
 * reintroduce exactly the silence it was built to remove.
 */
export function anchorNth(
  src: string,
  marker: string,
  opts: { nth: number; of: number },
  label?: string,
): number {
  const { nth, of } = opts
  if (!Number.isInteger(nth) || nth < 1) throw new Error(`anchorNth: nth must be a positive integer, got ${nth}`)
  if (!Number.isInteger(of) || of < 1) throw new Error(`anchorNth: of must be a positive integer, got ${of}`)
  if (nth > of) throw new Error(`anchorNth: asked for occurrence ${nth} of ${of} -- nth cannot exceed of`)

  const n = countOccurrences(src, marker)
  if (n !== of) {
    throw new Error(
      `anchorNth: ${describe(marker, label)} was declared to occur ${of} time(s), found ${n}. ` +
        'The set of matches moved, so occurrence ' + nth + ' is not necessarily the same region ' +
        'this spec was written against. Re-read the source and update the count deliberately.',
    )
  }

  let idx = -1
  for (let k = 0; k < nth; k++) idx = src.indexOf(marker, idx < 0 ? 0 : idx + marker.length)
  return idx
}

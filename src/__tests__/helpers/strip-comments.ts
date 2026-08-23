/**
 * Comment-stripped source, for tests that locate code by TEXT POSITION.
 *
 * WHY THIS IS SHARED AND WHY IT MATTERS (didi's finding on card 0114968c,
 * 2026-08-23). A test that asserts "A is called before B" with
 * `src.indexOf('A') < src.indexOf('B')` measures the first TEXTUAL occurrence,
 * and a comment is text. A block comment that merely MENTIONS the call --
 * exactly the kind of comment that explains why the call sits where it does --
 * anchors the search at the explanation instead of the code. The guard then
 * passes on a file where the real call has moved, which is the failure mode a
 * position test exists to prevent.
 *
 * The same shape bites twice over when the anchor IS a comment: strip the
 * comment and the slice silently starts somewhere else entirely.
 *
 * Three test files had already grown their own private copy of this function
 * (agent-delete-stops-session, agent-create-no-destructive-rollback,
 * main-restart-platform). This is that copy, once, so the next one does not
 * make four. Those three still carry their own; folding them in is a separate,
 * low-value change against files other agents are editing tonight.
 *
 * NOT A PARSER, and it does not need to be: it strips block and whole-line
 * comments, which is what defeats the anchor problem. A `//` inside a string
 * literal survives, and no assertion here depends on that case.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

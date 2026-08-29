// Per-tool outgoing HTTP deadline (ms).
// If an external service doesn't respond within the allotted time, the
// request is aborted and the caller receives an Error so it can log and fall
// back gracefully instead of hanging the whole agent session.
export const TOOL_TIMEOUTS = {
  'google-calendar': 5_000,
  // Drive is NOT the calendar, and reusing the calendar's 5s was a real bug
  // (2026-08-20): a calendar query returns a short JSON list, while a Drive
  // call may EXPORT a document or stream a file body. Listing files fit inside
  // 5s and looked fine; the first document export timed out. 60s covers an
  // export and a moderate download without letting a stalled connection hang
  // the caller forever.
  'google-drive': 60_000,
  // The OAuth token exchange is NOT the calendar either, and it inherited the
  // calendar's 5s the same way Drive once did -- by omitting the argument. On
  // 2026-08-24 that produced a run where BOTH the calendar and the Drive leg
  // reported "timed out after 5000ms", even though Drive budgets 60s: a 60s
  // budget cannot fail at 5s, so the failure was the shared token step. Measured
  // the same night, 7 runs: one died on the 5000ms deadline, the six others
  // answered in 2.16-4.16s for the WHOLE pipeline. 15s is ~3x that worst case
  // for a single small POST, and still far below Drive's 60s.
  //
  // This is on the critical path of every Google call, so a false timeout here
  // does not look like an auth problem -- it looks like the calendar is down.
  'google-auth': 15_000,
  'telegram':        10_000,
  'github':          10_000,
  'slack':           10_000,
  // CPU-only Ollama embeds a ~1500-char memory in 40-60s, which overran the
  // former 30s deadline and left large memories permanently un-vectorized
  // (search silently fell back to FTS). 90s covers the slow CPU path.
  'ollama-embedding': 90_000,
} as const

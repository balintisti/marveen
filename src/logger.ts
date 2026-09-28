import pino from 'pino'

// Every pretty line carries the full local date, not just the time of day
// (LOGDATUM916, 2026-09-16). pino-pretty's default is `HH:MM:ss.l`, and the
// dashboard.log is size-rotated (20 MB, weeks per generation), so one file
// spans many days: a bare-time WARN could not be tied to a day, and the pid
// prefix cannot disambiguate either, because pids are reused across restarts
// in the container. `SYS:standard` = `yyyy-mm-dd HH:MM:ss.l o` in the host's
// time zone, i.e. the offset is on the line too.
export const PRETTY_OPTIONS = { colorize: true, translateTime: 'SYS:standard' } as const

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      // DATE AND ZONE IN EVERY LINE (card 10ba8fd4). Without translateTime the prefix is
      // `[06:41:02.123]` -- time of day, no date -- and in a 9 MB log spanning days that
      // cannot express "after X" at all: today's [03:07:18] and Tuesday's are identical.
      // In ONE night that produced FIVE false readings across three agents, four of them
      // giving the reassuring or expected answer: two runs where a failed timestamp parse
      // put every line on one side (a confident 100 and a confident 0), a "the clock is
      // UTC" inference written into the tree from a single old timestamp, and two
      // "refusals since 06:48" counts that swept in every previous day at that hour.
      //
      // THE `SYS:` PREFIX IS THE WHOLE POINT AND IS EASY TO LOSE. Measured, same epoch:
      //   'yyyy-mm-dd HH:MM:ss.l'      -> [2026-08-29 05:32:42.549]        UTC
      //   'SYS:yyyy-mm-dd HH:MM:ss.l'  -> [2026-08-29 07:32:42.549]        local
      //   'SYS:standard'               -> [2026-08-29 07:32:42.549 +0200]  local + offset
      // A bare format string is UTC. Writing one here would shift every timestamp two
      // hours against the wall clock and against `date` -- a NEW false-reading source,
      // and the same defect class this change exists to remove.
      //
      // `SYS:standard` over the bare SYS form because it prints the OFFSET. The zone
      // ambiguity is what produced the UTC claim above; an explicit +0200 ends it rather
      // than leaving it to be inferred.
      // The value lives in PRETTY_OPTIONS above (upstream LOGDATUM916, same value); this
      // comment is ours (card 10ba8fd4) and says why the SYS: prefix must not be lost.
      ? { target: 'pino-pretty', options: PRETTY_OPTIONS }
      : undefined,
})

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
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
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
})

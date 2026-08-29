/**
 * Unknown query parameters must not be swallowed in silence.
 *
 * THE DEFECT (card cf85d765, found by jarvis). `GET /api/kanban` reads NO query
 * parameters at all, and Node's URL parser keeps whatever it is given. So a
 * caller who writes `?archived=1` -- a perfectly reasonable guess -- gets HTTP
 * 200 and the full list of LIVE cards. Zero archived rows come back, which
 * reads exactly like a truthful "there are none", while the answer is actually
 * about a different population.
 *
 * That is the worst shape a filter can fail in: not an error, not an empty
 * result, but a CONFIDENT answer to a question nobody asked. Measured the same
 * day, this was the third such case in the fleet -- `git ls-tree` scoped to a
 * subdirectory, an undefined "open side of the board", and this. All three
 * returned 200-equivalents with a valid-looking answer.
 *
 * MEASURED BEFORE WRITING THIS, because a 400 can only be added if nothing
 * currently relies on the silence (2026-08-23): across the repo, the live
 * `~/.claude` skills and scheduled tasks, and every agent CLAUDE.md, there is
 * NOT ONE caller that passes a query string to `/api/kanban`. Positive control
 * for the search itself: the same pattern does find `/api/kanban/archived?` in
 * web/app.js:16317, so the empty result is a real negative and not a broken
 * grep.
 */

/** The unknown parameter names in `url`, in the order the caller sent them. */
export function unknownQueryParams(url: URL, allowed: readonly string[]): string[] {
  const out: string[] = []
  for (const name of url.searchParams.keys()) {
    if (!allowed.includes(name) && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * The 400 body. It names the way OUT, not just the fault.
 *
 * A guard that only says "wrong" leaves the caller exactly where it found them,
 * and the caller's next move is to guess again. `hint` is where an endpoint says
 * what the caller was probably reaching for -- for the unfiltered card list that
 * is the archive endpoint, which is the guess that produced this card.
 */
export function unknownQueryParamError(
  unknown: readonly string[],
  allowed: readonly string[],
  hint?: string,
): { error: string } {
  const tamogatott = allowed.length
    ? `Tamogatott parameterek: ${allowed.join(', ')}.`
    : 'Ez a vegpont nem fogad query-parametert.'
  return {
    error: [
      `Ismeretlen query-parameter: ${unknown.join(', ')}.`,
      tamogatott,
      hint,
      'A keres azert bukik el, mert egy figyelmen kivul hagyott szuro NEM ures eredmenyt adna, hanem egy MASIK populaciot -- ugyanolyan 200-zal.',
    ].filter(Boolean).join(' '),
  }
}

/**
 * MEGFIGYELO MOD: naplozza az ismeretlen parametert, de NEM utasit el.
 *
 * MIERT LETEZIK (computress javaslata, 2026-08-23). A szigoru or kiterjesztese
 * tizennyolc tovabbi vegpontra egy dolgon akadt el: mindegyikhez ki kell deriteni
 * a TAMOGATOTT listat, es egy TULBUZGO or -- ami a HELYES hivast utasitja el --
 * rosszabb, mint a semmi, mert megtanitja az olvasot, hogy a jelzese zaj.
 * A talalgatas helyett meres: elobb csak naplozunk, es egy nap mulva a naplo
 * MEGMONDJA, mit hivnak valojaban. Utana lehet szigoritani, tudassal.
 *
 * A SORREND A LENYEG: `observe` -> (egy nap naplo) -> `reject`. Forditva egy
 * kitalált lista alapjan zarnank ki valos hivokat.
 *
 * AMIT EZ NEM AD: vedelmet. Egy megfigyelo mod NEM akadalyoz meg semmit -- a
 * hivo tovabbra is MAS populaciot kap ugyanazzal a 200-zal. Atmeneti allapot,
 * nem vegallomas; ha egy vegpont fel evig `observe`-ben all, az nem ovatossag,
 * hanem elfelejtett munka.
 */
export function observeUnknownQueryParams(
  url: URL,
  allowed: readonly string[],
  endpoint: string,
  log: (o: Record<string, unknown>, msg: string) => void,
): string[] {
  const unknown = unknownQueryParams(url, allowed)
  if (unknown.length) {
    log(
      { endpoint, unknown, allowed, url: url.pathname + url.search },
      'unknown query parameter observed (not rejected -- see observeUnknownQueryParams)',
    )
  }
  return unknown
}


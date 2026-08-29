// HALAD-E EGY BUSY FORDULO? A token-szam mondja meg, nem az ora. (kartya 09906ebf)
//
// A MERES, AMIERT EZ LETEZIK (jarvis, 2026-08-23; marveen ujramerte 21:22-kor):
//   tipus        riasztas   15 percen belul ujra   median   VALODI talalat
//   BUSY            59              50             3 perc         0
//   not-ready       13               7            14 perc         1
// A BUSY-ag ot nap alatt 59-szer szolalt meg, es NULLA valodi elakadast talalt. A
// not-ready ag ritkabb, lassabb, ES ott van az egyetlen valodi eset (08-18, dexter --
// a riasztas harom perccel a jogos ujrainditas elott szolt).
//
// AMI A KETTOT SZETVALASZTJA: a BUSY-riasztas feltétele ma az, hogy a PORGO-JELZO N
// perce fent van. Az ora viszont akkor is no, ha a fordulo halad -- vagyis a jel
// csak azt tudja mondani, hogy "meg mindig busy", azt sosem, hogy "megallt".
// A token-szam viszont KULONBSEGET tesz: marveen ket esetben (20:14, 21:20) egy
// pillanat alatt eldontotte vele, hogy nincs teendo -- a porgo 30+ percet mutatott,
// a token-szam viszont NOTT.
//
// MIERT ITT, ES NEM A pane-state.ts-BEN: ez a modul TISZTA -- se tmux, se db, se ora.
// A router mar amugy is elkapja a panelt az eszkalacio elott (egy capture), tehat a
// jel EXTRA tmux-hivas nelkul elerheto; csak ki kell olvasni belole.

/** Egy mintavetel: hany token latszott, es MIOTA all ugyanazon a szamon. */
export interface TokenSample {
  tokens: number
  /** Az elso pillanat, amikor EZT a szamot lattuk (nem az utolso). */
  sinceMs: number
}

/**
 * A panel farkabol a token-szam. `null`, ha a sor nincs ott.
 *
 * A minta a `scripts/agent-progress.sh`-eval AZONOS (`([\d.]+)k?\s+tokens`), es ez
 * szandekos: ha a ket olvasat eltérne, a szkript es a router mas valaszt adna
 * UGYANARRA a panelre -- es a kettot senki nem vetne ossze.
 *
 * A `k` szorzo azert kell, mert a panel `43.6k tokens` alakban ir. `k` nelkul a
 * szam nyers darab; ilyet is lattunk kis fordulokon.
 */
export function parsePaneTokens(capture: string | null | undefined): number | null {
  if (!capture) return null
  // Az UTOLSO talalat kell: a panel scrollbackjeben tobb regi porgo-sor is allhat,
  // es a legfrissebb az alja. Egy `match`-elso-talalat itt egy REGI szamot adna,
  // ami "befagyottnak" latszana -- vagyis pont a hibat termelne, amit merunk.
  const rx = /([\d.]+)(k)?\s+tokens/gi
  let last: RegExpExecArray | null = null
  for (let m = rx.exec(capture); m !== null; m = rx.exec(capture)) last = m
  if (!last) return null
  const value = Number.parseFloat(last[1] as string)
  if (!Number.isFinite(value)) return null
  return last[2] ? value * 1000 : value
}

/**
 * Tiszta allapot-atmenet: az elozo mintabol es a mostani leolvasasbol mennyi ideje
 * all a szam.
 *
 * `frozenMs === null` jelentese ISMERETLEN (nem volt olvashato token-sor) -- es ez
 * NEM ugyanaz, mint a nulla. A hivo oldalan ez a kulonbseg dont: egy nem mert jel
 * nem lehet ok a HALLGATASRA.
 */
export function nextTokenSample(
  prev: TokenSample | null | undefined,
  tokens: number | null,
  nowMs: number,
): { sample: TokenSample | null; frozenMs: number | null } {
  if (tokens === null) return { sample: prev ?? null, frozenMs: null }
  if (!prev || prev.tokens !== tokens) return { sample: { tokens, sinceMs: nowMs }, frozenMs: 0 }
  return { sample: prev, frozenMs: Math.max(0, nowMs - prev.sinceMs) }
}

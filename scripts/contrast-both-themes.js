/*
 * A CONTRAST PASS THAT CANNOT RETURN A SINGLE-THEME RESULT.
 * mandark, 2026-09-10. Cards 4ebdf766 / 5c9aac65.
 *
 * HOW TO USE: paste this whole file as the argument of ONE `browser_evaluate`
 * call, on the page you want measured, logged in, at the viewport you care
 * about. It measures the current theme, flips the theme with the real header
 * button, measures again, flips back, and returns both, labelled.
 *
 * WHY IT EXISTS IN THIS SHAPE. marveen made it a standing rule on 2026-09-10
 * that every contrast finding carries BOTH themes and names which is which,
 * after computress measured a timestamp failing at 2.56 in light AND 3.07 in
 * dark. A light-only fix would have darkened the light half, watched it pass,
 * and shipped with dark still broken -- looking finished. And the axis is
 * per-COLOUR-PAIR, not per page: on one screen we measured four families with
 * four different profiles (both / light-only / dark-only / both), the largest
 * group being dark-only. Neither theme can be inferred from the other, in
 * either direction.
 *
 * A rule you must remember at the moment of measuring is not a rule. This file
 * is the mechanism: the wrong shape is not on offer.
 *
 * ---------------------------------------------------------------------------
 * FIVE THINGS IT DOES THAT AN AD-HOC VERSION GETS WRONG. Every one of them was
 * measured the hard way, and every one failed in the ALARMING direction --
 * inventing findings, not hiding them.
 *
 *  1. COLOUR CONVERSION VIA THE BROWSER, NOT A REGEX. This app renders rgb()
 *     and oklch() on the same page. A regex over the colour string yields
 *     nonsense for oklch and reported 1.01 -- "invisible text" -- for a
 *     perfectly readable badge whose true ratio is 4.72.
 *
 *  2. IT REFUSES TO SCORE TEXT ON A GRADIENT. A naive walker looks for
 *     background-color; an avatar circle using `background-image:
 *     linear-gradient` makes it step over and score white text against the
 *     CARD behind the circle. That produced a second fake near-1.0 (1.05).
 *     Gradient-backed text is returned separately WITH the stops and their
 *     per-stop ratios, so a human decides. The meter does not invent a number.
 *
 *  3. NO `length > 1` FILTER ON TEXT NODES. That filter silently drops every
 *     single-character label -- avatar initials, counters, glyphs beside icons.
 *     It is why an earlier pass reported six failures where there were nine.
 *     A filter that removes exactly the elements a finding is about is the
 *     quiet member of this same family.
 *
 *  4. THE SETTLE IS STABILITY-BASED, NOT TIME-BASED. Body and cards carry
 *     `transition: all`, so a read taken shortly after the toggle scores text
 *     against INTERPOLATING backgrounds that belong to neither theme. Measured
 *     on one screen in a single run:
 *
 *         350ms after the toggle .... 17 failures, bg rgb(58,69,86) / rgb(39,53,97)
 *         1350ms .................... 8,  bg rgb(41,53,72) / rgb(23,37,84)
 *         3350ms .................... 8,  identical
 *
 *     Eleven of the seventeen were phantoms -- real elements, plausible colour
 *     values, plausible ratios. Somebody chases those for an hour. A fixed
 *     delay cannot know when the transition ended; agreement between two
 *     consecutive reads can. If eight reads never agree it returns `unstable`
 *     instead of a number.
 *
 *     DO NOT "OPTIMISE" THIS BACK TO A FIXED DELAY because it feels slow. The
 *     delay is not the mechanism; the agreement is. On a machine with
 *     `prefers-reduced-motion` the transition may not exist at all, in which
 *     case a fixed delay would look fine here and wrong there -- the stability
 *     check is immune to that difference, which is the point.
 *
 *  5. A RATIO NEAR 1.0 IS THIS INSTRUMENT'S CHARACTERISTIC FAILURE MODE, so it
 *     is never reported on one derivation. Twice in one day this meter produced
 *     a near-1.0 from two different causes (1.01 oklch, 1.05 gradient). Not
 *     because such a finding is impossible -- text really can be invisible --
 *     but because on THIS instrument it is likelier to be the tool than the
 *     page. Anything under 1.1 is re-derived by a second, differently
 *     constructed route: the background is recomputed by ALPHA-COMPOSITING the
 *     whole ancestor stack rather than taking the first sufficiently-opaque
 *     ancestor. If the two routes disagree the composite wins; if they agree
 *     and it is still under 1.1 the row is returned as `suspect`, for a human,
 *     not as a finding.
 * ---------------------------------------------------------------------------
 *
 * CONTROLS are returned on every run and are not optional reading:
 * black-on-white must be 21 and white-on-white must be 1. If they are not, the
 * numbers are about the meter, not the page.
 *
 * STATED LIMITS, so they travel with the tool: the timing figures above were
 * measured on ONE screen on ONE machine; the stability check generalises, the
 * read counts do not. This measures TEXT contrast only -- not icons, borders or
 * status bars -- and only the resting state.
 */
async () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const toRGB = (c) => {
    if (cache.has(c)) return cache.get(c);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const v = [d[0], d[1], d[2], d[3] / 255]; cache.set(c, v); return v;
  };
  const lum = (r) => {
    const [a, b, c] = r.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a + 0.7152 * b + 0.0722 * c;
  };
  const ratio = (fg, bg) => { const x = lum(toRGB(fg)), y = lum(toRGB(bg)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const r2 = (n) => Math.round(n * 100) / 100;
  const rgbStr = (a) => `rgb(${Math.round(a[0])}, ${Math.round(a[1])}, ${Math.round(a[2])})`;

  /* ROUTE A -- first ancestor with a solid enough background. Fast, and what a
   * hand-written version does. Reports a gradient instead of guessing past it. */
  const bgFirstOpaque = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return { bg: null, gradient: s.backgroundImage, host: n };
      const c = s.backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && toRGB(c)[3] > 0.5) return { bg: c, gradient: null, host: n };
      n = n.parentElement;
    }
    return { bg: getComputedStyle(document.body).backgroundColor, gradient: null, host: document.body };
  };

  /* ROUTE B -- composite every ancestor background with its alpha, bottom-up.
   * Differently constructed on purpose: it is the check for route A, so it must
   * not share route A's assumption that one ancestor is "the" background. */
  const bgComposited = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;   // not colour-scoreable
      const c = s.backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') stack.push(toRGB(c));
      n = n.parentElement;
    }
    const rootBg = toRGB(getComputedStyle(document.documentElement).backgroundColor);
    let out = rootBg[3] > 0 ? rootBg.slice(0, 3) : [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) {
      const [r, g, b, a] = stack[i];
      out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
    }
    return rgbStr(out);
  };

  const measure = () => {
    const root = document.querySelector('main') || document.body;
    const fails = [], onGradient = [], suspect = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3)
        .map(n => (n.textContent || '').trim()).join(' ').trim();
      if (own.length < 1) continue;                                  // NO >1 filter: docblock 3
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const s = getComputedStyle(el);
      const fs = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700;
      const need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5;
      const { bg, gradient, host } = bgFirstOpaque(el);

      if (gradient) {
        const stops = gradient.match(/rgba?\([^)]+\)/g) || [];
        onGradient.push({
          text: own.slice(0, 24), fg: s.color, need,
          hostClass: (host.getAttribute('class') || '').slice(0, 110),
          stops: stops.map(st => ({ stop: st, ratio: r2(ratio(s.color, st)) })),
          note: 'text sits on a gradient -- scored per stop, not as one number',
        });
        continue;
      }

      let t = ratio(s.color, bg), route = 'first-opaque', usedBg = bg, second = null;
      if (t < 1.1) {                                                 // docblock 5
        const comp = bgComposited(el);
        second = comp;
        if (comp) {
          const t2 = ratio(s.color, comp);
          if (r2(t2) !== r2(t)) { t = t2; usedBg = comp; route = 'alpha-composite (routes disagreed)'; }
        }
        if (t < 1.1) {
          suspect.push({
            text: own.slice(0, 26), fg: s.color, bgFirstOpaque: bg, bgComposited: second,
            ratio: r2(t), size: Math.round(fs), weight: s.fontWeight,
            cls: (el.getAttribute('class') || '').slice(0, 130),
            note: 'NEAR 1.0 ON BOTH ROUTES -- this instrument fakes this value more often than the page produces it. Verify by eye before reporting.',
          });
          continue;
        }
      }
      if (t >= need) continue;
      fails.push({
        text: own.slice(0, 26), fg: s.color, bg: usedBg, ratio: r2(t), need, route,
        size: Math.round(fs), weight: s.fontWeight,
        cls: (el.getAttribute('class') || '').slice(0, 130),
      });
    }
    const groups = {};
    for (const f of fails) {
      const k = `${f.fg} | ${f.bg} | ${f.size}/${f.weight}`;
      (groups[k] = groups[k] || { count: 0, ratio: f.ratio, need: f.need, cls: f.cls, samples: [] }).count++;
      if (groups[k].samples.length < 3) groups[k].samples.push(f.text);
    }
    return {
      theme: document.documentElement.className || '(no class on <html>)',
      bodyBg: getComputedStyle(document.body).backgroundColor,
      failures: fails.length,
      groups: Object.entries(groups).map(([key, v]) => ({ key, ...v })),
      onGradient: onGradient.slice(0, 8),
      suspect,
      control: { blackOnWhite: r2(ratio('rgb(0,0,0)', 'rgb(255,255,255)')), whiteOnWhite: r2(ratio('rgb(255,255,255)', 'rgb(255,255,255)')) },
    };
  };

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const settledMeasure = async () => {
    let prev = measure(), tries = 0;
    while (tries < 8) {
      await wait(400);
      const now = measure();
      const same = now.failures === prev.failures &&
        JSON.stringify(now.groups.map(g => g.key).sort()) === JSON.stringify(prev.groups.map(g => g.key).sort());
      if (same) return { ...now, settledAfterReads: tries + 2 };
      prev = now; tries++;
    }
    return { ...prev, unstable: true, note: 'NEVER SETTLED in 8 reads -- do not quote these numbers; something is animating or re-rendering.' };
  };

  const toggle = () => {
    const b = document.querySelector('button[aria-label="Váltás sötét módra"], button[aria-label="Váltás világos módra"]');
    if (!b) return false;
    b.click(); return true;
  };

  const first = await settledMeasure();
  if (!toggle()) {
    return { first, second: null, note: 'NO THEME TOGGLE FOUND -- that is a reported fact, not "this screen has no dark variant". Say which in the finding; it costs one line.' };
  }
  const second = await settledMeasure();
  toggle(); await settledMeasure();                                   // leave the page as found
  return {
    first, second,
    restoredTo: document.documentElement.className || '(no class)',
    note: 'Both themes measured, each read to stability. Every number carries its theme; a contrast finding quoted without one is incomplete (marveen, 2026-09-10).',
  };
};

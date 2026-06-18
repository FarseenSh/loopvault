// Standard normal PDF and CDF (no external deps).

/** Standard normal probability density φ(x). */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal cumulative distribution N(x).
 * Zelen & Severo (Abramowitz & Stegun 26.2.17) rational approximation;
 * |error| < 7.5e-8, which is well within hedge-sizing tolerance.
 */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 +
            t * 1.330274429))));
  const tail = normPdf(x) * poly;
  return x >= 0 ? 1 - tail : tail;
}

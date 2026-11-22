/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf), accurate to about 1e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface ProportionTest {
  rateA: number;
  rateB: number;
  /** Relative lift of B over A; null when A's rate is zero. */
  lift: number | null;
  z: number;
  pValue: number;
  /** 1 - pValue, the two-sided confidence that the rates differ. */
  confidence: number;
}

/** Two-sided two-proportion z-test with pooled variance. */
export function twoProportionTest(successA: number, totalA: number, successB: number, totalB: number): ProportionTest {
  const rateA = totalA > 0 ? successA / totalA : 0;
  const rateB = totalB > 0 ? successB / totalB : 0;
  const lift = rateA > 0 ? (rateB - rateA) / rateA : null;
  if (totalA <= 0 || totalB <= 0) return { rateA, rateB, lift, z: 0, pValue: 1, confidence: 0 };
  const pooled = (successA + successB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  if (se === 0) return { rateA, rateB, lift, z: 0, pValue: 1, confidence: 0 };
  const z = (rateB - rateA) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { rateA, rateB, lift, z, pValue, confidence: 1 - pValue };
}

export interface MeanTest {
  meanA: number;
  meanB: number;
  lift: number | null;
  t: number;
  degreesOfFreedom: number;
  pValue: number;
  confidence: number;
}

function variance(values: number[], avg: number): number {
  return values.length > 1 ? values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1) : 0;
}

/** Regularised incomplete beta function, continued-fraction form (Numerical Recipes betacf). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);
  const cf = (xx: number, aa: number, bb: number): number => {
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    d = Math.abs(d) < 1e-30 ? 1e-30 : d;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m += 1) {
      const m2 = 2 * m;
      let num = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + num * d;
      d = Math.abs(d) < 1e-30 ? 1e-30 : d;
      c = 1 + num / c;
      c = Math.abs(c) < 1e-30 ? 1e-30 : c;
      d = 1 / d;
      h *= d * c;
      num = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + num * d;
      d = Math.abs(d) < 1e-30 ? 1e-30 : d;
      c = 1 + num / c;
      c = Math.abs(c) < 1e-30 ? 1e-30 : c;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-10) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}

function lnGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const coefficient of g) {
    y += 1;
    ser += coefficient / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Two-sided p-value for Student's t with the given degrees of freedom. */
export function tTestPValue(t: number, df: number): number {
  if (df <= 0 || !Number.isFinite(t)) return 1;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Welch's unequal-variance t-test on two samples of daily values. */
export function welchTest(a: number[], b: number[]): MeanTest {
  const meanA = a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const meanB = b.length ? b.reduce((s, v) => s + v, 0) / b.length : 0;
  const lift = meanA > 0 ? (meanB - meanA) / meanA : null;
  if (a.length < 2 || b.length < 2) return { meanA, meanB, lift, t: 0, degreesOfFreedom: 0, pValue: 1, confidence: 0 };
  const va = variance(a, meanA) / a.length;
  const vb = variance(b, meanB) / b.length;
  if (va + vb === 0) return { meanA, meanB, lift, t: 0, degreesOfFreedom: 0, pValue: meanA === meanB ? 1 : 0, confidence: meanA === meanB ? 0 : 1 };
  const t = (meanB - meanA) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const pValue = tTestPValue(t, df);
  return { meanA, meanB, lift, t, degreesOfFreedom: df, pValue, confidence: 1 - pValue };
}

// Pure numeric helpers for the resources module. DOM-free, allocation-free.

// Finite number or fallback. Treats null/undefined/NaN/±Infinity as missing.
export function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Finite, non-negative number or fallback.
export function nonNeg(v, fallback = 0) {
  const n = num(v, fallback);
  return n < 0 ? 0 : n;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Income multiplier from happiness: h=1 -> 1x, h=2 -> 1.5x, h=0.25 -> 0.625x.
export function happinessIncomeCurve(h) {
  return 0.5 + 0.5 * h;
}

// Diminishing civic bonus: approaches `cap` as the happiness sum grows.
// civicBonus(0) = 0; civicBonus(scale) ≈ 0.63·cap; civicBonus(3·scale) ≈ 0.95·cap.
export function civicBonus(sum, cap, scale) {
  if (!(sum > 0) || !(cap > 0)) return 0;
  if (!(scale > 0)) return cap;
  return cap * (1 - Math.exp(-sum / scale));
}

// Pollution penalty from the (already scaled) negative-happiness sum.
// Linear when no cap is configured (the DESIGN.md form): penalty = x.
// With a cap it saturates like the civic bonus so a long industrial run bottoms out instead
// of sliding forever: cap·(1 − exp(−x / curve)); slope cap/curve near zero, → cap as x grows.
// A cap without a curve is a hard clamp: min(x, cap).
export function pollutionPenalty(x, cap, curve) {
  if (!(x > 0)) return 0;
  if (!(cap > 0)) return x;
  if (!(curve > 0)) return x < cap ? x : cap;
  return cap * (1 - Math.exp(-x / curve));
}

// Share of the grid the city can actually light. 1 when nothing draws power.
export function powerRatioOf(cap, demand, floor) {
  if (!(demand > 0)) return 1;
  return clamp(cap / demand, floor, 1);
}

// Fraction of citizens without a job.
export function unemploymentOf(pop, employed) {
  if (!(pop > 0)) return 0;
  return clamp((pop - employed) / pop, 0, 1);
}

// How far occupancy exceeds housing (0 when there is room). Capped so a city that
// sold every home still yields a finite, UI-friendly number.
export const OVERCROWD_MAX = 10;
export function overcrowdOf(pop, housing) {
  if (!(pop > 0)) return 0;
  if (!(housing > 0)) return OVERCROWD_MAX;
  return clamp(pop / housing - 1, 0, OVERCROWD_MAX);
}

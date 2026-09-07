// Number/time formatting shared by UI and tools. DOM-free.
//
// One rule everywhere: values are FLOORED to the displayed precision (Cookie Clicker style),
// below and above the 1000 boundary alike. A player holding $999,999 sees "$999K" next to a
// "$1.00M" cost, never two identical numbers with a disabled button. Displayed money is
// therefore never larger than real money, and a displayed cost never smaller than the real one.

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

// toFixed on the floored value, with a tiny nudge so decimal-looking inputs that sit just
// under their decimal in binary (0.1 + 0.2 = 0.30000000000000004, 1.15 * 100 = 114.99999…)
// floor the way a human expects.
function floorFixed(v, d) {
  const p = Math.pow(10, d);
  return (Math.floor(v * p + 1e-9) / p).toFixed(d);
}

// Format `v` (scaled into [1, 1000)) with 3 significant figures. Returns null if the value
// somehow reads as >= 1000 so the caller bumps the suffix instead of printing "1000K".
function tierFixed(v, digits) {
  const s = v >= 100 ? floorFixed(v, 0) : v >= 10 ? floorFixed(v, 1) : floorFixed(v, digits);
  return Number(s) >= 1000 ? null : s;
}

// "-0.00" reads as a bug: a negative that floors to zero at the shown precision is just zero.
function signed(neg, s) {
  return neg && /[1-9]/.test(s) ? '-' + s : s;
}

export function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : '—';
  digits = Number.isInteger(digits) && digits >= 0 ? Math.min(digits, 20) : 2;
  const neg = n < 0;
  n = Math.abs(n);
  if (n < 1000) {
    if (n >= 10 || n === Math.floor(n)) return signed(neg, Math.floor(n).toString());
    return signed(neg, floorFixed(n, digits));
  }
  let e = Math.floor(Math.log10(n) / 3);
  // log10 float error can land one tier off right at a power of 1000: re-anchor.
  if (Math.pow(1000, e) > n) e--;
  else if (Math.pow(1000, e + 1) <= n) e++;
  let s = null;
  while (e < SUFFIX.length) {
    s = tierFixed(n / Math.pow(1000, e), digits);
    if (s !== null) break;
    e++;
  }
  if (s === null) {
    // Beyond the suffix table (>= 1e36): floored 3-figure mantissa in scientific notation.
    let exp = Math.floor(Math.log10(n));
    let m = n / Math.pow(10, exp);
    if (m >= 10) (m /= 10), exp++; // log10 float error at an exact power of ten
    else if (m < 1) (m *= 10), exp--;
    return signed(neg, floorFixed(m, 2) + 'e' + exp);
  }
  return signed(neg, s + SUFFIX[e]);
}

export function fmtMoney(n, digits = 2) {
  if (Number.isNaN(n) || typeof n !== 'number') return '$—';
  const s = fmt(n, digits);
  return s.startsWith('-') ? '-$' + s.slice(1) : '$' + s;
}

export function fmtRate(n, unit = '', digits = 2) {
  const s = fmt(n, digits);
  return (n >= 0 ? '+' : '') + s + unit + '/s';
}

export function fmtInt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) < 1e6 ? (Math.trunc(n) || 0).toLocaleString('en-US') : fmt(n);
}

export function fmtPct(x, digits = 0) {
  if (!Number.isFinite(x)) return '—';
  digits = Number.isInteger(digits) && digits >= 0 ? Math.min(digits, 20) : 0;
  const neg = x < 0;
  // Floor rule like fmt(): 0.999 -> "99%", never "100%"; -0.001 -> "0%", never "-0%".
  return signed(neg, floorFixed(Math.abs(x) * 100, digits)) + '%';
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

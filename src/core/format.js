// Number/time formatting shared by UI and tools. DOM-free.

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

// toFixed with a tiny nudge so decimal-looking inputs round the way a human expects
// (9.995 is 9.99499999… in binary; toFixed alone prints "9.99").
function roundFixed(v, d) {
  const p = Math.pow(10, d);
  return (Math.round(v * p + 1e-9) / p).toFixed(d);
}

// Format `v` (scaled into [1, 1000)) with 3 significant figures, choosing the digit count from
// the ROUNDED value so 99.95 -> "100" (not "100.0"). Returns null when rounding carried past
// 1000 (999.96 -> "1000") so the caller bumps the suffix instead of printing "1000K".
function tierFixed(v, digits) {
  let s = v >= 100 ? roundFixed(v, 0) : v >= 10 ? roundFixed(v, 1) : roundFixed(v, digits);
  const r = Number(s);
  if (r >= 1000) return null;
  if (r >= 100 && v < 100) s = roundFixed(r, 0);
  else if (r >= 10 && v < 10) s = roundFixed(r, 1);
  return s;
}

export function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : '—';
  digits = Number.isInteger(digits) && digits >= 0 ? Math.min(digits, 20) : 2;
  const neg = n < 0;
  n = Math.abs(n);
  if (n < 1000) {
    if (n >= 10 || n === Math.floor(n)) return (neg ? '-' : '') + Math.floor(n).toString();
    let s = roundFixed(n, digits);
    if (Number(s) >= 10) s = '10'; // 9.996 -> "10", not "10.00"
    return (neg ? '-' : '') + s;
  }
  let e = Math.floor(Math.log10(n) / 3);
  // log10 float error can land one tier off right at a power of 1000: re-anchor.
  if (Math.pow(1000, e) > n) e--;
  else if (Math.pow(1000, e + 1) <= n) e++;
  let s = null;
  while (e < SUFFIX.length) {
    s = tierFixed(n / Math.pow(1000, e), digits);
    if (s !== null) break;
    e++; // rounding carried into the next magnitude (999,999 -> "1.00M")
  }
  if (s === null) {
    return (neg ? '-' : '') + n.toExponential(2).replace('e+', 'e');
  }
  return (neg ? '-' : '') + s + SUFFIX[e];
}

export function fmtMoney(n, digits = 2) {
  if (!Number.isFinite(n)) return '$—';
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
  return (x * 100).toFixed(digits) + '%';
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

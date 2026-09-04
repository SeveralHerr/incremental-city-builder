// Number/time formatting shared by UI and tools. DOM-free.

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : '—';
  const neg = n < 0;
  n = Math.abs(n);
  if (n < 1000) {
    const s = n < 10 && n !== Math.floor(n) ? n.toFixed(digits) : Math.floor(n).toString();
    return (neg ? '-' : '') + s;
  }
  const e = Math.floor(Math.log10(n) / 3);
  if (e >= SUFFIX.length) {
    return (neg ? '-' : '') + n.toExponential(2).replace('e+', 'e');
  }
  const v = n / Math.pow(1000, e);
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(digits);
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
  return n < 1e6 ? Math.floor(n).toLocaleString('en-US') : fmt(n);
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

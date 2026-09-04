// Tiny DOM helpers + number tweening. UI-only (this module may touch the DOM).
import { fmt, fmtMoney, fmtInt, fmtPct, fmtRate, fmtTime } from '../core/format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// h('div.card.is-active#id', { attrs }, ...children)
export function h(spec, attrs, ...children) {
  const [tagAndId, ...classes] = spec.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'hidden') el.hidden = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (attrs !== undefined) {
    children.unshift(attrs);
  }
  append(el, children);
  return el;
}

export function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
}

export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Write textContent only when it actually changed (cheap per-frame updates, no layout churn).
export function setText(el, str) {
  if (!el) return;
  str = str == null ? '' : String(str);
  if (el.__txt !== str) {
    el.__txt = str;
    el.textContent = str;
  }
}

export function setClass(el, cls, on) {
  if (!el) return;
  const has = el.classList.contains(cls);
  if (on && !has) el.classList.add(cls);
  else if (!on && has) el.classList.remove(cls);
}

export function setHidden(el, hidden) {
  if (el && el.hidden !== !!hidden) el.hidden = !!hidden;
}

export function setAttr(el, name, value) {
  if (!el) return;
  const key = '__attr_' + name;
  if (el[key] === value) return;
  el[key] = value;
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : value);
}

// Progress fill via transform (compositor-only). `p` in [0,1].
export function setProgress(el, p) {
  if (!el) return;
  p = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  const q = Math.round(p * 500) / 500;
  if (el.__p === q) return;
  el.__p = q;
  el.style.transform = `scaleX(${q})`;
}

export function setDisabled(el, disabled) {
  if (el && el.disabled !== !!disabled) el.disabled = !!disabled;
}

export const reducedMotion = (() => {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
})();

// Smoothly approach a target. Rises are eased (satisfying counter roll); drops snap
// (a purchase should visibly cost money at once). Large jumps snap so the display never lags
// far behind the sim (headless stepping, offline progress, prestige).
export function tween(initial = 0) {
  const t = {
    value: initial,
    target: initial,
    update(target, dt, { rate = 10, snapRatio = 0.6 } = {}) {
      if (!Number.isFinite(target)) target = 0;
      t.target = target;
      const v = t.value;
      if (reducedMotion || target < v || dt <= 0 || dt > 0.25) {
        t.value = target;
        return target;
      }
      const diff = target - v;
      if (diff < 1e-9) {
        t.value = target;
        return target;
      }
      if (Math.abs(target) > 0 && diff / Math.abs(target) > snapRatio) {
        t.value = target;
        return target;
      }
      const k = 1 - Math.exp(-rate * dt);
      let nv = v + diff * k;
      if (target - nv < Math.max(1e-6, Math.abs(target) * 1e-4)) nv = target;
      t.value = nv;
      return nv;
    },
    snap(v) {
      t.value = t.target = Number.isFinite(v) ? v : 0;
    },
  };
  return t;
}

// ---- Number formatting with the user's numFormat setting ----
let numFormat = 'short';
export function setNumFormat(mode) {
  numFormat = mode === 'full' ? 'full' : 'short';
}
export function getNumFormat() {
  return numFormat;
}

function locale(n) {
  return Math.floor(Math.abs(n)).toLocaleString('en-US');
}

export function money(n) {
  if (!Number.isFinite(n)) return '$—';
  const limit = numFormat === 'full' ? 1e15 : 1e6;
  if (Math.abs(n) < limit) return (n < 0 ? '-$' : '$') + locale(n);
  return fmtMoney(n);
}

export function num(n) {
  if (!Number.isFinite(n)) return '—';
  const limit = numFormat === 'full' ? 1e15 : 1e6;
  if (Math.abs(n) < limit) return (n < 0 ? '-' : '') + locale(n);
  return fmt(n);
}

export function short(n, digits = 2) {
  return fmt(n, digits);
}

export function rate(n, unit = '') {
  if (!Number.isFinite(n)) return '—';
  return fmtRate(n, unit);
}

export function moneyRate(n) {
  if (!Number.isFinite(n)) return '—';
  const s = fmt(Math.abs(n));
  return (n < 0 ? '-$' : '+$') + s + '/s';
}

export { fmt, fmtMoney, fmtInt, fmtPct, fmtTime };

// Small inline SVG icons (stroke-based, currentColor).
export const ICONS = {
  gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  logo: '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0f172a"/><path d="M6 26V14h6v12zm8 0V8h6v18zm8 0V17h4v9z" fill="#38bdf8"/><path d="M8 17h2M8 20h2M8 23h2M16 11h2M16 14h2M16 17h2M16 20h2M16 23h2M24 20h1M24 23h1" stroke="#0f172a" stroke-width="1.2"/></svg>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = ICONS[name] || '';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

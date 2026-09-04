// Toasts: milestone / offline / prestige / unlock notices, bottom-right, newest at the bottom.
// Each toast carries a thin timer bar that drains over its lifetime; hovering pauses it.
// Public shape: createToasts(root) -> { el, show({ title, body, icon, kind, timeout }), clear() }
import { h, reducedMotion } from './dom.js';

const MAX_VISIBLE = 4;
const DEDUPE_MS = 1500; // identical title within this window is folded into the existing toast

export function createToasts(root) {
  const host = h('div.toasts', { 'aria-live': 'polite', 'aria-atomic': 'false' });
  root.append(host);
  const recent = new Map(); // title -> { el, at }

  function show({ title = '', body = '', icon = '✨', kind = 'info', timeout = 5600 } = {}) {
    const now = performance.now();
    const dup = recent.get(title);
    if (dup && dup.el.isConnected && now - dup.at < DEDUPE_MS) {
      dup.at = now;
      dup.el.classList.remove('is-bump');
      void dup.el.offsetWidth;
      dup.el.classList.add('is-bump');
      return dup.el;
    }
    while (host.children.length >= MAX_VISIBLE) dismiss(host.firstChild, true);
    const timer = h('div.toast-timer', { 'aria-hidden': 'true' });
    const el = h(`div.toast.toast-${kind}`, { role: 'status' }, [
      h('span.toast-icon', { text: icon, 'aria-hidden': 'true' }),
      h('div.toast-body', [h('div.toast-title', { text: title }), body ? h('div.toast-text', { text: body }) : null]),
      timer,
    ]);
    timer.style.setProperty('--life', `${timeout}ms`);
    host.append(el);
    recent.set(title, { el, at: now });

    let remaining = timeout;
    let started = now;
    let handle = setTimeout(() => dismiss(el), remaining);
    el.addEventListener('mouseenter', () => {
      clearTimeout(handle);
      remaining -= performance.now() - started;
      el.classList.add('is-paused');
    });
    el.addEventListener('mouseleave', () => {
      started = performance.now();
      el.classList.remove('is-paused');
      handle = setTimeout(() => dismiss(el), Math.max(600, remaining));
    });
    el.addEventListener('click', () => dismiss(el));
    el.__timer = () => clearTimeout(handle);
    return el;
  }

  function dismiss(el, immediate = false) {
    if (!el || !el.isConnected) return;
    if (typeof el.__timer === 'function') el.__timer();
    if (reducedMotion || immediate) return el.remove();
    el.classList.add('is-leaving');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
    };
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 400);
  }

  function clear() {
    for (const c of Array.from(host.children)) dismiss(c);
  }

  return { el: host, show, clear };
}

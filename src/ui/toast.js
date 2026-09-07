// Toasts: milestone / offline / prestige / unlock notices. The host is a zero-height overlay
// pinned to the top of the panel it is mounted in (the city panel), so toasts stack downward
// over the skyline — a large, forgiving tap target — and never over the Legacy panel's 'Found a
// new city' / 'Sign' buttons, the build column's Buy buttons or the sidebar, at any scroll
// position. Two at most, compact padding, newest at the bottom. Each toast carries a thin timer
// bar that drains over its lifetime; hovering pauses it.
// Public shape: createToasts(parent) -> { el, show({ title, body, icon, kind, timeout }), clear(), count() }
import { h, prefersReducedMotion } from './dom.js';

export const MAX_VISIBLE = 2;
const DEDUPE_MS = 1500; // identical title within this window is folded into the existing toast

export function createToasts(parent) {
  const stack = h('div.toast-stack');
  const host = h('div.toasts', { 'aria-live': 'polite', 'aria-atomic': 'false' }, [stack]);
  parent.append(host);
  const recent = new Map(); // title -> { el, at }

  // 4.2 s default: two stacked toasts at 5.6 s hid the skyline for most of the opening's unlock
  // bursts; a milestone line reads in under three seconds, and the stack still pauses on hover.
  function show({ title = '', body = '', icon = '✨', kind = 'info', timeout = 4200 } = {}) {
    const now = performance.now();
    const dup = recent.get(title);
    if (dup && dup.el.isConnected && now - dup.at < DEDUPE_MS) {
      dup.at = now;
      dup.el.classList.remove('is-bump');
      void dup.el.offsetWidth;
      dup.el.classList.add('is-bump');
      return dup.el;
    }
    while (live().length >= MAX_VISIBLE) dismiss(live()[0], true);
    const timer = h('div.toast-timer', { 'aria-hidden': 'true' });
    const el = h(`div.toast.toast-${kind}`, { role: 'status' }, [
      h('span.toast-icon', { text: icon, 'aria-hidden': 'true' }),
      h('div.toast-body', [h('div.toast-title', { text: title }), body ? h('div.toast-text', { text: body }) : null]),
      timer,
    ]);
    timer.style.setProperty('--life', `${timeout}ms`);
    stack.append(el);
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

  // Toasts still counting toward the stack (a leaving toast no longer holds a slot).
  function live() {
    return Array.from(stack.children).filter((c) => !c.classList.contains('is-leaving'));
  }

  function dismiss(el, immediate = false) {
    if (!el || !el.isConnected) return;
    if (typeof el.__timer === 'function') el.__timer();
    if (prefersReducedMotion() || immediate) return el.remove();
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
    for (const c of Array.from(stack.children)) dismiss(c);
  }

  return { el: host, show, clear, count: () => live().length };
}

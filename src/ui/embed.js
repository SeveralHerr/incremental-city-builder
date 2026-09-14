// Embedded play (docs/FEEDBACK.md F13). itch.io frames the game in an <iframe>; the stage
// layout already fits the frame (nothing scrolls but the sheet body), and fullscreen is far
// better once found — so inside a frame, on first load, a small chip offers it. It never
// blocks anything, dismisses with one tap, and stays dismissed: the setting is not in the
// simulation's whitelist (settings there are game state), so the memory lives in this
// browser's localStorage, guarded — a blocked store just means the chip shows again next time.
//
// Public shape: createFullscreenPrompt(ui, host) -> { el, show(), dismiss(), offered }
// Pure: isFramed(win), shouldOfferFullscreen({ framed, forced, dismissed, canFullscreen, fullscreen })

import { h, setText, setHidden, prefersReducedMotion } from './dom.js';

export const STORAGE_KEY = 'metropolis.ui.fullscreenPrompt';
const FAIL_NOTE = 'Use the fullscreen button under the game';
const FAIL_NOTE_MS = 6000;

// True when this document is not the top-level page (an iframe on itch.io or anywhere else).
// A cross-origin parent throws on some property reads; `self !== top` itself never does, but
// the guard keeps a hostile embedder from taking the UI down.
export function isFramed(win) {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    return !!w && w.self !== w.top;
  } catch {
    return true;
  }
}

// Whether to put the chip up at all. Only inside a frame (or when tooling forces it with
// ?embed=1), only while the browser can go fullscreen, never once dismissed or already full.
export function shouldOfferFullscreen({ framed = false, forced = false, dismissed = false, canFullscreen = true, fullscreen = false } = {}) {
  if (dismissed || fullscreen || !canFullscreen) return false;
  return !!(framed || forced);
}

export function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function writeDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, 'dismissed');
  } catch {
    /* private mode or a blocked store: the chip simply returns next load */
  }
}

// Enter fullscreen on the document (the whole game, not just the stage, so the sheet, the
// toasts and the dialog all come along). Resolves true when the browser granted it.
export async function requestFullscreen(doc) {
  const d = doc || document;
  const el = d.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (typeof fn !== 'function') return false;
  try {
    await fn.call(el);
    return !!(d.fullscreenElement || d.webkitFullscreenElement);
  } catch {
    return false;
  }
}

export function createFullscreenPrompt(ui, host) {
  const { game } = ui;
  const doc = document;
  const forced = !!(game.params && typeof game.params.has === 'function' && game.params.has('embed'));
  const canFullscreen = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const offered = shouldOfferFullscreen({
    framed: isFramed(),
    forced,
    dismissed: readDismissed(),
    canFullscreen,
    fullscreen: !!(doc.fullscreenElement || doc.webkitFullscreenElement),
  });

  const label = h('span.fs-label', { text: 'Fullscreen ↗' });
  const go = h('button.fs-go', { type: 'button', title: 'Play fullscreen (Esc leaves)', 'aria-label': 'Play fullscreen' }, [label]);
  const close = h('button.fs-close', { type: 'button', 'aria-label': 'Dismiss', title: 'Not now' }, [h('span', { 'aria-hidden': 'true', text: '×' })]);
  const el = h('div.fs-prompt', { role: 'note', hidden: true }, [go, close]);
  let failTimer = 0;

  function dismiss(remember = true) {
    clearTimeout(failTimer);
    setHidden(el, true);
    if (remember) writeDismissed();
  }
  function show() {
    if (!prefersReducedMotion()) el.classList.add('is-entering');
    setHidden(el, false);
  }

  go.addEventListener('click', async () => {
    const ok = await requestFullscreen(doc);
    if (ok) return dismiss(true);
    // The frame was not given allowfullscreen (or the browser refused): point at the host
    // page's own control for a moment, then get out of the way for good.
    setText(label, FAIL_NOTE);
    go.disabled = true;
    clearTimeout(failTimer);
    failTimer = setTimeout(() => dismiss(true), FAIL_NOTE_MS);
  });
  close.addEventListener('click', () => dismiss(true));
  // Fullscreen reached by any route (the host's button, F11 on some browsers): the offer is moot.
  doc.addEventListener('fullscreenchange', () => {
    if (doc.fullscreenElement) dismiss(true);
  });

  if (host) host.append(el);
  if (offered) show();
  return { el, show, dismiss, offered };
}

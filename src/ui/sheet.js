// The sheet: one panel that slides up over the road and holds every list the game has (build,
// upgrades, goals, city hall). It is deliberately not a modal — the sky above it stays live and
// tappable, so collecting never means dismissing anything first.
//
// Public shape: createSheet(ui, pages) -> { el, open(id, { anchor }), close(), toggle(id),
//   isOpen(), current(), visible(id), onChange(fn) }
// `pages` is [{ id, title, el }] in dock order. `anchor` (a selector inside the page, or an
// element) lands the page on that row: the body scrolls so it starts at the top and its panel
// flashes for a second — the HUD's mood gauge lands on the happiness breakdown this way.
import { h, icon, setText, setClass, setAttr, prefersReducedMotion } from './dom.js';

const DRAG_CLOSE = 64; // px dragged down on the grip before the sheet lets go
const CLOSE_KEYS = ['Escape', 'Esc'];
const FLASH_MS = 1000; // how long a landed-on row keeps its outline
const LAND_TRIES = 6; // frames to wait for a gated panel to be un-hidden by the next render

export function createSheet(ui, pages) {
  const title = h('h2.sheet-title', { text: '', tabindex: '-1' });
  const closeBtn = h('button.sheet-close', { type: 'button', 'aria-label': 'Close panel' }, [icon('close')]);
  const grip = h('div.sheet-grip', { 'aria-hidden': 'true' }, [h('span.grip-bar')]);
  const body = h('div.sheet-body');
  const el = h('div#city-sheet.sheet.is-closed', { role: 'region', 'aria-label': 'City controls' }, [
    grip,
    h('div.sheet-head', [title, closeBtn]),
    body,
  ]);

  const byId = new Map();
  for (const p of pages) {
    const page = h('div.sheet-page', { dataset: { page: p.id }, hidden: true }, [p.el]);
    byId.set(p.id, { ...p, page });
    body.append(page);
  }

  let current = null;
  const listeners = [];
  let opener = null; // the control focus came from, given back on close
  let flashed = null;
  let flashTimer = 0;
  let landing = 0; // token: a newer open() cancels an older landing

  function open(id, opts) {
    const p = byId.get(id);
    if (!p) return;
    landing++;
    const changed = current !== id;
    if (changed) {
      // Focus follows the page in: a dock press leaves the button and lands on the title (a
      // heading, tabindex -1, so the tab order is unchanged), and goes back on close().
      const a = document.activeElement;
      if (a && a !== document.body && !el.contains(a)) opener = a;
      for (const [pid, q] of byId) q.page.hidden = pid !== id;
      current = id;
      setText(title, p.title);
      setAttr(el, 'aria-label', p.title);
      body.scrollTop = 0;
    }
    el.style.transform = '';
    setClass(el, 'is-closed', false);
    if (changed) focusTitle(landing);
    emit();
    if (opts && opts.anchor) landOn(opts.anchor, landing);
  }

  // The closed sheet is visibility: hidden and that property transitions with the slide, so in
  // the same style flush as the class change it still reads hidden and focus() is a no-op; a
  // frame later the transition is under way and the title is focusable. Retried a frame at a
  // time, a handful of times, and abandoned if the sheet moved on.
  function focusTitle(token) {
    let tries = 0;
    const attempt = () => {
      if (token !== landing || !current) return;
      try {
        title.focus({ preventScroll: true });
      } catch {
        return;
      }
      if (document.activeElement !== title && ++tries < LAND_TRIES) raf(attempt);
    };
    attempt();
  }

  function raf(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  function close() {
    if (!current) return;
    landing++;
    el.style.transform = '';
    setClass(el, 'is-closed', true);
    current = null;
    emit();
    const a = document.activeElement;
    if (opener && opener.isConnected && (!a || a === document.body || el.contains(a))) {
      try {
        opener.focus({ preventScroll: true });
      } catch {
        /* nothing to give back to */
      }
    }
    opener = null;
  }

  // Scroll the body so `anchor` starts at its top and outline its panel for a second. The
  // next full render (index.js, after emit) is what un-hides a gated panel such as the
  // happiness breakdown, so this waits a frame at a time, up to LAND_TRIES, for the row to
  // be visible; a row that never shows lands nowhere. Only the sheet body scrolls — never the
  // document, which is overflow: hidden and would shift the whole stage.
  function landOn(anchor, token) {
    let tries = 0;
    const attempt = () => {
      if (token !== landing) return;
      const target = typeof anchor === 'string' ? body.querySelector(anchor) : anchor;
      const shown = target && body.contains(target) && !target.closest('[hidden]') && target.getClientRects().length > 0;
      if (!shown) {
        if (++tries < LAND_TRIES) raf(attempt);
        return;
      }
      const top = Math.max(0, target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 4);
      try {
        body.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } catch {
        body.scrollTop = top;
      }
      const panel = target.closest('.panel, .ms-item') || target;
      if (flashed) setClass(flashed, 'is-flash', false);
      clearTimeout(flashTimer);
      flashed = panel;
      setClass(panel, 'is-flash', true);
      flashTimer = setTimeout(() => {
        setClass(panel, 'is-flash', false);
        if (flashed === panel) flashed = null;
      }, FLASH_MS);
    };
    raf(attempt);
  }

  function toggle(id) {
    if (current === id) close();
    else open(id);
  }

  function emit() {
    for (const fn of listeners) {
      try {
        fn(current);
      } catch {
        /* a listener must never take the sheet down with it */
      }
    }
  }

  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (!current || !CLOSE_KEYS.includes(e.key)) return;
    if (ui.modal && ui.modal.isOpen()) return; // the settings dialog owns Escape while it is up
    close();
  });

  // Drag the grip (or the header) down to dismiss — the gesture a bottom sheet owes a phone.
  // On a short, wide screen the sheet is a side panel instead (see --sheet-axis in the CSS),
  // and the dismiss gesture follows it: drag right, not down.
  function axis() {
    try {
      return getComputedStyle(el).getPropertyValue('--sheet-axis').trim() === 'x' ? 'x' : 'y';
    } catch {
      return 'y';
    }
  }
  let drag = null;
  const startDrag = (e) => {
    if (!current || e.button > 0) return;
    drag = { id: e.pointerId, from: e.clientY, fromX: e.clientX, dy: 0, axis: axis() };
    el.setPointerCapture?.(e.pointerId);
    setClass(el, 'is-dragging', true);
  };
  const moveDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, drag.axis === 'x' ? e.clientX - drag.fromX : e.clientY - drag.from);
    const fn = drag.axis === 'x' ? 'translateX' : 'translateY';
    el.style.transform = drag.dy ? `${fn}(${drag.dy.toFixed(0)}px)` : '';
  };
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.dy;
    drag = null;
    setClass(el, 'is-dragging', false);
    el.style.transform = '';
    if (dy > DRAG_CLOSE) close();
  };
  for (const handle of [grip, title]) handle.addEventListener('pointerdown', startDrag);
  el.addEventListener('pointermove', moveDrag);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // Reduced motion: no slide, the sheet simply appears.
  if (prefersReducedMotion()) el.classList.add('no-anim');

  return {
    el,
    open,
    close,
    toggle,
    isOpen: () => current !== null,
    current: () => current,
    visible: (id) => current === id,
    onChange: (fn) => listeners.push(fn),
  };
}

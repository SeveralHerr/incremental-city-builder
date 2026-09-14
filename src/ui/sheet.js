// The sheet: one panel that slides up over the road and holds every list the game has (build,
// upgrades, goals, city hall). It is deliberately not a modal — the sky above it stays live and
// tappable, so collecting never means dismissing anything first.
//
// Public shape: createSheet(ui, pages) -> { el, open(id), close(), toggle(id), isOpen(),
//   current(), visible(id), onChange(fn) }
// `pages` is [{ id, title, el }] in dock order.
import { h, icon, setText, setClass, setAttr, prefersReducedMotion } from './dom.js';

const DRAG_CLOSE = 64; // px dragged down on the grip before the sheet lets go
const CLOSE_KEYS = ['Escape', 'Esc'];

export function createSheet(ui, pages) {
  const title = h('h2.sheet-title', { text: '' });
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

  function open(id) {
    const p = byId.get(id);
    if (!p) return;
    if (current !== id) {
      for (const [pid, q] of byId) q.page.hidden = pid !== id;
      current = id;
      setText(title, p.title);
      setAttr(el, 'aria-label', p.title);
      body.scrollTop = 0;
    }
    el.style.transform = '';
    setClass(el, 'is-closed', false);
    emit();
  }

  function close() {
    if (!current) return;
    el.style.transform = '';
    setClass(el, 'is-closed', true);
    current = null;
    emit();
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

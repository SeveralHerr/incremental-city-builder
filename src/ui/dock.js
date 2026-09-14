// The dock: four buttons parked on the road at the foot of the city. This is the only piece of
// permanent chrome in the game — everything else is either the skyline or a sheet the player
// pulled up. Buttons are physical: a hard bottom edge that compresses when pressed, so a tap
// reads as a press even without sound.
//
// Public shape: createDock(ui, items) -> { el, update(ctx), setActive(id) }
// `items` is [{ id, label, icon, visible(ctx), badge(ctx) }]; `badge` returns a count (a number
// over 0 prints, `true` prints a bare dot, anything else hides it).
import { h, icon as iconEl, setText, setHidden, setClass, setAttr, num } from './dom.js';

export function createDock(ui, items) {
  const el = h('nav.dock', { 'aria-label': 'City controls' });
  const buttons = new Map();

  for (const item of items) {
    const badge = h('span.dock-badge', { hidden: true, 'aria-hidden': 'true' });
    const btn = h('button.dock-btn', {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'city-sheet',
      'aria-label': item.label,
      title: item.label,
      dataset: { page: item.id },
    }, [
      h('span.dock-glyph', [iconEl(item.icon)]),
      h('span.dock-label', { text: item.label }),
      badge,
    ]);
    btn.addEventListener('click', () => ui.toggleSheet(item.id));
    buttons.set(item.id, { item, el: btn, badge, shown: '' });
    el.append(btn);
  }

  function setActive(id) {
    for (const [pid, b] of buttons) {
      const on = pid === id;
      setClass(b.el, 'is-on', on);
      setAttr(b.el, 'aria-expanded', on ? 'true' : 'false');
    }
  }

  function update(ctx) {
    for (const b of buttons.values()) {
      const show = typeof b.item.visible === 'function' ? !!b.item.visible(ctx) : true;
      setHidden(b.el, !show);
      if (!show) continue;
      const v = typeof b.item.badge === 'function' ? b.item.badge(ctx) : 0;
      const count = typeof v === 'number' && v > 0 ? num(Math.min(v, 99)) : v === true ? '' : null;
      const key = count === null ? '' : count || 'dot';
      if (key !== b.shown) {
        b.shown = key;
        setHidden(b.badge, count === null);
        setClass(b.badge, 'is-dot', count === '');
        setText(b.badge, count || '');
        setAttr(b.el, 'aria-label', count ? `${b.item.label} (${count} ready)` : b.item.label);
      }
    }
  }

  return { el, update, setActive };
}

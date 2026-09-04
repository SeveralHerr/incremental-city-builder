// Event log feed: last N entries of state.log, newest first, new entries fade in.
import { h, setText, setHidden, fmtTime } from './dom.js';

const SHOW = 8;

export function createLogPanel(ui) {
  const { game } = ui;
  const list = h('ul.log-list', { 'aria-label': 'City log' });
  const empty = h('p.empty-note', { text: 'Nothing has happened yet. Every city starts quiet.' });
  const el = h('section.panel.panel-log', [h('div.panel-head', [h('h2.panel-title', { text: 'City log' })]), list, empty]);

  const known = new WeakMap(); // entry object -> li
  let lastLen = -1;
  let lastHead = null;

  function update() {
    const log = Array.isArray(game.state.log) ? game.state.log : [];
    const head = log[log.length - 1] || null;
    if (log.length === lastLen && head === lastHead && list.children.length) return;
    lastLen = log.length;
    lastHead = head;
    const slice = log.slice(-SHOW).reverse();
    setHidden(empty, slice.length > 0);
    const wanted = [];
    for (const entry of slice) {
      let li = known.get(entry);
      if (!li) {
        li = h(`li.log-item.kind-${sanitizeKind(entry.kind)}`, [
          h('span.log-time.mono', { text: fmtTime(entry.t) }),
          h('span.log-msg', { text: entry.msg }),
        ]);
        known.set(entry, li);
      }
      wanted.push(li);
    }
    // Reconcile in order.
    for (let i = 0; i < wanted.length; i++) {
      const cur = list.children[i];
      if (cur !== wanted[i]) list.insertBefore(wanted[i], cur || null);
    }
    while (list.children.length > wanted.length) list.lastChild.remove();
  }

  function rebuild() {
    lastLen = -1;
    update();
  }

  return { el, update, rebuild };
}

function sanitizeKind(k) {
  return /^[a-z][a-z0-9_-]*$/i.test(String(k || '')) ? String(k).toLowerCase() : 'info';
}

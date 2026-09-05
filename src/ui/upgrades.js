// Upgrades panel: available first (cheapest up), owned collapsed underneath, locked count teased.
import { h, setText, setHidden, setClass, setDisabled, setProgress, money, num } from './dom.js';

const VISIBLE_DEFAULT = 6;

export function createUpgradesPanel(ui) {
  const { game, content } = ui;
  const cards = new Map(); // id -> card
  const chips = new Map(); // id -> owned chip
  let rows = [];
  let signature = '';
  let expanded = false;

  const countEl = h('span.panel-meta.mono', { text: '' });
  const list = h('div.ucards');
  const ownedList = h('div.owned-list');
  const ownedSummary = h('summary.owned-summary', { text: 'Owned' });
  const owned = h('details.owned', { hidden: true }, [ownedSummary, ownedList]);
  const showMore = h('button.btn.btn-ghost.show-more', { type: 'button', text: '', hidden: true });
  showMore.addEventListener('click', () => {
    expanded = !expanded;
    signature = '';
    rebuild(rows);
  });
  const locked = h('p.locked-note', { text: '' });
  const empty = h('p.empty-note', { text: 'Nothing on the drawing board right now. Grow the city and new ideas will surface.' });
  const el = h('section.panel.panel-upgrades', { hidden: true }, [
    h('div.panel-head', [h('h2.panel-title', { text: 'Upgrades' }), countEl]),
    list,
    empty,
    showMore,
    owned,
    locked,
  ]);

  function card(def) {
    let c = cards.get(def.id);
    if (c) return c;
    const cat = content.category(def.category);
    const cost = h('span.btn-cost.mono', { text: money(def.cost) });
    const btn = h('button.btn.btn-buy.btn-sm', { type: 'button' }, [h('span.btn-label', { text: 'Buy' }), cost]);
    const fill = h('div.progress-fill');
    // Descriptions clamp to two lines; the full text rides along as a tooltip.
    const elc = h(`article.ucard.cat-${def.category}`, { dataset: { id: def.id }, title: def.desc || null }, [
      h('div.ucard-icon', { text: def.icon || '⚡', 'aria-hidden': 'true' }),
      h('div.ucard-main', [
        h('span.ucard-cat', { text: cat.name }),
        h('span.ucard-name', { text: def.name }),
        h('div.ucard-desc', { text: def.desc || '' }),
      ]),
      h('div.ucard-buy', [btn, h('div.progress.progress-xs.cost-bar', { 'aria-hidden': 'true' }, [fill])]),
    ]);
    elc.style.setProperty('--accent', cat.color);
    btn.addEventListener('click', () => game.api.buyUpgrade(def.id));
    if (ui.newlyUnlocked.has('u:' + def.id)) {
      ui.newlyUnlocked.delete('u:' + def.id);
      elc.classList.add('is-new');
      setTimeout(() => elc.classList.remove('is-new'), 6000);
    }
    c = { el: elc, def, btn, fill, cost };
    cards.set(def.id, c);
    return c;
  }

  function chip(def) {
    let c = chips.get(def.id);
    if (!c) {
      const cat = content.category(def.category);
      c = h('span.owned-chip', { title: def.desc || def.name }, [h('span', { text: def.icon || '⚡', 'aria-hidden': 'true' }), h('span', { text: def.name })]);
      c.style.setProperty('--accent', cat.color);
      chips.set(def.id, c);
    }
    return c;
  }

  // Charter perks (currency 'legacy') belong to the Legacy panel, never to this money list.
  function moneyRows(list) {
    const out = [];
    for (const r of list || []) if (r && r.currency !== 'legacy') out.push(r);
    return out;
  }

  function rebuild(newRows) {
    rows = moneyRows(newRows);
    const s = game.state;
    const show = !!s.unlocks['panel:upgrades'] && rows.length > 0;
    setHidden(el, !show);
    if (!show) return;
    const available = rows.filter((r) => r.unlocked && !r.owned).sort((a, b) => a.cost - b.cost);
    const ownedRows = rows.filter((r) => r.owned);
    const lockedCount = rows.length - available.length - ownedRows.length;
    const sig = available.map((r) => r.id).join(',') + '|' + ownedRows.map((r) => r.id).join(',');
    setText(countEl, `${ownedRows.length} / ${rows.length}`);
    setText(locked, lockedCount > 0 ? `${num(lockedCount)} more ${lockedCount === 1 ? 'idea waits' : 'ideas wait'} to be discovered.` : '');
    setHidden(empty, available.length > 0);
    if (sig === signature) return;
    signature = sig;
    const shown = expanded ? available : available.slice(0, VISIBLE_DEFAULT);
    reconcile(list, shown.map((r) => card(r).el));
    const hiddenCount = available.length - shown.length;
    setHidden(showMore, available.length <= VISIBLE_DEFAULT);
    setText(showMore, expanded ? 'Show fewer' : `Show ${num(hiddenCount)} more`);
    reconcile(ownedList, ownedRows.map((r) => chip(r)));
    setHidden(owned, ownedRows.length === 0);
    setText(ownedSummary, `Owned (${ownedRows.length})`);
    update(rows);
  }

  function update(newRows) {
    if (newRows) rows = moneyRows(newRows);
    if (el.hidden) return;
    const m = game.state.res.money;
    for (const r of rows) {
      const c = cards.get(r.id);
      if (!c || !c.el.isConnected) continue;
      setDisabled(c.btn, !r.affordable);
      setClass(c.el, 'is-affordable', !!r.affordable);
      setText(c.cost, money(r.cost));
      setProgress(c.fill, r.cost > 0 ? Math.min(1, m / r.cost) : 1);
    }
  }

  function reconcile(parent, wanted) {
    for (let i = 0; i < wanted.length; i++) {
      const cur = parent.children[i];
      if (cur !== wanted[i]) parent.insertBefore(wanted[i], cur || null);
    }
    while (parent.children.length > wanted.length) parent.lastChild.remove();
  }

  return { el, update, rebuild };
}

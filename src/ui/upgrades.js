// Upgrades panel: available first (cheapest up), then the next two locked rungs as dimmed
// teasers with their unlock hint and a progress bar, owned collapsed underneath, the rest of
// the locked count teased in one line.
import { h, icon, setText, setHidden, setClass, setDisabled, setProgress, setAttr, money, num } from './dom.js';
import { unlockMeasure, unlockLabel, unlockDisplayKey, teaserRungs } from './text.js';

const VISIBLE_DEFAULT = 6;
export const TEASERS = 2; // locked rungs shown under the open cards
const CLOSE_AT = 0.75; // progress at which a teaser brightens (.is-close), same as the build cards

export function createUpgradesPanel(ui) {
  const { game, content } = ui;
  const cards = new Map(); // id -> card
  const teasers = new Map(); // id -> locked teaser card
  const chips = new Map(); // id -> owned chip
  let rows = [];
  let signature = '';
  let expanded = false;
  let teased = []; // rows currently rendered as teasers

  const countEl = h('span.panel-meta.mono', { text: '' });
  const list = h('div.ucards');
  const teaserList = h('div.ucards.ucards-locked', { 'aria-label': 'Ideas not yet available' });
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
    teaserList,
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

  // Locked teaser: the rung's name and price, its unlock hint where the description would
  // be, and a thin bar toward the mirror threshold (money held, earned, citizens, ...).
  function teaser(def) {
    let t = teasers.get(def.id);
    if (t) return t;
    const cat = content.category(def.category);
    const hint = typeof def.unlockHint === 'string' && def.unlockHint.trim() ? def.unlockHint.trim() : 'Grow the city to reveal this idea.';
    const fill = h('div.progress-fill');
    const bar = h('div.progress.progress-xs.unlock-bar', { 'aria-hidden': 'true' }, [fill]);
    const meta = h('span.unlock-meta.mono', { text: '' });
    const barRow = h('div.ucard-unlock', [bar, meta]);
    const cost = h('span.ucard-lockcost.mono', { text: money(def.cost) });
    const elc = h(`article.ucard.is-locked.cat-${def.category}`, { dataset: { id: def.id }, title: def.desc || null, 'aria-label': `${def.name} (locked): ${hint}` }, [
      h('div.ucard-icon', { text: def.icon || '⚡', 'aria-hidden': 'true' }),
      h('div.ucard-main', [
        h('span.ucard-cat', { text: `${cat.name} · locked` }),
        h('span.ucard-name', { text: def.name }),
        h('div.ucard-desc.ucard-hint', { text: hint }),
        barRow,
      ]),
      h('div.ucard-buy.ucard-lock', [h('span.ucard-lockmark', { 'aria-hidden': 'true' }, [icon('lock')]), cost]),
    ]);
    elc.style.setProperty('--accent', cat.color);
    t = { el: elc, def, fill, bar, barRow, meta, cost };
    teasers.set(def.id, t);
    return t;
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

  function prestigeKnown(s) {
    const legacy = s.prestige && Number.isFinite(s.prestige.legacy) ? s.prestige.legacy : 0;
    return legacy > 0 || !!(s.unlocks && s.unlocks['panel:prestige']);
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
    const nextLocked = teaserRungs(rows, { count: TEASERS, prestigeKnown: prestigeKnown(s) });
    const rest = lockedCount - nextLocked.length;
    const sig = available.map((r) => r.id).join(',') + '|' + ownedRows.map((r) => r.id).join(',') + '|' + nextLocked.map((r) => r.id).join(',');
    setText(countEl, `${ownedRows.length} / ${rows.length}`);
    setText(locked, rest > 0 ? `${num(rest)} more ${rest === 1 ? 'idea waits' : 'ideas wait'} to be discovered.` : '');
    setHidden(empty, available.length > 0);
    if (sig === signature) return;
    signature = sig;
    const shown = expanded ? available : available.slice(0, VISIBLE_DEFAULT);
    reconcile(list, shown.map((r) => card(r).el));
    const hiddenCount = available.length - shown.length;
    setHidden(showMore, available.length <= VISIBLE_DEFAULT);
    setText(showMore, expanded ? 'Show fewer' : `Show ${num(hiddenCount)} more`);
    teased = nextLocked;
    reconcile(teaserList, nextLocked.map((r) => teaser(r).el));
    nextLocked.forEach((r, i) => setClass(teaser(r).el, 'is-far', i > 0));
    setHidden(teaserList, nextLocked.length === 0);
    // A teaser that opened (or was bought) is stale: drop its element so a later re-lock
    // (a founding re-locks the ladder) builds a fresh card instead of reviving an old one.
    for (const [id, t] of teasers) if (!nextLocked.some((r) => r.id === id)) {
      t.el.remove();
      teasers.delete(id);
    }
    reconcile(ownedList, ownedRows.map((r) => chip(r)));
    setHidden(owned, ownedRows.length === 0);
    setText(ownedSummary, `Owned (${ownedRows.length})`);
    update(rows);
  }

  function updateTeaser(t, s, d) {
    const r = t.def;
    if (t.costShown !== r.cost) {
      t.costShown = r.cost;
      setText(t.cost, money(r.cost));
    }
    const m = unlockMeasure(r.unlockAt, s, d, game.api);
    setHidden(t.barRow, !m);
    if (!m) {
      setClass(t.el, 'is-close', false);
      setClass(t.el, 'is-gated', false);
      return;
    }
    setProgress(t.fill, m.p);
    // The label costs two locale-formatted numbers; build it only when the printed figure
    // (floored money, whole citizens, ...) or the threshold moved.
    const key = m.kind + '|' + m.t + '|' + unlockDisplayKey(m);
    if (t.labelKey !== key) {
      t.labelKey = key;
      // A full bar on a card that is still locked means the mirrored clause is met and the
      // rung waits on the other one (funded rungs: "Build 3 factories, then hold $600" with
      // the treasury already holding it) — tick the clause so the bar never reads as a
      // broken gate.
      const label = unlockLabel(m);
      const met = m.p >= 1;
      setText(t.meta, met ? `${label} ✓` : label);
      setAttr(t.bar, 'title', met ? `${label} — met; the rest of the hint is what remains` : label);
      setClass(t.el, 'is-gated', met);
    }
    setClass(t.el, 'is-close', m.p >= CLOSE_AT);
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
    if (teased.length) {
      const s = game.state;
      const d = game.derived;
      for (const r of teased) {
        const t = teasers.get(r.id);
        if (!t || !t.el.isConnected) continue;
        // Rows are re-read every frame; keep the teaser on the live row (cost overrides, etc.).
        const live = rows.find((x) => x.id === r.id);
        if (live) t.def = live;
        updateTeaser(t, s, d);
      }
    }
  }

  function reconcile(parent, wanted) {
    for (let i = 0; i < wanted.length; i++) {
      const cur = parent.children[i];
      if (cur !== wanted[i]) parent.insertBefore(wanted[i], cur || null);
    }
    while (parent.children.length > wanted.length) parent.lastChild.remove();
  }

  return { el, update, rebuild, teased: () => teased.map((r) => r.id) };
}

// Build panel: category tabs + building cards with buy ×1 / ×10 / ×max / sell modes.
import { h, icon, setText, setHidden, setClass, setDisabled, setProgress, setAttr, money, num, short, fmtPct, reducedMotion } from './dom.js';
import { CATEGORY_GATES } from './content.js';

const MODES = [
  { id: 1, label: '×1', title: 'Buy one at a time' },
  { id: 10, label: '×10', title: 'Buy ten at a time' },
  { id: 'max', label: 'Max', title: 'Buy as many as you can afford' },
  { id: 'sell', label: 'Sell', title: 'Sell one at a time (half refund)' },
];

export function createBuildPanel(ui) {
  const { game, content } = ui;
  let mode = 1;
  let activeCat = null;
  let rows = [];
  const cards = new Map(); // building id -> card
  const lockedCards = new Map(); // category id -> { el, forId, name, hint }
  const tabs = new Map(); // category id -> { el, dot, count }
  const seenCats = new Set();
  let firstBuild = true;

  // ---- header + mode toggle ----
  const modeGroup = h('div.seg', { role: 'group', 'aria-label': 'Purchase amount' });
  const modeBtns = new Map();
  for (const m of MODES) {
    const b = h(`button.seg-btn${m.id === 'sell' ? '.seg-sell' : ''}`, { type: 'button', text: m.label, title: m.title, 'aria-pressed': m.id === mode ? 'true' : 'false' });
    b.addEventListener('click', () => setMode(m.id));
    modeBtns.set(m.id, b);
    modeGroup.append(b);
  }
  function setMode(m) {
    mode = m;
    for (const [id, b] of modeBtns) setAttr(b, 'aria-pressed', id === m ? 'true' : 'false');
    setClass(el, 'is-sell-mode', m === 'sell');
    updateCards(true);
  }

  const tabBar = h('div.tabs', { role: 'tablist', 'aria-label': 'Building categories' });
  const list = h('div.cards', { role: 'tabpanel' });
  const empty = h('div.empty-state', [
    h('div.empty-icon', { text: '🏗️', 'aria-hidden': 'true' }),
    h('div.empty-title', { text: 'No zoning permits on file' }),
    h('div.empty-text', { text: 'The planning office has not published any building plans yet. Check back once the city registry loads.' }),
  ]);
  // Onboarding: shown on a fresh plot until the first building goes up.
  const onboarding = h('div.onboard', { hidden: true, role: 'note' }, [
    h('span.onboard-icon', { text: '🗺️', 'aria-hidden': 'true' }),
    h('div.onboard-body', [
      h('div.onboard-title', { text: 'Welcome, Mayor.' }),
      h('div.onboard-text', { text: 'Build a cottage to attract your first citizens. Shops give them jobs, jobs pay taxes, and the skyline grows from there.' }),
    ]),
    h('span.onboard-arrow', { 'aria-hidden': 'true', text: '↓' }),
  ]);
  const el = h('section.col.col-build', [
    h('section.panel.panel-build', [
      h('div.panel-head', [h('h2.panel-title', { text: 'Build' }), modeGroup]),
      tabBar,
      onboarding,
      list,
      empty,
    ]),
  ]);
  let onboardingShown = false;

  function isFreshCity(s) {
    if ((s.stats && s.stats.buildingsBuilt) > 0) return false;
    for (const k in s.buildings) if (s.buildings[k] > 0) return false;
    return true;
  }

  // ---- tabs ----
  function tab(cat) {
    let t = tabs.get(cat.id);
    if (!t) {
      const dot = h('span.tab-dot', { 'aria-hidden': 'true' });
      const count = h('span.tab-count.mono', { text: '' });
      const btn = h('button.tab', { type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { cat: cat.id } }, [
        h('span.tab-icon', { text: cat.icon, 'aria-hidden': 'true' }),
        h('span.tab-label', { text: cat.name }),
        count,
        dot,
      ]);
      btn.style.setProperty('--accent', cat.color);
      btn.addEventListener('click', () => setActive(cat.id));
      t = { el: btn, dot, count };
      tabs.set(cat.id, t);
    }
    return t;
  }

  function setActive(catId) {
    activeCat = catId;
    for (const [id, t] of tabs) {
      const on = id === catId;
      setAttr(t.el, 'aria-selected', on ? 'true' : 'false');
      setClass(t.el, 'is-active', on);
      if (on) t.el.classList.remove('is-new');
    }
    for (const c of cards.values()) setHidden(c.el, c.def.category !== catId);
    for (const [cid, lc] of lockedCards) setHidden(lc.el, cid !== catId);
    updateCards(true);
  }

  // ---- cards ----
  const STAT_DEFS = [
    { key: 'housing', label: 'Housing', fmt: (v) => num(Math.round(v)) },
    { key: 'jobs', label: 'Jobs', fmt: (v) => num(Math.round(v)) },
    { key: 'income', label: 'Income', fmt: (v) => '+$' + short(v) + '/s' },
    { key: 'powerGen', label: 'Power', fmt: (v) => '+' + short(v) + ' MW' },
    { key: 'powerUse', label: 'Draw', fmt: (v) => short(v) + ' MW' },
    { key: 'happiness', label: 'Joy', fmt: (v) => (v > 0 ? '+' : '') + fmtPct(v) },
    { key: 'upkeep', label: 'Upkeep', fmt: (v) => '-$' + short(v) + '/s' },
  ];

  function effectiveStat(def, key, mods) {
    const base = def[key] || 0;
    if (!base || !mods) return base;
    const bb = mods.byBuilding?.[def.id];
    switch (key) {
      case 'housing':
        return base * (mods.housing ?? 1) * (bb?.housing ?? 1);
      case 'jobs':
        return base * (mods.jobs ?? 1) * (bb?.jobs ?? 1);
      case 'income':
        return base * (mods.income ?? 1) * (bb?.income ?? 1);
      case 'powerGen':
        return base * (mods.power ?? 1) * (bb?.power ?? 1);
      case 'powerUse':
        return base * (mods.demand ?? 1);
      case 'upkeep':
        return base * (mods.upkeep ?? 1);
      default:
        return base;
    }
  }

  function card(def) {
    let c = cards.get(def.id);
    if (c) return c;
    const cat = content.category(def.category);
    const count = h('span.bcard-count.mono', { text: '' });
    const stats = [];
    const statsEl = h('div.bcard-stats');
    for (const sd of STAT_DEFS) {
      if (!(def[sd.key] > 0 || (sd.key === 'happiness' && def.happiness < 0))) continue;
      const val = h('span.stat-val.mono', { text: '' });
      const pill = h(`span.pill.pill-${sd.key}`, [h('span.stat-key', { text: sd.label }), val]);
      stats.push({ ...sd, val, pill });
      statsEl.append(pill);
    }
    const total = h('span.bcard-total', { text: '' });
    const btnLabel = h('span.btn-label', { text: 'Buy' });
    const btnCost = h('span.btn-cost.mono', { text: '' });
    const btn = h('button.btn.btn-buy', { type: 'button' }, [btnLabel, btnCost]);
    const fill = h('div.progress-fill');
    const bar = h('div.progress.progress-xs.cost-bar', { 'aria-hidden': 'true' }, [fill]);
    const elc = h(`article.bcard.cat-${def.category}`, { dataset: { id: def.id } }, [
      h('div.bcard-icon', { text: def.icon || '🏢', 'aria-hidden': 'true' }),
      h('div.bcard-main', [
        h('div.bcard-row', [h('span.bcard-name', { text: def.name }), count]),
        h('div.bcard-desc', { text: def.desc || '' }),
        statsEl,
        total,
      ]),
      h('div.bcard-buy', [btn, bar]),
    ]);
    elc.style.setProperty('--accent', cat.color);
    btn.addEventListener('click', () => {
      let ok = false;
      if (mode === 'sell') ok = game.api.sell(def.id, 1);
      else ok = game.api.buy(def.id, mode === 'max' ? 'max' : mode);
      if (ok && !reducedMotion) {
        count.classList.remove('bump');
        void count.offsetWidth;
        count.classList.add('bump');
      }
    });
    if (ui.newlyUnlocked.has(def.id)) {
      ui.newlyUnlocked.delete(def.id);
      elc.classList.add('is-new');
      setTimeout(() => elc.classList.remove('is-new'), 6000);
    }
    c = { el: elc, def, count, stats, total, btn, btnLabel, btnCost, fill, lastMode: null };
    cards.set(def.id, c);
    return c;
  }

  function lockedCard(catId, def) {
    let lc = lockedCards.get(catId);
    if (!lc) {
      const name = h('span.bcard-name', { text: '' });
      const hint = h('div.bcard-desc', { text: '' });
      const fill = h('div.progress-fill');
      const bar = h('div.progress.progress-xs.unlock-bar', { 'aria-hidden': 'true' }, [fill]);
      const meta = h('span.unlock-meta.mono', { text: '' });
      const elc = h('article.bcard.is-locked', { 'aria-label': 'Locked building' }, [
        h('div.bcard-icon', { text: '?', 'aria-hidden': 'true' }),
        h('div.bcard-main', [h('div.bcard-row', [name, h('span.bcard-lock', [icon('lock')]), meta]), hint, bar]),
      ]);
      lc = { el: elc, name, hint, fill, bar, meta, forId: null, def: null };
      lockedCards.set(catId, lc);
    }
    if (lc.forId !== def.id) {
      lc.forId = def.id;
      lc.def = def;
      setText(lc.name, 'Undiscovered ' + content.category(catId).name.toLowerCase() + ' building');
      setText(lc.hint, unlockHint(def));
    }
    return lc;
  }

  function unlockHint(def) {
    const t = def.unlockHint || def.unlockText || def.hint;
    if (typeof t === 'string' && t.trim()) return t;
    return 'Grow your city to reveal what the planners are sketching.';
  }

  // Progress toward a locked building's unlock rule, from the data mirror `unlockAt`
  // ({pop} | {powerDemand} | {pop, legacy}). Returns { p, label } or null when unmeasurable.
  function unlockProgress(def, s, d) {
    const at = def.unlockAt;
    if (!at || typeof at !== 'object') return null;
    if (Number.isFinite(at.pop) && at.pop > 0) {
      const v = Math.floor(s.res.pop || 0);
      return { p: Math.min(1, v / at.pop), label: `${num(v)} / ${num(at.pop)}` };
    }
    if (Number.isFinite(at.powerDemand) && at.powerDemand > 0) {
      const v = d.powerDemand || 0;
      if (at.powerDemand < 1) return { p: v > 0 ? 1 : 0, label: v > 0 ? 'ready' : '0 MW drawn' };
      return { p: Math.min(1, v / at.powerDemand), label: `${short(v)} / ${short(at.powerDemand)} MW` };
    }
    return null;
  }

  function updateLocked(lc, s, d) {
    if (!lc.def) return;
    const pr = unlockProgress(lc.def, s, d);
    setHidden(lc.bar, !pr);
    if (!pr) {
      setText(lc.meta, '');
      return;
    }
    setProgress(lc.fill, pr.p);
    setText(lc.meta, pr.label);
    setClass(lc.el, 'is-close', pr.p >= 0.75);
  }

  function updateCard(c, s, d, force) {
    const def = c.def;
    const row = c.row;
    if (!row) return;
    setText(c.count, row.count > 0 ? '×' + num(row.count) : '');
    const mods = d.mods;
    for (const st of c.stats) setText(st.val, st.fmt(effectiveStat(def, st.key, mods)));

    let n = 1;
    let cost = row.cost;
    let label = 'Buy';
    let enabled;
    if (mode === 'sell') {
      n = 1;
      enabled = row.count > 0;
      cost = enabled ? game.api.buildingCost(def, row.count - 1, 1) * (def.sellRefund ?? 0.5) : 0;
      label = 'Sell';
    } else if (mode === 'max') {
      n = game.api.maxAffordable(def);
      if (n <= 0) {
        n = 1;
        cost = row.cost;
        enabled = false;
      } else {
        cost = game.api.buildingCost(def, row.count, n);
        enabled = true;
      }
      label = 'Buy ×' + num(n);
    } else {
      n = mode;
      cost = n === 1 ? row.cost : game.api.buildingCost(def, row.count, n);
      enabled = s.res.money >= cost;
      label = n === 1 ? 'Buy' : 'Buy ×' + n;
    }
    setText(c.btnLabel, label);
    setText(c.btnCost, mode === 'sell' ? (enabled ? '+' + money(cost) : 'none owned') : money(cost));
    setDisabled(c.btn, !enabled);
    setClass(c.el, 'is-affordable', enabled && mode !== 'sell');
    setProgress(c.fill, mode === 'sell' ? (enabled ? 1 : 0) : cost > 0 ? Math.min(1, s.res.money / cost) : 1);

    // Totals line: what this stack contributes right now.
    if (row.count > 0) {
      const parts = [];
      const hs = effectiveStat(def, 'housing', mods) * row.count;
      const jb = effectiveStat(def, 'jobs', mods) * row.count;
      const inc = effectiveStat(def, 'income', mods) * row.count;
      const pg = effectiveStat(def, 'powerGen', mods) * row.count;
      if (hs) parts.push(`${num(Math.round(hs))} housing`);
      if (jb) parts.push(`${num(Math.round(jb))} jobs`);
      if (inc) parts.push(`+$${short(inc)}/s`);
      if (pg) parts.push(`${short(pg)} MW`);
      setText(c.total, parts.length ? 'Total: ' + parts.join(' · ') : '');
    } else setText(c.total, '');
  }

  function updateCards(force) {
    const s = game.state;
    const d = game.derived;
    for (const c of cards.values()) {
      if (c.el.hidden) continue;
      updateCard(c, s, d, force);
    }
    for (const lc of lockedCards.values()) {
      if (lc.el.hidden || !lc.el.isConnected) continue;
      updateLocked(lc, s, d);
    }
    // Onboarding callout + a hint glow on the cottage until the first building is placed.
    const fresh = rows.length > 0 && isFreshCity(s);
    if (fresh !== onboardingShown) {
      onboardingShown = fresh;
      setHidden(onboarding, !fresh);
      for (const c of cards.values()) setClass(c.el, 'is-hinted', fresh && c.def.housing > 0 && c.def.tier === 1);
    }
    // Tab dots: something affordable in that category.
    const affordable = new Set();
    const counts = new Map();
    for (const r of rows) {
      if (!r.unlocked) continue;
      if (r.affordable) affordable.add(r.category);
      counts.set(r.category, (counts.get(r.category) || 0) + r.count);
    }
    for (const [id, t] of tabs) {
      setClass(t.el, 'has-affordable', affordable.has(id) && id !== activeCat);
      const n = counts.get(id) || 0;
      setText(t.count, n > 0 ? num(n) : '');
    }
  }

  function rebuild(newRows) {
    rows = newRows || [];
    for (const r of rows) {
      const c = cards.get(r.id);
      if (c) c.row = r;
    }
    const hasAny = rows.length > 0;
    setHidden(empty, hasAny);
    setHidden(tabBar, !hasAny);
    if (!hasAny) return;

    const s = game.state;
    const visibleCats = [];
    const byCat = new Map();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category).push(r);
    }
    const catOrder = content.categories.map((c) => c.id);
    for (const id of byCat.keys()) if (!catOrder.includes(id)) catOrder.push(id);
    for (const catId of catOrder) {
      const items = byCat.get(catId) || [];
      const gate = CATEGORY_GATES[catId];
      const anyUnlocked = items.some((r) => r.unlocked);
      const visible = anyUnlocked || (gate && !!s.unlocks[gate]);
      if (visible) visibleCats.push(catId);
    }
    if (!visibleCats.length && catOrder.length) visibleCats.push(catOrder[0]);

    // Tabs
    const wantedTabs = [];
    for (const catId of visibleCats) {
      const t = tab(content.category(catId));
      if (!seenCats.has(catId)) {
        seenCats.add(catId);
        if (!firstBuild) t.el.classList.add('is-new');
      }
      wantedTabs.push(t.el);
    }
    reconcile(tabBar, wantedTabs);
    if (!activeCat || !visibleCats.includes(activeCat)) activeCat = visibleCats[0];

    // Cards: unlocked ones per category in registry order, then one locked teaser.
    const wantedCards = [];
    for (const catId of visibleCats) {
      const items = byCat.get(catId) || [];
      for (const r of items) {
        if (!r.unlocked) continue;
        const c = card(r);
        c.row = r;
        wantedCards.push(c.el);
      }
      const nextLocked = items.find((r) => !r.unlocked);
      if (nextLocked) wantedCards.push(lockedCard(catId, nextLocked).el);
      else if (lockedCards.has(catId)) lockedCards.get(catId).el.remove();
    }
    reconcile(list, wantedCards);
    firstBuild = false;
    setActive(activeCat);
  }

  function reconcile(parent, wanted) {
    for (let i = 0; i < wanted.length; i++) {
      const cur = parent.children[i];
      if (cur !== wanted[i]) parent.insertBefore(wanted[i], cur || null);
    }
    while (parent.children.length > wanted.length) parent.lastChild.remove();
  }

  function update(newRows) {
    rows = newRows || rows;
    for (const r of rows) {
      const c = cards.get(r.id);
      if (c) c.row = r;
    }
    updateCards(false);
  }

  setMode(1);
  return { el, update, rebuild, setMode, getMode: () => mode };
}

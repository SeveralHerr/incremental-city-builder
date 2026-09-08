// Build panel: category tabs + building cards with buy ×1 / ×10 / ×max / sell modes.
import { h, icon, setText, setHidden, setClass, setDisabled, setProgress, setAttr, money, num, short, fmtPct, prefersReducedMotion } from './dom.js';
import { CATEGORY_GATES } from './content.js';
import { unlockMeasure, unlockLabel, unlockDisplayKey, buildingLines, strainNow } from './text.js';

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
  const lockedCards = new Map(); // `${category}:${slot}` -> { el, cat, forId, name, hint } (two teasers per category)
  const LOCKED_TEASERS = 2; // locked teasers per category: the next two buildings the planners are sketching
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
  const list = h('div#build-cards.cards', { role: 'tabpanel' });
  // ARIA tabs pattern: a roving tabindex (only the active tab is in the tab order) and
  // Left/Right/Home/End move the focus and the selection together.
  tabBar.addEventListener('keydown', (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const order = [...tabBar.children].filter((el) => el.getAttribute('role') === 'tab');
    if (!order.length) return;
    let i = order.indexOf(document.activeElement);
    if (i < 0) i = order.findIndex((el) => el.classList.contains('is-active'));
    if (e.key === 'ArrowLeft') i = (i - 1 + order.length) % order.length;
    else if (e.key === 'ArrowRight') i = (i + 1) % order.length;
    else if (e.key === 'Home') i = 0;
    else i = order.length - 1;
    e.preventDefault();
    const next = order[i];
    setActive(next.dataset.cat);
    next.focus();
  });
  const empty = h('div.empty-state', [
    h('div.empty-icon', { text: '🏗️', 'aria-hidden': 'true' }),
    h('div.empty-title', { text: 'No zoning permits on file' }),
    h('div.empty-text', { text: 'The planning office has not published any building plans yet. Check back once the city registry loads.' }),
  ]);
  // Tutorial: a six-step callout driven purely by game state (see tutorialStep). Each step
  // clears itself when the player does the thing; the × dismisses tips for good (a setting).
  const onboardIcon = h('span.onboard-icon', { text: '🗺️', 'aria-hidden': 'true' });
  const onboardTitle = h('div.onboard-title', { text: 'Welcome, Mayor.' });
  const onboardText = h('div.onboard-text', { text: '' });
  const onboardStep = h('span.onboard-step', { text: '' });
  const onboardClose = h('button.onboard-close', { type: 'button', 'aria-label': 'Dismiss tutorial tips', title: 'Dismiss tips', text: '×' });
  onboardClose.addEventListener('click', () => ui.setSetting('tutorial', false));
  const onboarding = h('div.onboard', { hidden: true, role: 'note' }, [
    onboardIcon,
    h('div.onboard-body', [h('div.onboard-head', [onboardTitle, onboardStep]), onboardText]),
    h('span.onboard-arrow', { 'aria-hidden': 'true', text: '↓' }),
    onboardClose,
  ]);
  const TUTORIAL_STEPS = 6;
  function tutorialStep(s, d, rows) {
    if (s.settings && s.settings.tutorial === false) return null;
    if (((s.stats && s.stats.prestiges) || 0) > 0) return null;
    const row = (id) => rows.find((r) => r.id === id);
    const built = (s.stats && s.stats.buildingsBuilt) || 0;
    if (built === 0) {
      return { n: 1, icon: '🏠', cat: 'residential', title: 'Welcome, Mayor.', text: 'Build a cottage to attract your first citizens. Shops give them jobs, jobs pay taxes, and the skyline grows from there.', hint: (def) => def.housing > 0 && def.tier === 1 };
    }
    const shop = row('shop');
    if (shop && shop.unlocked && shop.count === 0) {
      return { n: 2, icon: '🏪', cat: 'commercial', title: 'Citizens need work.', text: 'Unemployed citizens are unhappy and pay little tax. Open a corner shop in the Commercial tab to give them jobs.', hint: (def) => def.id === 'shop' };
    }
    const wind = row('windmill');
    if (d.powerDemand > 0 && d.powerCap <= 0 && wind && wind.unlocked) {
      return { n: 3, icon: '⚡', cat: 'power', title: 'The lights are out.', text: 'Every building draws power, and a brownout cuts income and growth. Build a windmill in the Power tab.', hint: (def) => def.powerGen > 0 && def.tier === 1 };
    }
    // The panel gate survives a founding, so check for a rung that is actually open.
    if (s.unlocks && s.unlocks['panel:upgrades'] && Object.keys(s.upgrades || {}).length === 0
      && game.api.upgrades().some((u) => u.unlocked && !u.owned)) {
      return { n: 4, icon: '🔧', title: 'Your first upgrade is ready.', text: 'Upgrades multiply what you already own. Open the Upgrades panel and buy the first one you can afford.' };
    }
    const park = row('park');
    if (park && park.unlocked && park.count === 0 && d.happiness < 1) {
      return { n: 5, icon: '🌳', cat: 'civic', title: 'Keep them happy.', text: 'Happiness multiplies growth and income. A park in the Civic tab lifts the mood; watch the smiley in the top bar.', hint: (def) => def.id === 'park' };
    }
    if (s.unlocks && s.unlocks['panel:prestige']) {
      return { n: 6, icon: '🏳️', title: 'Think about founding a new city.', text: 'The Legacy panel lets you start over with permanent bonuses and Charter perks once you have earned enough. Each city after the first is faster.' };
    }
    return null;
  }
  const el = h('section.col.col-build', [
    h('section.panel.panel-build', [
      h('div.panel-head', [h('h2.panel-title', { text: 'Build' }), modeGroup]),
      tabBar,
      onboarding,
      list,
      empty,
    ]),
  ]);
  let onboardingShown = 0;

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
      // Name as title + aria-label too: in a narrow column inactive tabs collapse to icon + count.
      const btn = h('button.tab', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'build-cards', tabindex: '-1', 'aria-label': cat.name, title: cat.name, dataset: { cat: cat.id } }, [
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
      setAttr(t.el, 'tabindex', on ? '0' : '-1');
      setClass(t.el, 'is-active', on);
      if (on) t.el.classList.remove('is-new');
    }
    for (const c of cards.values()) setHidden(c.el, c.def.category !== catId);
    for (const lc of lockedCards.values()) setHidden(lc.el, lc.cat !== catId);
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
    // Three quiet lines under the stats (text.js buildingLines): the signature mechanic
    // (tier-3/4 buildings, `synergy.text`), the grid strain (tier-4 consumers,
    // `demandGrowth.text`: "draw +12.5% per District owned (up to ×40)" — a second, dimmer
    // synergy line in the power colour, so the card says its draw climbs before the grid
    // browns out) and the power hint the buildings module stamps on every consumer that
    // draws at least a windmill's worth ("Draws 10,500 MW ≈ 0.9 × Nuclear Plant"). The
    // strain line also carries the live factor ("×3.1 now", updateCard) so a fleet that
    // draws 33× its sticker says so on the card, not only in the power chip.
    const lines = buildingLines(def);
    const synergy = lines.synergy ? h('div.bcard-synergy', { title: lines.synergy }, [h('span.bcard-synergy-mark', { text: '✦', 'aria-hidden': 'true' }), h('span.bcard-line-text', { text: lines.synergy })]) : null;
    const strainNowEl = lines.strain ? h('span.bcard-strain-now.mono', { text: '' }) : null;
    const strain = lines.strain ? h('div.bcard-synergy.bcard-strain', { title: lines.strain }, [h('span.bcard-synergy-mark', { text: '↯', 'aria-hidden': 'true' }), h('span.bcard-line-text', { text: lines.strain }), strainNowEl]) : null;
    const powerLine = lines.power ? h('div.bcard-power', { title: lines.power }, [h('span.bcard-power-mark', { text: '⚡', 'aria-hidden': 'true' }), h('span.bcard-line-text', { text: lines.power })]) : null;
    const elc = h(`article.bcard.cat-${def.category}`, { dataset: { id: def.id } }, [
      h('div.bcard-icon', { text: def.icon || '🏢', 'aria-hidden': 'true' }),
      h('div.bcard-main', [
        h('div.bcard-row', [h('span.bcard-name', { text: def.name }), count]),
        h('div.bcard-desc', { text: def.desc || '', title: def.desc || null }),
        statsEl,
        synergy,
        strain,
        powerLine,
        total,
      ]),
      h('div.bcard-buy', [btn, bar]),
    ]);
    elc.style.setProperty('--accent', cat.color);
    btn.addEventListener('click', () => {
      let ok = false;
      if (mode === 'sell') ok = game.api.sell(def.id, 1);
      else ok = game.api.buy(def.id, mode === 'max' ? 'max' : mode);
      if (ok && !prefersReducedMotion()) {
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
    c = { el: elc, def, count, stats, total, btn, btnLabel, btnCost, fill, strainNow: strainNowEl, lastMode: null };
    cards.set(def.id, c);
    return c;
  }

  function lockedCard(catId, def, slot = 0) {
    const key = catId + ':' + slot;
    let lc = lockedCards.get(key);
    if (!lc) {
      const name = h('span.bcard-name', { text: '' });
      const hint = h('div.bcard-desc', { text: '' });
      const fill = h('div.progress-fill');
      const bar = h('div.progress.progress-xs.unlock-bar', { 'aria-hidden': 'true' }, [fill]);
      const meta = h('span.unlock-meta.mono', { text: '' });
      // The second teaser sits further off and reads dimmer (.is-far).
      const elc = h(`article.bcard.is-locked${slot > 0 ? '.is-far' : ''}`, { 'aria-label': 'Locked building' }, [
        h('div.bcard-icon', { text: '?', 'aria-hidden': 'true' }),
        h('div.bcard-main', [h('div.bcard-row', [name, h('span.bcard-lock', [icon('lock')]), meta]), hint, bar]),
      ]);
      lc = { el: elc, cat: catId, slot, name, hint, fill, bar, meta, forId: null, def: null };
      lockedCards.set(key, lc);
    }
    if (lc.forId !== def.id) {
      lc.forId = def.id;
      lc.def = def;
      lc.labelKey = '';
      setText(lc.name, (lc.slot > 0 ? 'Another undiscovered ' : 'Undiscovered ') + content.category(catId).name.toLowerCase() + ' building');
      setText(lc.hint, unlockHint(def));
    }
    return lc;
  }

  function unlockHint(def) {
    const t = def.unlockHint || def.unlockText || def.hint;
    if (typeof t === 'string' && t.trim()) return t;
    return 'Grow your city to reveal what the planners are sketching.';
  }

  // Progress toward a locked building's unlock rule comes from the data mirror `unlockAt`
  // ({pop} | {powerDemand} | {legacy} | {pop, legacy} ...); text.js reads every shape the
  // buildings and upgrades modules ship and returns null when unmeasurable (hint alone).
  function updateLocked(lc, s, d) {
    if (!lc.def) return;
    const m = unlockMeasure(lc.def.unlockAt, s, d, game.api);
    setHidden(lc.bar, !m);
    if (!m) {
      lc.labelKey = '';
      setText(lc.meta, '');
      return;
    }
    setProgress(lc.fill, m.p);
    // Two locale-formatted numbers per label: only rebuild it when the printed figure moved.
    const key = m.kind + '|' + m.t + '|' + unlockDisplayKey(m);
    if (lc.labelKey !== key) {
      lc.labelKey = key;
      setText(lc.meta, unlockLabel(m));
    }
    setClass(lc.el, 'is-close', m.p >= 0.75);
  }

  function updateCard(c, s, d, force) {
    const def = c.def;
    const row = c.row;
    if (!row) return;
    setText(c.count, row.count > 0 ? '×' + num(row.count) : '');
    const mods = d.mods;
    for (const st of c.stats) setText(st.val, st.fmt(effectiveStat(def, st.key, mods)));
    if (c.strainNow) {
      // Live per-unit draw over the pinned sticker, as the buildings module reports them.
      const b = game.buildings;
      const live = typeof b?.liveStat === 'function' ? b.liveStat(def.id, 'powerUse') : undefined;
      const base = typeof b?.baseStat === 'function' ? b.baseStat(def.id, 'powerUse') : undefined;
      setText(c.strainNow, strainNow(live, base, def.demandGrowth?.cap));
    }

    let n = 1;
    let cost = row.cost;
    let label = 'Buy';
    let enabled;
    // A capped-out building (core: row.maxed, def.maxCount — the windmill retires at 12) is
    // not for sale: the button reads "Retired 12/12 built" instead of a greyed price.
    const maxed = mode !== 'sell' && row.maxed === true;
    setClass(c.el, 'is-maxed', maxed);
    if (maxed) {
      const cap = Number.isInteger(row.maxCount) ? row.maxCount : row.count;
      setText(c.btnLabel, 'Retired');
      setText(c.btnCost, `${num(row.count)}/${num(cap)} built`);
      setAttr(c.btn, 'aria-label', `${def.name} retired: ${num(row.count)} of ${num(cap)} built`);
      setDisabled(c.btn, true);
      setClass(c.el, 'is-affordable', false);
      setProgress(c.fill, 1);
      updateTotals(c, row, mods);
      return;
    }
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
    // Screen readers hear the building, not just 'Buy $218': "Buy ×10 Cottage for $2,180".
    setAttr(c.btn, 'aria-label', mode === 'sell' ? (enabled ? `Sell ${def.name} for ${money(cost)}` : `Sell ${def.name}: none owned`) : `${label} ${def.name} for ${money(cost)}`);
    setDisabled(c.btn, !enabled);
    setClass(c.el, 'is-affordable', enabled && mode !== 'sell');
    setProgress(c.fill, mode === 'sell' ? (enabled ? 1 : 0) : cost > 0 ? Math.min(1, s.res.money / cost) : 1);
    updateTotals(c, row, mods);
  }

  // Totals line: what this stack contributes right now.
  function updateTotals(c, row, mods) {
    const def = c.def;
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
    // Tutorial callout + a hint glow on the card (and tab) the current step points at.
    const step = rows.length > 0 ? tutorialStep(s, d, rows) : null;
    const stepKey = step ? step.n : 0;
    if (stepKey !== onboardingShown) {
      onboardingShown = stepKey;
      setHidden(onboarding, !step);
      if (step) {
        setText(onboardIcon, step.icon);
        setText(onboardTitle, step.title);
        setText(onboardText, step.text);
        setText(onboardStep, `${step.n} / ${TUTORIAL_STEPS}`);
      }
      for (const c of cards.values()) setClass(c.el, 'is-hinted', !!(step && step.hint && step.hint(c.def)));
      for (const [id, t] of tabs) setClass(t.el, 'is-guided', !!(step && step.cat === id && id !== activeCat));
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

    // Cards: unlocked ones per category in registry order, then up to two locked teasers so
    // the early-game column does not sit half empty while the sidebar overflows.
    const wantedCards = [];
    for (const catId of visibleCats) {
      const items = byCat.get(catId) || [];
      for (const r of items) {
        if (!r.unlocked) continue;
        const c = card(r);
        c.row = r;
        wantedCards.push(c.el);
      }
      const nextLocked = items.filter((r) => !r.unlocked).slice(0, LOCKED_TEASERS);
      nextLocked.forEach((r, i) => wantedCards.push(lockedCard(catId, r, i).el));
      for (let i = nextLocked.length; i < LOCKED_TEASERS; i++) {
        const stale = lockedCards.get(catId + ':' + i);
        if (stale) stale.el.remove();
      }
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

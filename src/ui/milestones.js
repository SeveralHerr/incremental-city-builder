// Milestones list (reached + next 3) and shared milestone progress helper (used by the hero card).
import { h, icon, setText, setHidden, setProgress, fmtPct } from './dom.js';

const RECENT = 3;
const UPCOMING = 3;

export function isReached(ms, state) {
  return !!state.unlocks['m:' + ms.id];
}

// 0..1 progress toward a milestone, or null when it cannot be measured. Honors an optional
// `progress(state, derived)` on the definition, then `metric` + `target` (metric names below),
// then a conventional id such as `pop-1k`, `money-100k`, `buildings-100`, `first-upgrade`.
export function milestoneProgress(ms, state, derived) {
  try {
    if (typeof ms.progress === 'function') {
      const p = ms.progress(state, derived);
      return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
    }
    let metric = ms.metric;
    let target = ms.target;
    if (!(Number.isFinite(target) && target > 0 && metric)) {
      const parsed = parseMilestoneId(ms.id);
      if (!parsed) return null;
      metric = parsed.metric;
      target = parsed.target;
    }
    const v = metricValue(metric, state, derived);
    return v === null ? null : Math.max(0, Math.min(1, v / target));
  } catch {
    /* progress is cosmetic; never break rendering */
  }
  return null;
}

const ID_METRICS = { pop: 'pop', money: 'totalEarned', earned: 'totalEarned', buildings: 'buildings', upgrades: 'upgrades', prestige: 'prestiges' };
const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

function parseMilestoneId(id) {
  if (typeof id !== 'string') return null;
  const m = /^([a-z]+)-(\d+(?:\.\d+)?)([kmbt])?$/i.exec(id);
  if (m) {
    const metric = ID_METRICS[m[1].toLowerCase()];
    const target = parseFloat(m[2]) * (SUFFIX[(m[3] || '').toLowerCase()] || 1);
    return metric && target > 0 ? { metric, target } : null;
  }
  if (/^first-upgrade$/i.test(id)) return { metric: 'upgrades', target: 1 };
  if (/^(first-)?prestige(-1)?$/i.test(id)) return { metric: 'prestiges', target: 1 };
  if (/^(first-)?brownout$/i.test(id)) return { metric: 'brownout', target: 1 };
  return null;
}

function metricValue(metric, state, derived) {
  switch (metric) {
    case 'pop':
      return state.res.pop;
    case 'money':
      return state.res.money;
    case 'totalEarned':
      return state.stats.totalEarned;
    case 'buildings':
      return Object.values(state.buildings).reduce((a, b) => a + b, 0);
    case 'upgrades':
      return Object.keys(state.upgrades).length;
    case 'prestiges':
      return state.stats.prestiges;
    case 'brownout':
      return derived.powerRatio < 1 ? 1 : 0;
    default:
      return null;
  }
}

export function nextMilestones(list, state, n = UPCOMING) {
  const out = [];
  for (const ms of list) {
    if (!isReached(ms, state)) {
      out.push(ms);
      if (out.length >= n) break;
    }
  }
  return out;
}

export function createMilestonesPanel(ui) {
  const { game, content } = ui;
  const countEl = h('span.panel-meta.mono', { text: '' });
  const list = h('ul.ms-list');
  const empty = h('p.empty-note', { text: 'No goals posted yet. The council is still drafting its plans.' });
  const el = h('section.panel.panel-milestones', [h('div.panel-head', [h('h2.panel-title', { text: 'Milestones' }), countEl]), list, empty]);

  const rows = new Map(); // id -> { el, fill, pct }
  let signature = '';

  function row(ms, reached) {
    let r = rows.get(ms.id);
    if (!r) {
      const fill = h('div.progress-fill');
      const pct = h('span.ms-pct.mono', { text: '' });
      const li = h('li.ms-item', [
        h('span.ms-icon', { text: ms.icon || '🏁', 'aria-hidden': 'true' }),
        h('div.ms-body', [
          h('div.ms-row', [h('span.ms-name', { text: ms.name || ms.id }), pct]),
          h('div.ms-desc', { text: ms.desc || '' }),
          ms.rewardText ? h('div.ms-reward', { text: ms.rewardText }) : null,
          h('div.progress.progress-xs', { 'aria-hidden': 'true' }, [fill]),
        ]),
        h('span.ms-check', [icon('check')]),
      ]);
      r = { el: li, fill, pct };
      rows.set(ms.id, r);
    }
    r.el.classList.toggle('is-reached', reached);
    return r;
  }

  function rebuild() {
    const ms = content.milestones || [];
    const s = game.state;
    const reached = ms.filter((m) => isReached(m, s));
    const next = nextMilestones(ms, s);
    const sig = reached.map((m) => m.id).join(',') + '|' + next.map((m) => m.id).join(',');
    setText(countEl, ms.length ? `${reached.length} / ${ms.length}` : '');
    setHidden(empty, ms.length > 0);
    if (sig === signature) return;
    signature = sig;
    const wanted = [];
    for (const m of reached.slice(-RECENT).reverse()) wanted.push(row(m, true).el);
    for (const m of next) wanted.push(row(m, false).el);
    for (let i = 0; i < wanted.length; i++) {
      const cur = list.children[i];
      if (cur !== wanted[i]) list.insertBefore(wanted[i], cur || null);
    }
    while (list.children.length > wanted.length) list.lastChild.remove();
    update();
  }

  function update() {
    const s = game.state;
    const d = game.derived;
    for (const ms of nextMilestones(content.milestones || [], s)) {
      const r = rows.get(ms.id);
      if (!r) continue;
      const p = milestoneProgress(ms, s, d);
      setHidden(r.fill.parentElement, p === null);
      setProgress(r.fill, p ?? 0);
      setText(r.pct, p === null ? '' : fmtPct(p));
    }
  }

  return { el, update, rebuild };
}

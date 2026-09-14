// Pure text/number helpers shared by the panels. DOM-free so ui.test.mjs can cover them.
import { short, num, money, fmtPct } from './dom.js';

export const LEGACY_GLYPH = '◆';

// Power chip: capacity / demand and the spare line, all rounded the same way so the three
// figures always agree ("84 / 80 MW" never sits next to "3.25 MW spare"). Below 10,000 MW
// every figure is a whole megawatt; above, all three use the same short() notation.
export function powerChipText(cap, dem, ratio) {
  cap = Number.isFinite(cap) && cap > 0 ? cap : 0;
  dem = Number.isFinite(dem) && dem > 0 ? dem : 0;
  ratio = Number.isFinite(ratio) ? ratio : 1;
  const whole = Math.max(cap, dem) < 1e4;
  const f = whole ? (v) => num(Math.round(v)) : (v) => short(v);
  const capR = whole ? Math.round(cap) : cap;
  const demR = whole ? Math.round(dem) : dem;
  const value = `${f(cap)} / ${f(dem)} MW`;
  let sub;
  if (demR > capR) sub = `brownout · ${fmtPct(ratio)} supplied`;
  else if (cap > 0) sub = `${f(capR - demR)} MW spare`;
  else sub = 'no generation';
  return { value, sub, short: demR > capR ? fmtPct(ratio) : cap > 0 ? '+' + f(capR - demR) : '—' };
}

// Unemployment tile state: '' | 'warn' | 'bad'.
export function unemploymentLevel(u) {
  if (!Number.isFinite(u)) return '';
  if (u > 0.5) return 'bad';
  if (u > 0.25) return 'warn';
  return '';
}

// Legacy bank as the Charter header shows it. Prefers api.legacyAvailable() (core owns the
// spend rule), then derived.extra.prestige.available, then legacy − spent.
export function legacyBank(state, api, extra) {
  const p = (state && state.prestige) || {};
  const legacy = Number.isFinite(p.legacy) && p.legacy > 0 ? Math.floor(p.legacy) : 0;
  const spent = Number.isFinite(p.spent) && p.spent > 0 ? Math.floor(p.spent) : 0;
  let available = null;
  if (api && typeof api.legacyAvailable === 'function') {
    const v = api.legacyAvailable();
    if (Number.isFinite(v)) available = v;
  }
  if (available === null && extra && Number.isFinite(extra.available)) available = extra.available;
  if (available === null) available = legacy - spent;
  available = Math.max(0, Math.floor(available));
  return { legacy, spent, available };
}

export function legacyCost(n) {
  return `${LEGACY_GLYPH} ${num(Number.isFinite(n) ? n : 0)}`;
}

// The "next legacy point" bar (F12). Points come at ever-wider earnings intervals, so a bar
// measured 0 → nextAt reads permanently full late in a run (one point is a fraction of a
// percent of the run's total). This measures the current segment instead: from prevAt (this
// run's earnings at which the latest point was granted — derived.extra.prestige.prevAt, the
// same units as nextAt) to nextAt, clamped 0..1. Without prevAt the bar keeps its old
// 0 → nextAt reading (`segment: false`) so an older simulation snapshot still draws
// something sensible. `point` / `nextPoint` are the absolute point numbers (bank + points
// this run) for a "◆ 415 → 416" label; a bar with no valid target returns p = 0.
export function legacyPointBar({ earned, nextAt, prevAt, legacy = 0, gain = 0 } = {}) {
  const fin = (v) => Number.isFinite(v) && v >= 0;
  earned = fin(earned) ? earned : 0;
  const to = fin(nextAt) ? nextAt : 0;
  const point = Math.max(0, Math.floor((fin(legacy) ? legacy : 0) + (fin(gain) ? gain : 0)));
  const out = { p: 0, from: 0, to, earned, point, nextPoint: point + 1, segment: false };
  if (!(to > 0)) return out;
  if (fin(prevAt) && prevAt < to) {
    out.segment = true;
    out.from = prevAt;
    out.p = earned <= prevAt ? 0 : earned >= to ? 1 : (earned - prevAt) / (to - prevAt);
  } else {
    out.p = Math.min(1, earned / to);
  }
  if (!Number.isFinite(out.p)) out.p = 0;
  return out;
}

// 'Windmill, Corner Shop and 7 more' — a burst of unlocks folds into one line.
export function nameList(defs, shown = 2) {
  const names = defs.map((d) => d.name);
  if (names.length <= shown + 1) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

// ---- Unlock progress from a data mirror ----
//
// Buildings (`src/buildings/data.js`) and upgrades (`src/upgrades/data.js`) both ship an
// `unlockAt` object beside their unlock rule: the one measurable threshold the rule reads, in
// one of these shapes — {pop} | {powerDemand} | {money} | {earned} | {building, count} |
// {legacy} | {legacyAvailable} | {built} | {upgrades}. `unlockMeasure` turns it into
// { v (live value), t (threshold), p (0..1), kind } without formatting anything, so a panel
// can compare `v` frame to frame and only build the label (`unlockLabel`, two locale-formatted
// numbers) when the displayed figure actually moves; `unlockProgress` does both at once for
// callers that do not care. Null when the mirror is missing or unmeasurable (the card then
// shows its hint alone). `api.legacyAvailable()` is preferred for spendable legacy since core
// owns the spend rule; everything else reads state/derived directly.
const KEY_ORDER = ['pop', 'powerDemand', 'money', 'earned', 'building', 'legacy', 'legacyAvailable', 'built', 'upgrades'];

function ownedUpgrades(state) {
  const u = state && state.upgrades;
  if (!u || typeof u !== 'object') return 0;
  let n = 0;
  for (const k in u) if (u[k]) n++;
  return n;
}

function finitePositive(v) {
  return Number.isFinite(v) && v > 0;
}

function measure(v, t, kind) {
  return { v, t, p: Math.min(1, Math.max(0, v / t)), kind };
}

export function unlockMeasure(at, state, derived, api) {
  if (!at || typeof at !== 'object') return null;
  const s = state || {};
  const res = s.res || {};
  const stats = s.stats || {};
  const d = derived || {};
  for (const key of KEY_ORDER) {
    if (!(key in at)) continue;
    const t = at[key];
    switch (key) {
      case 'pop':
        if (finitePositive(t)) return measure(Math.floor(finitePositive(res.pop) ? res.pop : 0), t, 'pop');
        break;
      case 'powerDemand':
        if (finitePositive(t)) {
          const v = finitePositive(d.powerDemand) ? d.powerDemand : 0;
          // A "draws any power" gate (windmill: 0.001 MW) is a switch, not a bar.
          return t < 1 ? { v, t, p: v > 0 ? 1 : 0, kind: 'powerAny' } : measure(v, t, 'powerDemand');
        }
        break;
      case 'money':
        if (finitePositive(t)) return measure(finitePositive(res.money) ? res.money : 0, t, 'money');
        break;
      case 'earned':
        if (finitePositive(t)) return measure(finitePositive(stats.totalEarned) ? stats.totalEarned : 0, t, 'earned');
        break;
      case 'building': {
        const id = typeof t === 'string' ? t : '';
        if (!id) break;
        const count = finitePositive(at.count) ? at.count : 1;
        const v = s.buildings && finitePositive(s.buildings[id]) ? Math.floor(s.buildings[id]) : 0;
        return measure(v, count, 'building');
      }
      case 'legacy':
        if (finitePositive(t)) return measure(legacyBank(s, null, null).legacy, t, 'legacy');
        break;
      case 'legacyAvailable':
        if (finitePositive(t)) return measure(legacyBank(s, api, d.extra ? d.extra.prestige : null).available, t, 'legacyAvailable');
        break;
      case 'built':
        if (finitePositive(t)) return measure(finitePositive(stats.buildingsBuilt) ? Math.floor(stats.buildingsBuilt) : 0, t, 'built');
        break;
      case 'upgrades':
        if (finitePositive(t)) return measure(ownedUpgrades(s), t, 'upgrades');
        break;
    }
  }
  return null;
}

// The figure the label prints for a measure — integers as they are, money floored, megawatts
// to three significant digits — so a panel can skip formatting while it has not moved.
export function unlockDisplayKey(m) {
  if (!m) return '';
  switch (m.kind) {
    case 'money':
    case 'earned':
      return m.v < 1e6 ? Math.floor(m.v) : +m.v.toPrecision(4);
    case 'powerDemand':
      return +m.v.toPrecision(3);
    case 'powerAny':
      return m.v > 0 ? 1 : 0;
    default:
      return m.v;
  }
}

export function unlockLabel(m) {
  if (!m) return '';
  const { v, t } = m;
  switch (m.kind) {
    case 'pop':
      return `${num(v)} / ${num(t)}`;
    case 'powerAny':
      return v > 0 ? 'ready' : '0 MW drawn';
    case 'powerDemand':
      return `${short(v)} / ${short(t)} MW`;
    case 'money':
      return `${money(v)} / ${money(t)}`;
    case 'earned':
      return `${money(v)} / ${money(t)} earned`;
    case 'building':
    case 'built':
      return `${num(v)} / ${num(t)} built`;
    case 'legacy':
      return `${LEGACY_GLYPH} ${num(v)} / ${num(Math.ceil(t))}`;
    case 'legacyAvailable':
      return `${LEGACY_GLYPH} ${num(v)} / ${num(Math.ceil(t))} spendable`;
    case 'upgrades':
      return `${num(v)} / ${num(t)} funded`;
    default:
      return '';
  }
}

// Label for a teaser whose mirrored clause is already met (bar full, card still locked: the
// rung waits on its other clause). The treasury figure is dropped — "$5.00B / $12,000 ✓" in
// a replay city says nothing the hint does not, and clips in the 300px sidebar — so a hold
// reads "$12,000 held ✓", earnings "$500,000 earned ✓", counts "3 / 3 built ✓".
export function unlockMetLabel(m) {
  if (!m) return '';
  switch (m.kind) {
    case 'money':
      return `${money(m.t)} held ✓`;
    case 'earned':
      return `${money(m.t)} earned ✓`;
    case 'powerAny':
      return 'ready ✓';
    default: {
      const label = unlockLabel(m);
      return label ? `${label} ✓` : '';
    }
  }
}

// A one-line hint derived from the mirror alone, for a locked upgrade teaser whose definition
// forgot its `unlockHint` (the upgrades module lints for that, so this is a safety net, not
// the normal path): "Reach 1,000 citizens", "Hold $80", "Build 3 × Corner shop", ... Pure;
// `nameOf(id)` resolves a building id to its display name and may be omitted.
export function unlockFallbackHint(at, nameOf) {
  const generic = 'Grow the city to reveal this idea.';
  if (!at || typeof at !== 'object') return generic;
  for (const key of KEY_ORDER) {
    if (!(key in at)) continue;
    const t = at[key];
    switch (key) {
      case 'pop':
        if (finitePositive(t)) return `Reach ${num(t)} citizens`;
        break;
      case 'powerDemand':
        if (finitePositive(t)) return t < 1 ? 'Draw any power' : `Draw ${short(t)} MW`;
        break;
      case 'money':
        if (finitePositive(t)) return `Hold ${money(t)}`;
        break;
      case 'earned':
        if (finitePositive(t)) return `Earn ${money(t)} in total`;
        break;
      case 'building': {
        const id = typeof t === 'string' ? t : '';
        if (!id) break;
        const count = finitePositive(at.count) ? at.count : 1;
        const name = (typeof nameOf === 'function' && nameOf(id)) || id;
        return `Build ${num(count)} × ${name}`;
      }
      case 'legacy':
        if (finitePositive(t)) return `Bank ${LEGACY_GLYPH} ${num(Math.ceil(t))} legacy`;
        break;
      case 'legacyAvailable':
        if (finitePositive(t)) return `Hold ${LEGACY_GLYPH} ${num(Math.ceil(t))} spendable legacy`;
        break;
      case 'built':
        if (finitePositive(t)) return `Build ${num(t)} buildings in total`;
        break;
      case 'upgrades':
        if (finitePositive(t)) return `Fund ${num(t)} upgrades`;
        break;
    }
  }
  return generic;
}

// The three quiet lines under a building card's stats — signature synergy, grid strain
// (`demandGrowth.text`, tier-4 consumers: "draw +12.5% per District owned (up to ×40)") and
// the power hint — as trimmed strings, '' when the def carries none. Pure.
export function buildingLines(def) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    synergy: def && def.synergy ? str(def.synergy.text) : '',
    strain: def && def.demandGrowth ? str(def.demandGrowth.text) : '',
    power: def ? str(def.powerHint) : '',
  };
}

// The live grid-strain factor as a card suffix: '' for a single unit (or nothing scaled),
// '×3.1 now' once the fleet draws more than its sticker, '×40 now (cap)' at the rule's cap.
// `live` / `base` are the per-unit draw the buildings module reports (`game.buildings`
// liveStat / baseStat), so the multiplier is the module's own number, not a second copy
// of the formula. Two significant digits under ×10, whole numbers above. Pure.
export function strainNow(live, base, cap) {
  if (!(Number.isFinite(live) && Number.isFinite(base) && base > 0)) return '';
  const f = live / base;
  if (!(f > 1.005)) return '';
  const n = f >= 10 ? Math.round(f) : +f.toFixed(1);
  const capped = Number.isFinite(cap) && cap > 1 && f >= cap - 1e-9;
  return `×${n.toLocaleString('en-US')} now${capped ? ' (cap)' : ''}`;
}

// ---- The founding rule in plain words (docs/FEEDBACK.md F6) ----
//
// simulation/prestige.js: founding is allowed once gain ≥ max(minGain, ceil(legacy ×
// minGainShare)), and gain comes from THIS city's earnings (lifetime worth minus the bank),
// so the gate is on how far this city is pushed, never on how many cities came before.
// derived.extra.prestige gives the resolved gate (minGain), the bank (legacy), the points a
// founding banks now (gain), whether it is allowed (can) and this run's earnings at which
// it arms (unlockAt). `share` is config.prestige.minGainShare (0.4). Two lines, pure.
export function foundingRule({ gain = 0, minGain = 1, legacy = 0, share = 0.4, earned = 0, unlockAt = 0, can = false } = {}) {
  const fin = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);
  gain = Math.floor(fin(gain));
  minGain = Math.max(1, Math.ceil(fin(minGain, 1)));
  legacy = Math.floor(fin(legacy));
  share = fin(share, 0.4);
  earned = fin(earned);
  unlockAt = fin(unlockAt);
  const need = `${LEGACY_GLYPH} ${num(minGain)}`;
  const rule = legacy > 0
    ? `Found needs +${need} legacy (≥ ${fmtPct(share)} of your bank of ${LEGACY_GLYPH} ${num(legacy)}).`
    : `Found needs +${need} legacy.`;
  let gate;
  if (can || gain >= minGain) {
    gate = unlockAt > 0
      ? `This city has earned ${money(earned)}, past the ${money(unlockAt)} gate. The gate is on this city's earnings, never on how many cities you have founded.`
      : `The gate is on this city's earnings, never on how many cities you have founded.`;
  } else {
    const more = unlockAt > earned ? unlockAt - earned : 0;
    gate = unlockAt > 0
      ? `That takes ${money(unlockAt)} earned in this city — ${money(more)} more. The gate is on this city's earnings, never on how many cities you have founded.`
      : `The gate is on this city's earnings, never on how many cities you have founded.`;
  }
  return { rule, gate, text: `${rule} ${gate}` };
}

// ---- Happiness breakdown (docs/FEEDBACK.md F4) ----
//
// derived.extra.happiness (resources) carries one signed entry per term of the formula plus
// the clamp, the total and the income factor. These helpers turn it into the rows the City
// Hall panel prints — every term with its sign, even the zero ones, so the player can see
// which levers exist — and the one-line hint keyed by capReason (what most limits happiness
// right now). `hb` may be missing or partial (an older snapshot): absent terms read as 0.

// '+51.3%' / '-19.3%' / '0%': one decimal so a 1.5 % smog cost never rounds to nothing.
export function signedPct(v) {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 5e-4) return '0%';
  return (v > 0 ? '+' : '') + fmtPct(v, 1);
}

const HAPPINESS_HINTS = {
  none: 'Nothing is holding it back: parks, schools and plazas still pay in full.',
  'civic cap': 'More parks barely help now — cut smog or joblessness instead.',
  pollution: 'Smog is the biggest drag: scrubbers, clean power, fewer factories.',
  unemployment: 'Joblessness is the biggest drag: shops and offices put people to work.',
  overcrowding: 'Overcrowding is the biggest drag: build housing.',
  brownout: 'The brownout is the biggest drag: build power before anything else.',
  max: 'Pinned at the maximum — nothing more can raise it.',
  min: 'Pinned at the minimum — smog, joblessness, overcrowding or a brownout, all at once.',
};

export function happinessHint(capReason, hb) {
  let text = HAPPINESS_HINTS[capReason];
  if (!text) return '';
  if (capReason === 'max' && hb && Number.isFinite(hb.max)) text = text.replace('the maximum', `the maximum (${fmtPct(hb.max)})`);
  if (capReason === 'min' && hb && Number.isFinite(hb.min)) text = text.replace('the minimum', `the minimum (${fmtPct(hb.min)})`);
  return text;
}

// Rows in formula order: [{ key, label, value, note }]; value is the signed term (1 = 100 %),
// note is the small print beside it ('' when there is nothing to add). The clamp row only
// appears while the clamp is doing something. `unemployment` is the rate (derived.extra),
// only used for the note.
export function happinessRows(hb, { unemployment } = {}) {
  const b = hb && typeof hb === 'object' ? hb : {};
  const n = (v) => (Number.isFinite(v) ? v : 0);
  // A drag is always printed as a drag whatever sign the snapshot used; zero stays +0, not -0.
  const drag = (v) => (Math.abs(n(v)) < 5e-4 ? 0 : -Math.abs(n(v)));
  const rows = [
    { key: 'base', label: 'Base', value: Number.isFinite(b.base) ? b.base : 1, note: '' },
    {
      key: 'civic',
      label: 'Civic buildings',
      value: n(b.civic),
      note: Number.isFinite(b.civicCap) && b.civicCap > 0 ? `${fmtPct(n(b.civicSaturation))} of the +${fmtPct(b.civicCap)} cap` : '',
    },
    {
      key: 'pollution',
      label: 'Smog',
      value: drag(b.pollution),
      note: Number.isFinite(b.pollutionCap) && b.pollutionCap > 0 ? `at most -${fmtPct(b.pollutionCap)}` : '',
    },
    {
      key: 'unemployment',
      label: 'Unemployment',
      value: drag(b.unemployment),
      note: Number.isFinite(unemployment) && unemployment > 0.0005 ? `${fmtPct(unemployment, 1)} jobless` : '',
    },
    { key: 'overcrowd', label: 'Overcrowding', value: drag(b.overcrowd), note: '' },
    { key: 'brownout', label: 'Brownout', value: drag(b.brownout), note: '' },
    { key: 'mods', label: 'Upgrades & perks', value: n(b.mods), note: '' },
  ];
  const clamp = n(b.clamp);
  if (Math.abs(clamp) >= 5e-4) {
    rows.push({ key: 'clamp', label: 'Clamp', value: clamp, note: `held within ${fmtPct(n(b.min))} – ${fmtPct(n(b.max))}` });
  }
  return rows;
}

// The total line: happiness itself and what it does to income (0.5 + 0.5 × happiness).
export function happinessTotal(hb) {
  const b = hb && typeof hb === 'object' ? hb : {};
  const total = Number.isFinite(b.total) ? b.total : 1;
  const mult = Number.isFinite(b.incomeMult) ? b.incomeMult : 0.5 + 0.5 * total;
  return { total, mult, text: fmtPct(total), incomeText: `income ×${mult.toFixed(2)}` };
}

// ---- Buy / sell amount for one click on a building card (docs/FEEDBACK.md F14) ----
//
// The ×1 / ×10 / Max segment sets the default amount and applies to Sell as much as to Buy;
// a modifier key overrides it for one click — Shift = ×10, Ctrl (⌘ on a Mac) = Max — the
// genre standard, stated on the segment's tooltips and in Settings (MODIFIER_HELP). Sell
// never goes below zero owned: ×10 with 7 owned sells 7, Max sells every unit, nothing owned
// sells nothing. Buy Max is whatever core's api.maxAffordable said (0 → n 0, the button
// disables). `amount` is the resolved segment value so a label can read 'Buy ×10' / 'Sell
// ×7', and `all` says a sell would empty the stack. Pure.
export const MODIFIER_HELP = 'Shift-click a Buy or Sell button for ×10, Ctrl-click (⌘ on a Mac) for the maximum.';

export function tradeCount({ mode = 1, sell = false, owned = 0, affordable = 0, shift = false, ctrl = false } = {}) {
  let amount = ctrl ? 'max' : shift ? 10 : mode;
  if (amount !== 'max') amount = Number.isFinite(amount) && amount >= 1 ? Math.floor(amount) : 1;
  owned = Number.isFinite(owned) && owned > 0 ? Math.floor(owned) : 0;
  affordable = Number.isFinite(affordable) && affordable > 0 ? Math.floor(affordable) : 0;
  let n;
  if (sell) n = amount === 'max' ? owned : Math.min(amount, owned);
  else n = amount === 'max' ? affordable : amount;
  return { n, amount, all: sell && owned > 0 && n === owned };
}

export function unlockProgress(at, state, derived, api) {
  const m = unlockMeasure(at, state, derived, api);
  if (!m) return null;
  return { p: m.p, label: unlockLabel(m), kind: m.kind === 'powerAny' ? 'powerDemand' : m.kind };
}

// The next locked money rungs worth teasing under the open cards: cheapest first, never a
// broken or owned row, and Heritage rungs (unlocked by legacy) only once the player knows
// what a founding is — the Legacy panel is open or legacy is banked — so a first-city
// player is never told to "Found a new city" before the game has introduced the idea.
export function teaserRungs(rows, { count = 2, prestigeKnown = false } = {}) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.unlocked || r.owned || r.broken) continue;
    if (r.currency === 'legacy') continue;
    if (r.category === 'prestige' && !prestigeKnown) continue;
    if (!Number.isFinite(r.cost)) continue;
    out.push(r);
  }
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, Math.max(0, count));
}

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

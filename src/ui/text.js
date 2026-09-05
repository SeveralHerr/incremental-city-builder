// Pure text/number helpers shared by the panels. DOM-free so ui.test.mjs can cover them.
import { short, num, fmtPct } from './dom.js';

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

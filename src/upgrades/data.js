// Upgrade definitions for Metropolis. DOM-free, pure data + tiny pure functions.
//
// Every entry: { id, name, icon, desc (≤70 chars, states the exact effect), cost, category,
//   tier, currency? ('money' by default, 'legacy' for charter perks), unlock(state, derived)
//   -> boolean, unlockHint (string), unlockAt? (data mirror of the rule for progress bars),
//   effect(mods, state) -> void }
//
// Effects only mutate the mods bag (see src/core/mods.js). Unlock rules read state counts,
// population, earnings this run, prestige legacy and latched milestone flags — never the
// clock. Each milestone check has a direct-state fallback so the ladder works even if the
// simulation module names a milestone differently; the flags below are the ids we expect
// simulation to latch as `state.unlocks['m:' + id]`.
//
// Unlock hints: every helper factory below (hasBuilt, hasPop, hasEarned, hasLegacy, owns, …)
// tags the rule it returns with `.hint` (plain English) and, where the rule is a single
// measurable threshold, `.at` (the same shape src/buildings/data.js uses for `unlockAt`:
// {pop} | {powerDemand} | {legacy} | {legacyAvailable} | {earned} | {building, count} |
// {upgrade} | …). The `withHints` pass at the bottom copies them onto each definition as `unlockHint` /
// `unlockAt`, so the UI can show the next locked ideas with a progress bar like the building
// cards, without every definition spelling the hint out twice. Hand-written rules carry an
// explicit `unlockHint`.
//
// Prices: src/balance/config.js owns every shipped price (`config.upgrades[id]`, merged by
// index.js before registering) and the balance builder retunes it without touching this
// file. Every literal below that config overrides is a copy of the config price (checked
// by upgrades.test.mjs, "data.js literals match config": a drift fails the test), so the
// file reads true on its own and a missing config still gives the tuned game. After a
// balance pass, copy the new prices in — or the test says which ones moved. Measured
// numbers in the comments are from logs/sim-final.json (12 h greedy bot, 2026-09-07).
//
// The ladder has five parts:
//   • the core ladder, $25 → $2e7: the first city's rungs, unlocked by what the city has
//     built (shops, parks, plants …). Institutional Memory (tiers 1–2, city 3), the Grid
//     Charter (tier 3, city 6) and Standing Orders (the Legacy rungs, city 21) grant the
//     ladder back at every founding, so a replay starts at the decisions below;
//   • the pace ladder (`pace: true`), nine tier-4 rungs from $90M to $344T placed one per
//     city by the balance builder: each opens once this run has earned a hundred times its
//     price (`earnedGate: PACE_GATE`, see `earnedUnlock`). That is the point at which the
//     replay's cash — a few seconds of income in a mature city — is about to reach it, so a
//     pace rung arrives as a reward that can be funded on the spot, not a card that sits
//     "almost affordable" for twenty minutes (measured: the greedy bot buys each pace rung
//     for the first time when the city has earned 100–130× its price);
//   • the frontier ladder (`frontier: true`), eight fixed-dollar rungs from $2.2B to $26Qa
//     (Dyson Swarm … Exchange Ring), each opening once this run has earned a quarter of its
//     price (`earnedGate: FRONTIER_GATE`). Deliberately uneven (×1.1–1,900 apart — the
//     balance builder places them by city, see config.js): with the pace rungs hidden until
//     they are affordable, the cheapest frontier rung is the money target the Upgrades panel
//     shows, and its spacing is what keeps that target 30 s – 15 min of income away instead
//     of an "almost there" card, for most of a replay. The design sketch's ×10 from $1e13 to
//     $1e18 is what these rungs were before the first balance pass; the ×10 spacing never
//     shipped;
//   • the Legacy rungs (category 'prestige'): unlocked by legacy points (the whole bank,
//     spent or not), paid in money each run;
//   • the Charter perks (category 'charter', currency 'legacy'): twelve permanent perks
//     bought with legacy points (core's api.buyUpgrade debits state.prestige.spent; the
//     income bonus keeps using the whole bank). Costs run ×2.5 apart from 3 to 76,488
//     points (whole points, never under ×2.5), each opening once the *spendable* bank —
//     legacy − spent, the same number core's canAffordUpgrade checks — holds half its
//     price, and every one is a real jump: +50–200% income, +50–100% housing, +100–200%
//     power, −15% cost. The bot signs the Imperial Charter in its 30th replay city (measured:
//     cycle 31 of 32 in 12 h); the unlock rule and tier bracket follow the config price
//     (`charterUnlockFor`). A founding wipes state.upgrades, so index.js grants every owned
//     perk back the moment a city is founded (`keptUpgradeIds` is the pure rule).
//
// All three self-priced gates (frontier cost/4, pace cost×100, charter cost/2) are rebuilt
// by index.js after a config override, so a retuned price moves its gate, hint and progress
// mirror with it.
//
// Nothing here reads the run clock: content gates on the economy, never on elapsed time.
//
// Happiness: `mods.happiness` is added to the final happiness value *after* the civic
// curve (resources: 1 + civic − penalties + mods.happiness), so "Happiness +10%" is exactly
// what the chip shows. Per-building happiness adds (byBuilding.happiness) are not used
// here on purpose: they feed the saturating civic sum, civic = 1.25·(1 − e^(−Σ/1.5)), and
// past three parks and a school that sum is already near the cap, so a "+6% per hospital"
// rung measured +0.01–0.05 happiness in the sim — a desc that reads as a promise the
// curve never keeps. Flat happiness is only worth its wording while happiness is low
// (+0.1 at h≈0.85 is ~+6% income and growth; at the h≈2–2.8 of a late city it is ~+3%), so
// only the three rungs that open while a city is still unhappy carry it — Community Events
// and Green Belts in the first ten minutes, Veteran Planners in a replay's jobless opening
// minute — 0.25 in total, each paired with a real growth multiplier. Everything later
// (Modern Curriculum, Preventive Care, the Civic Charter) moves jobs, growth or income.
import { buildingMod } from '../core/mods.js';

export const MILESTONE_IDS = [
  'pop-100',
  'pop-1k',
  'pop-10k',
  'pop-100k',
  'money-1k',
  'money-100k',
  'money-1m',
  'money-1b',
  'brownout',
  'first-upgrade',
  'buildings-100',
  'prestige-1',
];

export const UPGRADE_CATEGORIES = [
  { id: 'residential', name: 'Residential', icon: '🏠', color: '#60a5fa' },
  { id: 'commercial', name: 'Commercial', icon: '🏪', color: '#4ade80' },
  { id: 'industrial', name: 'Industrial', icon: '🏭', color: '#fb923c' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15' },
  { id: 'civic', name: 'Civic', icon: '🏛️', color: '#c084fc' },
  { id: 'global', name: 'City Hall', icon: '🏙️', color: '#e2e8f0' },
  { id: 'prestige', name: 'Legacy', icon: '🌟', color: '#fbbf24' },
  { id: 'charter', name: 'Charter', icon: '⚜️', color: '#f59e0b' },
];

// Building names for hint text (singular, plural), matching src/buildings/data.js.
const BUILDING_NAMES = {
  house: ['Cottage', 'cottages'],
  apartment: ['Apartment Block', 'apartment blocks'],
  tower: ['Residential Tower', 'residential towers'],
  arcology: ['Arcology', 'arcologies'],
  shop: ['Corner Shop', 'corner shops'],
  office: ['Office Block', 'office blocks'],
  mall: ['Shopping Mall', 'shopping malls'],
  financial: ['Financial District', 'financial districts'],
  factory: ['Factory', 'factories'],
  refinery: ['Refinery', 'refineries'],
  techpark: ['Tech Campus', 'tech campuses'],
  windmill: ['Windmill', 'windmills'],
  coal: ['Coal Plant', 'coal plants'],
  solar: ['Solar Farm', 'solar farms'],
  nuclear: ['Nuclear Plant', 'nuclear plants'],
  fusion: ['Fusion Reactor', 'fusion reactors'],
  park: ['City Park', 'city parks'],
  school: ['School', 'schools'],
  hospital: ['Hospital', 'hospitals'],
  stadium: ['Stadium', 'stadiums'],
};
const buildingName = (id, n) => {
  const names = BUILDING_NAMES[id] || [id, id + 's'];
  if (n !== 1) return `${fmtInt(n)} ${names[1]}`;
  return `${/^[aeiou]/i.test(names[0]) ? 'an' : 'a'} ${names[0]}`;
};
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
// Short money for hints: $1,000 · $1M · $1B · $20B · $1T · $2.5Qa (same suffixes as core/format).
const MONEY_UNITS = [[1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
export const fmtMoney = (n) => {
  for (const [v, u] of MONEY_UNITS) {
    if (n >= v) {
      const x = n / v;
      return '$' + (Number.isInteger(x) ? x : +x.toFixed(1)) + u;
    }
  }
  return '$' + fmtInt(n);
};

// ---------- unlock helpers (all tolerate partially-built state/derived) ----------

const count = (state, id) => (state && state.buildings && state.buildings[id]) || 0;
const pop = (state) => (state && state.res && state.res.pop) || 0;
const earned = (state) => (state && state.stats && state.stats.totalEarned) || 0;
const built = (state) => (state && state.stats && state.stats.buildingsBuilt) || 0;
const legacy = (state) => (state && state.prestige && state.prestige.legacy) || 0;
// Spendable legacy: the bank less what charter perks have already cost, floored the way
// core's api.legacyAvailable floors it (so the gate and the Sign button agree to the point).
const legacyAvailable = (state) => {
  const p = state && state.prestige;
  const bank = p && Number.isFinite(p.legacy) && p.legacy > 0 ? Math.floor(p.legacy) : 0;
  const spent = p && Number.isFinite(p.spent) && p.spent > 0 ? Math.floor(p.spent) : 0;
  return Math.max(0, bank - spent);
};
const milestone = (state, id) => !!(state && state.unlocks && state.unlocks['m:' + id]);
const ownedUpgrades = (state) => (state && state.upgrades ? Object.keys(state.upgrades).length : 0);

// Tag a rule with its hint (and optional data mirror) so definitions can inherit them.
const rule = (fn, hint, at) => {
  fn.hint = hint;
  if (at) fn.at = at;
  return fn;
};
// Names for the hint sentence: "Own Orbital Solar" needs the upgrade's name, which is
// declared later in this file, so `owns` resolves it lazily through this table.
const NAME_OF = {};
const upgradeName = (id) => NAME_OF[id] || id;

const owns = (id) => {
  const fn = (state) => !!(state && state.upgrades && state.upgrades[id]);
  Object.defineProperty(fn, 'hint', { get: () => `Own ${upgradeName(id)}`, enumerable: true });
  fn.at = { upgrade: id };
  return fn;
};
const hasBuilt = (id, n) => rule((state) => count(state, id) >= n, `Build ${buildingName(id, n)}`, { building: id, count: n });
const cash = (state) => (state && state.res && state.res.money) || 0;
const holds = (n) => rule((state) => cash(state) >= n, `hold ${fmtMoney(n)}`);
const hasPop = (n, ms) => rule((state) => pop(state) >= n || (ms ? milestone(state, ms) : false), `Reach ${fmtInt(n)} citizens`, { pop: n });
const hasEarned = (n, ms) =>
  rule((state) => earned(state) >= n || (ms ? milestone(state, ms) : false), `Earn ${fmtMoney(n)} in this city`, { earned: n });
const hasLegacy = (n) =>
  rule(
    (state) => legacy(state) >= n || (n <= 1 && milestone(state, 'prestige-1')),
    n <= 1 ? 'Found a new city' : `Bank ${fmtInt(Math.ceil(n))} legacy points`,
    { legacy: n }
  );
// Charter gate: spendable points, not the bank — a perk that reads "open" can be signed
// the moment its price is spendable, and the hint counts toward that same number.
const hasLegacyAvailable = (n) => rule((state) => legacyAvailable(state) >= n, `Have ${fmtInt(Math.ceil(n))} spendable legacy points`, { legacyAvailable: n });
const hasDemand = (mw) =>
  rule((state, derived) => !!derived && Number.isFinite(derived.powerDemand) && derived.powerDemand >= mw, `Draw ${fmtInt(mw)} MW of power`, {
    powerDemand: mw,
  });
const hasBuiltTotal = (n) => rule((state) => milestone(state, 'buildings-100') || built(state) >= n, `Build ${fmtInt(n)} buildings in total`, { built: n });
const hasAnyUpgrade = () => rule((state) => milestone(state, 'first-upgrade') || ownedUpgrades(state) >= 1, 'Fund any upgrade', { upgrades: 1 });
// Combinators join the hints ("A or B", "A and B"). `any` carries the first rule's data
// mirror (the easiest door in is the one worth a progress bar). `all` carries the first
// *measurable* one — a mirror that counts toward a threshold ({pop}, {legacy}, …) rather
// than an ownership flag ({upgrade}), since every gate must open and a bar that reads 100%
// against a card that stays locked on the other condition is worse than no bar.
const lower = (s) => (typeof s === 'string' ? s.charAt(0).toLowerCase() + s.slice(1) : '');
const joinHints = (fns, word) => {
  const parts = fns.map((f) => f.hint).filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : lower(p))).join(` ${word} `);
};
const measurable = (at) => !!at && typeof at === 'object' && !('upgrade' in at);
const any = (...fns) => {
  const fn = (state, derived) => fns.some((f) => f(state, derived) === true);
  Object.defineProperty(fn, 'hint', { get: () => joinHints(fns, 'or'), enumerable: true });
  if (fns[0] && fns[0].at) fn.at = fns[0].at;
  return fn;
};
const all = (...fns) => {
  const fn = (state, derived) => fns.every((f) => f(state, derived) === true);
  Object.defineProperty(fn, 'hint', { get: () => joinHints(fns, 'and'), enumerable: true });
  const pick = fns.find((f) => measurable(f.at)) || fns.find((f) => f.at);
  if (pick) fn.at = pick.at;
  return fn;
};

// ---------- effect helpers ----------

const incomeOf = (id, mult) => (mods) => {
  buildingMod(mods, id).income *= mult;
};
const housingOf = (id, mult) => (mods) => {
  buildingMod(mods, id).housing *= mult;
};
const jobsOf = (id, mult) => (mods) => {
  buildingMod(mods, id).jobs *= mult;
};
const powerOf = (id, mult) => (mods) => {
  buildingMod(mods, id).power *= mult;
};
// Flat city-wide happiness (see the header): happiness is a multiplier around 1.0 that the
// UI shows as a percentage, so +0.1 is written "Happiness +10%" and lands exactly so.
const happier = (add) => (mods) => {
  mods.happiness += add;
};
const global = (key, mult) => (mods) => {
  mods[key] *= mult;
};
const compose = (...fns) => (mods, state) => {
  for (const f of fns) f(mods, state);
};
// Upgrades whose whole effect is structural (kept upgrades, see FOUNDING MEMORY) change no
// modifier; the mods bag is left exactly as it came.
const noEffect = () => {};

// Building groups for the per-sector rungs (ids match src/buildings/data.js).
const INDUSTRY = ['factory', 'refinery', 'techpark'];
const COMMERCE = ['shop', 'office', 'mall', 'financial'];
const incomeOfEach = (ids, mult) => compose(...ids.map((id) => incomeOf(id, mult)));

// ---------- earnings gates: the frontier and pace ladders ----------
//
// A rung with `earnedGate` opens once this run has earned `earnedGate × cost`. The gate is
// a share of the *registered* price, so index.js rebuilds the rule after a config override:
// `earnedUnlock` is the one place the rule lives. A founding zeroes totalEarned and both
// ladders lock again — the late game is "earn your way back", never "wait".
//
//   • FRONTIER_GATE 0.25 — a frontier rung shows up while it is still far off (its price is
//     four times what the city has earned so far) and stays on the card as the goal the
//     next minutes of income are for.
//   • PACE_GATE 100 — a pace rung stays hidden until the city has earned a hundred times
//     its price *or the treasury holds the price*. In a replay the bot's cash sits at 2–10 s
//     of income and a rung placed for this city is reached by a cash spike when earnings
//     pass ~100–130× its price; opening it earlier only parks an "almost affordable" card
//     on top of the frontier target for the rest of the city. The second door is what keeps
//     the founding spree intact: a rung bought in an earlier city costs a replay a few
//     seconds of income, and it must come back the moment the cash is there (measured:
//     without that door every replay re-bought its ladder minutes later and the 12 h
//     session lost seven foundings). A player who saves therefore finds every pace rung
//     fundable the moment it appears. Re-measure with tools/economy-sim.mjs after a
//     balance pass.

export const FRONTIER_GATE = 0.25;
export const PACE_GATE = 100;

// Unlock rule + hint + progress mirror for a def whose gate is `earnedGate × cost`; a pace
// rung (`pace: true`) also opens while the treasury holds its price.
export function earnedUnlock(def) {
  const share = def && Number.isFinite(def.earnedGate) && def.earnedGate > 0 ? def.earnedGate : FRONTIER_GATE;
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : 0;
  const at = cost * share;
  const fn = def && def.pace ? any(hasEarned(at), holds(cost)) : hasEarned(at);
  return { unlock: fn, unlockHint: fn.hint.charAt(0).toUpperCase() + fn.hint.slice(1), unlockAt: { earned: at } };
}
// The seam docs/DESIGN.md names (`applyOverride` → `frontierUnlock`); same function.
export const frontierUnlock = earnedUnlock;

const frontier = (def) => ({ ...def, category: def.category || 'global', tier: 4, frontier: true, earnedGate: FRONTIER_GATE, ...earnedUnlock({ ...def, earnedGate: FRONTIER_GATE }) });
const pace = (def) => ({ ...def, category: def.category || 'global', tier: 4, pace: true, earnedGate: PACE_GATE, ...earnedUnlock({ ...def, pace: true, earnedGate: PACE_GATE }) });

// ---------- frontier ladder (fixed dollars, each opens at a quarter of its price) ----------
//
// Eight rungs, each a different lever. Prices are config's placement-by-city (see the
// header; cities counted from the first founding): the Dyson Swarm lands mid-city 10, the
// Quantum Exchange in city 13, then the Mass-Driver Port (23), Ringworld District (24),
// Stellar Engine (26), Galactic Charter (28, beside the Energy Charter), Orbital Shipyard
// (29) and the Exchange Ring (31) carry the last four hours of a 12 h session. A rung is
// visible from the city that earns a quarter of its price, four to eight cities before the
// one that buys it. The Exchange Ring at $26Qa is the priciest thing in the game — a 12 h
// bot's cash peaks at $2.8e16 — and stays two orders under the $1e18 money ceiling.

const FRONTIER = [
  frontier({
    id: 'dyson-swarm',
    name: 'Dyson Swarm',
    icon: '🌞',
    desc: 'All power generation ×4',
    cost: 2.23e9,
    category: 'power',
    effect: global('power', 4),
  }),
  frontier({
    id: 'quantum-exchange',
    name: 'Quantum Exchange',
    icon: '💹',
    desc: 'All income +100% · financial districts earn +100%',
    cost: 4.5e10,
    category: 'commercial',
    effect: compose(global('income', 2), incomeOf('financial', 2)),
  }),
  frontier({
    id: 'mass-driver-port',
    name: 'Mass-Driver Port',
    icon: '🚀',
    desc: 'All buildings cost −25% · industry earns +100% income',
    cost: 5.55e13,
    category: 'industrial',
    effect: compose(global('cost', 0.75), incomeOfEach(INDUSTRY, 2)),
  }),
  frontier({
    id: 'ringworld-district',
    name: 'Ringworld District',
    icon: '🪐',
    desc: 'All housing +150% and all jobs +50%',
    cost: 6.32e13,
    category: 'residential',
    effect: compose(global('housing', 2.5), global('jobs', 1.5)),
  }),
  frontier({
    id: 'stellar-engine',
    name: 'Stellar Engine',
    icon: '🌟',
    desc: 'Population grows +200% faster · buildings use −40% power',
    cost: 2.43e14,
    category: 'global',
    effect: compose(global('growth', 3), global('demand', 0.6)),
  }),
  frontier({
    id: 'galactic-charter',
    name: 'Galactic Charter',
    icon: '🌌',
    desc: 'All income +100% · all buildings cost −20%',
    cost: 4.31e14,
    category: 'global',
    // ×2, not ×3: it is bought from the 29th city on, so it is the one income lever that
    // shapes only the session's last hour. At ×3 the 31st city completes with nothing new
    // to buy before 12 h; at ×2 the session ends inside it, the way config places it.
    effect: compose(global('income', 2), global('cost', 0.8)),
  }),
  frontier({
    id: 'orbital-shipyard',
    name: 'Orbital Shipyard',
    icon: '🛸',
    desc: 'All jobs +75% · buildings use −30% power',
    cost: 1.12e15,
    category: 'industrial',
    effect: compose(global('jobs', 1.75), global('demand', 0.7)),
  }),
  frontier({
    id: 'exchange-ring',
    name: 'Exchange Ring',
    icon: '💱',
    desc: 'All housing +100% · commerce provides +100% jobs',
    cost: 2.59e16,
    category: 'commercial',
    effect: compose(global('housing', 2), ...COMMERCE.map((id) => jobsOf(id, 2))),
  }),
];

// ---------- charter perks (legacy-priced, permanent) ----------

export const CHARTER_MIN_COST = 3;
export const CHARTER_MAX_COST = 76488;
// A perk opens once the *spendable* bank (legacy − spent) holds half its price. Gating on
// the whole bank left late perks reading "open" for two or three cities while the Sign
// button stayed dead (measured: the Imperial Charter opened at bank 38,244 in city 27 and
// was signable at 76,488 spendable after founding 30); spendable points are what core's
// canAffordUpgrade checks, so open now means "half-way to signing", never "ready but not".
export const CHARTER_GATE = 0.5;

export const charterTier = (cost) => (cost <= 25 ? 1 : cost <= 600 ? 2 : cost <= 12000 ? 3 : 4);
const charterUnlock = (cost) => hasLegacyAvailable(cost * CHARTER_GATE);

// Unlock rule + hint + progress mirror + tier for a perk priced at `def.cost` legacy. Like
// `frontierUnlock`, this is the one place the rule lives: index.js rebuilds it after a
// config override so a config-priced perk still opens at half *its* price. The mirror is
// `{ legacyAvailable }` (spendable points), the same shape core's api.legacyAvailable
// measures, so a bar drawn against it reaches 100% exactly when the card opens.
export function charterUnlockFor(def) {
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : CHARTER_MIN_COST;
  const fn = charterUnlock(cost);
  return { unlock: fn, unlockHint: fn.hint.charAt(0).toUpperCase() + fn.hint.slice(1), unlockAt: { legacyAvailable: cost * CHARTER_GATE }, tier: charterTier(cost) };
}

const charter = (def) => ({
  ...def,
  category: 'charter',
  currency: 'legacy',
  tier: charterTier(def.cost),
  unlock: charterUnlock(def.cost),
});

const CHARTER = [
  charter({ id: 'charter-homestead', name: 'Homestead Charter', icon: '🏡', desc: 'All housing +50%', cost: 3, effect: global('housing', 1.5) }),
  charter({ id: 'charter-mint', name: 'Mint Charter', icon: '🪙', desc: 'All income +50% and building upkeep −25%', cost: 8, effect: compose(global('income', 1.5), global('upkeep', 0.75)) }),
  charter({
    id: 'charter-grid',
    name: 'Grid Charter',
    icon: '⚡',
    desc: 'All power generation +100% · tier 3 upgrades kept at every founding',
    cost: 20,
    // The second keeper (see FOUNDING MEMORY): signed in city 6, it carries the ten
    // tier-3 core rungs into every later city. Without it a replay re-bought all of them
    // from city 4 until Standing Orders landed in city 21 — seventeen cities (~4 h) of
    // clicks that decided nothing. Paid in legacy, it is permanent, so the `keeps` rule
    // holds from the founding after it is signed. Pacing is untouched (measured: the same
    // 32 foundings, every cycle within a minute): the bot re-bought those rungs inside the
    // first minute anyway, off seed cash that dwarfs their $8M.
    keeps: (def) => isCore(def) && def.tier === 3,
    effect: global('power', 2),
  }),
  charter({
    id: 'charter-guild',
    name: 'Guild Charter',
    icon: '⚒️',
    desc: 'Factories, refineries and tech campuses earn +100% income',
    cost: 50,
    effect: incomeOfEach(INDUSTRY, 2),
  }),
  charter({
    id: 'charter-merchant',
    name: 'Merchant Charter',
    icon: '🏪',
    desc: 'Shops, offices, malls and financial districts earn +100%',
    cost: 125,
    effect: incomeOfEach(COMMERCE, 2),
  }),
  charter({
    id: 'charter-settlers',
    name: "Settlers' Charter",
    icon: '🚂',
    desc: 'Population grows +100% faster · new arrivals +200%',
    cost: 313,
    effect: compose(global('growth', 2), global('inflow', 3)),
  }),
  charter({ id: 'charter-masons', name: "Masons' Charter", icon: '🧱', desc: 'All buildings cost −15%', cost: 783, effect: global('cost', 0.85) }),
  charter({ id: 'charter-civic', name: 'Civic Charter', icon: '🎭', desc: 'All jobs +50% · population grows +50% faster', cost: 1958, effect: compose(global('jobs', 1.5), global('growth', 1.5)) }),
  charter({ id: 'charter-treasury', name: 'Treasury Charter', icon: '💎', desc: 'All income +100% and building upkeep −50%', cost: 4895, effect: compose(global('income', 2), global('upkeep', 0.5)) }),
  charter({ id: 'charter-skyline', name: 'Skyline Charter', icon: '🌇', desc: 'All housing +100% and all jobs +50%', cost: 12238, effect: compose(global('housing', 2), global('jobs', 1.5)) }),
  charter({
    id: 'charter-energy',
    name: 'Energy Charter',
    icon: '🔋',
    desc: 'All power generation +200% · buildings use −25% power',
    cost: 30595,
    effect: compose(global('power', 3), global('demand', 0.75)),
  }),
  charter({
    id: 'charter-imperial',
    name: 'Imperial Charter',
    icon: '👑',
    desc: 'All income +200% and all buildings cost −15%',
    cost: 76488,
    effect: compose(global('income', 3), global('cost', 0.85)),
  }),
];

// ---------- founding memory ----------
//
// A founding wipes every upgrade. Two things come back on their own:
//   • every charter perk the mayor owns — they are paid in legacy points, a currency a
//     founding never refunds, so they are permanent by construction;
//   • with legacy-scaled seed money the whole core ladder is affordable again within the
//     first minute: dozens of clicks that decide nothing. Three keeper rungs carry
//     `keeps(def)` — Institutional Memory (tiers 1–2) and Standing Orders (the Legacy
//     rungs) below, the Grid Charter (tier 3) above: while one is owned, every upgrade it
//     keeps (and the rung itself) is granted again the moment a new city is founded.
// index.js listens for the prestige event and re-owns all of them, at no cost, so the
// mayor starts the replay at the decisions that matter (tier 4 and the frontier).
// `keptUpgradeIds` is the pure rule so it can be tested without a game.
const isCore = (def) => !def.frontier && !def.pace && def.category !== 'prestige' && def.currency !== 'legacy';
export const isPermanent = (def) => !!def && def.currency === 'legacy';

export function keptUpgradeIds(ownedIds, defs = UPGRADES) {
  const owned = new Set(ownedIds || []);
  const out = new Set();
  for (const def of defs) if (owned.has(def.id) && isPermanent(def)) out.add(def.id);
  for (const keeper of defs) {
    if (typeof keeper.keeps !== 'function' || !owned.has(keeper.id)) continue;
    out.add(keeper.id);
    for (const def of defs) if (def.id !== keeper.id && keeper.keeps(def) === true) out.add(def.id);
  }
  return [...out];
}

// ---------- definitions (grouped by phase: $25 → $2e7 core ladder, the pace and frontier ladders, Legacy, then the Charter) ----------

export const UPGRADES = [
  // ===== Early game ($25 – $3.5k): first ten minutes =====
  {
    id: 'welcome-sign',
    name: 'Welcome Sign',
    icon: '🪧',
    desc: 'Population grows +50% faster',
    cost: 25,
    category: 'global',
    tier: 1,
    unlock: hasBuilt('house', 2),
    effect: global('growth', 1.5),
  },
  {
    id: 'zoning-reform',
    name: 'Zoning Reform',
    icon: '📐',
    desc: 'Houses hold +25% residents',
    // $75, not $50: the first $50 the opening spree leaves goes to the corner shop.
    cost: 75,
    category: 'residential',
    tier: 1,
    unlock: hasBuilt('house', 4),
    effect: housingOf('house', 1.25),
  },
  {
    id: 'neon-signage',
    name: 'Neon Signage',
    icon: '💡',
    desc: 'Shops earn +50% income',
    cost: 80,
    category: 'commercial',
    tier: 1,
    unlock: hasBuilt('shop', 3),
    effect: incomeOf('shop', 1.5),
  },
  {
    id: 'grant-writing',
    name: 'Grant Writing',
    icon: '✍️',
    desc: 'All income +25%',
    cost: 150,
    category: 'global',
    tier: 1,
    unlock: hasAnyUpgrade(),
    effect: global('income', 1.25),
  },
  {
    id: 'tax-software',
    name: 'Tax Software',
    icon: '🧾',
    desc: 'All income +25%',
    cost: 250,
    category: 'global',
    tier: 1,
    unlock: any(hasEarned(1000, 'money-1k'), hasPop(50)),
    effect: global('income', 1.25),
  },
  {
    id: 'turbine-blades',
    name: 'Carbon Turbine Blades',
    icon: '🌬️',
    desc: 'Windmills generate +100% power',
    cost: 300,
    category: 'power',
    tier: 1,
    unlock: hasBuilt('windmill', 2),
    // Plant-specific on purpose (same for Coal Scrubbers): a city-wide floor here (+5% /
    // +10% power) eased the first city's tier-4 brownouts enough to drop the session's
    // under-power share from 3.3% to 2.5%, under the 3% the power contract asks for.
    effect: powerOf('windmill', 2),
  },
  {
    id: 'smart-grid',
    name: 'Smart Grid',
    icon: '🔌',
    desc: 'All buildings use −20% power',
    cost: 250,
    category: 'power',
    tier: 1,
    // Three doors in: the Lights Out milestone (or a live brownout on an existing grid —
    // powerCap > 0 so the first cottage on an empty plot does not unlock it at t=0), a
    // sizeable windmill fleet, or 40 MW of demand — a mayor who keeps the lights on still
    // gets to buy it.
    unlock: any(
      rule((state, derived) => milestone(state, 'brownout') || (!!derived && derived.powerCap > 0 && derived.powerRatio < 1), 'Suffer a brownout'),
      hasBuilt('windmill', 6),
      hasDemand(40)
    ),
    unlockAt: { powerDemand: 40 },
    effect: global('demand', 0.8),
  },
  {
    id: 'community-events',
    name: 'Community Events',
    icon: '🎪',
    desc: 'Happiness +10% and population grows +25% faster',
    cost: 500,
    category: 'civic',
    tier: 1,
    unlock: hasBuilt('park', 1),
    // Paired like the other civic rungs: at the h≈0.85 it unlocks at, +0.1 happiness alone
    // is ~+6% income — the growth term is what makes the first park a decision.
    effect: compose(happier(0.1), global('growth', 1.25)),
  },
  {
    id: 'assembly-lines',
    name: 'Assembly Lines',
    icon: '⚙️',
    desc: 'Factories earn +75% income',
    cost: 600,
    category: 'industrial',
    tier: 1,
    unlock: hasBuilt('factory', 3),
    effect: incomeOf('factory', 1.75),
  },
  {
    id: 'franchising',
    name: 'Franchising',
    icon: '🏪',
    desc: 'Shops and offices provide +30% jobs',
    cost: 1200,
    category: 'commercial',
    tier: 2,
    unlock: any(hasPop(100, 'pop-100'), hasBuilt('office', 1)),
    effect: compose(jobsOf('shop', 1.3), jobsOf('office', 1.3)),
  },
  {
    id: 'green-belts',
    name: 'Green Belts',
    icon: '🌳',
    desc: 'Happiness +5% and population grows +25% faster',
    cost: 1500,
    category: 'civic',
    tier: 2,
    unlock: hasBuilt('park', 4),
    effect: compose(happier(0.05), global('growth', 1.25)),
  },
  {
    id: 'farmers-market',
    name: 'Farmers Market',
    icon: '🥕',
    desc: 'Shops earn +100% income',
    cost: 3000,
    category: 'commercial',
    tier: 2,
    unlock: hasBuilt('shop', 15),
    effect: incomeOf('shop', 2),
  },
  {
    id: 'grid-substations',
    name: 'Grid Substations',
    icon: '🗼',
    desc: 'All power generation +25%',
    cost: 3500,
    category: 'power',
    tier: 2,
    // Fills the minute-9 gap between the $1.5k and $6k rungs: opens as the coal plants
    // take over the grid, right when the second brownout is brewing.
    unlock: hasDemand(20),
    effect: global('power', 1.25),
  },

  // ===== Mid game ($6k – $800k): minutes 10 – 35 =====
  {
    id: 'high-density',
    name: 'High-Density Zoning',
    icon: '🏢',
    desc: 'Apartments hold +50% residents',
    cost: 6000,
    category: 'residential',
    tier: 2,
    unlock: hasBuilt('apartment', 5),
    effect: housingOf('apartment', 1.5),
  },
  {
    id: 'express-transit',
    name: 'Express Transit',
    icon: '🚇',
    desc: 'Population grows +50% faster',
    cost: 8000,
    category: 'global',
    tier: 2,
    unlock: hasPop(120),
    effect: global('growth', 1.5),
  },
  {
    id: 'coal-scrubbers',
    name: 'Coal Scrubbers',
    icon: '🏭',
    desc: 'Coal plants generate +50% power',
    cost: 12000,
    category: 'power',
    tier: 2,
    unlock: hasBuilt('coal', 3),
    effect: powerOf('coal', 1.5),
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    icon: '🌙',
    desc: 'Factories provide +50% jobs',
    cost: 15000,
    category: 'industrial',
    tier: 2,
    unlock: hasBuilt('factory', 6),
    effect: jobsOf('factory', 1.5),
  },
  {
    id: 'bulk-permits',
    name: 'Bulk Permits',
    icon: '📋',
    desc: 'All buildings cost −20%',
    cost: 25000,
    category: 'global',
    tier: 2,
    unlock: hasBuiltTotal(60),
    effect: global('cost', 0.8),
  },
  {
    id: 'container-port',
    name: 'Container Port',
    icon: '🚢',
    desc: 'Factories and refineries earn +50% income',
    cost: 45000,
    category: 'industrial',
    tier: 2,
    unlock: hasBuilt('factory', 20),
    effect: compose(incomeOf('factory', 1.5), incomeOf('refinery', 1.5)),
  },
  {
    id: 'tourism-board',
    name: 'Tourism Board',
    icon: '🗺️',
    desc: 'All income +25%',
    cost: 50000,
    category: 'global',
    tier: 2,
    unlock: hasPop(2000, 'pop-1k'),
    effect: global('income', 1.25),
  },
  {
    id: 'open-plan-offices',
    name: 'Open-Plan Offices',
    icon: '💼',
    desc: 'Offices earn +75% income',
    cost: 60000,
    category: 'commercial',
    tier: 2,
    unlock: hasBuilt('office', 5),
    effect: incomeOf('office', 1.75),
  },
  {
    id: 'regional-airport',
    name: 'Regional Airport',
    icon: '✈️',
    desc: 'All income +30%',
    cost: 85000,
    category: 'global',
    tier: 2,
    unlock: hasPop(3000),
    effect: global('income', 1.3),
  },
  {
    id: 'modern-curriculum',
    name: 'Modern Curriculum',
    icon: '🎓',
    desc: 'All jobs +25% and all income +8%',
    cost: 150000,
    category: 'civic',
    tier: 3,
    unlock: hasBuilt('school', 3),
    // An educated workforce fills more desks: jobs pay wages directly, and at the 3-school
    // mark (~minute 20) unemployment is the penalty a growing city feels most. The income
    // term replaces the +10% happiness this and Preventive Care used to add (≈ +6% income
    // between them in a replay, where Standing Orders re-grants both): +8% here keeps the
    // 12 h session on the balance builder's placement — +10% ends it a city early, +6% a
    // city late, and a replay's cash spikes then miss the rungs placed at their edge.
    effect: compose(global('jobs', 1.25), global('income', 1.08)),
  },
  {
    id: 'maintenance-contracts',
    name: 'Maintenance Contracts',
    icon: '🔧',
    desc: 'Building upkeep −25%',
    cost: 200000,
    category: 'global',
    tier: 3,
    unlock: any(
      rule((state, derived) => !!derived && derived.upkeep > 0, 'Run a building that charges upkeep'),
      hasBuilt('coal', 5),
      hasBuilt('solar', 1)
    ),
    effect: global('upkeep', 0.75),
  },
  {
    id: 'welcome-center',
    name: 'Welcome Center',
    icon: '🛂',
    desc: 'Population grows +100% faster',
    cost: 250000,
    category: 'global',
    tier: 3,
    unlock: hasPop(1000, 'pop-1k'),
    effect: global('growth', 2),
  },
  {
    id: 'solar-tracking',
    name: 'Sun-Tracking Arrays',
    icon: '☀️',
    desc: 'Solar farms generate +100% power',
    cost: 300000,
    category: 'power',
    tier: 3,
    unlock: hasBuilt('solar', 3),
    effect: powerOf('solar', 2),
  },
  {
    id: 'catalytic-crackers',
    name: 'Catalytic Crackers',
    icon: '🧪',
    desc: 'Refineries earn +100% income',
    cost: 500000,
    category: 'industrial',
    tier: 3,
    unlock: hasBuilt('refinery', 3),
    effect: incomeOf('refinery', 2),
  },
  {
    id: 'anchor-tenants',
    name: 'Anchor Tenants',
    icon: '🛍️',
    desc: 'Malls earn +100% income and provide +25% jobs',
    cost: 800000,
    category: 'commercial',
    tier: 3,
    unlock: hasBuilt('mall', 3),
    effect: compose(incomeOf('mall', 2), jobsOf('mall', 1.25)),
  },

  // ===== Late game ($120k – $2e7): the first city's tier 4 and the second city =====
  {
    id: 'prefab-construction',
    name: 'Prefab Construction',
    icon: '🏗️',
    desc: 'All buildings cost −20%',
    cost: 120000,
    category: 'global',
    tier: 3,
    unlock: hasEarned(1e6, 'money-1m'),
    effect: global('cost', 0.8),
  },
  {
    id: 'skyway-frames',
    name: 'Skyway Steel Frames',
    icon: '🌉',
    desc: 'Towers hold +50% residents',
    cost: 400000,
    category: 'residential',
    tier: 3,
    unlock: hasBuilt('tower', 10),
    effect: housingOf('tower', 1.5),
  },
  {
    id: 'digital-city-hall',
    name: 'Digital City Hall',
    icon: '🖥️',
    desc: 'All income +50%',
    cost: 1.3e6,
    category: 'global',
    tier: 3,
    unlock: hasPop(10000, 'pop-10k'),
    effect: global('income', 1.5),
  },
  {
    id: 'preventive-care',
    name: 'Preventive Care',
    icon: '🩺',
    desc: 'Population grows +75% faster',
    cost: 4e6,
    category: 'civic',
    tier: 3,
    unlock: hasBuilt('hospital', 2),
    // Healthy citizens draw newcomers: one honest growth term instead of a late +10%
    // happiness that was worth +3% income at the h≈1.9 this opens at.
    effect: global('growth', 1.75),
  },
  {
    id: 'breeder-reactors',
    name: 'Breeder Reactors',
    icon: '☢️',
    desc: 'Nuclear plants generate +100% power',
    cost: 2e7,
    category: 'power',
    tier: 4,
    unlock: hasBuilt('nuclear', 2),
    effect: powerOf('nuclear', 2),
  },

  // ===== Pace ladder ($90M – $344T): one rung per replay city, each opens once the city has earned 100× its price =====
  // In price (= city) order. Config places them by city (5 Championship Season · 7 Robotic
  // Assembly · 9 AI Governance · 12 Planetary Charter · 15 Megastructures · 16 Orbital Solar
  // · 18 Arcology Gardens · 20 Algorithmic Trading · 27 Superconductor Grid; "mid-city"
  // rungs land off plateau cash after the spree); the frontier rungs sit between them (see
  // FRONTIER above).
  pace({
    id: 'championship-season',
    name: 'Championship Season',
    icon: '🏆',
    desc: 'Stadiums earn +100% income and provide +100% jobs',
    cost: 9.04e7,
    category: 'civic',
    effect: compose(incomeOf('stadium', 2), jobsOf('stadium', 2)),
  }),
  pace({
    id: 'robotic-assembly',
    name: 'Robotic Assembly',
    icon: '🤖',
    desc: 'All industry earns +100% income: factories, refineries, campuses',
    cost: 3.05e8,
    category: 'industrial',
    effect: incomeOfEach(INDUSTRY, 2),
  }),
  pace({
    id: 'ai-governance',
    name: 'AI Governance',
    icon: '🧠',
    desc: 'All income +100%',
    cost: 1.12e9,
    category: 'global',
    effect: global('income', 2),
  }),
  pace({
    id: 'planetary-charter',
    name: 'Planetary Charter',
    icon: '🌍',
    desc: 'All income +150% and population grows +100% faster',
    cost: 7.36e9,
    category: 'global',
    effect: compose(global('income', 2.5), global('growth', 2)),
  }),
  pace({
    id: 'megastructures',
    name: 'Megastructures',
    icon: '🏙️',
    desc: 'All housing +100%',
    cost: 3.4e11,
    category: 'residential',
    effect: global('housing', 2),
  }),
  pace({
    id: 'orbital-solar',
    name: 'Orbital Solar',
    icon: '🛰️',
    desc: 'All power generation +200%',
    cost: 4.0e11,
    category: 'power',
    effect: global('power', 3),
  }),
  pace({
    id: 'arcology-gardens',
    name: 'Arcology Gardens',
    icon: '🌺',
    desc: 'Arcologies hold +100% residents and provide +50% jobs',
    cost: 1.05e12,
    category: 'residential',
    effect: compose(housingOf('arcology', 2), jobsOf('arcology', 1.5)),
  }),
  pace({
    id: 'algorithmic-trading',
    name: 'Algorithmic Trading',
    icon: '📈',
    desc: 'Financial districts earn +100% income',
    cost: 2.3e12,
    category: 'commercial',
    effect: incomeOf('financial', 2),
  }),
  pace({
    id: 'superconductor-grid',
    name: 'Superconductor Grid',
    icon: '🧲',
    desc: 'All buildings use −30% power',
    cost: 3.44e14,
    category: 'power',
    effect: global('demand', 0.7),
  }),

  // ===== Frontier ($2.2B – $26Qa, each opens at a quarter of its price earned this run) =====
  ...FRONTIER,

  // ===== Legacy (prestige) — unlocked by legacy points, paid in money each run =====
  {
    id: 'legacy-archive',
    name: 'Legacy Archive',
    icon: '📜',
    desc: 'All income +50%',
    cost: 1000,
    category: 'prestige',
    tier: 1,
    unlock: hasLegacy(1),
    effect: global('income', 1.5),
  },
  {
    id: 'founders-blueprints',
    name: "Founders' Blueprints",
    icon: '📘',
    desc: 'All buildings cost −20%',
    cost: 5000,
    category: 'prestige',
    tier: 2,
    unlock: hasLegacy(2),
    effect: global('cost', 0.8),
  },
  {
    id: 'veteran-planners',
    name: 'Veteran Planners',
    icon: '🎖️',
    desc: 'Population grows +100% faster and happiness +10%',
    cost: 12000,
    category: 'prestige',
    tier: 3,
    unlock: hasLegacy(3),
    effect: compose(global('growth', 2), happier(0.1)),
  },
  {
    id: 'dynasty-ledger',
    name: 'Dynasty Ledger',
    icon: '👑',
    desc: 'All income +50% × ∛legacy (+100% at 8 points, +500% at 1,000)',
    cost: 25000,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(5),
    // A cube-root curve instead of a capped line: it never goes flat, yet it stays inside
    // the late-game magnitudes (money ≤ 1e18, legacy ≤ 1e6 at 12 h) — ×1.85 when it opens
    // at 5 points, ×6 at a thousand, ×51 at the million-point ceiling — on top of the
    // simulation's own root of the bank and the charter perks' flat multipliers.
    effect: (mods, state) => {
      const pts = Math.max(0, Math.floor(legacy(state)));
      mods.income *= 1 + 0.5 * Math.cbrt(pts);
    },
  },
  {
    id: 'institutional-memory',
    name: 'Institutional Memory',
    icon: '🗃️',
    desc: 'Every tier 1–2 upgrade is yours from the day a new city is founded',
    cost: 3e7,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(10),
    keeps: (def) => isCore(def) && def.tier <= 2,
    effect: noEffect,
  },
  {
    id: 'city-archives',
    name: 'City Archives',
    icon: '📚',
    desc: 'Population grows +50% faster and all jobs +25%',
    cost: 5.18e7,
    category: 'prestige',
    tier: 3,
    // Lands mid-way through the fourth city (config prices it at $52M, off plateau cash):
    // the one replay between the Mint Charter and Championship Season that had nothing
    // new to buy. Growth and
    // jobs, not income: it is re-granted in every later city, and an income term here
    // compounds through thirty foundings (measured: +40% income turned the 12 h session
    // into 43 foundings and 1e7 legacy).
    unlock: hasLegacy(20),
    effect: compose(global('growth', 1.5), global('jobs', 1.25)),
  },
  {
    id: 'standing-orders',
    name: 'Standing Orders',
    icon: '📑',
    desc: 'Tier 3 and Legacy upgrades are yours from the day a city is founded',
    cost: 4.84e12,
    category: 'prestige',
    tier: 4,
    unlock: all(hasLegacy(50), owns('institutional-memory')),
    // Config prices it at $4.84T, the 21st city's novelty. Tier 3 has usually been kept by
    // the Grid Charter since city 6 by then (a `keeps` overlap is harmless: a rung is
    // granted once); what this adds is the six Legacy rungs.
    keeps: (def) => (isCore(def) && def.tier === 3) || def.category === 'prestige',
    effect: noEffect,
  },

  // ===== Charter — permanent perks bought with legacy points (◆ 3 … ◆ 76,488) =====
  ...CHARTER,
];

// ---------- hints: copy each rule's tag onto its definition ----------
for (const def of UPGRADES) NAME_OF[def.id] = def.name;
for (const def of UPGRADES) {
  const u = def.unlock;
  if (!def.unlockHint && u && typeof u.hint === 'string' && u.hint) def.unlockHint = u.hint.charAt(0).toUpperCase() + u.hint.slice(1);
  if (!def.unlockAt && u && u.at && typeof u.at === 'object') def.unlockAt = { ...u.at };
  if (!def.unlockHint) def.unlockHint = 'Grow the city';
}

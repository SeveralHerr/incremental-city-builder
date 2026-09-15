// UI unit tests for the DOM-free parts of src/ui: unlock announcer, text helpers, unlock
// progress mirrors, upgrade teaser selection, content lookups and milestone progress.
// Run: node src/ui/ui.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUnlockAnnouncer } from './announce.js';
import { powerChipText, popLine, unemploymentLevel, legacyBank, legacyCost, legacyPointBar, nameList, unlockProgress, unlockMeasure, unlockMetLabel, unlockFallbackHint, buildingLines, strainNow, teaserRungs, tradeCount, MODIFIER_HELP, happinessRows, happinessTotal, happinessHint, signedPct, foundingRule, LEGACY_GLYPH } from './text.js';
import { HAPPINESS_LIMITS } from '../resources/index.js';
import { isFramed, shouldOfferFullscreen, STORAGE_KEY } from './embed.js';
import { TEASERS } from './upgrades.js';
import { createRefreshGate } from './schedule.js';
import { tierTitle, nextTier, moodWord, EXTRA_CATEGORIES } from './content.js';
import { milestoneProgress, nextMilestones } from './milestones.js';
import { setNumFormat } from './dom.js';
import { MAX_VISIBLE } from './toast.js';
import { LANDMARKS, PLANE_FLIGHTS, PLANE_SPRITE } from './skyline.js';
import { UPGRADES } from '../upgrades/data.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e}`);
    process.exitCode = 1;
  }
}

// Manual clock + scheduler so bursts and quiet windows are deterministic.
function fakeTimers() {
  let t = 0;
  const queue = [];
  let seq = 0;
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const h = { id: ++seq, at: t + ms, fn };
      queue.push(h);
      return h;
    },
    cancel: (h) => {
      const i = queue.indexOf(h);
      if (i >= 0) queue.splice(i, 1);
    },
    advance(ms) {
      t += ms;
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= t) queue.shift().fn();
    },
  };
}

function announcer(overrides = {}) {
  const timers = fakeTimers();
  const flushed = [];
  const a = createUnlockAnnouncer({ delay: 350, suppressMs: 1500, now: timers.now, schedule: timers.schedule, cancel: timers.cancel, onFlush: (b) => flushed.push(b), ...overrides });
  return { a, timers, flushed };
}

const B = (id) => ({ id, name: id[0].toUpperCase() + id.slice(1), kind: 'building' });
const U = (id) => ({ id, name: id, currency: 'money' });

test('announcer batches a burst into one flush, keyed by id', () => {
  const { a, timers, flushed } = announcer();
  assert.equal(a.push('building', B('shop')), true);
  assert.equal(a.push('building', B('shop')), false, 'same id in one burst is dropped');
  assert.equal(a.push('building', B('windmill')), true);
  assert.equal(a.push('upgrade', U('zoning')), true);
  assert.deepEqual(a.pending(), { buildings: 2, upgrades: 1 });
  timers.advance(349);
  assert.equal(flushed.length, 0, 'nothing flushes before the delay');
  timers.advance(1);
  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0].buildings.map((d) => d.id), ['shop', 'windmill']);
  assert.deepEqual(flushed[0].upgrades.map((d) => d.id), ['zoning']);
  assert.deepEqual(a.pending(), { buildings: 0, upgrades: 0 });
});

test('announcer never announces an id twice in a session (later foundings re-latch)', () => {
  const { a, timers, flushed } = announcer();
  a.push('building', B('apartment'));
  timers.advance(400);
  assert.equal(flushed.length, 1);
  // Founding: the fresh plot re-emits the same unlock a few seconds later.
  a.suppress();
  timers.advance(2000);
  assert.equal(a.push('building', B('apartment')), false);
  assert.equal(a.push('building', B('apartment')), false);
  timers.advance(400);
  assert.equal(flushed.length, 1, 'no second toast for a known id');
  // A genuinely new id after the quiet window still toasts.
  assert.equal(a.push('building', B('tower')), true);
  timers.advance(400);
  assert.equal(flushed.length, 2);
  assert.deepEqual(flushed[1].buildings.map((d) => d.id), ['tower']);
});

test('announcer stays quiet for the window after load/prestige and drops the pending burst', () => {
  const { a, timers, flushed } = announcer();
  a.push('building', B('shop'));
  a.suppress(); // load lands while a burst is pending
  assert.equal(a.isSuppressed(), true);
  timers.advance(400);
  assert.equal(flushed.length, 0, 'pending burst was discarded');
  assert.equal(a.push('building', B('factory')), false, 'quiet window swallows unlocks');
  assert.equal(a.announced.has('b:factory'), true, 'but remembers them as seen');
  timers.advance(1200); // total 1600 > 1500
  assert.equal(a.isSuppressed(), false);
  assert.equal(a.push('upgrade', U('neon')), true);
  timers.advance(400);
  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0].upgrades.map((d) => d.id), ['neon']);
});

test('announcer ignores panel gates and malformed payloads', () => {
  const { a } = announcer();
  assert.equal(a.push('panel', { id: 'panel:power' }), false);
  assert.equal(a.push('building', null), false);
  assert.equal(a.push('building', {}), false);
  assert.deepEqual(a.pending(), { buildings: 0, upgrades: 0 });
});

test('announcer reset forgets announced ids', () => {
  const { a, timers } = announcer();
  a.push('building', B('shop'));
  timers.advance(400);
  a.reset();
  assert.equal(a.announced.size, 0);
  assert.equal(a.isSuppressed(), false);
  assert.equal(a.push('building', B('shop')), true);
});

test('toast stack holds at most two', () => {
  assert.equal(MAX_VISIBLE, 2);
});

test('power chip rounds capacity, demand and spare the same way', () => {
  const t = powerChipText(84.4, 80.2, 1);
  assert.equal(t.value, '84 / 80 MW');
  assert.equal(t.sub, '4 MW spare');
  assert.equal(t.short, '+4');
  const b = powerChipText(53.6, 72.4, 0.74);
  assert.equal(b.value, '54 / 72 MW');
  assert.equal(b.sub, 'brownout · 74% supplied');
  assert.equal(b.short, '74%');
  // Rounding never produces a phantom brownout or a negative spare.
  const edge = powerChipText(80.4, 80.2, 1);
  assert.equal(edge.value, '80 / 80 MW');
  assert.equal(edge.sub, '0 MW spare');
  const none = powerChipText(0, 0, 1);
  assert.equal(none.sub, 'no generation');
  assert.equal(none.short, '—');
  const big = powerChipText(2.5e6, 1.2e6, 1);
  assert.equal(big.value, '2.50M / 1.20M MW');
  assert.equal(big.sub, '1.30M MW spare');
  assert.equal(powerChipText(NaN, undefined, NaN).value, '0 / 0 MW');
});

test('unemployment tile levels', () => {
  assert.equal(unemploymentLevel(0.1), '');
  assert.equal(unemploymentLevel(0.25), '');
  assert.equal(unemploymentLevel(0.3), 'warn');
  assert.equal(unemploymentLevel(0.5), 'warn');
  assert.equal(unemploymentLevel(0.51), 'bad');
  assert.equal(unemploymentLevel(NaN), '');
});

test('legacy bank prefers the api, then the snapshot, then legacy − spent', () => {
  const state = { prestige: { legacy: 40, spent: 28 } };
  assert.deepEqual(legacyBank(state, { legacyAvailable: () => 12 }, null), { legacy: 40, spent: 28, available: 12 });
  assert.deepEqual(legacyBank(state, {}, { available: 9 }), { legacy: 40, spent: 28, available: 9 });
  assert.deepEqual(legacyBank(state, null, null), { legacy: 40, spent: 28, available: 12 });
  assert.deepEqual(legacyBank({ prestige: { legacy: 3, spent: 10 } }, null, null), { legacy: 3, spent: 10, available: 0 });
  assert.deepEqual(legacyBank({}, null, null), { legacy: 0, spent: 0, available: 0 });
  assert.deepEqual(legacyBank({ prestige: { legacy: NaN, spent: 'x' } }, { legacyAvailable: () => NaN }, {}), { legacy: 0, spent: 0, available: 0 });
});

test('legacy cost chip and name lists', () => {
  assert.equal(legacyCost(3), `${LEGACY_GLYPH} 3`);
  assert.equal(legacyCost(12500), `${LEGACY_GLYPH} 12,500`);
  assert.equal(legacyCost(undefined), `${LEGACY_GLYPH} 0`);
  assert.equal(nameList([B('a'), B('b'), B('c')]), 'A, B, C');
  assert.equal(nameList([B('a'), B('b'), B('c'), B('d')]), 'A, B and 2 more');
});

test('charter category is registered for the UI', () => {
  const c = EXTRA_CATEGORIES.find((x) => x.id === 'charter');
  assert.ok(c);
  assert.equal(c.color, '#f9a8d4');
});

test('money-priced legacy upgrades are labelled Heritage, distinct from ◆-priced Charter perks', () => {
  const heritage = EXTRA_CATEGORIES.find((x) => x.id === 'prestige');
  const charter = EXTRA_CATEGORIES.find((x) => x.id === 'charter');
  assert.ok(heritage && charter);
  assert.equal(heritage.name, 'Heritage');
  assert.notEqual(heritage.name, charter.name, 'two panels must not both say Legacy/Charter');
  assert.notEqual(heritage.color, charter.color, 'only ◆-priced items carry the prestige pink');
});

test('tier titles and mood words', () => {
  assert.equal(tierTitle(0), 'Hamlet');
  assert.equal(tierTitle(50), 'Village');
  assert.equal(tierTitle(4999), 'Town');
  assert.equal(tierTitle(5e5), 'Megalopolis');
  assert.equal(nextTier(0).title, 'Village');
  assert.equal(nextTier(1e6), null);
  assert.equal(moodWord(1.7), 'Euphoric');
  assert.equal(moodWord(0.95), 'Content');
  assert.equal(moodWord(0.2), 'Miserable');
  assert.equal(moodWord(NaN), 'Unknown');
});

test('milestone progress from ids, metrics and custom functions', () => {
  const state = { res: { pop: 250, money: 10 }, stats: { totalEarned: 5e4, prestiges: 0 }, buildings: { house: 4, shop: 6 }, upgrades: { a: true }, unlocks: {} };
  const derived = { powerRatio: 0.8 };
  assert.equal(milestoneProgress({ id: 'pop-1k' }, state, derived), 0.25);
  assert.equal(milestoneProgress({ id: 'money-100k' }, state, derived), 0.5);
  assert.equal(milestoneProgress({ id: 'buildings-100' }, state, derived), 0.1);
  assert.equal(milestoneProgress({ id: 'first-upgrade' }, state, derived), 1);
  assert.equal(milestoneProgress({ id: 'first-brownout' }, state, derived), 1);
  assert.equal(milestoneProgress({ id: 'x', metric: 'pop', target: 500 }, state, derived), 0.5);
  assert.equal(milestoneProgress({ id: 'x', progress: () => 7 }, state, derived), 1);
  assert.equal(milestoneProgress({ id: 'x', progress: () => { throw new Error('boom'); } }, state, derived), null);
  assert.equal(milestoneProgress({ id: 'mystery' }, state, derived), null);
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(nextMilestones(list, { unlocks: { 'm:a': true } }, 2).map((m) => m.id), ['b', 'c']);
});

test('unlock progress reads every unlockAt shape the content modules ship', () => {
  const state = {
    res: { money: 40, pop: 187.6 },
    stats: { totalEarned: 2.5e5, buildingsBuilt: 30 },
    buildings: { house: 3, shop: 0 },
    upgrades: { a: true, b: true, c: false },
    prestige: { legacy: 12, spent: 5 },
  };
  const derived = { powerDemand: 17, extra: { prestige: { available: 7 } } };
  const api = { legacyAvailable: () => 7 };
  assert.deepEqual(unlockProgress({ pop: 250 }, state, derived, api), { p: 187 / 250, label: '187 / 250', kind: 'pop' });
  assert.deepEqual(unlockProgress({ money: 75 }, state, derived, api), { p: 40 / 75, label: '$40 / $75', kind: 'money' });
  assert.deepEqual(unlockProgress({ earned: 5e5 }, state, derived, api), { p: 0.5, label: '$250,000 / $500,000 earned', kind: 'earned' });
  assert.deepEqual(unlockProgress({ building: 'house', count: 4 }, state, derived, api), { p: 0.75, label: '3 / 4 built', kind: 'building' });
  assert.deepEqual(unlockProgress({ building: 'shop', count: 15 }, state, derived, api), { p: 0, label: '0 / 15 built', kind: 'building' });
  assert.deepEqual(unlockProgress({ powerDemand: 34 }, state, derived, api), { p: 0.5, label: '17 / 34 MW', kind: 'powerDemand' });
  assert.deepEqual(unlockProgress({ powerDemand: 0.001 }, state, derived, api), { p: 1, label: 'ready', kind: 'powerDemand' });
  assert.equal(unlockProgress({ powerDemand: 0.001 }, state, { powerDemand: 0 }, api).label, '0 MW drawn');
  assert.deepEqual(unlockProgress({ legacy: 20 }, state, derived, api), { p: 0.6, label: `${LEGACY_GLYPH} 12 / 20`, kind: 'legacy' });
  // Spendable legacy: the api's figure wins over the derived snapshot and over legacy − spent;
  // a half-point threshold (cost × 0.5) rounds up in the label.
  assert.deepEqual(unlockProgress({ legacyAvailable: 62.5 }, state, derived, api), { p: 7 / 62.5, label: `${LEGACY_GLYPH} 7 / 63 spendable`, kind: 'legacyAvailable' });
  assert.equal(unlockProgress({ legacyAvailable: 10 }, state, derived, null).p, 0.7, 'falls back to the derived snapshot');
  assert.equal(unlockProgress({ legacyAvailable: 10 }, state, {}, null).p, 0.7, 'then to legacy − spent');
  assert.deepEqual(unlockProgress({ built: 60 }, state, derived, api), { p: 0.5, label: '30 / 60 built', kind: 'built' });
  assert.deepEqual(unlockProgress({ upgrades: 1 }, state, derived, api), { p: 1, label: '2 / 1 funded', kind: 'upgrades' });
  // Fusion mirrors {pop, legacy}: the first measurable door (pop) draws the bar.
  assert.equal(unlockProgress({ pop: 36000, legacy: 1 }, state, derived, api).kind, 'pop');
  // Progress clamps to [0, 1] and never leaks NaN.
  assert.equal(unlockProgress({ pop: 100 }, { res: { pop: 250 } }, {}, null).p, 1);
  assert.deepEqual(unlockProgress({ money: 50 }, { res: { money: NaN } }, {}, null), { p: 0, label: '$0 / $50', kind: 'money' });
});

test('unlock progress is null for missing, malformed or unmeasurable mirrors', () => {
  const state = { res: { money: 1, pop: 1 }, stats: {}, buildings: {}, upgrades: {}, prestige: {} };
  assert.equal(unlockProgress(undefined, state, {}, null), null);
  assert.equal(unlockProgress(null, state, {}, null), null);
  assert.equal(unlockProgress('pop', state, {}, null), null);
  assert.equal(unlockProgress({ upgrade: 'zoning-reform' }, state, {}, null), null, 'ownership flags have no bar');
  assert.equal(unlockProgress({ pop: 0 }, state, {}, null), null);
  assert.equal(unlockProgress({ pop: NaN, money: -5 }, state, {}, null), null);
  assert.equal(unlockProgress({ building: 7 }, state, {}, null), null);
  assert.equal(unlockProgress({ pop: 10 }, null, null, null).label, '0 / 10', 'no state at all still reads as zero');
});

test('teaser rungs: the cheapest locked money rungs, never owned, open, broken or ◆-priced', () => {
  const rows = [
    { id: 'open', cost: 10, unlocked: true, owned: false, currency: 'money', category: 'global' },
    { id: 'owned', cost: 5, unlocked: true, owned: true, currency: 'money', category: 'global' },
    { id: 'c', cost: 300, unlocked: false, owned: false, currency: 'money', category: 'power' },
    { id: 'a', cost: 75, unlocked: false, owned: false, currency: 'money', category: 'residential' },
    { id: 'broken', cost: 1, unlocked: false, owned: false, broken: true, currency: 'money', category: 'global' },
    { id: 'perk', cost: 3, unlocked: false, owned: false, currency: 'legacy', category: 'charter' },
    { id: 'b', cost: 80, unlocked: false, owned: false, currency: 'money', category: 'commercial' },
    { id: 'nan', cost: NaN, unlocked: false, owned: false, currency: 'money', category: 'global' },
    null,
  ];
  assert.equal(TEASERS, 2);
  assert.deepEqual(teaserRungs(rows, { count: TEASERS }).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(teaserRungs(rows, { count: 3 }).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(teaserRungs(rows, { count: 0 }), []);
  assert.deepEqual(teaserRungs(undefined), []);
});

test('teaser rungs keep Heritage (legacy-gated) rungs back until a founding is on the table', () => {
  const rows = [
    { id: 'legacy-archive', cost: 1000, unlocked: false, owned: false, currency: 'money', category: 'prestige' },
    { id: 'franchising', cost: 1200, unlocked: false, owned: false, currency: 'money', category: 'commercial' },
    { id: 'green-belts', cost: 1500, unlocked: false, owned: false, currency: 'money', category: 'civic' },
  ];
  assert.deepEqual(teaserRungs(rows, { count: 2 }).map((r) => r.id), ['franchising', 'green-belts']);
  assert.deepEqual(teaserRungs(rows, { count: 2, prestigeKnown: true }).map((r) => r.id), ['legacy-archive', 'franchising']);
});

test('fallback teaser hint is a sentence derived from the unlockAt mirror', () => {
  const nameOf = (id) => ({ shop: 'Corner shop' })[id] || '';
  assert.equal(unlockFallbackHint({ pop: 1000 }), 'Reach 1,000 citizens');
  assert.equal(unlockFallbackHint({ money: 80 }), 'Hold $80');
  assert.equal(unlockFallbackHint({ earned: 5e5 }), 'Earn $500,000 in total');
  assert.equal(unlockFallbackHint({ building: 'shop', count: 3 }, nameOf), 'Build 3 × Corner shop');
  assert.equal(unlockFallbackHint({ building: 'mill' }, nameOf), 'Build 1 × mill');
  assert.equal(unlockFallbackHint({ powerDemand: 0.001 }), 'Draw any power');
  assert.equal(unlockFallbackHint({ powerDemand: 5 }), 'Draw 5 MW');
  assert.equal(unlockFallbackHint({ legacy: 2.2 }), `Bank ${LEGACY_GLYPH} 3 legacy`);
  assert.equal(unlockFallbackHint({ legacyAvailable: 4 }), `Hold ${LEGACY_GLYPH} 4 spendable legacy`);
  assert.equal(unlockFallbackHint({ built: 25 }), 'Build 25 buildings in total');
  assert.equal(unlockFallbackHint({ upgrades: 6 }), 'Fund 6 upgrades');
  // Unmeasurable or missing mirrors fall back to the generic line rather than a broken sentence.
  const generic = 'Grow the city to reveal this idea.';
  assert.equal(unlockFallbackHint(null), generic);
  assert.equal(unlockFallbackHint({}), generic);
  assert.equal(unlockFallbackHint({ pop: -5 }), generic);
  assert.equal(unlockFallbackHint({ building: '' }), generic);
});

test('met teaser labels drop the treasury figure and tick the clause', () => {
  const state = { res: { money: 5e9, pop: 60000 }, stats: { totalEarned: 2e12, buildingsBuilt: 30 }, buildings: { coal: 3 }, upgrades: {}, prestige: {} };
  const derived = { powerDemand: 17 };
  const held = unlockMeasure({ money: 12000 }, state, derived, null);
  assert.equal(held.p, 1);
  assert.equal(unlockMetLabel(held), '$12,000 held ✓');
  assert.equal(unlockMetLabel(unlockMeasure({ earned: 5e5 }, state, derived, null)), '$500,000 earned ✓');
  assert.equal(unlockMetLabel(unlockMeasure({ building: 'coal', count: 3 }, state, derived, null)), '3 / 3 built ✓');
  assert.equal(unlockMetLabel(unlockMeasure({ powerDemand: 0.001 }, state, derived, null)), 'ready ✓');
  assert.equal(unlockMetLabel(unlockMeasure({ pop: 250 }, state, derived, null)), '60,000 / 250 ✓');
  assert.equal(unlockMetLabel(null), '');
  // A hint that is not yet met keeps the live figure.
  const open = unlockMeasure({ money: 1e10 }, state, derived, null);
  assert.ok(open.p < 1);
  assert.equal(unlockMetLabel(open), '$10.0B held ✓', 'the met label is the caller’s choice; it never reads p');
});

test('building card lines: synergy, grid strain and power hint from the def', () => {
  const def = {
    synergy: { stat: 'income', source: 'employed', per: 20000, cap: 2.5, text: ' Income +5% per 1,000 employed citizens (up to ×2.5) ' },
    demandGrowth: { per: 8, cap: 40, text: 'Grid strain: draw +12.5% per District owned (up to ×40)' },
    powerHint: 'Draws 10,200 MW ≈ 0.8 × Nuclear Plant',
  };
  assert.deepEqual(buildingLines(def), {
    synergy: 'Income +5% per 1,000 employed citizens (up to ×2.5)',
    strain: 'Grid strain: draw +12.5% per District owned (up to ×40)',
    power: 'Draws 10,200 MW ≈ 0.8 × Nuclear Plant',
  });
  // A strain rule without a sentence, a malformed synergy and a missing hint all read as ''.
  assert.deepEqual(buildingLines({ demandGrowth: { per: 40, cap: 1.5 }, synergy: 'nope', powerHint: 7 }), { synergy: '', strain: '', power: '' });
  assert.deepEqual(buildingLines({}), { synergy: '', strain: '', power: '' });
  assert.deepEqual(buildingLines(null), { synergy: '', strain: '', power: '' });
});

test('strain suffix: the live/base draw ratio, blank for one unit, marked at the cap', () => {
  assert.equal(strainNow(6500, 6500, 40), '', 'a single unit draws its sticker');
  assert.equal(strainNow(6500 * 1.004, 6500, 40), '', 'rounding noise is not a strain');
  assert.equal(strainNow(6500 * 3.125, 6500, 40), '×3.1 now');
  assert.equal(strainNow(6500 * 1.1, 6500, 1.5), '×1.1 now');
  assert.equal(strainNow(6500 * 12.4, 6500, 40), '×12 now', 'whole numbers from ×10');
  assert.equal(strainNow(6500 * 40, 6500, 40), '×40 now (cap)');
  assert.equal(strainNow(6500 * 1.5, 6500, 1.5), '×1.5 now (cap)', 'the data.js fallback cap');
  // Garbage from a missing module reads as nothing, never NaN.
  assert.equal(strainNow(undefined, 6500, 40), '');
  assert.equal(strainNow(6500, 0, 40), '');
  assert.equal(strainNow(NaN, NaN), '');
});

test('refresh gate: full passes only when the tick advanced, an event landed, or the safety net fires', () => {
  const g = createRefreshGate({ every: 30 });
  // First frame draws and rebuilds.
  assert.deepEqual(g.next({ tick: 0, frame: 1 }), { refresh: true, rebuild: true });
  // Same tick, no events: nothing but the tweens.
  assert.deepEqual(g.next({ tick: 0, frame: 2 }), { refresh: false, rebuild: false });
  assert.deepEqual(g.next({ tick: 0, frame: 3 }), { refresh: false, rebuild: false });
  // The simulation ticked.
  assert.deepEqual(g.next({ tick: 1, frame: 4 }), { refresh: true, rebuild: false });
  assert.deepEqual(g.next({ tick: 1, frame: 5 }), { refresh: false, rebuild: false });
  // A tap changed money outside a tick.
  g.mark();
  assert.deepEqual(g.next({ tick: 1, frame: 6 }), { refresh: true, rebuild: false });
  assert.deepEqual(g.next({ tick: 1, frame: 7 }), { refresh: false, rebuild: false });
  // A purchase rebuilds the lists (and refreshes).
  g.dirty();
  assert.equal(g.isDirty(), true);
  assert.deepEqual(g.next({ tick: 1, frame: 8 }), { refresh: true, rebuild: true });
  assert.equal(g.isDirty(), false);
  assert.deepEqual(g.next({ tick: 1, frame: 9 }), { refresh: false, rebuild: false });
  // Safety net every 30 frames.
  assert.deepEqual(g.next({ tick: 1, frame: 30 }), { refresh: true, rebuild: true });
  assert.deepEqual(g.next({ tick: 1, frame: 31 }), { refresh: false, rebuild: false });
  // At 60 fps and 10 ticks/s, roughly one frame in six does the full pass.
  const h = createRefreshGate({ every: 30 });
  let full = 0;
  for (let f = 1; f <= 600; f++) if (h.next({ tick: Math.floor(f / 6), frame: f }).refresh) full++;
  assert.ok(full >= 100 && full <= 125, `full passes in 600 frames: ${full}`);
  // No safety net when `every` is off.
  const k = createRefreshGate({ every: 0 });
  k.next({ tick: 0, frame: 1 });
  assert.deepEqual(k.next({ tick: 0, frame: 30 }), { refresh: false, rebuild: false });
});

// Stat tiles size their grid from the panel, not the viewport: a min-width: 1400px rule left
// 1366/1280/1180-wide desktops with a 4×2 + orphan City stats grid and a lone 'Income bonus'.
test('stat panels are size containers with a 3-across rule and an orphan-span fallback', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const stats = css.slice(css.indexOf('/* Stats */'), css.indexOf('\n.stat {'));
  assert.match(stats, /\.panel-prestige,\s*\.panel-stats\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*stats;/);
  assert.match(stats, /@container stats \(min-width: 352px\)\s*\{\s*\.stat-grid\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(stats, /@container stats \(max-width: 351\.98px\)\s*\{\s*\.stat-grid > \.stat:last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1 \/ -1;/);
  assert.doesNotMatch(stats, /@media \(min-width: 1400px\)/);
});


// A rewrite once deleted the --c-* category block from :root and left 23 references behind:
// every one of those declarations silently dropped, so the 'Found a new city' button looked
// identical whether or not founding was available. A token used without a fallback must exist.
test('no rule uses a custom property that nothing defines', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  // A var() with a fallback is fine: those are the handful of properties JS sets at runtime
  // (--accent per category, --sk-night / --sk-top from the day cycle, animation timings).
  const missing = new Set();
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/gi)) if (!m[2] && !defined.has(m[1])) missing.add(m[1]);
  assert.deepEqual([...missing], [], 'custom properties used with no definition and no fallback');
  // The category colours in particular: content.js paints cards and the skyline from them.
  for (const c of ['residential', 'commercial', 'industrial', 'power', 'civic', 'global', 'prestige', 'general']) {
    assert.ok(defined.has('--c-' + c), `--c-${c} must be defined in :root`);
  }
});

// (The stage layout's 'the document never scrolls' test lived here. It asserted that
// html/body/#app stay overflow:hidden at EVERY width so that <iframe scrolling="no"> — which
// freezes the framed document's viewport against wheel and touch — could never strand a
// control. That is not true of this layout and the test must not pretend otherwise: at the
// desktop sizes below, #app is capped at the viewport and the three columns are the scrollers,
// but `@media (max-width: 900px)` and `@media (max-height: 640px)` deliberately hand scrolling
// back to the document so the stacked single column can run past the viewport. Inside a short
// or narrow frame that is the F13 complaint, unchanged. Deleting a false assertion is not the
// fix; see docs/FEEDBACK.md F13.)
// The one part that still holds at desktop sizes, which is where the columns do the scrolling:
test('at desktop sizes #app is capped and the columns are the scrollers', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(css, /#app\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(css, /\n\.col\s*\{[^}]*overflow-y:\s*auto;/);
});

test('every skyline landmark is keyed by a real upgrade id', () => {
  const ids = new Set(UPGRADES.map((u) => u.id));
  for (const [id, lm] of Object.entries(LANDMARKS)) {
    assert.ok(ids.has(id), `landmark for unknown upgrade: ${id}`);
    assert.ok([0, 1, 2].includes(lm.depth), `${id}: depth must be a row index`);
    assert.equal(typeof lm.draw, 'function', `${id}: draw`);
  }
  assert.ok(Object.keys(LANDMARKS).length >= 8);
});

// Airport planes are occasional: every flight parks offscreen for most of its loop, cycles are
// distinct so the sky never settles into a pattern, and at least one flight heads west.
test('airport flights are staggered, distinct and park between crossings', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.sk-plane\s*\{[^}]*animation:\s*sk-plane var\(--dur, \d+s\) linear infinite;[^}]*animation-delay:\s*var\(--delay/);
  assert.match(css, /@keyframes sk-plane\s*\{\s*0%[\s\S]*?22%[\s\S]*?22\.01%,\s*100%/);
  assert.ok(PLANE_FLIGHTS.length >= 3);
  assert.equal(new Set(PLANE_FLIGHTS.map((f) => f.dur)).size, PLANE_FLIGHTS.length);
  assert.ok(PLANE_FLIGHTS.every((f) => f.dur >= 120 && f.delay >= 0 && f.scale > 0));
  assert.ok(PLANE_FLIGHTS.some((f) => f.west));
});

// F12: the "next legacy point" bar measures the current segment (prevAt → nextAt), not 0 →
// nextAt, so it never pins full late in a run; without prevAt it keeps the old reading.
test('legacy point bar runs from the last point to the next', () => {
  // Late game: point 415 landed at $1,000 of this run, 416 lands at $1,100; $1,064 earned.
  const late = legacyPointBar({ earned: 1064, nextAt: 1100, prevAt: 1000, legacy: 400, gain: 15 });
  assert.equal(late.segment, true);
  assert.ok(Math.abs(late.p - 0.64) < 1e-9, `segment fill 64%, got ${late.p}`);
  assert.equal(late.point, 415);
  assert.equal(late.nextPoint, 416);
  assert.equal(late.from, 1000);
  // The old reading of the same moment would have been 97%: that is the bug.
  assert.ok(Math.abs(legacyPointBar({ earned: 1064, nextAt: 1100 }).p - 1064 / 1100) < 1e-9);
  assert.equal(legacyPointBar({ earned: 1064, nextAt: 1100 }).segment, false);
  // Clamped 0..1 at both ends of the segment.
  assert.equal(legacyPointBar({ earned: 900, nextAt: 1100, prevAt: 1000 }).p, 0);
  assert.equal(legacyPointBar({ earned: 1100, nextAt: 1100, prevAt: 1000 }).p, 1);
  assert.equal(legacyPointBar({ earned: 5000, nextAt: 1100, prevAt: 1000 }).p, 1);
  // First point of a run: prevAt is 0 and the segment starts at 0.
  const first = legacyPointBar({ earned: 250, nextAt: 1000, prevAt: 0, legacy: 0, gain: 0 });
  assert.equal(first.segment, true);
  assert.equal(first.p, 0.25);
  assert.equal(first.point, 0);
  assert.equal(first.nextPoint, 1);
  // Garbage never draws a bar: NaN / negative / Infinity fall to 0, and a prevAt at or past
  // nextAt (an inconsistent snapshot) falls back to the 0 → nextAt reading.
  assert.equal(legacyPointBar({ earned: NaN, nextAt: 100, prevAt: 10 }).p, 0);
  assert.equal(legacyPointBar({ earned: 50, nextAt: Infinity, prevAt: 10 }).p, 0);
  assert.equal(legacyPointBar({ earned: 50, nextAt: 100, prevAt: 100 }).segment, false);
  assert.equal(legacyPointBar({ earned: 50, nextAt: 100, prevAt: -5 }).segment, false);
  assert.equal(legacyPointBar().p, 0);
});

// F15: planes fly nose first. The keyframes carry a flight left to right (x rises from the
// 0% frame to the 22% frame), so the sprite's nose must be its +x extreme, the wings and
// tailplane must sweep back from it, and the beacon must ride the tail, not the nose.
test('airport planes fly nose first', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const kf = css.match(/@keyframes sk-plane\s*\{([\s\S]*?)\n\}/)[1];
  const at = (pct) => {
    const m = kf.match(new RegExp(pct + '%\\s*\\{[^}]*translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)'));
    assert.ok(m, `keyframe ${pct}%`);
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  assert.ok(at(0).x < 0 && at(22).x > 480, 'a crossing starts off the left edge and ends off the right');
  const xs = (d) => [...d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const P = PLANE_SPRITE;
  assert.equal(Math.max(...xs(P.fuselage)), P.noseX, 'the nose is the fuselage tip on the +x side');
  assert.equal(Math.min(...xs(P.fuselage)), P.tailX);
  for (const key of ['wingTop', 'wingBottom', 'tailTop', 'tailBottom']) {
    const [rootA, tipA, tipB, rootB] = xs(P[key]);
    assert.ok(Math.max(tipA, tipB) < Math.min(rootA, rootB), `${key} sweeps back (tips behind the root)`);
  }
  assert.ok(P.beacon.cx < Math.min(...xs(P.wingTop)), 'the beacon rides the tail');
  assert.ok(Math.min(...xs(P.cockpit)) > Math.max(...xs(P.wingTop)), 'the cockpit sits ahead of the wings');
});

// F14: the ×1 / ×10 / Max segment applies to Sell, Shift = ×10 and Ctrl / ⌘ = Max override it
// for one click, and a sell never goes below zero owned.
test('trade count: the segment serves buy and sell, modifiers override, sell floors at zero', () => {
  // Buy follows the segment; Max is whatever core said is affordable.
  assert.deepEqual(tradeCount({ mode: 1, affordable: 99 }), { n: 1, amount: 1, all: false });
  assert.deepEqual(tradeCount({ mode: 10, affordable: 99 }), { n: 10, amount: 10, all: false });
  assert.deepEqual(tradeCount({ mode: 'max', affordable: 37 }), { n: 37, amount: 'max', all: false });
  assert.equal(tradeCount({ mode: 'max', affordable: 0 }).n, 0, 'nothing affordable buys nothing');
  // Sell obeys the same segment, clipped to what is owned.
  assert.deepEqual(tradeCount({ mode: 1, sell: true, owned: 7 }), { n: 1, amount: 1, all: false });
  assert.deepEqual(tradeCount({ mode: 10, sell: true, owned: 7 }), { n: 7, amount: 10, all: true });
  assert.deepEqual(tradeCount({ mode: 10, sell: true, owned: 25 }), { n: 10, amount: 10, all: false });
  assert.deepEqual(tradeCount({ mode: 'max', sell: true, owned: 25 }), { n: 25, amount: 'max', all: true });
  assert.deepEqual(tradeCount({ mode: 'max', sell: true, owned: 0 }), { n: 0, amount: 'max', all: false });
  assert.equal(tradeCount({ mode: 1, sell: true, owned: 0 }).n, 0, 'none owned sells nothing');
  // Modifier keys: Shift = ×10, Ctrl / ⌘ = Max, Ctrl wins when both are down.
  assert.deepEqual(tradeCount({ mode: 1, shift: true, affordable: 99 }), { n: 10, amount: 10, all: false });
  assert.deepEqual(tradeCount({ mode: 1, ctrl: true, affordable: 42 }), { n: 42, amount: 'max', all: false });
  assert.equal(tradeCount({ mode: 1, shift: true, ctrl: true, affordable: 42 }).amount, 'max');
  assert.deepEqual(tradeCount({ mode: 1, sell: true, owned: 3, shift: true }), { n: 3, amount: 10, all: true });
  assert.deepEqual(tradeCount({ mode: 10, sell: true, owned: 300, ctrl: true }), { n: 300, amount: 'max', all: true });
  // Garbage reads as ×1 / nothing owned; a fractional count floors.
  assert.deepEqual(tradeCount({ mode: NaN, owned: 'x', affordable: -4 }), { n: 1, amount: 1, all: false });
  assert.equal(tradeCount({ mode: 'max', sell: true, owned: 4.7 }).n, 4);
  assert.equal(tradeCount().n, 1);
  // The rule the tooltips and Settings print names both keys.
  assert.match(MODIFIER_HELP, /Shift/);
  assert.match(MODIFIER_HELP, /Ctrl/);
});

// F4: the City Hall happiness panel lists every term of derived.extra.happiness with its
// sign, sums to the total, says what it does to income, and hints from capReason.
test('happiness breakdown: every term signed, the clamp only when active, total and income factor', () => {
  // The worked example from the resources header (12 parks + 4 schools, 20 factories …).
  const hb = { base: 1, civic: 0.513, civicCap: 1.12, civicSaturation: 0.458, pollution: -0.193, pollutionCap: 1.1, unemployment: -0.035, overcrowd: 0, brownout: 0, mods: 0.1, raw: 1.385, clamp: 0, min: 0.25, max: 3, total: 1.385, incomeMult: 1.1925, capReason: 'pollution' };
  const rows = happinessRows(hb, { unemployment: 0.1 });
  assert.deepEqual(rows.map((r) => r.key), ['base', 'civic', 'pollution', 'unemployment', 'overcrowd', 'brownout', 'mods'], 'every term, formula order, no clamp row while it is idle');
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.base.value, 1);
  assert.equal(by.civic.value, 0.513);
  assert.equal(by.civic.note, '45% of the +112% cap');
  assert.equal(by.pollution.value, -0.193);
  assert.equal(by.pollution.note, 'at most -110%');
  assert.equal(by.unemployment.value, -0.035);
  assert.equal(by.unemployment.note, '10.0% jobless');
  assert.equal(by.overcrowd.value, 0);
  assert.equal(by.mods.value, 0.1);
  // The rows sum to the total (the panel's promise to the player).
  const sum = rows.reduce((a, r) => a + r.value, 0);
  assert.ok(Math.abs(sum - hb.total) < 1e-9, `rows sum to the total, got ${sum}`);
  const tot = happinessTotal(hb);
  assert.equal(tot.text, '138%');
  assert.equal(tot.incomeText, 'income ×1.19');
  // A drag reported with the wrong sign still prints as a drag; the clamp row appears when active.
  const pinned = happinessRows({ base: 1, civic: 2.5, pollution: 0.02, unemployment: 0, overcrowd: 0, brownout: 0, mods: 0.6, clamp: -1.08, min: 0.25, max: 3, total: 3 });
  assert.equal(pinned.find((r) => r.key === 'pollution').value, -0.02);
  const clamp = pinned.find((r) => r.key === 'clamp');
  assert.ok(clamp && clamp.value === -1.08);
  assert.equal(clamp.note, 'held within 25% – 300%');
  assert.ok(Math.abs(pinned.reduce((a, r) => a + r.value, 0) - 3) < 1e-9);
  // No snapshot at all still draws the shape (base 100 %, everything else 0).
  assert.equal(happinessRows(null).length, 7);
  assert.equal(happinessTotal(undefined).text, '100%');
  assert.equal(happinessTotal({ total: 0.5 }).incomeText, 'income ×0.75', 'falls back to 0.5 + 0.5 × happiness');
  // Signed percentages keep one decimal so a 1.5 % smog cost never rounds away.
  assert.equal(signedPct(0.513), '+51.3%');
  assert.equal(signedPct(-0.015), '-1.5%');
  assert.equal(signedPct(0), '0%');
  assert.equal(signedPct(-0.0001), '0%');
  assert.equal(signedPct(NaN), '—');
});

test('happiness hint: every capReason the resources module can emit has a line', () => {
  for (const reason of Object.values(HAPPINESS_LIMITS)) {
    assert.ok(happinessHint(reason).length > 20, `hint for '${reason}'`);
  }
  assert.match(happinessHint('civic cap'), /parks barely help/);
  assert.match(happinessHint('pollution'), /Smog is the biggest drag/);
  assert.match(happinessHint('max', { max: 3 }), /maximum \(300%\)/);
  assert.match(happinessHint('min', { min: 0.25 }), /minimum \(25%\)/);
  assert.equal(happinessHint('nonsense'), '');
  assert.equal(happinessHint(undefined), '');
});

// F13: the fullscreen chip shows only inside an iframe (or when tooling forces it), only
// while the browser can go fullscreen, and never once dismissed or already fullscreen.
test('fullscreen offer: framed or forced, not dismissed, not already full, browser able', () => {
  assert.equal(isFramed({ self: 1, top: 2 }), true);
  assert.equal(isFramed({ self: 1, top: 1 }), false);
  assert.equal(isFramed(null), false, 'no window at all (Node) is not a frame');
  const hostile = {};
  Object.defineProperty(hostile, 'top', { get() { throw new Error('cross-origin'); } });
  assert.equal(isFramed(hostile), true, 'a throwing top reads as framed');
  assert.equal(shouldOfferFullscreen({ framed: true }), true);
  assert.equal(shouldOfferFullscreen({ framed: false }), false, 'a top-level page is never asked');
  assert.equal(shouldOfferFullscreen({ framed: false, forced: true }), true, '?embed=1 forces it for tooling');
  assert.equal(shouldOfferFullscreen({ framed: true, dismissed: true }), false, 'dismissed stays dismissed');
  assert.equal(shouldOfferFullscreen({ framed: true, fullscreen: true }), false);
  assert.equal(shouldOfferFullscreen({ framed: true, canFullscreen: false }), false, 'no API, no chip');
  assert.equal(shouldOfferFullscreen(), false);
  assert.match(STORAGE_KEY, /^metropolis\./, 'namespaced localStorage key');
});

// F6: the founding rule in plain words — what a founding must bank (max(minGain, ceil(bank ×
// share))) and that the gate is on this city's earnings, never on the city count.
test('founding rule text: the +N gate as a share of the bank, and the earnings it takes', () => {
  // A 100-point mayor: the gate is ceil(100 × 0.4) = 40 points, this city has $2.5M of $7M.
  const mid = foundingRule({ gain: 12, minGain: 40, legacy: 100, share: 0.4, earned: 2.5e6, unlockAt: 7e6, can: false });
  assert.equal(mid.rule, `Founding needs +${LEGACY_GLYPH} 40 legacy (≥ 40% of your bank of ${LEGACY_GLYPH} 100).`);
  assert.match(mid.gate, /^That takes \$7\.00M earned in this city — \$4\.50M more\./);
  assert.match(mid.gate, /this city's earnings, never on how many cities you have founded/);
  assert.equal(mid.text, `${mid.rule} ${mid.gate}`);
  // Gate met: says so with the figures, keeps the "not the city count" line.
  const ready = foundingRule({ gain: 45, minGain: 40, legacy: 100, share: 0.4, earned: 8.2e6, unlockAt: 7e6, can: true });
  assert.equal(ready.rule, mid.rule);
  assert.match(ready.gate, /^This city has earned \$8\.20M, past the \$7\.00M gate\./);
  assert.match(ready.gate, /never on how many cities/);
  // First founding: no bank to take a share of, so no percentage clause.
  const first = foundingRule({ gain: 0, minGain: 1, legacy: 0, share: 0.4, earned: 5e5, unlockAt: 1.1e7 });
  assert.equal(first.rule, `Founding needs +${LEGACY_GLYPH} 1 legacy.`);
  assert.match(first.gate, /^That takes \$11\.0M earned in this city — \$10\.5M more\./);
  // A tiny bank whose share rounds up to the floor still reads as the resolved gate.
  assert.equal(foundingRule({ minGain: 1, legacy: 1, share: 0.4 }).rule, `Founding needs +${LEGACY_GLYPH} 1 legacy (≥ 40% of your bank of ${LEGACY_GLYPH} 1).`);
  // Garbage never prints NaN or a negative "more".
  const junk = foundingRule({ gain: NaN, minGain: -3, legacy: 'x', share: Infinity, earned: 9e6, unlockAt: 7e6, can: false });
  assert.doesNotMatch(junk.text, /NaN|-\$/);
  assert.match(junk.gate, /\$0 more/);
  assert.equal(foundingRule().rule, `Founding needs +${LEGACY_GLYPH} 1 legacy.`);
  // Right after a founding nothing is earned yet: "— $290M more" would only repeat the figure.
  const fresh = foundingRule({ gain: 0, minGain: 2, legacy: 5, share: 0.4, earned: 0, unlockAt: 2.9e8, can: false });
  assert.equal(fresh.rule, `Founding needs +${LEGACY_GLYPH} 2 legacy (≥ 40% of your bank of ${LEGACY_GLYPH} 5).`);
  assert.match(fresh.gate, /^That takes \$290M earned in this city\. The gate is on/);
  assert.doesNotMatch(fresh.gate, /more/);
  // The clause returns once the remainder is under 98 % of the gate; at the line it is still out.
  assert.doesNotMatch(foundingRule({ earned: 2.9e8 * 0.02, unlockAt: 2.9e8 }).gate, /more/);
  assert.match(foundingRule({ earned: 2.9e8 * 0.03, unlockAt: 2.9e8 }).gate, / — \$281M more\. /);
  // 'Found' is a verb; the noun is 'Founding'.
  assert.doesNotMatch(foundingRule({ legacy: 5, minGain: 2 }).text, /Found needs/);
});

// (The stage layout's '--sky-h' test lived here. It pinned .skyline-host's gradient strip
// against the height of the drawing below it — a seam that only existed while the skyline was
// full-bleed on a stage taller than the art. In this layout the city view is a fixed 16:9 box
// and the SVG fills it edge to edge, so there is no strip of sky to match and no token to hold
// two rules together. The component is gone, so the test goes with it.)

// '303,455 of 303,455 housing' wrapped to three lines inside the population chip on a 390px
// phone. The compact form is the short count over short housing.
test('population line: full wording on a wide chip, the short form where it is narrow', () => {
  assert.deepEqual(popLine(174, 174), { count: '174', sub: 'of 174 housing' });
  assert.deepEqual(popLine(1, 0), { count: '1', sub: 'citizen' });
  assert.deepEqual(popLine(120, 300), { count: '120', sub: 'citizens' }, 'plain wording until the town fills up');
  assert.deepEqual(popLine(303455, 303455, true), { count: '303K', sub: '/ 303K homes' });
  assert.deepEqual(popLine(1234567, 1234567, true), { count: '1.23M', sub: '/ 1.23M homes' });
  assert.deepEqual(popLine(303455, 303455, false), { count: '303,455', sub: 'of 303,455 housing' });
  // Not filling up: the short number format already abbreviates from a million; the full
  // format keeps the count exact on a phone until eight digits ('12,345,678 citizens' wraps).
  assert.deepEqual(popLine(1234567, 9e6, true), { count: '1.23M', sub: 'citizens' });
  setNumFormat('full');
  try {
    assert.deepEqual(popLine(1234567, 9e6, true), { count: '1,234,567', sub: 'citizens' });
    assert.deepEqual(popLine(12345678, 9e7, true), { count: '12.3M', sub: 'citizens' });
    assert.deepEqual(popLine(12345678, 9e7, false), { count: '12,345,678', sub: 'citizens' });
  } finally {
    setNumFormat('short');
  }
  // The housing test reads the real figure, the count the tweened one.
  assert.deepEqual(popLine(100, 300, true, 290), { count: '100', sub: '/ 300 homes' });
});

console.log(`ui tests: ${passed} passed${process.exitCode ? ', some FAILED' : ''}`);

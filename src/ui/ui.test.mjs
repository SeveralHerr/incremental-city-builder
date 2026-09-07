// UI unit tests for the DOM-free parts of src/ui: unlock announcer, text helpers, unlock
// progress mirrors, upgrade teaser selection, content lookups and milestone progress.
// Run: node src/ui/ui.test.mjs
import assert from 'node:assert/strict';
import { createUnlockAnnouncer } from './announce.js';
import { powerChipText, unemploymentLevel, legacyBank, legacyCost, nameList, unlockProgress, teaserRungs, LEGACY_GLYPH } from './text.js';
import { TEASERS } from './upgrades.js';
import { tierTitle, nextTier, moodWord, EXTRA_CATEGORIES } from './content.js';
import { milestoneProgress, nextMilestones } from './milestones.js';
import { MAX_VISIBLE } from './toast.js';

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

console.log(`ui tests: ${passed} passed${process.exitCode ? ', some FAILED' : ''}`);

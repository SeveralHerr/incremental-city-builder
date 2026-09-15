// Greedy bot player used by verify.mjs and economy-sim.mjs. DOM-free.
// Policy: fix the current bottleneck (power < housing < jobs < happiness), else best value/cost.
// A few human-like habits keep it out of the holes a pure greedy buyer falls into:
//   - it never walks the grid into a blackout inside one buying spree: purchases made this
//     step are counted against the grid locally at the strain-aware draw the tick will price
//     (derived only refreshes on the next tick), so once demand would pass capacity it buys
//     a generator, saves toward one, or waits for one to unlock (the windmill needs
//     powerDemand > 0 before it appears),
//   - during a brownout it saves toward the best MW/$ generator when that is within two
//     minutes of income, and adds no draw (and digs no coal) while it is further away — see
//     the note above greedyStep,
//   - while income is tiny (fresh plot, right after a prestige) it taps the city once per step,
//   - it resets only for a meaningful haul: at least `prestigeMin` legacy, and once a legacy
//     bank exists at least `prestigeScale` of it (a 100-point mayor waits for 25 more), so
//     late cycles go deep enough to exercise the tier-4 ladder instead of resetting every
//     minute on a fixed 5-point rule.
//   - (opt-in, saveSeconds > 0) it saves toward the next money upgrade it can see: once the cheapest unlocked, unowned
//     rung above its cash is within `saveSeconds` of income, it stops spending on buildings
//     that are not fixing a bottleneck (power, happiness) until the rung is bought, the way a
//     player eyes a card that is "almost there" instead of spamming cottages.
//
// Profiles (`botStep({ profile })`):
//   'greedy' (default) — the policy above; `saveSeconds` turns it into the sim's saver profile.
//   'human'            — plays the way the 2026-09-14 playtest did (docs/FEEDBACK.md F16):
//                        every lit-up card, homes → jobs → power to demand → civic as the
//                        exception, then "comparable amounts of everything" in ×Max batches;
//                        never saves, never sells, founds on the deep-push rule
//                        (humanShouldFound: haul ≥ foundShare × bank and no upgrade in reach).
//                        `guard: 'strain'` (default) sizes a draw batch at the grid strain the
//                        fleet will have after it; `guard: 'sticker'` is the round-1/2 booking
//                        (per-unit sticker × count), kept as the sim's control line only.
//                        See humanStep().
import { state, derived } from './state.js';
import { api } from './api.js';

export function botStep(opts = {}) {
  if (opts && opts.profile === 'human') return humanStep(opts);
  return greedyStep(opts);
}

// The greedy's grid rule (round 3 of the 2026-09-14 wave). Before it, the fix was "the
// cheapest generator": late in a 12 h session that is a coal plant at the same price as a
// fusion plant (the F8 knee prices a 200-unit coal fleet like a 150-unit fusion fleet) with
// 0.1 % of its output, and a bot that spends every step never holds the 30–40 s of income a
// fusion plant costs — so cities 20–27 sat at cap/demand 0.90–0.99 for 87–94 % of their
// minutes, digging coal (probe: 200 coal plants beside 180 nuclear, under-power 37 % of the
// session against the contract's 3–20 %). A player reads MW per dollar off the card. The rule
// now: the fix is the best MW/$ generator; while it is within GREEDY_GRID_SAVE_SECONDS of
// income the wallet waits for it (only a happiness fix goes ahead); further away, nothing that
// draws is bought and no generator under GREEDY_GRID_MIN_EFFECT of the fix's MW/$ either.
// Pending demand is booked at the strain-aware draw the tick will price (strainDrawOf), the
// same reading the human profile's guard uses, so a spree cannot walk the grid under 1.0
// inside a step; what is left under power is content — a demand step an upgrade adds
// (mods.demand × 1.08 / × 1.15) and the fresh plot's ramp — the same reason the human browns
// out (core.test "both profiles brown out on the same demand-step content").
const GREEDY_GRID_SAVE_SECONDS = 120;
const GREEDY_GRID_MIN_EFFECT = 0.5;

// Draw (mods excluded) `k` more units of `b` add once the tick re-prices the fleet under the
// grid-strain rule (buildings demandGrowth: powerUse = base × min(cap, 1 + (count − 1) / per)).
// `startCount` is the fleet the live per-unit figure was printed at; a building without the
// rule draws its sticker × k.
function strainDrawOf(b, k, startCount) {
  if (!(k > 0) || !(b.powerUse > 0)) return 0;
  const g = b.demandGrowth;
  if (!g || !(g.per > 0)) return b.powerUse * k;
  const cap = g.cap > 0 ? g.cap : Infinity;
  const factor = (c) => Math.min(cap, 1 + Math.max(0, c - 1) / g.per);
  const base = b.powerUse / factor(startCount[b.id] || 0);
  const fleet = (count) => (count > 0 ? base * factor(count) * count : 0);
  const owned = Number.isFinite(b.count) ? b.count : state.buildings[b.id] || 0;
  return fleet(owned + k) - fleet(owned);
}

function greedyStep({ maxBuys = 25, prestigeMin = 5, prestigeScale = 0.25, tapBelow = 1, saveSeconds = 0 } = {}) {
  let buys = 0;
  let bought = true;
  // Grid delta from purchases made this step (derived lags by one tick).
  let pendingDemand = 0;
  let pendingCap = 0;
  let startCount = { ...state.buildings };

  while (bought && buys < maxBuys) {
    bought = false;

    // Prestige when meaningful.
    const legacy = state.prestige && Number.isFinite(state.prestige.legacy) ? state.prestige.legacy : 0;
    const minGain = Math.max(prestigeMin, Math.ceil(legacy * prestigeScale));
    if (api.canPrestige() && api.prestigeGain() >= minGain) {
      if (api.prestige()) {
        buys++;
        pendingDemand = 0;
        pendingCap = 0;
        startCount = { ...state.buildings };
        continue;
      }
    }

    // Upgrades: cheapest affordable, unlocked. Legacy-priced charter perks first (they are a
    // separate currency and always worth taking), then money upgrades.
    const open = api.upgrades().filter((u) => u.unlocked && !u.owned);
    const perks = open.filter((u) => u.currency === 'legacy' && u.affordable).sort((a, b) => a.cost - b.cost);
    if (perks.length && api.buyUpgrade(perks[0].id)) {
      buys++;
      bought = true;
      continue;
    }
    const ups = open.filter((u) => u.currency !== 'legacy' && u.affordable).sort((a, b) => a.cost - b.cost);
    if (ups.length && api.buyUpgrade(ups[0].id)) {
      buys++;
      bought = true;
      continue;
    }
    // Saving: cheapest money rung above cash that is within reach.
    let saving = false;
    const income = Number.isFinite(derived.income) ? Math.max(0, derived.income) : 0;
    let nextRung = Infinity;
    for (const u of open) if (u.currency !== 'legacy' && u.cost > state.res.money && u.cost < nextRung) nextRung = u.cost;
    if (saveSeconds > 0 && Number.isFinite(nextRung) && nextRung <= state.res.money + income * saveSeconds) saving = true;

    const unlocked = api.buildings().filter((b) => b.unlocked);
    const demand = derived.powerDemand + pendingDemand;
    const cap = derived.powerCap + pendingCap;
    // Reacts to any shortfall: tolerating a 3 % flicker (< 0.97) was tried in the polish pass
    // and lowered the session's under-power share (2.9 % → 2.6 %) instead of raising it.
    let needPower = derived.powerRatio < 0.999 || (demand > 0 && demand > cap);
    const needHousing = state.res.pop >= derived.housing * 0.9;
    const needJobs = derived.jobs <= derived.employed * 1.05;
    const needHappy = derived.happiness < 0.9 && state.res.pop >= 15;

    const mods = derived.mods || null;
    const demandMod = mods && Number.isFinite(mods.demand) ? mods.demand : 1;
    const genModOf = (b) => (mods ? (Number.isFinite(mods.power) ? mods.power : 1) * (mods.byBuilding?.[b.id]?.power ?? 1) : 1);
    // MW per dollar as the card reads it (mods applied): the greedy's generator ranking.
    const effect = (b) => (b.powerGen > 0 && b.cost > 0 ? (b.powerGen * genModOf(b)) / b.cost : 0);
    // One more unit of `b` fits the grid as this step has changed it (an empty grid takes the
    // first cottage: the windmill only appears once something draws).
    const fits = (b) => !(b.powerUse > 0) || !(demand > 0) || strainDrawOf(b, 1, startCount) * demandMod <= cap - demand;

    const score = (b) => {
      let v = 0;
      if (needPower && b.powerGen > 0) v += 1000 * b.powerGen * genModOf(b);
      if (needHousing && b.housing > 0) v += 100 * b.housing;
      if (needJobs && b.jobs > 0) v += 60 * b.jobs;
      if (needHappy && b.happiness > 0) v += 3000 * b.happiness;
      // Generators keep a small base value even at surplus: zeroing it past 2× capacity was
      // tried (polish pass) — under-power moved 3.5 % → 3.6 % and cycle 16 went empty.
      v += b.income * 40 + b.housing * 3 + b.jobs * 3 + b.powerGen * 2 + (b.happiness || 0) * 50;
      if (b.powerUse > 0 && needPower) v *= 0.2;
      if (b.happiness < 0 && needHappy) v *= 0.3;
      return (v + 1) / b.cost;
    };
    const best = (rows) => rows.reduce((top, b) => (top === null || score(b) > score(top) ? b : top), null);

    let bs = unlocked.filter((b) => b.affordable);
    // The room check (round 3): the pick this step wants would trip the grid on the next tick
    // (one financial district at the ×40 strain cap draws 4.4e5 MW against a room of 1.5e5 —
    // the greedy walked itself under 1.0 once a minute that way, then saved 34 s for the plant,
    // 90 % of a late city at 0.998), so the grid is short for it: the generator comes first.
    if (!needPower && bs.length) {
      const want = best(bs);
      if (want && !fits(want)) needPower = true;
    }
    if (needPower) {
      // The fix is the best MW/$ generator (see the header). Within reach: save for it —
      // only a happiness fix goes ahead. Out of reach (or none unlocked yet: the windmill
      // needs powerDemand > 0): nothing that draws, and no generator that is not at least
      // half as effective as the fix (no coal digging beside a fusion plant).
      const gens = unlocked.filter((b) => b.powerGen > 0 && !b.maxed);
      const fix = gens.length ? gens.reduce((best, b) => (effect(b) > effect(best) ? b : best)) : null;
      // (A civic that draws — the stadium, 154,000 MW at the strain cap — is not a fix: it was
      // what kept the wallet at 2–3 s of income while the plant sat 34 s away, probe 2026-09-15.)
      if (fix && !fix.affordable && fix.cost <= state.res.money + income * GREEDY_GRID_SAVE_SECONDS) {
        bs = bs.filter((b) => needHappy && b.happiness > 0 && !(b.powerUse > 0));
      } else if (!fix || !fix.affordable) {
        const floor = fix ? effect(fix) * GREEDY_GRID_MIN_EFFECT : 0;
        bs = bs.filter((b) => !(b.powerUse > 0) && !(b.powerGen > 0 && effect(b) < floor));
      }
      // Whatever is bought while the grid is short must fit it.
      bs = bs.filter(fits);
    }
    if (saving) {
      // Only bottleneck fixes while saving for the rung.
      bs = bs.filter((b) => (needPower && b.powerGen > 0) || (needHappy && b.happiness > 0));
    }
    if (!bs.length) break;

    const pick = best(bs);
    if (api.buy(pick.id, 1)) {
      buys++;
      bought = true;
      pendingDemand += strainDrawOf(pick, 1, startCount) * demandMod;
      pendingCap += (pick.powerGen || 0) * genModOf(pick);
    }
  }

  // Tap the city while income is tiny (a player would): max($1, one second of income).
  if (derived.income < tapBelow) api.action('tap');
  return buys;
}

// ---------------------------------------------------------------- human profile
//
// What the playtester did (docs/FEEDBACK.md F2/F3/F16), as a policy. Third cut. The first made
// "category need" the primary rule with `pop ≥ 0.9·housing` as the housing trigger (true on
// every iteration once the population has filled its housing, which it does within a tick at
// this game's growth mods), so every step drained the wallet on the newest residential and the
// rotation never ran. The second checked a jobs floor (jobs ≥ 0.85 × projected pop) BEFORE
// housing and ended the step to save toward a jobs building when none was affordable — an
// anti-unemployment guard the player never had (FEEDBACK: "fills housing, then jobs, then
// power to demand", and bought every lit card), which pinned unemployment at 0 % and made the
// F3 cliff impossible by construction. This cut keeps the player's order and never saves:
//   1. buys every affordable, unlocked upgrade the moment it lights up, cheapest first (charter
//      perks too) — a human buys every card that lights up;
//   2. buildings: category need first, in the player's order, each judged on this step's own
//      purchases (pending housing / jobs / joy / demand / cap — derived only refreshes on the
//      next tick) but on the STALE population (the people who will move into homes bought this
//      step are not counted, so a housing batch is not matched by its jobs in the same step:
//      housing leads, the jobs follow when the people have arrived — or do not, if no jobs
//      building is affordable by then, which is the F3 signal):
//        housing   vacancy < 5 % of housing (an empty plot counts) → a residential, newest tier
//                  first, enough units to open the 5 %;
//        jobs      jobs < pop → a commercial / industrial (alternating), enough units to cover
//                  the jobless;
//        power     demand > 0.98 × cap → a generator, newest tier, enough units to put the grid
//                  1.2× ahead ("power to demand"; the player kept the grid ahead, Lights Out was
//                  "nearly unreachable"). While the grid is short and a generator exists but is
//                  out of reach, nothing that draws power is bought — the greedy bot's habit,
//                  and the one wait the player evidently did make;
//        civic     happiness < 1 → a civic;
//      then "comparable amounts of everything": a batch of the lowest-count affordable building
//      in the next category of residential → commercial → industrial → power → civic (generators
//      included, no demand cap: the player bought as many fusion plants as arcologies, which is
//      the F2 surplus). A need that no affordable building can serve is simply skipped — the
//      step never ends early to save for one, the wallet always goes somewhere.
//      Batches are the ×Max segment the screenshot shows (Buy ×8 / ×9): a rotation turn buys
//      what a fifth of the wallet (one category's share) affords, a need buys the units that
//      cover it up to that same share (the grid takes its full need); at least one unit either
//      way. Never sells.
//   3. founds a new city on the deep-push rule below (`foundShare` / `foundReachMinutes`): the
//      player pushed cities far past the gate (415 legacy in city 6 vs 30 for a found-at-the-gate
//      bot), so the profile waits until the haul would at least `foundShare` × the bank AND — when
//      `foundReachMinutes` > 0 — the city has run out of targets (no unlocked, unowned money
//      upgrade within that many minutes of income). Swept 2026-09-15 on both of the playtest
//      screenshot's observables (12 h, see the constants above humanShouldFound); the shipped
//      default is share 1.0 — "found once the haul would double the bank" — with the reach
//      check off, fitted to the screenshot's CLOCK (city 6 at 92 min) rather than its legacy;
//   4. taps while income is tiny, like the other profiles.
// Within a category the newest (highest tier) affordable building wins a need, cheapest on a
// tie; the rotation takes the lowest count (ties: newest). The rotation pointer and the jobs
// alternation persist across steps (module state; verify/sim drive one game per process).
// `trace(reason, row, n)` (optional) is called after every building batch with the rule that
// bought it — 'housing' | 'jobs' | 'power' | 'civic' | 'rotation' — so the sim can tell
// generators bought to cover demand from generators bought by the rotation (F2 attribution).
const CATEGORY_ROTATION = ['residential', 'commercial', 'industrial', 'power', 'civic'];
const HUMAN_POWER_TRIGGER = 0.98; // power need once demand > 0.98 × cap
const HUMAN_POWER_HEADROOM = 1.2; // ...and the fix puts the grid 1.2 × demand ahead
const HUMAN_VACANCY = 0.05; // housing need: fewer than 5 % of homes empty
// Deep-push founding rule (docs/FEEDBACK.md F16 / F1). The playtest screenshot is ONE frame and
// it carries TWO observables, and they disagree about how long a city lasts:
//   clock   the player is in CITY 6 at 92 min of playtime — ~15-min cities;
//   legacy  the player holds 415 legacy at the end of city 6, Megastructures owned there —
//           ~90-min cities, since legacy comes from lifetime earnings on exponent 0.488.
// Both cannot hold on this economy. The 2026-09-14 sweep fitted the rule to the legacy column
// alone and read share 2.0 off it; the clock column in the same screenshot went unread, and the
// result was a measuring instrument running 3× slow against the clock it claims to reproduce —
// which is what F1 (a wall-clock cadence line) is measured with. Re-swept 2026-09-15 on HEAD
// 1c3ebfa, 12 h, `node tools/economy-sim.mjs --ticks 432000 --profile human --found <rule>`,
// BOTH columns recorded this time, plus the F1(a) cadence gate the sweep exists to be judged by:
//   rule                        foundings  city @ 92 min   city-6 legacy   F1(a) cadence gate
//   share 0.1 reach 0 (gate)      27       city 6  (=6 ✓)  30   (×0.07)    PASS
//   share 1.0 reach 0 (double)    14       city 5  (−1)    80   (×0.19)    PASS
//   share 1.5 reach 0             10       city 4  (−2)    208  (×0.50)    FAIL c9 110.1 > 1.35× c8 75.6
//   share 2.0 reach 0 (triple)     8       city 4  (−2)    405  (×0.98)    FAIL c7 105.6, c8 164.1
//   share 3.0 reach 0              6       city 3  (−3)    1280 (×3.08)    FAIL c4 104.7, c6 164.4
// (reach-knob rows from the 2026-09-14 sweep, unchanged and still not picked: share 0.1 reach 20
// → 3 foundings, city 6 never; share 0.1 reach 5 → 6 foundings, city-6 legacy 87; share 1.0
// reach 20 → 2 foundings, city 6 never. "Out of targets" never fires at this income — some rung
// is always within minutes — so the reach knob only stretches cities and is left off.)
// The table is monotone: every rung that buys legacy spends clock, and the two columns cross
// between 1.0 and 1.5. The rule the pick is fitted to is the CLOCK, because F1 is a wall-clock
// contract and an instrument 3× off the clock cannot measure it; the selection rule is "the
// deepest push that still lands within one city of the player's clock AND keeps F1(a) on its
// ≤ 90-min branch", which is share 1.0 — 1.5 is the next rung up and fails F1(a) outright.
// What that costs, stated plainly so nobody re-reads it as free: the legacy observable drops
// from ×0.98 of the player to ×0.19, and Megastructures unassisted moves from city 7 to city 10
// (@ 324 min). F16's own finding — that a found-at-the-gate bot is not player-like — still
// stands and still rules out share 0.1: it holds 30 legacy (×0.07) and does not buy
// Megastructures on its own until city 19 @ 372 min. Share 1.0 is the compromise rung, not a
// dominating one.
const HUMAN_FOUND_SHARE = 1.0; // found once the haul would be ≥ this × the bank (0 = the game's gate)
const HUMAN_FOUND_REACH_MIN = 0; // ...and no unlocked, unowned money upgrade is within this many minutes of income (0 = ignore)
const human = { rotation: 0, jobsIndustrial: false };

// The deep-push founding decision (exported for tests and the sim): the game's own gate, then
// the haul against the bank, then the "out of targets" check — a player founds when the city
// has nothing left to aim at, not the moment the button lights up.
export function humanShouldFound({ prestigeMin = 5, foundShare = HUMAN_FOUND_SHARE, foundReachMinutes = HUMAN_FOUND_REACH_MIN } = {}) {
  if (!api.canPrestige()) return false;
  const legacy = state.prestige && Number.isFinite(state.prestige.legacy) ? state.prestige.legacy : 0;
  const share = Number.isFinite(foundShare) && foundShare > 0 ? foundShare : 0;
  const minGain = Math.max(prestigeMin, Math.ceil(legacy * share));
  if (api.prestigeGain() < minGain) return false;
  if (!(foundReachMinutes > 0)) return true;
  // Cheapest unlocked, unowned money upgrade: within reach → keep playing this city.
  let cheapest = Infinity;
  for (const u of api.upgrades()) {
    if (!u.unlocked || u.owned || u.currency === 'legacy') continue;
    if (u.cost < cheapest) cheapest = u.cost;
  }
  if (!Number.isFinite(cheapest)) return true; // no target left at all
  const money = Number.isFinite(state.res.money) ? state.res.money : 0;
  if (cheapest <= money) return false;
  const income = Number.isFinite(derived.income) ? derived.income : 0;
  if (!(income > 0)) return true; // nothing coming in: the target is unreachable
  return (cheapest - money) / income > foundReachMinutes * 60;
}

// Highest tier first, then cheapest.
function newestFirst(a, b) {
  return (b.tier || 0) - (a.tier || 0) || a.cost - b.cost;
}

// Per-unit multipliers derived applies to a building's stats (src/resources/index.js):
// demand → mods.demand (global only, never mods.power); the rest → global × byBuilding.
function humanMods(id) {
  const mods = derived.mods || null;
  const bb = mods?.byBuilding?.[id] || null;
  const pos = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
  const both = (k) => (mods ? pos(mods[k]) : 1) * (bb ? pos(bb[k]) : 1);
  return { demand: mods ? pos(mods.demand) : 1, power: both('power'), housing: both('housing'), jobs: both('jobs') };
}

function humanStep({ maxBuys = 25, prestigeMin = 5, foundShare = HUMAN_FOUND_SHARE, foundReachMinutes = HUMAN_FOUND_REACH_MIN, tapBelow = 1, trace = null, guard = 'strain' } = {}) {
  let buys = 0;
  let bought = true;
  const pending = { demand: 0, cap: 0, housing: 0, jobs: 0, joy: 0 };
  // The grid as this step has changed it (set per iteration below; read by buyBatch).
  let demand = 0;
  let cap = 0;
  // Draw (MW, mods applied) turned away by the grid this step; the power rule sizes its fix
  // for it and clears it once a generator batch is in.
  let refusedDraw = 0;
  // The draw `k` more units of `b` add, as a grid-ahead player reads it off the build card.
  // The card prints the per-unit Draw at the count owned when the tick last ran, the strain
  // rule under it ("Grid strain: draw +12.5% per Arcology owned (up to ×40)") and the CURRENT
  // fleet factor as "×N now" (src/ui/build.js:261-271, `bcard-strain-now`); a player who keeps
  // the grid ahead of the draw — the playtest's player did, Lights Out was "nearly unreachable"
  // — can therefore foresee what a batch of k units will draw once the tick re-evaluates the
  // fleet: base × factor(owned + k) × (owned + k) − base × factor(owned) × owned, base being the
  // sticker divided by the factor it was printed at (buildings demandGrowth: powerUse = base ×
  // min(cap, 1 + (count − 1) / per); the row's live powerUse is that product at the tick's
  // count, `startCount`, and pending purchases within the step move `b.count` but not the live
  // figure). That is the default guard ('strain', the round-1 second cut restored in round 3).
  // The decision behind it: the round-1/2 guard booked the sticker × count and let a ×Max spree
  // land at several times its booking on the next tick, and every Lights Out second the human
  // profile then latched (24 h: 136 42 22 10 2 2 4 2 0 74 0 2 s by city) was that blindness to
  // a rule the card shows — the same gate passed on the pre-wave content with that guard, so
  // the pass was the bot's, not the content's (round-1 skeptics 1 and 2). Under this guard the
  // milestone is earned only by a demand step the player did not choose to power: an upgrade's
  // draw clause (mods.demand × 1.08 on the mid-fleet employer rungs, × 1.15 on the Energy
  // Charter) raises every unit's draw at once, and both profiles then brown out for as long as
  // the cheapest generator is out of reach (core.test.mjs "both profiles brown out on the same
  // demand-step content"). `guard: 'sticker'` keeps the old booking for the sim's control line
  // (tools/economy-sim.mjs --guard sticker) so a round report can print the two side by side.
  // The strain-aware reading is strainDrawOf (shared with the greedy since round 3).
  const stickerGuard = guard === 'sticker';
  const startCount = { ...state.buildings };
  const drawOf = (b, k) => {
    if (!(k > 0) || !(b.powerUse > 0)) return 0;
    if (stickerGuard) return b.powerUse * k;
    return strainDrawOf(b, k, startCount);
  };

  // Units of `pick` that cover `need` stat points at `per` per unit; one when there is no need.
  const unitsFor = (need, per) => (per > 0 && need > 0 ? Math.ceil(need / per) : 1);
  // The ×Max segment on one category's share of the wallet; one unit when only the full wallet
  // covers it (the row is affordable, so at least one unit always is).
  const shareBatch = (pick) => Math.max(1, api.maxAffordable(pick, state.res.money / CATEGORY_ROTATION.length));
  // A need buys the units that cover it, but never more than one category's share of the
  // wallet: a full-wallet batch on a need would starve the rotation (the first cut's failure).
  const needBatch = (pick, need, per) => Math.min(unitsFor(need, per), shareBatch(pick));
  // Buy up to `n` units (≥ 1, never more than the wallet covers) and book their effects. A draw
  // batch must fit the grid as this step has already changed it — the player never KNOWINGLY
  // walked the city into a brownout — so it is trimmed to the units the capacity carries at
  // the draw the guard foresees (strain-aware by default, sticker under the control guard;
  // none: nothing is bought, the caller moves on) and the draw turned away is remembered for
  // the power rule. A demand step the tick adds on top (an upgrade's draw clause) is met by the
  // power rule on the next step, the way the player met a brownout: a plant. The first cottage
  // on an empty grid is the exception: the windmill only appears once something draws (same as
  // greedy).
  const buyBatch = (pick, n, reason) => {
    if (!pick) return false;
    n = Math.max(1, Math.min(Math.floor(n) || 1, api.maxAffordable(pick)));
    const m = humanMods(pick.id);
    const added = (k) => drawOf(pick, k) * m.demand;
    if (pick.powerUse > 0 && demand > 0) {
      const room = cap - demand;
      if (added(n) > room) {
        let lo = 0;
        let hi = n; // largest k with added(k) ≤ room (added is monotonic in k under both guards)
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (added(mid) <= room) lo = mid;
          else hi = mid - 1;
        }
        refusedDraw = Math.max(refusedDraw, added(n) - added(lo));
        n = lo;
        if (n <= 0) return false;
      }
    }
    if (!api.buy(pick.id, n)) return false;
    buys++;
    bought = true;
    pending.demand += added(n);
    pending.cap += (pick.powerGen || 0) * n * m.power;
    pending.housing += (pick.housing || 0) * n * m.housing;
    pending.jobs += (pick.jobs || 0) * n * m.jobs;
    pending.joy += Math.max(0, pick.happiness || 0) * n; // linear: optimistic, re-read next step
    if (typeof trace === 'function') trace(reason, pick, n);
    return true;
  };

  while (bought && buys < maxBuys) {
    bought = false;

    // 3. Found on the deep-push rule (humanShouldFound).
    if (humanShouldFound({ prestigeMin, foundShare, foundReachMinutes })) {
      if (api.prestige()) {
        buys++;
        for (const k of Object.keys(pending)) pending[k] = 0;
        refusedDraw = 0;
        continue;
      }
    }

    // 1. Every lit-up card, cheapest first (perks are a separate currency: cheapest perk, then
    // cheapest money upgrade).
    const open = api.upgrades().filter((u) => u.unlocked && !u.owned && u.affordable);
    const perks = open.filter((u) => u.currency === 'legacy').sort((a, b) => a.cost - b.cost);
    if (perks.length && api.buyUpgrade(perks[0].id)) {
      buys++;
      bought = true;
      continue;
    }
    const ups = open.filter((u) => u.currency !== 'legacy').sort((a, b) => a.cost - b.cost);
    if (ups.length && api.buyUpgrade(ups[0].id)) {
      buys++;
      bought = true;
      continue;
    }

    // 2. Buildings. This step's purchases are folded into every reading; the population is the
    // stale one (see the header: housing leads, the jobs follow the people, never the homes).
    const unlocked = api.buildings().filter((b) => b.unlocked && !b.maxed);
    const affordable = unlocked.filter((b) => b.affordable);
    const inCat = (cat) => affordable.filter((b) => b.category === cat).sort(newestFirst);
    const pop = state.res.pop;
    const housing = derived.housing + pending.housing;
    const jobs = derived.jobs + pending.jobs;
    demand = derived.powerDemand + pending.demand;
    cap = derived.powerCap + pending.cap;
    const joy = derived.happiness + pending.joy;

    // Housing: fewer than 5 % of homes empty (an empty plot counts).
    if (housing <= 0 || housing - pop < housing * HUMAN_VACANCY) {
      const res = inCat('residential').filter((b) => b.housing > 0)[0];
      if (res && buyBatch(res, needBatch(res, pop / (1 - HUMAN_VACANCY) - housing, res.housing * humanMods(res.id).housing), 'housing')) continue;
    }

    // Jobs: fewer than the people already here (a fresh plot has nobody to employ yet).
    if (pop > 0 && jobs < pop) {
      const first = human.jobsIndustrial ? 'industrial' : 'commercial';
      const second = human.jobsIndustrial ? 'commercial' : 'industrial';
      const jobsIn = (cat) => inCat(cat).filter((b) => b.jobs > 0);
      const pick = jobsIn(first)[0] || jobsIn(second)[0];
      if (pick && buyBatch(pick, needBatch(pick, pop - jobs, pick.jobs * humanMods(pick.id).jobs), 'jobs')) {
        human.jobsIndustrial = !human.jobsIndustrial;
        continue;
      }
    }

    // Power to demand: once the demand is within 2 % of the capacity, or a draw batch was turned
    // away above, a generator (newest tier) with enough units to put the grid 1.2× ahead of the
    // demand plus the draw that is waiting (what the wallet covers; a partial fix lets a smaller
    // batch through next iteration).
    if (demand > 0 && (demand > cap * HUMAN_POWER_TRIGGER || refusedDraw > 0)) {
      const gen = inCat('power').filter((b) => b.powerGen > 0)[0];
      const target = (demand + refusedDraw) * HUMAN_POWER_HEADROOM;
      if (gen && buyBatch(gen, unitsFor(target - cap, gen.powerGen * humanMods(gen.id).power), 'power')) {
        refusedDraw = 0;
        continue;
      }
    }

    // Happiness below 1.
    if (joy < 1) {
      const civ = inCat('civic').filter((b) => b.happiness > 0)[0];
      if (civ && buyBatch(civ, needBatch(civ, 1 - joy, civ.happiness), 'civic')) continue;
    }

    // Comparable amounts of everything: the lowest-count affordable building of the next
    // category (ties: newest), one category's share of the wallet; a category with nothing
    // affordable — or whose batch the grid cannot carry — passes its turn. No category is
    // skipped for being "enough": commercial / industrial are the income buildings, and the
    // player kept buying them past a jobs surplus (a "skip while jobs > 1.2 × pop" rule was
    // tried — the last cities of a 12 h run then bought nothing but arcologies, income went
    // flat and cycles ran 100–200 min).
    let turned = false;
    for (let i = 0; i < CATEGORY_ROTATION.length && !turned; i++) {
      const cat = CATEGORY_ROTATION[(human.rotation + i) % CATEGORY_ROTATION.length];
      const rows = inCat(cat);
      if (!rows.length) continue;
      rows.sort((a, b) => a.count - b.count || newestFirst(a, b));
      if (buyBatch(rows[0], shareBatch(rows[0]), 'rotation')) {
        human.rotation = (human.rotation + i + 1) % CATEGORY_ROTATION.length;
        turned = true;
      }
    }
    if (turned) continue;
    break;
  }

  // 4. Tap the city while income is tiny.
  if (derived.income < tapBelow) api.action('tap');
  return buys;
}

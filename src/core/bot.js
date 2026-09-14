// Greedy bot player used by verify.mjs and economy-sim.mjs. DOM-free.
// Policy: fix the current bottleneck (power < housing < jobs < happiness), else best value/cost.
// A few human-like habits keep it out of the holes a pure greedy buyer falls into:
//   - it never walks the grid into a blackout inside one buying spree: purchases made this
//     step are counted against the grid locally (derived only refreshes on the next tick),
//     so once demand would pass capacity it buys a generator, saves toward one, or waits for
//     one to unlock (the windmill needs powerDemand > 0 before it appears),
//   - during a brownout it saves toward the cheapest generator instead of adding more draw,
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
//                        never saves, never sells, founds as soon as allowed. See humanStep().
import { state, derived } from './state.js';
import { api } from './api.js';

export function botStep(opts = {}) {
  if (opts && opts.profile === 'human') return humanStep(opts);
  return greedyStep(opts);
}

function greedyStep({ maxBuys = 25, prestigeMin = 5, prestigeScale = 0.25, tapBelow = 1, saveSeconds = 0 } = {}) {
  let buys = 0;
  let bought = true;
  // Grid delta from purchases made this step (derived lags by one tick).
  let pendingDemand = 0;
  let pendingCap = 0;

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
    const needPower = derived.powerRatio < 0.999 || (demand > 0 && demand > cap);
    const needHousing = state.res.pop >= derived.housing * 0.9;
    const needJobs = derived.jobs <= derived.employed * 1.05;
    const needHappy = derived.happiness < 0.9 && state.res.pop >= 15;

    let bs = unlocked.filter((b) => b.affordable);
    if (needPower) {
      // Save toward the cheapest generator (or wait for one to unlock): nothing that draws
      // power until it is bought.
      const fix = unlocked.filter((b) => b.powerGen > 0 && !b.maxed).sort((a, b) => a.cost - b.cost)[0];
      if (!fix || !fix.affordable) bs = bs.filter((b) => !(b.powerUse > 0));
    }
    if (saving) {
      // Only bottleneck fixes while saving for the rung.
      bs = bs.filter((b) => (needPower && b.powerGen > 0) || (needHappy && b.happiness > 0));
    }
    if (!bs.length) break;

    const score = (b) => {
      let v = 0;
      if (needPower && b.powerGen > 0) v += 1000 * b.powerGen;
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
    bs.sort((a, b) => score(b) - score(a));
    const pick = bs[0];
    if (api.buy(pick.id, 1)) {
      buys++;
      bought = true;
      const mods = derived.mods || null;
      const demandMod = mods && Number.isFinite(mods.demand) ? mods.demand : 1;
      const genMod = mods ? (Number.isFinite(mods.power) ? mods.power : 1) * (mods.byBuilding?.[pick.id]?.power ?? 1) : 1;
      pendingDemand += (pick.powerUse || 0) * demandMod;
      pendingCap += (pick.powerGen || 0) * genMod;
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
//   3. founds a new city as soon as it is allowed and the haul is ≥ max(5, 10 % of the bank)
//      (the game's own gate, ceil(0.4 × bank), is the binding one — same cadence as greedy);
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
const human = { rotation: 0, jobsIndustrial: false };

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

function humanStep({ maxBuys = 25, prestigeMin = 5, prestigeScale = 0.1, tapBelow = 1, trace = null } = {}) {
  let buys = 0;
  let bought = true;
  const pending = { demand: 0, cap: 0, housing: 0, jobs: 0, joy: 0 };
  // The grid as this step has changed it (set per iteration below; read by buyBatch).
  let demand = 0;
  let cap = 0;
  // Draw (MW, mods applied) turned away by the grid this step; the power rule sizes its fix
  // for it and clears it once a generator batch is in.
  let refusedDraw = 0;
  // Counts at the last tick: a building row's live per-unit powerUse (the buildings module's
  // demandGrowth: draw = base × min(cap, 1 + (count − 1) / per), re-evaluated on the tick) was
  // computed at these counts, so the sticker draw is powerUse / factor(startCount).
  const startCount = { ...state.buildings };
  // Total draw of `count` units of `b` (mods excluded), with the grid-strain growth folded in:
  // every unit bought raises every unit's draw, and a spree of forty districts is a quarter
  // more demand than forty stickers — booked here so the grid guard sees it before the tick.
  const drawOf = (b, count) => {
    const per = b.powerUse || 0;
    if (!(count > 0) || !(per > 0)) return 0;
    const g = b.demandGrowth;
    if (!g || !(g.per > 0)) return per * count;
    const gcap = g.cap > 0 ? g.cap : Infinity;
    const f = (c) => Math.min(gcap, 1 + Math.max(0, c - 1) / g.per);
    return (per / f(startCount[b.id] || 0)) * f(count) * count;
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
  // batch must fit the grid as this step has already changed it — the player never walked the
  // city into a brownout — so it is trimmed to the units the capacity carries (none: nothing is
  // bought, the caller moves on) and the draw turned away is remembered for the power rule.
  // The first cottage on an empty grid is the exception: the windmill only appears once
  // something draws (same as greedy).
  const buyBatch = (pick, n, reason) => {
    if (!pick) return false;
    n = Math.max(1, Math.min(Math.floor(n) || 1, api.maxAffordable(pick)));
    const m = humanMods(pick.id);
    const added = (k) => (drawOf(pick, pick.count + k) - drawOf(pick, pick.count)) * m.demand;
    if (pick.powerUse > 0 && demand > 0) {
      const room = cap - demand;
      if (added(n) > room) {
        let lo = 0;
        let hi = n; // largest k with added(k) ≤ room (added is monotonic in k)
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

    // 3. Found as soon as allowed and the haul is meaningful.
    const legacy = state.prestige && Number.isFinite(state.prestige.legacy) ? state.prestige.legacy : 0;
    const minGain = Math.max(prestigeMin, Math.ceil(legacy * prestigeScale));
    if (api.canPrestige() && api.prestigeGain() >= minGain) {
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

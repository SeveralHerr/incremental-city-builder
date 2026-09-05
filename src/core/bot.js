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
import { state, derived } from './state.js';
import { api } from './api.js';

export function botStep({ maxBuys = 25, prestigeMin = 5, prestigeScale = 0.25, tapBelow = 1, saveSeconds = 0 } = {}) {
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
    const needPower = derived.powerRatio < 0.999 || (demand > 0 && demand > cap);
    const needHousing = state.res.pop >= derived.housing * 0.9;
    const needJobs = derived.jobs <= derived.employed * 1.05;
    const needHappy = derived.happiness < 0.9 && state.res.pop >= 15;

    let bs = unlocked.filter((b) => b.affordable);
    if (needPower) {
      // Save toward the cheapest generator (or wait for one to unlock): nothing that draws
      // power until it is bought.
      const fix = unlocked.filter((b) => b.powerGen > 0).sort((a, b) => a.cost - b.cost)[0];
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

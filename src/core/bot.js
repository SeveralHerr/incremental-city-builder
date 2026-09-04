// Greedy bot player used by verify.mjs and economy-sim.mjs. DOM-free.
// Policy: fix the current bottleneck (power < housing < jobs < happiness), else best value/cost.
// Two human-like habits keep it out of the early-game hole a pure greedy buyer falls into:
//   - during a brownout it saves toward the cheapest generator instead of adding more draw,
//   - while income is tiny (fresh plot, right after a prestige) it taps the city once per step.
import { state, derived } from './state.js';
import { api } from './api.js';

export function botStep({ maxBuys = 25, prestigeMin = 5, tapBelow = 1 } = {}) {
  let buys = 0;
  let bought = true;
  while (bought && buys < maxBuys) {
    bought = false;

    // Prestige when meaningful.
    if (api.canPrestige() && api.prestigeGain() >= prestigeMin) {
      if (api.prestige()) {
        buys++;
        continue;
      }
    }

    // Upgrades: cheapest affordable, unlocked.
    const ups = api
      .upgrades()
      .filter((u) => u.unlocked && !u.owned && u.affordable)
      .sort((a, b) => a.cost - b.cost);
    if (ups.length && api.buyUpgrade(ups[0].id)) {
      buys++;
      bought = true;
      continue;
    }

    const unlocked = api.buildings().filter((b) => b.unlocked);
    const needPower = derived.powerRatio < 0.999;
    const needHousing = state.res.pop >= derived.housing * 0.9;
    const needJobs = derived.jobs <= derived.employed * 1.05;
    const needHappy = derived.happiness < 0.9 && state.res.pop >= 15;

    let bs = unlocked.filter((b) => b.affordable);
    if (needPower) {
      // Save toward the cheapest generator: nothing that draws power until it is bought.
      const fix = unlocked.filter((b) => b.powerGen > 0).sort((a, b) => a.cost - b.cost)[0];
      if (fix && !fix.affordable) bs = bs.filter((b) => !(b.powerUse > 0));
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
    if (api.buy(bs[0].id, 1)) {
      buys++;
      bought = true;
    }
  }

  // Tap the city while income is tiny (a player would): max($1, one second of income).
  if (derived.income < tapBelow) api.action('tap');
  return buys;
}

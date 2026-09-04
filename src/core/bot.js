// Greedy bot player used by verify.mjs and economy-sim.mjs. DOM-free.
// Policy: fix the current bottleneck (power < housing < jobs), else best value/cost.
import { state, derived } from './state.js';
import { api } from './api.js';

export function botStep({ maxBuys = 25, prestigeMin = 5 } = {}) {
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

    const bs = api.buildings().filter((b) => b.unlocked && b.affordable);
    if (!bs.length) break;

    const needPower = derived.powerRatio < 0.999;
    const needHousing = state.res.pop >= derived.housing * 0.9;
    const needJobs = derived.jobs <= derived.employed * 1.05;

    const score = (b) => {
      let v = 0;
      if (needPower && b.powerGen > 0) v += 1000 * b.powerGen;
      if (needHousing && b.housing > 0) v += 100 * b.housing;
      if (needJobs && b.jobs > 0) v += 60 * b.jobs;
      v += b.income * 40 + b.housing * 3 + b.jobs * 3 + b.powerGen * 2 + (b.happiness || 0) * 50;
      if (b.powerUse > 0 && needPower) v *= 0.2;
      return (v + 1) / b.cost;
    };
    bs.sort((a, b) => score(b) - score(a));
    if (api.buy(bs[0].id, 1)) {
      buys++;
      bought = true;
    }
  }
  return buys;
}

// Modifier bag. Fresh each tick; upgrades/prestige/milestones fold into it.
// Multiplicative fields default to 1, additive (`happiness`) to 0.

export function createMods() {
  return {
    income: 1,
    housing: 1,
    jobs: 1,
    power: 1,
    growth: 1,
    happiness: 0,
    cost: 1,
    upkeep: 1,
    byBuilding: {}, // id -> { income, housing, jobs, power, cost }
  };
}

export function buildingMod(mods, id) {
  let m = mods.byBuilding[id];
  if (!m) m = mods.byBuilding[id] = { income: 1, housing: 1, jobs: 1, power: 1, cost: 1, happiness: 0 };
  return m;
}

// Validate a mods bag after folding: replace NaN/negative/infinite with safe values.
export function sanitizeMods(mods) {
  for (const k of ['income', 'housing', 'jobs', 'power', 'growth', 'cost', 'upkeep']) {
    const v = mods[k];
    if (!Number.isFinite(v) || v < 0) mods[k] = 1;
  }
  if (!Number.isFinite(mods.happiness)) mods.happiness = 0;
  for (const id of Object.keys(mods.byBuilding)) {
    const m = mods.byBuilding[id];
    for (const k of ['income', 'housing', 'jobs', 'power', 'cost']) {
      if (!Number.isFinite(m[k]) || m[k] < 0) m[k] = 1;
    }
    if (!Number.isFinite(m.happiness)) m.happiness = 0;
  }
  return mods;
}

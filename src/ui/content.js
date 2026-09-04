// Content the UI reads from other modules, with safe defaults so the shell renders even
// while resources/buildings/simulation are stubs (they are loaded by boot before UI init,
// so these dynamic imports resolve from the module cache).

export const DEFAULT_RESOURCES = [
  { id: 'money', name: 'Money', icon: '💵', color: '#4ade80', kind: 'stock', format: 'money' },
  { id: 'pop', name: 'Population', icon: '👥', color: '#60a5fa', kind: 'stock', format: 'int' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15', kind: 'derived', format: 'power' },
  { id: 'happiness', name: 'Happiness', icon: '😊', color: '#f472b6', kind: 'derived', format: 'pct' },
];

export const DEFAULT_CATEGORIES = [
  { id: 'residential', name: 'Residential', icon: '🏠', color: '#60a5fa' },
  { id: 'commercial', name: 'Commercial', icon: '🏪', color: '#4ade80' },
  { id: 'industrial', name: 'Industrial', icon: '🏭', color: '#fb923c' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15' },
  { id: 'civic', name: 'Civic', icon: '🏛️', color: '#c084fc' },
];

// Upgrade-only categories (buildings never use these).
export const EXTRA_CATEGORIES = [
  { id: 'global', name: 'City-wide', icon: '🌐', color: '#38bdf8' },
  { id: 'prestige', name: 'Legacy', icon: '🏆', color: '#f9a8d4' },
  { id: 'general', name: 'General', icon: '🔧', color: '#94a3b8' },
];

// Which unlock key gates a build-panel category tab (others show once a building unlocks).
export const CATEGORY_GATES = { power: 'panel:power', civic: 'panel:civic' };

// City title by population. Order matters (ascending).
export const TIERS = [
  { min: 0, title: 'Hamlet' },
  { min: 50, title: 'Village' },
  { min: 500, title: 'Town' },
  { min: 5_000, title: 'City' },
  { min: 50_000, title: 'Metropolis' },
  { min: 500_000, title: 'Megalopolis' },
];

export function tierTitle(pop) {
  let t = TIERS[0].title;
  for (const tier of TIERS) if (pop >= tier.min) t = tier.title;
  return t;
}

export function nextTier(pop) {
  for (const tier of TIERS) if (pop < tier.min) return tier;
  return null;
}

export function moodWord(h) {
  if (!Number.isFinite(h)) return 'Unknown';
  if (h >= 1.6) return 'Euphoric';
  if (h >= 1.3) return 'Thriving';
  if (h >= 1.1) return 'Happy';
  if (h >= 0.9) return 'Content';
  if (h >= 0.7) return 'Uneasy';
  if (h >= 0.5) return 'Grumbling';
  return 'Miserable';
}

async function tryImport(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

export async function loadContent() {
  const content = {
    resources: DEFAULT_RESOURCES,
    categories: DEFAULT_CATEGORIES,
    milestones: [],
    config: null,
  };
  const res = await tryImport('../resources/index.js');
  if (res && Array.isArray(res.RESOURCES) && res.RESOURCES.length) content.resources = res.RESOURCES;
  const bld = await tryImport('../buildings/index.js');
  if (bld && Array.isArray(bld.CATEGORIES) && bld.CATEGORIES.length) content.categories = bld.CATEGORIES;
  const sim = await tryImport('../simulation/index.js');
  if (sim && Array.isArray(sim.MILESTONES)) content.milestones = sim.MILESTONES;
  const bal = await tryImport('../balance/config.js');
  if (bal && bal.config && typeof bal.config === 'object') content.config = bal.config;

  const byId = new Map();
  for (const c of [...content.categories, ...EXTRA_CATEGORIES]) if (c && c.id && !byId.has(c.id)) byId.set(c.id, c);
  content.categoryById = byId;
  content.category = (id) => byId.get(id) || { id, name: id ? id[0].toUpperCase() + id.slice(1) : 'Other', icon: '🏢', color: '#94a3b8' };
  return content;
}

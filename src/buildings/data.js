// Building catalogue — the 20 structures of Metropolis, five categories, four tiers.
// Pure data, DOM-free. These are the module's *defaults*: `config.buildings[id]` in
// src/balance/config.js overrides any field per building and index.js merges it before
// `registerBuilding` (fifteen buildings are overridden there), so never quote a number
// from this file as the shipped value — `node src/buildings/catalogue.mjs` prints the
// resolved catalogue next to these defaults. Why the ladder has this shape (columns,
// power steps, air quality, unlock spacing, the signature mechanics) is in README.md.
//
// Per-unit fields: housing (citizens), jobs, income ($/s), powerGen / powerUse (MW),
// happiness (additive, civic curve), upkeep ($/s). costGrowth defaults to the tier's
// config.cost.tierGrowth value when absent.
// unlock(state, derived) latches in core; `unlockAt` mirrors it as data for the UI's
// progress bar and `unlockHint` quotes the same number — the test holds all three in step.
// synergy { stat, source, per, cap, text }: stat = base × min(cap, 1 + source / per),
//   source is 'pop', 'employed' or 'building:<id>'.
// demandGrowth { per, cap, text }: powerUse = base × min(cap, 1 + (count − 1) / per).
// `text` is what the build card prints (≤ 70 chars, quotes the rule's own numbers).

export const CATEGORIES = [
  { id: 'residential', name: 'Residential', icon: '🏠', color: '#60a5fa', blurb: 'Homes. Citizens move in when there is room, power, and a reason to stay.' },
  { id: 'commercial', name: 'Commercial', icon: '🏪', color: '#4ade80', blurb: 'Shops and offices. Jobs for citizens, revenue for the treasury.' },
  { id: 'industrial', name: 'Industrial', icon: '🏭', color: '#fb923c', blurb: 'Heavy employers with heavy paychecks. The skyline gets a little hazier.' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15', blurb: 'Keep supply ahead of demand or the whole city dims.' },
  { id: 'civic', name: 'Civic', icon: '🏛️', color: '#c084fc', blurb: 'Parks, schools, and pride. Happy citizens grow faster and spend more.' },
];

const pop = (n) => (state) => (state?.res?.pop ?? 0) >= n;
const demand = (n) => (state, derived) => (derived?.powerDemand ?? 0) >= n;

export const BUILDINGS = [
  // ---------------------------------------------------------------- residential
  {
    id: 'house',
    name: 'Cottage',
    icon: '🏠',
    desc: 'A tidy starter home with a porch light and a lawn to mow.',
    category: 'residential',
    tier: 1,
    baseCost: 30,
    housing: 4,
    // Late role: the suburbs fill in around the blocks. Keeps the cheap column a choice
    // once apartments are the frontier instead of a card nobody has a reason to open.
    synergy: { stat: 'housing', source: 'building:apartment', per: 25, cap: 3, text: 'Suburbs: +4% housing per Apartment Block (up to ×3)' },
    powerUse: 1,
    unlock: null,
    unlockHint: 'Available from the start',
  },
  {
    id: 'apartment',
    name: 'Apartment Block',
    icon: '🏢',
    desc: 'Six floors of neighbors who all know when you get home.',
    category: 'residential',
    tier: 2,
    baseCost: 400,
    housing: 24,
    powerUse: 6,
    unlock: pop(20),
    unlockAt: { pop: 20 },
    unlockHint: 'Reach 20 citizens',
  },
  {
    id: 'tower',
    name: 'Residential Tower',
    icon: '🏙️',
    desc: 'Glass and steel stacked skyward; the elevators hum all night.',
    category: 'residential',
    tier: 3,
    baseCost: 9000,
    housing: 160,
    powerUse: 40,
    unlock: pop(250),
    unlockAt: { pop: 250 },
    unlockHint: 'Reach 250 citizens',
  },
  {
    id: 'arcology',
    name: 'Arcology',
    icon: '🌆',
    desc: 'A city within the city, sealed against weather and small talk.',
    category: 'residential',
    tier: 4,
    baseCost: 1.2e6,
    housing: 2500,
    jobs: 500, // self-contained: the block staffs its own shops, clinics and corridors
    powerUse: 2000, // 0.8 MW per citizen, ~3x the tower's 0.25
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Arcology owned (up to ×1.5)' },
    happiness: 0.1, // gardens, clinics and corridors of its own: two parks' worth, felt on the card
    // A clear step (≥ 15%) above the hospital's default gate; config re-pins this one.
    unlock: pop(6500),
    unlockAt: { pop: 6500 },
    unlockHint: 'Reach 6,500 citizens',
  },

  // ----------------------------------------------------------------- commercial
  {
    id: 'shop',
    name: 'Corner Shop',
    icon: '🏪',
    desc: 'Coffee, newspapers, and gossip, open from dawn to whenever.',
    category: 'commercial',
    tier: 1,
    baseCost: 60,
    jobs: 5,
    income: 0.3,
    // Late role: the lunch crowd. Offices are the tier above; every block of desks feeds
    // the tills, so a mid-game city still has a reason to keep opening shops.
    synergy: { stat: 'income', source: 'building:office', per: 25, cap: 3, text: 'Lunch trade: +4% income per Office Block (up to ×3)' },
    powerUse: 1,
    unlock: pop(4),
    unlockAt: { pop: 4 },
    unlockHint: 'Reach 4 citizens',
  },
  {
    id: 'office',
    name: 'Office Block',
    icon: '🏬',
    desc: 'Cubicles, fluorescent light, and very confident forecasts.',
    category: 'commercial',
    tier: 2,
    baseCost: 900,
    // 50 clean jobs against the factory's 20 smoggy ones: the office out-pays a factory
    // per dollar only once the city has citizens to fill the desks (empty desks pay
    // nothing) while the factory's flat income is guaranteed. Neither dominates.
    jobs: 50,
    income: 3,
    powerUse: 8,
    unlock: pop(80),
    unlockAt: { pop: 80 },
    unlockHint: 'Reach 80 citizens',
  },
  {
    id: 'mall',
    name: 'Shopping Mall',
    icon: '🛍️',
    desc: 'A food court, fountains, and tills that ring louder as the city grows.',
    category: 'commercial',
    tier: 3,
    baseCost: 20000,
    jobs: 300,
    income: 40,
    synergy: { stat: 'income', source: 'pop', per: 5000, cap: 3, text: 'Income +20% per 1,000 citizens (up to ×3)' },
    powerUse: 60,
    // 2,800: between the refinery (2,200) and the solar farm (3,600), ~2 min apart each.
    unlock: pop(2800),
    unlockAt: { pop: 2800 },
    unlockHint: 'Reach 2,800 citizens',
  },
  {
    id: 'financial',
    name: 'Financial District',
    icon: '🏦',
    desc: 'Trades on every paycheck in town; the bigger the payroll, the better.',
    category: 'commercial',
    tier: 4,
    baseCost: 3e6,
    jobs: 4000,
    income: 2000,
    synergy: { stat: 'income', source: 'employed', per: 20000, cap: 2.5, text: 'Income +5% per 1,000 employed citizens (up to ×2.5)' },
    powerUse: 3000, // 0.75 MW per job, ~4x the mall's 0.2
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per District owned (up to ×1.5)' },
    unlock: pop(12000),
    unlockAt: { pop: 12000 },
    unlockHint: 'Reach 12,000 citizens',
  },

  // ----------------------------------------------------------------- industrial
  {
    id: 'factory',
    name: 'Factory',
    icon: '🏭',
    desc: 'Smokestacks and shift whistles. The town’s first real paycheck.',
    category: 'industrial',
    tier: 1,
    baseCost: 350,
    jobs: 20,
    income: 2.5,
    powerUse: 10,
    happiness: -0.02,
    unlock: pop(30),
    unlockAt: { pop: 30 },
    unlockHint: 'Reach 30 citizens',
  },
  {
    id: 'refinery',
    name: 'Refinery',
    icon: '⚗️',
    desc: 'Flare stacks, orange sunsets, and every factory in town as a customer.',
    category: 'industrial',
    tier: 2,
    baseCost: 15000,
    jobs: 200,
    income: 60,
    synergy: { stat: 'income', source: 'building:factory', per: 50, cap: 2, text: 'Income +2% per Factory (up to ×2)' },
    powerUse: 120,
    happiness: -0.03,
    // 2,200: 90 s+ ahead of the mall (2,800) in the first city; at 2,500 they opened a minute apart.
    unlock: pop(2200),
    unlockAt: { pop: 2200 },
    unlockHint: 'Reach 2,200 citizens',
  },
  {
    id: 'techpark',
    name: 'Tech Campus',
    icon: '💻',
    desc: 'Free lunch, ping-pong, and a hiring line that starts at the schools.',
    category: 'industrial',
    tier: 3,
    baseCost: 1.5e6,
    jobs: 2500,
    income: 1000,
    synergy: { stat: 'income', source: 'building:school', per: 20, cap: 1.75, text: 'Income +5% per School (up to ×1.75)' },
    powerUse: 3000, // 1.2 MW per job, 2x the refinery's 0.6
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Campus owned (up to ×1.5)' },
    happiness: 0.05,
    unlock: pop(8000),
    unlockAt: { pop: 8000 },
    unlockHint: 'Reach 8,000 citizens',
  },

  // ---------------------------------------------------------------------- power
  {
    id: 'windmill',
    name: 'Windmill',
    icon: '🌬️',
    desc: 'Creaks in the breeze and keeps the porch lights burning.',
    category: 'power',
    tier: 1,
    baseCost: 120,
    powerGen: 6,
    // Gates on live draw, so the first cottage is followed by one dark tick (README: why
    // that stays).
    unlock: (state, derived) => (derived?.powerDemand ?? 0) > 0,
    unlockAt: { powerDemand: 0.001 },
    unlockHint: 'Build something that draws power',
  },
  {
    id: 'coal',
    name: 'Coal Plant',
    icon: '🔥',
    desc: 'Cheap, reliable, and a little grimy. The lights stay on.',
    category: 'power',
    tier: 2,
    baseCost: 1500,
    jobs: 10,
    powerGen: 80,
    happiness: -0.015,
    unlock: demand(20),
    unlockAt: { powerDemand: 20 },
    unlockHint: 'Power demand reaches 20 MW',
  },
  {
    id: 'solar',
    name: 'Solar Farm',
    icon: '☀️',
    desc: 'Acres of panels tilting slowly to follow the sun.',
    category: 'power',
    tier: 3,
    baseCost: 25000,
    powerGen: 900,
    // Panels want open land: every city park lifts the farm's output.
    synergy: { stat: 'powerGen', source: 'building:park', per: 50, cap: 1.5, text: 'Output +2% per City Park (up to ×1.5)' },
    happiness: 0.03,
    // 3,600: ~2 min after the mall (2,800) and ~2 min before the arcology's shipped gate;
    // the population jumps in tower sprees around 3,000, so 3,200–3,300 lands on the mall.
    unlock: pop(3600),
    unlockAt: { pop: 3600 },
    unlockHint: 'Reach 3,600 citizens',
  },
  {
    id: 'nuclear',
    name: 'Nuclear Plant',
    icon: '☢️',
    desc: 'Cooling towers on the skyline and a very thorough safety manual.',
    category: 'power',
    tier: 4,
    baseCost: 2e6,
    jobs: 100,
    powerGen: 12000,
    happiness: 0.02,
    // A real running cost: the bill the fusion reactor is there to replace.
    upkeep: 300,
    unlock: pop(10000),
    unlockAt: { pop: 10000 },
    unlockHint: 'Reach 10,000 citizens',
  },
  {
    id: 'fusion',
    name: 'Fusion Reactor',
    icon: '🌟',
    desc: 'A star in a bottle. The grid will never want for power again.',
    category: 'power',
    tier: 4,
    // $250/MW at the sticker against nuclear's $167, $83 at ×3 — the fleet is the price
    // of admission (the same ordering holds for the shipped costs; the test checks both).
    baseCost: 1.5e7,
    jobs: 200,
    powerGen: 60000,
    // Research spillover: a reactor fleet's engineers make the star burn hotter.
    synergy: { stat: 'powerGen', source: 'building:nuclear', per: 10, cap: 3, text: 'Output +10% per Nuclear Plant (up to ×3)' },
    happiness: 0.05,
    // Twice nuclear's bill per MW at the sticker, two thirds of it at ×3.
    upkeep: 3000,
    unlock: (state) => (state?.res?.pop ?? 0) >= 35000 || (state?.prestige?.legacy ?? 0) >= 1,
    unlockAt: { pop: 35000, legacy: 1 },
    unlockHint: 'Found a new city (or reach 35,000 citizens)',
  },

  // ---------------------------------------------------------------------- civic
  {
    id: 'park',
    name: 'City Park',
    icon: '🌳',
    desc: 'Benches, ducks, and a fountain someone keeps adding soap to.',
    category: 'civic',
    tier: 1,
    baseCost: 200,
    costGrowth: 1.2,
    happiness: 0.05,
    unlock: pop(15),
    unlockAt: { pop: 15 },
    unlockHint: 'Reach 15 citizens',
  },
  {
    id: 'school',
    name: 'School',
    icon: '🏫',
    desc: 'Bells, chalk dust, and the future learning long division.',
    category: 'civic',
    tier: 2,
    baseCost: 5000,
    costGrowth: 1.18,
    jobs: 30,
    powerUse: 5,
    happiness: 0.08,
    unlock: pop(500),
    unlockAt: { pop: 500 },
    unlockHint: 'Reach 500 citizens',
  },
  {
    id: 'hospital',
    name: 'Hospital',
    icon: '🏥',
    desc: 'Clean corridors and a helipad. The whole city sleeps easier.',
    category: 'civic',
    tier: 3,
    baseCost: 80000,
    costGrowth: 1.18,
    jobs: 200,
    powerUse: 50,
    happiness: 0.12,
    // 5,400: bracketed by the arcology's shipped gate below and the tech campus (8,000)
    // above, ~3.5 min apart in the first city; at 4,800 it landed 54 s behind the arcology.
    unlock: pop(5400),
    unlockAt: { pop: 5400 },
    unlockHint: 'Reach 5,400 citizens',
  },
  {
    id: 'stadium',
    name: 'Stadium',
    icon: '🏟️',
    desc: 'Eighty thousand voices under the floodlights on game night.',
    category: 'civic',
    tier: 4,
    baseCost: 5e6,
    // Tier-4 cost growth (no 1.2 exception): by the time it opens the civic curve is
    // saturated, so a stadium is bought as a franchise, and a franchise needs a league.
    jobs: 500,
    income: 2000,
    // Scales with the city through its payroll, not its tills: game-day hiring grows with
    // the crowd (wages plus an unemployment fix), so the card is a decision late without
    // moving city income enough to re-place the balance ladder — an income rule at ×3 did
    // (README, "Signature mechanics").
    synergy: { stat: 'jobs', source: 'pop', per: 20000, cap: 3, text: 'Game-day hires: +5% jobs per 1,000 citizens (up to ×3)' },
    powerUse: 1000, // floodlights and screens: a small town's draw, not a district's
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Stadium owned (up to ×1.5)' },
    happiness: 0.25,
    unlock: pop(20000),
    unlockAt: { pop: 20000 },
    unlockHint: 'Reach 20,000 citizens',
  },
];

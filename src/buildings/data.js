// Building catalogue — the 22 structures of Metropolis: five categories, four tiers in
// every column plus two legacy-gated tier-5 megastructures (the Orbital Ring and the Space
// Elevator) that open at 500 and 300,000 banked legacy — the 14th and 33rd city of a greedy
// 12 h session — so the catalogue keeps unveiling after the first founding instead of being
// spent in its first forty minutes.
// Pure data, DOM-free. These are the module's *defaults*: `config.buildings[id]` in
// src/balance/config.js may override any field per building and index.js merges it before
// `registerBuilding`. Since the 2026-09-07 polish pass the defaults below are the shipped
// numbers (config re-pins fifteen buildings with values identical to these, so a config
// import failure ships the same ladder the balance sim was run on); a genuine delta shows
// in brackets in `node src/buildings/catalogue.mjs`, which prints the resolved catalogue.
// Why the ladder has this shape (columns, power steps, air quality, unlock spacing, the
// signature mechanics, the jobs-to-housing ratio) is in README.md.
//
// Per-unit fields: housing (citizens), jobs, income ($/s), powerGen / powerUse (MW),
// happiness (additive, civic curve), upkeep ($/s). costGrowth defaults to the tier's
// config.cost.tierGrowth value when absent. The curve has a knee (F8): unit n costs
// baseCost · costGrowth^min(n, knee) · lateGrowth^max(0, n − knee); `knee` and
// `lateGrowth` default to config.cost.knee (75) / config.cost.lateGrowth (1.112) through
// index.js and a card pins its own only where the shared pair is wrong for it (the
// hospital's knee 60, the two tier-5 cards' lateGrowth 3 = their costGrowth). maxCount
// (optional, positive integer) is a hard cap on owned units: core's api.buy /
// maxAffordable refuse past it and api.buildings rows carry `maxed` (index.js also rolls
// an over-cap purchase back should a core without the cap ever be loaded).
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
// Banked legacy points (the full bank; spending on charter perks never lowers it).
const legacy = (n) => (state) => (state?.prestige?.legacy ?? 0) >= n;

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
    baseCost: 260,
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
    baseCost: 2800,
    housing: 160,
    powerUse: 40,
    // 420 (was 300, wave 3): the comment the 300 carried was stale — on the shipped curve
    // 300 opened the tower at 7.4 min, 28 s after the office block (200 at 7.0), the worst
    // of the four cadence faults. The office cannot move down (buildings.test pins
    // office.unlockS - coal.unlockS >= 60 s and coal opens at 5.4 against the office's
    // 7.0), so the office -> refinery band (7.0 -> 12.0 min, four gates, three gaps) is
    // only wide enough if the tower and the school are spread evenly across it. 420 sits on
    // the 8.5 min step of the first city's curve (cadence.mjs --curve 15: 375 at 8.0, 420 at
    // 8.5, 436 at 8.8).
    unlock: pop(420),
    unlockAt: { pop: 420 },
    unlockHint: 'Reach 420 citizens',
  },
  {
    id: 'arcology',
    name: 'Arcology',
    icon: '🌆',
    desc: 'A city within the city, sealed against weather and small talk.',
    category: 'residential',
    tier: 4,
    baseCost: 120000,
    housing: 1000,
    // Commuter belt: every financial district's payroll pulls more people into the blocks
    // (+2.5% housing per district, ×3 at 80). This is what keeps the housing column level
    // with the jobs column in a mature city — with a flat 1,000 the greedy bot's district
    // and campus fleet ran jobs at 3–7× the population from the 6th city on and most of a
    // tier-4 employer's job sticker was decorative (README "Jobs and housing"). The base
    // stays at 1,000 because a 2,500 arcology tripped every later first-city gate within a
    // minute; the rule only reaches ×1.15 in the first city's last five minutes.
    synergy: { stat: 'housing', source: 'building:financial', per: 40, cap: 3, text: 'Commuter belt: +2.5% housing per Financial District (up to ×3)' },
    jobs: 500, // self-contained: the block staffs its own shops, clinics and corridors
    // 6.5 MW per citizen, 26× the tower's 0.25: the sticker is deliberately a power bill
    // (~0.5 nuclear plants per block) so the Power tab keeps asking for money late; the
    // strain below is the second, quadratic axis. README "Power" quotes these rates. The
    // four tier-4 draws mirror config.buildings (balance trimmed them from 10,500 / 18,700 /
    // 16,500 / 6,200 when it re-pinned the strain rule to +12.5 % per unit up to ×40; this
    // folder's fallback strain stays the documented +2.5 % / ×1.5 tax).
    powerUse: 6500,
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Arcology owned (up to ×1.5)' },
    happiness: 0.1, // gardens, clinics and corridors of its own: two parks' worth, felt on the card
    // 6,600 (mirrors config): a clear step above the hospital (5,000) and ~2.6 min behind
    // it in the first city; nuclear (12,500) follows ~4 min later.
    unlock: pop(6600),
    unlockAt: { pop: 6600 },
    unlockHint: 'Reach 6,600 citizens',
  },
  {
    id: 'ring',
    name: 'Orbital Ring',
    icon: '🛸',
    desc: 'A habitat wrapped around the planet; the sunsets are on a schedule.',
    category: 'residential',
    tier: 5,
    // Legacy-gated megastructure: opens at 500 banked points (the 14th city of a greedy
    // 12 h session, a legacy tier the simulation announces), so the catalogue keeps
    // unveiling after the first founding — and it lands one city after the Megastructures
    // rung doubles the housing column, which is where its hiring is first needed. $2e11 is
    // seconds of that city's income; the ×3 curve (pinned: config's tierGrowth has no tier
    // 5) makes each further ring a real target — a city buys a handful in its spree and
    // the next one costs more than the spree reached, so the fleet never eats the cash
    // that re-buys the core ladder (README "Tier 5").
    baseCost: 2e11,
    costGrowth: 3,
    lateGrowth: 3, // the ×3 curve is the fleet cap: the shared knee never softens it
    housing: 80000, // eighty arcologies' worth
    // Orbital industry: the ring's yards hire from the city below, +1% per 1,000
    // citizens (×2 at 100,000) up to ×4 (200,000 jobs in a city of 300,000). This is the
    // late jobs engine: from the 14th city on the housing rungs outrun the jobs rungs
    // (×37.5 against ×21.1 by the 31st after the 2026-09-14 round-3 re-pairing, ×17.3
    // before it, columns.mjs) and a
    // static sticker cannot follow — a jobs number that grows with the population can, and
    // it comes online as a replay's citizens arrive. The cap was ×12 when the jobs rungs
    // reached ×12 over a session; the 2026-09-14 upgrade wave (round 1) lifted them to
    // ×17.3 and at ×12 the ring — 72–86 % of the jobs column from the 20th city — held
    // jobs/pop at 2.0–4.3 for the back half of 12 h (median 2.02, 41 % of mature samples
    // inside 0.8–2.0); ×5 read 1.32 median / 77 % in span on the greedy but pinned
    // unemployment at exactly 0 from hour 2 in every profile (human city 9 jobs/pop 2.34,
    // greedy cities 20–23 2.2–3.8, the ring 50–86 % of the column). Round 2 planned ×3
    // alongside the upgrades' jobs-stack trim (Gardens ×1.1, Civic ×1.25, Archives' growth
    // term → ring housing ×1.5) so a mature city reads jobs/pop ≈ 1.0–1.3 and unemployment
    // lives in a 2–15 % band around each housing step — and the plan let this folder hold
    // ×4 if ×3 pushed a mature city under 0.8. Measured on the round-2 tree (12 h, the
    // three caps side by side, scratch cap3/4/5 runs): human jobs/pop cities 7–10 read
    // 0.78 / 0.93 / 1.14 / 0.80 at ×3 (cities 7 and 10 at 22 % / 20 % unemployment, the
    // per-city gate red), 0.85 / 1.02 / 1.26 / 0.95 at ×4 (15 / 0 / 0 / 5 %, every
    // per-city and jobs/pop gate green) and 0.91 / 1.11 / 1.39 / 1.06 at ×5 (city 9 over
    // the 1.3 line); the greedy's cities 25–28 read 0.70 at ×3 on columns.mjs. So ×4: the
    // ring at its cap hires 2.5× its own housing (README "Jobs and housing").
    jobs: 50000,
    synergy: { stat: 'jobs', source: 'pop', per: 100000, cap: 4, text: 'Orbital industry: +1% jobs per 1,000 citizens (up to ×4)' },
    powerUse: 1.2e6, // 12 MW per citizen, twice the arcology's 6.5: the card says "≈ 20 × Fusion Reactor"
    happiness: 0.5, // ten parks: a sealed world with weather it chose
    unlock: legacy(500),
    unlockAt: { legacy: 500 },
    unlockHint: 'Bank 500 legacy',
  },

  // ----------------------------------------------------------------- commercial
  {
    id: 'shop',
    name: 'Corner Shop',
    icon: '🏪',
    desc: 'Coffee, newspapers, and gossip, open from dawn to whenever.',
    category: 'commercial',
    tier: 1,
    baseCost: 50,
    jobs: 5,
    income: 0.8,
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
    baseCost: 1200,
    // 50 clean jobs against the factory's 20 smoggy ones: the office out-pays a factory
    // per dollar only once the city has citizens to fill the desks (empty desks pay
    // nothing) while the factory's flat income is guaranteed. Neither dominates.
    jobs: 50,
    income: 4.4,
    powerUse: 8,
    // 200 citizens (was 80): the first city's population sits on a 183-citizen plateau
    // from 7.0 to 7.5 min and jumps to 216 at 8.0, so the card opens at ~7.7 — ~2.3 min
    // after the coal plant (34 MW at 5.4) and ~110 s before the tower (250 at 9.6) — with
    // $1,350 in the treasury, so it is bought within three minutes. At 80 it opened at 5.3,
    // 70 s before the plant, and glowed unaffordable for five minutes (cadence.mjs --curve).
    unlock: pop(200),
    unlockAt: { pop: 200 },
    unlockHint: 'Reach 200 citizens',
  },
  {
    id: 'mall',
    name: 'Shopping Mall',
    icon: '🛍️',
    desc: 'A food court, fountains, and tills that ring louder as the city grows.',
    category: 'commercial',
    tier: 3,
    baseCost: 25000,
    jobs: 300,
    income: 46,
    synergy: { stat: 'income', source: 'pop', per: 5000, cap: 3, text: 'Income +20% per 1,000 citizens (up to ×3)' },
    powerUse: 60,
    // 3,000 (was 2,800): between the refinery (2,200, 13.5 min) and the solar farm (3,600,
    // 17.1) in the first city, ~2 and ~1.6 min apart (cadence.mjs: opens 15.5, bought 19.1).
    // 3,100 (was 3,000, round 3): on the Green Belts curve (see the tower) 3,000 opened the
    // mall 82 s after the refinery (limit 90 s); 3,100 opens it at 15.0 min, 102 s after,
    // and stays ≥ 15 % under the solar farm's 3,600.
    unlock: pop(3100),
    unlockAt: { pop: 3100 },
    unlockHint: 'Reach 3,100 citizens',
  },
  {
    id: 'financial',
    name: 'Financial District',
    icon: '🏦',
    desc: 'Trades on every paycheck in town; the bigger the payroll, the better.',
    category: 'commercial',
    tier: 4,
    baseCost: 700000,
    // 2,000 (was 4,000): the district is the biggest employer in the game, but at 4,000 it
    // alone carried 44% of a mature city's jobs and the jobs column ran 3–7× the housing
    // column, so 65–80% of the sticker never met a citizen. 2,000 keeps it at a clear step
    // above the tech campus's income-per-desk while letting the columns cross near 1:1.
    jobs: 2000,
    income: 2070, // mirrors config: trimmed with the campus's (2,500 → 2,070) so the two stay within the dominance band (wages included)
    synergy: { stat: 'income', source: 'employed', per: 20000, cap: 2.5, text: 'Income +5% per 1,000 employed citizens (up to ×2.5)' },
    powerUse: 10200, // 5.1 MW per job, ~26× the mall's 0.2 — ~0.9 nuclear plants per district (mirrors config)
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per District owned (up to ×1.5)' },
    // 30,000 (mirrors config): ~2.8 min after the tech campus (18,500) in the first city
    // (25.9 → 28.7 min), ~2 min before fusion's 39,000 trophy gate (30.6).
    unlock: pop(30000),
    unlockAt: { pop: 30000 },
    unlockHint: 'Reach 30,000 citizens',
  },

  // ----------------------------------------------------------------- industrial
  {
    id: 'factory',
    name: 'Factory',
    icon: '🏭',
    desc: 'Smokestacks and shift whistles. The town’s first real paycheck.',
    category: 'industrial',
    tier: 1,
    baseCost: 500,
    jobs: 20,
    income: 3.3,
    powerUse: 10,
    happiness: -0.02,
    // 65 citizens (was 45, before that 30): at 30 the $500 card opened at 1.9 min and glowed
    // unaffordable for seven minutes while income was $3–6/s; at 45 it opened at 4.1 min and,
    // on the final tree (cheaper apartments, growthRate 0.1), was bought at 9.4 — 20 s past
    // the lag rule; at 65 it opens ~4.9 min, inside the exempt opening window, and is bought
    // at 9.4 (lag 4.6, the rule's limit is 5.0). The population crawls on cottages and then jumps with the apartment
    // spree, so the gate sits just under that jump (87 citizens at 5.0 min).
    unlock: pop(65),
    unlockAt: { pop: 65 },
    unlockHint: 'Reach 65 citizens',
  },
  {
    id: 'refinery',
    name: 'Refinery',
    icon: '⚗️',
    desc: 'Flare stacks, orange sunsets, and every factory in town as a customer.',
    category: 'industrial',
    tier: 2,
    baseCost: 20000,
    jobs: 200,
    income: 66,
    synergy: { stat: 'income', source: 'building:factory', per: 50, cap: 2, text: 'Income +2% per Factory (up to ×2)' },
    powerUse: 120,
    happiness: -0.03,
    // 2,200: ~2 min ahead of the mall (3,000) in the first city (cadence.mjs: 13.5 vs 15.5);
    // at 2,500 they opened a minute apart.
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
    baseCost: 300000,
    // 1,800 (was 2,500): a quarter of a mature city's jobs at 2,500, trimmed with the
    // district's sticker so the columns cross near 1:1 (README "Jobs and housing"). It also
    // keeps the district within 0.8× of the campus on income per dollar with wages counted
    // (the test below) and the district's first-city buy inside the 4-minute lag rule,
    // which the bot's jobs-weighted scoring pushed past when only the district moved.
    jobs: 1800,
    income: 740, // mirrors config: balance's uniform late-income lever (was 900, then 810)
    synergy: { stat: 'income', source: 'building:school', per: 20, cap: 1.75, text: 'Income +5% per School (up to ×1.75)' },
    powerUse: 11600, // 6.4 MW per job, ~11× the refinery's 0.6 — ~1 nuclear plant per campus (mirrors config)
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Campus owned (up to ×1.5)' },
    happiness: 0.05,
    // 18,500 (mirrors config, wave 3): at 16,500 the campus opened 88 s after the nuclear
    // plant (12,500) — one of the four cadence faults. At 18,500 it opens at 25.9 min,
    // 2.1 min after the plant (23.8). The catalogue's ordering rule (every gate ≥ 15 %
    // above the one below) still holds: 18,500 / 12,500 = ×1.48.
    unlock: pop(18500),
    unlockAt: { pop: 18500 },
    unlockHint: 'Reach 18,500 citizens',
  },

  // ---------------------------------------------------------------------- power
  {
    id: 'windmill',
    name: 'Windmill',
    icon: '🌬️',
    desc: 'Creaks in the breeze and keeps the porch lights burning.',
    category: 'power',
    tier: 1,
    baseCost: 40,
    // ×2 per unit and a hard cap of 8: the 8th costs $5,120 for 4 MW, about two coal plants'
    // worth, and the eight together $10,200 for 32 MW. That is the tutorial generator's
    // retirement — at a cap of 12 the last four cost $10k–$82k each for 4 MW and both the bot
    // and a Buy Max on the Power tab paid ~$164k for 48 MW when a $2,500 coal plant gives 80;
    // without any cap a late Buy Max paid ~$1e16 for the 49th (40% of a 12 h city's cash).
    costGrowth: 2,
    powerGen: 4,
    maxCount: 8,
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
    // $2,500 (was $1,500): with the windmill retired at 12 the coal plant is the fix the bot
    // reaches for from minute 6, and at $1,500 it fixed the first city's brownouts so fast
    // the 12 h under-power share read 2.6% against the ≥ 3% contract; $2,500 reads 3.1%
    // and the first plant is still bought 2.6 min after it opens (README "Power").
    baseCost: 2500,
    jobs: 10,
    powerGen: 80,
    happiness: -0.015,
    // 34 MW: half a windmill more than the eight the cap can supply, so the plant opens
    // (~6.0 min) the moment the grid falls short — the apartment spree lifts the draw 25 →
    // 34 MW between 5.5 and 6.0 min and the next purchase jumps it straight to 40, so any
    // gate from 35 to 40 opened at 6.5, 78 s before the office block (200 citizens, 7.8
    // min); at 34 the office follows ~110 s later. At 20–24 MW the plant landed inside
    // the apartment spree itself.
    unlock: demand(34),
    unlockAt: { powerDemand: 34 },
    unlockHint: 'Power demand reaches 34 MW',
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
    // 3,600: ~1.6 min after the mall (3,000, 15.5 min) and ~3 min before the hospital
    // (5,000, 20.2); the population jumps in tower sprees around 3,000, so 3,200–3,300
    // lands on the mall (cadence.mjs: opens 17.1).
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
    baseCost: 400000,
    jobs: 100,
    powerGen: 12000,
    happiness: 0.02,
    // A real running cost: the bill the fusion reactor is there to replace.
    upkeep: 300,
    // 12,500 (mirrors config): ~4 min after the arcology (6,600), whose 6.5 GW draw is what the plant is
    // sized for, and ~2.1 min before the tech campus (18,500).
    unlock: pop(12500),
    unlockAt: { pop: 12500 },
    unlockHint: 'Reach 12,500 citizens',
  },
  {
    id: 'fusion',
    name: 'Fusion Reactor',
    icon: '🌟',
    desc: 'A star in a bottle. The grid will never want for power again.',
    category: 'power',
    tier: 4,
    // $67/MW at the sticker against nuclear's $33, $22 at ×3 — the fleet is the price of
    // admission (the test pins the ordering for these defaults and the resolved defs).
    baseCost: 4e6,
    jobs: 200,
    powerGen: 60000,
    // Research spillover: a reactor fleet's engineers make the star burn hotter.
    synergy: { stat: 'powerGen', source: 'building:nuclear', per: 10, cap: 3, text: 'Output +10% per Nuclear Plant (up to ×3)' },
    happiness: 0.05,
    // The same bill per MW as nuclear at the sticker ($0.025/MW/s), a third of it at ×3.
    upkeep: 1500,
    // 39,000 (was 36,000, wave 3): the first-city trophy gate. At 36,000 the reactor opened
    // 70 s after the financial district (30,000, 28.7 min) and only 30 s before the stadium
    // (then 45,000) — two of the four cadence faults at once. At 39,000 it opens at 30.6 min,
    // 114 s after the district (cadence.mjs). 39,000 and not the 40,000 the plan named
    // because the catalogue's own ordering rule wants every default gate ≥ 15 % above the
    // one below it. The fusion → stadium gap is closed on the stadium's side: its gate is
    // now 73,000 in config and here, which opens it at 32.4 min, 108 s after this reactor,
    // and clears the ordering rule too (73,000 / 39,000 = ×1.87). `legacy >= 1` stays the
    // normal route, so a second city still gets the reactor at once.
    unlock: (state) => (state?.res?.pop ?? 0) >= 39000 || (state?.prestige?.legacy ?? 0) >= 1,
    unlockAt: { pop: 39000, legacy: 1 },
    unlockHint: 'Found a new city (or reach 39,000 citizens)',
  },
  {
    id: 'elevator',
    name: 'Space Elevator',
    icon: '🚀',
    desc: 'A cable to orbit. Freight goes up, sunlight comes down, all day.',
    category: 'power',
    tier: 5,
    // Opens at 300,000 banked points (mirrors config: the never-bought item of city 33,
    // re-pinned from 15,000 so it follows the Imperial Charter's city), long after the ring. $2e13 is seconds of that city's income; ×3 per unit like the
    // ring, so the fleet is a rolling target rather than a spree. The rings are its
    // counterweights: each one anchored to the cable lifts the beamed-down output.
    baseCost: 2e13,
    costGrowth: 3,
    lateGrowth: 3, // as the ring: the ×3 curve never softens
    jobs: 40000,
    // Ten fusion reactors (was fifty, 3e6). At 3e6 × the ×3 counterweight cap the elevator
    // was 61 % of the human 24 h fleet's sticker capacity (11 units) and 65 % of the
    // greedy's at 12 h: it alone took the human's city 13 from 5.4× to 13× cap/demand and
    // the greedy's city 34 to 14.7× (round-1 skeptics). 6e5 with the cap at ×2 leaves the
    // card a felt generator (still the biggest in the game, ≥ 10 reactors) at ~20 % of
    // the late fleet's capacity; the price and the ×3 curve — the city-33 novelty — stay.
    // Upkeep moves with it so the cable still bills nuclear's $0.025/MW/s at the sticker.
    powerGen: 6e5,
    synergy: { stat: 'powerGen', source: 'building:ring', per: 10, cap: 2, text: 'Counterweights: output +10% per Orbital Ring (up to ×2)' },
    happiness: 0.3,
    upkeep: 1.5e4, // the cable is inspected daily: nuclear's $0.025/MW/s at the sticker, half of it at ×2
    unlock: legacy(300000),
    unlockAt: { legacy: 300000 },
    unlockHint: 'Bank 300,000 legacy',
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
    // 820 (was 500, wave 3): the middle rung of the office -> tower -> school -> refinery
    // run. At 500 the school opened at 9.3 min, 114 s behind the tower's old 300 gate but
    // only because the tower itself was crowding the office; with the tower at 420 (8.5 min)
    // the school has to move up to keep both gaps near the band's 100 s share. 820 lands it
    // at ~10.2 min on the curve (734 at 10.0, 894 at 10.3), ~105 s before the refinery's
    // 2,200 at 12.0.
    unlock: pop(820),
    unlockAt: { pop: 820 },
    unlockHint: 'Reach 820 citizens',
  },
  {
    id: 'hospital',
    name: 'Hospital',
    icon: '🏥',
    desc: 'Clean corridors and a helipad. The whole city sleeps easier.',
    category: 'civic',
    tier: 3,
    baseCost: 60000,
    costGrowth: 1.18,
    // Knee 60 (the shared knee is 75): a 1.18 curve from $60k has to soften earlier than
    // the park's and school's to stay under the stadium — at 75 the 200th hospital reads
    // $8.6e15 against the stadium's $5.0e15 and $1e18 buys fewer hospitals than stadiums;
    // at 60 it reads $3.5e15 and 232 vs 229 units from zero. The first city buys 23, so
    // its curve is untouched (buildings.test.mjs "F8").
    knee: 60,
    jobs: 200,
    powerUse: 50,
    happiness: 0.12,
    // 5,000: bracketed by the solar farm (3,600, 17.5 min) below and the arcology (6,600,
    // 22.9) above, ~2.8 and ~2.6 min apart on the first city's curve (cadence.mjs
    // --curve); 5,400 landed at 21.4, 90 s before the arcology, once the tier-4 gates
    // moved, and 4,800 once landed 54 s behind it.
    unlock: pop(5000),
    unlockAt: { pop: 5000 },
    unlockHint: 'Reach 5,000 citizens',
  },
  {
    id: 'stadium',
    name: 'Stadium',
    icon: '🏟️',
    desc: 'Eighty thousand voices under the floodlights on game night.',
    category: 'civic',
    tier: 4,
    baseCost: 3e6,
    // Tier-4 cost growth (no 1.2 exception): by the time it opens the civic curve is
    // saturated, so a stadium is bought as a franchise, and a franchise needs a league.
    jobs: 500,
    income: 2000,
    // Scales with the city through its payroll, not its tills: game-day hiring grows with
    // the crowd (wages plus an unemployment fix), so the card is a decision late without
    // moving city income enough to re-place the balance ladder — an income rule at ×3 did
    // (README, "Signature mechanics").
    // ×2 (was ×3): with the district at 2,000 jobs the stadium's payroll no longer needs
    // to triple to matter, and at ×3 it was 15% of a jobs column already running 3× the
    // population (README "Jobs and housing").
    synergy: { stat: 'jobs', source: 'pop', per: 20000, cap: 2, text: 'Game-day hires: +5% jobs per 1,000 citizens (up to ×2)' },
    powerUse: 3850, // floodlights and screens: about half an arcology's draw, four solar farms (mirrors config)
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Stadium owned (up to ×1.5)' },
    happiness: 0.25,
    // 73,000 (mirrors config, wave 3): the first city's last card. At 45,000 it opened at
    // 30.8 min, 14 s after fusion's 39,000 trophy gate (30.6) — a cadence fault. The curve
    // is very steep here (38,817 pop at 30.5 min, 62,873 at 31.5, 71,109 at 32.3), so
    // 66,000 and 70,000 only buy 82 s and 88 s; 73,000 opens the stadium at 32.4 min,
    // 108 s clear of the reactor, bought at 32.4, first city still founds at 35.0.
    unlock: pop(73000),
    unlockAt: { pop: 73000 },
    unlockHint: 'Reach 73,000 citizens',
  },
];

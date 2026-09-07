export const meta = {
  name: 'critic-gauntlet',
  description: 'Score every module 0-10 vs top-tier idle games; builders revise failing modules up to 4 rounds; economy end-game gate',
  phases: [
    { title: 'Evidence', detail: 'fresh verify + 12h sim' },
    { title: 'Critique', detail: 'one critic per module + economy critic' },
    { title: 'Revise', detail: 'builders fix weakest issues' },
    { title: 'Status', detail: 'write docs/STATUS.json' },
  ],
}

const ROOT = 'C:/Users/gotmi/OneDrive/Documents/GitHub/incremental-simcity'
const MAX_ROUNDS = args?.maxRounds ?? 4
const startRound = args?.startRound ?? 1
const THRESH = 8.5

const SCORE = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    score: { type: 'number' },
    errors: { type: 'number' },
    pass: { type: 'boolean' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'issue', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['module', 'score', 'errors', 'pass', 'strengths', 'issues', 'verdict'],
}
const FIX = {
  type: 'object',
  properties: {
    module: { type: 'string' },
    changed: { type: 'array', items: { type: 'string' } },
    addressed: { type: 'array', items: { type: 'string' } },
    notAddressed: { type: 'array', items: { type: 'string' } },
    verifyErrors: { type: 'number' },
  },
  required: ['module', 'changed', 'addressed', 'notAddressed', 'verifyErrors'],
}
const EVIDENCE = { type: 'object', properties: { summary: { type: 'string' }, verifyPass: { type: 'boolean' }, simPass: { type: 'boolean' } }, required: ['summary', 'verifyPass', 'simPass'] }

const RUBRIC = `SCORING RUBRIC (0-10, benchmark = top-tier incremental games like Universal Paperclips, Cookie Clicker, Kittens Game, Antimatter Dimensions): 10 = flawless and addictive, nothing to change; 9 = excellent, tiny nits; 8.5 = great premium indie release quality; 7 = solid but clearly unfinished polish or one real gameplay flaw; 5 = programmer art / unbalanced / confusing; 3 = broken in places; 0 = unusable. PASS requires score >= ${THRESH} AND zero errors attributable to the module. NEVER inflate. Be specific: every issue must name the file/element/number and a concrete fix. If you cannot verify something, say so and score what you saw.`

const evidencePrompt = `Root ${ROOT}. Dev server should be at http://localhost:5173 (if curl fails, start \`node tools/serve.mjs\` in background). Run: \`node tools/verify.mjs --ticks 10000 --tag gauntlet\` and \`node tools/economy-sim.mjs --ticks 432000 --out logs/sim-gauntlet.json\`. Do not modify source. Return a compact summary: pass/fail + failReasons, error texts (first 5), tickStats, fps, ui object, samples at ticks 1000/3000/6000/10000 (money,pop,income,powerRatio,buildings,upgrades), sim: pass, contractPass, the full metrics block (cycles list, tensionShare, underPowerShare, minPowerRatio, happinessDipCities, emptyLateCycles, neverPurchased), issues, final (legacy, legacySpent, prestiges, maxMoney), and the cycles array summarised (n, minutes, legacyAfter, newItems count).`

const critics = (evidence) => ({
  ui: `You are a UI/UX critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nEvidence: READ the screenshots logs/screenshot-gauntlet-start.png, -mid.png, -end.png, -full.png (use the Read tool on the PNGs; look carefully: alignment, spacing rhythm, hierarchy, contrast, truncation, overflow, empty states, whether the dashboard visibly expanded between start and end, skyline quality, whether numbers/cards look premium or like programmer art). Confirm the Legacy panel renders the Charter perks section (legacy-priced upgrades with ◆ cost chips and available/total legacy) once the bot has founded a city — if you cannot see it in the gauntlet screenshots, drive it yourself in your puppeteer run (the bot founds within ~40 game-minutes: run enough steps). Read src/ui/*.js and styles.css for: frame-loop cost, DOM writes only on change, reduced-motion, no window.confirm/alert, accessibility basics (buttons are buttons, focus visible). Also read logs/gauntlet.json 'ui' and 'fps' fields. Additionally open the live page yourself with a short puppeteer-core script (chrome at C:/Program Files/Google/Chrome/Application/chrome.exe) at 1440x900 AND 1100x800: load http://localhost:5173/?headless=1, wait for window.__game.ready, run 40 iterations of {__game.botStep(); __game.step(150)} then start the loop 2s and screenshot both sizes to the scratchpad dir; check the 1100px layout too. Score module 'ui'.\n\nEvidence summary:\n${evidence}`,
  buildings: `You are a game-design critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/buildings/. Read its code, docs/DESIGN.md, and logs/sim-gauntlet.json (purchases, samples). Judge: variety and clarity of roles, flavor text quality, unlock cadence (does a new building appear every few minutes?), whether each building is ever worth buying (from sim purchase list), tier progression, cost/benefit sanity, code quality and registry usage, zero errors. Score module 'buildings'.\n\nEvidence summary:\n${evidence}`,
  upgrades: `You are a game-design critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/upgrades/. Read its code, docs/DESIGN.md (incl. "Late game contract": ≥ 12 charter perks priced in legacy via currency:'legacy', an earnings-gated fixed-dollar late ladder, zero wall-clock gates), and logs/sim-gauntlet.json (metrics.neverPurchased, cycles[].newItems). Judge: count and spread across the cost ladder (is there always a next upgrade within a few minutes of income?), effect legibility in desc text, meaningfulness (>=+25% or an unlock), unlock conditions that actually trigger (check sim: how many upgrades were bought by 1h/6h/12h), fault isolation (effects mutate mods only), errors. Score module 'upgrades'.\n\nEvidence summary:\n${evidence}`,
  simulation: `You are a systems critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/simulation/ (+ its use of src/resources/). Read the code, docs/DESIGN.md "Late game contract" (binding: legacy from lifetime earnings only, no wall-clock gates, legacy also a spendable currency via prestige.spent with the income bonus on the full bank, derived.extra.prestige fields), and logs. Judge: correctness of integration (dt, clamps), milestone cadence and rewards, prestige loop design (does legacy make replays faster and meaningful? is threshold sane? do the sim's cycles array and metrics meet the contract shape?), tap action, dashboard gates, no per-tick allocations beyond mods, tick time (logs/gauntlet.json tickStats: must be avg<0.5ms p99<4ms), NaN safety, event emission for UI, code clarity. Score module 'simulation'.\n\nEvidence summary:\n${evidence}`,
  resources: `You are a systems critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/resources/. Read the code and docs/DESIGN.md math. Verify formulas by writing a tiny Node script in the scratchpad importing src/boot.js, setting a synthetic state (e.g. 10 houses, 5 shops, 2 windmills, 100 pop) and checking housing/jobs/power/happiness/income by hand. Judge correctness, edge cases (pop 0, demand 0, huge numbers 1e300), purity/allocation, readability of derived.extra for UI. Score module 'resources'.\n\nEvidence summary:\n${evidence}`,
  save: `You are a reliability critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/save/. Read the code. Test with a puppeteer-core script (chrome at C:/Program Files/Google/Chrome/Application/chrome.exe) in the scratchpad against http://localhost:5173/ (non-headless param so save is active): play 3000 ticks with bot, action('save'), reload → state.tick and buildings restored; tamper localStorage with garbage → page still loads with fresh state and no console.error; backdate savedAt by 2h → 'offline' event fires and money increased with a toast visible in a screenshot; exportSave/importSave round trip; hardReset clears. Judge robustness, migrations path, autosave cadence, no throw on private mode (wrap localStorage). Score module 'save'.\n\nEvidence summary:\n${evidence}`,
  core: `You are a code-quality critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/core/ + src/boot.js + src/main.js. Read all. Judge: fault isolation actually works (write a scratchpad Node script that registers an upgrade whose effect throws and a building whose unlock throws, boots, steps 500 ticks with bot, and confirms game continues, errors[] logged, item disabled after 3 failures), api correctness (cost sums, maxAffordable off-by-one, sell refund), loop accumulator/catch-up, state load/merge/sanitize, number formatting edge cases (fmt(0.5), fmt(999.99), fmt(1e15), fmt(1e40), negative), performance. Score module 'core'.\n\nEvidence summary:\n${evidence}`,
  balance: `You are a game-balance critic for the game "Metropolis" (${ROOT}). ${RUBRIC}\nModule under review: src/balance/config.js and the resulting pacing. The binding spec is docs/DESIGN.md section "Late game contract" (cadence target + module contracts); earlier pacing lines in that file are superseded. Read logs/sim-gauntlet.json (metrics block, cycles array, issues, contractPass) and logs/gauntlet.json samples. Compute and report: time to first building/upgrade/shop/1k pop/10k pop, first founding, income at 10/30/60/180 min, cycle durations vs the target shape (floor 4–8 min by founding 6–10, then each ≤ 1.35× previous, last ≤ 40 min), tensionShare (≥ 30%), underPowerShare (3–20%, floor ≥ 0.6), happiness dip cities (≥ 50%), empty late cycles (0), never-purchased items, money/legacy magnitudes (≤ 1e18 / ≤ 1e6). Judge against Cookie Clicker/Paperclips: always something to buy within ~1–3 min early, no dead stretch > 5 min in hour 1, a 'next big thing' visible at all times. A contract miss on a high-severity metric (cadence, tension, variety) caps the score below 8.5; minor misses on one secondary metric do not. Score module 'balance'.\n\nEvidence summary:\n${evidence}`,
})

phase('Evidence')
let evidence = await agent(evidencePrompt, { label: 'evidence', phase: 'Evidence', schema: EVIDENCE, effort: 'low' })

let scores = {}
const history = []
for (let round = startRound; round <= MAX_ROUNDS; round++) {
  phase('Critique')
  const cp = critics(evidence?.summary || '')
  const only = Array.isArray(args?.only) && args.only.length ? new Set(args.only) : null
  const names = Object.keys(cp).filter((m) => !(scores[m]?.pass) && (!only || only.has(m)))
  const results = (await parallel(names.map((m) => () => agent(cp[m], { label: `critic:${m}:r${round}`, phase: 'Critique', schema: SCORE, effort: m === 'ui' || m === 'balance' ? 'high' : 'medium' })))).filter(Boolean)
  for (const r of results) scores[r.module] = { ...r, round }
  const failing = results.filter((r) => !(r.score >= THRESH && r.errors === 0 && r.pass))
  history.push({ round, scores: Object.fromEntries(results.map((r) => [r.module, r.score])) })
  log(`Round ${round}: ${results.map((r) => `${r.module}=${r.score}`).join(' ')}; failing: ${failing.map((f) => f.module).join(',') || 'none'}`)
  if (!failing.length) break
  if (round === MAX_ROUNDS) break

  phase('Revise')
  const folderOf = { ui: 'src/ui', buildings: 'src/buildings', upgrades: 'src/upgrades', simulation: 'src/simulation', resources: 'src/resources', save: 'src/save', core: 'src/core (+ src/boot.js, src/main.js)', balance: 'src/balance' }
  const uiCritique = scores.ui ? `\nFor context, the UI critic's current issues (do NOT edit src/ui unless it is your folder): ${scores.ui.issues.map((i) => i.issue).join(' | ')}` : ''
  await parallel(failing.map((f) => () => agent(`You are the builder that owns ${folderOf[f.module]} in the game "Metropolis" (${ROOT}, plain ES modules, dev server http://localhost:5173 — keep it running). Read ARCHITECTURE.md, docs/DESIGN.md, src/core/*, and all of your folder. A critic scored your module ${f.score}/10 (pass needs >= ${THRESH}, zero errors). Verdict: ${f.verdict}\nIssues to fix (severity, issue, fix):\n${f.issues.map((i) => `- [${i.severity}] ${i.issue} → ${i.fix}`).join('\n')}\nStrengths to preserve: ${f.strengths.join('; ')}${f.module === 'ui' ? '' : uiCritique}${args?.notes && args.notes[f.module] ? '\nHANDOFF NOTE FROM INTEGRATOR: ' + args.notes[f.module] : ''}\nRules: edit ONLY your folder${f.module === 'core' ? ' (you are the integrator for core; you may also fix cross-module seams surgically)' : ''}; never break the public contracts in docs/DESIGN.md; no placeholders; after changes run \`node tools/verify.mjs --ticks 6000 --tag fix-${f.module}\` and \`node tools/economy-sim.mjs --ticks 216000 --out logs/sim-fix-${f.module}.json\` and READ the outputs (and screenshots for ui) — zero errors required; iterate until your own honest re-assessment is >= ${THRESH}. Do not commit. Report what you changed and which issues remain.`, { label: `fix:${f.module}:r${round}`, phase: 'Revise', schema: FIX, effort: f.module === 'ui' ? 'high' : 'medium' })))

  // integrator sweep + fresh evidence for next round
  await agent(`You are the INTEGRATOR for "Metropolis" (${ROOT}). Several modules were just revised in parallel (${failing.map((f) => f.module).join(', ')}). Run \`node tools/verify.mjs --ticks 10000 --tag gauntlet\` and \`node tools/economy-sim.mjs --ticks 432000 --out logs/sim-gauntlet.json\`. Fix any integration error (contract drift between modules, missing exports, broken imports) surgically; you may edit src/core and seams in any module. Re-run until verify PASSes with zero errors and sim has no overflow/stall. Then \`git add -A && git commit -m "Gauntlet round ${round}: revisions"\`. Return a compact summary like before (pass/fail, failReasons, first errors, tickStats, fps, ui, samples at 1000/3000/6000/10000, sim issues, prestigeTicks, never-purchased ids).`, { label: `integrator:r${round}`, phase: 'Revise', schema: EVIDENCE, effort: 'high' }).then((e) => { if (e) evidence = e })
}

phase('Status')
const statusAgent = await agent(`Root ${ROOT}. Update docs/STATUS.json (read it first, keep its shape). For each module below set score, rounds (=round), pass, and issues (array of remaining issue strings). Set economy = balance module result. Set verify from logs/gauntlet.json (pass, errors count = errors.length + pageErrors.length, tickAvgMs, fps). Increment iteration. Append to history: { iteration, timestamp from logs/gauntlet.json finishedAt, scores map }. updated = same timestamp. Then \`git add -A && git commit -m "STATUS: gauntlet iteration"\`. Return the final JSON text.\n\nScores:\n${JSON.stringify(Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v.score, round: v.round, pass: v.pass && v.score >= THRESH && v.errors === 0, errors: v.errors, issues: v.issues.map((i) => `[${i.severity}] ${i.issue} → ${i.fix}`), verdict: v.verdict }])), null, 1)}`, { label: 'status-writer', phase: 'Status', effort: 'low' })

return { scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v.score, pass: v.pass, errors: v.errors, round: v.round, verdict: v.verdict, issues: v.issues }])), history, status: statusAgent }

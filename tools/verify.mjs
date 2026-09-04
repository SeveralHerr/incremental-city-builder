// Headless-Chrome verification: load app, run N ticks with bot, log JSON + screenshots.
// node tools/verify.mjs [--ticks 10000] [--no-bot] [--url http://localhost:5173] [--out logs] [--tag name]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const TICKS = Number(opt('--ticks', 10000));
const BOT = !args.includes('--no-bot');
const URL = opt('--url', 'http://localhost:5173');
const OUT = path.resolve(ROOT, opt('--out', 'logs'));
const TAG = opt('--tag', 'verify');
const CHUNK = 100;
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('Chrome not found; set CHROME_PATH');
}

const report = {
  tag: TAG,
  url: URL,
  ticks: TICKS,
  bot: BOT,
  startedAt: new Date().toISOString(),
  errors: [],
  warnings: [],
  pageErrors: [],
  requestFailures: [],
  modules: null,
  samples: [],
  tickStats: null,
  fps: null,
  ui: null,
  final: null,
  pass: false,
  failReasons: [],
};

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error') report.errors.push(text);
    else if (t === 'warning') report.warnings.push(text);
  });
  page.on('pageerror', (e) => report.pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('requestfailed', (r) => report.requestFailures.push(r.url() + ' ' + (r.failure()?.errorText || '')));

  const t0 = Date.now();
  await page.goto(URL + '/?headless=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__game && window.__game.ready === true, { timeout: 20000 });
  report.loadMs = Date.now() - t0;
  report.modules = await page.evaluate(() => window.__game.modules);
  await page.screenshot({ path: path.join(OUT, `screenshot-${TAG}-start.png`) });

  const chunks = Math.ceil(TICKS / CHUNK);
  const midShot = Math.floor(chunks / 2);
  for (let c = 0; c < chunks; c++) {
    const n = Math.min(CHUNK, TICKS - c * CHUNK);
    const sample = await page.evaluate(
      (n, bot) => {
        const g = window.__game;
        const t0 = performance.now();
        // bot acts every 20 ticks
        for (let i = 0; i < n; i += 20) {
          if (bot) g.botStep();
          g.step(Math.min(20, n - i));
        }
        const wall = performance.now() - t0;
        const s = g.state, d = g.derived;
        const bcount = Object.values(s.buildings).reduce((a, b) => a + b, 0);
        return {
          tick: s.tick,
          time: +s.time.toFixed(1),
          money: s.res.money,
          pop: s.res.pop,
          income: d.income,
          housing: d.housing,
          jobs: d.jobs,
          powerCap: d.powerCap,
          powerDemand: d.powerDemand,
          powerRatio: d.powerRatio,
          happiness: d.happiness,
          buildings: bcount,
          upgrades: Object.keys(s.upgrades).length,
          legacy: s.prestige.legacy,
          prestiges: s.stats.prestiges,
          wallMsPerTick: wall / n,
        };
      },
      n,
      BOT
    );
    report.samples.push(sample);
    if (c === midShot) {
      // let UI catch up one frame then shoot
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, `screenshot-${TAG}-mid.png`) });
    }
  }

  report.tickStats = await page.evaluate(() => window.__game.tickStats());

  // Real-time UI run: start loop 2.5s, measure fps, then screenshot.
  report.fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const g = window.__game;
        g.start();
        let frames = 0;
        const t0 = performance.now();
        const f = () => {
          frames++;
          if (performance.now() - t0 < 2500) requestAnimationFrame(f);
          else {
            g.stop();
            resolve(+((frames * 1000) / (performance.now() - t0)).toFixed(1));
          }
        };
        requestAnimationFrame(f);
      })
  );
  await page.screenshot({ path: path.join(OUT, `screenshot-${TAG}-end.png`) });
  await page.screenshot({ path: path.join(OUT, `screenshot-${TAG}-full.png`), fullPage: true });

  report.ui = await page.evaluate(() => {
    const app = document.getElementById('app');
    const r = app ? app.getBoundingClientRect() : null;
    return {
      domNodes: document.querySelectorAll('*').length,
      appHeight: r ? r.height : 0,
      appWidth: r ? r.width : 0,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: innerWidth,
      horizontalOverflow: document.body.scrollWidth > innerWidth + 1,
      textLength: (app?.innerText || '').length,
      title: document.title,
    };
  });

  report.final = await page.evaluate(() => {
    const g = window.__game;
    return {
      state: JSON.parse(JSON.stringify(g.state)),
      derived: JSON.parse(JSON.stringify({ ...g.derived, mods: undefined })),
      errors: g.errors.slice(),
      modules: g.modules,
    };
  });
} catch (e) {
  report.errors.push('verify.mjs: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
}

// ---- Gate ----
const fail = (r) => report.failReasons.push(r);
if (report.errors.length) fail(`${report.errors.length} console errors`);
if (report.pageErrors.length) fail(`${report.pageErrors.length} page errors`);
if (report.final?.errors?.length) fail(`${report.final.errors.length} guarded runtime errors`);
for (const m of Object.entries(report.modules || {})) if (m[1] !== 'ok') fail(`module ${m[0]} ${m[1]}`);
const s = report.samples;
if (s.length) {
  const bad = s.find((x) => Object.values(x).some((v) => typeof v === 'number' && !Number.isFinite(v)));
  if (bad) fail(`non-finite value at tick ${bad.tick}`);
  const last = s[s.length - 1];
  if (BOT && last.income <= 0) fail('income <= 0 at end of run');
  if (BOT && last.pop <= 0) fail('population <= 0 at end of run');
  // stall: money not growing and no purchases across the last 30% of run
  const tail = s.slice(Math.floor(s.length * 0.7));
  const growth = tail[tail.length - 1].money - tail[0].money;
  const bought = tail[tail.length - 1].buildings - tail[0].buildings;
  if (BOT && growth <= 0 && bought === 0 && tail[0].prestiges === tail[tail.length - 1].prestiges) fail('economy stalled in final 30% of run');
}
if (report.tickStats) {
  if (report.tickStats.avg > 0.5) fail(`avg tick ${report.tickStats.avg.toFixed(3)}ms > 0.5ms`);
  if (report.tickStats.p99 > 4) fail(`p99 tick ${report.tickStats.p99.toFixed(2)}ms > 4ms`);
}
if (report.fps !== null && report.fps < 50) fail(`fps ${report.fps} < 50`);
if (report.ui) {
  if (report.ui.horizontalOverflow) fail('horizontal page overflow');
  if (report.ui.textLength < 50) fail('UI rendered almost no text');
}
report.pass = report.failReasons.length === 0;
report.finishedAt = new Date().toISOString();

const outFile = path.join(OUT, `${TAG}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
const last = s[s.length - 1] || {};
console.log(
  `[verify] ${report.pass ? 'PASS' : 'FAIL'} ticks=${last.tick ?? 0} money=${Math.round(last.money ?? 0)} pop=${Math.round(
    last.pop ?? 0
  )} income=${(last.income ?? 0).toFixed(2)}/s tick avg=${report.tickStats?.avg?.toFixed(3)}ms p99=${report.tickStats?.p99?.toFixed(
    2
  )}ms fps=${report.fps} errors=${report.errors.length + report.pageErrors.length}`
);
if (!report.pass) console.log('[verify] reasons: ' + report.failReasons.join('; '));
if (report.errors.length) console.log('[verify] first error: ' + report.errors[0]);
console.log(`[verify] wrote ${outFile}`);
process.exit(report.pass ? 0 : 1);

// Close-up of the skyline with every landmark upgrade owned (day + night), for eyeballing
// set pieces. Needs the dev server. Run: node tools/shot-landmarks.mjs  → logs/landmarks-{day,night}.png
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('logs');
fs.mkdirSync(OUT, { recursive: true });
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('Chrome not found; set CHROME_PATH');
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto('http://localhost:5173/?headless=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready === true, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    for (const [id, n] of Object.entries({ cottage: 40, apartment: 20, tower: 6, shop: 20, office: 10, mall: 3, factory: 8, refinery: 3, windmill: 6, coal: 3, solar: 4, park: 4, school: 3, stadium: 1 })) {
      if (s.buildings[id] !== undefined) s.buildings[id] = n;
      else s.buildings[id] = n;
    }
    for (const id of ['welcome-sign', 'green-belts', 'express-transit', 'container-port', 'tourism-board', 'regional-airport', 'grid-substations', 'orbital-solar', 'ringworld-district']) s.upgrades[id] = true;
    for (let i = 0; i < 3; i++) g.step();
    document.querySelectorAll('.toast, .toasts, .city-hint').forEach((el) => (el.style.display = 'none'));
    document.querySelector('.panel-city').style.cssText += ';width:1200px;height:600px;position:fixed;left:0;top:0;z-index:99';
  });
  await new Promise((r) => setTimeout(r, 600));
  const el = await page.$('.panel-city');
  await page.evaluate(() => window.__game.ui && window.__game.ui.skyline && window.__game.ui.skyline.setPhase(0.4));
  await el.screenshot({ path: path.join(OUT, 'landmarks-day.png') });
  await page.evaluate(() => window.__game.ui && window.__game.ui.skyline && window.__game.ui.skyline.setPhase(0.95));
  await new Promise((r) => setTimeout(r, 300));
  await el.screenshot({ path: path.join(OUT, 'landmarks-night.png') });
  const info = await page.evaluate(() => ({
    landmarks: Array.from(document.querySelectorAll('[data-landmark]')).map((e) => e.dataset.landmark),
    hasSkylineApi: !!(window.__game.ui && window.__game.ui.skyline),
    errors: (window.__game.state.errors || []).length,
  }));
  console.log(JSON.stringify(info));
} finally {
  await browser.close();
}

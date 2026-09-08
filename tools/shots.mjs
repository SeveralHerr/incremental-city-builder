// Responsive screenshot tool: node tools/shots.mjs [--ticks 4000] [--tag name]
// Writes logs/shot-<tag>-<device>[-scrollN].png for phone (390x844 @2x), tablet (1024x1366),
// desktop (1440x900). Phone gets extra frames scrolled down the page.
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
const TICKS = Number(opt('--ticks', 4000));
const TAG = opt('--tag', 'ui');
const URL = opt('--url', 'http://localhost:5173');
const DEVICES = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, scrolls: 4 },
  landscape: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, scrolls: 2 },
  tablet: { width: 1024, height: 1366, deviceScaleFactor: 1, scrolls: 1 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, scrolls: 0 },
};
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
for (const [name, dev] of Object.entries(DEVICES)) {
  const p = await b.newPage();
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.setViewport({ width: dev.width, height: dev.height, deviceScaleFactor: dev.deviceScaleFactor, isMobile: !!dev.isMobile, hasTouch: !!dev.hasTouch });
  await p.goto(URL + '/?headless=1', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__game && window.__game.ready);
  if (TICKS > 0) {
    await p.evaluate((n) => {
      const g = window.__game;
      for (let i = 0; i < n; i += 100) {
        g.botStep();
        g.step(100);
      }
    }, TICKS);
  }
  await p.evaluate(() => new Promise((r) => { window.__game.start(); setTimeout(() => { window.__game.stop(); r(); }, 400); }));
  await p.screenshot({ path: path.join(ROOT, 'logs', `shot-${TAG}-${name}.png`) });
  for (let s = 1; s <= dev.scrolls; s++) {
    await p.evaluate((y) => window.scrollTo(0, y), s * dev.height * 0.9);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.screenshot({ path: path.join(ROOT, 'logs', `shot-${TAG}-${name}-scroll${s}.png`) });
  }
  const info = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight }));
  console.log(`[shots] ${name} ${dev.width}x${dev.height} scrollW=${info.sw}/${info.iw} pageH=${info.sh} errors=${errs.length}${errs.length ? ' ' + errs[0] : ''}`);
  await p.close();
}
await b.close();

// UI module: mounts the city stage (skyline + HUD + dock + sheet) and drives the render loop.
// The ONLY module that touches the DOM. Reads game.state / game.derived / game.api; never
// mutates game state directly (settings are the one exception — see setSetting).
import { reportError } from '../core/safe.js';
import { h, setNumFormat, money, fmtTime, num } from './dom.js';
import { loadContent } from './content.js';
import { createHud } from './hud.js';
import { createCityView } from './city.js';
import { createCityHall } from './cityhall.js';
import { createSheet } from './sheet.js';
import { createDock } from './dock.js';
import { createBuildPanel } from './build.js';
import { createUpgradesPanel } from './upgrades.js';
import { createMilestonesPanel } from './milestones.js';
import { createLogPanel } from './log.js';
import { createToasts } from './toast.js';
import { createModal, createSettingsModal } from './modal.js';
import { createUnlockAnnouncer } from './announce.js';
import { createSfx } from './sfx.js';
import { createRefreshGate } from './schedule.js';
import { createFullscreenPrompt, isFramed } from './embed.js';
import { nameList } from './text.js';

const REBUILD_EVERY = 30; // frames — safety net; events trigger immediate rebuilds
const REBUILD_EVENTS = ['buy', 'sell', 'upgrade', 'unlock', 'milestone', 'load', 'prestige', 'offline'];
// State changes outside a tick that need a panel pass but no list rebuild (schedule.js).
const REFRESH_EVENTS = ['tap', 'setting', 'brownout', 'catchup'];
// Dock pages, in dock order. `visible` hides a button until the game has opened that part of
// the city; `badge` is what the button shouts about (a count, `true` for a bare dot).
const PAGES = [
  { id: 'build', title: 'Build', icon: 'build', badge: (c) => c.rows.filter((r) => r.unlocked && r.affordable && r.count === 0 && !r.maxed).length },
  { id: 'upgrades', title: 'Upgrades', icon: 'spark', visible: (c) => !!c.s.unlocks['panel:upgrades'], badge: (c) => c.ups.filter((u) => u.unlocked && !u.owned && u.affordable && u.currency !== 'legacy').length },
  { id: 'goals', title: 'Goals', icon: 'goal' },
  { id: 'city', title: 'City hall', icon: 'hall', badge: (c) => c.hallReady },
];
const UNLOCK_TOAST_DELAY = 350; // ms — batch unlocks that land in the same burst into one toast
const UNLOCK_QUIET_MS = 1500; // ms — after a load or a founding, re-latched unlocks are not news
const PERF_WINDOW = 120; // frames in the rolling render-cost average

export async function init(game) {
  try {
    await mount(game);
  } catch (e) {
    reportError('ui', e);
    try {
      const app = document.getElementById('app');
      if (app) app.replaceChildren(h('div.boot-error', { text: 'Metropolis could not draw its dashboard. Check the console for details.' }));
    } catch {
      /* nothing left to do */
    }
  }
}

async function mount(game) {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app not found');
  // The shell must not be a live region: money, income and the clock change every frame and
  // would flood a screen reader. Announcements are scoped to the toast host (aria-live polite).
  app.removeAttribute('aria-live');
  app.removeAttribute('aria-atomic');
  const content = await loadContent();
  setNumFormat(game.state.settings?.numFormat);

  const gate = createRefreshGate({ every: REBUILD_EVERY });
  const ui = {
    game,
    content,
    newlyUnlocked: new Set(),
    // `dirty` is kept as a property for the panels that set it directly; the gate reads it
    // on the next frame (see render()).
    dirty: true,
    perf: { last: 0, avg: 0, max: 0, frames: 0, full: 0 },
    rebuild() {
      ui.dirty = true;
    },
    setSetting(key, value) {
      // Prefer an api action when one exists; otherwise settings are plain preferences.
      const r = game.api.action('setSetting', key, value);
      if (r === undefined) {
        if (!game.state.settings) game.state.settings = {};
        game.state.settings[key] = value;
      }
      if (key === 'numFormat') setNumFormat(value);
      ui.dirty = true;
    },
  };

  const hud = createHud(ui);
  const city = createCityView(ui);
  const build = createBuildPanel(ui);
  const upgrades = createUpgradesPanel(ui);
  const milestones = createMilestonesPanel(ui);
  const log = createLogPanel(ui);
  const hall = createCityHall(ui);

  // One stage: the city fills it, the HUD floats on the sky, the dock sits on the road and the
  // sheet slides up over the road when a dock button is pressed. Nothing else is chrome.
  const pageEls = { build: build.el, upgrades: upgrades.el, goals: milestones.el, city: h('div.page-body.page-city', [hall.el, log.el]) };
  const sheet = createSheet(ui, PAGES.map((p) => ({ id: p.id, title: p.title, el: pageEls[p.id] })));
  const dock = createDock(ui, PAGES.map((p) => ({ id: p.id, label: p.title, icon: p.icon, visible: p.visible, badge: p.badge })));
  ui.sheet = sheet;
  ui.openSheet = (id) => sheet.open(id);
  ui.toggleSheet = (id) => sheet.toggle(id);
  const stage = h('div.stage', [city.el, hud.el, dock.el, sheet.el]);
  app.replaceChildren(stage);
  // Opening a page must show live figures at once, not at the next tick.
  sheet.onChange((id) => {
    dock.setActive(id);
    stage.classList.toggle('is-sheet-open', id !== null);
    gate.mark();
  });

  // Toasts drop in over the middle of the sky: clear of the HUD's two top corners, clear of
  // the dock, and on the one surface where covering something costs the player nothing.
  ui.toasts = createToasts(stage);
  ui.modal = createModal(app);
  try {
    ui.sfx = createSfx(ui);
  } catch (e) {
    reportError('ui:sfx', e);
  }
  ui.settings = createSettingsModal(ui, ui.modal);
  // Inside an iframe (itch.io's embed) the layout fits the frame as it is; a small chip
  // offers fullscreen on first load and stays dismissed once tapped away (embed.js, F13).
  try {
    document.documentElement.classList.toggle('is-framed', isFramed());
    ui.fullscreen = createFullscreenPrompt(ui, stage);
  } catch (e) {
    reportError('ui:embed', e);
  }

  // ---- event wiring ----
  const ev = game.events;
  for (const name of REBUILD_EVENTS) ev.on(name, () => (ui.dirty = true));
  for (const name of REFRESH_EVENTS) ev.on(name, () => gate.mark());

  // Unlocks: mark cards for the reveal glow and announce them in one batched toast. The
  // announcer dedupes ids within a burst, announces each id once per session (later foundings
  // re-latch the same unlocks) and stays quiet right after a load or a founding.
  const announcer = createUnlockAnnouncer({
    delay: UNLOCK_TOAST_DELAY,
    suppressMs: UNLOCK_QUIET_MS,
    now: () => performance.now(),
    onFlush: showUnlockToast,
  });
  ui.announcer = announcer;
  ev.on('unlock', (p) => {
    if (!p || !p.id) return;
    // Panel gates ('panel:*') only need a rebuild; buildings and upgrades get a glow + toast.
    if (p.kind !== 'building' && p.kind !== 'upgrade') return;
    ui.newlyUnlocked.add(p.kind === 'upgrade' ? 'u:' + p.id : p.id);
    const def = p.kind === 'upgrade' ? game.registry.upgrades.get(p.id) : game.registry.buildings.get(p.id);
    if (!def) return;
    announcer.push(p.kind, def);
  });
  function showUnlockToast({ buildings: b, upgrades: u }) {
    if (b.length) {
      const first = b[0];
      ui.toasts.show({
        icon: first.icon || '🏗️',
        kind: 'unlock',
        title: b.length === 1 ? `New building: ${first.name}` : `${b.length} new buildings unlocked`,
        body: b.length === 1 ? first.desc || 'Now available in the build panel.' : nameList(b),
      });
    }
    if (u.length) {
      const perks = u.filter((d) => d.currency === 'legacy');
      const money = u.filter((d) => d.currency !== 'legacy');
      if (money.length) {
        const first = money[0];
        ui.toasts.show({
          icon: first.icon || '💡',
          kind: 'unlock',
          title: money.length === 1 ? `New upgrade: ${first.name}` : `${money.length} new upgrades available`,
          body: money.length === 1 ? first.desc || 'The planning office has a proposal.' : nameList(money),
        });
      }
      if (perks.length) {
        const first = perks[0];
        ui.toasts.show({
          icon: first.icon || '◆',
          kind: 'prestige',
          title: perks.length === 1 ? `Charter clause: ${first.name}` : `${perks.length} charter clauses open`,
          body: perks.length === 1 ? first.desc || 'Sign it with legacy in the Legacy panel.' : nameList(perks),
        });
      }
    }
  }
  // A loaded or imported save latches many unlocks at once; those are not news.
  ev.on('load', () => {
    setNumFormat(game.state.settings?.numFormat);
    ui.newlyUnlocked.clear();
    announcer.suppress();
  });
  ev.on('setting', (p) => {
    if (p && p.key === 'numFormat') setNumFormat(p.value);
    ui.dirty = true;
  });
  ev.on('milestone', (ms) => {
    if (!ms || !ms.name) return;
    ui.toasts.show({ icon: ms.icon || '🏁', kind: 'milestone', title: `Milestone: ${ms.name}`, body: ms.rewardText || ms.desc || '' });
  });
  ev.on('offline', (p) => {
    if (!p || !(p.seconds > 0)) return;
    ui.toasts.show({ icon: '🌙', kind: 'offline', title: 'While you were away', body: `${fmtTime(p.seconds)} passed. The city earned ${money(p.earned || 0)}.`, timeout: 9000 });
  });
  ev.on('prestige', (p) => {
    // The fresh plot re-latches the starter unlocks within a second; they are not news.
    announcer.suppress();
    const gain = p && Number.isFinite(p.gain) ? p.gain : 0;
    const legacy = p && Number.isFinite(p.legacy) ? p.legacy : game.state.prestige.legacy;
    ui.toasts.show({ icon: '🏙️', kind: 'prestige', title: 'A new city is founded', body: `+${num(gain)} legacy (${num(legacy)} total). The old skyline lives on in memory.`, timeout: 9000 });
  });

  // ---- render loop ----
  // Every frame: the HUD's number tweens and the skyline's sky/clouds (animation). Only on
  // frames where the simulation ticked or an event landed (schedule.js): the api row fetches,
  // the dock badges and whichever sheet page is open. Lists rebuild on their events or every
  // REBUILD_EVERY frames as a safety net. ui.perf.full counts the full passes.
  let lastT = 0;
  let frames = 0;
  let rendering = false;
  let rows = [];
  let ups = [];

  function render(t) {
    if (rendering) return;
    rendering = true;
    const t0 = performance.now();
    let full = false;
    try {
      const now = Number.isFinite(t) ? t : t0;
      let dt = lastT ? (now - lastT) / 1000 : 1 / 60;
      lastT = now;
      if (!(dt > 0)) dt = 1 / 60;
      frames++;

      if (ui.dirty) gate.dirty();
      const plan = gate.next({ tick: game.state.tick, frame: frames });
      hud.update(dt);
      city.animate(dt);
      if (plan.refresh) {
        full = true;
        rows = game.api.buildings();
        ups = game.api.upgrades();
        if (plan.rebuild) {
          ui.dirty = false;
          build.rebuild(rows);
          upgrades.rebuild(ups);
          milestones.rebuild();
          log.rebuild();
          city.setBuildings(rows);
          city.rebuild(ups);
          hall.rebuild(ups);
        }
        city.update();
        // Lists are always rebuilt (an unlock must be waiting when the sheet opens) but only
        // the page actually on screen redraws its numbers, so a closed sheet costs nothing.
        if (sheet.visible('build')) build.update(rows);
        if (sheet.visible('upgrades')) upgrades.update(ups);
        if (sheet.visible('goals')) milestones.update();
        if (sheet.visible('city')) {
          hall.update(ups);
          log.update();
        }
        dock.update({ s: game.state, d: game.derived, rows, ups, hallReady: hall.ready() });
      }
    } catch (e) {
      reportError('ui:render', e);
    } finally {
      rendering = false;
      const ms = performance.now() - t0;
      const p = ui.perf;
      p.last = ms;
      p.frames++;
      if (full) p.full++;
      p.avg += (ms - p.avg) / Math.min(p.frames, PERF_WINDOW);
      if (ms > p.max) p.max = ms;
    }
  }

  ev.on('frame', render);
  // The loop only emits 'frame' while running. Headless verify steps the sim manually and
  // then screenshots, so keep a fallback rAF that renders whenever the loop is idle.
  const fallback = (t) => {
    if (!game.loop || !game.loop.running) render(t);
    requestAnimationFrame(fallback);
  };
  requestAnimationFrame(fallback);
  render(performance.now());

  game.ui = ui;
  return ui;
}

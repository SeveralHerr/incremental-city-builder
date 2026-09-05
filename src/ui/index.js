// UI module: mounts the dashboard shell and drives the per-frame render loop.
// The ONLY module that touches the DOM. Reads game.state / game.derived / game.api; never
// mutates game state directly (settings are the one exception — see setSetting).
import { reportError } from '../core/safe.js';
import { h, setNumFormat, money, fmtTime, num } from './dom.js';
import { loadContent } from './content.js';
import { createTopbar } from './topbar.js';
import { createHero } from './hero.js';
import { createBuildPanel } from './build.js';
import { createUpgradesPanel } from './upgrades.js';
import { createMilestonesPanel } from './milestones.js';
import { createLogPanel } from './log.js';
import { createToasts } from './toast.js';
import { createModal, createSettingsModal } from './modal.js';
import { createUnlockAnnouncer } from './announce.js';
import { nameList } from './text.js';

const REBUILD_EVERY = 30; // frames — safety net; events trigger immediate rebuilds
const REBUILD_EVENTS = ['buy', 'sell', 'upgrade', 'unlock', 'milestone', 'load', 'prestige', 'offline'];
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

  const ui = {
    game,
    content,
    newlyUnlocked: new Set(),
    dirty: true,
    perf: { last: 0, avg: 0, max: 0, frames: 0 },
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

  const topbar = createTopbar(ui);
  const hero = createHero(ui);
  const build = createBuildPanel(ui);
  const upgrades = createUpgradesPanel(ui);
  const milestones = createMilestonesPanel(ui);
  const log = createLogPanel(ui);

  const right = h('section.col.col-side', [upgrades.el, milestones.el, log.el]);
  const main = h('main.layout', [hero.el, build.el, right]);
  const shell = h('div.shell', [topbar.el, main]);
  app.replaceChildren(shell);

  // Toasts live in the hero column (sticky to its bottom edge) so a burst can never sit on
  // top of the build column's Buy buttons or the sidebar's upgrade list.
  ui.toasts = createToasts(hero.el);
  ui.modal = createModal(app);
  ui.settings = createSettingsModal(ui, ui.modal);

  // ---- event wiring ----
  const ev = game.events;
  for (const name of REBUILD_EVENTS) ev.on(name, () => (ui.dirty = true));

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
  let lastT = 0;
  let frames = 0;
  let rendering = false;

  function render(t) {
    if (rendering) return;
    rendering = true;
    const t0 = performance.now();
    try {
      const now = Number.isFinite(t) ? t : t0;
      let dt = lastT ? (now - lastT) / 1000 : 1 / 60;
      lastT = now;
      if (!(dt > 0)) dt = 1 / 60;
      frames++;

      const rows = game.api.buildings();
      const ups = game.api.upgrades();
      if (ui.dirty || frames % REBUILD_EVERY === 0) {
        ui.dirty = false;
        build.rebuild(rows);
        upgrades.rebuild(ups);
        milestones.rebuild();
        log.rebuild();
        hero.setBuildings(rows);
        hero.rebuild(ups);
      }
      topbar.update(dt);
      hero.update(dt, ups);
      build.update(rows);
      upgrades.update(ups);
      milestones.update();
      log.update();
    } catch (e) {
      reportError('ui:render', e);
    } finally {
      rendering = false;
      const ms = performance.now() - t0;
      const p = ui.perf;
      p.last = ms;
      p.frames++;
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

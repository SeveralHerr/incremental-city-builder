// The city view: the whole screen. The skyline fills the stage, every bare patch of it is the
// collect button, and the only thing drawn on top here is the tap hint and the coin particles
// (readouts live in hud.js, controls in dock.js / sheet.js).
import { h, setHidden, setClass, money, prefersReducedMotion, fmtTime } from './dom.js';
import { createSkyline } from './skyline.js';

const MAX_PARTICLES = 24;
const HINT_TAPS = 5; // the 'tap the city' pill fades once the mayor has clearly got it
const HINT_POP = 50; // ... or once the town outgrows the tutorial (Village)
const HINT_SECONDS = 180; // ... or after three minutes at the keyboard without tapping

export function createCityView(ui) {
  const { game } = ui;

  const skylineHost = h('div.skyline-host');
  const particles = h('div.particles', { 'aria-hidden': 'true' });
  // A returning mayor who has already tapped never sees the pill flash and fade: the done
  // state is set before the element is attached, so no transition runs on first paint.
  const hintDone = ((game.state.stats && game.state.stats.clicks) || 0) >= HINT_TAPS;
  const hint = h(`div.city-hint${hintDone ? '.is-done' : ''}`, { hidden: hintDone }, [h('span.city-hint-key', { text: 'tap' }), h('span', { text: 'the city to collect' })]);
  const el = h('div.city-view', { role: 'button', tabindex: '0', 'aria-label': 'Tap the city to collect money' }, [skylineHost, hint, particles]);
  const skyline = createSkyline(skylineHost, ui);
  ui.skyline = skyline;

  function tap(clientX, clientY) {
    const before = game.state.res.money;
    const r = game.api.action('tap');
    const gained = game.state.res.money - before;
    if (r === undefined && gained <= 0) return; // simulation not loaded yet
    if (gained > 0) spawnParticle(clientX, clientY, '+' + money(gained));
    if (!prefersReducedMotion()) {
      el.classList.remove('is-tapped');
      void el.offsetWidth; // restart animation
      el.classList.add('is-tapped');
    }
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    tap(e.clientX, e.clientY);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      tap(r.left + r.width / 2, r.top + r.height / 2);
    }
  });

  function spawnParticle(clientX, clientY, text) {
    while (particles.children.length >= MAX_PARTICLES) particles.firstChild.remove();
    const r = el.getBoundingClientRect();
    const p = h('span.particle', { text });
    const drift = (Math.random() - 0.5) * 40;
    p.style.left = `${Math.round(clientX - r.left)}px`;
    p.style.top = `${Math.round(clientY - r.top)}px`;
    p.style.setProperty('--drift', `${drift.toFixed(0)}px`);
    particles.append(p);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      p.remove();
    };
    p.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, prefersReducedMotion() ? 500 : 1100);
  }

  let lastRows = [];
  let ownedUpgrades = [];
  function setBuildings(list) {
    lastRows = list || [];
    skyline.update(lastRows, ownedUpgrades);
  }

  // Owned upgrades feed the skyline's landmarks (ferris wheel, monorail, pylons...).
  function rebuild(upgradeRows) {
    const ids = (upgradeRows || []).filter((u) => u && u.owned).map((u) => u.id);
    if (ids.join('|') !== ownedUpgrades.join('|')) {
      ownedUpgrades = ids;
      skyline.update(lastRows, ownedUpgrades);
    }
  }

  // Every frame: the sky, clouds and windmills keep moving between ticks.
  function animate(dt) {
    skyline.tick(dt);
  }

  let hintHidden = hintDone;
  function update() {
    const s = game.state;
    const clicks = (s.stats && s.stats.clicks) || 0;
    // The pill also retires for a pure idler: once the town has fifty citizens or three minutes
    // at the keyboard have passed, tapping is a bonus the player has chosen to skip.
    const outgrown = s.res.pop >= HINT_POP || ((s.stats && s.stats.playtime) || 0) >= HINT_SECONDS;
    if (!hintHidden) {
      setClass(hint, 'is-done', clicks >= HINT_TAPS || outgrown);
      if (clicks >= HINT_TAPS || outgrown) {
        hintHidden = true;
        setTimeout(() => setHidden(hint, hintHidden), prefersReducedMotion() ? 0 : 650);
      }
    } else if (clicks < HINT_TAPS && !outgrown) {
      // A fresh plot after a hard reset brings the pill back.
      hintHidden = false;
      hint.classList.remove('is-done');
      setHidden(hint, false);
    }
  }

  return { el, animate, update, rebuild, setBuildings, spawnParticle, playtime: () => fmtTime(game.state.stats.playtime) };
}

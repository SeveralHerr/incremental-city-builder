// Sound effects: a tiny Web Audio synth, no asset files. Gated by state.settings.sfx and by the
// first user gesture (browsers refuse to start audio before one), so headless verify and the
// bot never make a sound. Bursts (bulk buys, a load's unlock flood) are rate-limited, and the
// 1.5 s after a load or founding is muted except for the founding fanfare itself.
export function createSfx(ui) {
  const { game } = ui;
  let ctx = null;
  let master = null;
  let unlocked = false;
  let muteUntil = 0;
  const last = new Map();

  const enabled = () => !!(game.state.settings && game.state.settings.sfx !== false);

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  for (const t of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(t, unlock, { once: true, passive: true });

  function tone({ f = 440, f2 = null, type = 'sine', dur = 0.12, vol = 1, delay = 0 }) {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  const SOUNDS = {
    tap: () => tone({ f: 660, f2: 880, dur: 0.07, vol: 0.45 }),
    buy: () => {
      tone({ f: 523, dur: 0.08, vol: 0.55 });
      tone({ f: 784, dur: 0.1, vol: 0.45, delay: 0.06 });
    },
    sell: () => tone({ f: 440, f2: 330, type: 'triangle', dur: 0.12, vol: 0.45 }),
    upgrade: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.12, vol: 0.45, delay: i * 0.055 })),
    unlock: () => tone({ f: 880, f2: 1320, type: 'triangle', dur: 0.18, vol: 0.35 }),
    milestone: () => [659, 784, 988, 1319].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.2, vol: 0.5, delay: i * 0.08 })),
    prestige: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.35, vol: 0.55, delay: i * 0.09 })),
    denied: () => tone({ f: 220, f2: 180, type: 'square', dur: 0.09, vol: 0.2 }),
  };

  function play(kind) {
    if (!enabled() || !unlocked || !SOUNDS[kind]) return;
    const now = performance.now();
    if (kind !== 'prestige' && now < muteUntil) return;
    if (now - (last.get(kind) || 0) < 45) return;
    last.set(kind, now);
    try {
      SOUNDS[kind]();
    } catch {
      /* audio is decoration; never let it throw into the game */
    }
  }

  const ev = game.events;
  ev.on('buy', () => play('buy'));
  ev.on('sell', () => play('sell'));
  ev.on('upgrade', () => play('upgrade'));
  ev.on('unlock', () => play('unlock'));
  ev.on('milestone', () => play('milestone'));
  ev.on('tap', () => play('tap'));
  ev.on('load', () => {
    muteUntil = performance.now() + 1500;
  });
  ev.on('prestige', () => {
    muteUntil = performance.now() + 1500;
    play('prestige');
  });

  return { play, enabled };
}

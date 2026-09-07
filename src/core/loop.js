// Fixed-step tick loop. 10 ticks/sec. rAF-driven accumulator in browser; step(n) anywhere.
import { state, derived, sanitize } from './state.js';
import { registry } from './registry.js';
import { emit } from './events.js';

export const TICK_MS = 100;
export const DT = TICK_MS / 1000;
const MAX_CATCHUP = 50; // ticks per frame; more than this => offline progress path
const MAX_SKIPPED_MS = 24 * 3600 * 1000; // parked time is capped at a day
const SKIP_GRACE_MS = 3000; // unclaimed skippedMs older than this is drained by the loop itself
const RING = 600;

export const loop = {
  running: false,
  accumulator: 0,
  lastFrame: 0,
  speed: 1,
  stats: {
    tickMs: new Float32Array(RING),
    idx: 0,
    count: 0,
    lastTickMs: 0,
    frames: 0,
    lastFps: 0,
  },
  skippedMs: 0, // time we refused to catch up (handed to save/offline)
  skippedAt: 0, // frame timestamp when skippedMs last went from 0 to > 0
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function tick() {
  const t0 = now();
  state.tick++;
  state.time += DT;
  state.stats.playtime += DT;
  const handlers = registry.tickHandlers;
  for (let i = 0; i < handlers.length; i++) handlers[i].fn(state, derived, DT);
  if ((state.tick & 63) === 0) sanitize();
  emit('tick', state);
  const ms = now() - t0;
  const s = loop.stats;
  s.tickMs[s.idx] = ms;
  s.idx = (s.idx + 1) % RING;
  s.count++;
  s.lastTickMs = ms;
}

// Run n ticks synchronously. Used by tools/bot/offline progress.
export function step(n = 1) {
  n = Math.max(0, Math.floor(n));
  for (let i = 0; i < n; i++) tick();
  return state.tick;
}

export function tickStats() {
  const s = loop.stats;
  const n = Math.min(s.count, RING);
  if (n === 0) return { avg: 0, p99: 0, max: 0, n: 0 };
  const arr = Array.from(s.tickMs.subarray(0, n)).sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  return { avg: sum / n, p99: arr[Math.min(n - 1, Math.floor(n * 0.99))], max: arr[n - 1], n };
}

let rafId = 0;
let intervalId = 0;
let fpsWindowStart = 0;
let fpsFrames = 0;

function frame(t) {
  if (!loop.running) return;
  rafId = requestAnimationFrame(frame);
  if (!loop.lastFrame) loop.lastFrame = t;
  let elapsed = (t - loop.lastFrame) * loop.speed;
  loop.lastFrame = t;
  if (elapsed < 0) elapsed = 0;
  loop.accumulator += elapsed;
  let ticks = Math.floor(loop.accumulator / TICK_MS);
  if (ticks > MAX_CATCHUP) {
    if (!loop.skippedMs) loop.skippedAt = t;
    loop.skippedMs = Math.min(MAX_SKIPPED_MS, loop.skippedMs + (ticks - MAX_CATCHUP) * TICK_MS);
    ticks = MAX_CATCHUP;
    loop.accumulator = ticks * TICK_MS;
  }
  // Normally `save` claims skippedMs on the next frame (quiet catch-up / offline path). If no
  // consumer has claimed it within the grace window (save module failed to load), drain it
  // ourselves in MAX_CATCHUP-sized batches so it never grows unbounded.
  loop.accumulator -= ticks * TICK_MS;
  if (loop.skippedMs > 0 && ticks < MAX_CATCHUP && t - loop.skippedAt >= SKIP_GRACE_MS) {
    const extra = Math.min(MAX_CATCHUP - ticks, Math.floor(loop.skippedMs / TICK_MS));
    loop.skippedMs -= extra * TICK_MS;
    if (loop.skippedMs < TICK_MS) loop.skippedMs = 0;
    ticks += extra;
  }
  if (ticks > 0) step(ticks);
  loop.stats.frames++;
  fpsFrames++;
  if (t - fpsWindowStart >= 1000) {
    loop.stats.lastFps = (fpsFrames * 1000) / (t - fpsWindowStart);
    fpsWindowStart = t;
    fpsFrames = 0;
  }
  emit('frame', t);
}

export function start() {
  if (loop.running) return;
  loop.running = true;
  loop.lastFrame = 0;
  loop.accumulator = 0;
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(frame);
  } else {
    // Node fallback (not used by tools, but keeps start() safe).
    intervalId = setInterval(() => {
      if (!loop.running) return stop();
      step(1);
    }, TICK_MS);
  }
}

export function stop() {
  loop.running = false;
  if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = 0;
  if (intervalId) clearInterval(intervalId);
  intervalId = 0;
}

// Unlock announcements: decides which newly unlocked buildings/upgrades deserve a toast.
// Pure bookkeeping (no DOM) so ui.test.mjs can drive it:
//   - a burst is collected for `delay` ms and keyed by id, so one id never counts twice;
//   - every id is announced at most once per session — a later founding re-latches the same
//     unlocks and core emits 'unlock' again, which is not news;
//   - bursts are dropped for `suppressMs` after a save load or a founding.
// Public shape: createUnlockAnnouncer({ delay, suppressMs, now, schedule, cancel, onFlush })
//   -> { push(kind, def) -> boolean, suppress(), flush(), pending(), announced: Set, reset() }
export function createUnlockAnnouncer({
  delay = 350,
  suppressMs = 1500,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (h) => clearTimeout(h),
  onFlush = null,
} = {}) {
  const pending = { building: new Map(), upgrade: new Map() };
  const announced = new Set();
  let suppressUntil = -Infinity;
  let timer = null;

  function key(kind, id) {
    return (kind === 'upgrade' ? 'u:' : 'b:') + id;
  }

  // Returns true when the unlock was queued for a toast.
  function push(kind, def) {
    if (!def || !def.id) return false;
    if (kind !== 'building' && kind !== 'upgrade') return false;
    const k = key(kind, def.id);
    if (announced.has(k)) return false;
    announced.add(k);
    if (now() < suppressUntil) return false;
    pending[kind].set(def.id, def);
    if (timer === null) timer = schedule(flush, delay);
    return true;
  }

  function suppress() {
    suppressUntil = now() + suppressMs;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    pending.building.clear();
    pending.upgrade.clear();
  }

  function flush() {
    timer = null;
    const buildings = Array.from(pending.building.values());
    const upgrades = Array.from(pending.upgrade.values());
    pending.building.clear();
    pending.upgrade.clear();
    if (!buildings.length && !upgrades.length) return null;
    const batch = { buildings, upgrades };
    if (typeof onFlush === 'function') onFlush(batch);
    return batch;
  }

  function reset() {
    announced.clear();
    suppress();
    suppressUntil = -Infinity;
  }

  return {
    push,
    suppress,
    flush,
    reset,
    announced,
    pending: () => ({ buildings: pending.building.size, upgrades: pending.upgrade.size }),
    isSuppressed: () => now() < suppressUntil,
  };
}

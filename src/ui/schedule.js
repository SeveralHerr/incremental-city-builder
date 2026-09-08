// Render scheduling: which parts of a frame need work. Pure (no DOM) so ui.test.mjs covers it.
//
// The simulation mutates state only inside a tick (10 Hz), and every other mutation path —
// buy / sell / upgrade / tap / prestige / load / offline / setting — emits an event. So the
// panels that draw state (build cards, upgrade cards, milestones, log, hero stats) only need a
// pass on frames where the tick advanced or such an event landed; the frames in between (five
// of every six at 60 fps) only need the topbar's tweens and the skyline's animation. The api
// row fetches (`api.buildings()`, `api.upgrades()` — ~0.2 ms of spread objects per call pair)
// follow the same gate. A periodic safety net (`every` frames) forces both a refresh and a
// list rebuild so a missed event can never leave a panel stale for more than half a second.
//
// createRefreshGate({ every }) -> gate
//   gate.mark()                     an event landed: next frame refreshes
//   gate.dirty()                    a list must be rebuilt (buy/unlock/…): next frame rebuilds + refreshes
//   gate.next({ tick, frame })      -> { refresh, rebuild } and clears the flags it consumed
export function createRefreshGate({ every = 30 } = {}) {
  let stale = true; // first frame always draws
  let dirty = true;
  let lastTick = null;
  const gate = {
    mark() {
      stale = true;
    },
    dirty() {
      dirty = true;
      stale = true;
    },
    isDirty: () => dirty,
    next({ tick, frame }) {
      const periodic = Number.isFinite(every) && every > 0 && Number.isFinite(frame) && frame % every === 0;
      const ticked = tick !== lastTick;
      const rebuild = dirty || periodic;
      const refresh = rebuild || stale || ticked;
      if (refresh) {
        lastTick = tick;
        stale = false;
      }
      if (rebuild) dirty = false;
      return { refresh, rebuild };
    },
  };
  return gate;
}

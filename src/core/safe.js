// Fault isolation: wrap module callbacks so a throwing upgrade/building/handler/listener is
// logged and disabled instead of crashing the tick loop.
import { errors, state } from './state.js';

const MAX_ERRORS = 200;
export const DISABLE_AFTER = 3; // consecutive failures before an item is disabled
export const DISABLE_AFTER_TOTAL = 10; // failures inside one WINDOW of calls (intermittent thrower)
export const WINDOW = 500; // calls per failure-counting window
const CONSOLE_REPEAT_EVERY = 100; // repeats of one message re-surface in the console this often

// Log an error. Repeats of the same `module` + message never push a new entry: the existing
// entry's `count`/`tick`/`t` are updated instead, so one noisy source cannot evict every other
// diagnostic from the 200-entry ring. Returns the entry.
export function reportError(module, err) {
  const msg = err && err.message ? err.message : String(err);
  for (let i = errors.length - 1; i >= 0; i--) {
    const e = errors[i];
    if (e.module === module && e.msg === msg) {
      e.count++;
      e.t = state.time;
      e.tick = state.tick;
      if (typeof console !== 'undefined' && e.count % CONSOLE_REPEAT_EVERY === 0) {
        console.error(`[${module}] ${msg} (x${e.count})`);
      }
      return e;
    }
  }
  const entry = {
    t: state.time,
    tick: state.tick,
    module,
    msg,
    count: 1,
    stack: err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('\n') : '',
  };
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
  // Surface in console so headless verify sees it (a real bug must fail the gate).
  if (typeof console !== 'undefined') console.error(`[${module}] ${msg}`);
  return entry;
}

// Returns a guarded function. `owner` is a label like "upgrade:solar-1".
// Disabled after DISABLE_AFTER consecutive failures, or after DISABLE_AFTER_TOTAL failures
// within any window of WINDOW calls (so a thrower that succeeds every other call is still
// cut off instead of spamming forever).
export function guard(owner, fn) {
  let fails = 0; // consecutive
  let windowFails = 0; // within the current window
  let calls = 0;
  let disabled = false;
  const wrapped = function guarded(...args) {
    if (disabled) return undefined;
    if (++calls >= WINDOW) {
      calls = 0;
      windowFails = 0;
    }
    try {
      const r = fn.apply(this, args);
      fails = 0;
      return r;
    } catch (e) {
      fails++;
      windowFails++;
      reportError(owner, e);
      if (fails >= DISABLE_AFTER) {
        disabled = true;
        reportError(owner, new Error(`disabled after ${fails} consecutive failures`));
      } else if (windowFails >= DISABLE_AFTER_TOTAL) {
        disabled = true;
        reportError(owner, new Error(`disabled after ${windowFails} failures within ${WINDOW} calls`));
      }
      return undefined;
    }
  };
  wrapped.isDisabled = () => disabled;
  wrapped.reset = () => {
    fails = 0;
    windowFails = 0;
    calls = 0;
    disabled = false;
  };
  return wrapped;
}

// One-off safe call with fallback value.
export function safeCall(owner, fn, fallback) {
  try {
    return fn();
  } catch (e) {
    reportError(owner, e);
    return fallback;
  }
}

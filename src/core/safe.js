// Fault isolation: wrap module callbacks so a throwing upgrade/building/handler is
// logged and disabled instead of crashing the tick loop.
import { errors, state } from './state.js';

const MAX_ERRORS = 200;
const DISABLE_AFTER = 3; // consecutive failures before an item is disabled

export function reportError(module, err) {
  const entry = {
    t: state.time,
    tick: state.tick,
    module,
    msg: err && err.message ? err.message : String(err),
    stack: err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('\n') : '',
  };
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
  // Surface in console so headless verify sees it (a real bug must fail the gate).
  if (typeof console !== 'undefined') console.error(`[${module}] ${entry.msg}`);
  return entry;
}

// Returns a guarded function. `owner` is a label like "upgrade:solar-1".
export function guard(owner, fn) {
  let fails = 0;
  let disabled = false;
  const wrapped = function guarded(...args) {
    if (disabled) return undefined;
    try {
      const r = fn.apply(this, args);
      fails = 0;
      return r;
    } catch (e) {
      fails++;
      reportError(owner, e);
      if (fails >= DISABLE_AFTER) {
        disabled = true;
        reportError(owner, new Error(`disabled after ${fails} consecutive failures`));
      }
      return undefined;
    }
  };
  wrapped.isDisabled = () => disabled;
  wrapped.reset = () => {
    fails = 0;
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

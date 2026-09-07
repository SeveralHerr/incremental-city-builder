// Tiny event bus. Every listener is guarded (see safe.js): an exception is logged, and a
// listener that keeps throwing is disabled, so one bad listener never breaks the game and
// never floods the error log at frame rate.
import { guard, reportError } from './safe.js';

const listeners = new Map(); // name -> Map(originalFn -> guardedFn)

export function on(name, fn) {
  if (typeof fn !== 'function') {
    reportError('events:' + name, new Error('listener must be a function'));
    return () => {};
  }
  if (!listeners.has(name)) listeners.set(name, new Map());
  const set = listeners.get(name);
  if (!set.has(fn)) set.set(fn, guard('events:' + name, fn));
  return () => off(name, fn);
}

export function off(name, fn) {
  listeners.get(name)?.delete(fn);
}

export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set.values()) fn(payload);
}

// Test/diagnostic hook: is the given listener currently disabled by its guard?
export function isListenerDisabled(name, fn) {
  const g = listeners.get(name)?.get(fn);
  return g ? g.isDisabled() : false;
}

export function listenerCount(name) {
  return listeners.get(name)?.size ?? 0;
}

// Tiny event bus. Listener errors are caught so one bad listener never breaks the game.
import { reportError } from './safe.js';

const listeners = new Map();

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => off(name, fn);
}

export function off(name, fn) {
  listeners.get(name)?.delete(fn);
}

export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (e) {
      reportError('events:' + name, e);
    }
  }
}

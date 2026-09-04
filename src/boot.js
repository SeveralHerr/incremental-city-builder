// Loads DOM-free modules defensively. Used by browser main.js AND Node tools.
import { reportError } from './core/safe.js';
import { state, derived, errors } from './core/state.js';
import { registry } from './core/registry.js';
import { api } from './core/api.js';
import { loop, step, start, stop, tickStats } from './core/loop.js';
import { botStep } from './core/bot.js';
import * as events from './core/events.js';

// Order matters only for balance (config) — everything else is registry-driven.
const CONTENT_MODULES = [
  './balance/index.js',
  './resources/index.js',
  './buildings/index.js',
  './upgrades/index.js',
  './simulation/index.js',
];

export const game = {
  state,
  derived,
  errors,
  registry,
  api,
  loop,
  step,
  start,
  stop,
  tickStats,
  botStep,
  events,
  modules: {}, // name -> 'ok' | 'failed'
  ready: false,
};

export async function boot() {
  for (const path of CONTENT_MODULES) {
    const name = path.split('/')[1];
    try {
      const mod = await import(path);
      if (typeof mod.init === 'function') await mod.init(game);
      game.modules[name] = 'ok';
    } catch (e) {
      game.modules[name] = 'failed';
      reportError('boot:' + name, e);
    }
  }
  return game;
}

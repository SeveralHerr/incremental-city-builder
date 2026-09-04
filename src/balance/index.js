// balance module — re-exports the tuning config. Holds no state and registers nothing.
// DOM-free. See ./config.js for every knob and its effect on pacing.
export { config, costGrowthFor } from './config.js';

/** No-op: balance is pure data; other modules import `config` directly. */
export function init(game) {}

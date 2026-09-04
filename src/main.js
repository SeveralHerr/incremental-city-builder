// Browser bootstrap. Loads content, then save + ui (DOM modules), starts loop.
import { boot, game } from './boot.js';
import { reportError } from './core/safe.js';

const params = new URLSearchParams(location.search);
game.headless = params.has('headless');
game.params = params;
window.__game = game;

async function loadDom(path, name) {
  try {
    const mod = await import(path);
    if (typeof mod.init === 'function') await mod.init(game);
    game.modules[name] = 'ok';
  } catch (e) {
    game.modules[name] = 'failed';
    reportError('boot:' + name, e);
  }
}

(async () => {
  await boot();
  await loadDom('./save/index.js', 'save');
  await loadDom('./ui/index.js', 'ui');
  if (!game.headless || params.has('run')) game.start();
  game.ready = true;
  document.documentElement.classList.add('ready');
  game.events.emit('ready', game);
})();

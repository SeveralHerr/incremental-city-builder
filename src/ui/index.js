// ui module — stub, replaced by builder.
export function init(game) {
  const app = document.getElementById('app');
  app.innerHTML = '<div style="padding:24px;font:16px system-ui;color:#ccc">Metropolis — loading modules… (UI stub) money: <span id="m">0</span></div>';
  game.events.on('frame', () => { document.getElementById('m').textContent = game.state.res.money.toFixed(0); });
}

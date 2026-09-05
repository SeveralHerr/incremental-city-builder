// Top bar: brand + city tier, resource chips (money, population, power, happiness), settings.
import { h, icon, setText, setClass, setHidden, setProgress, tween, money, num, moneyRate, fmtPct, fmtTime } from './dom.js';
import { tierTitle, moodWord } from './content.js';
import { powerChipText } from './text.js';

export function createTopbar(ui) {
  const { game } = ui;

  const chip = (id, emoji, label, cls) => {
    const value = h('span.chip-value.mono', { text: '—' });
    const sub = h('span.chip-sub.mono', { text: '' });
    const el = h(`div.chip.chip-${id}${cls ? '.' + cls : ''}`, { role: 'group', 'aria-label': label }, [
      h('span.chip-icon', { text: emoji, 'aria-hidden': 'true' }),
      h('div.chip-body', [h('span.chip-label', { text: label }), value, sub]),
    ]);
    return { el, value, sub };
  };

  const moneyChip = chip('money', '💵', 'Money');
  const popChip = chip('pop', '👥', 'Population');
  const powerChip = chip('power', '⚡', 'Power');
  const happyChip = chip('happy', '😊', 'Happiness');

  const powerFill = h('div.progress-fill');
  const powerBar = h('div.progress.progress-xs.power-bar', { 'aria-hidden': 'true' }, [powerFill]);
  // Narrow widths hide the sub-line; a compact '+18' / '72%' figure keeps the chip readable.
  powerChip.short = h('span.chip-short.mono', { text: '', 'aria-hidden': 'true' });
  powerChip.el.append(powerChip.short, powerBar);
  powerChip.el.hidden = true;
  happyChip.el.hidden = true;

  const tierEl = h('span.brand-tier', { text: 'Hamlet' });
  const clockEl = h('span.brand-clock.mono', { text: '0s' });
  const settingsBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Settings', title: 'Settings' }, [icon('gear')]);
  settingsBtn.addEventListener('click', () => ui.settings && ui.settings.open());

  const el = h('header.topbar', [
    h('div.brand', [
      h('div.brand-mark', { html: iconLogo() }),
      h('div.brand-text', [h('span.brand-name', { text: 'Metropolis' }), h('span.brand-sub', [tierEl, h('span.dot', { 'aria-hidden': 'true' }), clockEl])]),
    ]),
    h('div.chips', [moneyChip.el, popChip.el, powerChip.el, happyChip.el]),
    h('div.topbar-actions', [settingsBtn]),
  ]);

  const tw = { money: tween(0), pop: tween(0), income: tween(0) };
  let lastTier = '';

  function update(dt) {
    const s = game.state;
    const d = game.derived;
    const m = tw.money.update(s.res.money, dt);
    const inc = tw.income.update(d.income, dt, { rate: 6 });
    setText(moneyChip.value, money(m));
    setText(moneyChip.sub, moneyRate(inc));
    setClass(moneyChip.el, 'is-negative', d.income < 0);

    const pop = tw.pop.update(s.res.pop, dt);
    setText(popChip.value, num(Math.floor(pop)));
    const housing = Math.floor(d.housing || 0);
    setText(popChip.sub, housing > 0 ? `of ${num(housing)} housing` : 'no housing yet');
    setClass(popChip.el, 'is-warn', housing > 0 && s.res.pop > housing * 1.02);

    const showPower = !!s.unlocks['panel:power'];
    setHidden(powerChip.el, !showPower);
    if (showPower) {
      const cap = d.powerCap || 0;
      const dem = d.powerDemand || 0;
      const ratio = d.powerRatio ?? 1;
      const txt = powerChipText(cap, dem, ratio);
      setText(powerChip.value, txt.value);
      setText(powerChip.sub, txt.sub);
      setText(powerChip.short, txt.short);
      setProgress(powerFill, dem > 0 ? Math.min(1, cap / dem) : 1);
      setClass(powerChip.el, 'is-warn', ratio < 1 && ratio >= 0.6);
      setClass(powerChip.el, 'is-bad', ratio < 0.6);
    }

    const showHappy = !!s.unlocks['panel:civic'];
    setHidden(happyChip.el, !showHappy);
    if (showHappy) {
      const hp = d.happiness ?? 1;
      setText(happyChip.value, fmtPct(hp));
      setText(happyChip.sub, moodWord(hp));
      setClass(happyChip.el, 'is-warn', hp < 0.9);
      setClass(happyChip.el, 'is-bad', hp < 0.6);
      setClass(happyChip.el, 'is-good', hp >= 1.3);
    }

    const tier = tierTitle(s.res.pop);
    if (tier !== lastTier) {
      lastTier = tier;
      setText(tierEl, tier);
    }
    setText(clockEl, fmtTime(s.stats.playtime));
  }

  return { el, update };
}

function iconLogo() {
  return '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><defs><linearGradient id="lg-brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="#0f172a" stroke="rgba(255,255,255,.12)"/><path d="M6 26V14h6v12zm8 0V8h6v18zm8 0V17h4v9z" fill="url(#lg-brand)"/></svg>';
}

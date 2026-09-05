// Hero column: clickable city view (skyline + tap particles), next-milestone card,
// prestige card (gated by panel:prestige), city stats card (gated by panel:stats).
import { h, icon, setText, setHidden, setProgress, setClass, setDisabled, money, num, short, fmtPct, fmtTime, fmtInt, reducedMotion } from './dom.js';
import { createSkyline } from './skyline.js';
import { milestoneProgress, nextMilestones } from './milestones.js';
import { tierTitle, nextTier } from './content.js';

const MAX_PARTICLES = 24;
const HINT_TAPS = 5; // the 'tap the city' pill fades once the mayor has clearly got it

export function createHero(ui) {
  const { game } = ui;

  // ---- City view ----
  const skylineHost = h('div.skyline-host');
  const particles = h('div.particles', { 'aria-hidden': 'true' });
  const cityTier = h('span.city-tier', { text: 'Hamlet' });
  const cityPop = h('span.city-pop.mono', { text: '0 citizens' });
  const hint = h('div.city-hint', [h('span.city-hint-key', { text: 'tap' }), h('span', { text: 'the city to collect' })]);
  const cityView = h('div.city-view', { role: 'button', tabindex: '0', 'aria-label': 'Tap the city to collect money' }, [
    skylineHost,
    h('div.city-overlay', [h('div.city-name', { text: 'Metropolis' }), h('div.city-meta', [cityTier, h('span.dot', { 'aria-hidden': 'true' }), cityPop])]),
    hint,
    particles,
  ]);
  const skyline = createSkyline(skylineHost, ui);
  ui.skyline = skyline;

  function tap(clientX, clientY) {
    const before = game.state.res.money;
    const r = game.api.action('tap');
    const gained = game.state.res.money - before;
    if (r === undefined && gained <= 0) return; // simulation not loaded yet
    if (gained > 0) spawnParticle(clientX, clientY, '+' + money(gained));
    if (!reducedMotion) {
      cityView.classList.remove('is-tapped');
      void cityView.offsetWidth; // restart animation
      cityView.classList.add('is-tapped');
    }
  }
  cityView.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    tap(e.clientX, e.clientY);
  });
  cityView.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const r = cityView.getBoundingClientRect();
      tap(r.left + r.width / 2, r.top + r.height / 2);
    }
  });

  function spawnParticle(clientX, clientY, text) {
    while (particles.children.length >= MAX_PARTICLES) particles.firstChild.remove();
    const r = cityView.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const p = h('span.particle.mono', { text });
    const drift = (Math.random() - 0.5) * 40;
    p.style.left = `${Math.round(x)}px`;
    p.style.top = `${Math.round(y)}px`;
    p.style.setProperty('--drift', `${drift.toFixed(0)}px`);
    particles.append(p);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      p.remove();
    };
    p.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, reducedMotion ? 500 : 1100);
  }

  // ---- Next milestone ----
  const nextIcon = h('span.next-icon', { text: '🏁', 'aria-hidden': 'true' });
  const nextName = h('div.next-name', { text: '' });
  const nextDesc = h('div.next-desc', { text: '' });
  const nextPct = h('span.panel-meta.mono', { text: '' });
  const nextFill = h('div.progress-fill');
  const nextBar = h('div.progress', { 'aria-hidden': 'true' }, [nextFill]);
  const nextReward = h('div.next-reward', { text: '' });
  const nextPanel = h('section.panel.panel-next', [
    h('div.panel-head', [h('h2.panel-title', { text: 'Next milestone' }), nextPct]),
    h('div.next-row', [nextIcon, h('div.next-body', [nextName, nextDesc])]),
    nextBar,
    nextReward,
  ]);

  // ---- Prestige card (gated by panel:prestige) ----
  const legacyVal = h('span.stat-value.mono', { text: '0' });
  const gainVal = h('span.stat-value.mono', { text: '+0' });
  const bonusVal = h('span.stat-value.mono', { text: '+0%' });
  const prestigePct = h('span.panel-meta.mono', { text: '' });
  const prestigeFill = h('div.progress-fill');
  const prestigeBar = h('div.progress.prestige-bar', { 'aria-hidden': 'true' }, [prestigeFill]);
  const prestigeBarLabel = h('div.prestige-bar-label', [h('span', { text: 'Total earned' }), h('span.mono', { text: '' })]);
  const prestigeBtn = h('button.btn.btn-prestige', { type: 'button' }, [icon('flag'), h('span', { text: 'Found a new city' })]);
  const prestigeNote = h('p.prestige-note', { text: '' });
  const confirmText = h('span.confirm-text', { text: '' });
  const prestigeConfirm = h('div.confirm-row', { hidden: true }, [
    confirmText,
    h('div.btn-row', [
      h('button.btn.btn-prestige.is-ready', { type: 'button', text: 'Found it', onclick: () => {
        setHidden(prestigeConfirm, true);
        setHidden(prestigeBtn, false);
        game.api.prestige();
        ui.rebuild();
      } }),
      h('button.btn.btn-ghost', { type: 'button', text: 'Not yet', onclick: () => {
        setHidden(prestigeConfirm, true);
        setHidden(prestigeBtn, false);
      } }),
    ]),
  ]);
  prestigeBtn.addEventListener('click', () => {
    if (!game.api.canPrestige()) return;
    const gain = game.api.prestigeGain();
    setText(confirmText, `Pack up the mayor’s office? Buildings, upgrades and money reset. You keep ${num(gain)} new legacy plus everything earned before.`);
    setHidden(prestigeBtn, true);
    setHidden(prestigeConfirm, false);
  });
  const prestigePanel = h('section.panel.panel-prestige', { hidden: true }, [
    h('div.panel-head', [h('h2.panel-title', { text: 'Legacy' }), prestigePct]),
    prestigeBarLabel,
    prestigeBar,
    h('div.stat-grid', [
      h('div.stat', [h('span.stat-label', { text: 'Legacy points' }), legacyVal]),
      h('div.stat', [h('span.stat-label', { text: 'On founding' }), gainVal]),
      h('div.stat', [h('span.stat-label', { text: 'Income bonus' }), bonusVal]),
    ]),
    prestigeBtn,
    prestigeConfirm,
    prestigeNote,
  ]);

  // ---- City stats (gated by panel:stats) ----
  const statEls = {};
  const statRow = (key, label) => {
    const v = h('span.stat-value.mono', { text: '—' });
    statEls[key] = v;
    return h('div.stat', [h('span.stat-label', { text: label }), v]);
  };
  const statsPanel = h('section.panel.panel-stats', { hidden: true }, [
    h('div.panel-head', [h('h2.panel-title', { text: 'City stats' })]),
    h('div.stat-grid.stat-grid-2', [
      statRow('employed', 'Employed'),
      statRow('unemployment', 'Unemployment'),
      statRow('tax', 'Tax revenue'),
      statRow('wages', 'Wages & trade'),
      statRow('buildingIncome', 'Business income'),
      statRow('upkeep', 'Upkeep'),
      statRow('totalEarned', 'Total earned'),
      statRow('peakPop', 'Peak population'),
      statRow('built', 'Buildings built'),
      statRow('clicks', 'Taps'),
    ]),
  ]);

  const el = h('section.col.col-hero', [h('section.panel.panel-city', [cityView]), nextPanel, prestigePanel, statsPanel]);

  // Called on rebuild frames only (buy/sell/prestige/load/offline events + safety net).
  function setBuildings(list) {
    skyline.update(list);
  }

  function update(dt) {
    const s = game.state;
    const d = game.derived;
    skyline.tick(dt);
    setText(cityTier, tierTitle(s.res.pop));
    setClass(hint, 'is-done', (s.stats && s.stats.clicks) >= HINT_TAPS);
    const pop = Math.floor(s.res.pop);
    setText(cityPop, `${num(pop)} ${pop === 1 ? 'citizen' : 'citizens'}`);

    // Next milestone
    const nxt = nextMilestones(ui.content.milestones || [], s, 1)[0];
    if (nxt) {
      setText(nextIcon, nxt.icon || '🏁');
      setText(nextName, nxt.name || nxt.id);
      setText(nextDesc, nxt.desc || '');
      setText(nextReward, nxt.rewardText ? `Reward: ${nxt.rewardText}` : '');
      const p = milestoneProgress(nxt, s, d);
      setHidden(nextBar, p === null);
      setProgress(nextFill, p ?? 0);
      setText(nextPct, p === null ? '' : fmtPct(p));
    } else {
      const tier = nextTier(s.res.pop);
      const ms = ui.content.milestones || [];
      if (ms.length) {
        setText(nextIcon, '🏆');
        setText(nextName, 'Every milestone reached');
        setText(nextDesc, 'The history books are full. Keep building for the view.');
        setText(nextPct, '');
        setHidden(nextBar, true);
      } else if (tier) {
        setText(nextIcon, '🏘️');
        setText(nextName, `Become a ${tier.title}`);
        setText(nextDesc, `Reach ${num(tier.min)} citizens.`);
        const p = Math.min(1, s.res.pop / tier.min);
        setHidden(nextBar, false);
        setProgress(nextFill, p);
        setText(nextPct, fmtPct(p));
      } else {
        setText(nextIcon, '🌆');
        setText(nextName, 'Megalopolis');
        setText(nextDesc, 'There is nothing left to grow into. Only upward.');
        setText(nextPct, '');
        setHidden(nextBar, true);
      }
      setText(nextReward, '');
    }

    // Prestige
    const showPrestige = !!s.unlocks['panel:prestige'];
    setHidden(prestigePanel, !showPrestige);
    if (showPrestige) {
      const legacy = s.prestige.legacy || 0;
      const gain = game.api.prestigeGain();
      const can = game.api.canPrestige();
      const per = ui.content.config?.prestige?.incomePerLegacy ?? 0.05;
      const threshold = ui.content.config?.prestige?.threshold ?? 1e6;
      const earned = s.stats.totalEarned || 0;
      const p = Math.min(1, earned / threshold);
      setText(legacyVal, num(legacy));
      setText(gainVal, '+' + num(gain));
      setText(bonusVal, '+' + fmtPct(legacy * per));
      setText(prestigePct, fmtPct(p));
      setProgress(prestigeFill, p);
      setText(prestigeBarLabel.lastChild, `${money(earned)} / ${money(threshold)}`);
      setClass(prestigePanel, 'is-ready', can && gain > 0);
      setDisabled(prestigeBtn, !can);
      setClass(prestigeBtn, 'is-ready', can && gain > 0);
      setText(
        prestigeNote,
        can
          ? gain > 0
            ? `Founding now grants ${num(gain)} legacy: +${fmtPct(gain * per)} income and a bigger treasury, forever.`
            : 'Founding now would not earn legacy yet. Keep the treasury flowing a little longer.'
          : `Earn ${money(threshold)} in total to found a new city. Every legacy point is +${fmtPct(per)} income on every run after.`
      );
    }

    // Stats
    const showStats = !!s.unlocks['panel:stats'];
    setHidden(statsPanel, !showStats);
    if (showStats) {
      const x = d.extra || {};
      const br = x.incomeBreakdown || {};
      const emp = Math.floor(d.employed || 0);
      const jobs = Math.floor(d.jobs || 0);
      setText(statEls.employed, jobs >= 1e4 ? `${short(emp)} / ${short(jobs)}` : `${num(emp)} / ${num(jobs)}`);
      setText(statEls.unemployment, fmtPct(Number.isFinite(x.unemployment) ? x.unemployment : 0, 1));
      setText(statEls.tax, Number.isFinite(br.tax) ? '$' + short(br.tax) + '/s' : '—');
      setText(statEls.wages, Number.isFinite(br.wages) ? '$' + short(br.wages) + '/s' : '—');
      setText(statEls.buildingIncome, Number.isFinite(br.buildings) ? '$' + short(br.buildings) + '/s' : '—');
      setText(statEls.upkeep, Number.isFinite(br.upkeep) ? '-$' + short(br.upkeep) + '/s' : d.upkeep ? '-$' + short(d.upkeep) + '/s' : '$0/s');
      setText(statEls.totalEarned, money(s.stats.totalEarned || 0));
      setText(statEls.peakPop, fmtInt(s.stats.peakPop || 0));
      setText(statEls.built, fmtInt(s.stats.buildingsBuilt || 0));
      setText(statEls.clicks, fmtInt(s.stats.clicks || 0));
    }
  }

  return { el, update, setBuildings, spawnParticle, playtime: () => fmtTime(game.state.stats.playtime) };
}

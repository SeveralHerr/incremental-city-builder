// Hero column: clickable city view (skyline + tap particles), next-milestone card,
// prestige card (gated by panel:prestige), city stats card (gated by panel:stats).
import { h, icon, setText, setHidden, setProgress, setClass, setDisabled, setAttr, money, num, short, fmtPct, fmtTime, fmtInt, prefersReducedMotion } from './dom.js';
import { createSkyline } from './skyline.js';
import { milestoneProgress, nextMilestones } from './milestones.js';
import { tierTitle, nextTier } from './content.js';
import { createCharterSection } from './charter.js';
import { unemploymentLevel, LEGACY_GLYPH } from './text.js';

const MAX_PARTICLES = 24;
const HINT_TAPS = 5; // the 'tap the city' pill fades once the mayor has clearly got it
const HINT_POP = 50; // ... or once the town outgrows the tutorial (Village)
const HINT_SECONDS = 180; // ... or after three minutes at the keyboard without tapping

export function createHero(ui) {
  const { game } = ui;

  // ---- City view ----
  const skylineHost = h('div.skyline-host');
  const particles = h('div.particles', { 'aria-hidden': 'true' });
  const cityTier = h('span.city-tier', { text: 'Hamlet' });
  const cityPop = h('span.city-pop.mono', { text: '0 citizens' });
  // A returning mayor who has already tapped never sees the pill flash and fade: the done
  // state is set before the element is attached, so no transition runs on first paint.
  const hintDone = ((game.state.stats && game.state.stats.clicks) || 0) >= HINT_TAPS;
  const hint = h(`div.city-hint${hintDone ? '.is-done' : ''}`, { hidden: hintDone }, [h('span.city-hint-key', { text: 'tap' }), h('span', { text: 'the city to collect' })]);
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
    if (!prefersReducedMotion()) {
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
    setTimeout(finish, prefersReducedMotion() ? 500 : 1100);
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

  // ---- Prestige card (gated by panel:prestige, or any legacy in the bank) ----
  const legacyVal = h('span.stat-value.mono', { text: '0' });
  const gainVal = h('span.stat-value.mono', { text: '+0' });
  const bonusVal = h('span.stat-value.mono', { text: '+0%' });
  const legacyStat = h('div.stat', { title: '' }, [h('span.stat-label', { text: 'Legacy points' }), legacyVal]);
  const gainStat = h('div.stat', { title: '' }, [h('span.stat-label', { text: 'On founding' }), gainVal]);
  const bonusStat = h('div.stat', { title: '' }, [h('span.stat-label', { text: 'Income bonus' }), bonusVal]);
  const prestigePct = h('span.panel-meta.mono', { text: '' });
  const prestigeFill = h('div.progress-fill');
  const prestigeBar = h('div.progress.prestige-bar', { 'aria-hidden': 'true' }, [prestigeFill]);
  const prestigeBarLabel = h('div.prestige-bar-label', [h('span', { text: 'Earned this city' }), h('span.mono', { text: '' })]);
  const charter = createCharterSection(ui);
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
    h('div.stat-grid', [legacyStat, gainStat, bonusStat]),
    prestigeBtn,
    prestigeConfirm,
    prestigeNote,
    charter.el,
  ]);

  // ---- City stats (gated by panel:stats) ----
  const statEls = {};
  const statTiles = {};
  const statRow = (key, label) => {
    const v = h('span.stat-value.mono', { text: '—' });
    statEls[key] = v;
    const tile = h('div.stat', [h('span.stat-label', { text: label }), v]);
    statTiles[key] = tile;
    return tile;
  };
  // Nine tiles: a 3×3 grid at desktop widths (taps live under Settings › This city).
  const statsPanel = h('section.panel.panel-stats', { hidden: true }, [
    h('div.panel-head', [h('h2.panel-title', { text: 'City stats' })]),
    h('div.stat-grid.stat-grid-2', [
      // 'Jobs filled' (employed / jobs): a full tile next to a high unemployment figure means
      // the city has more workers than jobs, which 'Employed 45 / 45' used to contradict.
      statRow('employed', 'Jobs filled'),
      statRow('unemployment', 'Unemployment'),
      statRow('tax', 'Tax revenue'),
      statRow('wages', 'Wages & trade'),
      statRow('buildingIncome', 'Business income'),
      statRow('upkeep', 'Upkeep'),
      statRow('totalEarned', 'Total earned'),
      statRow('peakPop', 'Peak population'),
      statRow('built', 'Buildings built'),
    ]),
  ]);

  // The city panel is exposed so the toast overlay can mount inside it (see index.js).
  const cityPanel = h('section.panel.panel-city', [cityView]);
  const el = h('section.col.col-hero', [cityPanel, nextPanel, prestigePanel, statsPanel]);

  // Called on rebuild frames only (buy/sell/prestige/load/offline events + safety net).
  function setBuildings(list) {
    skyline.update(list);
  }

  // Charter perks re-render with the upgrade rows the render loop already fetched.
  function rebuild(upgradeRows) {
    charter.rebuild(upgradeRows);
  }

  // Every frame: the sky, clouds and windmills keep moving between ticks.
  function animate(dt) {
    skyline.tick(dt);
  }

  let hintHidden = hintDone;
  // On refresh frames only (the tick advanced or an event landed — see index.js).
  function update(upgradeRows) {
    const s = game.state;
    const d = game.derived;
    setText(cityTier, tierTitle(s.res.pop));
    const clicks = (s.stats && s.stats.clicks) || 0;
    // The pill also retires for a pure idler: once the town has fifty citizens or three minutes
    // at the keyboard have passed, tapping is a bonus the player has chosen to skip, and the
    // pill would otherwise sit on the front-row buildings forever.
    const outgrown = s.res.pop >= HINT_POP || ((s.stats && s.stats.playtime) || 0) >= HINT_SECONDS;
    if (!hintHidden) {
      setClass(hint, 'is-done', clicks >= HINT_TAPS || outgrown);
      if (clicks >= HINT_TAPS || outgrown) {
        hintHidden = true;
        setTimeout(() => setHidden(hint, hintHidden), prefersReducedMotion() ? 0 : 650);
      }
    } else if (clicks < HINT_TAPS && !outgrown) {
      // A fresh plot after a hard reset brings the pill back.
      hintHidden = false;
      hint.classList.remove('is-done');
      setHidden(hint, false);
    }
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

    // Prestige. The simulation publishes its snapshot in derived.extra.prestige (legacy,
    // gain, can, minGain, unlockAt, nextAt, mult, multAfter, available); every field is
    // optional here and falls back to the api + config.
    const legacyBanked = (s.prestige && s.prestige.legacy) || 0;
    const showPrestige = !!s.unlocks['panel:prestige'] || legacyBanked > 0;
    setHidden(prestigePanel, !showPrestige);
    if (showPrestige) {
      const px = d.extra && d.extra.prestige && typeof d.extra.prestige === 'object' ? d.extra.prestige : {};
      const fin = (v) => Number.isFinite(v) && v >= 0;
      const legacy = fin(px.legacy) ? px.legacy : legacyBanked;
      const gain = fin(px.gain) ? px.gain : game.api.prestigeGain();
      const can = typeof px.can === 'boolean' ? px.can : game.api.canPrestige();
      const minGain = fin(px.minGain) && px.minGain > 0 ? px.minGain : 1;
      const per = ui.content.config?.prestige?.incomePerLegacy ?? 0.05;
      const threshold = ui.content.config?.prestige?.threshold ?? 1e6;
      // Bar: earnings this city toward the founding gate (unlockAt); once past it, toward the
      // next legacy point (nextAt) so the bar keeps moving instead of pinning at 100%.
      const earned = s.stats.totalEarned || 0;
      const unlockAt = fin(px.unlockAt) && px.unlockAt > 0 ? px.unlockAt : threshold;
      const nextAt = fin(px.nextAt) && px.nextAt > earned ? px.nextAt : 0;
      const target = can && nextAt > 0 ? nextAt : unlockAt;
      const p = target > 0 ? Math.min(1, earned / target) : 0;
      const mult = fin(px.mult) && px.mult > 0 ? px.mult : 1 + legacy * per;
      const multAfter = fin(px.multAfter) && px.multAfter > 0 ? px.multAfter : 1 + (legacy + gain) * per;
      const spent = (s.prestige && s.prestige.spent) || 0;
      setText(legacyVal, num(legacy));
      setAttr(legacyStat, 'title', spent > 0 ? `${num(legacy)} banked, ${num(Math.max(0, legacy - spent))} free to spend on the charter` : 'Legacy points earned by founding cities');
      setText(gainVal, '+' + num(gain));
      setAttr(gainStat, 'title', gain > 0 ? `Founding now banks ${num(gain)} legacy; the bonus becomes +${fmtPct(multAfter - 1)}` : `Founding needs at least ${num(minGain)} legacy to be worth it`);
      setText(bonusVal, '+' + fmtPct(mult - 1));
      setAttr(bonusStat, 'title', 'Income multiplier from every legacy point ever earned; spending on the charter never lowers it');
      setText(prestigePct, fmtPct(p));
      setProgress(prestigeFill, p);
      setText(prestigeBarLabel.firstChild, can && nextAt > 0 ? 'Next legacy point' : 'Earned this city');
      setText(prestigeBarLabel.lastChild, `${money(earned)} / ${money(target)}`);
      setClass(prestigePanel, 'is-ready', can && gain > 0);
      setDisabled(prestigeBtn, !can);
      setClass(prestigeBtn, 'is-ready', can && gain > 0);
      setText(
        prestigeNote,
        can
          ? gain > 0
            ? `Founding now banks ${LEGACY_GLYPH} ${num(gain)}: income +${fmtPct(mult - 1)} → +${fmtPct(multAfter - 1)}, a bigger treasury, and legacy to spend on charter clauses.`
            : 'Founding now would not earn legacy yet. Keep the treasury flowing a little longer.'
          : legacy > 0
            ? `Earn ${money(unlockAt)} this city to found again (${num(minGain)} legacy minimum). The bonus below is permanent; new legacy also buys charter clauses.`
            : `Earn ${money(unlockAt)} in total to found a new city. Every legacy point raises income forever and can be spent on charter clauses.`
      );
      charter.update(upgradeRows);
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
      const unemp = Number.isFinite(x.unemployment) ? x.unemployment : 0;
      setText(statEls.unemployment, fmtPct(unemp, 1));
      const lvl = unemploymentLevel(unemp);
      setClass(statTiles.unemployment, 'is-warn', lvl === 'warn');
      setClass(statTiles.unemployment, 'is-bad', lvl === 'bad');
      setText(statEls.tax, Number.isFinite(br.tax) ? '$' + short(br.tax) + '/s' : '—');
      setText(statEls.wages, Number.isFinite(br.wages) ? '$' + short(br.wages) + '/s' : '—');
      setText(statEls.buildingIncome, Number.isFinite(br.buildings) ? '$' + short(br.buildings) + '/s' : '—');
      // Zero upkeep prints '$0/s', never '-$0/s' (a negative sign on nothing reads like a bug).
      const upkeep = Number.isFinite(br.upkeep) ? br.upkeep : Number.isFinite(d.upkeep) ? d.upkeep : 0;
      setText(statEls.upkeep, upkeep > 0 ? '-$' + short(upkeep) + '/s' : '$0/s');
      setAttr(statTiles.employed, 'title', jobs > 0 ? `${num(emp)} of ${num(jobs)} jobs are filled` : 'No jobs yet — build shops or factories');
      setText(statEls.totalEarned, money(s.stats.totalEarned || 0));
      setText(statEls.peakPop, fmtInt(s.stats.peakPop || 0));
      setText(statEls.built, fmtInt(s.stats.buildingsBuilt || 0));
    }
  }

  return { el, cityPanel, animate, update, rebuild, setBuildings, spawnParticle, playtime: () => fmtTime(game.state.stats.playtime) };
}

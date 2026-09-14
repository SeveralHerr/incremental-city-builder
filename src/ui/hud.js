// Heads-up display: the readouts that sit directly on the sky. No bar, no chips, no cards —
// money, citizens, power, mood and the next goal are set as bare type over the city, the way a
// scoreboard reads. Everything here is pointer-events:none except the settings button, so the
// whole skyline behind it stays one large tap target (see city.js).
import { h, icon, setText, setClass, setHidden, setProgress, setAttr, tween, money, num, moneyRate, fmtPct, fmtTime } from './dom.js';
import { tierTitle, moodWord } from './content.js';
import { powerChipText } from './text.js';
import { milestoneProgress, nextMilestones } from './milestones.js';

export function createHud(ui) {
  const { game } = ui;

  // ---- treasury (top left, the one big number) ----
  const moneyEl = h('span.hud-money', { text: '$0' });
  const rateEl = h('span.hud-rate', { text: '' });
  const popEl = h('span.hud-pop-count', { text: '0' });
  const popSub = h('span.hud-pop-sub', { text: 'citizens' });
  const popRow = h('div.hud-pop', [icon('people'), popEl, popSub]);
  const cityName = h('div.hud-city', { text: 'Metropolis' });
  const purse = h('div.hud-purse', [cityName, h('div.hud-money-row', [moneyEl, rateEl]), popRow]);

  // ---- meta + grid (top right) ----
  const tierEl = h('span.hud-tier', { text: 'Hamlet' });
  const clockEl = h('span.hud-clock', { text: '0s' });
  const settingsBtn = h('button.hud-btn', { type: 'button', 'aria-label': 'Settings', title: 'Settings' }, [icon('gear')]);
  settingsBtn.addEventListener('click', () => ui.settings && ui.settings.open());

  const powerVal = h('span.gauge-value', { text: '' });
  const powerSub = h('span.gauge-sub', { text: '' });
  const powerFill = h('div.progress-fill');
  const powerBar = h('div.progress.progress-xs.gauge-bar', { 'aria-hidden': 'true' }, [powerFill]);
  const powerEl = h('div.gauge.gauge-power', { role: 'group', 'aria-label': 'Power', hidden: true }, [
    h('div.gauge-row', [icon('bolt'), powerVal]),
    powerBar,
    powerSub,
  ]);

  const happyVal = h('span.gauge-value', { text: '' });
  const happySub = h('span.gauge-sub', { text: '' });
  const happyEl = h('div.gauge.gauge-happy', { role: 'group', 'aria-label': 'Happiness', hidden: true }, [
    h('div.gauge-row', [icon('smile'), happyVal]),
    happySub,
  ]);

  // Meta row and gauges are separate children of the grid: on a phone the gauges drop to their
  // own full-width row instead of squeezing the treasury into a third of the screen.
  const metaRow = h('div.hud-meta-row', [tierEl, h('span.dot', { 'aria-hidden': 'true' }), clockEl, settingsBtn]);
  const gauges = h('div.hud-gauges', [powerEl, happyEl]);

  // ---- next goal (bottom left, out of the skyline's centre) ----
  const goalName = h('span.goal-name', { text: '' });
  const goalPct = h('span.goal-pct', { text: '' });
  const goalFill = h('div.progress-fill');
  const goalBar = h('div.progress.progress-xs.goal-bar', { 'aria-hidden': 'true' }, [goalFill]);
  const goal = h('button.hud-goal', { type: 'button', title: 'Open the goals list' }, [
    h('span.goal-label', { text: 'Next' }),
    h('div.goal-body', [h('div.goal-row', [goalName, goalPct]), goalBar]),
  ]);
  goal.addEventListener('click', () => ui.openSheet && ui.openSheet('goals'));

  const el = h('div.hud', [purse, metaRow, gauges, goal]);

  const tw = { money: tween(0), pop: tween(0), income: tween(0) };
  let lastTier = '';
  let lastGoal = '';

  function update(dt) {
    const s = game.state;
    const d = game.derived;

    const m = tw.money.update(s.res.money, dt);
    const inc = tw.income.update(d.income, dt, { rate: 6 });
    setText(moneyEl, money(m));
    setText(rateEl, moneyRate(inc));
    setClass(rateEl, 'is-negative', d.income < 0);

    const pop = Math.floor(tw.pop.update(s.res.pop, dt));
    const housing = Math.floor(d.housing || 0);
    setText(popEl, num(pop));
    // 'of 16 housing' reads as a warning to someone who has not met housing yet, so the plain
    // wording holds until the town is actually filling up.
    setText(popSub, housing > 0 && s.res.pop > housing * 0.8 ? `of ${num(housing)} housing` : pop === 1 ? 'citizen' : 'citizens');
    setClass(popRow, 'is-warn', housing > 0 && s.res.pop > housing * 1.02);

    const tier = tierTitle(s.res.pop);
    if (tier !== lastTier) {
      lastTier = tier;
      setText(tierEl, tier);
    }
    setText(clockEl, fmtTime(s.stats.playtime));

    const showPower = !!s.unlocks['panel:power'];
    setHidden(powerEl, !showPower);
    if (showPower) {
      const cap = d.powerCap || 0;
      const dem = d.powerDemand || 0;
      const ratio = d.powerRatio ?? 1;
      const txt = powerChipText(cap, dem, ratio);
      setText(powerVal, txt.value);
      setText(powerSub, txt.sub);
      setProgress(powerFill, dem > 0 ? Math.min(1, cap / dem) : 1);
      setClass(powerEl, 'is-warn', ratio < 1 && ratio >= 0.6);
      setClass(powerEl, 'is-bad', ratio < 0.6);
    }

    const showHappy = !!s.unlocks['panel:civic'];
    setHidden(happyEl, !showHappy);
    if (showHappy) {
      const hp = d.happiness ?? 1;
      setText(happyVal, fmtPct(hp));
      setText(happySub, moodWord(hp));
      setClass(happyEl, 'is-warn', hp < 0.9 && hp >= 0.7);
      setClass(happyEl, 'is-bad', hp < 0.7);
    }

    // Next goal. Milestones first; once they are all reached the city tier takes over so the
    // line never goes blank on a long session.
    const nxt = nextMilestones(ui.content.milestones || [], s, 1)[0];
    if (nxt) {
      if (lastGoal !== nxt.id) {
        lastGoal = nxt.id;
        setText(goalName, nxt.name || nxt.id);
        setAttr(goal, 'aria-label', `Next goal: ${nxt.name || nxt.id}. ${nxt.desc || ''}`);
        setAttr(goal, 'title', nxt.desc || 'Open the goals list');
      }
      const p = milestoneProgress(nxt, s, d);
      setHidden(goalBar, p === null);
      setProgress(goalFill, p ?? 0);
      setText(goalPct, p === null ? '' : fmtPct(p));
      setHidden(goal, false);
    } else if (lastGoal !== 'none') {
      lastGoal = 'none';
      setText(goalName, 'Every milestone reached');
      setText(goalPct, '');
      setHidden(goalBar, true);
      setAttr(goal, 'title', 'The history books are full');
    }
  }

  return { el, update };
}

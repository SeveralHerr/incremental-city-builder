// City Hall page (inside the sheet): the ledger a mayor checks between decisions — legacy /
// charter (gated by panel:prestige) and the city statistics (gated by panel:stats). Nothing
// here changes every frame, which is exactly why it lives one tap away instead of on the sky.
import { h, icon, setText, setHidden, setProgress, setClass, setDisabled, setAttr, money, num, short, fmtPct, fmtInt } from './dom.js';
import { createCharterSection } from './charter.js';
import { unemploymentLevel, legacyPointBar, happinessRows, happinessTotal, happinessHint, signedPct, foundingRule, LEGACY_GLYPH } from './text.js';

export function createCityHall(ui) {
  const { game } = ui;

  // ---- Legacy (gated by panel:prestige, or any legacy in the bank) ----
  const legacyVal = h('span.stat-value', { text: '0' });
  const gainVal = h('span.stat-value', { text: '+0' });
  const bonusVal = h('span.stat-value', { text: '+0%' });
  const legacyStat = h('div.stat', { title: '' }, [h('span.stat-label', { text: 'Legacy points' }), legacyVal]);
  const gainStat = h('div.stat', { title: '' }, [h('span.stat-label', { text: 'On founding' }), gainVal]);
  const bonusStat = h('div.stat', { title: '' }, [h('span.stat-label', { text: 'Income bonus' }), bonusVal]);
  const prestigePct = h('span.panel-meta', { text: '' });
  const prestigeFill = h('div.progress-fill');
  const prestigeBar = h('div.progress.prestige-bar', { 'aria-hidden': 'true' }, [prestigeFill]);
  const prestigeBarLabel = h('div.prestige-bar-label', [h('span', { text: 'Earned this city' }), h('span.mono', { text: '' })]);
  const charter = createCharterSection(ui);
  const prestigeBtn = h('button.btn.btn-prestige', { type: 'button' }, [icon('flag'), h('span', { text: 'Found a new city' })]);
  const prestigeNote = h('p.prestige-note', { text: '' });
  // The founding rule in plain words (F6): what a founding must bank and that the gate is on
  // this city's earnings, not on the city count. Two lines, text.js foundingRule.
  const ruleLine = h('span.prestige-rule-line', { text: '' });
  const gateLine = h('span.prestige-rule-line', { text: '' });
  const prestigeRule = h('p.prestige-rule', [ruleLine, gateLine]);
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
    prestigeRule,
    prestigeBtn,
    prestigeConfirm,
    prestigeNote,
    charter.el,
  ]);

  // ---- City stats (gated by panel:stats) ----
  const statEls = {};
  const statTiles = {};
  const statRow = (key, label) => {
    const v = h('span.stat-value', { text: '—' });
    statEls[key] = v;
    const tile = h('div.stat', [h('span.stat-label', { text: label }), v]);
    statTiles[key] = tile;
    return tile;
  };
  const statsPanel = h('section.panel.panel-stats', { hidden: true }, [
    h('div.panel-head', [h('h2.panel-title', { text: 'City stats' })]),
    h('div.stat-grid', [
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

  // ---- Happiness (gated by panel:civic, like the HUD gauge) ----
  // Every term of the formula with its sign (resources: derived.extra.happiness), the total,
  // what it does to income, and a one-line hint keyed by capReason (F4). Rows are built once
  // and only their text changes; the clamp row shows while the clamp is doing something.
  const happyRows = new Map(); // key -> { el, val, note }
  const happyList = h('div.happy-rows');
  const happyRow = (key, label) => {
    const val = h('span.happy-val.mono', { text: '' });
    const note = h('span.happy-note', { text: '' });
    const row = h('div.happy-row', { dataset: { term: key } }, [h('span.happy-label', { text: label }), note, val]);
    happyRows.set(key, { el: row, val, note });
    happyList.append(row);
    return row;
  };
  for (const r of happinessRows({})) happyRow(r.key, r.label);
  happyRow('clamp', 'Clamp').hidden = true;
  const happyTotal = h('span.happy-val.mono', { text: '' });
  const happyMult = h('span.happy-mult.mono', { text: '' });
  const happyTotalRow = h('div.happy-row.happy-total', [h('span.happy-label', { text: 'Happiness' }), happyMult, happyTotal]);
  const happyHint = h('p.happy-hint', { text: '' });
  const happyMeta = h('span.panel-meta', { text: '' });
  const happyPanel = h('section#hall-happiness.panel.panel-happy', { hidden: true }, [
    h('div.panel-head', [h('h2.panel-title', { text: 'Happiness' }), happyMeta]),
    h('p.panel-lead', { text: 'Every dollar the city earns is multiplied by 0.5 + 0.5 × happiness. The terms below add up to it.' }),
    happyList,
    happyTotalRow,
    happyHint,
  ]);

  const waiting = h('p.empty-note', { text: 'The clerk’s office opens once the city keeps books worth reading. Build, and the ledger fills in.' });
  const el = h('div.hall', [prestigePanel, happyPanel, statsPanel, waiting]);

  function rebuild(upgradeRows) {
    charter.rebuild(upgradeRows);
  }

  function update(upgradeRows) {
    const s = game.state;
    const d = game.derived;

    // Legacy. The simulation publishes its snapshot in derived.extra.prestige (legacy, gain,
    // can, minGain, unlockAt, nextAt, mult, multAfter, available); every field is optional
    // here and falls back to the api + config.
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
      // Bar: earnings this city toward the founding gate (unlockAt); once past it, the
      // current legacy-point segment — from the last point's threshold (prevAt) to the next
      // (nextAt) — so late in a run it reads "point 415 → 416: 64%", never "% of the whole
      // target" pinned at 100% (F12; text.js legacyPointBar).
      const earned = s.stats.totalEarned || 0;
      const unlockAt = fin(px.unlockAt) && px.unlockAt > 0 ? px.unlockAt : threshold;
      const nextAt = fin(px.nextAt) && px.nextAt > earned ? px.nextAt : 0;
      const pointMode = can && nextAt > 0;
      const bar = pointMode ? legacyPointBar({ earned, nextAt, prevAt: px.prevAt, legacy, gain }) : null;
      const target = pointMode ? nextAt : unlockAt;
      const p = bar ? bar.p : target > 0 ? Math.min(1, earned / target) : 0;
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
      if (bar && bar.segment) {
        setText(prestigeBarLabel.firstChild, `Legacy point ${LEGACY_GLYPH} ${num(bar.point)} → ${num(bar.nextPoint)}`);
        setText(prestigeBarLabel.lastChild, `${money(earned - bar.from)} / ${money(nextAt - bar.from)}`);
        setAttr(prestigeBar, 'title', `${fmtPct(p)} of the way from point ${num(bar.point)} (${money(bar.from)} earned this city) to point ${num(bar.nextPoint)} (${money(nextAt)})`);
      } else {
        setText(prestigeBarLabel.firstChild, pointMode ? 'Next legacy point' : 'Earned this city');
        setText(prestigeBarLabel.lastChild, `${money(earned)} / ${money(target)}`);
        setAttr(prestigeBar, 'title', pointMode ? `Earn ${money(target)} this city for legacy point ${num(legacy + gain + 1)}` : `Earn ${money(target)} this city to found again`);
      }
      setClass(prestigePanel, 'is-ready', can && gain > 0);
      setDisabled(prestigeBtn, !can);
      setClass(prestigeBtn, 'is-ready', can && gain > 0);
      const share = ui.content.config?.prestige?.minGainShare ?? 0.4;
      const fr = foundingRule({ gain, minGain, legacy, share, earned, unlockAt, can });
      setText(ruleLine, fr.rule);
      setText(gateLine, fr.gate);
      setClass(prestigeRule, 'is-met', can);
      setText(
        prestigeNote,
        can
          ? gain > 0
            ? `Founding now banks ${LEGACY_GLYPH} ${num(gain)}: income +${fmtPct(mult - 1)} → +${fmtPct(multAfter - 1)}, a bigger treasury, and legacy to spend on charter clauses.`
            : 'Founding now would not earn legacy yet. Keep the treasury flowing a little longer.'
          : legacy > 0
            ? 'The bonus below is permanent; new legacy also buys charter clauses.'
            : 'Every legacy point raises income forever and can be spent on charter clauses.'
      );
      charter.update(upgradeRows);
    }

    // Happiness
    const showHappy = !!s.unlocks['panel:civic'];
    setHidden(happyPanel, !showHappy);
    if (showHappy) {
      const x = d.extra || {};
      const hb = x.happiness && typeof x.happiness === 'object' ? x.happiness : null;
      const rows = happinessRows(hb, { unemployment: x.unemployment });
      let sawClamp = false;
      for (const r of rows) {
        const row = happyRows.get(r.key);
        if (!row) continue;
        if (r.key === 'clamp') sawClamp = true;
        setHidden(row.el, false);
        setText(row.val, signedPct(r.value));
        setText(row.note, r.note);
        setClass(row.el, 'is-neg', r.value < -5e-4);
        setClass(row.el, 'is-pos', r.value > 5e-4);
        setClass(row.el, 'is-zero', Math.abs(r.value) <= 5e-4);
      }
      if (!sawClamp) setHidden(happyRows.get('clamp').el, true);
      const tot = happinessTotal(hb);
      setText(happyTotal, tot.text);
      setText(happyMult, tot.incomeText);
      setText(happyMeta, tot.incomeText);
      const reason = hb ? hb.capReason : 'none';
      setText(happyHint, happinessHint(reason, hb));
      setAttr(happyPanel, 'data-limit', typeof reason === 'string' ? reason : 'none');
    }

    // Stats
    const showStats = !!s.unlocks['panel:stats'];
    setHidden(statsPanel, !showStats);
    setHidden(waiting, showStats || showPrestige || showHappy);
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

  // Dock badge: a new city is worth founding.
  function ready() {
    try {
      return !!game.api.canPrestige() && game.api.prestigeGain() > 0;
    } catch {
      return false;
    }
  }

  return { el, update, rebuild, ready };
}

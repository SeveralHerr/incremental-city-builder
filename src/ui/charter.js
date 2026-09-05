// Charter perks: upgrades priced in legacy (currency === 'legacy'), rendered inside the Legacy
// panel. Header shows the bank as "◆ available / total"; each clause carries a "◆ N" cost chip,
// glows when affordable, and signed clauses collapse into a chip list.
// Public shape: createCharterSection(ui) -> { el, rebuild(upgradeRows), update(upgradeRows) }
import { h, setText, setHidden, setClass, setDisabled, setAttr, num } from './dom.js';
import { LEGACY_GLYPH, legacyBank, legacyCost } from './text.js';

const VISIBLE_DEFAULT = 4;

export function createCharterSection(ui) {
  const { game, content } = ui;
  const cards = new Map(); // id -> card
  const chips = new Map(); // id -> owned chip
  let rows = [];
  let signature = '';
  let expanded = false;
  let bank = { legacy: 0, spent: 0, available: 0 };

  const bankEl = h('span.charter-bank.mono', [h('span.legacy-glyph', { text: LEGACY_GLYPH, 'aria-hidden': 'true' }), h('span.charter-bank-num', { text: '0 / 0' })]);
  const bankNum = bankEl.lastChild;
  const list = h('div.ccards');
  const empty = h('p.empty-note.charter-empty', { text: '' });
  const showMore = h('button.btn.btn-ghost.show-more', { type: 'button', text: '', hidden: true });
  showMore.addEventListener('click', () => {
    expanded = !expanded;
    signature = '';
    rebuild(rows);
  });
  const ownedList = h('div.owned-list');
  const ownedSummary = h('summary.owned-summary', { text: 'Signed' });
  const owned = h('details.owned.charter-owned', { hidden: true }, [ownedSummary, ownedList]);
  const locked = h('p.locked-note.charter-locked', { text: '' });
  const el = h('section.charter', { hidden: true, 'aria-label': 'City charter' }, [
    h('div.charter-head', [
      h('h3.charter-title', [h('span', { text: 'Charter' }), h('span.charter-sub', { text: 'perks bought with legacy' })]),
      bankEl,
    ]),
    list,
    empty,
    showMore,
    owned,
    locked,
  ]);

  function card(def) {
    let c = cards.get(def.id);
    if (c) return c;
    const cost = h('span.btn-cost.mono.legacy-cost', [h('span.legacy-glyph', { text: LEGACY_GLYPH, 'aria-hidden': 'true' }), h('span', { text: num(def.cost) })]);
    const btn = h('button.btn.btn-buy.btn-sm.btn-charter', { type: 'button', 'aria-label': `Sign ${def.name} for ${num(def.cost)} legacy` }, [h('span.btn-label', { text: 'Sign' }), cost]);
    const elc = h('article.ccard', { dataset: { id: def.id }, title: def.desc || def.name }, [
      h('div.ccard-icon', { text: def.icon || LEGACY_GLYPH, 'aria-hidden': 'true' }),
      h('div.ccard-main', [h('span.ccard-name', { text: def.name }), h('div.ccard-desc', { text: def.desc || '' })]),
      btn,
    ]);
    btn.addEventListener('click', () => {
      if (game.api.buyUpgrade(def.id)) ui.rebuild();
    });
    if (ui.newlyUnlocked.has('u:' + def.id)) {
      ui.newlyUnlocked.delete('u:' + def.id);
      elc.classList.add('is-new');
      setTimeout(() => elc.classList.remove('is-new'), 6000);
    }
    c = { el: elc, def, btn, cost: cost.lastChild };
    cards.set(def.id, c);
    return c;
  }

  function chip(def) {
    let c = chips.get(def.id);
    if (!c) {
      c = h('span.owned-chip.charter-chip', { title: `${def.desc || def.name} (${legacyCost(def.cost)})` }, [
        h('span', { text: def.icon || LEGACY_GLYPH, 'aria-hidden': 'true' }),
        h('span', { text: def.name }),
      ]);
      chips.set(def.id, c);
    }
    return c;
  }

  function perkRows(all) {
    const out = [];
    for (const r of all || []) if (r && r.currency === 'legacy') out.push(r);
    return out;
  }

  function rebuild(allRows) {
    rows = perkRows(allRows);
    const s = game.state;
    const legacy = (s.prestige && s.prestige.legacy) || 0;
    const show = rows.length > 0 && (legacy > 0 || !!s.unlocks['panel:prestige']);
    setHidden(el, !show);
    if (!show) return;
    const available = rows.filter((r) => r.unlocked && !r.owned).sort((a, b) => a.cost - b.cost);
    const ownedRows = rows.filter((r) => r.owned);
    const lockedRows = rows.filter((r) => !r.unlocked && !r.owned).sort((a, b) => a.cost - b.cost);
    const sig = available.map((r) => r.id).join(',') + '|' + ownedRows.map((r) => r.id).join(',') + '|' + lockedRows.length + '|' + expanded;
    setHidden(empty, available.length > 0);
    if (!available.length) {
      setText(
        empty,
        ownedRows.length === rows.length
          ? 'Every clause is signed. The charter is complete.'
          : legacy > 0
            ? 'No clause is open yet. Found more cities to unlock the next one.'
            : 'Found a new city to earn legacy; charter clauses open as the bank grows.'
      );
    }
    const next = lockedRows[0];
    setText(
      locked,
      lockedRows.length ? `${num(lockedRows.length)} more ${lockedRows.length === 1 ? 'clause waits' : 'clauses wait'}${next ? ` · next opens near ${legacyCost(next.cost)}` : ''}` : ''
    );
    if (sig !== signature) {
      signature = sig;
      const shown = expanded ? available : available.slice(0, VISIBLE_DEFAULT);
      reconcile(list, shown.map((r) => card(r).el));
      setHidden(showMore, available.length <= VISIBLE_DEFAULT);
      setText(showMore, expanded ? 'Show fewer' : `Show ${num(available.length - shown.length)} more`);
      reconcile(ownedList, ownedRows.map((r) => chip(r)));
      setHidden(owned, ownedRows.length === 0);
      setText(ownedSummary, `Signed (${ownedRows.length})`);
    }
    update(allRows);
  }

  function update(allRows) {
    if (allRows) rows = perkRows(allRows);
    if (el.hidden) return;
    const s = game.state;
    bank = legacyBank(s, game.api, game.derived && game.derived.extra ? game.derived.extra.prestige : null);
    setText(bankNum, `${num(bank.available)} / ${num(bank.legacy)}`);
    setAttr(bankEl, 'title', `${num(bank.available)} legacy free to spend of ${num(bank.legacy)} banked. Spending never lowers the income bonus.`);
    for (const r of rows) {
      const c = cards.get(r.id);
      if (!c || !c.el.isConnected) continue;
      const ok = !!r.affordable && !r.owned;
      setDisabled(c.btn, !ok);
      setClass(c.el, 'is-affordable', ok);
      setText(c.cost, num(r.cost));
    }
  }

  function reconcile(parent, wanted) {
    for (let i = 0; i < wanted.length; i++) {
      const cur = parent.children[i];
      if (cur !== wanted[i]) parent.insertBefore(wanted[i], cur || null);
    }
    while (parent.children.length > wanted.length) parent.lastChild.remove();
  }

  return { el, rebuild, update, category: content.category('charter') };
}

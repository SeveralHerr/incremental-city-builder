// Modal shell + settings modal.
// Public shape: createModal(root) -> { el, open({ title, content }), close(), isOpen() }
//               createSettingsModal(ui, modal) -> { open() }
// Every destructive action confirms inline (never window.confirm). Save/export/import/reset go
// through api.action('save'|'exportSave'|'importSave'|'hardReset'); `undefined` from an action
// means the save module has not registered it yet and is reported as "not available". When the
// save module has parked an unreadable save (saveStatus().hasCorrupt), a "Previous save" section
// offers api.action('recoverSave') and shows its raw bytes via api.action('exportCorrupt').
import { h, icon, setText, setHidden, money, num, fmtTime, fmtPct } from './dom.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createModal(root) {
  const titleEl = h('h2.modal-title', { id: 'modal-title', text: '' });
  const bodyEl = h('div.modal-body');
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close' }, [icon('close')]);
  const dialog = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' }, [
    h('div.modal-head', [titleEl, closeBtn]),
    bodyEl,
  ]);
  const backdrop = h('div.modal-backdrop', { hidden: true }, [dialog]);
  root.append(backdrop);

  let lastFocus = null;
  function open({ title = '', content } = {}) {
    setText(titleEl, title);
    bodyEl.replaceChildren();
    if (content instanceof Node) bodyEl.append(content);
    else if (typeof content === 'function') {
      const r = content(bodyEl);
      if (r instanceof Node) bodyEl.append(r);
    }
    lastFocus = document.activeElement;
    setHidden(backdrop, false);
    document.documentElement.classList.add('modal-open');
    closeBtn.focus({ preventScroll: true });
  }
  function close() {
    if (backdrop.hidden) return;
    setHidden(backdrop, true);
    document.documentElement.classList.remove('modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', (e) => {
    if (backdrop.hidden) return;
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog.
    const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return { el: backdrop, open, close, isOpen: () => !backdrop.hidden };
}

export function createSettingsModal(ui, modal) {
  const { game } = ui;

  function build() {
    const s = game.state.settings || {};
    const status = h('p.form-note', { text: '' });
    const note = (msg, kind = '') => {
      setText(status, msg);
      status.className = 'form-note' + (kind ? ' is-' + kind : '');
    };

    // ---- Display ----
    const fmtSelect = h('select.select', { 'aria-label': 'Number format' }, [
      h('option', { value: 'short', text: 'Short (1.25M)' }),
      h('option', { value: 'full', text: 'Full (1,250,000)' }),
    ]);
    fmtSelect.value = s.numFormat === 'full' ? 'full' : 'short';
    fmtSelect.addEventListener('change', () => ui.setSetting('numFormat', fmtSelect.value));

    const autosave = h('input', { type: 'checkbox', id: 'set-autosave' });
    autosave.checked = s.autosave !== false;
    autosave.addEventListener('change', () => ui.setSetting('autosave', autosave.checked));
    const autosaveSec = ui.content.config?.save?.autosaveSec ?? 30;

    // ---- Save / export / import ----
    const exportArea = h('textarea.textarea', { rows: 3, readonly: true, spellcheck: 'false', placeholder: 'Your export code appears here.', 'aria-label': 'Export code' });
    const importArea = h('textarea.textarea', { rows: 3, spellcheck: 'false', placeholder: 'Paste an export code here, then press Import.', 'aria-label': 'Import code' });

    const saveBtn = h('button.btn', { type: 'button', text: 'Save now' });
    saveBtn.addEventListener('click', () => {
      const r = game.api.action('save');
      if (r === undefined) note('Saving is not available yet.', 'warn');
      else if (r === false) note('Could not save. Storage may be full or blocked by the browser.', 'bad');
      else note('City saved.', 'ok');
    });
    const exportBtn = h('button.btn', { type: 'button', text: 'Export' });
    exportBtn.addEventListener('click', () => {
      const code = game.api.action('exportSave');
      if (typeof code !== 'string' || !code) return note('Export is not available yet.', 'warn');
      exportArea.value = code;
      exportArea.select();
      note('Export code ready. Copy it somewhere safe.', 'ok');
    });
    const copyBtn = h('button.btn.btn-ghost', { type: 'button', text: 'Copy' });
    copyBtn.addEventListener('click', async () => {
      if (!exportArea.value) return note('Nothing to copy yet. Export first.', 'warn');
      try {
        await navigator.clipboard.writeText(exportArea.value);
        note('Copied to clipboard.', 'ok');
      } catch {
        exportArea.select();
        note('Select the code and copy it manually.', 'warn');
      }
    });
    const importBtn = h('button.btn', { type: 'button', text: 'Import' });
    importBtn.addEventListener('click', () => {
      const code = importArea.value.trim();
      if (!code) return note('Paste an export code first.', 'warn');
      const ok = game.api.action('importSave', code);
      if (ok === true) {
        note('City imported. Welcome back, Mayor.', 'ok');
        importArea.value = '';
        ui.rebuild();
      } else note(ok === undefined ? 'Import is not available yet.' : 'That code could not be read. Check that it was pasted whole.', 'bad');
    });

    // ---- Recover a parked unreadable save ----
    // The save module parks a save it could not read (metropolis.save.v1.corrupt) instead of
    // overwriting it, and registers `recoverSave` (re-parse and restore; false if it still
    // does not read) plus `exportCorrupt` (its raw bytes). The row only renders while such a
    // copy exists; nothing here is shown on a healthy profile.
    const hasRecover = !!(game.registry && game.registry.actions && game.registry.actions.has('recoverSave'));
    const status0 = hasRecover ? game.api.action('saveStatus') : null;
    const parked = hasRecover && (status0 && typeof status0 === 'object' ? status0.hasCorrupt === true : game.api.action('exportCorrupt') !== '');
    let recoverSection = null;
    if (parked) {
      const recoverBtn = h('button.btn', { type: 'button', text: 'Recover previous save' });
      recoverBtn.addEventListener('click', () => {
        const r = game.api.action('recoverSave');
        if (r === true) {
          note('The previous city was restored. Welcome back, Mayor.', 'ok');
          setHidden(recoverSection, true);
          ui.rebuild();
        } else note('That record still cannot be read. Its raw bytes are kept; use "Show raw record" to copy them somewhere safe.', 'bad');
      });
      const rawBtn = h('button.btn.btn-ghost', { type: 'button', text: 'Show raw record' });
      rawBtn.addEventListener('click', () => {
        const raw = game.api.action('exportCorrupt');
        if (typeof raw !== 'string' || !raw) return note('The parked record is gone.', 'warn');
        exportArea.value = raw;
        exportArea.select();
        note('Raw record shown in the export box. Copy it before erasing anything.', 'ok');
      });
      recoverSection = h('section.form-section.form-recover', [
        h('h3.form-title', { text: 'Previous save' }),
        h('p.form-help', { text: 'An older city record could not be read and was set aside rather than overwritten. A newer build may read it; try restoring it.' }),
        h('div.btn-row', [recoverBtn, rawBtn]),
      ]);
    }

    // ---- Hard reset with inline confirm ----
    const resetBtn = h('button.btn.btn-danger', { type: 'button', text: 'Erase city…' });
    const confirmRow = h('div.confirm-row', { hidden: true }, [
      h('span.confirm-text', { text: 'This wipes every building, upgrade and legacy point. There is no undo.' }),
      h('div.btn-row', [
        h('button.btn.btn-danger', { type: 'button', text: 'Erase everything', onclick: () => {
          const r = game.api.action('hardReset');
          setHidden(confirmRow, true);
          setHidden(resetBtn, false);
          if (r === undefined) note('Reset is not available yet.', 'warn');
          else if (r === false) note('The city could not be erased. Storage may be blocked.', 'bad');
          else {
            note('The city has been erased. Fresh plot, fresh start.', 'ok');
            ui.rebuild();
            modal.close();
          }
        } }),
        h('button.btn.btn-ghost', { type: 'button', text: 'Keep my city', onclick: () => {
          setHidden(confirmRow, true);
          setHidden(resetBtn, false);
        } }),
      ]),
    ]);
    resetBtn.addEventListener('click', () => {
      setHidden(resetBtn, true);
      setHidden(confirmRow, false);
    });

    // ---- About ----
    const st = game.state;
    const per = ui.content.config?.prestige?.incomePerLegacy ?? 0.05;
    const aboutRows = [
      ['Playtime', fmtTime(st.stats.playtime || 0)],
      ['Total earned', money(st.stats.totalEarned || 0)],
      ['Cities founded', num(st.stats.prestiges || 0)],
      ['Legacy', legacyLine(st, game.derived, per)],
      ['Taps', num(st.stats.clicks || 0)],
    ];

    return h('div.settings', [
      h('section.form-section', [
        h('h3.form-title', { text: 'Display' }),
        h('label.form-row', [h('span', { text: 'Number format' }), fmtSelect]),
        h('label.form-row', [h('span', { text: `Autosave every ${autosaveSec} s` }), autosave]),
      ]),
      h('section.form-section', [
        h('h3.form-title', { text: 'Save data' }),
        h('div.btn-row', [saveBtn, exportBtn, copyBtn]),
        exportArea,
        h('div.btn-row', [importBtn]),
        importArea,
      ]),
      recoverSection,
      h('section.form-section', [
        h('h3.form-title', { text: 'Danger zone' }),
        h('p.form-help', { text: 'Erasing the city also clears its save. Export first if you might want it back.' }),
        resetBtn,
        confirmRow,
      ]),
      h('section.form-section', [
        h('h3.form-title', { text: 'This city' }),
        h('dl.about', aboutRows.map(([k, v]) => [h('dt', { text: k }), h('dd.mono', { text: v })])),
      ]),
      status,
    ]);
  }

  return { open: () => modal.open({ title: 'Settings', content: build }) };
}

// '12 (4 free, +60% income)' — reads the simulation's prestige snapshot when it exists.
function legacyLine(st, derived, per) {
  const legacy = (st.prestige && st.prestige.legacy) || 0;
  const spent = (st.prestige && st.prestige.spent) || 0;
  const p = derived && derived.extra && derived.extra.prestige;
  const mult = p && Number.isFinite(p.mult) && p.mult > 0 ? p.mult : 1 + legacy * per;
  const free = Math.max(0, Math.floor(legacy) - Math.floor(spent));
  return `${num(legacy)}${legacy > 0 ? ` (${num(free)} free, +${fmtPct(mult - 1)} income)` : ''}`;
}

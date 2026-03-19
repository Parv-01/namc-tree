/* ═══════════════════════════════════════════════════════════════
   app.js  –  Main Application Controller
   
   Wires together: Store, Tree, API, and all UI events.
   Loaded last so all other scripts are already available.
   ═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   LEVEL COLOURS  (mirrors style.css vars for legend)
───────────────────────────────────────────────────────────── */
const LEVEL_COLORS = [
  null,
  '#f97316', '#fb923c', '#c084fc', '#60a5fa',
  '#4ade80', '#34d399', '#22d3ee', '#a78bfa',
  '#f472b6', '#facc15',
];

/* ─────────────────────────────────────────────────────────────
   DETAIL PANEL CONTROLLER
   Object passed to Tree.init() so tree nodes can open the panel.
───────────────────────────────────────────────────────────── */
const Panel = (() => {

  let _currentCode = null;

  const el = {
    panel:    () => document.getElementById('detailPanel'),
    code:     () => document.getElementById('dpCode'),
    term:     () => document.getElementById('dpTerm'),
    diac:     () => document.getElementById('dpDiac'),
    dev:      () => document.getElementById('dpDev'),
    en:       () => document.getElementById('dpEn'),
    viewDef:  () => document.getElementById('viewDef'),
    viewDiac: () => document.getElementById('viewDiac2'),
    viewDev:  () => document.getElementById('viewDev2'),
    viewEn:   () => document.getElementById('viewEn2'),
    viewOnt:  () => document.getElementById('viewOnt'),
    viewOntSec:() => document.getElementById('viewOntSection'),
    editDef:  () => document.getElementById('editDef'),
    editTerm: () => document.getElementById('editTerm'),
    editDiac: () => document.getElementById('editDiac'),
    editDev:  () => document.getElementById('editDev'),
    editEn:   () => document.getElementById('editEn'),
    tabView:  () => document.getElementById('tabView'),
    tabEdit:  () => document.getElementById('tabEdit'),
  };

  function open(code) {
    _currentCode = code;
    const rec = Store.get(code) || {};

    el.panel().hidden = false;

    // Header
    el.code().textContent = `NAMC Code: ${code}`;
    el.term().textContent = rec.term || code;
    el.diac().textContent = rec.diac || '';
    el.dev().textContent  = rec.dev  || '';
    el.en().textContent   = rec.en   || '';

    // View tab
    el.viewDef().textContent  = rec.long  || '';
    el.viewDiac().textContent = rec.diac  || '';
    el.viewDev().textContent  = rec.dev   || '';
    el.viewEn().textContent   = rec.en    || '';

    if (rec.ontology) {
      el.viewOnt().textContent = rec.ontology;
      el.viewOntSec().hidden = false;
    } else {
      el.viewOntSec().hidden = true;
    }

    // Edit tab – pre-fill
    el.editDef().value  = rec.long  || '';
    el.editTerm().value = rec.term  || '';
    el.editDiac().value = rec.diac  || '';
    el.editDev().value  = rec.dev   || '';
    el.editEn().value   = rec.en    || '';

    // Switch to view tab
    _switchTab('view');
  }

  function close() {
    el.panel().hidden = true;
    _currentCode = null;
    // Remove active class from tree
    document.querySelectorAll('li.dx-treeview-node.active')
      .forEach(li => li.classList.remove('active'));
  }

  function _switchTab(which) {
    document.querySelectorAll('.dp-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === which);
    });
    el.tabView().hidden = (which !== 'view');
    el.tabEdit().hidden = (which !== 'edit');
  }

  function getCurrentCode() { return _currentCode; }

  function init() {
    // Tab switching
    document.querySelectorAll('.dp-tab').forEach(btn => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
    });

    // Close button
    document.getElementById('dpClose').addEventListener('click', close);

    // Save edits
    document.getElementById('editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveEdit();
    });
    document.getElementById('btnSaveEdit').addEventListener('click', async () => {
      await saveEdit();
    });

    // Cancel edit
    document.getElementById('btnCancelEdit').addEventListener('click', () => {
      _switchTab('view');
    });

    // Delete from panel
    document.getElementById('btnDeleteNode').addEventListener('click', () => {
      if (_currentCode) App.showDeleteModal(_currentCode);
    });
  }

  async function saveEdit() {
    if (!_currentCode) return;
    const code = _currentCode;

    const fields = {
      long:  el.editDef().value.trim(),
      term:  el.editTerm().value.trim(),
      diac:  el.editDiac().value.trim(),
      dev:   el.editDev().value.trim(),
      en:    el.editEn().value.trim(),
    };

    // Map to sheet column names for API
    const sheetFields = {
      Long_definition:       fields.long,
      NAMC_term:             fields.term,
      NAMC_term_diacritical: fields.diac,
      NAMC_term_DEVANAGARI:  fields.dev,
      'Name English':        fields.en,
    };

    // Save locally
    Store.saveEdit(code, fields);

    // Try live API sync
    if (API.isEnabled()) {
      try {
        const res = await API.update(code, sheetFields);
        if (res.status === 'ok') {
          App.toast('✓ Saved to Google Sheets!', 'success');
        } else {
          App.toast('Saved locally. Sync failed: ' + res.msg, 'warning');
        }
      } catch (_) {
        App.toast('Saved locally – will sync when online.', 'warning');
      }
    } else {
      App.toast('✓ Saved locally. Export CSV to sync with Excel.', 'success');
    }

    // Refresh panel view
    open(code);
  }

  return { open, close, init, getCurrentCode };
})();

/* ─────────────────────────────────────────────────────────────
   MAIN APP
───────────────────────────────────────────────────────────── */
const App = (() => {

  let _pendingDeleteCode = null;

  /* ── INIT ── */
  async function init() {
    // 1. Initialise data store (merges NAMC_DATA + localStorage edits)
    Store.init();

    // 2. Initialise the detail panel
    Panel.init();

    // 3. Attempt to load fresh data from Sheets (if API is configured)
    if (API.isEnabled()) {
      try {
        const rows = await API.getAll();
        if (rows) _mergeSheetData(rows);
      } catch (e) {
        console.warn('[App] Could not load from Sheets:', e);
      }
    }

    // 4. Build the tree DOM
    const container = document.getElementById('treePanel');
    Tree.init(container, Panel);

    // 5. Update stats line
    _updateStats();

    // 6. Build level legend
    _buildLegend();

    // 7. Wire all UI events
    _wireEvents();

    // 8. Flush any pending sync queue
    window.addEventListener('online', () => Store.flushQueue());
    await Store.flushQueue();
  }

  /* ── Merge fresh sheet rows into the store ── */
  function _mergeSheetData(rows) {
    rows.forEach(row => {
      const code = (row['NAMC_CODE'] || '').trim();
      if (!code) return;
      Store.saveEdit(code, {
        term:     row['NAMC_term']             || '',
        diac:     row['NAMC_term_diacritical'] || '',
        dev:      row['NAMC_term_DEVANAGARI']  || '',
        en:       row['Name English']          || '',
        long:     row['Long_definition']       || '',
        short:    row['Short_definition']      || '',
        ontology: row['Ontology_branches']     || '',
      });
    });
  }

  /* ── STATS ── */
  function _updateStats() {
    const total = Object.keys(NAMC_DATA).length;
    const defs  = Store.defCount;
    const sync  = API.isEnabled() ? ' · Live Sheets sync ON' : ' · Offline mode (Export CSV to sync)';
    document.getElementById('statsLine').textContent =
      `${total} nodes · ${defs} definitions · 50 levels${sync}`;
  }

  /* ── LEGEND ── */
  function _buildLegend() {
    const legend = document.getElementById('levelLegend');
    const items = [
      [1,'Level 1 (Root)'],[2,'L2'],[3,'L3'],[4,'L4'],
      [5,'L5'],[6,'L6'],[7,'L7'],[8,'L8+'],[null,'● Has definition'],
    ];
    legend.innerHTML = items.map(([lv, label]) => {
      if (lv === null) {
        return `<span class="def-legend"><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block"></span> ${label}</span>`;
      }
      const color = LEVEL_COLORS[lv] || '#94a3b8';
      return `<span class="level-legend-item"><span class="level-dot" style="background:${color}"></span>${label}</span>`;
    }).join('');
  }

  /* ── EVENT WIRING ── */
  function _wireEvents() {
    // Expand/Collapse
    document.getElementById('btnExpandAll').addEventListener('click', () => Tree.expandAll());
    document.getElementById('btnCollapseAll').addEventListener('click', () => Tree.collapseAll());
    document.getElementById('btnLevel2').addEventListener('click', () => Tree.collapseToLevel(2));
    document.getElementById('btnLevel4').addEventListener('click', () => Tree.collapseToLevel(4));

    // Search
    const searchEl   = document.getElementById('searchInput');
    const clearBtn   = document.getElementById('searchClear');
    const matchBadge = document.getElementById('matchBadge');
    let searchTimer;

    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = searchEl.value.trim();
        if (q) {
          const n = Tree.search(q);
          matchBadge.textContent = n + ' match' + (n !== 1 ? 'es' : '');
          matchBadge.hidden = false;
          clearBtn.hidden = false;
        } else {
          Tree.clearSearch();
          matchBadge.hidden = true;
          clearBtn.hidden = true;
        }
      }, 200);
    });

    clearBtn.addEventListener('click', () => {
      searchEl.value = '';
      Tree.clearSearch();
      matchBadge.hidden = true;
      clearBtn.hidden = true;
      searchEl.focus();
    });

    // Export CSV
    document.getElementById('btnExport').addEventListener('click', _exportCSV);

    // Add root node button
    document.getElementById('btnAddRoot').addEventListener('click', () => showAddModal(null));

    // Theme toggle
    document.getElementById('btnTheme').addEventListener('click', () => {
      const html = document.documentElement;
      const isLight = html.dataset.theme === 'light';
      html.dataset.theme = isLight ? '' : 'light';
      document.getElementById('btnTheme').textContent = isLight ? '☀' : '🌙';
    });

    // Add Modal
    document.getElementById('addModalClose').addEventListener('click', _closeAddModal);
    document.getElementById('addModalCancel').addEventListener('click', _closeAddModal);
    document.getElementById('addModalSubmit').addEventListener('click', _submitAddModal);

    // Delete Modal
    document.getElementById('deleteModalClose').addEventListener('click', _closeDeleteModal);
    document.getElementById('deleteModalCancel').addEventListener('click', _closeDeleteModal);
    document.getElementById('deleteModalConfirm').addEventListener('click', _executeDelete);

    // Close modals on overlay click
    document.getElementById('addModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeAddModal();
    });
    document.getElementById('deleteModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeDeleteModal();
    });

    // Keyboard: Escape closes panels/modals
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!document.getElementById('addModal').hidden)    { _closeAddModal(); return; }
        if (!document.getElementById('deleteModal').hidden) { _closeDeleteModal(); return; }
        Panel.close();
      }
    });
  }

  /* ── ADD NODE ── */
  let _addParentCode = null;

  function showAddModal(parentCode) {
    _addParentCode = parentCode;
    document.getElementById('newParent').value = parentCode || '';
    // Clear fields
    ['newCode','newTerm','newDiac','newDev','newEn','newDef'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('addModal').hidden = false;
    document.getElementById('newCode').focus();
  }

  function _closeAddModal() {
    document.getElementById('addModal').hidden = true;
    _addParentCode = null;
  }

  async function _submitAddModal() {
    const code = document.getElementById('newCode').value.trim();
    const term = document.getElementById('newTerm').value.trim();

    if (!code || !term) {
      toast('NAMC Code and Sanskrit Term are required.', 'error');
      return;
    }

    const rec = {
      term,
      diac:    document.getElementById('newDiac').value.trim(),
      dev:     document.getElementById('newDev').value.trim(),
      en:      document.getElementById('newEn').value.trim(),
      long:    document.getElementById('newDef').value.trim(),
      short:   '',
      ontology:'',
    };

    // Save to store
    Store.createNode(code, rec);

    // Try live API create
    if (API.isEnabled()) {
      try {
        const res = await API.create({
          NAMC_CODE:             code,
          NAMC_term:             rec.term,
          NAMC_term_diacritical: rec.diac,
          NAMC_term_DEVANAGARI:  rec.dev,
          'Name English':        rec.en,
          Long_definition:       rec.long,
        });
        if (res.status === 'ok') toast('✓ Added to Google Sheets!', 'success');
        else toast('Added locally. Sheets sync: ' + res.msg, 'warning');
      } catch (_) {
        toast('Added locally – will sync when online.', 'warning');
      }
    } else {
      toast(`✓ Node "${code}" added. Export CSV to save to Excel.`, 'success');
    }

    // Inject into DOM
    Tree.injectNode(code, rec, _addParentCode);

    _closeAddModal();
  }

  /* ── DELETE NODE ── */
  function showDeleteModal(code) {
    _pendingDeleteCode = code;
    const rec = Store.get(code) || {};
    document.getElementById('deleteModalMsg').textContent =
      `Delete "${code} — ${rec.term || ''}"? The node will be hidden in the tree and flagged for deletion in your next CSV export.`;
    document.getElementById('deleteModal').hidden = false;
  }

  function _closeDeleteModal() {
    document.getElementById('deleteModal').hidden = true;
    _pendingDeleteCode = null;
  }

  async function _executeDelete() {
    if (!_pendingDeleteCode) return;
    const code = _pendingDeleteCode;

    // Delete from store
    Store.deleteNode(code);

    // Try live API delete
    if (API.isEnabled()) {
      try {
        const res = await API.delete(code);
        if (res.status === 'ok') toast('🗑 Deleted from Google Sheets.', 'success');
        else toast('Deleted locally. Sheets sync: ' + res.msg, 'warning');
      } catch (_) {
        toast('Deleted locally – will sync when online.', 'warning');
      }
    } else {
      toast(`🗑 Node "${code}" deleted. Export CSV to sync.`, 'success');
    }

    // Remove from DOM
    Tree.removeNode(code);

    _closeDeleteModal();
    _updateStats();
  }

  /* ── EXPORT CSV ── */
  function _exportCSV() {
    const csv  = Store.toCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `NAMC_edited_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('✓ CSV exported. Import into Excel or Google Sheets to apply changes.', 'success');
  }

  /* ── TOAST ── */
  function toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    container.appendChild(div);
    setTimeout(() => {
      div.classList.add('fade-out');
      setTimeout(() => div.remove(), 350);
    }, 3800);
  }

  return { init, toast, showAddModal, showDeleteModal };
})();

/* ─────────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => App.init());

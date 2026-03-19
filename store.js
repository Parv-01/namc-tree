/* ═══════════════════════════════════════════════════════════════
   store.js  –  Local State & Persistence Manager
   
   Manages:
     1. The master in-memory data map (merged from data.js + edits)
     2. Pending local edits that haven't been synced to Sheets
     3. Deleted node IDs
     4. Offline sync queue
   
   Storage keys (localStorage):
     namc_edits        – { [code]: { term, diac, dev, en, long, ... } }
     namc_deleted      – string[]  (array of deleted NAMC_CODEs)
     namc_sync_queue   – SyncOp[]  (operations waiting to sync to Sheets)
   ═══════════════════════════════════════════════════════════════ */

const STORAGE_KEYS = {
  EDITS:      'namc_edits',
  DELETED:    'namc_deleted',
  SYNC_QUEUE: 'namc_sync_queue',
};

/* ─────────────────── STATE ─────────────────── */

const Store = (() => {

  /** @type {Map<string, object>} Live data map: NAMC_CODE → record */
  let _data = new Map();

  /** @type {Object<string, object>} Local edits not yet synced */
  let _edits = {};

  /** @type {Set<string>} NAMC codes marked as deleted */
  let _deleted = new Set();

  /** @type {Array<object>} Offline sync queue */
  let _queue = [];

  /* ── Private helpers ── */

  function _load() {
    try {
      const edits = localStorage.getItem(STORAGE_KEYS.EDITS);
      if (edits) _edits = JSON.parse(edits);
    } catch (e) { _edits = {}; }

    try {
      const deleted = localStorage.getItem(STORAGE_KEYS.DELETED);
      if (deleted) _deleted = new Set(JSON.parse(deleted));
    } catch (e) { _deleted = new Set(); }

    try {
      const queue = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      if (queue) _queue = JSON.parse(queue);
    } catch (e) { _queue = []; }
  }

  function _persistEdits()  { localStorage.setItem(STORAGE_KEYS.EDITS,      JSON.stringify(_edits)); }
  function _persistDeleted(){ localStorage.setItem(STORAGE_KEYS.DELETED,    JSON.stringify([..._deleted])); }
  function _persistQueue()  { localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(_queue)); }

  /** Merge base record from NAMC_DATA with any local edits. */
  function _merge(code) {
    const base   = NAMC_DATA[code] || {};
    const edited = _edits[code]    || {};
    return { ...base, ...edited };
  }

  /* ── Public interface ── */

  return {

    /**
     * Initialise: load localStorage overrides, seed Map from NAMC_DATA.
     * Called once by app.js on startup.
     */
    init() {
      _load();
      // Build the live map from embedded data
      for (const code of Object.keys(NAMC_DATA)) {
        _data.set(code, _merge(code));
      }
      // Inject any new nodes created locally but not in NAMC_DATA
      for (const code of Object.keys(_edits)) {
        if (!_data.has(code)) {
          _data.set(code, { ..._edits[code] });
        }
      }
    },

    /* ── READ ── */

    /** @returns {object|null} Merged record for code, or null if not found / deleted */
    get(code) {
      if (_deleted.has(code)) return null;
      return _data.get(code) || null;
    },

    /** @returns {object} Record for code regardless of deleted status */
    getAny(code) {
      return _data.get(code) || NAMC_DATA[code] || {};
    },

    /** @returns {boolean} */
    isDeleted(code) { return _deleted.has(code); },

    /** @returns {boolean} */
    hasDefinition(code) {
      const r = this.get(code);
      return r && Boolean(r.long);
    },

    /** @returns {number} Total live (non-deleted) records */
    get size() { return _data.size - _deleted.size; },

    /** @returns {number} Records with a long definition */
    get defCount() {
      let n = 0;
      _data.forEach((v, k) => { if (!_deleted.has(k) && v.long) n++; });
      return n;
    },

    /* ── WRITE ── */

    /**
     * Save local edits for a node.
     * Merges with existing record, persists to localStorage,
     * and queues for API sync if API is enabled.
     * @param {string} code
     * @param {object} fields – Partial record fields to update
     */
    saveEdit(code, fields) {
      if (!_edits[code]) _edits[code] = {};
      Object.assign(_edits[code], fields);
      _data.set(code, _merge(code));
      _persistEdits();
      this.queueOp({ action: 'UPDATE', code, fields });
    },

    /**
     * Create a brand-new node locally.
     * @param {string} code
     * @param {object} record – Full record object
     */
    createNode(code, record) {
      _edits[code] = { ...record, _new: true };
      _data.set(code, { ...record });
      _persistEdits();
      const fields = {
        NAMC_CODE:             code,
        NAMC_term:             record.term  || '',
        NAMC_term_diacritical: record.diac  || '',
        NAMC_term_DEVANAGARI:  record.dev   || '',
        'Name English':        record.en    || '',
        Long_definition:       record.long  || '',
      };
      this.queueOp({ action: 'CREATE', code, fields });
    },

    /**
     * Mark a node as deleted locally.
     * @param {string} code
     */
    deleteNode(code) {
      _deleted.add(code);
      _persistDeleted();
      this.queueOp({ action: 'DELETE', code });
    },

    /* ── SYNC QUEUE ── */

    /**
     * Add an operation to the offline sync queue.
     * If the API is available it will be flushed immediately.
     * @param {{action: string, code: string, [key: string]: any}} op
     */
    queueOp(op) {
      if (!API.isEnabled()) return; // No backend – local-only
      _queue.push({ ...op, ts: Date.now() });
      _persistQueue();
    },

    /**
     * Flush the offline sync queue to Google Sheets.
     * Called on load and whenever the browser comes online.
     */
    async flushQueue() {
      if (!API.isEnabled() || _queue.length === 0) return;

      const remaining = [];
      for (const op of _queue) {
        try {
          let result;
          if      (op.action === 'UPDATE') result = await API.update(op.code, op.fields);
          else if (op.action === 'DELETE') result = await API.delete(op.code);
          else if (op.action === 'CREATE') result = await API.create(op.fields);

          if (result?.status !== 'ok') remaining.push(op);
        } catch (_) {
          remaining.push(op); // Keep for next attempt
        }
      }

      _queue = remaining;
      _persistQueue();

      if (remaining.length === 0 && _queue.length < remaining.length) {
        console.info('[Store] Sync queue flushed successfully.');
      }
    },

    /* ── EXPORT ── */

    /**
     * Build a CSV string of all data including local edits and deletions.
     * Rows marked deleted have a _deleted column set to "true".
     * @returns {string}
     */
    toCSV() {
      const headers = [
        'NAMC_CODE', 'NAMC_term', 'NAMC_term_diacritical',
        'NAMC_term_DEVANAGARI', 'Name English',
        'Short_definition', 'Long_definition',
        'Ontology_branches', '_deleted',
      ];

      const esc = v => {
        const s = String(v ?? '').replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };

      const rows = [headers.join(',')];

      // All live records
      _data.forEach((rec, code) => {
        if (_deleted.has(code)) return;
        rows.push([
          esc(code),
          esc(rec.term),
          esc(rec.diac),
          esc(rec.dev),
          esc(rec.en),
          esc(rec.short),
          esc(rec.long),
          esc(rec.ontology),
          'false',
        ].join(','));
      });

      // Deleted records (for sheet-side cleanup)
      _deleted.forEach(code => {
        const r = this.getAny(code);
        rows.push([
          esc(code), esc(r.term), '', '', '', '', '', '', 'true',
        ].join(','));
      });

      return rows.join('\n');
    },

    /** Returns pending queue length – useful for UI badges. */
    get pendingCount() { return _queue.length; },
  };
})();

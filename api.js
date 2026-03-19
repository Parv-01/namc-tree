/* ═══════════════════════════════════════════════════════════════
   api.js  –  Google Sheets / Apps Script API Connector

   ⚠️  DO NOT hardcode secrets here.
   API values are injected at build time by scripts/build.sh
   using GitHub Secrets stored in your repository settings.

   To set up secrets:
     GitHub → Repository → Settings → Secrets and variables → Actions
     Add the following repository secrets:

       APPS_SCRIPT_URL   Your deployed Apps Script web app URL
                         e.g. https://script.google.com/macros/s/…/exec

       NAMC_API_KEY      The API key defined in backend/Code.gs
                         Must match EDIT_API_KEY in Code.gs exactly

       SHEET_ID          Your Google Spreadsheet ID (for reference)

   The build script (scripts/build.sh) replaces the placeholder
   tokens below with the real values before deploying to Pages.
   Your secrets are NEVER committed to the repository.
   ═══════════════════════════════════════════════════════════════ */

/* ─────────────────── CONFIGURATION (tokens replaced at build time) ─────────────────── */

const API_CONFIG = {
  /** Injected from secret APPS_SCRIPT_URL by build script. */
  enabled: '__API_ENABLED__' === 'true',

  /** Deployed Apps Script Web App URL. Injected from secret APPS_SCRIPT_URL. */
  url: '__APPS_SCRIPT_URL__',

  /** API key for write operations. Injected from secret NAMC_API_KEY. */
  apiKey: '__NAMC_API_KEY__',

  /** Request timeout in milliseconds. */
  timeout: 8000,
};

/* ─────────────────── INTERNAL HELPERS ─────────────────── */

/**
 * Wraps fetch() with a timeout AbortController.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
async function _fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a POST request to the Apps Script web app.
 * Automatically injects the API key if configured.
 * @param {object} body
 * @returns {Promise<{status: string, [key: string]: any}>}
 */
async function _post(body) {
  if (!API_CONFIG.enabled || !API_CONFIG.url) {
    throw new Error('API not configured');
  }
  const payload = API_CONFIG.apiKey
    ? { ...body, apiKey: API_CONFIG.apiKey }
    : body;

  const res = await _fetchWithTimeout(API_CONFIG.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ─────────────────── PUBLIC API ─────────────────── */

const API = {
  /**
   * Fetch all rows from Google Sheets.
   * Returns an array of row objects keyed by column header.
   * @returns {Promise<Array<object>>}
   */
  async getAll() {
    if (!API_CONFIG.enabled || !API_CONFIG.url) {
      return null; // Caller should fall back to embedded data
    }
    const res = await _fetchWithTimeout(`${API_CONFIG.url}?action=getAll`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data; // Array of row objects
  },

  /**
   * Update one or more columns for a given NAMC_CODE row.
   * @param {string} code  – The NAMC_CODE value (primary key)
   * @param {object} fields – Column→value map, e.g. { Long_definition: "..." }
   * @returns {Promise<{status: string, row: number}>}
   */
  async update(code, fields) {
    return _post({ action: 'UPDATE', code, fields });
  },

  /**
   * Delete the row with the given NAMC_CODE from the sheet.
   * @param {string} code
   * @returns {Promise<{status: string, deleted: string}>}
   */
  async delete(code) {
    return _post({ action: 'DELETE', code });
  },

  /**
   * Append a new row to the sheet.
   * @param {object} fields – Full row as column→value map
   * @returns {Promise<{status: string, created: string}>}
   */
  async create(fields) {
    return _post({ action: 'CREATE', fields });
  },

  /** Returns true if the API is configured and enabled. */
  isEnabled() {
    return API_CONFIG.enabled && Boolean(API_CONFIG.url);
  },
};

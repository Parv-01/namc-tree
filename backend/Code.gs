/**
 * ═══════════════════════════════════════════════════════════════
 * Code.gs  –  Google Apps Script Backend for NAMC Tree
 *
 * HOW TO DEPLOY:
 *   1. Open your Google Sheet that contains NAMC data
 *   2. Click  Extensions → Apps Script
 *   3. Paste this entire file, replacing the default code
 *   4. Click  Deploy → New Deployment
 *   5. Type:  Web App
 *   6. Execute as: Me
 *   7. Who has access: Anyone  (or "Anyone with Google account" for auth)
 *   8. Click Deploy → copy the Web App URL
 *   9. Paste that URL into api.js → API_CONFIG.url
 *  10. Set API_CONFIG.enabled = true in api.js
 *
 * ENDPOINTS:
 *   GET  ?action=getAll          → returns all rows as JSON
 *   POST {action:"UPDATE", code, fields}   → updates a row
 *   POST {action:"DELETE", code}           → deletes a row
 *   POST {action:"CREATE", fields}         → appends a new row
 * ═══════════════════════════════════════════════════════════════
 */

// ── CONFIGURATION ──────────────────────────────────────────────

/**
 * The ID of your Google Spreadsheet.
 * Copy from the URL:
 *   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 */
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

/**
 * Name of the sheet tab that contains NAMC data (default: Sheet1).
 */
const SHEET_NAME = 'Sheet1';

/**
 * Name of the audit-log sheet tab.
 * Created automatically if it does not exist.
 */
const AUDIT_SHEET_NAME = 'AuditLog';

/**
 * Optional API key that clients must send for write operations.
 * Set to '' to disable key checking (public write access).
 * If set, must match API_CONFIG.apiKey in api.js.
 */
const EDIT_API_KEY = '';

// ── HELPERS ────────────────────────────────────────────────────

/**
 * Return the main data sheet.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  return sheet;
}

/**
 * Return the audit-log sheet, creating it if needed.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getAuditSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AUDIT_SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Action', 'NAMC_CODE', 'Field', 'Old Value', 'New Value', 'User']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sheet;
}

/**
 * Find the 1-indexed row number for a given NAMC_CODE.
 * Returns -1 if not found.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number[]} headers  Array of header column names
 * @param {string} code
 * @returns {number}
 */
function findRowByCode(sheet, headers, code) {
  const codeColIndex = headers.indexOf('NAMC_CODE');
  if (codeColIndex === -1) throw new Error('Column "NAMC_CODE" not found in sheet.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  // Read the whole NAMC_CODE column at once (fast)
  const colValues = sheet.getRange(2, codeColIndex + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < colValues.length; i++) {
    if (String(colValues[i][0]).trim() === String(code).trim()) {
      return i + 2; // +1 for 1-index, +1 for header row
    }
  }
  return -1;
}

/**
 * Append a row to the audit log.
 */
function logAudit(action, code, field, oldVal, newVal) {
  try {
    const user = Session.getActiveUser().getEmail() || 'anonymous';
    getAuditSheet().appendRow([
      new Date().toISOString(), action, code, field,
      String(oldVal || ''), String(newVal || ''), user,
    ]);
  } catch (e) {
    // Don't fail the main operation if audit logging fails
    console.warn('Audit log failed:', e);
  }
}

/**
 * Validate the API key for write operations.
 * Returns true if key is valid (or key checking is disabled).
 */
function isAuthorized(body) {
  if (!EDIT_API_KEY) return true;
  return body.apiKey === EDIT_API_KEY;
}

/**
 * Build a JSON response.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET HANDLER ────────────────────────────────────────────────

/**
 * Handle HTTP GET requests.
 * Usage: GET ?action=getAll
 * Returns all rows as an array of objects keyed by header name.
 */
function doGet(e) {
  try {
    const sheet = getSheet();
    const allValues = sheet.getDataRange().getValues();

    if (allValues.length < 2) {
      return jsonResponse({ status: 'ok', data: [] });
    }

    const headers = allValues[0].map(h => String(h).trim());
    const rows = allValues.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] != null ? String(row[i]) : '';
      });
      return obj;
    });

    return jsonResponse({ status: 'ok', data: rows, count: rows.length });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ── POST HANDLER ───────────────────────────────────────────────

/**
 * Handle HTTP POST requests.
 * Body must be JSON with at minimum: { action: "UPDATE"|"DELETE"|"CREATE" }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, code, fields } = body;

    // Authorization check
    if (!isAuthorized(body)) {
      return jsonResponse({ status: 'error', message: 'Unauthorized. Invalid API key.' });
    }

    const sheet = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(h => String(h).trim());

    switch (action) {
      case 'UPDATE': return handleUpdate(sheet, headers, code, fields);
      case 'DELETE': return handleDelete(sheet, headers, code);
      case 'CREATE': return handleCreate(sheet, headers, fields);
      default:
        return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
    }

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ── ACTION HANDLERS ────────────────────────────────────────────

/**
 * Update specific columns in the row matching `code`.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 * @param {string} code        NAMC_CODE value to find
 * @param {object} fields      Column name → new value
 */
function handleUpdate(sheet, headers, code, fields) {
  if (!code) return jsonResponse({ status: 'error', message: 'code is required for UPDATE.' });
  if (!fields || Object.keys(fields).length === 0) {
    return jsonResponse({ status: 'error', message: 'fields is required for UPDATE.' });
  }

  const rowIndex = findRowByCode(sheet, headers, code);
  if (rowIndex === -1) {
    return jsonResponse({ status: 'error', message: 'Row with NAMC_CODE "' + code + '" not found.' });
  }

  const updatedFields = [];
  Object.entries(fields).forEach(([colName, newVal]) => {
    const colIndex = headers.indexOf(colName);
    if (colIndex === -1) {
      console.warn('Column not found, skipping: ' + colName);
      return;
    }
    // Read old value for audit
    const oldVal = sheet.getRange(rowIndex, colIndex + 1).getValue();
    // Set new value
    sheet.getRange(rowIndex, colIndex + 1).setValue(newVal);
    logAudit('UPDATE', code, colName, oldVal, newVal);
    updatedFields.push(colName);
  });

  return jsonResponse({
    status: 'ok',
    code,
    row: rowIndex,
    updatedFields,
  });
}

/**
 * Delete the row matching `code`.
 */
function handleDelete(sheet, headers, code) {
  if (!code) return jsonResponse({ status: 'error', message: 'code is required for DELETE.' });

  const rowIndex = findRowByCode(sheet, headers, code);
  if (rowIndex === -1) {
    return jsonResponse({ status: 'error', message: 'Row with NAMC_CODE "' + code + '" not found.' });
  }

  // Read entire row for audit before deleting
  const rowData = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  logAudit('DELETE', code, 'ALL', JSON.stringify(rowData), '');

  sheet.deleteRow(rowIndex);

  return jsonResponse({ status: 'ok', deleted: code, row: rowIndex });
}

/**
 * Append a new row to the sheet.
 * `fields` should be a column name → value map.
 */
function handleCreate(sheet, headers, fields) {
  if (!fields || !fields['NAMC_CODE']) {
    return jsonResponse({ status: 'error', message: 'fields.NAMC_CODE is required for CREATE.' });
  }

  // Check for duplicate
  const existing = findRowByCode(sheet, headers, fields['NAMC_CODE']);
  if (existing !== -1) {
    return jsonResponse({
      status: 'error',
      message: 'A row with NAMC_CODE "' + fields['NAMC_CODE'] + '" already exists at row ' + existing + '.',
    });
  }

  // Build the new row in header order
  const newRow = headers.map(h => (fields[h] != null ? fields[h] : ''));
  sheet.appendRow(newRow);

  logAudit('CREATE', fields['NAMC_CODE'], 'ALL', '', JSON.stringify(fields));

  return jsonResponse({ status: 'ok', created: fields['NAMC_CODE'] });
}

/**
 * inbox-shepherd — Observation Store
 *
 * Manages the Google Sheets observation store: auto-creates tabs on first run,
 * accumulates routing decisions during a run, and batch-writes them in the
 * finally block (2 Sheets API calls total: setValues + appendRow).
 *
 * Two tabs:
 *   routing_log  — one row per classification decision (RULE, CLASSIFIER, FALLBACK)
 *   run_summary  — one row per Operator run (when threads_processed > 0 or errors)
 */

/** In-memory accumulator for routing_log rows — flushed in finally block. */
var routingLogBuffer_ = [];

/** routing_log column headers (11 columns, per requirements.md §6.1). */
var ROUTING_LOG_HEADERS = [
  'timestamp',
  'thread_id',
  'sender',
  'subject',
  'tier',
  'label',
  'confidence',
  'action',
  'signals_json',
  'dry_run',
  'feedback',
];

/** run_summary column headers (15 columns, per requirements.md §6.1b). */
var RUN_SUMMARY_HEADERS = [
  'timestamp',
  'mode',
  'threads_fetched',
  'threads_processed',
  'tier_header_screen',
  'tier_rule_inbox',
  'tier_rule',
  'tier_classifier',
  'tier_fallback',
  'errors',
  'duration_ms',
  'llm_calls',
  'llm_model',
  'taxonomy_hash',
  'dry_run',
];

/**
 * Ensures the observation spreadsheet has 'routing_log' and 'run_summary' tabs
 * with correct header rows. Creates tabs if missing.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet - The observation spreadsheet
 *   (already opened and validated by validateConfig).
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet} The same spreadsheet object.
 */
function ensureSheet(spreadsheet) {
  // Ensure routing_log tab.
  var routingLog = spreadsheet.getSheetByName('routing_log');
  if (routingLog === null) {
    routingLog = spreadsheet.insertSheet('routing_log');
    routingLog.getRange(1, 1, 1, ROUTING_LOG_HEADERS.length)
      .setValues([ROUTING_LOG_HEADERS]);
    routingLog.setFrozenRows(1);
    console.log('Created routing_log tab with header row');
  }

  // Ensure run_summary tab.
  var runSummary = spreadsheet.getSheetByName('run_summary');
  if (runSummary === null) {
    runSummary = spreadsheet.insertSheet('run_summary');
    runSummary.getRange(1, 1, 1, RUN_SUMMARY_HEADERS.length)
      .setValues([RUN_SUMMARY_HEADERS]);
    runSummary.setFrozenRows(1);
    console.log('Created run_summary tab with header row');
  }

  return spreadsheet;
}

// ---------------------------------------------------------------------------
// Batch accumulator — rows are collected during the run and written once.
// ---------------------------------------------------------------------------

/**
 * Resets the in-memory routing log buffer.
 *
 * Called by Main.gs at the start of each run. Belt-and-suspenders — V8 creates
 * a fresh global scope per trigger execution, but explicit reset is safer.
 */
function resetObservationBuffer() {
  routingLogBuffer_ = [];
}

/**
 * Accumulates a single routing decision row for later batch write.
 *
 * Column-order coupling is contained here — callers pass a named object.
 *
 * @param {Object} rowData
 * @param {string} rowData.threadId   - Gmail thread ID.
 * @param {string} rowData.sender     - Resolved sender (name + address).
 * @param {string} rowData.subject    - Thread subject line.
 * @param {string} rowData.tier       - HEADER_SCREEN | RULE | CLASSIFIER | FALLBACK.
 * @param {string} rowData.label      - Applied label name (or '' for INBOX).
 * @param {number|string} rowData.confidence - Confidence score (Classifier) or ''.
 * @param {string} rowData.action     - ARCHIVED | INBOX (per §6.1).
 * @param {string} rowData.signalsJson - JSON string of routing signals.
 * @param {boolean} rowData.dryRun    - Whether this was a dry-run decision.
 */
function accumulateRow(rowData) {
  routingLogBuffer_.push([
    new Date().toISOString(),                       // timestamp
    rowData.threadId   || '',                        // thread_id
    rowData.sender     || '',                        // sender
    rowData.subject    || '',                        // subject
    rowData.tier       || '',                        // tier
    rowData.label      || '',                        // label
    rowData.confidence !== undefined ? rowData.confidence : '',  // confidence
    rowData.action     || '',                        // action
    rowData.signalsJson || '',                       // signals_json
    rowData.dryRun     ? true : false,               // dry_run
    '',                                              // feedback (human fills later)
  ]);
}

/**
 * Batch-writes all accumulated routing_log rows to Sheets (single setValues call).
 *
 * On failure, falls back to Stackdriver with privacy-safe fields only
 * (thread_id, tier, label, error — no sender/subject).
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet - The observation spreadsheet.
 * @returns {boolean} True if write succeeded or buffer was empty.
 */
function flushRoutingLog(spreadsheet) {
  if (routingLogBuffer_.length === 0) {
    return true;
  }

  try {
    var sheet = spreadsheet.getSheetByName('routing_log');
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, routingLogBuffer_.length, ROUTING_LOG_HEADERS.length)
      .setValues(routingLogBuffer_);
    console.log('Flushed ' + routingLogBuffer_.length + ' rows to routing_log');
    return true;
  } catch (error) {
    // Stackdriver fallback — privacy-safe fields only (no sender/subject).
    console.error('Failed to write routing_log to Sheets: ' + error.message);
    for (var i = 0; i < routingLogBuffer_.length; i++) {
      var row = routingLogBuffer_[i];
      console.error(JSON.stringify({
        fallback: 'routing_log',
        thread_id: row[1],   // thread_id
        tier: row[4],        // tier
        label: row[5],       // label
        error: error.message,
      }));
    }
    return false;
  }
}

/**
 * Writes a single run_summary row to Sheets (single appendRow call).
 *
 * No-op suppression (FR-706): only writes if threadsProcessed > 0 or errors > 0.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet - The observation spreadsheet.
 * @param {Object} summaryData
 * @param {string} summaryData.mode            - MAINTENANCE | CLEANUP.
 * @param {number} summaryData.threadsFetched  - Threads returned by inbox query.
 * @param {number} summaryData.threadsProcessed - Threads that entered the tier pipeline.
 * @param {number} summaryData.tierHeaderScreen - Count routed by Header Screener.
 * @param {number} summaryData.tierRuleInbox   - Count kept in inbox by rules.
 * @param {number} summaryData.tierRule        - Count labeled by rules.
 * @param {number} summaryData.tierClassifier  - Count labeled by Classifier.
 * @param {number} summaryData.tierFallback    - Count that hit fallback.
 * @param {number} summaryData.errors          - Error count.
 * @param {number} summaryData.durationMs      - Run duration in milliseconds.
 * @param {number} summaryData.llmCalls        - Number of LLM API calls made.
 * @param {string} summaryData.llmModel        - LLM model name used.
 * @param {string} summaryData.taxonomyHash    - Hash of taxonomy for drift detection.
 * @param {boolean} summaryData.dryRun         - Whether this was a dry-run.
 * @returns {boolean} True if write succeeded or was suppressed.
 */
function writeRunSummary(spreadsheet, summaryData) {
  // FR-706: suppress no-op runs.
  if ((summaryData.threadsProcessed || 0) === 0 && (summaryData.errors || 0) === 0) {
    return true;
  }

  var row = [
    new Date().toISOString(),                        // timestamp
    summaryData.mode             || '',               // mode
    summaryData.threadsFetched   || 0,                // threads_fetched
    summaryData.threadsProcessed || 0,                // threads_processed
    summaryData.tierHeaderScreen || 0,                // tier_header_screen
    summaryData.tierRuleInbox    || 0,                // tier_rule_inbox
    summaryData.tierRule         || 0,                // tier_rule
    summaryData.tierClassifier   || 0,                // tier_classifier
    summaryData.tierFallback     || 0,                // tier_fallback
    summaryData.errors           || 0,                // errors
    summaryData.durationMs       || 0,                // duration_ms
    summaryData.llmCalls         || 0,                // llm_calls
    summaryData.llmModel         || '',               // llm_model
    summaryData.taxonomyHash     || '',               // taxonomy_hash
    summaryData.dryRun           ? true : false,      // dry_run
  ];

  try {
    var sheet = spreadsheet.getSheetByName('run_summary');
    sheet.appendRow(row);
    console.log('Wrote run_summary row');
    return true;
  } catch (error) {
    // Stackdriver fallback — summary data is non-sensitive.
    console.error('Failed to write run_summary to Sheets: ' + error.message);
    console.error(JSON.stringify({
      fallback: 'run_summary',
      mode: summaryData.mode,
      threads_processed: summaryData.threadsProcessed,
      errors: summaryData.errors,
      duration_ms: summaryData.durationMs,
      error: error.message,
    }));
    return false;
  }
}

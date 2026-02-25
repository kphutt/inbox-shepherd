/**
 * inbox-shepherd — Observation Store
 *
 * Manages the Google Sheets observation store: auto-creates tabs on first run,
 * and (in Phase 2) accumulates routing decisions for batch writing.
 *
 * Two tabs:
 *   routing_log  — one row per classification decision (RULE, CLASSIFIER, FALLBACK)
 *   run_summary  — one row per Operator run (when threads_processed > 0 or errors)
 */

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

/**
 * inbox-shepherd — Main Entry Point
 *
 * processInbox() is the target of the 5-minute time-driven trigger.
 * Phase 1: validates config, acquires lock, ensures labels and sheets, then exits.
 * Later phases add the three-tier pipeline here.
 */

/**
 * Main entry point — target of the 5-minute time-driven trigger.
 */
function processInbox() {
  // Guard: CONFIG must exist (catches deleted/empty Config.js).
  if (typeof CONFIG === 'undefined') {
    console.error('FATAL: CONFIG is not defined. Check that Config.js exists and is valid.');
    return;
  }

  // Acquire script lock — non-blocking. If another instance is running, exit.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    console.log('Another instance is already running. Exiting.');
    return;
  }

  try {
    // Validate configuration. Returns { valid, spreadsheet } — spreadsheet is
    // passed through to avoid a redundant openById() call in ensureSheet().
    var validation = validateConfig();
    if (!validation.valid) {
      console.error('Configuration validation failed. Aborting run.');
      return;
    }

    // Ensure Gmail labels exist (taxonomy + _review + _keep).
    var labelCache = ensureLabels(CONFIG.taxonomy);
    console.log('Label cache ready: ' + labelCache.size + ' managed labels');

    // Ensure observation sheet tabs exist.
    ensureSheet(validation.spreadsheet);
    console.log('Observation store ready');

    // --- Phase 1 stops here. Email processing pipeline added in Phase 5. ---
    console.log('Startup complete. No email processing in this phase.');

  } catch (error) {
    console.error('Unhandled error in processInbox: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Validates all configuration at startup. Fail-fast: stops on first failure.
 *
 * Checks (in order):
 *   1. taxonomy has >= 1 entry
 *   2. ownerEmail is non-empty string
 *   3. GEMINI_API_KEY exists in ScriptProperties
 *   4. OBSERVATION_SHEET_ID exists and sheet is accessible
 *   5. Every non-INBOX rule has a label that exists in taxonomy
 *   6. All taxonomy label names match [A-Za-z0-9 _-]+
 *   Advisory: warn if ownerEmail ≠ Session.getActiveUser().getEmail()
 *
 * @returns {{ valid: boolean, spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet|null }}
 *   valid=true if all checks pass. spreadsheet is the opened observation sheet
 *   (passed through to ensureSheet to avoid a redundant openById call).
 */
function validateConfig() {
  var result = { valid: false, spreadsheet: null };

  // Check 1: taxonomy has >= 1 entry.
  if (!CONFIG.taxonomy || Object.keys(CONFIG.taxonomy).length === 0) {
    console.error('Validation failed: CONFIG.taxonomy must have at least one entry.');
    return result;
  }

  // Check 2: ownerEmail is non-empty string.
  if (typeof CONFIG.ownerEmail !== 'string' || CONFIG.ownerEmail.trim() === '') {
    console.error('Validation failed: CONFIG.ownerEmail must be a non-empty string.');
    return result;
  }

  // Check 3: GEMINI_API_KEY exists and is non-empty in ScriptProperties.
  var apiKey = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.llm.apiKeyProperty);
  if (!apiKey || apiKey.trim() === '') {
    console.error(
      'Validation failed: ScriptProperties "' + CONFIG.llm.apiKeyProperty +
      '" must exist and be non-empty. Set it in the Apps Script editor ' +
      'under Project Settings > Script Properties.'
    );
    return result;
  }

  // Check 4: OBSERVATION_SHEET_ID exists and sheet is accessible.
  var sheetId = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.sheets.spreadsheetIdProperty);
  if (!sheetId || sheetId.trim() === '') {
    console.error(
      'Validation failed: ScriptProperties "' + CONFIG.sheets.spreadsheetIdProperty +
      '" must exist and be non-empty.'
    );
    return result;
  }
  try {
    result.spreadsheet = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    console.error(
      'Validation failed: Cannot open spreadsheet with ID "' + sheetId +
      '". Verify the ID is correct and the script has access. Error: ' + e.message
    );
    return result;
  }

  // Check 5: Every non-INBOX rule has a label that exists in taxonomy.
  var taxonomyKeys = Object.keys(CONFIG.taxonomy);
  for (var i = 0; i < CONFIG.rules.length; i++) {
    var rule = CONFIG.rules[i];
    if (rule.action !== 'INBOX') {
      if (!rule.label) {
        console.error(
          'Validation failed: Rule at index ' + i +
          ' has action "' + (rule.action || 'LABEL') +
          '" but no label field.'
        );
        return result;
      }
      if (taxonomyKeys.indexOf(rule.label) === -1) {
        console.error(
          'Validation failed: Rule at index ' + i +
          ' has label "' + rule.label +
          '" which does not exist in CONFIG.taxonomy. ' +
          'Valid labels: ' + taxonomyKeys.join(', ')
        );
        return result;
      }
    }
  }

  // Check 6: All taxonomy label names match [A-Za-z0-9 _-]+.
  var labelRegex = /^[A-Za-z0-9 _-]+$/;
  for (var j = 0; j < taxonomyKeys.length; j++) {
    if (!labelRegex.test(taxonomyKeys[j])) {
      console.error(
        'Validation failed: Taxonomy label "' + taxonomyKeys[j] +
        '" contains invalid characters. ' +
        'Labels must match [A-Za-z0-9 _-]+ (letters, digits, spaces, underscores, hyphens).'
      );
      return result;
    }
  }

  // Advisory: warn if ownerEmail doesn't match the authenticated session user.
  // Session.getActiveUser().getEmail() may return empty in time-driven triggers.
  try {
    var sessionEmail = Session.getActiveUser().getEmail();
    if (sessionEmail && sessionEmail !== CONFIG.ownerEmail) {
      console.warn(
        'Warning: CONFIG.ownerEmail ("' + CONFIG.ownerEmail +
        '") does not match authenticated user ("' + sessionEmail +
        '"). This may be expected for aliases.'
      );
    }
  } catch (e) {
    // Not a failure — just can't verify in this context.
  }

  console.log('Configuration validation passed.');
  result.valid = true;
  return result;
}

/**
 * Creates a 5-minute time-driven trigger for processInbox().
 * Run once from the Apps Script editor. Skips if trigger already exists.
 */
function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') {
      console.log(
        'Trigger for processInbox already exists (ID: ' +
        triggers[i].getUniqueId() + '). Skipping creation.'
      );
      return;
    }
  }

  ScriptApp.newTrigger('processInbox')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('Created 5-minute time-driven trigger for processInbox.');
}

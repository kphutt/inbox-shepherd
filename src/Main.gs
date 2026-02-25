/**
 * inbox-shepherd — Main Entry Point
 *
 * processInbox() is the target of the 5-minute time-driven trigger.
 * Three-tier pipeline: Header Screener → Rules → Classifier.
 * Observations batch-written in finally block.
 */

/**
 * Deterministic short hash for taxonomy drift detection.
 * Sorts keys alphabetically, JSON-stringifies, djb2 hash → 8-char hex.
 *
 * @param {Object} taxonomy - CONFIG.taxonomy object.
 * @returns {string} 8-character hex hash.
 */
function computeTaxonomyHash(taxonomy) {
  var keys = Object.keys(taxonomy).sort();
  var obj = {};
  for (var i = 0; i < keys.length; i++) {
    obj[keys[i]] = taxonomy[keys[i]];
  }
  var str = JSON.stringify(obj);
  var hash = 5381;
  for (var j = 0; j < str.length; j++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(j);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Selects operational mode and batch size based on inbox thread count.
 *
 * @param {number} threadCount - Number of threads returned by probe query.
 * @param {Object} config - CONFIG object (needs operator.backlogThreshold, operator.batchSize).
 * @returns {{ mode: string, batchSize: number }}
 */
function computeMode(threadCount, config) {
  if (threadCount > config.operator.backlogThreshold) {
    return { mode: 'CLEANUP', batchSize: config.operator.batchSize.cleanup };
  }
  return { mode: 'MAINTENANCE', batchSize: config.operator.batchSize.maintenance };
}

/**
 * Main entry point — target of the 5-minute time-driven trigger.
 *
 * Three-tier pipeline: Header Screener (Tier 1) → Rules (Tier 2) → Classifier (Tier 3).
 * First tier that claims the thread terminates processing for that thread.
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

  // ── Variables accessible in finally ──────────────────────────────────
  var startTime = Date.now();
  var validation = null;
  var mode = '';
  var dryRun = CONFIG.operator.dryRun;
  var debug = CONFIG.operator.debug;
  var taxonomyHash = '';

  // Counters for run_summary
  var threadsFetched = 0, threadsProcessed = 0;
  var tierHeaderScreen = 0, tierRuleInbox = 0, tierRule = 0;
  var tierClassifier = 0, tierFallback = 0;
  var errors = 0, llmCalls = 0;

  // Classifier failure tracking (FR-016)
  var classifierEligible = 0, classifierSuccesses = 0;

  // Circuit breaker — tripped by 429 or 3-min time guard
  var llmUnavailable = false;

  // State from ScriptProperties (read at startup, written in finally)
  var consecutiveFailures = 0;
  var lastSuccessfulRun = null;
  var apiKey = '';

  try {
    // ── Startup phase ────────────────────────────────────────────────
    validation = validateConfig();
    if (!validation.valid) {
      console.error('Configuration validation failed. Aborting run.');
      return;
    }

    var labelCache = ensureLabels(CONFIG.taxonomy);
    var managedLabelNames = getManagedLabelNames(labelCache);
    ensureSheet(validation.spreadsheet);
    resetObservationBuffer();

    var props = PropertiesService.getScriptProperties();
    apiKey = props.getProperty(CONFIG.llm.apiKeyProperty);
    taxonomyHash = computeTaxonomyHash(CONFIG.taxonomy);

    consecutiveFailures = parseInt(props.getProperty('consecutiveFailures') || '0', 10);
    var lsr = props.getProperty('lastSuccessfulRun');
    lastSuccessfulRun = lsr ? new Date(lsr) : null;

    var classifierConfig = { llm: { model: CONFIG.llm.model }, apiKey: apiKey };

    // ── Query phase — mode detection ─────────────────────────────────
    var probeThreads = getInboxThreads(CONFIG.operator.backlogThreshold + 1);
    threadsFetched = probeThreads.length;
    var modeInfo = computeMode(threadsFetched, CONFIG);
    mode = modeInfo.mode;
    var threads = probeThreads.slice(0, modeInfo.batchSize);

    if (debug) {
      console.log('Mode: ' + mode + ', threads fetched: ' + threadsFetched +
                  ', batch size: ' + threads.length);
    }

    // ── Processing loop — per-thread pipeline ────────────────────────
    for (var t = 0; t < threads.length; t++) {
      // Soft limit: 4 min → stop all processing
      if (Date.now() - startTime > 240000) {
        console.log('Soft limit (4 min) reached. Stopping processing.');
        break;
      }

      var thread = threads[t];
      var threadId = thread.getId();

      try {
        // Skip if already labeled by Operator (FR-011)
        if (isAlreadyLabeled(thread, managedLabelNames)) {
          continue;
        }

        // Resolve sender — skip all-self threads
        var sender = resolveSender(thread, CONFIG.ownerEmail);
        if (!sender) {
          continue;
        }
        var senderStr = sender.name
          ? sender.name + ' <' + sender.address + '>'
          : sender.address;
        var subject = CONFIG.operator.logSubject
          ? thread.getFirstMessageSubject()
          : '';

        // Dry-run dedup (FR-702): skip threads already seen in previous runs
        if (dryRun && lastSuccessfulRun !== null) {
          if (thread.getLastMessageDate() <= lastSuccessfulRun) {
            continue;
          }
        }

        threadsProcessed++;

        // ── TIER 1: Header Screener ──────────────────────────────
        var screenResult = screenThread(sender.message, CONFIG.ownerEmail);
        if (!screenResult.isBulk) {
          tierHeaderScreen++;
          if (debug) {
            console.log('Thread ' + threadId + ': Tier 1 pass-through (personal)');
          }
          continue;
        }

        // ── TIER 2: Rules Engine ─────────────────────────────────
        var realSubject = thread.getFirstMessageSubject();
        var ruleResult = matchRule(sender, realSubject, CONFIG.rules);

        if (ruleResult !== null && ruleResult.action === 'INBOX') {
          tierRuleInbox++;
          if (debug) {
            console.log('Thread ' + threadId + ': Tier 2 INBOX rule');
          }
          continue;
        }

        if (ruleResult !== null) {
          tierRule++;
          if (!dryRun) {
            thread.addLabel(labelCache.get(ruleResult.label));
            thread.markRead();
            thread.moveToArchive();
          }
          var matchKey = Object.keys(ruleResult.rule.match)[0];
          accumulateRow({
            threadId: threadId,
            sender: senderStr,
            subject: subject,
            tier: 'RULE',
            label: ruleResult.label,
            confidence: '',
            action: 'ARCHIVED',
            signalsJson: JSON.stringify({
              matchType: matchKey,
              matchValue: ruleResult.rule.match[matchKey]
            }),
            dryRun: dryRun
          });
          continue;
        }

        // ── TIER 3: Classifier ───────────────────────────────────
        classifierEligible++;

        // Circuit breaker: skip LLM if unavailable
        if (llmUnavailable) {
          continue;
        }

        // Time guard: 3 min → stop LLM calls (60s buffer for hung call + Sheets)
        if (Date.now() - startTime > 180000) {
          llmUnavailable = true;
          console.log('Time guard (3 min) reached. Skipping remaining LLM calls.');
          continue;
        }

        var annotations = buildAnnotations(sender.message, CONFIG.ownerEmail);
        var snippet = extractBodySnippet(sender.message, CONFIG.operator.maxBodyChars);
        var email = {
          name: sender.name,
          address: sender.address,
          subject: realSubject,
          snippet: snippet
        };

        llmCalls++;
        var result = classifyThread(annotations, email, CONFIG.taxonomy, classifierConfig);

        if (result.errorType === 'API_ERROR') {
          errors++;
          if (result.error && result.error.indexOf('HTTP 429') !== -1) {
            llmUnavailable = true;
            console.log('HTTP 429 received. Circuit breaker tripped.');
          }
          console.error('Thread ' + threadId + ': Classifier API error: ' + result.error);
          continue;
        }

        if (result.errorType === 'PARSE_ERROR') {
          tierFallback++;
          if (!dryRun) {
            thread.addLabel(labelCache.get('_review'));
            // No archive, no markRead — thread stays in inbox
          }
          accumulateRow({
            threadId: threadId,
            sender: senderStr,
            subject: subject,
            tier: 'FALLBACK',
            label: '_review',
            confidence: '',
            action: 'INBOX',
            signalsJson: JSON.stringify({ error: result.error }),
            dryRun: dryRun
          });
          continue;
        }

        // Success — result has .label and .confidence
        classifierSuccesses++;
        tierClassifier++;
        if (!dryRun) {
          thread.addLabel(labelCache.get(result.label));
          thread.markRead();
          thread.moveToArchive();
        }
        accumulateRow({
          threadId: threadId,
          sender: senderStr,
          subject: subject,
          tier: 'CLASSIFIER',
          label: result.label,
          confidence: result.confidence,
          action: 'ARCHIVED',
          signalsJson: JSON.stringify(annotations),
          dryRun: dryRun
        });

      } catch (threadError) {
        // Per-thread error isolation (NFR-101)
        errors++;
        console.error('Thread ' + threadId + ': ' + threadError.message);
      }
    }

  } catch (error) {
    errors++;
    console.error('Unhandled error in processInbox: ' + error.message);
  } finally {
    var durationMs = Date.now() - startTime;
    var props = PropertiesService.getScriptProperties();

    // 1. Flush routing log
    if (validation && validation.spreadsheet) {
      try {
        flushRoutingLog(validation.spreadsheet);
      } catch (e) {
        console.error('Failed to flush routing log: ' + e.message);
      }
    }

    // 2. Write run summary
    if (validation && validation.spreadsheet) {
      try {
        writeRunSummary(validation.spreadsheet, {
          mode: mode,
          threadsFetched: threadsFetched,
          threadsProcessed: threadsProcessed,
          tierHeaderScreen: tierHeaderScreen,
          tierRuleInbox: tierRuleInbox,
          tierRule: tierRule,
          tierClassifier: tierClassifier,
          tierFallback: tierFallback,
          errors: errors,
          durationMs: durationMs,
          llmCalls: llmCalls,
          llmModel: CONFIG.llm.model,
          taxonomyHash: taxonomyHash,
          dryRun: dryRun
        });
      } catch (e) {
        console.error('Failed to write run summary: ' + e.message);
      }
    }

    // 3. Update ScriptProperties state (FR-016)
    try {
      var isRunFailure = classifierEligible > 0 && classifierSuccesses === 0;
      if (isRunFailure) {
        props.setProperty('consecutiveFailures', String(consecutiveFailures + 1));
      } else {
        props.setProperty('consecutiveFailures', '0');
      }
      if (!isRunFailure && threadsProcessed > 0) {
        props.setProperty('lastSuccessfulRun', new Date().toISOString());
      }
    } catch (e) {
      console.error('Failed to update ScriptProperties: ' + e.message);
    }

    // 4. Release lock
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

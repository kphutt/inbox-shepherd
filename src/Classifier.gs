/**
 * inbox-shepherd — Classifier
 *
 * Tier 3: LLM-based email classification via Gemini API.
 * Handles unknown senders that pass through Header Screener and Rules.
 */

// ── Module-level constants ──────────────────────────────────────────

var DISAMBIGUATION_RULES_ = [
  'Receipt or purchase confirmation -> Shopping (not Financial)',
  'When in doubt between topical label and Newsletters -> prefer topical',
  'Bank promotional email -> Financial (not Marketing)',
];

// ── Public functions ────────────────────────────────────────────────

/**
 * Classifies an email thread using the Gemini API.
 *
 * @param {{ platform: string, addressing: string, noreply: boolean }} annotations
 *   From buildAnnotations().
 * @param {{ name: string, address: string, subject: string, snippet: string }} email
 *   Assembled by Main.gs from resolveSender + thread data.
 * @param {Object.<string, string>} taxonomy - CONFIG.taxonomy (label → description).
 * @param {{ llm: { model: string }, apiKey: string }} config
 *   Runtime config assembled by Main.gs.
 * @param {Function} [callApiFn] - Optional API function for testing.
 * @returns {{ label: string, confidence: string } | { error: string, errorType: string }}
 */
function classifyThread(annotations, email, taxonomy, config, callApiFn) {
  var callApi = callApiFn || callGeminiApi_;
  var prompt = buildClassifierPrompt_(taxonomy, annotations, email);
  var result = callApi(prompt, config.llm.model, config.apiKey);

  if (!result.ok) {
    // Safety-filtered (status 200) → PARSE_ERROR (retrying is futile)
    // HTTP errors (429/500/etc) → API_ERROR (retry next run)
    var errorType = (result.status === 200) ? 'PARSE_ERROR' : 'API_ERROR';
    return { error: result.error, errorType: errorType };
  }

  var parsed = parseClassifierResponse(result.text, Object.keys(taxonomy));
  if (!parsed) {
    return { error: 'Invalid classifier response: ' + (result.text || '').substring(0, 50), errorType: 'PARSE_ERROR' };
  }
  return parsed;  // { label, confidence }
}

/**
 * Parses a classifier response string into label and confidence.
 *
 * Expected format: "CATEGORY|CONFIDENCE" (e.g. "Shopping|high").
 * Falls back to scanning lines for a taxonomy key match.
 *
 * @param {string} responseText - Raw response from the LLM.
 * @param {string[]} taxonomyKeys - Valid category names from CONFIG.taxonomy.
 * @returns {{ label: string, confidence: string } | null}
 */
function parseClassifierResponse(responseText, taxonomyKeys) {
  // Null-safe guard
  if (!responseText || typeof responseText !== 'string') return null;

  var trimmed = responseText.trim();
  if (!trimmed) return null;

  var candidate, confidence;
  var pipeIdx = trimmed.indexOf('|');

  if (pipeIdx !== -1) {
    // Has pipe — split on first pipe only
    candidate = trimmed.substring(0, pipeIdx).trim();
    var rawConfidence = trimmed.substring(pipeIdx + 1).trim().toLowerCase();
    confidence = (rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low')
      ? rawConfidence : 'low';
  } else {
    // No pipe — scan each line for a taxonomy key match
    var lines = trimmed.split('\n');
    var found = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      // Strip common LLM formatting artifacts (trailing period, then bold markers)
      line = line.replace(/\.$/, '').replace(/^\*+|\*+$/g, '').trim();
      for (var j = 0; j < taxonomyKeys.length; j++) {
        if (line.toLowerCase() === taxonomyKeys[j].toLowerCase()) {
          candidate = line;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) return null;
    confidence = 'low';
  }

  // Strip LLM formatting artifacts from pipe-split candidate too
  candidate = candidate.replace(/\.$/, '').replace(/^\*+|\*+$/g, '').trim();

  // Case-insensitive match — find the ORIGINAL-CASED taxonomy key
  var matchedKey = null;
  var candidateLower = candidate.toLowerCase();
  for (var k = 0; k < taxonomyKeys.length; k++) {
    if (taxonomyKeys[k].toLowerCase() === candidateLower) {
      matchedKey = taxonomyKeys[k];  // Original casing from taxonomy
      break;
    }
  }

  if (!matchedKey) return null;
  return { label: matchedKey, confidence: confidence };
}

// ── Private functions ───────────────────────────────────────────────

/**
 * Builds the classification prompt from taxonomy, annotations, and email data.
 *
 * @param {Object.<string, string>} taxonomy - Label → description map.
 * @param {{ platform: string, addressing: string, noreply: boolean }} annotations
 * @param {{ name: string, address: string, subject: string, snippet: string }} email
 * @returns {string} The assembled prompt.
 * @private
 */
function buildClassifierPrompt_(taxonomy, annotations, email) {
  var categories = Object.keys(taxonomy);
  var categoryLines = '';
  for (var i = 0; i < categories.length; i++) {
    categoryLines += '- ' + categories[i] + ': ' + taxonomy[categories[i]] + '\n';
  }

  var ruleLines = '';
  for (var j = 0; j < DISAMBIGUATION_RULES_.length; j++) {
    ruleLines += '- ' + DISAMBIGUATION_RULES_[j] + '\n';
  }

  // From line — omit angle brackets if name is empty
  var fromLine = 'From: ';
  if (email.name) {
    fromLine += email.name + ' <' + email.address + '>';
  } else {
    fromLine += email.address;
  }
  if (annotations.platform) {
    fromLine += ' ' + annotations.platform;
  }

  var addressingLine = 'Addressing: ' + annotations.addressing;
  if (annotations.noreply) {
    addressingLine += ' [noreply]';
  }

  var subjectLine = 'Subject: ' + (email.subject || '(none)');

  var lines = [
    'Classify this email into exactly one category.',
    'This email has already been confirmed as automated/bulk mail.',
    '',
    'CATEGORIES:',
    categoryLines.trimEnd(),
    '',
    'RULES:',
    ruleLines.trimEnd(),
    '',
    'EMAIL:',
    fromLine,
    addressingLine,
    subjectLine,
  ];

  if (email.snippet) {
    lines.push('---');
    lines.push(email.snippet);
  }

  lines.push('');
  lines.push('Respond with: CATEGORY|CONFIDENCE (high/medium/low)');

  return lines.join('\n');
}

/**
 * Calls the Gemini API with a prompt.
 *
 * @param {string} prompt - The prompt text.
 * @param {string} model - Model identifier (e.g. "gemini-2.0-flash").
 * @param {string} apiKey - Gemini API key.
 * @returns {{ ok: true, text: string } | { ok: false, status: number, error: string }}
 * @private
 */
function callGeminiApi_(prompt, model, apiKey) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 20 }
    }),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    return { ok: false, status: 0, error: 'Fetch failed: ' + (e.message || 'unknown') };
  }

  var statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    return { ok: false, status: statusCode, error: 'HTTP ' + statusCode };
  }

  // Parse JSON response
  var body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    return { ok: false, status: 200, error: 'JSON parse error: ' + e.message };
  }

  // Check prompt-level blocking
  var blockReason = body.promptFeedback && body.promptFeedback.blockReason;
  if (blockReason) {
    return { ok: false, status: 200, error: 'Prompt blocked: ' + blockReason };
  }

  // Extract text with defensive traversal
  var text = extractResponseText_(body);
  var finishReason = body.candidates && body.candidates[0] && body.candidates[0].finishReason;
  if (!text) {
    return { ok: false, status: 200, error: 'Empty response' + (finishReason ? ' (' + finishReason + ')' : '') };
  }

  // Check for non-STOP finish reasons (SAFETY, RECITATION, MAX_TOKENS, OTHER)
  if (finishReason && finishReason !== 'STOP') {
    return { ok: false, status: 200, error: 'Non-standard finish: ' + finishReason };
  }

  return { ok: true, text: text };
}

/**
 * Extracts the text content from a Gemini API response body.
 *
 * @param {Object} body - Parsed JSON response.
 * @returns {string|null} Trimmed text or null.
 * @private
 */
function extractResponseText_(body) {
  if (!body || !body.candidates || !body.candidates.length) return null;
  var candidate = body.candidates[0];
  if (!candidate || !candidate.content) return null;
  var parts = candidate.content.parts;
  if (!parts || !parts.length) return null;
  var text = parts[0].text;
  return text ? text.trim() : null;
}

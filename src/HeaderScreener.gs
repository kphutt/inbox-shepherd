/**
 * inbox-shepherd — Header Screener (Tier 1)
 *
 * Examines bulk-mail indicators on a single message. OR logic: any single
 * indicator fires → thread is bulk. Personal email (no indicators) passes
 * through untouched.
 *
 * FR-105: exceptions return { isBulk: false } — false negatives are safe,
 * false positives are dangerous.
 */

/**
 * Screens a message for bulk-mail indicators.
 *
 * @param {GmailMessage} message - The message to inspect (typically the
 *   most recent non-self message from resolveSender).
 * @param {string} ownerEmail - The account owner's email address.
 * @returns {{ isBulk: boolean, signals: Object.<string, boolean> }}
 */
function screenThread(message, ownerEmail) {
  try {
    var signals = {};

    // 1. List-Unsubscribe header present
    if (getHeader_(message, 'List-Unsubscribe')) {
      signals.listUnsubscribe = true;
    }

    // 2. List-Id header present
    if (getHeader_(message, 'List-Id')) {
      signals.listId = true;
    }

    // 3. Precedence matches bulk|list|junk
    var precedence = getHeader_(message, 'Precedence');
    if (precedence && /bulk|list|junk/i.test(precedence)) {
      signals.precedence = true;
    }

    // 4. X-Distribution matches bulk
    var xDist = getHeader_(message, 'X-Distribution');
    if (xDist && /bulk/i.test(xDist)) {
      signals.xDistribution = true;
    }

    // 5. List-Unsubscribe-Post header present
    if (getHeader_(message, 'List-Unsubscribe-Post')) {
      signals.listUnsubscribePost = true;
    }

    // 6. Noreply sender pattern
    var parsed = parseFromHeader(message.getFrom());
    if (/^(noreply|no-reply|donotreply)@/i.test(parsed.address)) {
      signals.noreply = true;
    }

    // 7. BCC-only: ownerEmail not in To or Cc
    var toHeader = getHeader_(message, 'To') || '';
    var ccHeader = getHeader_(message, 'Cc') || '';
    var ownerLower = ownerEmail.toLowerCase();
    if (toHeader.toLowerCase().indexOf(ownerLower) === -1 &&
        ccHeader.toLowerCase().indexOf(ownerLower) === -1) {
      signals.bccOnly = true;
    }

    return { isBulk: Object.keys(signals).length > 0, signals: signals };
  } catch (e) {
    console.warn('screenThread error: ' + e.message);
    return { isBulk: false, signals: {} };
  }
}

/**
 * Reads a raw RFC header from a GmailMessage.
 *
 * Apps Script exposes headers via message.getHeader(name) (Workspace add-on)
 * or via the raw MIME content. GmailMessage has no built-in getHeader, so
 * we use the Advanced Gmail service via the raw message approach — but the
 * simplest portable method is getRawContent() + regex.
 *
 * To avoid parsing the full raw message every time, we cache parsed headers
 * on the message object.
 *
 * @param {GmailMessage} message - The Gmail message.
 * @param {string} headerName - Header name (case-insensitive).
 * @returns {string} Header value, or empty string if not found.
 * @private
 */
function getHeader_(message, headerName) {
  // Cache parsed headers on the message to avoid re-parsing raw content.
  if (!message._parsedHeaders) {
    message._parsedHeaders = {};
    var raw = message.getRawContent();
    // Headers end at first blank line.
    var headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      headerEnd = raw.indexOf('\n\n');
    }
    var headerBlock = headerEnd > -1 ? raw.substring(0, headerEnd) : raw;

    // Unfold continuation lines (lines starting with whitespace).
    headerBlock = headerBlock.replace(/\r?\n[ \t]+/g, ' ');

    var lines = headerBlock.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var colonIdx = lines[i].indexOf(':');
      if (colonIdx > 0) {
        var key = lines[i].substring(0, colonIdx).trim().toLowerCase();
        var val = lines[i].substring(colonIdx + 1).trim();
        // Keep first occurrence only (standard behavior).
        if (!message._parsedHeaders[key]) {
          message._parsedHeaders[key] = val;
        }
      }
    }
  }

  return message._parsedHeaders[headerName.toLowerCase()] || '';
}

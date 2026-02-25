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
    if (getHeader(message, 'List-Unsubscribe')) {
      signals.listUnsubscribe = true;
    }

    // 2. List-Id header present
    if (getHeader(message, 'List-Id')) {
      signals.listId = true;
    }

    // 3. Precedence matches bulk|list|junk
    var precedence = getHeader(message, 'Precedence');
    if (precedence && /bulk|list|junk/i.test(precedence)) {
      signals.precedence = true;
    }

    // 4. X-Distribution matches bulk
    var xDist = getHeader(message, 'X-Distribution');
    if (xDist && /bulk/i.test(xDist)) {
      signals.xDistribution = true;
    }

    // 5. List-Unsubscribe-Post header present
    if (getHeader(message, 'List-Unsubscribe-Post')) {
      signals.listUnsubscribePost = true;
    }

    // 6. Noreply sender pattern
    var parsed = parseFromHeader(message.getFrom());
    if (isNoreply(parsed.address)) {
      signals.noreply = true;
    }

    // 7. BCC-only: ownerEmail not in To or Cc
    var toHeader = getHeader(message, 'To') || '';
    var ccHeader = getHeader(message, 'Cc') || '';
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

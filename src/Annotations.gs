/**
 * inbox-shepherd — Annotations
 *
 * Signal extraction for the Classifier prompt. Detects sending platform,
 * addressing mode, and noreply status from email headers.
 */

// ── Module-level constants ──────────────────────────────────────────

var ESP_DOMAINS_ = {
  'sendgrid.net': 'SendGrid',
  'mailchimp.com': 'Mailchimp',
  'mcsv.net': 'Mailchimp',
  'amazonses.com': 'Amazon SES',
  'mailgun.org': 'Mailgun',
  'mandrillapp.com': 'Mandrill',
  'postmarkapp.com': 'Postmark',
  'rsgsv.net': 'Mailchimp',
  'msgfocus.com': 'Adestra',
  'constantcontact.com': 'Constant Contact',
  'sailthru.com': 'Sailthru',
  'klaviyomail.com': 'Klaviyo',
  'hubspot.com': 'HubSpot',
};

// ── Public functions ────────────────────────────────────────────────

/**
 * Builds annotation signals for a message.
 *
 * @param {GmailMessage} message - The resolved sender's message.
 * @param {string} ownerEmail - The account owner's email address.
 * @returns {{ platform: string, addressing: string, noreply: boolean }}
 */
function buildAnnotations(message, ownerEmail) {
  var senderAddress = parseFromHeader(message.getFrom()).address;
  return {
    platform: detectPlatform_(message),
    addressing: detectAddressing_(message, ownerEmail),
    noreply: isNoreply(senderAddress),
  };
}

// ── Private functions ───────────────────────────────────────────────

/**
 * Detects the sending platform from the Return-Path header.
 *
 * @param {GmailMessage} message - The Gmail message.
 * @returns {string} Platform annotation (e.g. "[via SendGrid]") or empty string.
 * @private
 */
function detectPlatform_(message) {
  var rp = getHeader(message, 'Return-Path');
  if (!rp) return '';
  // Strip angle brackets (Return-Path value is typically <addr>)
  rp = rp.replace(/^<|>$/g, '').trim();
  var atIdx = rp.lastIndexOf('@');
  if (atIdx === -1) return '';
  var domain = rp.substring(atIdx + 1).toLowerCase();

  // Dictionary lookup with dot-boundary check
  var keys = Object.keys(ESP_DOMAINS_);
  for (var i = 0; i < keys.length; i++) {
    if (domain === keys[i] || domain.endsWith('.' + keys[i])) {
      return '[via ' + ESP_DOMAINS_[keys[i]] + ']';
    }
  }
  // Campaign Monitor special case: cmail{N}.com (e.g., cmail20.com)
  if (/^cmail\d+\.com$/.test(domain)) {
    return '[via Campaign Monitor]';
  }
  return '';
}

/**
 * Detects addressing mode (direct, CC, or BCC/undisclosed).
 *
 * @param {GmailMessage} message - The Gmail message.
 * @param {string} ownerEmail - The account owner's email address.
 * @returns {string} "direct", "CC", or "BCC/undisclosed".
 * @private
 */
function detectAddressing_(message, ownerEmail) {
  var ownerLower = ownerEmail.toLowerCase();
  var to = getHeader(message, 'To');
  var cc = getHeader(message, 'Cc');

  if (to && containsAddress_(to, ownerLower)) return 'direct';
  if (cc && containsAddress_(cc, ownerLower)) return 'CC';
  return 'BCC/undisclosed';
}

/**
 * Checks whether a header value contains a specific email address.
 *
 * Splits on commas, parses each recipient via parseFromHeader, and
 * compares the full address to avoid substring collisions.
 *
 * @param {string} headerValue - Raw header value (e.g. To or Cc).
 * @param {string} targetAddress - Lowercase email address to find.
 * @returns {boolean}
 * @private
 */
function containsAddress_(headerValue, targetAddress) {
  var parts = headerValue.split(',');
  for (var i = 0; i < parts.length; i++) {
    var parsed = parseFromHeader(parts[i].trim());
    if (parsed.address.toLowerCase() === targetAddress) return true;
  }
  return false;
}

/**
 * inbox-shepherd — Utility Functions
 *
 * Shared infrastructure for the three-tier pipeline: inbox querying,
 * thread filtering, sender resolution, and body text extraction.
 */

/**
 * Returns threads currently in the inbox.
 *
 * Wraps GmailApp.search — single point of change for query tuning.
 * Gmail tabs (Promotions, Social, etc.) are still `is:inbox` and get processed.
 *
 * @param {number} batchSize - Maximum threads to return.
 * @returns {GmailThread[]} Array of inbox threads (empty if inbox is empty).
 */
function getInboxThreads(batchSize) {
  return GmailApp.search('is:inbox', 0, batchSize);
}

/**
 * Parses an RFC 5322 From header string into name and address parts.
 *
 * Handles:
 *   "Display Name <email@example.com>" → { name: "Display Name", address: "email@example.com" }
 *   "email@example.com"                → { name: "",             address: "email@example.com" }
 *   '"Quoted Name" <email@example.com>'→ { name: "Quoted Name",  address: "email@example.com" }
 *
 * @param {string} fromString - Raw From header value.
 * @returns {{ name: string, address: string }}
 */
function parseFromHeader(fromString) {
  if (!fromString) {
    return { name: '', address: '' };
  }

  var angleStart = fromString.lastIndexOf('<');
  if (angleStart === -1) {
    // Bare address — no angle brackets.
    return { name: '', address: fromString.trim() };
  }

  var angleEnd = fromString.indexOf('>', angleStart);
  var address = fromString.substring(angleStart + 1, angleEnd > angleStart ? angleEnd : fromString.length).trim();
  var name = fromString.substring(0, angleStart).trim();

  // Strip surrounding quotes from display name.
  if (name.length >= 2 && name.charAt(0) === '"' && name.charAt(name.length - 1) === '"') {
    name = name.substring(1, name.length - 1);
  }

  return { name: name, address: address };
}

/**
 * Resolves the most recent non-self sender for a thread.
 *
 * Walks messages newest-to-oldest, skipping messages from ownerEmail.
 * Returns null for all-self threads (the thread will be skipped by Main.gs).
 *
 * @param {GmailThread} thread - The Gmail thread to inspect.
 * @param {string} ownerEmail - The account owner's email address.
 * @returns {{ name: string, address: string, message: GmailMessage } | null}
 *   Includes the resolved message reference so downstream consumers
 *   (HeaderScreener, extractBodySnippet) don't re-walk the thread.
 */
function resolveSender(thread, ownerEmail) {
  var messages = thread.getMessages();
  if (messages.length === 0) {
    console.warn('resolveSender: thread ' + thread.getId() + ' has 0 messages');
    return null;
  }

  var ownerLower = ownerEmail.toLowerCase();

  // Walk newest-to-oldest.
  for (var i = messages.length - 1; i >= 0; i--) {
    var parsed = parseFromHeader(messages[i].getFrom());
    if (parsed.address.toLowerCase() !== ownerLower) {
      return { name: parsed.name, address: parsed.address, message: messages[i] };
    }
  }

  // All messages are from self.
  return null;
}

/**
 * Checks whether a thread already has any Operator-managed label.
 *
 * The label IS the processed marker (FR-011) — no separate flag needed.
 *
 * @param {GmailThread} thread - The Gmail thread to check.
 * @param {Set<string>} managedLabelNames - Set from getManagedLabelNames().
 * @returns {boolean} True if thread has at least one managed label.
 */
function isAlreadyLabeled(thread, managedLabelNames) {
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (managedLabelNames.has(labels[i].getName())) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts a privacy-safe body snippet from a Gmail message.
 *
 * Pipeline:
 *   1. Try getPlainBody() — use if non-empty after trim
 *   2. Fall back to getBody() (HTML): strip tags, decode entities
 *   3. Normalize whitespace
 *   4. Redact URLs → [link]
 *   5. Truncate to maxChars
 *
 * The snippet is ephemeral — never written to Sheets.
 *
 * @param {GmailMessage} message - The Gmail message.
 * @param {number} [maxChars=100] - Maximum snippet length.
 * @returns {string} Sanitized body snippet (may be empty).
 */
function extractBodySnippet(message, maxChars) {
  if (maxChars === undefined) {
    maxChars = 100;
  }

  var text = '';

  // Step 1: Try plain text body.
  var plain = message.getPlainBody();
  if (plain && plain.trim().length > 0) {
    text = plain;
  } else {
    // Step 2: Fall back to HTML body — strip to plain text.
    var html = message.getBody();
    if (html) {
      text = stripHtmlToText_(html);
    }
  }

  if (!text) {
    return '';
  }

  // Step 3: Normalize whitespace.
  text = text.replace(/\s+/g, ' ').trim();

  // Step 4: Redact URLs.
  text = text.replace(/https?:\/\/\S+/g, '[link]');

  // Step 5: Truncate.
  if (text.length > maxChars) {
    text = text.substring(0, maxChars);
  }

  return text;
}

/**
 * Strips HTML tags and decodes common entities to produce plain text.
 *
 * @param {string} html - Raw HTML string.
 * @returns {string} Plain text approximation.
 * @private
 */
function stripHtmlToText_(html) {
  // Strip HTML tags — replace with space to preserve word boundaries.
  var text = html.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities.
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&apos;/gi, "'");

  // Decode numeric entities (decimal and hex).
  text = text.replace(/&#(\d+);/g, function(match, dec) {
    return String.fromCharCode(parseInt(dec, 10));
  });
  text = text.replace(/&#x([0-9a-fA-F]+);/g, function(match, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return text;
}

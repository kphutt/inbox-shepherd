/**
 * inbox-shepherd — Rules Engine (Tier 2)
 *
 * Pure function — no Google API calls, fully testable locally.
 * Iterates the rules array (first-match-wins) and returns the matching
 * rule with its resolved action and label, or null if nothing matches.
 */

/**
 * Finds the first matching rule for a sender/subject pair.
 *
 * @param {{ name: string, address: string }} sender - From resolveSender().
 * @param {string} subject - Thread subject line.
 * @param {Array<Object>} rules - CONFIG.rules array.
 * @returns {{ rule: Object, action: string, label: string|undefined } | null}
 *   null when no rule matches. INBOX rules return label: undefined.
 */
function matchRule(sender, subject, rules) {
  if (!rules || !rules.length) {
    return null;
  }

  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (!rule || !rule.match) {
      continue;
    }

    var match = rule.match;

    if (match.senderDomain) {
      var addr = (sender && sender.address) ? sender.address : '';
      var atIdx = addr.lastIndexOf('@');
      var domain = atIdx > -1 ? addr.substring(atIdx + 1) : '';
      if (domain.toLowerCase() === match.senderDomain.toLowerCase()) {
        return buildResult_(rule);
      }
    }

    if (match.senderAddress) {
      var addr = (sender && sender.address) ? sender.address : '';
      if (addr.toLowerCase() === match.senderAddress.toLowerCase()) {
        return buildResult_(rule);
      }
    }

    if (match.subjectContains) {
      var subj = subject || '';
      if (subj.toLowerCase().indexOf(match.subjectContains.toLowerCase()) !== -1) {
        return buildResult_(rule);
      }
    }

    if (match.displayName) {
      var name = (sender && sender.name) ? sender.name : '';
      if (name.toLowerCase() === match.displayName.toLowerCase()) {
        return buildResult_(rule);
      }
    }
  }

  return null;
}

/**
 * Builds the return object for a matched rule.
 *
 * @param {Object} rule - The matched rule from CONFIG.rules.
 * @returns {{ rule: Object, action: string, label: string|undefined }}
 * @private
 */
function buildResult_(rule) {
  var action = rule.action || 'LABEL';
  return {
    rule: rule,
    action: action,
    label: action === 'INBOX' ? undefined : rule.label,
  };
}

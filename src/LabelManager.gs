/**
 * inbox-shepherd — Label Management
 *
 * Ensures all required Gmail labels exist at startup and provides
 * a cached Map for efficient label lookups during processing.
 *
 * Managed labels = taxonomy keys + '_review' + '_keep'.
 * - _review: fallback label for malformed Classifier responses (thread stays in inbox)
 * - _keep: human-only escape hatch (never auto-applied, means "don't touch this thread")
 */

/**
 * Ensures all required Gmail labels exist: taxonomy keys + '_review' + '_keep'.
 * Creates any missing labels. Returns a Map of managed labels for cached lookups.
 *
 * @param {Object} taxonomy - The CONFIG.taxonomy object (keys are label names).
 * @returns {Map<string, GmailLabel>} Label cache mapping name → GmailLabel object.
 */
function ensureLabels(taxonomy) {
  var requiredNames = Object.keys(taxonomy);
  requiredNames.push('_review');
  requiredNames.push('_keep');

  // Fetch all existing user labels and index by name for O(1) lookup.
  var existingLabels = GmailApp.getUserLabels();
  var existingByName = new Map();
  for (var i = 0; i < existingLabels.length; i++) {
    existingByName.set(existingLabels[i].getName(), existingLabels[i]);
  }

  // Create missing labels, build managed-only cache.
  var labelCache = new Map();
  for (var j = 0; j < requiredNames.length; j++) {
    var name = requiredNames[j];
    var label = existingByName.get(name);
    if (!label) {
      label = GmailApp.createLabel(name);
      console.log('Created Gmail label: ' + name);
    }
    labelCache.set(name, label);
  }

  return labelCache;
}

/**
 * Returns the Set of managed label names for skip-if-labeled checks.
 * Convenience wrapper — extracts keys from the label cache Map.
 *
 * @param {Map<string, GmailLabel>} labelCache - The cache returned by ensureLabels().
 * @returns {Set<string>} Set of managed label names.
 */
function getManagedLabelNames(labelCache) {
  return new Set(labelCache.keys());
}

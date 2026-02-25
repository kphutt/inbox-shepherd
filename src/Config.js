/**
 * inbox-shepherd — User Configuration
 *
 * All user-specific configuration lives here. System logic never contains
 * hardcoded sender addresses or label names. Secrets (API key, Sheet ID)
 * are stored in ScriptProperties — this file holds property NAMES only
 * and is safe to commit to version control.
 *
 * To customize: edit ownerEmail, taxonomy, and rules below.
 * To add a category: add one line to taxonomy.
 * To add a routing rule: add one entry to rules.
 */
const CONFIG = {
  // Gmail address of the account owner. Used for sender resolution
  // (skipping messages from self to find the real sender).
  ownerEmail: 'alice@gmail.com',

  // Tier 2 routing rules. First-match-wins. Each entry has a match object
  // and an action. INBOX rules leave the thread in inbox (no label).
  // Label rules apply the label, mark read, and archive.
  //
  // Match types (all case-insensitive, no regex):
  //   senderDomain   — exact domain match (e.g., 'chase.com')
  //   senderAddress  — exact email match (e.g., 'alerts@chase.com')
  //   subjectContains — substring match (e.g., 'verification code')
  //   displayName    — exact From display name match
  //
  // Label rules start empty. The Strategist populates them based on
  // observation data showing consistent sender-to-label patterns.
  rules: [
    { match: { subjectContains: 'verification code' }, action: 'INBOX' },
    { match: { subjectContains: 'security alert' },    action: 'INBOX' },
    { match: { senderAddress: 'notifications-noreply@google.com' }, action: 'INBOX' },
  ],

  // Label taxonomy. Keys = Gmail label names. Values = descriptions fed
  // to the Classifier prompt (IF-105). Adding a category = add one line.
  taxonomy: {
    'Financial':   'Banking, investment, tax, bills, subscription billing',
    'Shopping':    'Retail purchases, order confirmations, shipping/delivery',
    'Marketing':   'Promotional email, sales, coupons, product announcements',
    'Newsletters': 'Subscribed content — digests, roundups, editorial newsletters',
    'Scouting':    'BSA scouting — troop/pack communication, campouts, meetings',
    'Kids':        'School, extracurriculars, childcare, parent logistics',
    'Career':      'Job alerts, recruiter platforms, professional networking',
    'Government':  'Government agencies, civic notifications, official correspondence',
    'Travel':      'Airline itineraries, hotel confirmations, resort bookings',
    'Security':    'Breach notices, account change confirmations, security digests',
  },

  // LLM configuration for Tier 3 Classifier.
  llm: {
    model: 'gemini-2.0-flash',
    apiKeyProperty: 'GEMINI_API_KEY',       // ScriptProperties key name
  },

  // Operator runtime settings.
  operator: {
    batchSize: { cleanup: 100, maintenance: 50 },
    backlogThreshold: 200,    // Inbox count above which Cleanup Mode activates
    maxBodyChars: 100,        // Body snippet truncation length for LLM prompt
    logSubject: true,         // Record subject lines in observation store
    dryRun: true,             // Log observations but don't modify Gmail
    debug: false,             // Verbose Stackdriver logging
  },

  // Observation store (Google Sheets).
  sheets: {
    spreadsheetIdProperty: 'OBSERVATION_SHEET_ID',  // ScriptProperties key name
  },
};

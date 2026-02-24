# inbox-shepherd — Operator Design

> **Version:** 5.1 · **Date:** 2026-02-24 · **Status:** Implementation-Ready  
> **Author:** Karsten Huttelmaier  
> **Scope:** Data Plane (email routing engine) only. See [strategist brainstorm](../strategist/brainstorm.md) for Control Plane design. See [ROADMAP.md](../../../ROADMAP.md) for the full initiative backlog.

---

## 1. Executive Summary

This document defines the requirements for the **inbox-shepherd Operator** — a serverless email routing engine that processes Gmail threads through a deterministic pipeline, classifying and archiving automated traffic while preserving human email in the Inbox.

The Operator is the **data plane.** It executes rules. It does not decide what the rules should be. That responsibility belongs to the **control plane** (the Strategist), which is specified in a [separate design document](../strategist/brainstorm.md).

**The fundamental problem this system solves is not email filtering — it is taxonomy drift.** Email filters and labels go stale because people's habits and life circumstances change. The Operator is designed to be controlled by an evolving ruleset, not to own that ruleset. It processes email, logs every decision it makes, and exposes clean observation data for whatever control plane is managing the rules — whether that's a human with a Gemini prompt, a cron script, or a future AI agent.

### Design Principles

1. **Zero Trust / Default-Deny:** All inbound email is untrusted by default. Only positively identified human senders remain in the Inbox. Everything else must be classified and routed.

2. **Separate the Data Plane from the Control Plane:** The system that *runs* email through rules (the Operator) and the system that *builds and maintains* those rules (the Strategist) are entirely separate pieces of software with different cadences, cost profiles, and risk tolerances. This document covers the Operator only.

3. **Observable:** The Operator logs every routing decision with enough context that the control plane can analyze, learn, and propose changes. The observation log is the Operator's primary interface contract with the Strategist.

4. **Non-Destructive by Default:** v1 never deletes email content. It labels, marks read, and archives. Deletion is a future capability with its own requirements cycle.

5. **Resilient to Neglect:** If the Operator breaks or is offline for days, weeks, or months, it catches up automatically when restored. No manual intervention required.

6. **Retroactive Consistency:** The Operator supports reclassification of historical threads when rules change. The email archive can be kept consistent with the *current* taxonomy — but the decision to reclassify is made by the control plane, not the Operator.

7. **Conservative by Default:** Retroactive reclassification is a capability the Operator exposes, not something it initiates. The control plane decides when to trigger it, and it should require sustained signal and human approval. The Operator's default is to leave historical threads untouched.

> **Principles 6 and 7 are in deliberate tension.** The Operator *can* reclassify. It *rarely should.* The resolution lives in the Strategist's requirements: sustained signal thresholds, human approval gates, and scope-of-impact estimates. The Operator simply executes reclassification when instructed.

8. **Portable:** A friend can fork the repo, customize the configuration file, and run the Operator against their own Gmail. v1 requires manual config editing.

9. **Zero Operational Burden:** The system must not replace manual effort in one area with manual effort in another. If managing email by hand is the problem, managing the system that manages email cannot be the solution. The Operator runs unattended, gets cheaper over time (as the Strategist promotes rules that bypass the LLM), and degrades safely when neglected. The only recurring human effort is occasional corrections — which are the same corrections a person would make anyway, but now they compound into better rules.

---

## 2. Problem Statement

### 2.1 Current State (Typical Gmail Power User)

- **Filter Staleness:** Gmail filters are static. New senders appear, old ones go dormant, and filters stop reflecting reality.
- **Filter Bloat:** Over time, native filters accumulate as 1-to-1 sender mappings. Some lack "Skip Inbox" entirely. No easy way to audit or prune.
- **Label Bloat:** Deprecated labels from past life events. Active labels that no longer reflect current habits.
- **No Triage for Unknown Senders:** New automated senders land directly in the Inbox. There is no mechanism to classify them without creating a new filter.
- **Gmail Category Tabs Are Insufficient:** 5 broad buckets (Promotions, Social, Updates, Forums, Primary) with no user control over taxonomy, no visibility into classification decisions, and no ability to fix mistakes structurally.
- **Taxonomy Drift:** The label and filter system is a snapshot of life from when it was last maintained. It doesn't keep up because maintaining it is the same manual work filters were supposed to eliminate.

### 2.2 Why Previous Approaches Failed

Native Gmail filters fail because they are **static rules in a dynamic environment.** Adding a filter is easy. Noticing that a filter is stale, redundant, or miscategorized requires human attention that never comes. The Operator is one half of the solution — a fast, cheap, reliable routing engine. The other half — the intelligence that keeps the rules current — is the Strategist's job.

---

## 3. Goals and Non-Goals

### 3.1 Goals

1. Establish a zero-trust Inbox where only personal (non-bulk) email remains.
2. Protect personal email from accidental classification via Header Screener (Tier 1) — zero cost, zero configuration.
3. Route known automated traffic deterministically via static rules (Tier 2) with zero LLM dependency.
4. Classify unknown automated traffic via LLM (Tier 3) with a constrained label taxonomy.
5. **Log every routing decision** with enough context for external analysis.
6. **Accept feedback** — expose a mechanism for the control plane (or human) to mark routing decisions as correct or incorrect.
7. **Support taxonomy operations** — merge labels at launch; add, split, retire when instructed by the control plane (deferred).
8. Process any inbox backlog automatically using the same pipeline as steady-state (Cleanup Mode).
9. Support two operational modes: Cleanup Mode (large backlog) and Maintenance Mode (steady-state).
10. Catch up automatically after any period of downtime.
11. Be forkable with isolated configuration for new users.

### 3.2 Non-Goals (v1)

- **Deciding** what the rules should be. The Operator executes rules; the Strategist defines them.
- **Proposing** taxonomy changes. That's the Strategist.
- Auto-replying to or drafting responses for any email.
- Spam/malware detection (Gmail handles this).
- **Deleting any email content.** v1 is non-destructive.
- Integration with external services beyond Gemini API.
- Multi-account support.
- Google Drive cleanup (separate project).
- Sensitive information detection.
- Unsubscribe automation.

### 3.3 v1 Scope Boundary

What ships in v1 launch vs. what is deferred:

| **v1 Launch** | **Deferred** |
|--------------|-------------|
| Header Screener → Rules → Classifier pipeline | Filter audit and cleanup (§7.7) |
| Dry-run mode | Alert email on consecutive failures (v1.1, adds `gmail.send` scope) |
| Observation store (routing_log + run_summary) | Taxonomy ops: `reclassify`, `splitLabel`, `retireLabel` |
| `mergeLabels` (for pre-launch label migration) | Archived email backfill (scope is `is:inbox` only) |
| `undoSince(timestamp)` manual recovery helper | Strategist automation (separate project) |
| `_review` fallback + `_keep` human override | |
| `logSubject` config toggle (observation privacy) | |
| Label auto-creation at startup | |
| Startup config validation | |

See brainstorm §18 for rationale on each deferral.

---

## 4. Stakeholders and Constraints

### 4.1 Stakeholders

| Role | Who | Interest |
|------|-----|----------|
| Owner | *(you)* | Inbox signal quality, zero-maintenance taxonomy, privacy |
| Consumers | Family members | Labeled emails accessible when needed |
| Future Users | Friends / forks | Self-onboarding with minimal friction |

### 4.2 Platform Constraints

| Constraint | Detail |
|-----------|--------|
| Execution Limit | 6-minute max per Apps Script invocation. All operations must be resumable. |
| Trigger Granularity | Minimum 1-minute interval. Target: 5-minute (single trigger, dynamic batch size). |
| Gmail API Limits | 250 quota units/second. |
| Gemini API Limits | Free tier (15 RPM, 1500 RPD) insufficient for v1 all-Classifier workload. Paid API key required. Must still degrade gracefully on 429. |
| No Push Triggers | Gmail has no inbound event trigger. Polling only. |
| Concurrent Access | Gmail API operations are safe during active UI use. Threads may visibly move while the user is reading — this is desired behavior. |

### 4.3 Privacy and Security Constraints

| Constraint | Detail |
|-----------|--------|
| Data Residency | Email metadata sent to Gemini API (`googleapis.com`) under paid-tier terms. No data sent to non-Google services. See NFR-202 for full policy. |
| Data Minimization (LLM) | LLM sees only: sender name+address (with platform annotation), addressing annotation (NOT owner's email), subject, truncated plain-text body (100 chars default). HTML stripped, URLs redacted. Owner email never in prompt. |
| Data Minimization (Logs) | Stackdriver fallback logs: thread_id, tier, label, error message only. No sender addresses or subject lines in Cloud Logging. |
| Credential Storage | API key in `PropertiesService` (encrypted at rest), never in source. |
| Observation Store | Contains sender addresses and subject lines. Must remain private (owner-only access). Never share with "anyone with the link." |
| Label Name Safety | Taxonomy label names validated at startup: `[A-Za-z0-9 _-]+` only. |
| Prompt Injection | Email body is untrusted input fed to LLM. Mitigated by strict output parsing (taxonomy validation + `_review` fallback). Blast radius: one email's classification. |
| OAuth Scopes | `gmail.modify` (broad but minimum required), `script.external_request` (unbounded — cannot restrict to specific domains, Apps Script limitation). Review all code before deploying. |
| API Key Rotation | If compromised: revoke in Google AI Studio, generate new key, update ScriptProperties. Key is Gemini-only (no Gmail/Sheets access). |

---

## 5. Architectural Decisions

### 5.1 Control Plane / Data Plane Architecture

The system is split into two entirely separate pieces of software:

| | **Operator (Data Plane)** | **Strategist (Control Plane)** |
|---|---|---|
| **This document** | ✅ Yes | ❌ No — see [strategist brainstorm](../strategist/brainstorm.md) |
| **Responsibility** | Execute rules, route email, log decisions | Analyze logs, propose rule changes, learn from feedback |
| **Cadence** | Every 5 minutes | Daily → weekly (or manual) |
| **Cost** | v1: Paid Gemini Flash API call per bulk email (free tier insufficient — see brainstorm §7). Reduces over time as Strategist promotes rules | Variable (Pro, pattern analysis, or human + prompt) |
| **Autonomy** | Fully autonomous within its ruleset | Always proposes, never unilaterally executes |
| **v1 implementation** | Apps Script + clasp | Human + Gemini prompt (manual) |

**v1 Strategist is manual.** The owner reviews the observation log, pastes relevant data into Gemini, decides what rules to change, updates `Config.js`, and runs `clasp push`. This is acceptable for a single-operator system. Automating the Strategist is a separate project.

**The interface contract between them** is defined in §6 of this document: the observation log schema, the feedback format, and the taxonomy operations the Operator exposes.

### 5.2 Where Does State Live?

| What | Where | Why |
|------|-------|-----|
| Routing rules | `Config.js` (source code) | Version-controlled, type-safe, no external dependency |
| Taxonomy | `Config.js` (source code) | Drives Classifier prompt dynamically (IF-105) |
| Runtime state | `ScriptProperties` | `consecutiveFailures` (int), `lastSuccessfulRun` (ISO 8601). Persists across executions. |
| API key | `ScriptProperties` (`GEMINI_API_KEY`) | Encrypted at rest, never in source |
| Observation sheet ID | `ScriptProperties` (`OBSERVATION_SHEET_ID`) | Encrypted at rest, never in source |
| Observation log | Google Sheets (dedicated workbook) | Queryable, human-readable, consumable by future Strategist |
| Feedback / corrections | Google Sheets (same workbook) | Human (or future Strategist) writes; Operator reads on next taxonomy update |
| Email data | Gmail (never copied) | Read and mutate in-place via `GmailApp` |
| Execution logs | Stackdriver | Automatic, retained by Google |

### 5.2b Config.js Data Structure

All user-specific configuration lives in a single file (`Config.js`). Secrets (API key, sheet ID) are stored in ScriptProperties and referenced by property name — Config.js is safe to commit to version control.

```javascript
const CONFIG = {
  ownerEmail: 'alice@gmail.com',

  rules: [
    { match: { subjectContains: 'verification code' }, action: 'INBOX' },
    { match: { subjectContains: 'security alert' },    action: 'INBOX' },
    // Label rules start empty. Populated by the Strategist.
  ],

  taxonomy: {
    'Financial':   'Banking, investment, tax, bills, subscription billing',
    'Shopping':    'Retail purchases, order confirmations, shipping/delivery',
    'Marketing':   'Promotional email, sales, coupons, product announcements',
    'Newsletters': 'Subscribed content — digests, roundups, editorial newsletters',
    // ... user adds/removes categories here
  },

  llm: {
    model: 'gemini-2.0-flash',
    apiKeyProperty: 'GEMINI_API_KEY',
  },

  operator: {
    batchSize: { cleanup: 100, maintenance: 50 },
    backlogThreshold: 200,
    maxBodyChars: 100,
    logSubject: true,
    dryRun: true,
    debug: false,
  },

  sheets: {
    spreadsheetIdProperty: 'OBSERVATION_SHEET_ID',
  },
};
```

| Field | Type | Purpose | Notes |
|-------|------|---------|-------|
| `ownerEmail` | string | Sender resolution — skip messages from owner to find the real sender (FR-012). | Validated at startup. Warning if ≠ `Session.getActiveUser().getEmail()` (NFR-105). |
| `rules` | array | Tier 2 routing dictionary. First-match-wins (FR-202). | Each entry has a `match` object and an `action`. |
| `rules[].match` | object | One of: `senderDomain` (exact), `senderAddress` (exact), `subjectContains` (substring), `displayName` (exact). All case-insensitive (FR-200). | Exactly one match key per rule. |
| `rules[].action` | enum | `'INBOX'` = leave in inbox (no label). `'LABEL'` = apply label + mark read + archive. Default `'LABEL'` if omitted. | INBOX rules protect urgent automated email (2FA, security alerts) that has bulk headers (FR-201). |
| `rules[].label` | string | Required when action is `'LABEL'`. Must exist as a key in `taxonomy` — validated at startup (NFR-105). | Omitted for INBOX rules. |
| `taxonomy` | object | Keys = Gmail label names. Values = descriptions fed to Classifier prompt (IF-105). | Labels auto-created at startup (FR-203). Adding a category = add one line. |
| `llm.model` | string | Gemini model string (FR-306). | Default `gemini-2.0-flash`. |
| `llm.apiKeyProperty` | string | ScriptProperties key name where the API key is stored. | Key itself never in source (NFR-201). |
| `operator.batchSize` | object | `cleanup` and `maintenance` thread counts per run (FR-401, FR-402). | |
| `operator.backlogThreshold` | integer | Inbox count above which Cleanup Mode activates (FR-403). | Default 200. |
| `operator.maxBodyChars` | integer | Body snippet truncation length for LLM prompt (FR-300). | Default 100. Increase if classification quality suffers. |
| `operator.logSubject` | boolean | Whether subject lines are recorded in observation store. | Default `true` for validation. Set `false` to reduce stored PII. |
| `operator.dryRun` | boolean | When `true`, calls LLM and logs observations but does not modify Gmail (FR-701). | Start `true`, flip after review. |
| `operator.debug` | boolean | Verbose Stackdriver logging (NFR-401). | |
| `sheets.spreadsheetIdProperty` | string | ScriptProperties key name where the observation sheet ID is stored. | Sheet itself never referenced in source. |

### 5.3 Where Does Routing Happen?

All routing happens in the Apps Script code. The Operator uses `is:inbox` — native Gmail filters are irrelevant to its operation. Existing filters may cause some email to be double-processed (filter archives AND Operator would have archived), but this is harmless. Filter audit and cleanup is deferred to post-launch (§7.7).

### 5.4 LLM Model

**Gemini 2.0 Flash** for Tier 3 classification. ~300-400 input tokens, single-label output, temperature 0. The task is simple classification — Flash provides near-identical accuracy to Pro at a fraction of the cost and latency. The model is configurable without code changes (FR-306).

### 5.5 Operational Modes

| Mode | Batch Size | Trigger |
|------|-----------|---------|
| **Cleanup Mode** | 100 threads | Dynamic — activated when unprocessed count > backlog threshold |
| **Maintenance Mode** | 50 threads | Dynamic — default when backlog is manageable |

**Single 5-minute trigger.** Both modes use the same trigger. At the start of each run, the Operator counts unprocessed threads and selects the appropriate batch size. Mode is computed, not stored — no trigger manipulation needed. This handles the "offline for weeks then restarted" scenario: the first run sees a large backlog, uses cleanup batch size, and continues at that rate until caught up.

### 5.6 Downtime Resilience

The Operator is stateless with respect to timing. It searches for unprocessed threads (`is:inbox`, skipping any with an Operator-managed label), not "new since last run."

- **1 week offline:** Next run processes the backlog. Auto-enters Cleanup Mode until caught up.
- **Months offline:** Same behavior, just more batches. Progress is resumable across executions.
- **No manual intervention required.**

### 5.7 Deletion Safety

**v1 is non-destructive.** No email content is deleted. The only destructive operations in v1 are:

- Deprecated **label deletion** (after audit + thread migration via `mergeLabels`).

Native **filter audit and cleanup** is deferred to post-launch (§7.7). Labels are deleted only after confirming zero remaining threads.

### 5.8 Label Strategy

| Action | Detail |
|--------|--------|
| **Auto-create at startup** | All taxonomy labels defined in `Config.js`, plus `_review` (fallback) and `_keep` (human override). |
| **Deprecated label cleanup** | Owner audits their own deprecated labels before launch. Use `mergeLabels(source, target)` for remaps, then delete deprecated labels after confirming zero remaining threads. |
| **Retained labels** | If existing Gmail labels match taxonomy names, the Operator adopts them — existing threads are unaffected. |

The taxonomy is user-defined in `Config.js`. The default v1 taxonomy has 10 categories (see brainstorm §4.8 for rationale), but the Operator is taxonomy-agnostic — it works with whatever categories the user configures.

Retained labels keep their existing threads. The control plane may instruct the Operator to merge labels at any time. Other taxonomy operations (split, retire, reclassify) are deferred.

### 5.9 Concurrent Use and Manual Override Safety

Gmail API operations do not conflict with the Gmail web/mobile UI:

- If the user is reading a thread that the Operator archives, the thread moves out of the inbox view. The user can still read the open thread.
- If the user is viewing the inbox while the Operator processes, threads may visibly disappear. This is the intended behavior.
- The Operator does not modify thread content — only labels, read state, and inbox membership.

**Manual overrides are always preserved.** The Operator only processes threads that are (a) in the inbox AND (b) have no Operator-managed label. If the user manually labels, relabels, or archives a thread between runs, the Operator will not undo that change. Removing an Operator label and leaving a thread in inbox is an explicit "re-process" signal — the Operator will classify it fresh on the next run.

### 5.10 Thread vs. Message Granularity

The Operator processes **threads**, not individual messages.

- **Sender identification:** Uses the most recent non-self sender (walk messages newest-to-oldest, skip messages from `ownerEmail`).
- **All-self threads:** If every message is from the account owner (self-reminder, BCC to self), skip processing — leave in inbox untouched.
- **Known edge case:** If a human starts a thread and an automated system adds a later message, the resolved sender is the automated system. The thread may be classified and archived. Accepted as rare — the observation store surfaces these for review.

### 5.11 Observation Store Retention

**Corrected estimate:** The routing_log only records classification decisions (RULE, CLASSIFIER, FALLBACK), not Header Screener "leave in inbox" non-actions. At ~60–90 classifications/day:

- ~90 rows/day × 14 columns = ~1,260 cells/day
- Google Sheets limit: 10M cells. The sheet fills in **~21 years.**
- Run summary adds ~50 rows/day (non-empty runs only). Negligible.

The original estimate (~14,400 rows/day) incorrectly assumed all trigger firings produced observations and counted Header Screener re-evaluations of personal email. With HEADER_SCREEN excluded from Sheets logging, retention is a non-issue for the foreseeable future.

### 5.12 Error Alerting

Stackdriver logging is passive — no one checks it proactively. If the Operator fails on 3+ consecutive runs (API key expired, Gemini rate-limited, Sheets quota exceeded), it shall send an alert email to the account owner. This prevents the "online-but-broken for weeks" failure mode.

---

## 6. Interface Contract with Control Plane

This section defines what the Operator **exposes** for any control plane — whether that's a human with a prompt, a future Strategist script, or a full AI agent. The Operator makes no assumptions about what consumes this data.

### 6.1 Observation Log (Operator → Control Plane)

The Operator writes one row per **classification decision** to Google Sheets. Decisions that leave threads in inbox (Header Screener passes AND Rule INBOX matches) are NOT logged to Sheets — they generate no classification, and the unlabeled threads would create massive duplicate rows on re-evaluation. These decisions are tracked in the `run_summary` tier counts and Stackdriver logs.

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | ISO 8601 | When the routing decision was made |
| `thread_id` | string | Gmail thread ID |
| `sender` | string | Resolved sender (most recent non-self From: address) |
| `subject` | string | Subject line (truncated to 100 chars). **Configurable:** `operator.logSubject` controls whether subject is recorded. Default `true` for validation; set to `false` after stabilization to reduce stored PII (see brainstorm §20 P2). When `false`, column value is empty string. |
| `tier` | enum | `RULE`, `CLASSIFIER`, `FALLBACK`. `RULE` means label-action rules only — INBOX rule matches are not logged (see above). `RECLASSIFY` is reserved for deferred taxonomy operations (IF-104/IF-107) and not used in v1. |
| `label` | string | Label applied. `_review` for FALLBACK tier. |
| `confidence` | string | Classifier confidence (high/medium/low). Null for Rule tier. |
| `action` | enum | `ARCHIVED` (labeled + mark-read + archived) or `INBOX` (labeled but left in inbox). FALLBACK tier uses `INBOX` — the `_review` label is applied but the thread stays in inbox for human attention (FR-304). In dry-run mode, `ARCHIVED` means "would have archived" (no Gmail modification occurred; see `dry_run` column). |
| `signals_json` | string (JSON) | Compact JSON of extracted signals for this decision. Only populated for Classifier tier. Example: `{"addressing":"BCC","noreply":true,"platform":"SendGrid"}` |
| `dry_run` | boolean | `true` if logged during dry-run mode (no Gmail modifications made) |
| `feedback` | enum | Empty on write. Human/Strategist fills: `correct`, `wrong:LabelName`, `uncertain` |

### 6.1b Run Summary Schema (Operator → Control Plane)

One row per Operator run (only when `threads_processed > 0` or errors occurred). Separate tab from routing_log.

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | ISO 8601 | When the run started |
| `mode` | enum | `CLEANUP` or `MAINTENANCE` |
| `threads_fetched` | integer | Threads returned by `is:inbox` query |
| `threads_processed` | integer | Threads actually processed (after skip-if-labeled filter) |
| `tier_header_screen` | integer | Count left in inbox by Header Screener |
| `tier_rule_inbox` | integer | Count left in inbox by INBOX rules |
| `tier_rule` | integer | Count routed by label Rules |
| `tier_classifier` | integer | Count routed by Classifier |
| `tier_fallback` | integer | Count that got `_review` fallback label |
| `errors` | integer | Errors encountered |
| `duration_ms` | integer | Total run duration in milliseconds |
| `llm_calls` | integer | Number of Classifier LLM calls made |
| `llm_model` | string | Model string used (e.g., `gemini-2.0-flash`) |
| `taxonomy_hash` | string | Short hash of taxonomy object. Changes when categories modified. |
| `dry_run` | boolean | Whether this was a dry-run execution |

### 6.2 Feedback Ingestion (Control Plane → Operator)

The feedback column in the observation log is the primary feedback mechanism. The Operator does not act on feedback directly — feedback is consumed by the control plane to inform rule changes.

The Operator also accepts **direct commands** via config changes and scriptable functions:

| Command | Mechanism | Effect | Scope |
|---------|-----------|--------|-------|
| Add/modify routing rule | Edit `Config.js` + `clasp push` | New threads routed by updated rules on next run | **v1** |
| Add/modify taxonomy | Edit `Config.js` + `clasp push` | Classifier prompt updated on next run | **v1** |
| Merge labels | Run `mergeLabels('Source', 'Target')` | All Source threads moved to Target, Source deleted | **v1** (launch migration) |
| Reclassify label | Run `reclassify('SourceLabel')` | Operator re-evaluates all threads in SourceLabel against current rules | **Deferred** |
| Split label | Run `splitLabel('Source', 'NewLabel', query)` | Threads matching query moved from Source to NewLabel | **Deferred** |
| Retire label | Run `retireLabel('LabelName')` | Label removed from all threads, then deleted | **Deferred** |
| Undo recent changes | Run `undoSince(timestamp)` | Removes Operator labels, un-archives threads modified after timestamp | **v1** (manual recovery) |

These are **scriptable functions** the Operator exposes. The control plane calls them (or the human runs them manually from the Apps Script editor).

### 6.3 Dynamic Taxonomy Support

| ID | Requirement | Priority |
|----|-------------|----------|
| IF-100 | The Operator shall support adding new labels without code changes to system logic. | P0 |
| IF-101 | The Operator shall expose a `splitLabel` function that creates a new label and moves a subset of threads based on a query. | P1 · **Deferred** (no consumer until Strategist) |
| IF-102 | The Operator shall expose a `mergeLabels` function that moves all threads from source to target and deletes the source. | P1 · **v1 launch** (needed for label migration) |
| IF-103 | The Operator shall expose a `retireLabel` function that strips a label from all threads and deletes it. | P1 · **Deferred** (no consumer until Strategist) |
| IF-104 | The Operator shall expose a `reclassify` function that re-evaluates threads in a given label against the current routing rules. | P1 · **Deferred** (no consumer until Strategist) |
| IF-105 | The LLM classification taxonomy shall be dynamically derived from the current label set in config, not hardcoded in the prompt template. | P1 |
| IF-106 | All taxonomy operations shall be resumable (same batch infrastructure as backfill). | P1 · **Deferred** (applies to IF-101/103/104) |
| IF-107 | Taxonomy operations shall log their actions to the observation store (same schema as routing decisions, with a distinct `tier` value like `RECLASSIFY`). | P1 · **Deferred** (applies to IF-101/103/104) |

> **Note:** IF-101, IF-103, IF-104, IF-106, and IF-107 define the interface contract for future taxonomy operations. These signatures are specified here so the v1 architecture does not preclude them. Implementation is deferred — do not build these functions in v1.

---

## 7. Functional Requirements

### 7.0 Core Pipeline

> **Suggested build order (non-normative).** The FRs below have implicit dependencies that suggest a natural implementation sequence:
>
> 1. **Foundation:** Config.js structure (§5.2b), startup validation (NFR-105), LockService (NFR-104), label auto-creation (FR-203), sheet auto-creation (FR-705).
> 2. **Infrastructure:** Inbox query (FR-010), skip-if-labeled (FR-011), sender resolution (FR-012), batch write infrastructure (FR-707).
> 3. **Tiers:** Header Screener (FR-100–105), Rules (FR-200–205), Classifier (FR-300–307). Each tier is independently testable.
> 4. **Orchestration:** Pipeline wiring (FR-013), mutation ordering (FR-014), graceful exit (FR-015), try/finally (FR-016), mode selection (FR-400–403), observation logging (FR-700–707), dry-run (FR-701–702).
> 5. **Utilities:** `undoSince` (FR-711), `mergeLabels` (FR-501–503). No pipeline dependency.
>
> **Suggested module structure (non-normative):** `Config.js`, `Main.gs` (entry point + orchestration), `HeaderScreener.gs`, `Rules.gs`, `Classifier.gs`, `Observations.gs` (Sheets I/O), `Utils.gs` (sender resolution, label cache, body extraction).

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-010 | The Operator shall query `GmailApp.search('is:inbox')` for candidate threads. | P0 |
| FR-011 | Threads that already have an Operator-managed label (any taxonomy label, `_review`, or `_keep`) shall be skipped. This is the **skip-if-labeled** rule — the routing label itself is the "processed" marker. No separate processed flag needed. | P0 |
| FR-012 | Thread sender shall be resolved as the most recent non-self sender (walk messages newest-to-oldest, skip messages from `ownerEmail`). All-self threads (self-reminder, BCC to self) shall be skipped — left in inbox untouched. | P0 |
| FR-013 | Pipeline order for each thread: Header Screener → Rules → Classifier. First tier that claims the thread terminates processing for that thread. | P0 |
| FR-014 | Gmail mutations for classified threads shall be ordered: (1) apply label, (2) mark read, (3) archive. If label application fails, the thread shall not be archived (NFR-106). | P0 |
| FR-015 | The Operator shall self-terminate with a 60-second buffer before the 6-minute Apps Script limit. Soft limit at 4 minutes — stop processing new threads, write accumulated observations. | P0 |
| FR-016 | The top-level execution shall wrap in `try/finally`. The `finally` block shall always: write observation batch to Sheets, write run summary, update `consecutiveFailures` in ScriptProperties, update `lastSuccessfulRun` on success, release LockService lock. **Run failure definition:** if there are Classifier-eligible threads AND all of them fail with LLM errors, the run counts as a failure (`consecutiveFailures` increments). If at least one classification succeeds, the run is a partial success (`consecutiveFailures` resets to 0). If no threads reach the Classifier (all handled by Header Screener + Rules), the run is a success. | P0 |

### 7.1 Tier 1 — Header Screener

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-100 | The Operator shall check incoming threads for bulk-mail headers before any other processing. Only threads with bulk-mail headers proceed to Rules or Classifier. | P0 |
| FR-101 | Threads with no bulk-mail indicators shall remain in the Inbox untouched and unlabeled. | P0 |
| FR-102 | Header Screener is the first tier in the pipeline (FR-013). No thread reaches Rules or Classifier without passing Header Screener first. | P0 |
| FR-103 | The Header Screener shall check headers only — no message body parsing. Checked headers include: `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, noreply sender pattern, and BCC-only addressing. (Exact boolean logic is an open implementation gap — see brainstorm §23 I1.) | P0 |
| FR-104 | Decisions that leave threads in inbox (Header Screener passes AND Rule INBOX matches) shall be logged to Stackdriver and contribute to `run_summary` tier counts (`tier_header_screen`, `tier_rule_inbox`). They are NOT written to `routing_log`. | P1 |
| FR-105 | If the Header Screener throws an exception on a thread, the thread shall be treated as personal (not bulk) and left in inbox. False negatives (bulk email stays in inbox) are safe; false positives (personal email classified) are dangerous. | P0 |

> **History:** FR-100 through FR-105 were originally Allowlist requirements. The Allowlist tier was eliminated — the Header Screener handles all person-to-person email protection without maintaining any contact list. See brainstorm §1b for rationale.

### 7.2 Tier 2 — Rules (Static Routing)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-200 | The Operator shall support routing rules matching on: sender domain (`senderDomain`, exact match), full sender address (`senderAddress`, exact match), subject line substring (`subjectContains`, case-insensitive substring match), and From display name (`displayName`, exact match). All comparisons case-insensitive. No regex. No body parsing. | P0 |
| FR-201 | Matched rules shall support two actions: (a) **label** — apply label, mark read, archive (default); (b) **INBOX** — leave in inbox with no label. INBOX rules protect urgent automated email (2FA codes, security alerts) that has bulk headers. | P0 |
| FR-202 | First-match-wins evaluation semantics. | P1 |
| FR-203 | Missing labels shall be auto-created at startup (before the processing loop begins): taxonomy labels + `_review` + `_keep`. This ensures skip-if-labeled (FR-011) can check against the complete managed label set. `_keep` must be pre-created (not on-first-use) since the Operator never applies it — users need it available in Gmail as a manual escape hatch. | P1 |
| FR-204 | Routing rules shall be modifiable without changes to system logic. | P1 |
| FR-205 | The routing dictionary shall be the single source of truth for static routing. | P0 |

### 7.3 Tier 2 Routing Dictionary (v1: Seed INBOX Rules Only)

**Label rules start empty in v1.** The Classifier (Tier 3) handles all classification. Label rules are populated by the Strategist based on observation data showing consistent sender-to-label patterns. Candidate rules identified during pre-launch analysis are documented in the [Strategist brainstorm §4.3](../strategist/brainstorm.md).

**INBOX rules are seeded** with universal urgency patterns (2FA codes, security alerts) that protect time-sensitive automated email. These work for any user and require no customization.

### 7.4 Tier 3 — Classifier (LLM)

> **Prerequisite:** Only threads that pass the Header Screener (Tier 1 confirms bulk headers) AND are not matched by a Rule (Tier 2) reach the Classifier.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-300 | The Classifier prompt shall use the annotated email display format defined below. | P0 |

**Classifier Prompt Format:**

```
From: Store Name <marketing@store.com> [via SendGrid]
Addressing: direct
Subject: Your order has shipped
---
Your order #12345 has shipped via UPS tracking number 1Z999...
```

Annotations derived in code before the LLM call:

| Annotation | Derived from | Example |
|---|---|---|
| `[via Platform]` | Return-Path domain, Received chain, Message-ID | `[via Mailchimp]`, `[via SendGrid]`, `[via Amazon SES]` |
| `direct` / `CC` / `BCC/undisclosed` | To/CC header analysis | Addressing context. Owner's email NOT included. |
| `[noreply]` | From address pattern match | `noreply@`, `no-reply@`, `donotreply@` |

**Platform detection:** The `[via Platform]` annotation is derived by matching the Return-Path domain against a lookup table of known email service providers (e.g., `bounces.sendgrid.net` → `SendGrid`, `mcsv.net` → `Mailchimp`, `amazonses.com` → `Amazon SES`). If the Return-Path domain doesn't match any known platform, the annotation is omitted. The lookup table is a static map in code — not configurable, not exhaustive. Missing a platform just means no annotation, which is harmless (the LLM still classifies from sender + subject + body).

Prompt assembly:

```javascript
function buildClassifierPrompt(taxonomy, signals, email) {
  const categories = Object.entries(taxonomy)
    .map(([name, description]) => `- ${name}: ${description}`)
    .join('\n');
  const annotations = buildAnnotations(signals);
  return [
    `Classify this email into exactly one category.`,
    `This email has already been confirmed as automated/bulk mail.`,
    ``,
    `CATEGORIES:`,
    categories,
    ``,
    `RULES:`,
    `- Receipt or purchase confirmation → Shopping (not Financial)`,
    `- When in doubt between topical label and Newsletters → prefer topical`,
    `- Bank promotional email → Financial (not Marketing)`,
    // ↑ Disambiguation rules are taxonomy-specific. These examples assume the
    //   default 10-category taxonomy. Forks with different categories should
    //   update these hints to reflect their own overlapping label boundaries.
    ``,
    `EMAIL:`,
    `From: ${email.senderName} <${email.senderAddress}> ${annotations.platform}`,
    `Addressing: ${annotations.addressing}`,
    `Subject: ${email.subject}`,
    `---`,
    email.snippet,
    ``,
    `Respond with: CATEGORY|CONFIDENCE (high/medium/low)`,
  ].join('\n');
}
```

Body snippet: HTML-stripped, URLs redacted, truncated to `maxBodyChars` (default 100). Owner's email address never included — only the addressing annotation. For design rationale, see brainstorm §4.7.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-301 | The Classifier shall return exactly one label from the **current active taxonomy** (dynamically constructed from config, not hardcoded). | P0 |
| FR-302 | The Classifier shall output confidence alongside the label in the format `CATEGORY\|CONFIDENCE` where confidence is `high`, `medium`, or `low`. This format is requested by the prompt instruction in FR-300 (`Respond with: CATEGORY|CONFIDENCE`). Parsing: case-insensitive, strip whitespace around pipe. If the response contains a valid label but no pipe or no confidence value, default confidence to `low`. Logged to observation store. | P1 |
| FR-303 | ~~"Human Attention" classification shall label but leave in Inbox.~~ **RETIRED.** No "Human Attention" label. The inbox IS the human-attention bucket. All classified threads are labeled and archived. | — |
| FR-304 | Invalid Classifier responses shall apply the `_review` fallback label. Thread stays in inbox (not archived). `_review` is Operator-managed for skip-if-labeled logic. | P0 |
| FR-305 | Response parsing shall support exact match and fuzzy single-label extraction (case-insensitive, strip whitespace, handle preamble text). | P1 |
| FR-306 | The LLM model shall be configurable without code changes (`Config.js` operator settings). | P1 |
| FR-307 | LLM API errors (429/500/timeout) shall skip the thread for retry on next run. Malformed LLM responses (valid API response, invalid label) shall apply `_review`. These are distinct failure modes with distinct handling. | P0 |

### 7.5 Operational Modes

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-400 | **Single 5-minute trigger.** Mode is determined dynamically by backlog size, not by trigger configuration. | P0 |
| FR-401 | **Cleanup Mode:** 100-thread batches when unprocessed count exceeds backlog threshold. | P0 |
| FR-402 | **Maintenance Mode:** 50-thread batches when backlog is manageable (default). | P0 |
| FR-403 | The Operator shall **auto-detect backlog** at the start of each run and select the appropriate batch size. | P0 |

### 7.6 Backfill and Migration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-500 | Inbox backfill uses the same `is:inbox` pipeline as steady-state, with Cleanup Mode batch sizes. No separate backfill code path needed. | P0 |
| FR-501 | `mergeLabels` shall be resumable across executions via `ScriptProperties` progress state (same batch infrastructure as backfill). | P1 |
| FR-502 | Owner performs deprecated label migration using `mergeLabels` before or shortly after launch (§5.8). | P1 |
| FR-503 | Deprecated label deletion after zero-thread confirmation. | P1 |
| FR-504 | ~~Optional LLM backfill pass for unmatched automated threads.~~ **RETIRED.** Contradicts decided backfill scope (inbox only, skip archived unlabeled). | — |
| FR-505 | ~~Backfill trigger self-terminates when complete.~~ No separate trigger. Single 5-minute trigger auto-transitions from Cleanup to Maintenance batch size when backlog clears. | — |

### 7.7 Filter Audit and Cleanup (Post-Launch)

> **Deferred from v1 launch.** Old Gmail filters are harmless — the Operator uses `is:inbox`, not filter-based routing. Some email may be double-processed (filter archives AND Operator would have archived), but this causes no errors. Run the audit manually whenever convenient.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-600 | List all native filters, categorized: broken, redundant, other. | P1 · **Post-launch** |
| FR-601 | Cross-reference filter criteria against script routing rules. | P1 · **Post-launch** |
| FR-602 | Targeted delete for redundant filters only. | P1 · **Post-launch** |
| FR-603 | Bulk delete with confirmation gate. | P2 · **Post-launch** |

### 7.8 Observability

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-700 | Per-run summary stats written to `run_summary` tab per schema in §6.1b. | P1 |
| FR-701 | Dry-run mode: calls LLM, writes observation log (with `dry_run=true`), but does not modify Gmail state (no label, no archive, no mark-read). | P0 |
| FR-702 | In dry-run mode, only process threads with `lastMessageDate > lastSuccessfulRun` to prevent duplicate observation rows from re-evaluating the same threads every 5 minutes. If `lastSuccessfulRun` is absent (first run ever), process all inbox threads (no dedup filter). | P1 |
| FR-703 | Routing decision log to Sheets per observation log schema in §6.1. | P0 |
| FR-704 | The Operator shall send an **alert email** to the account owner if it has failed on 3+ consecutive runs. | P1 · **v1.1** (adds `gmail.send` scope) |
| FR-705 | The Operator shall auto-create observation store tabs (`routing_log`, `run_summary`) and header rows on first run if they don't exist. | P0 |
| FR-706 | Run summary rows shall only be written if `threads_processed > 0` or errors occurred. No-op trigger firings (nothing new in inbox) shall not generate rows. | P1 |
| FR-707 | All observation rows shall be accumulated in-memory during the run and batch-written via a single `setValues()` call in the `finally` block. Run summary as a single `appendRow()`. Two Sheets API calls total per run. **Stackdriver fallback if Sheets write fails:** log `thread_id`, `tier`, `label`, and error message only. Do NOT log sender addresses or subject lines to Cloud Logging (privacy — thread_id is sufficient to reconstruct from Gmail). | P1 |
| FR-710 | The Operator shall recognize `_keep` as an Operator-managed label (alongside taxonomy labels and `_review`). `_keep` is never auto-applied — it is a human-only escape hatch meaning "don't touch this thread." Skip-if-labeled includes `_keep`. | P1 |
| FR-711 | The Operator shall expose an `undoSince(timestamp)` helper function that removes Operator-managed labels and un-archives threads modified after the given timestamp. Not part of the automated pipeline — run manually from the Apps Script editor for recovery. | P1 |

---

## 8. Non-Functional Requirements

### 8.1 Reliability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-100 | All errors logged to Stackdriver. No silent failures. | P0 |
| NFR-101 | No single-thread failure shall crash the processing loop. Per-thread errors are caught, logged, and the thread is skipped. The batch continues. See FR-307 for Classifier-specific error handling (API error vs. malformed response). | P0 |
| NFR-102 | Self-terminate before 6-minute limit (FR-015). Soft limit at 4 minutes. | P0 |
| NFR-103 | The Operator shall recover automatically from any downtime period without manual intervention. | P0 |
| NFR-104 | The Operator shall use `LockService` to prevent concurrent executions. If a lock cannot be acquired, the run exits immediately. | P1 |
| NFR-105 | The Operator shall validate configuration at run start: taxonomy non-empty, ownerEmail non-empty, API key exists, observation sheet accessible, **label names match `[A-Za-z0-9 _-]+`**, **every rule `label` exists in taxonomy**, **warn if ownerEmail ≠ `Session.getActiveUser().getEmail()`**. Validation failure = run failure (ownerEmail mismatch = warning only). | P0 |
| NFR-106 | Gmail mutation ordering per FR-014. An unlabeled archived thread is invisible and unrecoverable — never archive without labeling first. | P0 |

### 8.2 Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-200 | Body content sent to LLM: HTML-stripped, URL-redacted, truncated to 100 chars default (configurable). **Owner's email address NOT included** — only addressing annotation (`direct`/`CC`/`BCC`). Prompt uses annotated email display format with pre-computed derived signals. | P0 |
| NFR-201 | API key in `PropertiesService`, never in source. | P0 |
| NFR-202 | Email metadata (sender, subject, truncated body) is sent to Gemini API (`googleapis.com`) under paid-tier terms (Google does not use paid API inputs for training). No email content is sent to non-Google services. If the LLM provider is changed to a non-Google service, this NFR must be re-evaluated. | P0 |
| NFR-203 | Minimal OAuth scope: `gmail.modify`, `gmail.labels`, `script.external_request`, `script.scriptapp`, `spreadsheets`. `gmail.send` deferred to v1.1 (alert email). | P1 |

### 8.3 Performance

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-300 | Maintenance Mode: 50 threads/run within 6-minute limit. | P1 |
| NFR-301 | Cleanup Mode: 100 threads/run within 6-minute limit. | P1 |
| NFR-302 | Label lookups cached in-memory per execution. | P1 |
| NFR-303 | Observation store shall implement a retention strategy to stay within Google Sheets cell limits. At ~90 rows/day (corrected estimate), this is not a concern for years. Revisit if volume changes dramatically. | P2 |

### 8.4 Operability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-400 | Deployable via `clasp`. | P1 |
| NFR-401 | Debug flag for verbose logging. | P2 |
| NFR-402 | All user-specific configuration isolated in a single file. | P1 |
| NFR-403 | The system shall require no ongoing manual configuration. Label rules start empty and are populated exclusively by the Strategist. INBOX rules are seeded with universal urgency patterns. The only manual effort is initial taxonomy review and occasional corrections. | P0 |

---

## 9. Acceptance Criteria

### 9.1 Routing Engine

1. **Header Screener — zero false positives.** Dry run on 50+ threads. Verification: scan observation log for any row where the sender is a known personal contact. Zero matches = pass. All personal email remains in Inbox with no Operator label.
2. **Taxonomy coverage.** Every taxonomy category matches at least one thread correctly during dry-run. Verification: observation log contains at least one `tier=CLASSIFIER` row per category.
3. **Classifier fallback.** Unknown automated sender (no Rule match) classified correctly without manual intervention. Verification: observation log shows `tier=CLASSIFIER` with correct label for a sender not in the rules dictionary.
4. **INBOX rules.** 2FA codes and security alerts stay in inbox despite having bulk headers. Verification: send a test 2FA email, confirm thread remains in inbox with no Operator label after a run. Run_summary `tier_rule_inbox` count increments. (INBOX rule matches are not logged to the routing_log — verify via run_summary tier counts or Stackdriver.)
5. **Concurrent use safety.** User reads inbox during a run. Verification: no crashes, no duplicate labels, no unhandled errors in Stackdriver. LockService prevents overlapping executions — manual run during triggered run exits immediately.

### 9.2 Startup and Configuration

6. **Startup validation — failure modes.** Empty taxonomy → run fails. Rule label not in taxonomy → run fails. Missing API key → run fails. Inaccessible observation sheet → run fails. ownerEmail mismatch → warning logged, run continues. Verification: trigger each condition, confirm behavior matches.
7. **Label auto-creation.** All taxonomy labels + `_review` + `_keep` exist in Gmail after first run. Verification: check Gmail labels list.

### 9.3 Backfill and Migration

8. Inbox backfill completes: existing inbox backlog processes down to Maintenance batch size threshold using Cleanup Mode. Verification: run_summary shows `mode=CLEANUP` initially, transitions to `mode=MAINTENANCE` when backlog clears.
9. `mergeLabels` executes correctly for deprecated label migration and logs to observation store. Verification: source label has zero threads, target label has all threads, observation log records the operation.
10. Deprecated labels deleted after confirming zero remaining threads.

### 9.4 Resilience

11. **Downtime recovery.** Accumulate 300+ unprocessed threads (exceeds `backlogThreshold`). Start Operator. Verification: first run uses Cleanup batch size (run_summary `mode=CLEANUP`), subsequent runs transition to Maintenance when backlog drops below threshold.
12. **Soak test (production readiness).** 5-minute trigger runs 72 hours with zero unhandled errors in Stackdriver. Note: this is a production readiness gate, not a pre-launch test — run after initial deployment.
13. **LLM failure degradation.** Mock Gemini 429/500/timeout: threads are skipped (no label, no archive), retried on next run. Mock malformed LLM response: `_review` applied, thread stays in inbox. Verification: observation log shows `tier=FALLBACK` for malformed responses only. No observation row for API errors (thread was skipped entirely).
14. **Graceful exit.** Process a batch large enough to approach 4 minutes. Verification: run stops accepting new threads after soft limit, but still writes observation batch and run_summary in the finally block. Stackdriver shows "soft limit reached" log entry. No 6-minute timeout errors.

### 9.5 Observation and Interface

15. Routing decisions logged to Sheets per §6.1 schema. `run_summary` tab populated per §6.1b schema. Verification: schema columns match, data types correct, no missing fields.
16. Dry-run mode writes observation rows with `dry_run=true` and does not modify Gmail state (no label, no archive, no mark-read). Verification: Gmail thread state unchanged after dry-run.
17. `_keep` label recognized as Operator-managed — threads with `_keep` are skipped by skip-if-labeled logic. Verification: manually apply `_keep` to a thread, confirm Operator skips it.
18. `undoSince` recovery. Apply labels to 10+ threads via live run. Run `undoSince(timestamp)`. Verification: Operator labels removed, threads un-archived, threads reappear in inbox.
19. *(v1.1)* Alert email fires after 3+ consecutive Operator failures.

---

## 10. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | What is the threshold for backlog auto-detection (FR-403)? | DECIDED: `backlogThreshold` in Config.js (default 200). See brainstorm §7. |
| 2 | ~~Allowlist lookback window~~ | RETIRED — Allowlist eliminated |
| 3 | ~~Observation store retention~~ | DECIDED: Not needed. ~90 rows/day → years before Sheets limits matter. |
| 4 | ~~Observation store tabs~~ | DECIDED: Two tabs (routing_log + run_summary). |
| 5 | Which exact headers constitute a bulk-mail signal for the Header Screener? | **OPEN — blocking.** Proposed: `List-Unsubscribe` OR `Precedence: bulk` OR noreply sender OR BCC-only. Needs validation. See brainstorm §23 I1. |
| 6 | ~~Fallback label name~~ | DECIDED: `_review` |
| 7 | ~~Config.js git handling~~ | DECIDED: Config.js committed to user's fork. Secrets in ScriptProperties. |
| 8 | Do Google Calendar invites appear in `GmailApp.search('is:inbox')`? | **OPEN.** If yes, need INBOX rule for `notifications-noreply@google.com`. Verify during implementation. |
| 9 | Gemini API call pattern from Apps Script. | **OPEN — blocking.** `UrlFetchApp.fetch()` to `generativelanguage.googleapis.com`. Auth, request format, error handling TBD. See brainstorm §23 I2. |
| 10 | Body text extraction when `getPlainBody()` returns null. | **OPEN — blocking.** HTML fallback strip-to-text, URL redaction, truncation. See brainstorm §23 I3. |

---

## 11. Future Scope

See [ROADMAP.md](../../../ROADMAP.md) for the full prioritized backlog. The Operator architecture must not preclude the planned initiatives (Strategist automation, draft composition, sensitive info detection, deletion, unsubscribe automation).

---

## 12. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-23 | 1.0 | K. Huttelmaier | Initial requirements from architecture handoff. |
| 2026-02-23 | 1.1 | K. Huttelmaier | Incorporated 17-point review. |
| 2026-02-23 | 2.0 | K. Huttelmaier | Philosophical rewrite. Self-tuning with human oversight as core principle. |
| 2026-02-23 | 2.1 | K. Huttelmaier | Operator/Strategist separation. Added conservatism constraints, Strategist FRs, observation retention, error alerting, thread granularity, v1 scope boundary. |
| 2026-02-23 | 3.0 | K. Huttelmaier | **Scoped to Operator (data plane) only.** Extracted Strategist to [strategist brainstorm](../strategist/brainstorm.md). Replaced FLEX requirements with Interface Contract (§6) — observation log schema, feedback format, taxonomy operations. v1 Strategist is manual (human + Gemini prompt). All Strategist-specific requirements, acceptance criteria, and open questions moved to the Strategist doc. |
| 2026-02-24 | 4.0 | Brainstorm sync | **Three-tier pipeline + v1 scope boundary.** Removed Allowlist (Tier 1) — Header Screener handles person-to-person protection. Updated §5.4 (model), §5.5 (single trigger), §5.6 (query), §5.8 (labels), §5.9 (manual overrides), §5.10 (sender resolution), §6.1 (observation schema + signals_json), §6.2 (commands), §6.3 (taxonomy ops scoped), §7.1 (Header Screener FRs), §7.3 (rules start empty, candidates to Strategist doc), §7.4 (Classifier FRs), §7.5 (single trigger + dynamic mode), §7.7 (filter audit deferred). Added NFR-104 (LockService), NFR-403 (zero maintenance). Retired FR-305 (Human Attention), FR-504 (archived backfill), FR-505 (separate trigger). FR-704 deferred to v1.1. `gmail.send` scope deferred. |
| 2026-02-24 | 5.0 | Implementation prep | **Full alignment with brainstorm decisions.** Genericized §2.1 (removed personal inbox details). Added §3.3 (v1 scope boundary table). Added §7.0 (core pipeline FRs: skip-if-labeled, sender resolution, mutation ordering, try/finally, graceful exit). Fixed §7.1 (added FR-105 fail-safe, FR-103 header list, fixed note). Restructured §7.4 (removed duplicate Header Screener FRs, added FR-302 confidence output, FR-307 error distinction). Added FR-702 (dry-run dedup), FR-706 (no-op filtering), FR-707 (batch writes). Cleaned §6.2 (v1 vs deferred scope column, added undoSince). Fixed §5.3 (filter deletion deferred not done), §5.7 (same), §5.8 (genericized label names). Rewrote §9 acceptance criteria to match v1 scope. Updated §10 open questions (added 3 blocking implementation gaps from brainstorm §23). |
| 2026-02-24 | 5.1 | Six-lens analysis | **Self-contained implementation spec.** Added design principle #9 (Zero Operational Burden). Inlined all "what to build" specs from brainstorm: Classifier prompt format + pseudocode (FR-300), run_summary schema (§6.1b), Config.js data structure + field table (§5.2b), platform detection (FR-300 annotation note). Clarified FR-200 match semantics (senderDomain/senderAddress exact, subjectContains substring, displayName exact). Added suggested build order and module structure (§7.0). Fixed FR-016 run failure definition, FR-302 confidence parsing defaults, FR-702 first-run handling, FR-707 Stackdriver fallback content. Expanded ACs from 15→19 with verification methods. Fixed AC #4 contradiction with §6.1 (INBOX rules not logged to routing_log). Clarified observation log `tier` and `action` enums. Marked `RECLASSIFY` tier as reserved. Moved `logSubject` toggle from deferred to v1. Added deferred implementation note to IF-101/103/104/106/107. |

# inbox-shepherd — Operator Design

> **Version:** 4.0 · **Date:** 2026-02-24 · **Status:** Draft  
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

---

## 2. Problem Statement

### 2.1 Current State

- **Settings Misconfiguration:** Gmail's "Override filters" for important messages strips the "Skip Inbox" directive, causing tagged automated mail to pile up in the primary view.
- **Filter Bloat:** Native filters are 1-to-1 sender mappings. Some lack "Skip Inbox" entirely.
- **Label Bloat:** Deprecated labels from past life events. Active labels that no longer reflect current habits.
- **No Triage for Unknown Senders:** New automated senders land directly in the Inbox.
- **Historical Backlog:** ~70,000 emails, many misrouted or uncategorized.
- **Taxonomy Drift:** The label and filter system is a snapshot of life from when it was last maintained. It hasn't kept up.

### 2.2 Why Previous Approaches Failed

Native Gmail filters fail because they are **static rules in a dynamic environment.** Adding a filter is easy. Noticing that a filter is stale, redundant, or miscategorized requires human attention that never comes. The Operator is one half of the solution — a fast, cheap, reliable routing engine. The other half — the intelligence that keeps the rules current — is the Strategist's job.

---

## 3. Goals and Non-Goals

### 3.1 Goals

1. Establish a zero-trust Inbox where only verified human email appears.
2. Route known automated traffic deterministically via static rules with zero LLM dependency.
3. Classify unknown automated traffic via LLM with a constrained label taxonomy.
4. Bypass Gmail's "Override filters" setting via programmatic archival.
5. **Log every routing decision** with enough context for external analysis.
6. **Accept feedback** — expose a mechanism for the control plane (or human) to mark routing decisions as correct or incorrect.
7. **Support taxonomy operations** — add, split, merge, retire labels when instructed by the control plane.
8. **Reclassify historical threads** when instructed by the control plane.
9. Process the ~70k email backlog through the pipeline.
10. Support two operational modes: Cleanup Mode and Maintenance Mode.
11. Catch up automatically after any period of downtime.
12. Be forkable with isolated configuration for new users.

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

### 5.3 Where Does Routing Happen?

All routing happens in the Apps Script code. Native Gmail filters are deleted after validation. No new native filters are created. Gmail's "Override filters" setting becomes irrelevant.

### 5.4 LLM Model

**Gemini 2.0 Flash** for Tier 3 classification. ~300-400 input tokens, single-label output, temperature 0. The task is simple classification — Flash provides near-identical accuracy to Pro at a fraction of the cost and latency. The model is configurable without code changes (FR-308).

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

**v1 is non-destructive.** No email content is deleted. The only destructive operations are:

- Deprecated **label deletion** (after audit + thread migration).
- Redundant **native filter deletion** (after audit + script validation).

Both are audit-first with explicit confirmation gates.

### 5.8 Label Strategy (Initial)

| Action | Detail |
|--------|--------|
| **Strip and delete deprecated labels** | *(Owner audits their own deprecated labels before launch. Examples: old course labels, relocation labels, legacy job search labels, outdated activity labels.)* |
| **Retain labels matching new taxonomy** | Kids, Financial, Shopping |
| **Create new labels on first use** | Scouting, Marketing, Newsletters, Career, Government, Travel, Security |
| **Remap before delete** | JobSearch → Career, OldScouts/ToDo → Scouting, OldScouts → Scouting |

Retained labels keep their existing threads. The control plane may instruct the Operator to reclassify, split, merge, or retire labels at any time.

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
| `tier` | enum | `RULE`, `CLASSIFIER`, `FALLBACK`, `RECLASSIFY`. (Header Screener decisions are not logged to routing_log — see above.) |
| `label` | string | Label applied. `_review` for FALLBACK tier. |
| `confidence` | string | Classifier confidence (high/medium/low). Null for Rule tier. |
| `action` | enum | `INBOX` (left in inbox), `ARCHIVED` (labeled + archived). Records the **intended** action — in dry-run mode, `ARCHIVED` means "would have archived" (no Gmail modification actually occurred; see `dry_run` column). |
| `signals_json` | string (JSON) | Compact JSON of extracted signals for this decision. Only populated for Classifier tier. Example: `{"addressing":"BCC","noreply":true,"platform":"SendGrid"}` |
| `dry_run` | boolean | `true` if logged during dry-run mode (no Gmail modifications made) |
| `feedback` | enum | Empty on write. Human/Strategist fills: `correct`, `wrong:LabelName`, `uncertain` |

### 6.2 Feedback Ingestion (Control Plane → Operator)

The feedback column in the observation log is the primary feedback mechanism. The Operator does not act on feedback directly — feedback is consumed by the control plane to inform rule changes.

The Operator also accepts **direct commands** via config changes:

| Command | Mechanism | Effect |
|---------|-----------|--------|
| Add/modify routing rule | Edit `Config.js` + `clasp push` | New threads routed by updated rules on next run |
| Add/modify taxonomy | Edit `Config.js` + `clasp push` | Classifier prompt updated on next run |
| Reclassify label | Run `reclassify('SourceLabel')` | Operator re-evaluates all threads in SourceLabel against current rules |
| Split label | Run `splitLabel('Source', 'NewLabel', query)` | Threads matching query moved from Source to NewLabel |
| Merge labels | Run `mergeLabels('Source', 'Target')` | All Source threads moved to Target, Source deleted |
| Retire label | Run `retireLabel('LabelName')` | Label removed from all threads, then deleted |

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

---

## 7. Functional Requirements

### 7.1 Tier 1 — Header Screener

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-100 | The Operator shall check incoming threads for bulk-mail headers before any other processing. | P0 |
| FR-101 | Threads with no bulk-mail indicators shall remain in the Inbox untouched and unlabeled. | P0 |
| FR-102 | Header Screener evaluation shall occur before Rules and Classifier tiers. | P0 |
| FR-103 | The Header Screener shall check headers only — no message body parsing. | P1 |
| FR-104 | Decisions that leave threads in inbox (Header Screener passes AND Rule INBOX matches) shall be logged to Stackdriver and contribute to `run_summary` tier counts (`tier_header_screen`, `tier_rule_inbox`). They are NOT written to `routing_log`. | P1 |

> **Note:** FR-100 through FR-105 were previously Allowlist requirements. The Allowlist tier was eliminated — the Header Screener handles all person-to-person email protection without maintaining any contact list. See brainstorm §1b for rationale.

### 7.2 Tier 2 — Rules (Static Routing)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-200 | The Operator shall support routing rules matching on: sender domain, full sender address (case-insensitive), subject line keywords, and From display name. All exact match, case-insensitive. No regex. No body parsing. | P0 |
| FR-201 | Matched rules shall support two actions: (a) **label** — apply label, mark read, archive (default); (b) **INBOX** — leave in inbox with no label. INBOX rules protect urgent automated email (2FA codes, security alerts) that has bulk headers. | P0 |
| FR-202 | First-match-wins evaluation semantics. | P1 |
| FR-203 | Missing labels shall be auto-created at startup: taxonomy labels + `_review` + `_keep`. `_keep` must be pre-created (not on-first-use) since the Operator never applies it — users need it available in Gmail as a manual escape hatch. | P1 |
| FR-204 | Routing rules shall be modifiable without changes to system logic. | P1 |
| FR-205 | The routing dictionary shall be the single source of truth for static routing. | P0 |

### 7.3 Tier 2 Routing Dictionary (v1: Seed INBOX Rules Only)

**Label rules start empty in v1.** The Classifier (Tier 3) handles all classification. Label rules are populated by the Strategist based on observation data showing consistent sender-to-label patterns. Candidate rules identified during pre-launch analysis are documented in the [Strategist brainstorm §4.3](../strategist/brainstorm.md).

**INBOX rules are seeded** with universal urgency patterns (2FA codes, security alerts) that protect time-sensitive automated email. These work for any user and require no customization.

### 7.4 Tier 3 — Classifier (LLM)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-300 | The Header Screener (Tier 1) shall gate all further processing. Only threads with bulk-mail headers reach Rules or Classifier. | P0 |
| FR-301 | The Header Screener shall check: `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, and similar bulk-mail indicators (exact checklist TBD in brainstorm #17). | P1 |
| FR-302 | Threads without bulk-mail headers shall remain in the Inbox untouched. | P0 |
| FR-303 | The Classifier prompt shall use the annotated email display format: sender with platform annotation, addressing annotation, subject, and sanitized body snippet (HTML stripped, URLs redacted). | P0 |
| FR-304 | The Classifier shall return exactly one label from the **current active taxonomy** (dynamically constructed from config, not hardcoded). | P0 |
| FR-305 | ~~"Human Attention" classification shall label but leave in Inbox.~~ **RETIRED.** No "Human Attention" label. The inbox IS the human-attention bucket. All classified threads are labeled and archived. | — |
| FR-306 | Invalid Classifier responses shall apply the `_review` fallback label. Thread stays in inbox (not archived). `_review` is Operator-managed for skip-if-labeled logic. | P0 |
| FR-307 | Response parsing shall support exact match and fuzzy single-label extraction. | P1 |
| FR-308 | The LLM model shall be configurable without code changes. | P1 |

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
| FR-501 | Label migration operations (reclassify, merge, split, retire) shall be resumable across executions via `ScriptProperties` progress state. | P0 |
| FR-502 | Label migration per consolidation map (§5.8). | P1 |
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
| FR-700 | Per-run summary stats written to `run_summary` tab: timestamp, mode, threads fetched/processed, tier counts (header_screen, rule_inbox, rule, classifier, fallback), errors, duration_ms, llm_calls, llm_model, taxonomy_hash, dry_run. Full schema in brainstorm §6. | P1 |
| FR-701 | Dry-run mode: calls LLM, writes observation log (with `dry_run=true`), but does not modify Gmail state (no label, no archive, no mark-read). | P0 |
| FR-702 | Label audit: thread counts per label. | P1 |
| FR-703 | Routing decision log to Sheets per observation log schema (§6.1). | P0 |
| FR-704 | The Operator shall send an **alert email** to the account owner if it has failed on 3+ consecutive runs. | P1 · **v1.1** (adds `gmail.send` scope) |
| FR-705 | The Operator shall auto-create observation store tabs (`routing_log`, `run_summary`) and header rows on first run if they don't exist. | P0 |
| FR-710 | The Operator shall recognize `_keep` as an Operator-managed label (alongside taxonomy labels and `_review`). `_keep` is never auto-applied — it is a human-only escape hatch meaning "don't touch this thread." Skip-if-labeled includes `_keep`. | P1 |
| FR-711 | The Operator shall expose an `undoSince(timestamp)` helper function that removes Operator-managed labels and un-archives threads modified after the given timestamp. Not part of the automated pipeline — run manually from the Apps Script editor for recovery. | P1 |

---

## 8. Non-Functional Requirements

### 8.1 Reliability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-100 | All errors logged to Stackdriver. No silent failures. | P0 |
| NFR-101 | LLM API errors (429/500/timeout) shall skip the thread for retry on next run. LLM malformed responses shall apply `_review` fallback label. Neither shall crash the processing loop. | P0 |
| NFR-102 | Self-terminate before 6-minute limit with 60-second buffer. Soft limit at 4 minutes — stop processing, write accumulated observations. | P0 |
| NFR-103 | The Operator shall recover automatically from any downtime period without manual intervention. | P0 |
| NFR-104 | The Operator shall use `LockService` to prevent concurrent executions. If a lock cannot be acquired, the run exits immediately. | P1 |
| NFR-105 | The Operator shall validate configuration at run start: taxonomy non-empty, ownerEmail non-empty, API key exists, observation sheet accessible, **label names match `[A-Za-z0-9 _-]+`**, **every rule `label` exists in taxonomy**, **warn if ownerEmail ≠ `Session.getActiveUser().getEmail()`**. Validation failure = run failure (ownerEmail mismatch = warning only). | P0 |
| NFR-106 | Gmail mutations shall be ordered: label first, archive second. If label application fails, the thread shall not be archived. | P0 |

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

1. Dry run on 50+ threads shows zero false positives (Header Screener correctly leaves all human email in Inbox; no personal email classified and archived).
2. All 10 taxonomy categories match at least one thread correctly.
3. LLM fallback verified: unknown automated sender classified without manual intervention.
4. System correctly handles concurrent use (user reading inbox during a run).

### 9.2 Backfill and Migration

5. Backfill completes: inbox backlog processes down to Maintenance batch size threshold. Label migrations complete with zero remaining threads under deprecated labels.
6. Deprecated labels deleted, retained labels contain correct threads.
7. Filter audit shows zero broken filters, redundant filters removed.

### 9.3 Resilience

8. Simulate 1-week downtime: system catches up automatically, uses Cleanup batch size until backlog clears, then transitions to Maintenance batch size.
9. 5-minute trigger runs 72 hours with zero unhandled errors in Stackdriver.

### 9.4 Observation and Interface

10. Routing decisions are logged to Sheets per the observation log schema (§6.1).
11. `mergeLabels` executes correctly for label migration (OldScouts → Scouting, JobSearch → Career) and logs to observation store. Other taxonomy operations (`splitLabel`, `retireLabel`, `reclassify`) deferred — acceptance criteria apply when implemented.
12. *(v1.1)* Alert email fires after 3+ consecutive Operator failures.

---

## 10. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | What is the threshold for backlog auto-detection (FR-402)? Brainstorm Config.js leans toward 200. | Leaning |
| 2 | ~~Allowlist lookback window~~ | RETIRED — Allowlist eliminated |
| 3 | Should the observation store retention use a rolling window, aggregation, or archival? | DECIDED: Not needed. Corrected estimate ~90 rows/day means years before Sheets limits matter. |
| 4 | Should the observation Sheets workbook use a single sheet or multiple tabs (routing log, run summaries)? | DECIDED: Two tabs (routing_log + run_summary). |
| 5 | Which exact headers constitute a bulk-mail signal for the Header Screener? | TBD |
| 6 | What is the fallback label name when the Classifier returns an invalid response? | DECIDED: `_review` |
| 7 | Config.js git handling — `.gitignore` + `Config.example.js`? ownerEmail is personal data. | DECIDED: Config.js committed to user's fork. Secrets stay in ScriptProperties. |
| 8 | Do Google Calendar invites appear in `GmailApp.search('is:inbox')`? If yes, they arrive from `notifications-noreply@google.com` with bulk headers and would be classified. Need an INBOX rule or Calendar-specific handling. | TBD (verify during implementation) |

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

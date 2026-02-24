# Phase 2 — Infrastructure

> **Status:** Not started
> **Depends on:** Phase 1 (Config.js, label cache, observation store shell)
> **Produces:** `Utils.gs`, batch accumulator in `ObservationStore.gs`
> **Source spec:** [requirements.md](requirements.md) FR-010, FR-011, FR-012, FR-707, Open Q #10

---

## Goal

Build the shared infrastructure that all three tiers depend on: inbox querying, thread filtering, sender resolution, body text extraction, and the observation batch-write mechanism. After Phase 2, the pipeline has everything it needs to feed threads into tiers — the tiers themselves come next.

## Requirements Covered

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-010 | Inbox query | `GmailApp.search('is:inbox')` for candidate threads |
| FR-011 | Skip-if-labeled | Threads with any Operator-managed label (taxonomy, `_review`, `_keep`) are skipped. The label IS the processed marker. |
| FR-012 | Sender resolution | Most recent non-self sender (walk messages newest-to-oldest, skip `ownerEmail`). All-self threads skipped. |
| FR-707 | Batch write infrastructure | In-memory row accumulation during run, single `setValues()` in finally block. Stackdriver fallback on Sheets write failure (thread_id, tier, label, error only — no sender/subject). |
| Open Q #10 | Body text extraction | `getPlainBody()` with HTML fallback, strip-to-text, URL redaction, truncation to `maxBodyChars`. |

## Modules

- **`Utils.gs`** — Core utility functions:
  - `getInboxThreads(batchSize)` — Wraps `GmailApp.search('is:inbox', 0, batchSize)`
  - `isAlreadyLabeled(thread, managedLabels)` — Checks if thread has any Operator-managed label
  - `resolveSender(thread, ownerEmail)` — Walks messages newest-to-oldest, returns first non-self sender. Returns `null` for all-self threads.
  - `extractBodySnippet(message, maxChars)` — `getPlainBody()` → HTML fallback → strip tags → redact URLs → truncate
- **`ObservationStore.gs`** (extended from Phase 1) — Adds:
  - `accumulateRow(rowData)` — Pushes to in-memory array
  - `flushRoutingLog()` — Single `setValues()` call for all accumulated rows
  - `writeRunSummary(summaryData)` — Single `appendRow()` call
  - Stackdriver fallback if Sheets write fails

## Blocking Implementation Gap

**Body text extraction (Open Q #10):** `message.getPlainBody()` may return `null` for HTML-only email. Needs:
1. HTML fallback via `message.getBody()`
2. Strip HTML tags to plain text
3. Redact URLs (replace with `[URL]`)
4. Truncate to `maxBodyChars` (default 100)

This is an implementation spike — the exact stripping/redaction approach needs to be validated against real email.

## Acceptance Criteria

- [ ] `getInboxThreads()` returns threads from inbox
- [ ] `isAlreadyLabeled()` correctly identifies threads with Operator-managed labels
- [ ] `resolveSender()` returns correct sender for multi-message threads, `null` for all-self threads
- [ ] `extractBodySnippet()` handles plain text, HTML-only, null body, URLs, and truncation
- [ ] Batch accumulator collects rows and writes in a single Sheets API call
- [ ] Sheets write failure falls back to Stackdriver with privacy-safe fields only

---

## Implementation Notes

*(To be filled during implementation planning)*

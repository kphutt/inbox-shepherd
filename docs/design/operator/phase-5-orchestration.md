# Phase 5 — Orchestration

> **Status:** Implemented
> **Author:** Karsten Huttelmaier — co-authored with Claude
> **Depends on:** Phases 3 & 4 (all three tiers complete)
> **Produces:** `Main.gs` (full pipeline wiring, observation logging, dry-run mode)
> **Source spec:** [requirements.md](requirements.md) FR-013–016, FR-400–403, FR-700–707, FR-710, NFR-100–103, NFR-302

---

## Goal

Wire the three tiers into the complete pipeline with all production concerns: execution ordering, error isolation, observation logging, dry-run mode, graceful termination, and operational mode selection. After Phase 5, the Operator is functionally complete and ready for dry-run validation.

## Requirements Covered

### Pipeline Wiring

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-013 | Pipeline order: Header Screener → Rules → Classifier | First tier that claims the thread terminates processing |
| FR-014 | Mutation ordering: label → mark read → archive | Never archive without labeling first (NFR-106) |
| FR-015 | Graceful exit: 60s buffer, soft limit at 4 min | Stop accepting new threads, still write observations |
| FR-016 | Top-level try/finally | Always: write observations, write summary, update consecutiveFailures, update lastSuccessfulRun, release lock |

### Operational Modes

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-400 | Single 5-minute trigger, dynamic mode selection | Mode computed per run, not stored |
| FR-401 | Cleanup Mode: 100-thread batches | When unprocessed count > backlogThreshold |
| FR-402 | Maintenance Mode: 50-thread batches | Default when backlog is manageable |
| FR-403 | Auto-detect backlog at run start | Count unprocessed threads → select batch size |

### Observation Logging

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-700 | Run summary to `run_summary` tab | Per §6.1b schema |
| FR-701 | Dry-run mode: log but don't modify Gmail | No label, no archive, no mark-read |
| FR-702 | Dry-run dedup: `lastMessageDate > lastSuccessfulRun` | Prevents duplicate observations from re-evaluating same threads. First run: no filter. |
| FR-703 | Routing decision log to Sheets | Per §6.1 schema |
| FR-706 | No-op runs don't generate summary rows | Only write when `threads_processed > 0` or errors |
| FR-710 | `_keep` as Operator-managed label | Included in skip-if-labeled check |

### Reliability

| ID | Requirement | Summary |
|----|-------------|---------|
| NFR-100 | All errors logged to Stackdriver | No silent failures |
| NFR-101 | Per-thread error isolation | Catch, log, skip, continue batch |
| NFR-102 | Self-terminate before 6-minute limit | Soft limit at 4 min |
| NFR-103 | Automatic downtime recovery | Stateless `is:inbox` query catches up naturally |
| NFR-302 | Label lookups cached in-memory | Per-execution cache from LabelManager |

## Key Design Decisions

**Run failure definition (FR-016):** If Classifier-eligible threads exist AND all fail with LLM errors → `consecutiveFailures` increments. At least one success → reset to 0. No threads reaching Classifier → success.

**Dry-run dedup (FR-702):** In dry-run mode, the Operator doesn't modify Gmail, so threads stay in the inbox and would be re-evaluated every 5 minutes. The `lastSuccessfulRun` timestamp filters out already-seen threads. On first run (no timestamp), all inbox threads are processed.

**Observation batch writes (FR-707):** All routing rows accumulated in-memory. Single `setValues()` in finally block. Run summary as single `appendRow()`. Two Sheets API calls total. If Sheets fails, Stackdriver fallback logs thread_id + tier + label + error only (privacy).

## Acceptance Criteria

- [ ] Full pipeline processes threads through all three tiers correctly
- [ ] Mutation order enforced: label before archive (AC #5 — no unhandled errors during concurrent use)
- [ ] Per-thread errors don't crash the batch (AC #13 — LLM failure degradation)
- [ ] Graceful exit at soft limit: observations still written (AC #14)
- [ ] Cleanup Mode activates on large backlog, transitions to Maintenance (AC #8, AC #11)
- [ ] Dry-run mode: observations logged with `dry_run=true`, Gmail unchanged (AC #16)
- [ ] Dry-run dedup: same thread not re-logged on subsequent runs
- [ ] No-op runs produce no summary rows
- [ ] `_keep` threads skipped (AC #17)
- [ ] Observation schema matches §6.1 and §6.1b exactly (AC #15)
- [ ] 72-hour soak test with zero unhandled errors (AC #12 — post-deployment gate)

---

## Implementation Notes

### Architecture

`processInbox()` in `Main.gs` wires the full three-tier pipeline with two pure helper functions:

- **`computeTaxonomyHash(taxonomy)`** — djb2 hash of sorted+stringified taxonomy for drift detection in `run_summary`. Returns 8-char hex.
- **`computeMode(threadCount, config)`** — selects CLEANUP (>200 threads, batch 100) or MAINTENANCE (<=200, batch 50).

### Pipeline flow

1. **Startup:** validateConfig → ensureLabels → getManagedLabelNames → ensureSheet → resetObservationBuffer → read ScriptProperties state
2. **Query:** Single `getInboxThreads(201)` call for both mode detection and thread retrieval (no double-fetch)
3. **Per-thread loop** with two time guards:
   - 3 min: `llmUnavailable = true` (skips Classifier, Rules still process)
   - 4 min: break loop entirely
4. **Per-thread pipeline:** isAlreadyLabeled → resolveSender → dry-run dedup → Tier 1 (screenThread) → Tier 2 (matchRule) → Tier 3 (classifyThread)
5. **Finally block:** flushRoutingLog → writeRunSummary → update consecutiveFailures/lastSuccessfulRun → releaseLock. Each operation in its own try/catch.

### Key decisions

- **Circuit breaker:** HTTP 429 and 3-min time guard both set `llmUnavailable = true`. Rules continue; only LLM path blocked.
- **Dry-run dedup (FR-702):** `thread.getLastMessageDate() <= lastSuccessfulRun` (both Date objects). First run (`null`) processes all.
- **Privacy:** `logSubject` toggle applies to accumulateRow only; matchRule always uses real subject. Debug logging never includes full prompt.
- **Error isolation (NFR-101):** Per-thread try/catch. addLabel failure in catch prevents archive (NFR-106).
- **Routing log tiers:** Only RULE, CLASSIFIER, FALLBACK get rows. Header Screener and INBOX rule results logged to Stackdriver only + counted in run_summary.
- **`signals_json` per tier:** RULE gets `{matchType, matchValue}`, CLASSIFIER gets annotations object, FALLBACK gets `{error}`. All pre-stringified.

### Tests

12 new tests in `tests/main.test.mjs` covering `computeTaxonomyHash` (determinism, order-independence, collision avoidance) and `computeMode` (threshold boundary cases). Full suite: 111 tests, 0 failures.

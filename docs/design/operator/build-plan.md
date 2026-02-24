# Operator Build Plan

> **Version:** 1.0 · **Date:** 2026-02-24
> **Scope:** v1 Operator implementation — 6 phases from foundation to go-live.
> **Source spec:** [requirements.md](requirements.md) (v5.1) · [brainstorm.md](brainstorm.md)

---

## Overview

The Operator is built in 6 phases. Each phase produces independently testable deliverables. Phases are sequential — each depends on the previous — except Phases 3 and 4 (tiers), which can overlap since the tiers are independently testable.

| Phase | Name | Depends On | Deliverables |
|-------|------|-----------|--------------|
| [1](phase-1-foundation.md) | Foundation | — | `Config.js`, `LabelManager.gs`, `ObservationStore.gs` (create-only), `Main.gs` (validation + lock) |
| [2](phase-2-infrastructure.md) | Infrastructure | Phase 1 | `Utils.gs`, batch accumulator in `ObservationStore.gs` |
| [3](phase-3-tiers-1-2.md) | Tiers 1 & 2 | Phase 2 | `HeaderScreener.gs`, `Rules.gs` |
| [4](phase-4-classifier.md) | Tier 3 (Classifier) | Phase 2 | `Classifier.gs`, `Annotations.gs` |
| [5](phase-5-orchestration.md) | Orchestration | Phases 3 & 4 | `Main.gs` (full pipeline wiring, observation logging, dry-run) |
| [6](phase-6-go-live.md) | Utilities & Go-Live | Phase 5 | `undoSince`, `mergeLabels`, acceptance testing, production deployment |

```
Phase 1 → Phase 2 → Phase 3 ─┐
                    Phase 4 ─┤→ Phase 5 → Phase 6
                              │
                    (3 & 4 can overlap)
```

---

## FR Assignment Map

Every v1 functional requirement is assigned to exactly one phase. If a requirement isn't in this table, it's missing.

### Phase 1 — Foundation

| ID | Requirement | Module |
|----|-------------|--------|
| §5.2b | Config.js data structure | `Config.js` |
| NFR-105 | Startup config validation | `Main.gs` |
| NFR-104 | LockService concurrency guard | `Main.gs` |
| FR-203 | Label auto-creation (taxonomy + `_review` + `_keep`) | `LabelManager.gs` |
| FR-705 | Observation store auto-creation (tabs + headers) | `ObservationStore.gs` |

### Phase 2 — Infrastructure

| ID | Requirement | Module |
|----|-------------|--------|
| FR-010 | Inbox query (`is:inbox`) | `Utils.gs` |
| FR-011 | Skip-if-labeled (routing label = processed marker) | `Utils.gs` |
| FR-012 | Sender resolution (most recent non-self sender) | `Utils.gs` |
| FR-707 | Batch write infrastructure (in-memory accumulation, `setValues()` in finally) | `ObservationStore.gs` |
| Open Q #10 | Body text extraction (`getPlainBody()` null fallback, HTML strip, URL redaction) | `Utils.gs` |

### Phase 3 — Tiers 1 & 2

| ID | Requirement | Module |
|----|-------------|--------|
| FR-100 | Header Screener: check bulk-mail headers before other processing | `HeaderScreener.gs` |
| FR-101 | No bulk headers → remain in Inbox untouched | `HeaderScreener.gs` |
| FR-102 | Header Screener is first tier in pipeline | `HeaderScreener.gs` |
| FR-103 | Header check: `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, noreply, BCC-only | `HeaderScreener.gs` |
| FR-104 | Non-classification decisions → Stackdriver + run_summary counts only | `HeaderScreener.gs` |
| FR-105 | Header Screener exception → treat as personal (safe failure) | `HeaderScreener.gs` |
| FR-200 | Rule matching: senderDomain, senderAddress, subjectContains, displayName | `Rules.gs` |
| FR-201 | Rule actions: label (archive) and INBOX (leave) | `Rules.gs` |
| FR-202 | First-match-wins evaluation | `Rules.gs` |
| FR-204 | Rules modifiable without code changes | `Rules.gs` |
| FR-205 | Routing dictionary is single source of truth | `Rules.gs` |
| Open Q #5 | Header Screener boolean logic validation | `HeaderScreener.gs` |

### Phase 4 — Tier 3 (Classifier)

| ID | Requirement | Module |
|----|-------------|--------|
| FR-300 | Classifier prompt format (annotated email display) | `Classifier.gs` |
| FR-301 | Return exactly one label from active taxonomy | `Classifier.gs` |
| FR-302 | Confidence output (`CATEGORY\|CONFIDENCE` parsing) | `Classifier.gs` |
| FR-304 | Invalid response → `_review` fallback, thread stays in inbox | `Classifier.gs` |
| FR-305 | Fuzzy single-label extraction (case-insensitive, strip whitespace) | `Classifier.gs` |
| FR-306 | LLM model configurable via Config.js | `Classifier.gs` |
| FR-307 | API errors (429/500/timeout) → skip thread. Malformed response → `_review`. | `Classifier.gs` |
| IF-105 | Taxonomy dynamically derived from config (not hardcoded in prompt) | `Classifier.gs` |
| Open Q #9 | Gemini API call pattern from Apps Script | `Classifier.gs` |
| — | Platform detection annotation (`[via SendGrid]`, etc.) | `Annotations.gs` |
| — | Addressing annotation (`direct`/`CC`/`BCC`) | `Annotations.gs` |
| — | Noreply annotation | `Annotations.gs` |

### Phase 5 — Orchestration

| ID | Requirement | Module |
|----|-------------|--------|
| FR-013 | Pipeline order: Header Screener → Rules → Classifier | `Main.gs` |
| FR-014 | Mutation ordering: label → mark read → archive | `Main.gs` |
| FR-015 | Graceful exit (60s buffer, soft limit at 4 min) | `Main.gs` |
| FR-016 | Top-level try/finally (observations, summary, failure tracking) | `Main.gs` |
| FR-400 | Single 5-minute trigger, dynamic mode | `Main.gs` |
| FR-401 | Cleanup Mode: 100-thread batches | `Main.gs` |
| FR-402 | Maintenance Mode: 50-thread batches | `Main.gs` |
| FR-403 | Auto-detect backlog → select batch size | `Main.gs` |
| FR-700 | Run summary stats to `run_summary` tab | `ObservationStore.gs` |
| FR-701 | Dry-run mode: log but don't modify Gmail | `Main.gs` |
| FR-702 | Dry-run dedup: only process threads newer than `lastSuccessfulRun` | `Main.gs` |
| FR-703 | Routing decision log to Sheets | `ObservationStore.gs` |
| FR-706 | No-op runs don't generate summary rows | `Main.gs` |
| FR-710 | `_keep` recognized as Operator-managed label | `Main.gs` |
| NFR-100 | All errors logged to Stackdriver | `Main.gs` |
| NFR-101 | Per-thread error isolation (catch, log, skip, continue) | `Main.gs` |
| NFR-102 | Self-terminate before 6-minute limit | `Main.gs` |
| NFR-103 | Automatic downtime recovery | `Main.gs` |
| NFR-302 | Label lookups cached in-memory | `LabelManager.gs` |

### Phase 6 — Utilities & Go-Live

| ID | Requirement | Module |
|----|-------------|--------|
| FR-711 | `undoSince(timestamp)` recovery helper | `Main.gs` or `Utils.gs` |
| FR-501 | `mergeLabels` resumable across executions | `LabelManager.gs` |
| FR-502 | Deprecated label migration via `mergeLabels` | `LabelManager.gs` |
| FR-503 | Deprecated label deletion after zero-thread confirmation | `LabelManager.gs` |
| FR-500 | Inbox backfill uses same pipeline (Cleanup Mode) | (verified, not new code) |
| §9 | Acceptance criteria verification (19 items) | (testing, not new code) |

### Not in v1 (Deferred)

| ID | Requirement | Deferred To |
|----|-------------|-------------|
| IF-101 | `splitLabel` | Strategist v2 |
| IF-103 | `retireLabel` | Strategist v2 |
| IF-104 | `reclassify` | Strategist v2 |
| IF-106 | Resumable taxonomy operations | Strategist v2 |
| IF-107 | Taxonomy operation logging | Strategist v2 |
| FR-600–603 | Filter audit and cleanup | Post-launch |
| FR-704 | Alert email on consecutive failures | v1.1 (adds `gmail.send` scope) |

---

## Module Map

Modules from requirements.md §7.0, mapped to the phase that creates them.

| Module | Phase Created | Phase Modified | Purpose |
|--------|--------------|----------------|---------|
| `Config.js` | 1 | — | User configuration (taxonomy, rules, settings) |
| `Main.gs` | 1 | 5 | Entry point, validation, lock → full orchestration |
| `LabelManager.gs` | 1 | 6 | Label CRUD, auto-creation, `mergeLabels` |
| `ObservationStore.gs` | 1 | 2, 5 | Sheet auto-creation → batch writes → observation logging |
| `Utils.gs` | 2 | — | Sender resolution, body extraction, inbox query helpers |
| `HeaderScreener.gs` | 3 | — | Tier 1: bulk-header detection |
| `Rules.gs` | 3 | — | Tier 2: sender-to-label lookup |
| `Classifier.gs` | 4 | — | Tier 3: Gemini API call + response parsing |
| `Annotations.gs` | 4 | — | Platform detection, addressing, noreply annotations |

---

## Blocking Implementation Gaps

Three open questions from requirements.md §10 / brainstorm §23 that require implementation spikes:

| Gap | Open Q | Phase | Risk |
|-----|--------|-------|------|
| Header Screener boolean logic | #5 | Phase 3 | Which header combination reliably identifies bulk mail? Needs validation against real email. |
| Gemini API call from Apps Script | #9 | Phase 4 | `UrlFetchApp.fetch()` to `generativelanguage.googleapis.com`. Auth, request format, error handling TBD. |
| Body text extraction | #10 | Phase 2 | `getPlainBody()` null fallback, HTML-to-text, URL redaction, truncation. |

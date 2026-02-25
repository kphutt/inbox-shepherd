# Phase 3 — Tiers 1 & 2 (Header Screener + Rules)

> **Status:** Implemented
> **Depends on:** Phase 2 (sender resolution, skip-if-labeled, body extraction)
> **Produces:** `HeaderScreener.gs`, `Rules.gs`
> **Source spec:** [requirements.md](requirements.md) FR-100–105, FR-200–205, Open Q #5

---

## Goal

Build the two deterministic tiers of the pipeline. The Header Screener protects personal email (zero cost, zero config). The Rules engine routes known senders (zero LLM cost). Both are independently testable without the Classifier.

After Phase 3, every thread that isn't personal and isn't matched by a rule falls through to where the Classifier will be — but the Classifier doesn't exist yet. That's Phase 4.

## Requirements Covered

### Tier 1 — Header Screener

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-100 | Check bulk-mail headers before any other processing | First gate in the pipeline |
| FR-101 | No bulk headers → remain in Inbox untouched and unlabeled | Personal email protection |
| FR-102 | Header Screener is first tier | Architectural constraint |
| FR-103 | Header check list | `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, noreply sender pattern, BCC-only addressing |
| FR-104 | Non-classification decisions logged to Stackdriver + run_summary only | NOT written to routing_log |
| FR-105 | Exception → treat as personal (not bulk) | Safe failure mode: false negatives safe, false positives dangerous |

### Tier 2 — Rules

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-200 | Match types: `senderDomain` (exact), `senderAddress` (exact), `subjectContains` (substring), `displayName` (exact). All case-insensitive. | Four match types, no regex |
| FR-201 | Two actions: label (apply + mark read + archive) and INBOX (leave in inbox, no label) | INBOX rules protect urgent automated email with bulk headers |
| FR-202 | First-match-wins evaluation | Stop on first matching rule |
| FR-204 | Rules modifiable without code changes | Config.js only |
| FR-205 | Routing dictionary is single source of truth | No hardcoded routing in system logic |

## Modules

- **`HeaderScreener.gs`** — `screenThread(message)`: examines headers of the most recent message, returns `{ isBulk: boolean, signals: object }`. Signals object captures which headers were detected (for debugging/logging).
- **`Rules.gs`** — `matchRule(sender, subject, rules)`: iterates rules array, returns first match or `null`. Returns `{ rule, action, label }`.

## Blocking Implementation Gap

**Header Screener boolean logic (Open Q #5):** The proposed check is `List-Unsubscribe` OR `Precedence: bulk` OR noreply sender pattern OR BCC-only addressing. This needs validation against real email to confirm:
- Does it catch the bulk mail it should?
- Does it let personal email through?
- Are there edge cases (e.g., mailing lists with personal replies)?

This is a spike at the start of Phase 3 — test the boolean logic against a sample of real inbox threads before committing to the implementation.

## Acceptance Criteria

- [ ] Personal email (no bulk headers) stays in Inbox with no Operator label (AC #1)
- [ ] Bulk email detected by at least one header indicator
- [ ] Header Screener exception → thread treated as personal (FR-105)
- [ ] INBOX rules keep 2FA/security alerts in inbox (AC #4)
- [ ] Label rules match correctly on all four match types
- [ ] First-match-wins: earlier rule takes priority over later matching rule
- [ ] Header Screener decisions logged to Stackdriver, not routing_log (FR-104)
- [ ] Run_summary tier counts (`tier_header_screen`, `tier_rule_inbox`, `tier_rule`) increment correctly

---

## Implementation Notes

*(To be filled during implementation planning)*

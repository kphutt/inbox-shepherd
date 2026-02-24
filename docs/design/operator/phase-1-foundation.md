# Phase 1 — Foundation

> **Status:** Not started
> **Depends on:** Nothing (first phase)
> **Produces:** `Config.js`, `LabelManager.gs`, `ObservationStore.gs` (create-only), `Main.gs` (validation + lock only)
> **Source spec:** [requirements.md](requirements.md) §5.2b, NFR-104, NFR-105, FR-203, FR-705

---

## Goal

Stand up the skeleton that every other phase builds on. After Phase 1, you can deploy to Apps Script and run the trigger — it validates config, acquires a lock, creates labels and sheets, then exits cleanly. No email processing yet.

## Requirements Covered

| ID | Requirement | Summary |
|----|-------------|---------|
| §5.2b | Config.js data structure | Taxonomy, rules, operator settings, secret property references |
| NFR-105 | Startup config validation | Non-empty taxonomy, ownerEmail, API key exists, sheet accessible, label name format, rule labels exist in taxonomy, ownerEmail mismatch warning |
| NFR-104 | LockService concurrency guard | `LockService.getScriptLock()` with 0-second `tryLock`. Skip if already running. |
| FR-203 | Label auto-creation | All taxonomy labels + `_review` + `_keep` created at startup before processing loop |
| FR-705 | Observation store auto-creation | `routing_log` and `run_summary` tabs with header rows, created on first run if missing |

## Modules

- **`Config.js`** — Full structure per §5.2b. Default 10-category taxonomy, empty rules array, seed INBOX rules (2FA, security alerts), operator defaults (`dryRun: true`).
- **`LabelManager.gs`** — `ensureLabels()`: reads taxonomy keys from Config, creates missing Gmail labels. Returns label cache (name → GmailLabel object) for in-memory lookups (NFR-302).
- **`ObservationStore.gs`** — `ensureSheet()`: opens spreadsheet by ID from ScriptProperties, creates `routing_log` and `run_summary` tabs with header rows if missing. No write logic yet (Phase 2).
- **`Main.gs`** — Entry point (`processInbox()`): acquire lock → validate config → ensure labels → ensure sheet → exit. Trigger setup function (`installTrigger()`).

## Open Questions

None for this phase.

## Acceptance Criteria

- [ ] `clasp push` succeeds
- [ ] Trigger fires, validates config, creates labels, creates sheet tabs, exits without error
- [ ] Invalid config (empty taxonomy, missing API key, etc.) produces clear error in Stackdriver
- [ ] Concurrent trigger fires: second execution exits immediately (LockService)
- [ ] All taxonomy labels + `_review` + `_keep` exist in Gmail after first run (AC #7)

---

## Implementation Notes

*(To be filled during implementation planning)*

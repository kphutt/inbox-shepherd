# Phase 1 — Foundation

> **Status:** Implemented
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

### Design decisions made during implementation

1. **`validateConfig()` returns `{ valid, spreadsheet }`** instead of a plain boolean. The spreadsheet opened during validation check #4 is passed through to `ensureSheet()`, avoiding a redundant `SpreadsheetApp.openById()` call. Identified during plan review (Lens 2: Dependency Correctness).

2. **Top-level CONFIG existence guard** in `processInbox()`. If Config.js is deleted or empty, `typeof CONFIG === 'undefined'` catches it with a clear error before any other code runs. Identified during plan review (Lens 3: Error Handling).

3. **`ensureSheet()` takes a Spreadsheet object** (not config) since the spreadsheet is already opened by `validateConfig()`. This makes the dependency explicit and avoids re-reading ScriptProperties.

4. **Header arrays as module-level constants** in ObservationStore.gs (`ROUTING_LOG_HEADERS`, `RUN_SUMMARY_HEADERS`). Phase 2's batch write logic can reference these for column ordering.

5. **`getManagedLabelNames()` helper** in LabelManager.gs extracts the Set of managed label names from the label cache Map. Phase 2's `isAlreadyLabeled()` will use this for skip-if-labeled checks.

6. **Frozen header rows** added to both Sheets tabs for usability. Not in spec but harmless and helpful.

### Files created

| File | Lines | Purpose |
|------|------:|---------|
| `src/appsscript.json` | 13 | Manifest: V8 runtime, 5 OAuth scopes |
| `src/Config.js` | 63 | User config: taxonomy, rules, settings |
| `src/LabelManager.gs` | 52 | Label auto-creation + cache |
| `src/ObservationStore.gs` | 66 | Sheet tab auto-creation |
| `src/Main.gs` | 152 | Entry point, validation, lock, trigger setup |

### Pre-deployment checklist

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Create Apps Script project: `clasp create --type standalone --rootDir src`
4. Set ScriptProperties in Apps Script editor (Project Settings > Script Properties):
   - `GEMINI_API_KEY` — from Google AI Studio
   - `OBSERVATION_SHEET_ID` — ID of a blank Google Sheets spreadsheet
5. Edit `src/Config.js`: set `ownerEmail` to your Gmail address
6. `clasp push`
7. Run `installTrigger()` from the Apps Script editor

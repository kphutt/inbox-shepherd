# inbox-shepherd — Conventions

## Structure

```
inbox-shepherd/
├── ROADMAP.md              # Prioritized initiatives (backlog)
├── CLAUDE.md               # This file — AI agent conventions
├── README.md               # User-facing project overview
├── LICENSE                  # MIT
├── .gitignore
├── docs/
│   ├── design/             # One folder per initiative
│   │   ├── operator/       # Initiative 1: Data plane
│   │   │   ├── requirements.md
│   │   │   └── brainstorm.md
│   │   └── strategist/     # Initiative 2: Control plane
│   │       └── brainstorm.md
│   └── decisions/          # Decision records
└── src/                    # Implementation (Apps Script)
```

## Project Context

This is a **Google Apps Script** project deployed via `clasp`. The runtime is V8, the deployment target is a bound or standalone Apps Script project connected to a Gmail account.

Two logically separate systems share this codebase:
- **Operator (data plane):** Runs every 5 min. Routes email through Header Screener → static rules → LLM Classifier. Logs decisions to Sheets.
- **Strategist (control plane):** v1 is manual (human + Gemini prompt). v2 will be automated software on a separate trigger.

## Conventions

- **Config isolation:** All user-specific configuration (routing rules, label taxonomy, operator settings) lives in a single `Config.js` file. System logic never contains hardcoded sender addresses or label names. Secrets (API key, Sheet ID) live in `ScriptProperties`.
- **Non-destructive by default:** The Operator labels, marks read, and archives. It never deletes email content. Destructive operations (label deletion, filter deletion) require explicit confirmation gates.
- **Observation-first:** Every routing decision is accumulated during processing and batch-written to Google Sheets in the `finally` block. Gmail mutations (label + archive) happen per-thread during the run. If the script crashes mid-run, labeled threads may lack observation rows — accepted tradeoff for batch write efficiency.
- **Resumable operations:** Any batch operation (backfill, reclassification, label migration) must be resumable across the 6-minute Apps Script execution limit using `ScriptProperties` for progress tracking.
- **LLM data minimization:** The LLM sees only: sender name + address (with platform annotation), addressing annotation (NOT owner's email), subject, and a ~100-char sanitized body snippet. HTML stripped, URLs redacted. Owner email never in prompt.

## Docs

This project follows the project-docs convention: `ROADMAP.md` for big rocks, `docs/design/` for per-initiative design docs, `docs/decisions/` for decision records.

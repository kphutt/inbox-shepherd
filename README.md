# 🐑 inbox-shepherd

A Gmail system that sorts your email, learns from corrections, and gets cheaper over time.

> **Status:** Dry-run validation ([see progress](#project-status))
> **Platform:** Google Apps Script + Gemini 2.0 Flash  
> **License:** MIT

---

## The Problem

Every system for managing email just moves the work. Gmail's category tabs sort mail into 5 buckets you can't customize — corrections don't compound, and everything still sits in your inbox. Gmail filters give you control, but they rot: new senders appear, old ones go dormant, and maintaining the rules is the same tedious manual effort filters were supposed to eliminate.

The real problem isn't filtering — it's that the system doesn't maintain itself. inbox-shepherd does. It classifies senders it's never seen before, logs every decision so mistakes are visible and structurally fixable, and promotes patterns into rules automatically. You open Gmail and the only things in your inbox are the messages that actually need you.

## How It Works

```
  ┌─────────────────────────────────────────────────────────┐
  │                      is:inbox                           │
  └──────────────────────────┬──────────────────────────────┘
                             │
                 ┌───────────▼────────────┐
                 │   Header Screener      │  No bulk headers?
                 │       (Tier 1)         │──── Personal mail ──→ stays in inbox
                 └───────────┬────────────┘
                             │ bulk headers
                 ┌───────────▼────────────┐
                 │   Static Rules         │  INBOX rule match?
                 │       (Tier 2)         │──── Urgent (2FA) ───→ stays in inbox
                 │                        │  Label rule match?
                 │                        │──── Known sender ───→ label + archive
                 └───────────┬────────────┘
                             │ no rule match
                 ┌───────────▼────────────┐
                 │   LLM Classifier       │
                 │       (Tier 3)         │──── Classified ─────→ label + archive
                 │                        │──── Uncertain ──────→ _review (inbox)
                 └────────────────────────┘
```

Two subsystems share the codebase:

**The Operator** runs every 5 minutes, processing your inbox through the pipeline above.

1. **Header Screener (Tier 1):** Checks for bulk-mail indicators. No bulk headers → personal email → stays in inbox, untouched. Zero cost, zero config.
2. **Static Rules (Tier 2):** Deterministic sender-to-label mappings — no LLM needed. Also catches urgent automated email (2FA codes, security alerts) and keeps it in inbox despite bulk headers.
3. **LLM Classifier (Tier 3):** Handles everything else, including senders the system has never seen. Gemini Flash classifies into a configurable taxonomy (10 categories by default). This is what filters can't do — you don't need to anticipate every sender.

Every decision is logged to an observation store. This data is what makes the system improvable.

**The Strategist** evolves the rules over time. In v1, the Strategist is you: review the observation log, spot patterns, update `Config.js`. A sender the Classifier handles 30 times in a row? Promote it to a Rule — now it's faster and free. In v2, this becomes [automated software](docs/design/strategist/). The system gets cheaper and more accurate the longer it runs.

## Design Principles

1. **Zero Trust / Default-Deny** — Only email without bulk headers stays in the Inbox. Everything else must be classified.
2. **Separate the Data Plane from the Control Plane** — Running rules (cheap, fast, every 5 min) and maintaining rules (thoughtful, expensive, daily/weekly) are distinct software.
3. **Observable** — Every routing decision is logged with enough context for the control plane to analyze and propose changes.
4. **Non-Destructive by Default** — Labels and archives, never deletes (v1).
5. **Resilient to Neglect** — If it breaks for a month, it catches up automatically when restored.
6. **Retroactive Consistency** — Rule changes can apply backward. The archive stays consistent with the current taxonomy.
7. **Conservative by Default** — Taxonomy changes require sustained signal and human approval.
8. **Portable** — Fork it, point it at your Gmail, customize Config.js, and go.
9. **Zero Operational Burden** — The system must not trade manual effort in email for manual effort in system management. Corrections compound into better rules.

## Limitations (v1)

- Does not detect spam or malware (Gmail handles that).
- Does not auto-reply or draft responses.
- Does not delete any email — labels and archives only.
- Single Gmail account only.
- Requires a paid Gemini API key (~$1–5/month at typical volume, decreasing as Rules replace Classifier calls).

## Getting Started

> **Currently in dry-run validation.** Setup: clone the repo, run `npm install -g @google/clasp && clasp login`, edit `Config.js` with your taxonomy and owner email, set `GEMINI_API_KEY` and `OBSERVATION_SHEET_ID` in Apps Script Project Settings > Script Properties, deploy via `clasp push`, and run `installTrigger()` from the editor to enable the 5-minute trigger. Start with `dryRun: true` to validate before going live.

## Documentation

- **[Roadmap](ROADMAP.md)** — Prioritized initiatives
- **[Operator Requirements](docs/design/operator/requirements.md)** — Data plane: email routing engine (v5.1)
- **[Operator Brainstorm](docs/design/operator/brainstorm.md)** — Detailed design decisions and edge cases
- **[Strategist Design](docs/design/strategist/)** — Control plane: rule management and taxonomy evolution (stub)
- **[CLAUDE.md](CLAUDE.md)** — AI agent conventions and project structure

## Project Status

1. ~~Requirements definition~~ ✅
2. ~~Design analysis~~ ✅
3. ~~Implementation~~ ✅ (Phases 1–5: foundation, infrastructure, tiers 1–3, orchestration)
4. Dry-run validation ← **current** (`dryRun: true`)
5. Go-live

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Google Apps Script (V8) |
| Deployment | [@google/clasp](https://github.com/google/clasp) |
| LLM | Gemini 2.0 Flash (paid API) |
| Observation store | Google Sheets |
| State persistence | Apps Script PropertiesService |
| Version control | Git + GitHub |

## Privacy

All email processing stays within the Google ecosystem. The only external API call is to Gemini (`googleapis.com`) under paid-tier terms — inputs are not used for training. The LLM sees only: sender name + address with platform annotation, addressing annotation (the owner's email address is never included), subject line, and a ~100-character sanitized body snippet. HTML is stripped, URLs are redacted. API keys live in Apps Script PropertiesService (encrypted at rest), never in source code. The observation store (Google Sheets) contains sender addresses and subject lines — keep it private.

## License

MIT

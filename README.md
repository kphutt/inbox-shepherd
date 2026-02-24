# 🐑 inbox-shepherd

A self-tuning Gmail triage system that manages your email taxonomy so you don't have to.

> **Status:** Design complete · Pre-implementation  
> **Platform:** Google Apps Script + Gemini 2.0 Flash  
> **License:** MIT

---

## The Problem

Every time you open your inbox, most of what's there isn't for you. It's receipts, shipping notifications, newsletters you forgot you subscribed to, account alerts, school blasts, marketing from companies you bought something from once. Somewhere in that pile are the messages that actually need you — a friend, a colleague, something time-sensitive — but you have to dig through everything else to find them.

Gmail tries to help with **category tabs** (Promotions, Social, Updates, Forums). These sort incoming mail into 5 broad buckets using Google's ML. But you get zero control over the taxonomy, zero visibility into why something was classified, and no way to fix mistakes systematically. A bank marketing email lands in Promotions — you can't tell Gmail "anything from Chase is Financial." You can drag individual messages to different tabs, but the corrections don't compound. And everything still sits in the inbox. You still have to look at all of it.

Gmail filters are the power-user answer, but they require you to maintain the system yourself. You set up filters and labels, life changes, new senders appear, old ones go dormant, and the whole structure slowly rots. Noticing what's stale takes effort. Updating it takes more effort. So you don't, and the mess comes back. The maintenance burden is the same kind of tedious manual work that filters were supposed to save you from in the first place.

**inbox-shepherd** is a system that manages itself. It classifies senders it has never seen before without any new rule. It logs every decision so mistakes are visible and structurally fixable — the fixes compound. Over time, it promotes patterns into rules automatically, getting faster and cheaper the longer it runs. And it doesn't just sort your inbox into visual buckets — it labels and archives, so when you open Gmail, the only things in your inbox are the messages that actually need you.

## How It Works

Two subsystems share a codebase but serve different roles:

**The Operator** runs every 5 minutes, processing your inbox through a three-tier pipeline. Each tier exists for a reason:

1. **Tier 1 — Header Screener:** Protects personal email. Checks email headers for bulk-mail indicators — if there are none, it's person-to-person mail and stays in your inbox, untouched. Zero cost, zero configuration, works from day one.
2. **Tier 2 — Static Rules:** Handles known senders cheaply. Deterministic sender-to-label mappings — no LLM call needed. Also catches urgent automated email (2FA codes, security alerts) and keeps it in inbox.
3. **Tier 3 — LLM Classifier:** Handles everything else, including senders the system has never seen. Gemini Flash reads the email metadata and classifies it into a 10-category taxonomy. This is what Gmail filters fundamentally can't do — you don't need to anticipate every sender in advance.

Every decision is logged. The observation store records what was classified, which tier handled it, and how confident the Classifier was. This data is what makes the system improvable.

**The Strategist** is the control plane — it evolves the rules over time. In v1, the Strategist is **you**: review the observation log, spot patterns, update `Config.js`, `clasp push`. A sender the Classifier handles 30 times in a row? Promote it to a Rule — now it's faster and free. A category that's grown too broad? Split it. In v2, this becomes automated software with its own [design docs](docs/design/strategist/).

The result is a system that gets cheaper and more accurate the longer it runs. The Classifier handles novel senders immediately; the Strategist gradually promotes the predictable ones to rules; the rules handle them for free from then on.

What makes it different from a Gmail filter replacement:

- **Self-tuning.** The Strategist observes routing behavior and proposes taxonomy changes. You approve in under 2 minutes a day.
- **Conservative.** Changes require sustained signal, not short-term spikes. When uncertain, the system does nothing.
- **Retroactive.** When you approve a rule change, historical threads can be reclassified. Your archive stays consistent with your *current* taxonomy.
- **Resilient to neglect.** If it breaks for a month, it catches up automatically when restored.
- **Non-destructive.** It labels, marks read, and archives. It never deletes.

## Design Principles

1. **Zero Trust / Default-Deny** — Only email without bulk headers (personal email) stays in the Inbox. Everything else must be classified and routed.
2. **Self-Tuning with Human Oversight** — The system proposes; you approve.
3. **Manage as a System, Not One-Off Rules** — The Strategist maintains sender rules. You manage the system.
4. **Non-Destructive by Default** — Labels and archives, never deletes (v1).
5. **Resilient to Neglect** — Catches up automatically after any downtime.
6. **Retroactive Consistency** — Rule changes apply backward, not just forward.
7. **Conservative by Default** — Taxonomy changes require sustained signal and human approval. Default to inaction when uncertain.
8. **Separate the Operator from the Strategist** — Running rules (cheap, fast, every 5 min) and maintaining rules (thoughtful, expensive, daily/weekly) are distinct concerns.
9. **Portable** — Fork it, point it at your Gmail, customize Config.js, and go.

## Documentation

- **[Roadmap](ROADMAP.md)** — Prioritized initiatives
- **[Operator Requirements](docs/design/operator/requirements.md)** — Data plane: email routing engine (v5.1)
- **[Operator Brainstorm](docs/design/operator/brainstorm.md)** — Detailed design decisions, edge cases, implementation guidance
- **[Strategist Design](docs/design/strategist/)** — Control plane: rule management and taxonomy evolution (stub)

## Documentation Structure

This project follows the project-docs convention:

- **`ROADMAP.md`** — Prioritized big rocks (the backlog)
- **`docs/design/`** — One design doc per initiative
- **`docs/decisions/`** — Decision records
- **`CLAUDE.md`** — AI agent conventions

## Project Status

1. ~~Requirements definition~~ ✅
2. ~~Design analysis (12 lenses: traceability, failures, security, privacy, undo, implementation readiness)~~ ✅
3. Implementation (Apps Script + clasp) ← **next**
4. Dry-run validation
5. Go-live

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Google Apps Script (V8) |
| Deployment | [@google/clasp](https://github.com/google/clasp) |
| LLM — Operator (classification) | Gemini 2.0 Flash (paid API) |
| LLM — Strategist (analysis/proposals) | Gemini 2.0 Pro or pattern-based |
| Observation store / feedback UI | Google Sheets |
| State persistence | Apps Script PropertiesService |
| Version control | Git + GitHub |

## Privacy

All email processing stays within the Google ecosystem. The only external API call is to Gemini (`googleapis.com`) under paid-tier terms (inputs not used for training). The LLM sees only: sender name + address with platform annotation, addressing annotation (the owner's email address is never included), subject line, and a ~100-character sanitized body snippet. HTML is stripped, URLs are redacted. API keys are stored in Apps Script PropertiesService (encrypted at rest), never in source code. The observation store (Google Sheets) contains sender addresses and subject lines — keep it private.

## License

MIT

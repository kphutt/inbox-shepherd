# Roadmap

<!-- Prioritized big rocks. This is the backlog. -->

## Active

### Initiative 1: Operator (Data Plane)
**Status:** Design complete → Implementation next  
**Design:** [docs/design/operator/](docs/design/operator/)

The email routing engine. Processes Gmail threads through a three-tier pipeline (Header Screener → static rules → LLM Classifier), logs every decision to an observation store, and exposes taxonomy operations for the control plane. Runs every 5 minutes on Google Apps Script.

**Key deliverables:**
- Three-tier routing engine (Tier 1 Header Screener, Tier 2 Rules, Tier 3 Gemini Flash Classifier)
- Observation log to Google Sheets (routing_log + run_summary)
- Label operations: mergeLabels for v1 launch; reclassify, split, retire deferred to Strategist
- Cleanup/Maintenance mode auto-switching (dynamic batch size)
- Dry-run mode with duplicate-prevention
- `_review` fallback label + `_keep` human override label
- `undoSince()` manual recovery helper

**Next steps:**
1. ~~Requirements + design analysis~~ ✅ (12 lenses, ~90% implementation-ready)
2. Resolve 3 blocking gaps (Header Screener boolean logic, Gemini API call pattern, body text extraction — all have proposed solutions in brainstorm §23)
3. Implementation
4. Dry-run validation
5. Go-live

---

## Planned

### Initiative 2: Strategist (Control Plane)
**Status:** Stub — v1 is manual (human + Gemini prompt)  
**Design:** [docs/design/strategist/](docs/design/strategist/)

The rule management and taxonomy evolution system. Analyzes the Operator's observation logs, detects drift, ingests human corrections, and proposes changes. In v1, this is the human reviewing the Sheets log and updating Config.js. In v2, it becomes automated software.

**Key deliverables (v2):**
- Automated observation log analysis (pattern-based or Gemini Pro)
- Drift detection: new senders, volume shifts, low-confidence LLM classifications, dormant labels
- Proposal generation with scope-of-impact estimates
- Human approval workflow via Sheets
- Self-adjusting cadence (daily → weekly)
- Conservatism constraints (30-day observation minimum, sustained signal, default to inaction)

---

## Future

### Draft Composition
LLM generates draft replies for personal email in the inbox. Ref: [Akil's gmail-delegator](https://github.com/ZackAkil/AI-got-this-gmail-delegator).

### Sensitive Info Detection
Scan for PII, credentials, API keys in email body. Read-only flagging; deletion needs own requirements.

### Old Email Deletion
Bulk delete by age with exclusion rules. High-risk — needs quarantine step and own acceptance criteria.

### Unsubscribe Automation
Auto-unsubscribe from senders consistently routing to low-value labels.

### Daily Digest Email
Summary of routing activity, proposals pending review, corrections applied.

### Calendar Event Extraction
Ref: [Akil's gmail-event-genie](https://github.com/ZackAkil/gmail-event-genie).

### Onboarding Wizard
LLM scans sample inbox → proposes taxonomy → generates starter config → dry-run → go live. Makes the system truly self-bootstrapping for new users.

# Roadmap

<!-- Prioritized big rocks. This is the backlog. -->

## Active

### Initiative 1: Operator (Data Plane)
**Status:** Implementation complete — deployment blocked on Advanced Protection Program. See [app-blocker.md](docs/design/operator/app-blocker.md).
**Design:** [docs/design/operator/](docs/design/operator/)

The email routing engine. Processes Gmail threads through a three-tier pipeline (Header Screener → static rules → LLM Classifier), logs every decision to an observation store, and exposes taxonomy operations for the control plane. Runs every 5 minutes on Google Apps Script.

**Key deliverables:**
- ~~Three-tier routing engine (Tier 1 Header Screener, Tier 2 Rules, Tier 3 Gemini Flash Classifier)~~ ✅
- ~~Observation log to Google Sheets (routing_log + run_summary)~~ ✅
- Label operations: mergeLabels for v1 launch; reclassify, split, retire deferred to Strategist
- ~~Cleanup/Maintenance mode auto-switching (dynamic batch size)~~ ✅
- ~~Dry-run mode with duplicate-prevention~~ ✅
- ~~`_review` fallback label + `_keep` human override label~~ ✅
- `undoSince()` manual recovery helper

**Completed phases:**
1. ~~Requirements + design analysis~~ ✅
2. ~~Phase 1: Foundation~~ ✅ (Config, validation, labels, sheets)
3. ~~Phase 2: Infrastructure~~ ✅ (Utils, sender resolution, body extraction, observation store)
4. ~~Phase 3: Tiers 1 & 2~~ ✅ (Header Screener, Rules engine)
5. ~~Phase 4: Tier 3~~ ✅ (Annotations, Classifier, Gemini API)
6. ~~Phase 5: Orchestration~~ ✅ (Full pipeline wiring in processInbox)

**Next steps:**
1. Resolve APP blocker (no path found for target account — see [app-blocker.md](docs/design/operator/app-blocker.md))
2. Dry-run validation (deploy, soak test with `dryRun: true`)
3. Go-live (flip `dryRun: false`)

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

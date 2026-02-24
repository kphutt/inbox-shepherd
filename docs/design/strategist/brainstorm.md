# inbox-shepherd — Strategist Design

> **Version:** 0.2 · **Date:** 2026-02-24 · **Status:** Stub  
> **Author:** Karsten Huttelmaier  
> **Scope:** Control Plane (rule management, taxonomy evolution, feedback analysis). See [operator requirements](../operator/requirements.md) for the Data Plane. See [ROADMAP.md](../../../ROADMAP.md) for the full initiative backlog.

---

## 1. What Is the Strategist?

The Strategist is the **control plane** for inbox-shepherd. It analyzes the Operator's observation logs, detects taxonomy drift, ingests human feedback, and proposes changes to the routing rules and label taxonomy. It is entirely separate software from the Operator.

The Operator processes email. The Strategist thinks about the rules.

### v1: Manual Strategist

In v1, the Strategist is the human operator:

1. Review the observation log in Google Sheets.
2. Identify patterns (new senders, miscategorizations, dormant labels, volume shifts).
3. Optionally paste observation data into Gemini and ask for analysis / rule proposals.
4. Update `Config.js` with new rules.
5. Run `clasp push` to deploy.
6. Optionally run taxonomy operations via the Operator's exposed functions. **v1 only has `mergeLabels()`.** `reclassify`, `splitLabel`, and `retireLabel` are deferred until the automated Strategist needs them (see [Operator brainstorm §18](../operator/brainstorm.md)).

This is acceptable for a single-operator system. The observation log schema and taxonomy operation interface (defined in [operator requirements §6](../operator/requirements.md#6-interface-contract-with-control-plane)) are designed to support a future automated Strategist without changes to the Operator.

---

## 2. Future Automated Strategist — Key Requirements (Draft)

These requirements are **not finalized.** They capture the design intent so the Operator can be built with the right extension points.

### 2.1 Core Responsibilities

- Read the Operator's observation log and feedback columns.
- Detect new high-frequency senders not covered by static rules.
- Detect low-confidence LLM classifications (fuzzy matches, fallback labels).
- Detect volume shifts and dormant labels.
- Read human corrections and identify patterns (same sender repeatedly corrected to a different label).
- Propose rule changes (add, modify, remove static rules).
- Propose taxonomy changes (new labels, splits, merges, retirements).
- Estimate scope of impact for each proposal (thread count affected).
- Present proposals for human approval.
- Apply approved proposals (update config, trigger reclassification via Operator interface).

### 2.2 Conservatism Constraints

- **Sustained signal, not spikes.** A new sender appearing 3 times in a week is not grounds for a rule change. The same sender appearing 15+ times over 30 days is.
- **Propose, never execute.** All changes require human approval.
- **Minimize blast radius.** Every proposal includes an estimated thread count for reclassification impact.
- **Default to inaction.** When uncertain, the Strategist does nothing and flags for review.
- **30-day minimum observation window** before proposing taxonomy changes (except during explicit onboarding opt-in).

### 2.3 Cadence

Self-adjusting: daily during onboarding and high-correction periods, weekly once stable (low correction rate, low fallback rate). The Strategist tracks its own correction rate to determine cadence.

### 2.4 Model Strategy

| Task | Candidate Model | Notes |
|------|----------------|-------|
| Pattern detection (frequency, volume, corrections) | No LLM needed | Spreadsheet analysis / simple script |
| Taxonomy reasoning (propose splits, merges, new categories) | Gemini 2.0 Pro | Requires reasoning over aggregate data |
| Rule generation (new static rules from observation data) | Gemini 2.0 Pro or pattern-based | Sender-domain frequency is mechanical; edge cases need reasoning |

### 2.5 Feedback Loop Requirements

- The feedback mechanism must require **under 2 minutes per day** of human attention during steady state.
- The human must be able to **directly instruct** the Strategist ("move all X to Y", "split Z into A and B") in addition to marking individual routing decisions.
- Corrections should compound — repeated corrections for the same sender should automatically generate a rule proposal.

### 2.6 Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | Should the Strategist be its own Apps Script project, a separate trigger in the same project, or an entirely different runtime? | TBD |
| 2 | Should the Strategist auto-apply approved proposals, or generate a `Config.js` diff for the human to review and deploy? | TBD |
| 3 | What is the right threshold for "high-frequency sender" that triggers a proposal? 5+ in 30 days? 10+? | TBD |
| 4 | Should the Strategist have its own Sheets workbook (consuming the Operator's log as a data source), or share the same workbook? | TBD |
| 5 | ~~How should the Strategist handle the 87-day observation store retention limit — should it maintain its own aggregated data store?~~ **Moot.** Operator corrected estimate: ~90 rows/day, ~33K rows/year, Google Sheets 10M cell limit → ~21 years. Retention is not a concern. | Resolved |

---

## 3. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-23 | 0.1 | K. Huttelmaier | Stub document. Extracted from Operator requirements v2.1. Captures design intent for future automated Strategist. v1 Strategist is manual (human + Gemini prompt). |
| 2026-02-24 | 0.2 | Brainstorm sync | Added Gemini bootstrap lessons, candidate rules from Operator §4.9/§7.3, sender lifecycle detail, spam workflow option, v1 cost expectations. |

---

## 4. Inputs from Operator Design

Content migrated from the Operator brainstorm/requirements that is relevant to Strategist design.

### 4.1 Sender Lifecycle (from Operator §4.3)

The intended lifecycle of every sender: **Classifier → observation → Strategist promotion → Rules.** The Classifier is the catch-all for unknown senders. Rules are the stable state for known senders.

Example: A new soccer league sends from `mapleleafsoccer.org`. No rule exists. The Classifier reads the email about practice schedules and classifies it as "Kids." The observation log captures `mapleleafsoccer.org → Kids (Classifier, high confidence)`. After this happens consistently, the Strategist promotes `mapleleafsoccer.org` to a Rule for "Kids." Now it's fast-tracked without LLM cost.

In v1, this promotion doesn't happen — the Classifier handles everything. The Strategist automates it in v2. The observation log is designed to make this promotion straightforward: query by tier=CLASSIFIER, group by sender domain, filter for consistent label assignment.

### 4.2 Gemini Bootstrap Lessons (from Operator §4.9)

Five Gemini sessions attempted to generate taxonomy + rules from email history. Key lesson for the automated Strategist:

**Programmatic sender extraction (Apps Script querying actual email headers) will be far more reliable than LLM-based email analysis for generating rules.** The Strategist should aggregate sender-domain frequencies from the observation store, not ask an LLM to guess. Gemini hallucinated domains, fabricated volume counts, and produced inconsistent results across runs. The observation store's actual routing data is ground truth.

### 4.3 Candidate Rules for Promotion (from Operator §7.3)

These candidate rules were identified during the Gemini bootstrap and verified as plausible. They are NOT loaded at launch — the Classifier handles everything in v1. The Strategist should validate these against actual observation data before promoting to rules:

| Category | Target Label | Candidate Matching Criteria | Confidence |
|----------|-------------|-------------------|---|
| Scouting | **Scouting** | Domains: `@scouting.org` · Keywords: troop, pack, Order of the Arrow | High |
| Family & Kids | **Kids** | Domains: `@lakewoodusd.org` · Keywords: Westside Chess, Summit Climbing | High |
| Financial | **Financial** | Domains: `@chase.com`, `@bankofamerica.com` | Plausible |
| Shopping & Delivery | **Shopping** | Senders: `mcinfo@ups.com`, `trackingupdates@fedex.com` | Plausible |
| Career | **Career** | Domains: `@linkedin.com`, `@indeed.com` | Plausible |

Additional candidates surfaced across bootstrap runs (lower confidence — require observation validation):

| Sender Pattern | Suggested Label | Source |
|---|---|---|
| `*@scouting.org` | Scouting | Runs 1, 2, 3 |
| `*@lakewoodusd.org` | Kids | Runs 1, 2, 3 |
| `*@linkedin.com` | Career | Runs 3, 4 |
| `*@chase.com` | Financial | Runs 2, 4 |
| Your specific Google Groups addresses | Scouting | Owner-confirmed |

### 4.4 Spam Handling Option (from Operator §3b)

The Operator decided not to call `moveToSpam()` — too risky for false positives. But one option deferred to the Strategist: **surface a "report spam" action in the Strategist workflow.** During daily review, the Strategist (human or automated) sees senders that are clearly junk and can batch-report them as spam. This preserves the Gmail feedback loop and keeps the Operator non-destructive.

### 4.5 v1 Cost Expectations

In v1, rules are empty. ALL bulk email hits the Classifier (100% LLM calls). The system works correctly but at maximum cost. The Strategist's primary v1 value is reducing LLM cost by promoting obvious patterns to rules.

Expected timeline:
- **Week 1-2:** ~30 Classifier calls per 5-minute run. Observation data accumulates.
- **Week 3+:** Manual Strategist (human with Gemini prompt) reviews observation log, promotes high-frequency senders to rules. Each promotion permanently reduces LLM calls.
- **v2:** Automated Strategist does this continuously.

If the Strategist never runs, the system still works — just at higher cost. This is by design: the Operator is self-sufficient, the Strategist is an optimization.

---

## 5. Data Handling and Privacy

The Strategist consumes the Operator's observation store, which contains email sender addresses, subject lines (when `logSubject` is enabled), and classification metadata. This is sensitive personal data.

### Guidelines for Manual Strategist (v1)

**When pasting observation data into AI for analysis:**
- **Use the Gemini API (paid tier)** — Google's paid API terms state inputs are not used for training
- **Do NOT paste into consumer AI chat interfaces** (Gemini web, ChatGPT, Claude chat) — these may have different data-use terms, and non-Google tools send data outside Google's ecosystem (violating Operator NFR-202)
- **Export only the columns you need.** For sender frequency analysis: `sender` + `label` columns only, no subjects. For classification review: include `subject` temporarily
- **Delete exported data after analysis.** Don't leave observation data in AI chat histories, clipboard, or temp files

### Automated Strategist (v2 — future)

When the Strategist is automated, it should:
- Access the observation store via the Sheets API (same security boundary as the Operator)
- Send only aggregated/anonymized data to any LLM (sender domains, not full addresses; category counts, not subject lines)
- Never export raw observation data outside the Google ecosystem

See also [Operator brainstorm §20 P4](../operator/brainstorm.md) for the privacy analysis of the Strategist workflow.

# Phase 6 — Utilities & Go-Live

> **Status:** Not started
> **Author:** Karsten Huttelmaier — co-authored with Claude
> **Depends on:** Phase 5 (full pipeline operational)
> **Produces:** `undoSince`, `mergeLabels`, acceptance test results, production deployment
> **Source spec:** [requirements.md](requirements.md) FR-711, FR-501–503, FR-500, §9

---

## Goal

Build the standalone utility functions, run acceptance tests against the complete system, validate with dry-run, and deploy to production. This phase transitions the Operator from "code complete" to "running in production."

## Requirements Covered

### Utility Functions

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-711 | `undoSince(timestamp)` | Remove Operator-managed labels, un-archive threads modified after timestamp. Manual recovery helper — run from Apps Script editor. |
| FR-501 | `mergeLabels(source, target)` resumable | Batch-process threads from source label to target. Resume via ScriptProperties if execution limit hit. |
| FR-502 | Deprecated label migration | Owner uses `mergeLabels` to remap old labels before/after launch |
| FR-503 | Deprecated label deletion | Delete label only after confirming zero remaining threads |

### Backfill Verification

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-500 | Inbox backfill uses same pipeline | Cleanup Mode processes existing backlog automatically — no separate code path |

### Acceptance Testing (§9)

All 19 acceptance criteria from requirements.md §9, grouped:

**Routing Engine (AC #1–5)**
- Header Screener zero false positives on 50+ threads
- Every taxonomy category matched at least once
- Unknown sender classified correctly
- INBOX rules keep 2FA/security alerts in inbox
- Concurrent use safety

**Startup and Configuration (AC #6–7)**
- Startup validation failure modes (empty taxonomy, missing key, etc.)
- Label auto-creation

**Backfill and Migration (AC #8–10)**
- Inbox backfill completes (Cleanup → Maintenance transition)
- `mergeLabels` executes correctly
- Deprecated labels deleted

**Resilience (AC #11–14)**
- Downtime recovery (300+ thread backlog)
- 72-hour soak test (production readiness gate)
- LLM failure degradation
- Graceful exit under time pressure

**Observation and Interface (AC #15–19)**
- Observation schema matches spec
- Dry-run mode works correctly
- `_keep` label recognized
- `undoSince` recovery works
- *(v1.1)* Alert email after 3+ consecutive failures

## Go-Live Sequence

1. **Dry-run deployment** — `dryRun: true` in Config.js. Trigger runs every 5 min. LLM is called, observations are logged, but Gmail is not modified.
2. **Observation review** — Check routing_log for misclassifications. Tune taxonomy descriptions or add INBOX rules as needed.
3. **Flip to live** — Set `dryRun: false`. Operator begins labeling and archiving.
4. **Soak test** — 72 hours with zero unhandled Stackdriver errors (AC #12).
5. **Label migration** — Run `mergeLabels` for any deprecated labels. Delete after zero-thread confirmation.

## Acceptance Criteria

- [ ] `undoSince` removes Operator labels and un-archives threads correctly (AC #18)
- [ ] `mergeLabels` moves all threads, source label has zero threads after (AC #9)
- [ ] `mergeLabels` resumes correctly if execution limit is hit mid-batch
- [ ] Deprecated labels deleted after zero-thread confirmation (AC #10)
- [ ] All 19 acceptance criteria from §9 verified
- [ ] 72-hour soak test passes (AC #12)

---

## Implementation Notes

### GCP Setup for Advanced Protection

> ⚠️ **This procedure is insufficient for APP-enrolled accounts.** APP blocks third-party apps requesting restricted scopes (`gmail.modify`, `mail.google.com`, etc.) regardless of GCP configuration. The steps below cover the necessary GCP project linking but do not bypass APP's scope restrictions. See [app-blocker.md](app-blocker.md) for the full investigation and remaining options.

Google's Advanced Protection Program blocks Apps Script from accessing Gmail unless the script is linked to a user-managed GCP project with proper OAuth configuration. Steps:

- [ ] **Create GCP project** — [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate), name: `inbox-shepherd`. Note the Project Number (12-digit).
- [ ] **Enable APIs** — In the GCP project, APIs & Services > Library. Enable **Apps Script API** and **Gmail API**.
- [ ] **Configure OAuth consent screen** — APIs & Services > OAuth consent screen. Select External. Fill in app name (`inbox-shepherd`) and developer contact email. Skip scopes. **Add yourself as a Test User** (critical for APP accounts). Save.
- [ ] **Link GCP project to Apps Script** — Copy Project Number from GCP Settings. In Apps Script editor: Project Settings > Google Cloud Platform (GCP) Project > Change project. Paste number, confirm.
- [ ] **Authorize** — Run `processInbox` or `installTrigger` from the Apps Script editor. Accept the OAuth consent prompt (will show "unverified app" warning — expected for self-hosted scripts).

References:
- [Navigating AppScript Restrictions in APP](https://medium.com/google-cloud/navigating-appscript-restrictions-in-googles-advanced-protection-program-32e201dc98c8)
- [Linking GCP to Apps Script](https://tanaikech.github.io/2019/07/05/linking-cloud-platform-project-to-google-apps-script-project/)

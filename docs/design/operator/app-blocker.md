# Deployment Blocker: Advanced Protection Program (APP)

> **Status:** Blocked — no viable workaround found for personal Gmail accounts enrolled in APP.
> **First investigated:** 2026-03-10
> **Last updated:** 2026-04-18
> **Author:** Karsten Huttelmaier — co-authored with Claude
> **Project:** inbox-shepherd (Google Apps Script + Gemini 2.0 Flash)

---

## TL;DR

inbox-shepherd needs restricted OAuth scopes (`gmail.modify` and friends) to read message bodies, apply labels, and archive threads. Google's Advanced Protection Program (APP) blocks all third-party access to restricted scopes for personal `@gmail.com` accounts — regardless of GCP project setup, OAuth consent screen configuration, or test-user status. There is no "self-authored app" or developer exemption. The paths that could unblock the target account are:

1. Run against a Gmail account not enrolled in APP (easiest; pipeline unchanged).
2. Migrate the mailbox to a Google Workspace domain with admin whitelisting.
3. Disable APP on the current account.
4. Wait for Google to add a granular label-modification scope (no timeline).

The investigation below documents what was tried and why other approaches don't work.

---

## 1. What we're trying to deploy

inbox-shepherd is a Gmail automation that sorts email. It runs on Google Apps Script (V8), deployed via [clasp](https://github.com/google/clasp), triggered every 5 minutes. The system processes the inbox through a three-tier pipeline:

1. **Header Screener (Tier 1):** Checks for bulk-mail headers (List-Unsubscribe, Precedence, etc.). No bulk headers → personal email → stays in inbox.
2. **Static Rules (Tier 2):** Deterministic sender-to-label mappings. Also catches urgent automated email (2FA codes, security alerts) and keeps it in inbox despite bulk headers.
3. **LLM Classifier (Tier 3):** Handles unknown senders. Gemini 2.0 Flash classifies into a configurable taxonomy (10 categories). This is what Gmail filters can't do — it handles senders the system has never seen.

**Actions on each thread:** add a label, mark read, archive. Every routing decision is logged to a Google Sheets observation store.

All code is complete (Phases 1–5). Phase 6 is deployment. Deployment is blocked.

## 2. The blocker

The Gmail account running inbox-shepherd has [Google's Advanced Protection Program (APP)](https://landing.google.com/advancedprotection/) enabled. APP is Google's highest security tier — it protects accounts from phishing and unauthorized access by blocking third-party apps from accessing sensitive account data.

Specifically, APP blocks any app that requests **restricted** OAuth scopes. When we try to authorize inbox-shepherd in the Apps Script editor, we get:

```
Access blocked: inbox-shepherd is not approved by Advanced Protection
```

Followed by:

```
Error 400: policy_enforced
```

The app never reaches the OAuth consent screen. APP rejects it at the gate.

## 3. What was tried (chronological)

### 3a. Initial deployment attempt

Ran `clasp push`, opened Apps Script editor, selected `processInbox()`, clicked Run.

**Result:** "Access blocked: inbox-shepherd is not approved by Advanced Protection"

### 3b. GCP project setup

Following the approach in [this Medium article](https://medium.com/google-cloud/navigating-appscript-restrictions-in-googles-advanced-protection-program-32e201dc98c8), we:

1. Created a GCP project named `inbox-shepherd`
2. Enabled Gmail API and Apps Script API in GCP console
3. Configured OAuth consent screen: External type, app name "inbox-shepherd"
4. Added owner email as Test User under Audience
5. Linked GCP project to Apps Script via Project Number (Project Settings → Change project)

**Result:** Same "Access blocked" error. The GCP setup is necessary but not sufficient.

### 3c. Added OAuth scopes to consent screen

The OAuth consent screen initially had no scopes declared. We added:

- `https://mail.google.com/` (full Gmail access)
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/script.external_request`

**Result:** Same error. The scopes appeared correctly in the consent screen configuration (sensitive and restricted sections), but APP still blocked authorization.

### 3d. Tried revoking app permissions

Checked Google account → Security → Third-party apps with account access. inbox-shepherd was not listed — it had never successfully authorized, so there was nothing to revoke.

### 3e. Root cause identified

`mail.google.com` is a **restricted** scope. APP blocks all restricted scopes for third-party apps, regardless of GCP project configuration, OAuth consent screen setup, or test user status.

The Medium article's solution worked because their use case (a Google Sheets script with a trigger) only needed `script.scriptapp` — a **sensitive** scope. APP allows sensitive scopes. Their approach never involved Gmail content access.

### 3f. Scope-narrowing hypothesis

We hypothesized that replacing `mail.google.com` with `gmail.modify` would work, assuming `gmail.modify` was a sensitive scope. The plan:

- Stop using `GmailMessage` methods (`getFrom()`, `getRawContent()`, `getBody()`) which force `mail.google.com`
- Use the Gmail Advanced Service (`Gmail.Users.Messages.get()`) instead, which respects declared scopes
- Declare only `gmail.modify` in `appsscript.json`

We built a comprehensive test plan: a stripped-down Apps Script project with only a test function (no production code that would trigger static scope analysis), exercising all 38 API operations the system uses across 4 scopes.

**Why stripped-down:** Apps Script determines required scopes by statically analyzing ALL functions in the project, not just the one being executed. Having `getRawContent()` anywhere in the codebase forces `mail.google.com` regardless of which function you run.

### 3g. Scope tier discovery

When updating the GCP OAuth consent screen to use `gmail.modify` instead of `mail.google.com`, we discovered that **`gmail.modify` is also classified as restricted**, not sensitive. The entire hypothesis was based on an incorrect assumption.

### 3h. Filter-only architecture explored

We explored replacing direct thread mutations with Gmail filter creation via `gmail.settings.basic`:

- Create filters that auto-label, archive, and mark-read matching senders
- Filters would handle future mail; first email from each sender stays in inbox

**Two problems killed this approach:**

1. The Gmail API's `users.settings.filters.create` has **no equivalent** of the UI's "Also apply filter to matching conversations" checkbox. Filters are forward-only via the API. Retroactive application in the UI is actually a batch modification under the hood, which requires `gmail.modify`.

2. `gmail.settings.basic` is itself **restricted**. Even this degraded approach requires a restricted scope.

### 3i. gmail.metadata scope investigated

`gmail.metadata` allows reading message headers and label IDs but not message body. Initial research suggested it might be **sensitive** (not restricted), which would have been significant. However, further verification indicates it is likely **restricted** — conflicting sources exist, and the classification was not confirmed on the GCP OAuth consent screen.

Even if `gmail.metadata` were sensitive, it has additional limitations:
- The `q` search parameter is **prohibited** — `GmailApp.search('is:inbox')` equivalent doesn't work. Can only filter by `labelIds` (e.g., INBOX label).
- Cannot read message body — the Classifier (Tier 3) needs a ~100-char body snippet for classification.
- Cannot modify threads — label, archive, mark read all require `gmail.modify` (restricted).

**Status:** Does not solve the problem regardless of classification. Even if metadata reading worked under APP, the system cannot act on what it reads.

### 3j. Other alternatives explored

| Alternative | Why it doesn't work |
|-------------|-------------------|
| Chrome extension | Can't run on a 5-minute background timer. Would still need Gmail API for programmatic access (same scope problem). |
| IMAP | APP blocks "less secure apps." IMAP via OAuth still requires restricted scopes. |
| Zapier / IFTTT / Make.com | Same OAuth restricted scope problem — APP blocks their Gmail authorization too. |
| Local script / VPS | Same OAuth scope issue regardless of where the client runs. |
| Service account + domain-wide delegation | Requires Google Workspace. Not available for personal Gmail. |
| Google Workspace account | Workspace admins CAN whitelist apps with restricted scopes. But admin control only applies to accounts within that Workspace domain. Personal Gmail can't be managed by a Workspace admin. |
| App verification by Google | Requires privacy policy, domain verification, and CASA security assessment (~$4,500–$15,000+). Designed for apps distributed to many users. Completely disproportionate for a single-user personal tool. |
| Temporarily disable APP to authorize, then re-enable | APP likely revokes all third-party tokens on re-enrollment, invalidating the authorization. (Not verified — based on user's understanding of APP behavior. Worth confirming before ruling out.) |

## 4. Gmail API scope classifications

Source: [Gmail API OAuth Scopes documentation](https://developers.google.com/gmail/api/auth/scopes)

| Scope | Tier | Description |
|-------|------|-------------|
| `gmail.labels` | **Non-sensitive** | Create, read, update, and delete labels only |
| `gmail.readonly` | **Restricted** | Read all messages, threads, and settings |
| `gmail.metadata` | **Disputed** | Read message metadata (headers, to/from) but not body. Conflicting sources on tier — may be sensitive or restricted. Not verified on GCP consent screen. |
| `gmail.settings.basic` | **Restricted** | Manage filters and settings |
| `gmail.settings.sharing` | **Restricted** | Manage sharing settings (forwarding, aliases) |
| `gmail.compose` | **Restricted** | Create drafts and send email |
| `gmail.send` | **Restricted** | Send email only |
| `gmail.insert` | **Restricted** | Insert mail into mailbox |
| `gmail.modify` | **Restricted** | Read, compose, send, label, archive (not delete) |
| `mail.google.com` | **Restricted** | Full access including permanent deletion |

**Key insight:** The only non-sensitive Gmail scope is `gmail.labels` (label object CRUD only). `gmail.metadata` has disputed classification (see §3i) but doesn't solve the problem regardless. Every scope that reads message body content or modifies messages/threads is definitively restricted.

## 5. What inbox-shepherd actually needs

| Operation | Used in | API endpoint | Minimum scope | Tier |
|-----------|---------|-------------|--------------|------|
| Search inbox | `Utils.gs` `getInboxThreads()` | `users.threads.list` | `gmail.readonly`* | **Restricted** |
| Read message headers | `Utils.gs` `getHeader()` | `users.messages.get` | `gmail.readonly`* | **Restricted** |
| Read message body | `Annotations.gs` snippet extraction | `users.messages.get` | `gmail.readonly` | **Restricted** |
| Read sender address | `HeaderScreener.gs`, `Annotations.gs` | `users.messages.get` | `gmail.readonly` | **Restricted** |
| Add label to thread | `Main.gs` apply classification | `users.threads.modify` | `gmail.modify` | **Restricted** |
| Remove label from thread | `Main.gs`; Phase 6 `undoSince` | `users.threads.modify` | `gmail.modify` | **Restricted** |
| Mark thread read | `Main.gs` post-classification | `users.threads.modify` | `gmail.modify` | **Restricted** |
| Archive thread | `Main.gs` post-classification | `users.threads.modify` | `gmail.modify` | **Restricted** |
| Move to inbox | Phase 6 `undoSince` | `users.threads.modify` | `gmail.modify` | **Restricted** |
| Create label object | `LabelManager.gs` `ensureLabels()` | `users.labels.create` | `gmail.labels` | Non-sensitive |
| Delete label object | Phase 6 `mergeLabels` | `users.labels.delete` | `gmail.labels` | Non-sensitive |
| Call Gemini API | `Classifier.gs` | `UrlFetchApp.fetch()` | `script.external_request` | Sensitive |
| Write to Sheets | `ObservationStore.gs` | `SpreadsheetApp` | `spreadsheets` | Sensitive |
| Create trigger | `Main.gs` `installTrigger()` | `ScriptApp` | `script.scriptapp` | Sensitive |

*`gmail.metadata` may also work for listing threads by label and reading headers, but its tier is disputed and it prohibits `q` search queries. See §3i.

Every core operation except label object management and non-Gmail services requires a restricted scope.

## 6. Why the Medium article doesn't apply

**Article:** [Navigating AppScript Restrictions in Google's Advanced Protection Program](https://medium.com/google-cloud/navigating-appscript-restrictions-in-googles-advanced-protection-program-32e201dc98c8)
**Author:** Lucas Nogueira · **Date:** Jul 6, 2025

**Their use case:** A Google Sheets script that copies a value from Sheet1 to Sheet2, with a daily time-driven trigger. No Gmail access.

**Their solution:**
1. For simple scripts: `@OnlyCurrentDoc` annotation limits scope to the current document (no OAuth prompt needed)
2. For scripts with triggers: Create a GCP project, link it to Apps Script, configure OAuth consent screen, add yourself as test user

**Their only scope:** `script.scriptapp` — classified as **sensitive**. APP allows sensitive scopes through the GCP project + OAuth consent screen flow.

**Why it doesn't apply:** inbox-shepherd needs Gmail access (reading, labeling, archiving), which requires restricted scopes. The article's GCP setup is correct and necessary — we followed the same steps — but APP blocks at the restricted scope tier regardless. The article never encountered this because Sheets access doesn't require restricted scopes.

**What WAS useful:** Confirmed that the GCP project linking approach works for the authorization flow itself. The blocker is the scope classification, not the setup procedure.

## 7. Open Google feature requests

- **[Issue Tracker #121099045](https://issuetracker.google.com/issues/121099045):** Feature request for a granular scope that allows adding/removing labels on messages without the broad `gmail.modify` scope. No official Google response as of this writing.
- **[Developer Forum thread](https://discuss.google.dev/t/the-scope-gmail-modify-does-not-seem-to-apply-to-labels/249108):** Developer confusion about scope requirements for label operations. No resolution.

If Google introduced a sensitive-tier scope for thread label mutations, inbox-shepherd could potentially work under APP. No indication this is planned.

## 8. Alternative architectures considered (not actively pursued)

After the OAuth path was exhausted, we considered non-OAuth architectures that would bypass restricted scopes or shift execution outside the APP boundary. These have not been built or tested. Captured here for future reference in case any become worth pursuing.

### Vector A — Web-session bypass

A private Chrome Extension or headless local daemon (e.g. Playwright) that piggybacks on the active, authenticated `mail.google.com` web session cookie to read and mutate the inbox without OAuth.

- **Fragility:** cookie-based access is brittle and can break on Google's next session-management change.
- **Not portable:** requires the user's browser to be active and logged in.
- **Terms of Service risk:** Gmail's ToS may prohibit scripted access to the web UI.

### Vector B — Forwarding enclave

The APP-enrolled primary account natively forwards Tier 3 (unknown-sender) mail to a non-APP "compute" burner account. The burner runs the Apps Script + LLM, then forwards results back to the primary account using plus-addressing (e.g. `user+category@gmail.com`) for native sorting.

- **Observation store lives on the burner** — routing decisions aren't on the primary account.
- **Multi-hop latency:** mail transits primary → burner → primary before landing.
- **Loopback risk:** forwarding rules need careful scoping to avoid loops.
- **Labels on primary must be created by native filters**, not the script.

### Vector C — Async control plane

The APP-enrolled primary account natively lumps unknown senders into a "Triage" label. A manual export feeds sender data to the Apps Script, which classifies domains via LLM and generates a `mailFilters.xml` file for periodic manual import into Gmail.

- **Not a 5-minute loop** — batch-style, cadence is whatever the human chooses.
- **Loses Tier 3 classification of one-off messages** — filters are sender-based, not content-based.
- **Requires manual export/import** — meaningful operational friction.

## 9. Remaining options to unblock

| # | Option | APP stays on? | Full functionality? | Cost | Trade-off |
|---|--------|:---:|:---:|------|-----------|
| 1 | Run on a non-APP Gmail account | n/a | Yes | Free | Requires a personal Gmail account not enrolled in APP. Pipeline code and scopes unchanged. Easiest path. |
| 2 | Disable APP on the current account | No | Yes | Free | Reduced account security. Can re-enable later but would need to re-authorize; APP likely revokes third-party tokens on re-enrollment. |
| 3 | Move email to Workspace account | Yes | Yes | ~$7-10/mo (if not already covered) | Major workflow migration. Workspace admin can whitelist the app for Workspace accounts only. |
| 4 | Wait for Google | Yes | No | Free | No timeline. Feature request #121099045 has no Google response. |

## 10. The fundamental conflict

APP exists to block third-party apps from accessing your Gmail. inbox-shepherd is technically a third-party app that needs to access your Gmail. These goals are in direct opposition.

Google's scope model offers no middle ground for self-authored personal automation: the granularity jumps from "manage label objects" (non-sensitive) to "read all email" (restricted) with nothing in between. There is no "modify only labels on threads" scope, no "archive only" scope, no "self-authored app" exemption.

The system is designed for two cases: Google's own apps (always allowed) and third-party apps distributed to many users (can get verified). A single developer automating their own inbox falls outside both.

## References

- [Gmail API OAuth Scopes](https://developers.google.com/gmail/api/auth/scopes)
- [Gmail API Filters Guide](https://developers.google.com/workspace/gmail/api/guides/filter_settings)
- [Gmail API messages.modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify)
- [Gmail API messages.batchModify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify)
- [Gmail API filters.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.filters/create)
- [Gmail API Labels Guide](https://developers.google.com/workspace/gmail/api/guides/labels)
- [Medium: Navigating AppScript Restrictions in APP](https://medium.com/google-cloud/navigating-appscript-restrictions-in-googles-advanced-protection-program-32e201dc98c8)
- [Linking GCP to Apps Script](https://tanaikech.github.io/2019/07/05/linking-cloud-platform-project-to-google-apps-script-project/)
- [Google Issue Tracker #121099045 — Granular label scope request](https://issuetracker.google.com/issues/121099045)
- [Developer Forum: gmail.modify and labels](https://discuss.google.dev/t/the-scope-gmail-modify-does-not-seem-to-apply-to-labels/249108)

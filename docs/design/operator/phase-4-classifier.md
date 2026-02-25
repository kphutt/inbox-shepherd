# Phase 4 — Tier 3 (Classifier)

> **Status:** Implemented
> **Depends on:** Phase 2 (body extraction, sender resolution)
> **Produces:** `Classifier.gs`, `Annotations.gs`
> **Source spec:** [requirements.md](requirements.md) FR-300–307, IF-105, Open Q #9
> **Can overlap with:** Phase 3 (tiers are independently testable)

---

## Goal

Build the LLM classification tier — the part that handles unknown senders. This includes the Gemini API integration, prompt assembly with annotations, response parsing, and error handling. After Phase 4, all three tiers exist and can be wired into the pipeline (Phase 5).

## Requirements Covered

### Classifier

| ID | Requirement | Summary |
|----|-------------|---------|
| FR-300 | Classifier prompt format | Annotated email display with dynamic taxonomy categories. Pseudocode in requirements.md §7.4. |
| FR-301 | Return exactly one label from active taxonomy | Dynamically constructed from Config.js, not hardcoded |
| FR-302 | Confidence output | Parse `CATEGORY\|CONFIDENCE` (high/medium/low). Missing confidence defaults to `low`. |
| FR-304 | Invalid response → `_review` fallback | Thread stays in inbox (not archived) |
| FR-305 | Fuzzy single-label extraction | Case-insensitive, strip whitespace, handle preamble text |
| FR-306 | LLM model configurable | Via `Config.js` `llm.model` |
| FR-307 | Error handling: API errors vs. malformed responses | 429/500/timeout → skip thread. Valid API + invalid label → `_review`. Distinct failure modes. |
| IF-105 | Taxonomy dynamically derived from config | Prompt categories built from `CONFIG.taxonomy` keys and descriptions |

### Annotations

| Annotation | Source | Example |
|---|---|---|
| `[via Platform]` | Return-Path domain → platform lookup table | `[via SendGrid]`, `[via Mailchimp]` |
| `direct` / `CC` / `BCC/undisclosed` | To/CC header analysis | Addressing context (owner email NOT included) |
| `[noreply]` | From address pattern match | `noreply@`, `no-reply@`, `donotreply@` |

## Modules

- **`Classifier.gs`** — Core functions:
  - `classifyThread(signals, email, taxonomy, config)` — Builds prompt, calls Gemini, parses response. Returns `{ label, confidence }` or `{ error }`.
  - `buildClassifierPrompt(taxonomy, signals, email)` — Assembles prompt per FR-300 format (pseudocode in requirements.md §7.4).
  - `parseClassifierResponse(response, taxonomyKeys)` — Extracts label + confidence. Validates label against taxonomy. Returns `_review` for invalid responses.
  - `callGeminiApi(prompt, config)` — `UrlFetchApp.fetch()` to Gemini endpoint. Handles auth, timeouts, HTTP error codes.
- **`Annotations.gs`** — Signal extraction:
  - `buildAnnotations(message)` — Returns `{ platform, addressing, noreply }` object.
  - `detectPlatform(message)` — Return-Path domain → static lookup table of known ESPs.
  - `detectAddressing(message, ownerEmail)` — To/CC header analysis. Owner email never exposed.
  - `isNoreply(senderAddress)` — Pattern match for noreply/no-reply/donotreply.

## Blocking Implementation Gap

**Gemini API call from Apps Script (Open Q #9):** This is the highest-risk spike. Need to confirm:
1. Auth mechanism: API key in `x-goog-api-key` header or query param?
2. Request format: `generateContent` endpoint, model string, request body structure
3. Response parsing: extracting generated text from response JSON
4. Error codes: 429 (rate limit), 500 (server error), timeout behavior
5. `UrlFetchApp.fetch()` options: `muteHttpExceptions: true`, timeout config

This spike should happen at the start of Phase 4 — a standalone test function that sends a hardcoded prompt to Gemini and logs the response.

## Acceptance Criteria

- [ ] Classifier correctly labels an unknown automated sender (AC #3)
- [ ] Every taxonomy category matches at least one thread during testing (AC #2)
- [ ] Invalid LLM response → `_review` label, thread stays in inbox
- [ ] API error (429/500/timeout) → thread skipped, no label, no archive
- [ ] Confidence parsed correctly; missing confidence defaults to `low`
- [ ] Platform annotation detected for known ESPs (SendGrid, Mailchimp, Amazon SES, etc.)
- [ ] Addressing annotation correct for direct, CC, and BCC email
- [ ] Owner email never appears in prompt
- [ ] Prompt categories match current Config.js taxonomy (not hardcoded)

---

## Implementation Notes

### Shared refactor: Utils.gs

- `getHeader(message, headerName)` — moved from `HeaderScreener.gs` (was `getHeader_`, private). Now public in Utils.gs. Parses raw MIME headers via `getRawContent()`, caches parsed headers on the message object (`message._parsedHeaders`). Case-insensitive lookup. Handles header continuation (folded lines).
- `isNoreply(address)` — new shared function. Pattern: `/^(noreply|no-reply|donotreply)@/i`. Used by both HeaderScreener.gs (replacing inline regex) and Annotations.gs.
- HeaderScreener.gs updated: removed `getHeader_()`, replaced 6 call sites with `getHeader()`, replaced inline noreply regex with `isNoreply(parsed.address)`. No behavior change — verified by existing tests (37/37 pass).

### Annotations.gs (~100 lines)

Signal extraction for the Classifier prompt. No Google API calls except reading message headers (cached after first access).

- `buildAnnotations(message, ownerEmail)` — public orchestrator. Returns `{ platform, addressing, noreply }`. Takes ownerEmail because `detectAddressing_` needs it (deviates from spec's single-param signature).
- `detectPlatform_(message)` — extracts domain from Return-Path header, looks up against `ESP_DOMAINS_` table (13 entries). Dot-boundary check (`domain === key || domain.endsWith('.' + key)`) prevents false positives (e.g. `notamazonses.com`). Campaign Monitor special case via regex (`/^cmail\d+\.com$/`).
- `detectAddressing_(message, ownerEmail)` — reads To/Cc headers, returns `"direct"` / `"CC"` / `"BCC/undisclosed"`. Uses `containsAddress_` helper to avoid substring collision bug (e.g. `bob@gmail.com` matching `bob@gmail.company.com`).
- `containsAddress_(headerValue, targetAddress)` — splits on commas, parses each via `parseFromHeader`, exact-matches address. Handles display-name format.

### Classifier.gs (~150 lines)

LLM classification tier. Builds prompt, calls Gemini API, parses response.

- `classifyThread(annotations, email, taxonomy, config, callApiFn)` — public. 5th param optional, defaults to `callGeminiApi_`. Enables test injection. Returns `{ label, confidence }` or `{ error, errorType }`. Error types: `API_ERROR` (429/500/network — retry next run) vs `PARSE_ERROR` (safety-filtered/invalid — retrying futile).
- `parseClassifierResponse(responseText, taxonomyKeys)` — public. Parses `CATEGORY|CONFIDENCE` format. Falls back to line-by-line taxonomy key scan (no-pipe case). Strips LLM formatting artifacts (bold markers `**`, trailing periods). Case-insensitive match returns original-cased taxonomy key. Missing/invalid confidence defaults to `"low"`. Null-safe.
- `buildClassifierPrompt_(taxonomy, annotations, email)` — private. Assembles prompt per FR-300. Dynamic taxonomy categories from config. Disambiguation rules from `DISAMBIGUATION_RULES_` constant. Owner email never appears in prompt. Empty name omits angle brackets; empty subject shows `(none)`; empty snippet omits `---` separator.
- `callGeminiApi_(prompt, model, apiKey)` — private. `UrlFetchApp.fetch` to Gemini `generateContent` endpoint. API key via `x-goog-api-key` header (not URL param — prevents key leaking in error logs). `muteHttpExceptions: true`. Full error handling: network errors, HTTP errors, JSON parse errors, prompt-level blocking (`promptFeedback.blockReason`), empty responses, non-STOP finish reasons (SAFETY, RECITATION, MAX_TOKENS). `generationConfig: { temperature: 0, maxOutputTokens: 20 }`.
- `extractResponseText_(body)` — private. Defensive traversal of Gemini response JSON: `body.candidates[0].content.parts[0].text`.
- Formatting artifact stripping order: trailing period first, then bold markers — prevents `**Shopping**.` leaving a stray `*`.

### Design decisions

1. **Artifact stripping order** — `.replace(/\.$/, '')` before `.replace(/^\*+|\*+$/g, '')`. The combined artifact `**Shopping**.` requires period removal first so the trailing `**` is at end-of-string for the star regex.
2. **`config` parameter shape** — `{ llm: { model }, apiKey }` assembled by Main.gs (Phase 5). API key read once from ScriptProperties at run start, not per-call.
3. **Error type distinction** — `API_ERROR` (status !== 200) signals transient failure (retry next run). `PARSE_ERROR` (status 200 but bad content) signals permanent failure (don't retry).

### Files created

| File | Lines | Purpose |
|------|------:|---------|
| `src/Annotations.gs` | 112 | Signal extraction: platform, addressing, noreply |
| `src/Classifier.gs` | 260 | LLM classification: prompt, API, parsing |
| `tests/annotations.test.mjs` | 234 | 30 tests for Annotations + shared Utils |
| `tests/classifier.test.mjs` | 234 | 32 tests for Classifier |

### Test results

99 tests total (37 existing + 30 annotations + 32 classifier), all passing.

# Phase 4 — Tier 3 (Classifier)

> **Status:** Not started
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

*(To be filled during implementation planning)*

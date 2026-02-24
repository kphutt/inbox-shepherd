# Gemini Email Analysis Prompt

Copy everything below the line into Gemini.

---

I'm building an automated email triage system called "Inbox Shepherd" that runs in Gmail via Google Apps Script. It processes my inbox and automatically labels + archives automated/bulk email so my inbox only has mail that needs my personal attention.

The system has a four-tier pipeline:

1. **Allowlist** — known human senders → stay in inbox, untouched
2. **Header Screener** — emails missing bulk-mail headers → stay in inbox (probably human)
3. **Rules** — static sender-to-category mappings → apply label + archive
4. **Classifier** — LLM classifies everything else → apply label + archive

I need your help bootstrapping this system by analyzing my actual email history. I need three deliverables: an **allowlist**, a **category taxonomy**, and a **sender-to-category rule list**.

## Task 1: Propose a Category Taxonomy

Scan my email history — go back as far as you can. Look at the **automated/bulk email** — newsletters, marketing, transactional notifications, receipts, alerts, school communications, subscription services, etc.

Based on what you actually find in my email, propose **8-15 categories**. For each:

- **Name**: Short. One or two words.
- **Description**: One sentence. Specific enough to resolve ambiguity with neighboring categories. Think of this as the instruction you'd give a human assistant sorting your mail.

**Guidelines for good categories:**
- Meaningful volume (not just a handful of emails ever)
- Clear boundaries with other categories
- Obvious enough that I'd know where to look
- Covers a coherent topic, not a grab-bag

**Specifically flag:**
- Any categories where the boundary is fuzzy (e.g., "Is an Amazon receipt Shopping or Financial?")
- Any senders that don't fit neatly into one category
- Any category that might be too broad or too narrow

**Important edge cases to consider:**
- Financial vs Shopping: where do receipts go? Bank marketing emails?
- Newsletters vs topical categories: does a finance newsletter go in Financial or Newsletters?
- Kid/school/family activities: one bucket or split by subcategory?
- Account security alerts, password resets, 2FA codes — their own category or lumped in?

## Task 2: Propose Sender Rules (Tier 3)

For each automated sender you find, propose a mapping:

```
sender pattern → category
```

**Pattern format — use the most specific pattern that's correct:**
- Full address when only one address from a domain matters: `rewards@chase.com → Financial`
- Whole domain when everything from that domain is one category: `*@schooldistrict.org → Kids`
- Subdomain when a company uses subdomains for different purposes: `*@notifications.amazon.com → Shopping` vs `*@marketing.amazon.com → Newsletters`

**Critical rule: only propose a mapping if the sender is CONSISTENT.** Every email from that sender must fit one category. If a sender sends mixed types, do NOT create a rule — flag it as "mixed" instead. Mixed senders will be handled by the LLM classifier at runtime.

**Sort by estimated volume** — highest-volume senders first. This tells me where the biggest efficiency gains are.

## Task 3: Propose an Allowlist (Tier 1)

Identify senders who are clearly **real humans who email me personally** — friends, family, colleagues, professionals I interact with directly (doctors, accountants, teachers writing to me specifically, etc.).

**Include:**
- People I've exchanged personal/conversational email with
- Professional contacts who email me directly (not via automated systems)

**Exclude:**
- Automated senders even if they're "from" a person (e.g., calendar invites, CRM systems)
- Mailing lists or group addresses
- Noreply addresses

**Format:** List email addresses grouped by relationship if you can tell (family, friends, work, professional services).

## Task 4: Coverage Report

After building all three lists, give me:

### Rules Coverage
- Estimated % of my automated email that rules would cover
- Top 10 highest-volume rules (biggest efficiency wins)
- What's left for the LLM classifier to handle?

### Mixed Senders (no rule possible)
| Sender | Types of email observed | Suggested handling |
|--------|----------------------|-------------------|

### Allowlist Coverage
- Roughly how many unique human senders did you find?
- Any senders you're uncertain about (could be human or automated)?

### Gaps & Questions
- Categories you considered but rejected (and why)
- Senders that didn't fit any category
- Anything surprising in my email patterns
- Questions for me before finalizing

## Output Format

Use tables for each section. For Rules, include:

| Sender Pattern | Category | Confidence (high/med) | Est. Monthly Volume | Notes |
|---------------|----------|----------------------|--------------------|----|

For Taxonomy:

| Category | Description | Est. % of Automated Email |
|----------|-------------|--------------------------|

For Allowlist:

| Email Address | Relationship/Context |
|--------------|---------------------|

End with a summary: "With this taxonomy and rule set, approximately X% of your automated email would be handled by static rules (no LLM needed). The remaining Y% would require per-email LLM classification."

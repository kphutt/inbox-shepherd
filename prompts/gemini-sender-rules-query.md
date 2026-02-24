# Gemini Query: Build My Sender Rules

Copy everything below the line into Gemini.

---

I need you to do a deep scan of my entire Gmail history and build a sender-to-category mapping for my email triage system. This is the most important deliverable so please be thorough.

**Important constraints:**
- **Limit your response to the top 75 senders by volume.** If there are more, tell me the total count and I'll ask for the next batch.
- **List each sender exactly once.** Do not repeat entries or revisit categories you've already covered.
- **Use a single table for all consistent senders.** Do not organize by category — just one flat table sorted by count.

Here are my 10 categories:

- **Scouting**: Troop, OA, scouting org, Google Groups for scouts
- **Kids**: School district, extracurriculars (track, cross country, karate, chess academy, climbing, ski school)
- **Financial**: Banking, statements, insurance, bills, subscription billing
- **Shopping**: Order confirmations, shipping notifications, receipts for physical or digital purchases
- **Marketing**: Promotional offers, sales announcements, brand advertisements, retail campaigns
- **Newsletters**: Subscribed editorial content, blogs, digests, industry reading
- **Career**: Job alerts, recruiter platforms, interview scheduling, professional networking notifications
- **Government**: Government agencies, civic notifications, official government correspondence
- **Travel**: Airline itineraries, hotel confirmations, trip updates, resort bookings, rental cars
- **Security**: 2FA codes, password resets, login alerts, unusual activity warnings

## What I need

Go through every sender in my email. For each sender domain or address that has sent me more than 5 emails total, I need:

1. **Sender pattern** — use the most specific pattern that's correct:
   - `*@domain.com` if everything from that domain is one type
   - `specific-address@domain.com` if only that address is consistent but the domain is mixed
   - `*@subdomain.domain.com` if a company uses subdomains for different purposes

2. **Category** — one of the 10 above

3. **Confidence** — high (every email fits) or medium (most fit, occasional outlier)

4. **Approximate count** — how many emails total from this sender

5. **Notes** — anything I should know, especially if there's an edge case

## Rules for what makes a valid mapping

- **Only include senders that are CONSISTENT.** If a sender mixes types, put them in the Mixed Senders section instead.
- **Be aggressive on coverage.** I want every sender you can find, even low-volume ones. 
- **Watch for these known mixed senders** — do NOT make rules for these, put them in Mixed:
  - linkedin.com (jobs + DMs + billing)
  - airbnb.com (host messages + marketing + receipts)
  - paypal.com (transactions + marketing)
  - amazon.com (orders + marketing + Kindle + AWS)

## Output

### Consistent Senders (safe for rules)
| Sender Pattern | Category | Confidence | Est. Count | Notes |
|---------------|----------|------------|-----------|-------|

Sort by count, highest first.

### Mixed Senders (need LLM classification)
| Sender/Domain | Types of email observed | Which categories apply |
|--------------|----------------------|----------------------|

### Uncategorized
Any senders that don't fit the 10 categories. What are they? Should I add a category?

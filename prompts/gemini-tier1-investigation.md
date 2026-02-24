# Gemini Query: Is Tier 1 (Allowlist) Necessary?

We're considering removing the allowlist tier from Inbox Shepherd. The hypothesis is that the Header Screener (Tier 2) catches all real person-to-person email, making the allowlist redundant. This query tests that hypothesis.

Copy everything below the line into Gemini.

---

I need you to investigate a specific pattern in my email history. Go back as far as you can.

## What I'm looking for

Find emails where ALL of these are true simultaneously:

1. **The From: address belongs to a real person I know** — not a system, not a noreply, not a notification service. A real human's actual email address in the From: header.
2. **The email looks like bulk/automated mail** — it came through a mailing list, Google Group, school distribution system, corporate email blast, or any other system that would typically add headers like `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, or similar bulk-mail indicators.

In other words: a real person's real email address, but the email was sent through infrastructure that makes it look automated.

## Examples of what I mean

- A scout leader sends a message through a Google Group — From: is their personal address, but Google Groups adds `List-Id` and `List-Unsubscribe`
- A teacher sends a class-wide email through the school district's mail system — From: is the teacher, but the system injects bulk headers
- A colleague sends through a corporate mailing list that preserves their From: address

## Examples of what I do NOT mean

- `notification@facebookmail.com` — that's the system as sender, not a person
- `noreply@scoutbook.scouting.org` — system sender
- A marketing email from a company — not a person
- A direct personal email from someone (no bulk headers) — that's handled fine without an allowlist

## What I need from you

1. **Find concrete examples** of this pattern in my email. Give me the From: address, the subject, and what system/list it came through.
2. **Estimate the volume.** How many emails per week/month fit this pattern?
3. **For each example, tell me:** Would I want this in my inbox, or would I prefer it filed into a category (Scouting, Kids, etc.)?
4. **Google Groups specifically:** Which Google Groups am I on where the sender's real address is preserved in From:? How much volume do they generate?

I'm trying to determine whether an allowlist of known contacts adds any value over simply checking for bulk mail headers. If the answer is "this pattern barely exists" or "when it exists, I'd want it categorized anyway," then the allowlist is unnecessary.

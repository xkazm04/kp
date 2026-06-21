---
name: offer-onboarding
promotion: discovery
surfaces: [Offers & Onboarding, /offer/[token], /onboarding/[token], sub_pipeline/CandidateDrawer]
characters: [petra-recruiter, tomas-hiring-manager, tereza-candidate]
language: both
---

# Offer → onboarding — generate, send, finalize, hand off

## Goal (in the user's words)
- **Petra (cs):** "Draft the offer with the right comp, send a clean tokenized link, and watch it
  move to accepted — without re-keying anything."
- **Tomáš (cs):** "I approve the number and the role; I don't want to chase paperwork."
- **Tereza (cs):** "I accept the offer and immediately know my actual next step — not 'our People
  team will be in touch' and then silence."

## Definition of done (user POV)
- Accept on `/offer/[token]` lands on a **concrete onboarding next-step** (the pre-boarding
  questionnaire at `/onboarding/[token]`), not a dead-end thank-you.
- The candidate's answers flow back to the recruiter's hand-off surface; the entry goes Hired.
- Decline is deliberate (confirm step) and terminal; an expired offer reads as expired, not a retry loop.

## Entry state / preconditions
- **Tereza:** a minted **offer token** for an entry in the offer stage (`env.md` fixture #5). The accept
  must mint the **onboarding token** for `/onboarding/[token]` — verify that chain exists, else her second
  leg is `unreachable`.
- **Petra/Tomáš:** dev gate on; seeded pipeline with a candidate ready for offer; offer policy satisfied.

## What L1 must check (structural, code-grounded)
- **Reachability:** Tereza reaches ONLY `/offer/[token]` then `/onboarding/[token]` — both resolve by token and
  `notFound()`/`invalidLink` otherwise (`app/offer/[token]/page.tsx:64-66,141-145`; `app/onboarding/[token]/page.tsx:54-57,100-104`).
  She never sees the Onboarding tab. Confirm both token fixtures.
- **The dead-end fix (the crux):** `/onboarding/[token]` exists as the concrete next step
  (`app/onboarding/[token]/page.tsx:30-33` comment + the questionnaire fields `:21-28`). Verify accept actually
  routes/links here and that the accepted card points to onboarding (`offer/[token]/page.tsx:194-200`) — if accept just
  says "we'll be in touch" with no link, that's the `missing` next-step finding the journey targets.
- **Grounding audit:** the offer card shows company/role/salary/currency/deadline from the entry
  (`offer/[token]/page.tsx:178-192,220-231`). Confirm comp is the candidate's REAL offered band, not a placeholder —
  a wrong/blank salary on an official-looking letterhead is a trust `quality-gap`.
- **API path note:** the onboarding page calls `/api/onboarding/candidate/[token]` (`onboarding/[token]/page.tsx:52,79`),
  NOT the brief's `/api/onboarding/[id]` — verify against the route that exists (`app/api/onboarding/candidate/[token]/`).
- **Reversibility / not-a-dark-pattern:** decline routes through an `alertdialog` confirm with focus on the safe option
  (`offer/[token]/page.tsx:48-55,241-282`); ambiguous POST reconciles authoritative status (`:88-101`). Strengths to keep.

## What L2 must confirm (live-only)
- **l2_priority — grounded/non-default path:** accept a REAL offer token; assert the accepted state links onward and the
  minted onboarding token opens a populated questionnaire; submit answers and confirm they surface on Petra's hand-off tab.
- **Real-data behaviour:** salary/currency/company render the seeded values; deadline countdown turns coral inside 48h (`:227`).
- **Bilingual:** Tereza in cs end-to-end; Petra/Tomáš review in cs; the offer card respects `useLocale` number formatting (`:189`).
- **Rendering:** offer + onboarding cards in both themes; the letterhead strip + monogram render (`:138-139,162-169`).

## Out of scope / known
- Webhook/automation that advances Hired downstream (Offers & Automation context) — not the candidate-facing scope here.
- Offer *generation* policy gating (`offer-policy.ts`) is exercised structurally; deep policy edge cases are backlog.

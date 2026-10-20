# Art. 22(2) basis: mark amber, track as R-64

Date: 2026-10-07 · Charter: technical-decision-capture · Docs only

Owner ruling (ask 37e31cc8, "Leave it to counsel, mark amber"): counsel chooses the Art. 22(2) basis for the automatic KO decline; the row is amber now; the KO gate stays automatic.

## Changes

- `ai-act-conformity.md`: GDPR Art. 22 row 🟢 → 🟡, with the owner's deferral and a link to R-64. The file keeps no count of row colours, so nothing else needed updating.
- `regulatory-backlog.md`: new R-64 beside R-26/R-27. It keeps no row index or count.
- ADR 0019: Amendments entry dated 2026-10-07. Title, status and body are unchanged, so the ADR index stays valid.
- Truth fix: the Bias row claimed early-career and unknown archetypes are never auto-rejected. The KO decline path (`app/_lib/apply.ts`, `lead-intake.ts`, `app/api/apply/**/route.ts`, `recordKnockoutDecline`) contains no reference to `isFairnessProtected`, `isEarlyCareer` or any fairness check, so the sentence was narrowed to "on a score" and notes the KO applies to every applicant.

## Left for others (not changed)

- `app/_lib/trust-posture.ts:142` and `messages/*.json` (`gdpr` pillar, "GDPR & Article 22", en.json:903) state the position publicly.
- `messages/en.json:4091`, `:6107`, `:6839`, `:11571`, `:230`, `:12211` state the early-career shield without the KO caveat.

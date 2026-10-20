---
product: "KandiDate"
---

# Council overlay: KandiDate (kp)

Every key not set here is at the method's default. This file only names where KandiDate's
declared users live and which of them a feature serves; it carries no character content.

## Characters

The declared users of this product are the files in the acceptance overlay `uat/characters/`
(35 of them, one per person). Read them from the first of these that exists:

1. `uat/characters/` in the checkout under review.
2. `C:/Users/kazda/kiro/kp/uat/characters/`, the main checkout.

`uat/` is gitignored (the operator's 2026-08-18 rule), so a review that runs in a worktree
does not have it, and the second path is the fallback. First existing wins, the same rule a
`vault:` list uses. If neither exists, value is `unmeasured`: do not invent a user.

Nothing of those files is copied into this tracked tree.

### Characters per feature

Guidance for the value member: judge a feature against the characters it serves, by file
name under `uat/characters/`.

- `compliant-hiring-decision` (the control room, the Art. 22 human gate, erasure):
  - `petra-recruiter` clears an Art. 22 gate.
  - `lucie-dpo-compliance` owns the Art. 22 and erasure duty.
  - `eng-lead-hiring-app-master` holds the kill switch.
  - `tereza-candidate` is the person the decision is about.

## Economics

kp declares its rates in one place: `docs/architecture/price-book.md`. Copy it verbatim to
`evidence/price-book.md`. Every rate in it is a copy of the table the code applies, pinned by
`app/_lib/price-book.test.ts` and `pipeline/jobfit/tests/test_price_book.py`, so the copy is
the declared book. `pipeline/jobfit/llm/monitor.py` says cost is priced by LightTrack; that
describes an optional cross-check, not the book.

Telemetry: copy the newest `docs/architecture/economics/telemetry-*.json` to
`evidence/telemetry/`, and quote its `window` and `n`. When none exists, telemetry is absent
and the review says so. The snapshot states which database it read. It holds aggregates only.
A review never opens a live database.

The book's "Features" table names, per feature, the meters its span reaches and how one use
is counted. A meter marked `unknown` there is reported as unknown. It is not priced, and it
is not zero.

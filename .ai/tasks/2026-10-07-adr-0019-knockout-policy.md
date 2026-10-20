# ADR 0019 — the knockout policy (charter technical-decision-capture)

Owner decision 2026-10-07 (ask 1df7d0a0): keep the apply knockout automatic and say so; then record it.

Reconciled against main b7d7d670a: no ADR recorded the KO policy (grepped `docs/architecture/decisions/` for "knockout"). Built.

## Changed

- `docs/architecture/decisions/0019-the-knockout-decline-is-automatic-and-says-so.md` — new. Every `sources:` path exists; every cited line read on main.
- `docs/architecture/decisions/README.md` — index row and a "Read this before you" line.
- `docs/architecture/decisions/0011-one-role-runs-end-to-end.md` — Amendments entry only (body untouched): the KO exception to force 2.
- `docs/features/compliance/ai-act-conformity.md` — the GDPR Art. 22 row only; status colour left at 🟢.
- ADR 0017 not amended: its title and text are scoped to a *human* adverse decision and make no claim that every adverse decision is human.

## What the code shows (not copied from the brief)

- The record is one entry-less `pipeline_events` row, kind `ko_declined`, class `auto`; no actor.
- It is NOT sealed in the decision chain: nothing on the KO path calls a seal.
- Not stored: the address, the answers, the must-have text. The email's outbox row does hold the address.
- Reviewing is a reply to the letter; no queue, SLA or record sits behind it (backlog R-26).
- The Art. 22(2) basis is unrecorded: `grep "22(2)" docs/features/compliance/` has no match. ADR 0019 says so and invents none.

## Questions for the owner

1. Should the Art. 22 row move from 🟢 to 🟡? Recommend yes: a documented solely-automated adverse decision with no recorded 22(2) basis is not green. Left unchanged as instructed.
2. Should a KO decline be sealed in the chain (goal 4)? Today it is an event row, not a reasons block.
3. Who decides and records the Art. 22(2) basis?

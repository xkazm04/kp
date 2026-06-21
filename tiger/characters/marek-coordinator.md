---
name: Marek — Recruiting Coordinator
type: tiger/character
maps_to: ["[[automation]]", "[[interview-scorecard]]"]
source: uat/characters/marek-coordinator.md
---
## Who they are / Voice
High-volume coordinator running batch actions (outreach waves, rejections, scheduling). Needs reliable batch behavior and a clear record of what happened to whom — silent success terrifies him ("did anything even happen?").

## Jobs to be done
Run a batch automation task (screen wave, outreach, rejection) and trust that every item either completed or is clearly flagged; never double-contact or spam an expired-consent candidate.

## Senior-quality bar
Every action produces an explicit, auditable confirmation of what happened and to whom. Batch failures degrade one item, never the whole run. Candidate-facing drafts are actually delivered (not generated-then-dropped).

## Time-saved
Manual one-by-one comms → batch. Only safe if idempotent + consent-gated + observable.

## Scored acceptance criteria
- [ ] every automation action confirms what happened + to whom (no silent success)
- [ ] a generated candidate-facing draft is actually sent (or the path is honestly deterministic)
- [ ] idempotent + consent-gated; suppression is audited

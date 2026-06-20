# accepted-gaps.md — baseline of known-and-accepted issues

Findings listed here are **suppressed** — the engine will not re-surface them as
defects. Append an entry only when the user (or a recorded decision) explicitly
accepts a gap. Each entry: what it is, why it's accepted, and the scope note.

> This app is, in part, an **AI-Architect interview case** and a demo. Things that
> are deliberately not built, stubbed, or disclaimed are **scope notes**, not
> defects — record them here so a Character doesn't keep "discovering" them.

## Format

```
### <slug> — <one-line>
- **Surface:** <route / context>
- **Why accepted:** <reason — by-design / demo-scope / backlog / external dep>
- **Scope:** <what's still in scope around it>
- **Accepted by / date:** <who, YYYY-MM-DD>
```

## Entries

<!-- none yet — populated as the user accepts gaps during runs -->

### example-tokenized-flows-need-real-token — public token pages 404 without a minted token
- **Surface:** `/apply/[id]`, `/status/[token]`, `/offer/[token]`, etc.
- **Why accepted:** by-design — these are candidate-facing entry points reached
  from a real invite/link; a bare visit without a valid token is expected to fail.
- **Scope:** still in scope — the *experience once you hold a valid token*
  (clarity, completion, trust, AI disclosure). Only the bare-URL 404 is suppressed.
- **Accepted by / date:** scaffolded default, 2026-06-19 (remove if you'd rather
  treat a missing deep-link recovery as a finding).

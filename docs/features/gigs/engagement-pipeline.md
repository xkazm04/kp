# Gigs engagement pipeline

> The end-to-end path a gig travels, from a sourced listing to a recorded outcome and a
> lesson banked back into the craft. This is the *wiring*; the *craft* each stage runs
> lives in the ai-registry recipes lane and is adopted per specialist. Model-agnostic:
> every stage names a capability, never a vendor.

## Stages

1. **Source** — an official-API adapter or a forwarded brief lands a `RawGig`. Every body
   is untrusted; the deterministic honeypot scan runs before anything else and can hold a
   gig in `suspect`.
2. **Research** — up to three linked pages are vetted by the public-host egress guard, read
   through the polite fetcher or the GitHub API, honeypot-scanned, and turned into a
   Markdown brief (category, difficulty, effort, challenges, sources read). Keyless falls
   back to a deterministic brief.
3. **Qualify** — a deterministic score (arena fit, reward known, deadline headroom, not
   suspect, a specialist available) decides whether the gig is worth a specialist's time.
   Craft: `paid-work-opportunity-qualification`.
4. **Compose specialist** — a `GigSpecialistSpec` is built from a RoleBrief plus the
   registry recipes the arena and niche adopt, pinned at a version, plus any accepted
   exemplars. The specialist is hired through the ordinary agent-hire path.
5. **Set up and do the work** — the specialist works in its runtime against the recipe for
   its arena. It produces a deliverable and the evidence it actually ran, never a claim.
6. **Assemble the deliverable** — the last `kp-deliverable` block: summary, draft the
   operator would send, artifacts, evidence (each `passed` true/false/null; unverified is
   never rendered as failed), the AI-use disclosure sentence, confidence, open questions.
   Craft: `disclosed-proposal-writing`.
7. **Human review** — the operator reviews on the Gig desk against a per-arena checklist.
   The pre-send lint flags claims the listing does not support, evidence with no command,
   missing disclosure. Approve is locked until blockers clear and the disclosure item is
   ticked. Craft: `pre-send-deliverable-verification`.
8. **Send** — **the operator sends, under their own account. No agent submits, bids, pays
   or posts anywhere.** This gate is not optional and not delegable to a model.
9. **Outcome** — the external verdict (accepted / rejected / duplicate / no response, with
   money kept per currency) is recorded, manually or by a poller. It moves the
   accepted-outcome rate, the one number the program optimizes.
10. **Lesson** — a scrubbed, generalizable lesson is distilled per adopted recipe and
    landed to that recipe's `LESSONS.md`. Craft: `paid-work-outcome-retrospective`. This is
    how mastery grows: the responsibilities start general and thicken from real runs.

## Multi-provider routing

Every stage names a capability, so any stage can run on the model that fits it best. kp's
model-routing layer picks per use case; Personas runs Claude Code with bring-your-own-model.
Planning benefits from diversity: a design pass can run codex (GPT) and grok seats beside
Claude and let the operator pick, the same `/contest` pattern the Gig desk UI was chosen
by. Routing is by **capability, cost and quality** for a stage.

Routing is **never** used to continue a step that a safety system stopped by handing it to
a model without that safeguard. A flagged step is answered by human review and by the
target program's own policy, not by a model swap. This is a property of the pipeline, not a
preference.

## Per-arena notes

- **Open-source bounty / freelance coding** — the deliverable is a review-ready diff plus a
  PR or proposal description. The work needs no account; only submitting does, and the
  operator submits. Craft: `open-source-bounty-contribution`, `freelance-brief-delivery`.
- **Competition** — the deliverable is a submission file plus the validation that mirrors
  the leaderboard. Craft: `data-competition-entry`.
- **Security programs** — the framework is deliberately general and empty at the start. Two
  hard rules bind it before any technique is added: honor each program's own AI-use and
  automation policy (several programs forbid AI agents outright, and those are not worked),
  and a human verifies every finding with a working reproduction before it is submitted
  under their account. The craft here grows only from operator-driven experience; it is not
  pre-filled with technique content, and kp does not drive live testing of a third party's
  production systems on its own.

## The dry run

The first end-to-end run is a coding gig, chosen because it needs no account and no live
external target: **OphirPay issue #793, a print stylesheet**. A coding specialist clones the
public repo, writes the CSS, runs the project's checks, and produces the diff and PR
description as its deliverable. The run ends on the review desk. Nothing is submitted. It
exists to prove every seam of this pipeline is correct and reusable before any arena that
carries more risk.

## Prerequisites for a live run

- Personas paired to kp (Settings -> Integrations) and a workspace/project dedicated to
  gigs, so a specialist has somewhere to run.
- The arena's recipes present in the registry; a slug the index does not carry resolves
  from the built-in seed map and is labelled as such.
- `NEXT_PUBLIC_KP_AGENT_HIRING=1` so the Gigs surface is available.

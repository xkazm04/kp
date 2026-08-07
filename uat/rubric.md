# rubric.md — the evaluation lens

The operational lens for every `/uat run`. Method backbone: **Nielsen heuristic
evaluation** + **cognitive walkthrough** (task-based, new-user POV) + **JTBD
acceptance**. Applied identically at L1 (over the code-derived surface model) and
L2 (over the live app). A Character also applies its **own scored criteria** on
top of this shared lens — judge against those *identically every run*.

## The 7 dimensions

Five classic + the two that make this Character-driven:

1. **completion** — can the Character actually finish the job, end to end?
2. **effort** — how much friction/steps/confusion to get there? (clicks, dead-ends, re-entry)
3. **clarity** — is each surface understandable? labels, feedback, system status, error messages.
4. **trust** — does the Character believe the output? provenance, confidence, AI disclosure, reversibility, "would I stake my name on this?"
5. **missing** — what's absent that the job needs (a feature, a field, a state, a next step)?
6. **time-saved** — vs the **traditional, LLM-less way**. Faster *and worth the wait*? If it's slower than the Character could rough it out themselves, that's a finding — they wouldn't adopt it. (Anchors in each Character's Motivation; org-level anchors in the research digest in `README.md`.)
7. **senior-quality** — is the AI/automation output at least as good as this Character would produce **as a senior in their role**? Generic, wrong, or shallower-than-their-own-work fails the bar even if it technically "worked".

## Cognitive-walkthrough questions (ask at every step, in-character)

1. **Will I even try this action to reach my goal?** (Is the right affordance obvious / where I'd look?)
2. **Will I notice the control is available?** (Visibility, discoverability, affordance.)
3. **Will I connect this control to the effect I want?** (Label/intent match.)
4. **After acting, will I see progress + know it worked?** (Feedback, system status, error recovery.)
5. **Did the result actually advance my job — and would it clear my bar?** (completion + time-saved + senior-quality.)
6. **Do I trust what I'm looking at enough to act on it / put my name on it?** (trust.)

## Finding types

`missing-feature | quality-gap | broken-flow | confusion | trust`
(A finding may also be a **strength** — positive — which feeds "What passed" + synthesis. Strengths are decision-useful: they say what NOT to touch.)

## Severity

- **blocker** — the job cannot be completed; a core promise fails.
- **major** — the job completes but badly: serious friction, a quality/trust gap a Character would act on, or output below the senior bar.
- **minor** — noticeable friction or rough edge that doesn't threaten the job.
- **polish** — cosmetic / nice-to-have.

## Severity arbitration (keep it consistent across runs)

- A **time-saved** failure (slower than the manual way, or wait-not-worth-it) is **major minimum** — it kills adoption.
- A **senior-quality** failure on the *headline AI output* (job-fit verdict, match reasoning, generated JD/offer/comms, interview prep, dev-case eval) is **major minimum**; if the Character would be *embarrassed to send/use it*, **blocker**.
- A **trust** failure where AI acts on a candidate with **no disclosure / no human-in-the-loop / no provenance** is **major minimum** (and a compliance Character may rate it **blocker** per EU AI Act / GDPR Art. 22).
- For a **demo/case-study disclaimed** surface, drop one severity level and add a `scope_note` (don't suppress entirely unless it's in `accepted-gaps.md`).

## Impact scoring (rank work by this, not the raw severity word)

`severity` is the headline label, but **derive it from `impact` and rank the
backlog by `impact`** — an every-run papercut outranks an unreachable "major".

`impact: { frequency, reachability, trust_erosion }`, each `low | med | high`:
- **frequency** — how often this Character hits it (every run vs edge case).
- **reachability** — can this Character actually *reach* the surface today? (reuse
  the L1 surface-binding; an `unreachable` finding has near-zero live impact until
  the gating/fixture opens).
- **trust_erosion** — how much trust the gap costs (a hallucinated skill on a
  shortlist erodes more than a cosmetic misalignment).

Emit per finding; the synthesis ranks by the computed rank, not by `severity`.

## Resolution & ceiling (honesty rules)

- `resolution`: `open | fixed | resolved-verified | by-design | accepted`.
  **`resolved-verified` REQUIRES live L2 evidence** the fix is *reachable* and
  *unblocks the job* — "fixed" (code landed) is **not** "resolved".
- **`ceiling` is required on every `resolved-verified` / `by-design`**: the honest
  limit that remains — what the Character *still can't do* (e.g. "salary bands are
  ČS-bank-anchored, not this Character's industry/market"). A build's trust lives
  in naming its own seams.

## Reachability — L1's structural blind spot (keep three verdicts distinct)

L1 reads code surface-by-surface and implicitly assumes every surface is reachable
by *this* Character. It isn't always. Never collapse these into one:

**fix *landed* ≠ fix *reachable* ≠ fix *unblocks the job*.**

L1 can honestly speak only to the first. Before judging an affordance, compute the
Character's **reachable surface set** (their `Surface binding` + the app's gating)
and judge only within it. For **kp** the gating that actually matters:

- Internal users reach the authed workspace tabs (`app/features/tabs.ts`) once the
  dev gate is on — **no per-role nav gating**, so reachability ≈ "is the dev gate
  seeded + is there data/a fixture behind the tab".
- **Candidates** reach only tokenized public pages — **unreachable without a minted
  token fixture** (`env.md`). A candidate finding on a tab they can't open is
  mis-attributed; tag it `unreachable`, don't score it against them.
- **Buyer** reaches only public marketing + the keyless simulation + Billing.

A finding on a surface outside the Character's set → tag `unreachable`, defer the
job-impact verdict to L2 (or flag the *gating/fixture gap itself* as the finding).

## Cert-level verdicts (set per journey, per Character)

- **L1:** `L1-pass` (structurally sound, no majors) · `L1-conditional` (completes but has majors to fix; still L2-eligible, majors carry forward) · `L1-fail` (a structural gap blocks the job — fix before L2).
- **L2:** `L2-pass` · `L2-conditional` · `L2-fail`, same logic over the live app.

## Grounding & trust rules (non-negotiable)

- **No finding without evidence.** L1 → `file:line` of the affordance/gap. L2 → screenshot path + ARIA quote / `file:line`.
- **Code cross-check every "missing/broken" claim** before recording: `confirmed-absent | present-but-missed (→ downgrade to confusion) | present-broken | by-design`.
- **Adversarial verify** kept L2 findings (refuter pass; default `refuted`/`uncertain` unless evidence holds — "is the slow thing a timeout or just slow?"). Only `confirmed` reach the headline.
- **Scope honesty:** never fabricate data/proof to "fix" a finding. Honesty the build itself flags (a disclaimer, a "not implemented", a backlog note) is a **strength to keep**, not a defect.
- **Per-character consistency:** for promoted acceptance gates, multi-sample severity across 2–3 runs and take the majority.

## Grounding audit (L1's sweet spot for this AI product)

For every AI surface, follow the import chain affordance → handler → the
`generateStructured` / Gemini / pipeline call → its **prompt**, and ask: does the
prompt actually receive the user's *real* context (this candidate's full CV +
evidence, the real JD, the role's comp band, the bank's brand/process, prior
pipeline history), or only **thin inputs / sample data**? "Good machinery fed thin
context" is the most common defect in AI products and is fully visible in code —
it's a `quality-gap` against **senior-quality**, citable at `file:line`.

## Conversational-surface behavior overlay (promoted from the role-intake work, 2026-08-07)

Dialog surfaces (role-intake, the voice interviewer, conversational apply, the
devcase stakeholder chat) fail differently from form/table surfaces: the defect
usually lives in how the agent handles a *kind of interlocutor*, not a kind of
input. So Characters testing a dialog surface pick up a second axis — **behavior
modes** — drawn from the evidence-graded taxonomy in
`docs/development/role-intake-research.md` §4 (built on MI/coaching/RE-interview
literature) and machine-encoded in `pipeline/jobfit/eval/intake_scenarios.json`:

`vague_requester` · `over_specifier` · `solution_jumper` · `contradicts_self` ·
`leaver_template` · `cant_articulate_level` · `evaluation_anxious` ·
`budget_evader` · `derailer` · `llm_era_confused` — plus the **session-shape**
axis (`power_unit` transactional vs `story` exploratory; depth must be *earned
by detected ambiguity*, or the coaching register becomes the annoying register).

How to use it:
- A Character file MAY declare `Behavior modes` — the 2–3 modes this person
  realistically exhibits (a first-time team lead is `evaluation_anxious` +
  `llm_era_confused`; a director is `over_specifier` + `derailer`). A dialog
  journey run samples ONE declared mode per pass and judges through it.
- Dialog-specific checks (join the seven dimensions): does the agent ask **one
  question per turn**; does it **reflect before asking** (expansion paraphrase,
  not a yes/no read-back); does it **reuse the speaker's words**; does it
  **park premature solutions** instead of specing them; does it **name
  contradictions** aloud; does the close **read back what was captured**
  (grounded, correctable) rather than a generic goodbye; and is machine-vs-said
  **provenance** honest (`stated` never claimed for inferred content).
- The deterministic mirror of these checks already runs in CI
  (`pipeline/jobfit/eval/intake_eval.py` — reliability invariants + the
  100-scenario market-breadth bank). UAT's job on a dialog surface is the part
  CI can't judge: does the *live* conversation feel like the Character's world,
  and would they hand it to their requestors/candidates.

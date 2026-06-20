---
name: marek-coordinator
character: Marek Beneš
role: Recruiting Coordinator / Screening Ops
segment: internal-user
language: cs
references:
  - https://recruitbpm.com/blog/candidate-experience-statistics
  - https://blog.theinterviewguys.com/the-2025-ghosting-index/
  - https://www.zivaro.ai/blog/recruiter-time-per-hire
---

# Marek Beneš — Recruiting Coordinator / Screening Ops

## Background / lived experience
Marek is younger than the recruiters he supports and **obsessed with process**.
He's the one who actually runs the machine at Česká spořitelna's TA org:
screening rules, screen-waves, comms dispatch, interview scheduling, status
hygiene. The recruiters get the credit for the hire; Marek makes sure 200
candidates moved through the right gates without anyone falling through a crack —
or, worse, getting the **wrong message** under the bank's name.

That's the thing that keeps him up. A misfired rejection to a candidate who was
actually advancing, an invite with the wrong date, a bulk action that can't be
undone — at a bank, that's not an oops, that's a complaint, maybe a reputational
hit. He knows **53% of candidates have been ghosted** and **81% want regular
status updates**, and he sees his job as making the bank the org that *doesn't*
ghost — at scale. So he trusts a tool only as far as it lets him **preview**
before it fires, shows an **audit trail** after, and gives him an **undo**.

He lives in the Czech UI and every candidate-facing message he dispatches is in
Czech — the brand voice has to be right.

## Voice
Methodical, checklist-minded, a bit anxious about anything irreversible. Praises
control: "good — it showed me the preview and the recipient list before sending."
His recurring nightmare-question after any action is *"odešlo to? a komu?"* ("did
it send? and to whom?"). He distrusts confidence; he trusts confirmation. He'll
happily click one more step if that step is a dry-run.

## Jobs to be done
- **Configure screening rules** and run an **AI screen-wave** over a batch — with
  a preview of who passes/fails and why before anything is committed.
- **Dispatch comms** (rejections, invites, updates) in batch — each with a preview
  and a record of what went to whom.
- **Schedule interviews** (self-scheduling invites, slot confirmation) without
  double-booking or wrong-date errors.
- Replace one-by-one manual handling with **batched** operations that are still
  reviewable and reversible.

## What good looks like
"Every bulk action shows me a **dry-run first**: who it'll touch, what each person
will receive, rendered in the real template. Then an **audit trail** afterward — a
list I can point to that says *this went to these people at this time*. And an
**undo** for when I catch a mistake. If I can preview, confirm, and reverse, I'll
push throughput hard. If it just fires silently, I won't run a single wave."

## Pet peeves
- **Silent success** — the cardinal sin. An action that completes with no answer
  to "did it send, and to whom?"
- **No dry-run / no preview** — being asked to commit a bulk action blind.
- **Irreversible bulk actions** — no undo, no recall, no way back from a misfire.
- A generated candidate message that's off-brand, has a templating error, or could
  embarrass the bank — anything he wouldn't personally sign.

## Motivation — time saved (the adoption test)
- **The LLM-less way:** screening and comms done **one candidate at a time** —
  reading each CV against the rules, copy-pasting and hand-editing each rejection
  or invite, chasing scheduling over email. It's the bulk of the ~23 hrs/hire
  screening load and a chunk of the coordination overhead, and it scales linearly
  with volume.
- **What the app should save:** **batch** what's now one-by-one — a screen-wave
  over a whole cohort, a comms dispatch to many, self-scheduling that removes the
  back-and-forth. But the time saved only counts if it stays reviewable; a fast
  tool he can't trust to fire correctly saves him nothing, because he'd re-check
  it all by hand.

## Senior-quality bar (the reliability floor)
A generated rejection or invite must be **warm, on-brand, error-free, and
correctly personalized** — the kind of message Marek would **sign and send under
ČS's name** without a second pass. The right person gets the right message; the
template renders with no broken merge fields, no wrong dates, no copy that
contradicts the candidate's actual status. A senior coordinator rejects: any bulk
action without a preview, any send without an audit record, any irreversible
batch, and any candidate-facing message that's generic, mis-merged, or off-brand.

## Scored acceptance criteria (apply identically every run)
- [ ] **completion** — He can configure a screening rule, run a screen-wave,
      dispatch comms, and schedule — each end to end without a dead-end.
- [ ] **trust / clarity** — Each bulk action offers a **dry-run / preview** showing
      who it touches and the rendered message *before* committing (absent = major).
- [ ] **clarity** — Every dispatch/screen-wave returns an explicit confirmation +
      **audit trail** (what happened, to whom, when); silent success is a major.
- [ ] **trust** — Bulk/irreversible actions offer an **undo or recall** path;
      no-way-back on a candidate-facing batch is a major.
- [ ] **senior-quality** — Generated rejection/invite copy is warm, on-brand,
      correctly personalized, with no templating/merge errors — Marek would sign it
      (embarrassing/mis-merged output = blocker).
- [ ] **trust** — Scheduling validates the confirmed slot (no double-book, no past
      date, no wrong-candidate invite).
- [ ] **time-saved** — Batched screen/comms/schedule is plausibly faster than the
      one-by-one manual baseline *and* stays reviewable.
- [ ] **language** — UI and all candidate-facing messages render correctly in
      Czech.

## Surface binding (reachable surfaces — judge findings only here)
Internal user → authed workspace; primarily **Decisions (rules/screen-wave),
Channels (comms dispatch/delivery), Schedule, Pipeline**. Fixtures: seeded
pipeline + comms + interview calendar. The candidate-facing result of his comms
(the `/status`,`/schedule` token pages) is Tereza's surface, not his — cross-check
there only via her.

# UAT run 2026-08-10-intake-triptych — role-intake dialog, post-Triptych re-certification (SUMMARY)

## Scorecard

| character | verdict | grounding | time-saved (est.) |
| --- | --- | --- | --- |
| eva-eng-hiring-lead | **L1-pass** | 8/10 | ~75–100 min/role · confidence medium-high |
| hr-healthcare-clinic-hrbp | **L1-conditional** (2 majors) | 15/16 | ~60–90 min/role · confidence medium |
| tomas-backend-team-lead | **L1-conditional** (1 major) | 5/8 | ~2–2.5 h and two calendar weeks → same-day, ~15 min of attention · confidence medium |

**Run scope:** L1-only (theoretical, code-grounded — no browser), re-certifying
`role-intake-dialog` after the post-Triptych delta: commits **9b7861a9**
(attachments grounding + tri-pane + live JD draft) and **deca4357** / **9eca2924**
(Triptych consolidated as THE session layout, variants deleted). Judged against
the 2026-08-07 baseline + recertify. Every baseline major from the prior run is
fixed in code with the UAT finding ID cited at the fix site (per rubric honesty:
`fixed`, not `resolved-verified`, until L2 drives them live — except the three
Eva items already live-recertified on 2026-08-07-recertify).

## Cross-cutting themes (deduped; convergence outranks impact arithmetic)

1. **CONVERGENT ×3 — the folded draft spine lies, and `draftReady` is computed
   but never consumed** (L1-EVA-10 · L1-HRBP-15 · L1-TOM-5). All three found
   independently that `countFor` maps the draft leaf's spine badge to
   `counts.attachments` (`JdsIntakeLayoutTriptych.tsx:46-47`) — a folded "Popis
   pozice 0" spine with a full draft behind it — while the purpose-built
   `counts.draftReady` (`intakeLayoutShared.ts:22`, `JdsIntakePanel.tsx:235`)
   has no consumer. Tomáš adds the compounding half: the attachments pane
   ("Podklady") is buried in a collapsed `<details>` under that same leaf, so a
   folded draft leaf makes the attach affordance entirely invisible.
2. **CONVERGENT ×2 — the voice extraction thread is promised attachments it
   never receives** (L1-EVA-8 · L1-HRBP-14). `intake-run.ts:153` ships
   `--attachments-json` for `--extract-transcript`, `intake_cli.py:58` loads it,
   but `:85` calls `extract_transcript()` without it and the function has no
   attachments parameter (`intake.py:802-855`) — a dead parameter contradicting
   the fast thread's own "mined outside this call" promise (`intake.py:927`).
   One-line fix shape.
3. **CONVERGENT ×2 — the "supersede" note promises a relationship Promote never
   creates** (L1-EVA-9 · L1-TOM-6). The draft pane promises an "aktualizovaná
   verze" of an attached JD, but the promote route never reads
   `intake.attachments` and `insertAnalyzingJd` mints an unrelated new slug
   (`promote/route.ts:54-70`) — old and new posting sit side by side in Saved
   JDs with no link. Attachments already carry `jdSlug`; the link is one field
   away.
4. **CONVERGENT ×2 — dead duplicate submit handler** (L1-EVA-12 · L1-TOM-9).
   `JdsIntakeChat.tsx:86-91` `submit` duplicates `submitDraft` (:198-203);
   nothing calls it. Polish, delete one copy.
5. **Fix landed ≠ fix reachable** — the run's defining major-class theme. The
   market-research opt-out exists at the API only (L1-HRBP-11); `roleFamily` is
   classified but invisible and uneditable in the UI (L1-HRBP-12); title
   provenance is tracked engine-side but rendered nowhere (L1-TOM-2). In each
   case the engine did its part and the UI withholds the handle.
6. **Provenance-law residuals at the edges**: zero-signal family stamped
   "inferred" instead of "default" (L1-HRBP-13); keyless read-back correction
   recorded as a facet but not applied to structured fields (L1-EVA-11);
   attachment fence markers not stripped/escaped (L1-TOM-4); keyless
   materials-pane empty state over-promises before the ack walks it back
   (L1-HRBP-16); attachments never reach the promoted JD build (L1-TOM-3,
   by-design headroom); eval bank still asserts nothing about `role_family`
   (L1-HRBP-17).

## Impact-ranked backlog (frequency × reachability × trust-erosion; convergent clusters above arithmetic)

| # | finding(s) | sev | impact (f·r·t) | what | l2_priority |
| --- | --- | --- | --- | --- | --- |
| 1 | **L1-HRBP-11** | major | high·high·high | Market-research opt-out API-only — her Promote can't reach it; draft copy asserts the comp read as inevitable | high — UI promote + API `marketResearch:false` probe |
| 2 | **L1-HRBP-12** | major | high·high·med-high | Practice Nurse → `general_professional` (executed), invisible + uneditable, threads into the build | high — LLM-path clinical intake live; keyless invisibility confirm |
| 3 | **L1-TOM-2** | major | med-high·high·high | Title provenance tracked, rendered nowhere — an attachment-mined title masquerades as his words | yes — attach a JD live, watch the title |
| 4 | L1-EVA-10 · L1-HRBP-15 · L1-TOM-5 (**×3 convergent**) | minor | med·high·low | Folded draft spine counts attachments; `draftReady` never consumed; Podklady buried/invisible when folded | low (glance) / yes for Podklady discoverability |
| 5 | L1-EVA-9 · L1-TOM-6 (**×2 convergent**) | minor | med·high·med | Supersede note vs unlinked new JD — ledger ambiguity on the backfill shape | low (structure fully visible at L1) |
| 6 | L1-EVA-8 · L1-HRBP-14 (**×2 convergent**) | minor (would-be major, scope-dropped: voice out of journey scope) | low-med·med·med | Voice extraction thread never receives attachments (dead `--attachments-json` parameter) | med — keyed-host voice L2 |
| 7 | L1-HRBP-13 | minor | med·high·low-med | Zero-signal family wears the "inferred" chip; honest label is "default" | low |
| 8 | L1-TOM-3 | minor | med·high·low-med | Attachments ground the dialog but never the promoted JD build (defensible phase boundary; senior-bar headroom) | no |
| 9 | L1-EVA-11 | minor | low-med·high·low-med | Keyless read-back correction recorded, not applied — structured fields stale through Promote | low (L2 judges the LLM path instead) |
| 10 | L1-HRBP-16 | minor | med·high·low | Keyless materials empty-state over-promises before the ack corrects it | low |
| 11 | L1-TOM-4 | minor | low·high·med | Attachment fence markers not stripped — crafted note/JD body can escape the fence | no (unit-testable) |
| 12 | L1-HRBP-17 | minor (process) | n/a·n/a·med | Eval bank never asserts `role_family` — the exact regression class it's organized to catch | n/a (CI work) |
| 13 | L1-EVA-12 · L1-TOM-9 (**×2 convergent**) | polish | low·n/a·low | Dead duplicate `submit` handler in the composer | no |

Where the L1-conditionals' majors sit: both HRBP majors are #1–#2 (highest
impact products of the run); Tomáš's single major is #3. Eva carries no majors
in journey scope — her would-be major (voice attachments) is the scope-dropped
cluster at #6.

## Value ledger

**What the design promises:** felt team pain → promoted, provenance-tracked
brief + a JD the requestor watched being written, in one sitting, with attached
legacy materials replacing re-dictation — vs a manual baseline of 1.5–3 h and
(for Tomáš) two calendar weeks of meetings.

**What L1 could verify:** the structure of that promise holds — attachments
reach the dialog prompt budgeted and provenance-fenced (executed: 8.5k block
from a 30k input, truncation marker present; keyless ack rides exactly once),
the live draft is deterministic and refuses to print undecided values, the
close waits for the correction, and the prior run's majors are closed in code.
Rolled up: **~60–100 min saved per role** across the three chairs (Eva ~75–100
medium-high; Priya ~60–90 medium — docked by HRBP-11/12; Tomáš ~2–2.5 h + two
weeks → ~15 min same-day, medium). What L1 could NOT verify: whether the model
honors the attachment provenance law live, Czech register, real latency
(30–40 s/exchange is the app's own copy + the prior recertify's measurement,
not this run's).

**Comparability note:** the three grounding scores use different denominators —
**8/10 (Eva) vs 15/16 (Priya) vs 5/8 (Tomáš)** — because each character
enumerated their own context set (Eva: dialog + downstream seams; Priya:
baseline 10 + 6 attachment checks; Tomáš: an 8-item senior-bar ruler including
unattached library/market/org context). The scores are honest within each lens
and NOT comparable across characters; read them as per-character deltas
(7/9→8/10, 9/10→15/16, ~3/8→5/8 — all moved up).

## Strengths worth protecting (phrased as constraints)

- **Any title fix must preserve the spine-provenance chain** — the
  seniority chip + read-back guard + draft refusal
  (`JdsIntakeBriefPanel.tsx:134-141`, `intake.py:459-460`,
  `intake-draft.ts:31-34`) are the pattern L1-TOM-2 asks to be extended, not
  altered.
- **Do not touch the finding-ID-at-the-fix-site discipline** (convergent ×3:
  L1-EVA-S5 · L1-HRBP-18 · L1-TOM-1). Baseline majors fixed with UAT ids cited
  in code comments — "a tool that visibly metabolizes its own audit findings is
  itself a trust signal."
- **Keep the audit-grade attachment fencing intact under any grounding
  extension** (convergent ×3: L1-EVA-S6 · L1-HRBP-19 · L1-TOM-8):
  server-resolved JD bodies, hard caps, inferred-until-confirmed +
  requestor-wins, keyless never-silently-mined with a one-time spoken ack,
  frozen after promote. Fixing L1-TOM-3 (attachments into the build) must not
  bypass this — the brief-as-provenance-tracked-distillate is the defensible
  boundary.
- **The live JD draft must stay deterministic and zero-LLM** (convergent ×3:
  L1-EVA-S7 · L1-HRBP-20 · L1-TOM-7) — its adoption power comes from zero
  latency and its refusal to print undecided values; any "enrichment" that adds
  a model call or a default breaks both.
- **The Triptych's safety rails are load-bearing** (L1-EVA-S8 · L1-HRBP-20):
  min-one-open guard, persisted folds, reduced-motion flattening,
  keyboard-operable spines — the spine-badge fix (backlog #4) must work within
  them, not around them.
- **Keyless honesty is a shipping feature, not a degraded mode** — identical
  opener, disclosed limits, everything typed = stated. L1-HRBP-16's copy fix
  should extend the disclosure earlier, never soften it.

## Honest ceilings

- **L1 cannot verify live output quality**: whether the model actually chips
  attachment-mined values `inferred`, ladders from attached materials, folds
  read-back corrections into structured fields, or holds the Czech coaching
  register — all prompt-contract-verified only. L2's core questions.
- **Real latency unmeasured this run** — 30–40 s/exchange is prior-run evidence
  plus the app's own honest copy; this pass drove no live dialog.
- **Healthcare-flow reachability is asserted, not driven**: Priya's walkthrough
  is a designed-experience cognitive walkthrough; whether an actual keyless
  clinical intake lands where L1 executed the classifier (it does in the
  interpreter — `general_professional`) needs L2 confirmation on the stored
  brief.
- **Voice plane remains fixed/unverified on this host** (no OPENAI key) — the
  recertify's ceiling stands; the attachments-drop defect (#6) can only be
  L2-verified on a keyed host.
- **Ceilings that survive any fix**: the market layer stays Czech-single-market
  (L1-HRBP-11's UI handle makes it skippable, not right for GBP roles); org
  context, prior sessions, and market band never reach the *dialog* prompt by
  design (grounding rows scored ✗ across all three); the keyless floor records
  corrections rather than restructures the brief (disclosed); the LLM one-shot
  `readback+<<END>>` remains accepted-but-instructed-against (`intake.py:757`),
  owned by L2's register check.

## Panel verdict

The shared sentiment, three voices in unison: **the feedback loop itself is now
the product's strongest trust feature — every major they raised last time is
fixed in code with their finding IDs cited at the fix sites, and what remains
is not the engine but the handles the UI still withholds** (a switch, a chip, a
visible category). Eva signs off outright — „Takhle má vypadat oprava:
dohledatelná" — and adopts without supervision; Priya is „two handles short of
a yes" (the market-research switch and the roleFamily field she can neither see
nor change); and Tomáš adopts for his next real role while naming the last gap:
„Důvěra se pořád buduje po replikách — a tohle je poprvé, co jich přibylo víc,
než ubylo."

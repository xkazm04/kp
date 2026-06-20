# L1 UAT — Panel synthesis · run `l1-2026-06-19`

10 Characters · 14 journeys · L1 theoretical (code-grounded, no browser). The signal lives **across** the voices, not within one. Scorecard in `report.md`; raw findings in `findings.json`.

## Headline

The machinery is real and unusually well-grounded — the recurring praise is *"good machinery actually fed real context"*, the rare opposite of the typical AI-product defect. **Internal users would adopt; the buyer can't yet say yes.** Almost nothing fails on completion — the damage is **trust at the edges**: a handful of paths that act on a candidate (reject / outreach / offer-accept) **silently**, an AI "matched skill" that isn't gated to the real CV, and the buyer's proof + compliance story locked behind a login. Fix the silent-action edges and open a public door and most of this certifies.

## Cross-cutting themes (deduped, corroborated)

### T1 — Silent action on a candidate (the trust spine) · **the #1 theme**
Three independent characters, three surfaces, one shape: *the system acts on a person with no preview, no notification, or no next step.*
- **NL bulk-reject never sends a rejection** — status flips + audit event, but `dispatchRejection` is never called (`pipeline.ts:1265-1267` vs `screen-wave.ts:232`). *(Marek)*
- **"Reach out" drafts *and sends*** under the bank's name in one click, no draft state (`useReachOut.ts:29`→`automation-run.ts:286`). *(Jana)*
- **Offer-accept dead-ends** — onboarding link exists at the same token but only emailed (`offer/[token]/page.tsx:194-200`). *(Tomáš **+** Tereza)*
- **`auto` reject mode** applies+emails with no human and seals no tamper-evident record, while the disclosure promises the opposite (`automation-pass.ts:307-326`; `cs.json:461`). *(Lucie)*
> These corroborate Tereza's lived fear (ghosting) from the inside. The fix is consistent: **every action on a candidate gets a preview and/or a notification and/or a visible next step.**

### T2 — AI "matched skill" isn't gated to the real CV
Petra **and** Eva independently land on the same root: job-fit skill chips + eval prose are **LLM-narrated with no deterministic taxonomy gate**, so a "matched" skill the CV never names can render (`pipeline/jobfit/pipeline.py:617-634`). This is Petra's *blocker line* and Eva's "obhájím to čím?" bar. The deterministic coverage panel exists (`ats.py:35-78`) — it just doesn't *gate* the chips.

### T3 — The buyer has no public door and no compliance story
The keyless simulation — the entire reason a prospect would believe this — is **gated behind dev-auth inside `Workspace`** (`HomeGate.tsx:23-25`), and the EU AI-Act / GDPR posture lives only in authed namespaces. A bank buyer evaluating under the Aug-2026 high-risk-AI deadline bounces. *(Helena)*

### T4 — ROI is asserted, not measured
Time-saved is a flat per-action counterfactual (`automation-roi.ts:14-29`), never the **60–70% screening-cut vs the ~23h manual baseline** Kateřina has to defend upward — and it's scattered, with no single leadership readout. The platform *measures calibration* honestly but *estimates* its own ROI. *(Kateřina)*

### T5 — The dev case fights its senior candidate
A 6h senior timebox (`design.py:26`) + dual contradictory submit paths + no AI-disclosure on the eval surface — the exact friction that loses 40–60% of strong seniors. *(Sam)*. The generation/eval *content* is strong (T-shaped grounding) — the *packaging* drives them off.

## Prioritized backlog

### P0 — core promise / a Character won't adopt
- **B1 · Give the guided sim a public door** — mount the keyless sim on a public route (not inside dev-gated `Workspace`). *Unblocks Helena (buyer) entirely.* `Workspace.tsx:106,249-251`, `HomeGate.tsx:23-25`, `page.tsx:13-19`.
- **M1 · Hard-gate "matched" skill chips to a deterministic CV↔JD taxonomy match** — never render an LLM-only matched skill. *Unblocks Petra's blocker line; satisfies Eva.* `pipeline/jobfit/pipeline.py:617-634`, `SkillChips.tsx:28-43`.
- **B2 · Public EU AI-Act / GDPR / human-in-the-loop story.** *Unblocks Helena.*

### P1 — trust-quality (the silent-action spine + audit)
- **M2 · Inline onboarding next-step on offer-accept** (`<a href=/onboarding/{token}>`). *Tomáš + Tereza.* `offer/[token]/page.tsx:194-200`.
- **M3 · Bulk-reject must notify** (dispatch rejection, or preview flags non-notified). *Marek.* `pipeline/command/route.ts:78`.
- **M4 · Outreach needs a draft/preview state** before sending under the bank's name. *Jana.* `useReachOut.ts:29`.
- **M6 · Seal every solely-automated reject** into the hash chain + gate `auto` mode off (or qualify the disclosure). *Lucie — GDPR Art. 22.* `automation-pass.ts:307-326`.
- **M5 · Why-now rationale on each rediscovered candidate.** *Jana.* `rediscover.ts:27`.
- **M7 · Measured ROI vs baseline + one leadership readout.** *Kateřina.* `automation-roi.ts:14-29`.

### P2 — polish / packaging
- **M8 · Bound the senior dev-case scope short** (≤~2h) or make it adaptive. *Sam.* `design.py:26`.
- **M9 · One dev-case submit path + an AI-use disclosure** on the eval surface. *Sam.*
- **M10 · Quantified ROI math + Enterprise pricing tier.** *Helena.*
- Persist screen-wave audit rationale bilingually (cs regulators read the raw export). *Lucie.* `screen-wave.ts:22-23`.

## Strengths worth protecting (what NOT to touch)
Calibration that *refuses to draw a curve* until it has 20 real outcomes · the tamper-evident hash-chained decision dossier · preview-before-mutate in the screening wave · fairness shielding that fails closed · AI-vs-rule provenance on the face of every panel · refusable GDPR consent before AI touches a candidate · grounded inputs to every AI surface · benchmark-anchored salary · three-state decision-log attribution that never blames the machine by default · the keyless real-click sim engine. **These are the credibility — several are exactly what the buyer's compliance story should *show*, not just claim.**

## Panel verdict

Across the ten voices the sentiment is consistent and unusually warm for a UAT pass: *"this one built the substance instead of faking it — it just keeps acting on people a half-step too quietly."* The recruiters (Petra, Jana, Marek), the manager (Tomáš), the compliance officer (Lucie) and the analyst (Kateřina) would all adopt with the trust-edge fixes; the candidates (Tereza, Sam) feel mostly respected but hit a dead-end and a bad take-home; the **buyer (Helena) is the only hard no — not on substance but on access**: she can't reach the proof or the compliance story without a login. **The three things to fix before L2: (1) a public door for the keyless sim, (2) hard-gate AI "matched" skills to the real CV, (3) close the silent-action edges (bulk-reject notify · outreach preview · offer-accept next-step).** Do those and this walks into L2 with the candidate-token + dev-case + outcomes fixtures as the only thing standing between it and "confirmed live."

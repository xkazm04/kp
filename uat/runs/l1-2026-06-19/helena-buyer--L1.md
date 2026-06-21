# L1 (theoretical) — Helena Bauer · prospect buyer (en)

**Character:** Helena Bauer — Head of Talent Acquisition (Erste/Česká spořitelna), the economic buyer.
**Surface set (reachable):** public marketing only — `/landing`, `/landing/spark`, `/about`, the keyless guided simulation, the Billing tab. No auth, no keys, no seeded PII.
**Method:** cognitive walkthrough + her scored criteria, over the code-derived surface model. No browser.
**Run:** l1-2026-06-19

---

## Per-journey verdicts

| Journey | Verdict | Blockers | Majors | Minors | Strengths |
|---|---|---|---|---|---|
| guided-simulation | **L1-fail** | 1 | 0 | 1 (strength) | keyless real-click engine, (SIM)-isolated, conversion CTA |
| evaluate-and-buy | **L1-conditional** | 1 | 2 | 1 (strength) | reasoned/grounded value-prop, pricing well-built (for SMB) |

> **guided-simulation = L1-fail** because the surface the journey is built on (the keyless sim) is not on any surface Helena can reach without flipping a dev flag or logging in — a structural reachability gap that no browser is needed to confirm.
> **evaluate-and-buy = L1-conditional** — she *can* read the marketing and Billing end-to-end and the story is credible, but the missing regulatory compliance answer is a blocker for a bank buyer and carries forward; the ROI-math and enterprise-pricing gaps are majors.

---

## Reachability resolution (done BEFORE judging — L1's blind spot)

Helena binds to public marketing + the keyless sim + Billing. The decisive computation:

- `/about` (`app/about/page.tsx` → `AboutHome` → `AboutCurve`) and the home landing (`SparkHome`) are **public and reachable** — good.
- The **guided simulation is gated**: `SimBar`/`SimulationProvider` are mounted only inside `<Workspace>` (`app/features/Workspace.tsx:106,249-251`), which `app/page.tsx:13-19` hands to `HomeGate` as the **`dashboard`** slot. `HomeGate` (`app/_components/auth/HomeGate.tsx:23-25`) shows the dashboard only when `useDevAuth()` is true — i.e. behind `kp_dev_authed` in dev (`devAuth.ts:16,25-33`) or real cookie auth in prod. A signed-out prospect gets `<SparkHome />`, which has **no sim**. Grepping `app/landing` + `app/about` for any "simulation / try demo" link returns nothing.
- **Conclusion:** the sim is *outside* Helena's reachable set. Per the rubric this isn't "the demo works" — the **gating itself is the finding** (helena-L1-001). The sim *engine* is sound and keyless (helena-L1-002); the defect is purely exposure.
- **Billing tab** is technically dev-gated too, but the journey explicitly grants it for evaluation, so I judge its content (and it's solid).

---

## Findings

### guided-simulation

**helena-L1-001 · blocker · broken-flow · completion** — *The keyless guided simulation is NOT reachable from any public surface.*
The sim is mounted only inside the authed `Workspace` (`Workspace.tsx:106,249-251`); a signed-out visitor lands on `SparkHome` with no `SimBar`. The marketing CTAs all go to `/login` / "Start free" (`AboutCurve.tsx:91,160-167`), never to a demo. So the one rich surface the buyer journey promises ("reaches it with zero setup, her reachability win") is, in practice, the one surface she can't open. → **L2 must confirm** whether a cold prospect can reach it at all without `kp_dev_authed`.

**helena-L1-002 · strength (minor) · trust** — *Once reached, the sim is the real thing, keyless.*
Real native clicks bubble to the actual React handlers (`SimulationProvider.tsx:230-245`); the walk traverses real routes (`/api/jds/save`, `/api/sim/inbound`, `/api/decisions/screen-wave`, `/api/schedule/invite`) and opens the candidate's real `/offer/[token]` to click Accept in-frame (`:578-605`). No LLM/voice key needed — group-eval and screen-wave degrade to deterministic ranking (`:276-321`). Every artifact carries the `(SIM)` marker and `resetSim` deletes only those rows (`sim-store.ts:38-67`), so it never touches real candidates. Climax ends on a conversion CTA, not a dead "Run again" (`SimBar.tsx:52`). **This is the asset to protect — it just needs a public door.**

### evaluate-and-buy

**helena-L1-003 · blocker · missing-feature · missing** — *No regulatory compliance story on the public surface.*
The human-in-the-loop *framing* is strong and public — "a human on every gate", "AI does the reading… a human signs every decision", "a full audit trail and a kill switch… every decision keeps its receipt" (`en.json:287` → `FeaturePreviews.tsx:351-401`). But **GDPR / EU AI Act / Art. 22 / candidate disclosure / retention** appear only in *authed* in-app namespaces she can't reach (`en.json:459` aiDisclosure, `:1962` fairnessAudit, `:2661` decisions audit). For a bank, oversight prose ≠ the regulatory answer Legal needs.

**helena-L1-004 · major · quality-gap · time-saved** — *Zero quantified, sourced ROI math.*
No "60–70% screening cut", no time-to-fill figure, no calculator on `/landing`, `/about`, or pricing — only qualitative claims ("in seconds", "hours not weeks"). The calibration proof is authed-only; the journey intended the keyless sim as the "see it work" ROI proof, but that's blocked by helena-L1-001 — so she has neither a number nor a demo.

**helena-L1-005 · major · quality-gap · trust** — *Pricing is SMB self-serve, no Enterprise tier.*
Four well-built sticker tiers (Free / Starter 490 Kč / Growth 1190 Kč / BYOM) with a defined "AI candidate" unit and "Zero token math" — coherent and reachable (`PricingSection.tsx`). But the ceiling is Growth (~$50/mo, 400 candidates) and every CTA goes to `/login` (`:93`). No Enterprise / volume / seat / SSO / Contact-sales path for an Erste-scale org. `configured:false` locally is honest dev (`BillingTab.tsx:308-313`) — a scope_note, not the finding.

**helena-L1-006 · strength (minor) · trust** — *Reasoned/grounded value-prop, not "AI-powered" fluff.*
"Evidence to back it up", "deterministic and explainable, never keyword bingo", "a fairness gate runs first", "the offer figure is deterministic — no LLM in the number", a signed receipt in the gates preview (`FeaturePreviews.tsx:397-399`). A buyer who's seen Eightfold/SeekOut would register this as a real, defensible differentiation — asserted clearly, just not yet verifiable by her (the proof, the sim, is unreachable).

---

## Helena's verdict — first person

I gave it twenty minutes. Here's where I'd land.

The story is *good* — better than most. I landed on `/about` and the line told itself: design the role, source, intake, screen, interview, offer, hired, and on every single gate the copy says a human signs. "AI does the reading. A human signs every decision." "A full audit trail and a kill switch. Every decision keeps its receipt." "The offer figure is deterministic — no LLM in the number." That's not the "AI-powered, next-gen" mush I close tabs on. Somebody who's been burned by Eightfold's black box wrote this. The fit score shows its factors and claims the evidence is attached. I believe the *intent*.

But I'm buying for a bank, and intent doesn't clear Legal. **Nowhere on a page I can reach does it say GDPR, EU AI Act, Article 22, candidate disclosure, or data retention.** "A human signs it" is the spirit of Art. 22 — but I can't hand my legal team a spirit. The audit trail and fairness export apparently exist *inside* the product, which is exactly the evidence I need — so why is it hidden behind a login instead of on a trust page? Surface it, name the regulation, and you've turned a vibe into a defensible position.

Then the part that actually stopped me: **the demo I was promised, I couldn't run.** The whole reason a vendor earns a second meeting from me is "I verified the core claim myself in one session, no sales call." The product clearly *has* a guided keyless simulation — and from the code it's the real thing, real clicks driving real surfaces, no key required, which is genuinely impressive. But there's no button to it on the marketing pages. The only CTA is "Sign in / Start free," which dumps me at a login. So the single feature that would have converted me is the one I never reached. That's the gap between a tab I close and a meeting I book.

And the ROI — I came knowing the benchmark, ~23 hours of screening per hire, a 60–70% cut if it's real. The site never quotes a number. "In seconds," "hours not weeks" — fine, but I can't take an adverb to my board. Give me the figure and let me verify it in the demo.

Pricing: charming, and clearly built — Zero token math, a real "one candidate fully worked" unit, tiny prices. *Tiny* is the problem. The biggest plan is 1 190 Kč for 400 candidates a month. That's a tool for a five-person team, not a platform for Erste. There's no Enterprise tier, no "talk to us," nothing sized for me. It tells me they haven't thought about a buyer my size yet.

**Would I pilot it today? No — but it's close, and that's rare.** The bones are right: real human-in-the-loop, reasoned matching, an actual working keyless demo. Fix three things and I'm in: put the demo behind a public door, put one quantified ROI number and a real compliance/trust page where I can read them, and give me an enterprise pricing path. Do that and I'd tell a peer to look. Right now I'd say "watch this one" — not "buy it."

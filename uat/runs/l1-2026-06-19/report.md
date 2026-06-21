# L1 UAT — Scorecard · run `l1-2026-06-19`

**Mode:** L1 theoretical (code-grounded, no browser) · **Characters:** 10 · **Journeys:** 14 · **Findings:** 110 (2 blocker · 22 major · 30 minor · 56 polish/positive, incl. **37 strengths**).

> L1 judges the *designed* experience over a code-derived surface model. It is structurally blind to live output quality and to reachability that depends on runtime data/keys — those carry to L2 (see *Deferred to L2* appendix). A verdict here means **structurally sound on paper**, not **confirmed live**.

## Verdict matrix (character × journey)

| Journey | Verdict (worst-case) | Per-character |
|---|---|---|
| group-eval-fairness | **L1-pass** | Tomáš pass · Lucie pass |
| interview-schedule-prep | **L1-pass** | Marek pass · Tomáš pass |
| voice-interview | **L1-pass** | Petra pass · Tereza pass |
| jd-to-shortlist | **L1-conditional** | Petra pass · Kateřina pass · **Jana conditional** |
| cv-analysis-jobfit | **L1-conditional** | Eva pass · **Petra conditional** |
| sourcing-rediscovery | **L1-conditional** | **Jana conditional** |
| screening-decisions | **L1-conditional** | Marek pass · **Lucie conditional** |
| pipeline-advance | **L1-conditional** | Petra pass · **Marek conditional** |
| offer-onboarding | **L1-conditional** | **Petra / Tomáš / Tereza all conditional** |
| candidate-apply-status | **L1-conditional** | Sam pass · **Tereza conditional** |
| dev-case-hire | **L1-conditional** | **Eva / Sam conditional** |
| analytics-calibration | **L1-conditional** | Lucie pass · **Kateřina conditional** |
| evaluate-and-buy | **L1-conditional** | **Helena conditional** (2 majors + 1 blocker) |
| guided-simulation | **L1-FAIL** | **Helena fail** · Petra conditional |

**Totals (28 character×journey pairs):** 13 pass · 14 conditional · 1 fail.
**By journey:** 3 pass · 10 conditional · 1 fail. **No journey is structurally broken for an internal user; the one fail is the buyer's.**

## Confirmed findings by severity (deduped; corroboration = strongest)

### Blockers (2)
| # | Finding | Journey · Char | Dim | Evidence | Suggested acceptance |
|---|---|---|---|---|---|
| B1 | **Guided simulation is unreachable on any public surface** — `SimBar`/`SimulationProvider` mount only inside `<Workspace>`, gated by `useDevAuth`; a signed-out prospect lands on `SparkHome` and every CTA → `/login`. The buyer's whole proof point has no public door. | guided-simulation · Helena | completion/missing | `app/features/Workspace.tsx:106,249-251`; `app/_components/auth/HomeGate.tsx:23-25`; `app/page.tsx:13-19` | An unauthenticated visitor can start + finish the keyless sim from a public route. |
| B2 | **No public compliance story for a regulated buyer** — EU AI Act / GDPR Art. 22 / human-oversight terms live only in authed namespaces; the public marketing has no high-risk-AI / human-in-the-loop narrative. Disqualifying for a bank. | evaluate-and-buy · Helena | trust/missing | `messages/en.json:287` (oversight framing, authed only) | Public page states high-risk-AI posture + human-in-the-loop + GDPR stance. |

### Majors (selected; deduped)
| # | Finding | Journey · Char | Dim | Evidence | Suggested acceptance |
|---|---|---|---|---|---|
| M1 ⭐ | **Job-fit skill chips are LLM-narrated with no deterministic taxonomy gate** — Gemini can name a "matched" skill the CV never mentions; only a soft tooltip + a *parallel* coverage panel mitigate, neither gates. Sits on Petra's hallucinated-skill **blocker line**. *(Petra + Eva, same root.)* | cv-analysis-jobfit / dev-case-hire · Petra+Eva | senior-quality/trust | `pipeline/jobfit/pipeline.py:617-634`; `pipeline/jobfit/gemini.py:98-112`; `app/_components/results/job-fit/SkillChips.tsx:28-43`; mitig. `pipeline/jobfit/ats.py:35-78` | A "matched" chip renders only when the skill is a deterministic CV↔JD taxonomy match; LLM-only matches are never shown as matched. |
| M2 ⭐ | **Offer-accept dead-end** — accept renders only a "we'll be in touch" body; the onboarding next-step exists at the *same token* but ships only by email. Exactly the ghosting peeve. *(Tomáš + Tereza, same root.)* | offer-onboarding · Tomáš+Tereza | missing/trust | `app/offer/[token]/page.tsx:194-200`; `messages/cs.json:485-487`; link only via `offer-finalize.ts:107-110` / `comms-dispatch.ts:362-365` | Offer-accept renders an inline `<a href=/onboarding/{token}>` next step. |
| M3 | **NL bulk-reject silently ghosts** — `reject_below` flips status + writes an audit event but never calls `dispatchRejection` (the screen-wave does); preview never warns "not notified." | pipeline-advance · Marek | trust | `app/api/pipeline/command/route.ts:78`; `app/_lib/db/pipeline.ts:1265-1267`; cf. `app/_lib/screen-wave.ts:232` | Bulk reject dispatches a rejection comm, or the preview flags non-notified candidates. |
| M4 | **"Reach out" drafts *and sends* under the bank's name in one click** — no `outreach_drafted` state, no preview. | sourcing-rediscovery · Jana | trust | `app/_lib/useReachOut.ts:29` → `automation-run.ts:286` → `dispatchOutreach` | Outreach has a draft/preview state before any send under the bank's name. |
| M5 | **Rediscovered silver-medalists carry no why-now** — wire row is score+name+backward-looking `prior`; feed copy just restates the score. Her #1 peeve, baked into the data model. | sourcing-rediscovery · Jana | senior-quality/missing | `app/_lib/rediscover.ts:27`; `app/features/sub_jobs/RediscoverPanel.tsx:67`; `messages/cs.json:1909` | Each rediscovered candidate shows a why-now rationale (what changed / why this role now). |
| M6 ⭐ | **Most-autonomous reject path doesn't seal a tamper-evident record + a config toggle can falsify the candidate disclosure** — `rejectMode:"auto"` applies+emails a reject with no human + no `sealDecisionSafe`; disclosure promises "nothing adverse decided automatically." GDPR Art. 22 exposure. | screening-decisions / analytics-calibration · Lucie | trust | `app/_lib/automation-pass.ts:307-326`; `messages/cs.json:461`; seal only at `screen-wave.ts:215` | Every solely-automated reject seals into the chain; `auto` mode is gated off or the disclosure is qualified. |
| M7 | **ROI is a flat counterfactual estimate, not measured vs the ~23h baseline** — `Σ(count × flat MINUTES_SAVED) × rate`; no 60–70% screening-cut computation, no single leadership ROI export. | analytics-calibration · Kateřina | time-saved | `app/_lib/automation-roi.ts:14-29,55-74` | A measured time-saved vs baseline + one combined leadership ROI readout. |
| M8 | **Dev case timeboxes a *senior* at 6h and says so** — the half-day take-home that drives 40–60% senior drop-off. | dev-case-hire · Sam | time-saved/effort | `pipeline/jobfit/devcase/design.py:26,235-237`; `app/features/sub_dev/DevHelpers.ts:46-48` | Senior case scope is bounded short (≤~2h) or the timebox is adaptive. |
| M9 | **Dev-case has two contradictory submit paths + no AI-use disclosure** on the one surface where AI evaluates the candidate. | dev-case-hire · Sam | clarity/trust | `app/features/sub_dev/DevApplyForm.tsx:30,89-98` vs `app/devcase/apply/[token]/page.tsx:79-85`; no disclosure at `page.tsx:58-87` | One submit path; an AI-use disclosure on the dev-case surface. |
| M10 | **No quantified/sourced ROI math + SMB-only pricing (no Enterprise tier)** for an org-scale buyer. | evaluate-and-buy · Helena | trust/missing | marketing + billing surfaces (see helena report) | Public ROI math with sources + an Enterprise/contact tier. |

*(Full major/minor list with all owners in `findings.json`; remaining majors are facets of M1–M10 raised by other characters.)*

## What passed — strengths worth protecting (do NOT touch)

1. **Calibration is genuinely measured** — reliability curve + Brier from real (score,outcome) pairs, with an honest "not yet calibrated until 20 outcomes" gate. *(Kateřina, Lucie)* — `app/_lib/calibration.ts:62-99,15`; `CalibrationPanel.tsx:94-102`.
2. **Tamper-evident hash-chained decision dossier** + verify badge + 1-click export — the regulator-handable artifact. *(Lucie)* — `screen-wave.ts:215-223` → `decision-record-store.ts:111-191`; `DecisionRecordsPanel.tsx:62-72`.
3. **Screen-wave previews on every change**, commits separately, mutates only on explicit "reject and notify." *(Marek, Lucie)* — `ScreenWaveModal.tsx:57-112`.
4. **Fairness shielding fails closed** — early-career + unknown archetype can't be auto-rejected by drift. *(Lucie)* — `screen-wave.ts:152-162`; `automation-pass.ts:279-287`.
5. **AI-vs-rule-based provenance disclosed, never laundered.** *(Jana, Lucie, Kateřina)* — `MatchShared.tsx:73-74`; `AiVerdict.tsx:34`; `FairnessPanel.tsx:35-37`.
6. **Refusable AI/GDPR consent** before AI touches the candidate, with TTL + erasure path; human idiomatic Czech comms; deterministic rejection never ghosts. *(Tereza)*.
7. **Grounded AI inputs** for group-eval / interview prep / dev-case gen+eval — full recruiter breakdown / CV / JD / role band, not labels. *(Tomáš, Eva)* — `group-eval-run.ts:135,156,191`; `evaluate.py:265-377`; `design.py:62-66`.
8. **Benchmark-anchored salary**, cited in rationale (not a vibe). *(Eva, Petra)* — `data/salary_benchmarks.json` → `gemini.py:434`.
9. **Decision-log three-state attribution** — never defaults accountability to "auto"; UNKNOWN explicit; CSV export. *(Lucie)* — `decision-attribution.ts:84-87`; `DecisionLog.tsx:46-53,122-135`.
10. **Keyless real-click simulation engine** drives real surfaces end-to-end — strong; it just needs a public door (see B1). *(Helena)*.

## Deferred to L2 (reachability / fixtures / live quality)

- **Candidate token pages** (Tereza, Sam) — `unreachable` until the local candidate-token mint path is resolved (env.md open-Q #3). Designed experience evaluated; live confirmation blocked.
- **Dev-case eval-reading half** — `dev_cases/postings/submissions/lifecycle = 0` in `data/kp.sqlite`; seed `devcase/seed_materializer.py` before L2 (Eva, Sam).
- **Calibration curve + measured ROI** — need ≥20 seeded *outcomes* (Kateřina, Lucie).
- **Voice-interview live quality** — needs OpenAI Realtime / ElevenLabs key; keyless = `scope_note`.
- **All AI output quality** (match reasoning specificity, generated comms/JD/offer prose, dev-case eval) — L1 audited *grounding* in code; the live senior-quality bar is L2's to confirm via the grounded/non-default path.

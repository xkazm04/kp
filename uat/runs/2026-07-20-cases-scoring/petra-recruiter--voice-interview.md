---
run: 2026-07-20-cases-scoring
character: petra-recruiter
journey: voice-interview
cert_level: L1
verdict: L1-conditional
grounding:
  question_design: 3.5/8
  scoring: 2.5/8
  journey: 6/16 (0.38)
time_saved_min: 35
time_saved_confidence: medium
language: cs
date: 2026-07-20
mode: theoretical (no browser, read-only)
---

# Petra Nováková × voice-interview — L1 (theoretical, code-grounded)

## Surface model

Built by following the actual import chain from each affordance to its backing code.
Every claim below is cited; nothing is inferred from file names.

### A. Question design (pre-interview)

| Affordance | Backing code |
|---|---|
| Schedule tab → "Interview prep" modal | `app/features/sub_schedule/InterviewPrepModal.tsx` (656 ll.) |
| ↳ "Regenerate" button | `InterviewPrepModal.tsx:348,416,432` → task `interview_prep` |
| ↳ generation | `app/_lib/interview-prep-run.ts:38` → `runAutomationTask(entryId,"prep",…)` |
| ↳ automation core | `app/_lib/automation-run.ts:113-251` — spawns `pipeline.jobfit.automation_cli prep` with `profile.json` + `--job-id` + `--lang` (+ `--github-evidence` when present, `:230-238`) |
| ↳ **the prompt** | `pipeline/jobfit/automation.py:500-521` — `interview_prep()`, 4-6 questions, JSON |
| ↳ prompt context | `pipeline/jobfit/match_reasoning.py:51-97` — `reasoning_context()` |
| ↳ timed plan | `app/_lib/run-of-show.ts:1-120+` — `buildRunOfShow()`, intro 3 min + N×(3–4) + wrap 4, clamped [15,30] (`:31-32`) |
| ↳ "Add to plan" (weave) | `InterviewPrepModal.tsx:248-266` → `PATCH /api/interview-prep` (`app/api/interview-prep/route.ts:106+`) |
| ↳ imported questions source | `app/_components/results/interview/InterviewTab.tsx:130,217-236` — `ImportToPrepButton`, fed from `analysis.interviewKit.questions` (`:92`) |
| ↳ interviewer notes | `InterviewPrepModal.tsx:629-644` → `PUT /api/interview-prep` (`route.ts:38-70`) |
| Interview-sim tab | `app/features/sub_interview/InterviewSimTab.tsx` — 3 hardcoded demo modes (`:34-38,152-155`) → `POST /api/interview/simulate` (`app/api/interview/simulate/route.ts:29-58`) |
| `/interview-lab` | `app/interview-lab/page.tsx:17-33` — gated `INTERVIEW_LAB_ENABLED` (`app/_lib/interview-lab.ts`); dev A/B harness |

### B. Session (the brief the agent actually receives)

| Step | Backing code |
|---|---|
| "Create link" | `app/api/interview/create/route.ts:22-80+` → `buildGroundedInterview(entryId)` (`:70`) |
| Brief selection (branch order) | `app/_lib/interview-run.ts:215-324` — debrief (`:240-254`) > case-grounded student (`:267-283`) > generic student (`:284-292`) > **grounded prep (`:295-323`)** > generic |
| Experienced-cohort brief | `interview-run.ts:118-152` — `composeBrief()`; **falls back to `defaultInterviewerInstructions` when chronology is empty (`:126`)** |
| Craft rules (shared) | `app/_lib/student-interview.ts:151-152` (`PERSONA_ONE_QUESTION`), `:165-166` (`PERSONA_CRAFT_CONDENSED`), `:180` (`PERSONA_CRAFT_RULES`) |
| Early-career-only non-negotiables | `student-interview.ts:197-198` — the deliberate coachability hint |
| Candidate portal | `app/interview/[token]/page.tsx:17-97`; duration `:27`; completed `:29-36`; revoked/expired `:42-49` |
| Connect + guards | `app/api/interview/connect/route.ts:37-246` — bad token 404 `:59-61`, lab gate `:62-64`, completed 409 `:73-75`, revoked `:86-88`, expired `:89-94`, terminal entry `:95-101`, throttle `:114-116`, **server-side consent `:155-157`**, CAS start `:162-164` |
| Candidate-safe brief (ElevenLabs) | `interview-run.ts:336-404` → allow-list sanitizers `app/_lib/voice/candidate-brief.ts` |
| Generic fallback brief | `app/_lib/voice/index.ts:44-59` — "3–4 short questions", `QUICK_SCREEN_MIN` |
| Durations | `app/_lib/interview-duration.mjs:25` (5), `:29` (20), `:33` (30), `:43` (cap 40) |

### C. Transcript → score → the verdict Petra reads

| Step | Backing code |
|---|---|
| Completion | `app/api/interview/complete/route.ts:25-215`; silent-mic downgrade `:113-114`; transcript-first persist `:135`; scorecard `:185-209` |
| Notes budget | `app/_lib/interview-transcript.ts:57` — `MAX_SCORECARD_NOTES_CHARS = 6000`, head+tail sampled `:177-243` |
| Scorecard run | `app/_lib/interview-run.ts:430-490`; coverage attached `:473-474`; telemetry `:454-466` |
| **The scoring prompt** | `pipeline/jobfit/automation.py:715-853`; prompt body `:741-782`; **`notes[:4000]` `:743`**; verbatim-quote rule `:752-754`; read-back rule `:755-771` |
| Rubrics | `pipeline/jobfit/interview-rubrics.json` — `experienced` (5 axes, **no BARS anchors**), `early_career` (6 axes, all anchored); resolved `automation.py:603-621` |
| Confidence band | `automation.py:652-668` |
| Verdict surface (full) | `app/features/sub_schedule/InterviewTranscriptModal.tsx` — ratings `:97-101`, evidence `:102-106`, summary `:292`, recommendation `:283`, coverage caveat `:287-291`, evidence→turn jump `:50-72,240-243,301-317`, readback `:322`, telemetry `:323`, human scorecard `:174-196,328` |
| Verdict surface (decision point) | `app/features/sub_decisions/AiReviewCard.tsx:243-257` — summary + ≤4 competency dot-rows, `:293` commits the advance |
| Cross-candidate | `app/features/sub_jobs/CompareInterviews.tsx:121-145,263-283` |
| Human scorecard | `app/api/interview-prep/scorecard/route.ts:69,94-102,114-126` |
| Decision SoR | `app/_lib/decision-record-store.ts:197-270,286,348`; sealed inputs `app/api/interview/complete/route.ts:199-205` |

## Grounding audit

### Surface A — question generation → **3.5 / 8**

| Real context the questions should use | Reaches the prompt? | Evidence |
|---|---|---|
| Candidate's real CV prose (summary, highlights, work links) | ✅ | `match_reasoning.py:60-65` |
| Skills + provenance | ✅ | `match_reasoning.py:59,70-73` |
| Match result (score, matched/missing must-haves) | ✅ | `match_reasoning.py:89-96` |
| The real JD text | ⚠️ **half** — only skill *names*, title, seniority, roleFamily; the JD's prose/responsibilities never reach it | `match_reasoning.py:81-88` |
| GitHub / public evidence | ✅ (when present) | `automation.py:509`, `automation-run.ts:230-238` |
| Prior pipeline stages (screening rationale, earlier scorecards) | ❌ | `automation-run.ts:203-222` passes only profile + job-id (+ notes, empty for prep) |
| Comp band / market context for the role | ❌ | absent from `reasoning_context` |
| **Petra's own written questions** | ❌ — no authoring surface exists (F2) | `InterviewPrepModal.tsx:629-644` (notes are a scratchpad); `composeBrief` reads only chronology + importedQuestions (`interview-run.ts:127-138`) |
| ČS brand / process / values | ❌ — company is a bare name string | `interview-run.ts:227` |

### Surface B — scorecard scoring → **2.5 / 8**

| Real context the scorer should use | Reaches the prompt? | Evidence |
|---|---|---|
| The full transcript | ⚠️ **broken** — 6000-char head+tail sample, then front-sliced to 4000 in Python (F1) | `interview-transcript.ts:57` vs `automation.py:743` |
| Rubric + anchors | ⚠️ half — BARS anchors only for `early_career`; Petra's cohort gets bare descriptions | `interview-rubrics.json`; `automation.py:728-738` |
| GitHub evidence | ✅ | `automation.py:748` |
| Deterministic confidence | ✅ | `automation.py:845,652-668` |
| The candidate's CV | ❌ — only `candidate.label` | `automation.py:742` |
| The JD / must-haves | ❌ — only `job.title` | `automation.py:742` |
| The plan's `whatsGoodLooksLike` (what "good" was defined as *before* the call) | ❌ — generated at `automation.py:515` then never handed to the scorer | `interview-run.ts:447` passes `notes` only |
| Prior screening verdict / recruiter's human scorecard | ❌ | `automation-run.ts:203-222` |

**Journey grounding: 6 / 16 (0.38).**

## Reachability

Resolved **before** judging. Petra is an internal user; `app/features/tabs.ts` applies **no per-role nav gating**, so her reachable set with the dev gate on (`kp_dev_authed=1`, `app/_lib/auth/devAuth.ts`) is:

- ✅ **Schedule** (`tabs.ts:106`) — create link, prep modal, transcript modal → **all findings below are reachable**
- ✅ **Decisions** (`tabs.ts:105`) — `scorecard_review` card, the actual advance/reject click
- ✅ **Interview sim** (`tabs.ts:127`), **Analyze** (`:126`, the interview-kit import), **Jobs** (`:114`, compare grid), **Analytics** (`:139`, decision records)
- ❌ **`/interview/[token]`** — Tereza's surface (`app/interview/[token]/page.tsx:20` `notFound()`); judged here only as the *design* Petra is accountable for, never scored against her
- ⚠️ **`/interview-lab`** — reachable in dev only (`interview-lab.ts`, off in prod). Journey file scopes it as a dev tool; **no findings recorded against it.**

No finding below is `unreachable`. Every one sits on a tab Petra opens in a normal week.
Standing L1 limit: this certifies **designed** structure only — `fix landed ≠ reachable ≠ unblocks the job`. Live output quality is L2's.

## Findings

```json
[
  {
    "id": "PVI-L1-01",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "trust",
    "title": "The scorer silently reads ~2/3 of a transcript the app tells Petra it sampled honestly — and the discarded part is exactly the read-back the prompt calls authoritative",
    "expected": "The scoring prompt receives what buildScorecardNotes deliberately preserved (opening + closing), and the coverage caveat shown to the recruiter describes what the scorer actually read.",
    "got": "Two truncations stack. TS budgets 6000 chars and head+tail samples so the CLOSING survives (interview-transcript.ts:57,177-243). Python then applies notes[:4000] — a plain FRONT-slice (automation.py:743) — discarding ~2000 chars off the tail the first stage just protected. A grounded screen is 15-30 min (interview-duration.mjs:29-33) ≈ 15-25k chars, so head+tail sampling fires on essentially EVERY real interview and the second slice always bites. The prompt at automation.py:755-771 declares the end-of-call technology read-back the AUTHORITATIVE record ('the confirmation wins') — and the read-back is spoken 'just before closing' (student-interview.ts:166), i.e. inside the discarded span. Worse, coverage{keptTurns,totalTurns} persisted for the recruiter (interview-run.ts:473, rendered InterviewTranscriptModal.tsx:287-291) is computed from the 6000-char stage, so the caveat OVERSTATES coverage.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "app/_lib/interview-transcript.ts:57",
      "app/_lib/interview-transcript.ts:177-243",
      "pipeline/jobfit/automation.py:743",
      "pipeline/jobfit/automation.py:755-771",
      "app/_lib/interview-run.ts:473",
      "app/features/sub_schedule/InterviewTranscriptModal.tsx:287-291",
      "app/_lib/interview-duration.mjs:29-33"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Run a real 20-min grounded session; assert whether entities (read-back) is ever non-null on a full-length call, and compare the rendered coverage caveat against the chars actually sent to the CLI.",
    "suggested_acceptance": "Single-source the scoring budget: pass the notes budget to the CLI (or raise the Python cap above MAX_SCORECARD_NOTES_CHARS) and pin it with a cross-language test, so the TS sampling policy is the only truncation."
  },
  {
    "id": "PVI-L1-02",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "title": "Petra cannot write a single interview question — there is no free-text authoring path from any surface into the agent's brief",
    "expected": "A recruiter who knows the role and the manager can add her own probe — the one thing an LLM-prepped candidate hasn't rehearsed.",
    "got": "Every question the agent asks is machine-authored. The prep modal offers Regenerate (InterviewPrepModal.tsx:348,416,432), weave-into-block (:248-266) and check-off — but its only two text inputs are the interviewer NAME and interviewer NOTES (:610-644), and notes go to userProgress via PUT (route.ts:38-70), which composeBrief never reads (interview-run.ts:127-138 reads chronology + importedQuestions only). importedQuestions can only be filled from the report's AI-generated interviewKit (InterviewTab.tsx:92,130,217-236) — the POST accepts arbitrary text (route.ts:75-105) but no UI sends any. Net: Petra can reshuffle the machine's questions; she cannot add one of her own.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/features/sub_schedule/InterviewPrepModal.tsx:610-644",
      "app/api/interview-prep/route.ts:38-70",
      "app/_lib/interview-run.ts:127-138",
      "app/_components/results/interview/InterviewTab.tsx:92,130,217-236",
      "app/api/interview-prep/route.ts:75-105"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm no add-question affordance exists live in the prep modal (including any collapsed/overflow control the static read may have missed).",
    "suggested_acceptance": "A free-text 'add your own question' row in the prep modal POSTing to the existing /api/interview-prep questions endpoint — the server contract already accepts it."
  },
  {
    "id": "PVI-L1-03",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "The entire anti-rehearsal apparatus is gated on isEarlyCareer — Petra's experienced cohort is scored on a 5-axis, anchorless, mentality-free rubric",
    "expected": "If the product claims to read mentality, the instrumentation that does so reaches the candidates Petra actually screens.",
    "got": "The code contains a genuinely good mentality rubric — Problem decomposition, Learning agility, COACHABILITY, Conceptual depth ('why, not just what: tested with counterfactuals'), 'intrinsic drive over rehearsed answers' — with full BARS anchors on every level. It is unreachable for Petra: rubric_for_archetype (automation.py:603-608) selects it only for early_career archetypes. Her cohort (bau/'Experienced', archetypes.json) gets Technical depth / Problem-solving / Communication / Experience & fit / Motivation, NONE of which carry anchors (verified: anchors present on 6/6 early_career, 0/5 experienced). Four more anti-rehearsal mechanisms are gated the same way: the deliberate mid-problem coachability hint (student-interview.ts:197-198, in NON_NEGOTIABLES, absent from composeBrief), the case-grounded shared scenario (interview-run.ts:267-283), hint-uptake telemetry (interview-run.ts:457-462 sets hintText only when isEarlyCareer, so uptake is always 'not_offered' for her), and the BARS-calibrated scale. What DOES reach her: PERSONA_CRAFT_RULES (student-interview.ts:180, joined at interview-run.ts:143) — narrow-the-follow-up, ask-how-they-verified, no fixed question count. Real, and prompt-level only.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "pipeline/jobfit/interview-rubrics.json",
      "pipeline/jobfit/automation.py:603-621",
      "pipeline/jobfit/automation.py:728-738",
      "app/_lib/student-interview.ts:197-198",
      "app/_lib/interview-run.ts:261-292",
      "app/_lib/interview-run.ts:457-462",
      "app/_lib/interview-run.ts:143"
    ],
    "code_check": "by-design (gating is deliberate) but confirmed-absent for this Character's cohort",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Run a grounded experienced-cohort session and check whether the live agent spontaneously probes for counterfactuals/coachability without the scripted non-negotiable — and whether the resulting scorecard can distinguish a rehearsed answer.",
    "suggested_acceptance": "Either extend the coachability probe + a mentality axis to the experienced rubric, or state plainly in the UI that the experienced screen measures presentation and track-record, not mentality."
  },
  {
    "id": "PVI-L1-04",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Provenance is persisted and then never shown: no rubric version, no scorer version, and no confidence band on the verdict surface at all",
    "expected": "A score Petra will defend carries which rubric and which scorer produced it, and how sure it is.",
    "got": "rubricVersion + rubricKeys are computed and stamped precisely so a scorecard can be re-read on its own scale (automation.py:847-852) — zero render sites in app/features or app/_components. AUTOMATION_VERSION.scorecard ('scorecard-v5') is sealed into the decision record (complete/route.ts:199-205) and never surfaced. Most sharply: confidence{level,reason} — the deterministic band that says 'thin transcript, treat as provisional' (automation.py:652-668) — appears NOWHERE in InterviewTranscriptModal.tsx (verified: 0 occurrences of 'confidence' in the file). It is explicitly excluded from the Decisions card (AiReviewCard.tsx:100-107) and survives only in the compare grid, where its reason is a title= tooltip (CompareInterviews.tsx:130-137) invisible to touch and keyboard. So a 'wide'-band score reads identically to a 'tight' one in the one place Petra reads it.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "pipeline/jobfit/automation.py:845-852",
      "pipeline/jobfit/automation.py:652-668",
      "app/features/sub_schedule/InterviewTranscriptModal.tsx (0 occurrences of 'confidence')",
      "app/features/sub_decisions/AiReviewCard.tsx:100-107",
      "app/features/sub_jobs/CompareInterviews.tsx:130-137",
      "app/api/interview/complete/route.ts:199-205"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Open a real scorecard in the transcript modal and confirm no confidence band renders; check the compare tooltip on keyboard focus.",
    "suggested_acceptance": "Render confidence{level,reason} as visible text in the transcript modal AND the Decisions card, plus a provenance footer (rubric version + scorer version)."
  },
  {
    "id": "PVI-L1-05",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "dimension": "effort",
    "title": "The decision is made on the thinnest surface: the Decisions card commits advance/reject with no evidence quotes and no route to the transcript",
    "expected": "The click that moves a candidate shows the reasoning behind the score.",
    "got": "AiReviewCard renders the summary plus at most FOUR competency dot-rows — .slice(0,4) at AiReviewCard.tsx:247 — with no evidence quotes, no confidence, and no link to the transcript; :293 commits the advance. onInspect (:276-284) opens the CV ANALYSIS modal, not the interview. The rich surface (evidence quotes, transcript, jump-to-turn) lives in InterviewTranscriptModal, reachable only from Schedule. So the correct behaviour — read the evidence before deciding — requires Petra to leave the queue, find the entry on another tab, open a different modal, then come back. Her stated bar ('every named skill traceable to the source', 'a score with its drivers') is unmet at the exact moment she acts.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/features/sub_decisions/AiReviewCard.tsx:243-257",
      "app/features/sub_decisions/AiReviewCard.tsx:276-284",
      "app/features/sub_decisions/AiReviewCard.tsx:293",
      "app/features/sub_schedule/InterviewTranscriptModal.tsx:279-358"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Time the real click-path from the Decisions queue to the evidence quotes and back; count tab switches.",
    "suggested_acceptance": "Point onInspect at the interview transcript modal for scorecard_review, show all rubric axes, and surface the confidence band on the card."
  },
  {
    "id": "PVI-L1-06",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "Evidence-to-transcript anchors are guessed at render time, not recorded — and a failed anchor is silent",
    "expected": "'Jump to this moment' means the scorer recorded which turn it quoted.",
    "got": "The scorer never records a turn index. findEvidenceTurn (InterviewTranscriptModal.tsx:50-72) reconstructs the link by containment, then by >=50% distinctive-word overlap, else -1. Two consequences: an unmatched quote degrades to plain text (:314-316) with no signal to Petra that verification failed, and a 50%-overlap match can anchor confidently to the WRONG turn. The UI copy promises verifiability ('Jump to this moment', messages/en.json:2286) that the data model doesn't back.",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/features/sub_schedule/InterviewTranscriptModal.tsx:50-72",
      "app/features/sub_schedule/InterviewTranscriptModal.tsx:301-317",
      "messages/en.json:2286"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "On a live scorecard, count how many evidence quotes fail to anchor and whether any anchor to a visibly wrong turn."
  },
  {
    "id": "PVI-L1-07",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "dimension": "missing",
    "title": "No per-candidate defensible artifact — the sealed decision record proves a verdict happened, not why",
    "expected": "One export Petra can hand a hiring manager or attach to a challenged rejection.",
    "got": "decision-record-store.ts is a real hash-chained SoR (:197-270, verify :348) and interview verdicts are sealed (complete/route.ts:199-205; human at scorecard/route.ts:94-102). But the sealed inputs are only {recommendation} / {recommendation, ratings: <count>} — no ratings, no evidence quotes, no transcript. The only reader UI is DecisionRecordsPanel in Analytics, exporting whole-workspace decision-records.json (DecisionRecordsPanel.tsx:59-69); listDecisionRecords supports a candidateRef filter (decision-record-store.ts:286) the panel never passes. There is no print/PDF path from the transcript modal (the only window.print() in the repo is the CV report, ReportActions.tsx:55). To defend one decision she screenshots a modal.",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/_lib/decision-record-store.ts:197-270,286",
      "app/api/interview/complete/route.ts:199-205",
      "app/api/interview-prep/scorecard/route.ts:94-102",
      "app/features/.../DecisionRecordsPanel.tsx:59-69",
      "app/_components/results/ReportActions.tsx:55"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Export a decision dossier and check whether a single candidate's interview evidence can be isolated from it."
  },
  {
    "id": "PVI-L1-08",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "The human scorecard is an addition, not an override, and its author is a hardcoded constant",
    "expected": "When Petra disagrees with the AI, the record shows WHO disagreed and marks the AI verdict disputed.",
    "got": "actor is the literal string 'human:recruiter' (scorecard/route.ts:96) — two recruiters are indistinguishable in the chain, and the scorecard payload (:69) carries no author or timestamp, so the UI can only say 'Recorded by a recruiter' (InterviewTranscriptModal.tsx:193). The human verdict sits beside the AI one; :114-126 sets the gate only when no AI approval is pending, so an existing AI scorecard_review is left untouched and never flagged as contested.",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/api/interview-prep/scorecard/route.ts:69,94-102,114-126",
      "app/features/sub_schedule/InterviewTranscriptModal.tsx:174-196"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Save a human scorecard that contradicts the AI and check what the Decisions queue then shows."
  },
  {
    "id": "PVI-L1-09",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "senior-quality",
    "title": "The scorer knows the candidate's name and the job's title — nothing else about either",
    "expected": "A scorer judging 'Experience & fit — relevance of background to THIS specific role' can see the background and the role.",
    "got": "The prompt interpolates candidate.label and job.title only (automation.py:742). No CV, no must-haves, no seniority band. So the 'Experience & fit' axis is scored against a role the model knows by name alone, and a claim made in the call cannot be cross-checked against the résumé. Separately, interview_prep generates whatsGoodLooksLike per question (automation.py:515) — a pre-committed definition of a good answer — and it is never handed to the scorer (interview-run.ts:447 passes notes only). Petra's rubric is defined before the call and then discarded before scoring.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "pipeline/jobfit/automation.py:742",
      "pipeline/jobfit/automation.py:515",
      "app/_lib/interview-run.ts:447"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Withholding the CV is arguably deliberate anti-bias design; withholding whatsGoodLooksLike is not defensible on that ground.",
    "l2_priority": "Check whether a live scorecard's 'Experience & fit' rating cites anything role-specific at all."
  },
  {
    "id": "PVI-L1-10",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "The only 'try it yourself' surface runs a different, ungrounded brief than her candidates get",
    "expected": "The simulator rehearses what the candidate will actually experience.",
    "got": "InterviewSimTab offers three hardcoded demo modes (:34-38,152-155) with fixed personas — 'Senior Backend Engineer (demo)' / 'Junior Backend Developer' (simulate/route.ts:41-57). Petra screens branch advisors and retail ops at a Czech bank; she cannot simulate her own role. And 'regular' mode builds its brief from defaultInterviewerInstructions (simulate/route.ts:41) — the generic 3-4-question quick screen (voice/index.ts:44-59) — NOT composeBrief, the grounded path her real candidates take. Rehearsing the sim therefore teaches her the wrong thing about her own product. (She CAN read the real plan as text in the prep modal; she just can't hear it.)",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/features/sub_interview/InterviewSimTab.tsx:34-38,152-155",
      "app/api/interview/simulate/route.ts:41-57",
      "app/_lib/voice/index.ts:44-59",
      "app/_lib/interview-run.ts:118-152"
    ],
    "code_check": "by-design (documented as a demo) but a real clarity gap",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm the sim's spoken questions differ materially from a real grounded session's."
  },
  {
    "id": "PVI-L1-11",
    "journey": "voice-interview",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "Silent degradation from a 20-minute grounded screen to a generic 5-minute one, invisible on the resulting scorecard",
    "expected": "If the tailored plan couldn't be built, the score says so.",
    "got": "buildGroundedInterview swallows a prep failure (interview-run.ts:296-306, empty catch) and composeBrief falls back to defaultInterviewerInstructions when chronology is empty (:126). durationMin then drops 20 -> 5 (:313). The candidate portal is honest about the length (page.tsx:27,61) — a real strength — but the SCORECARD carries no flag that it scored an ungrounded 3-4-question chat, and Petra reads the scorecard, not the portal. She would see a normal-looking verdict with no cue that the tailoring never happened.",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "app/_lib/interview-run.ts:296-306",
      "app/_lib/interview-run.ts:126",
      "app/_lib/interview-run.ts:313",
      "app/interview/[token]/page.tsx:27,61"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Force a prep failure (no profile) and inspect whether the resulting scorecard is distinguishable from a grounded one."
  }
]
```

### Strengths (what passed — do not touch)

- **S1 — the verbatim-quote evidence rule.** "the evidence MUST be a short, near-verbatim quote of the candidate's own words … do not paraphrase or invent" plus "if the transcript does not cover a competency, set evidence to empty and rate it 3 (not assessed)" (`automation.py:752-754`), enforced structurally in `coerce` (`:815-825`). This is exactly Petra's bar and it is written into the prompt.
- **S2 — confidence widens instead of scores dropping.** `_scorecard_confidence` (`automation.py:652-668`) gives a thin interview a WIDE band, not a low score, so a nervous candidate isn't punished on substance. Correct instinct — spoiled only by F4 never showing it.
- **S3 — server-side consent + denial-of-wallet discipline.** `connect/route.ts:155-157` (consent as a server fact, not a disabled button), plus bad-token 404 `:59-61`, single-use `:73-75`, revoked/expired `:86-94`, terminal-entry revoke `:95-101`, per-token throttle `:114-116`.
- **S4 — the candidate-safe brief allow-list.** `interview-run.ts:336-404` + `voice/candidate-brief.ts` — `listenFor` / `redFlag` / goal annotations structurally cannot reach the candidate's browser on the ElevenLabs path.
- **S5 — silent-mic calls are never scored.** `complete/route.ts:113-114` downgrades a zero-candidate-turn call to "failed", so no phantom verdict and no billing.
- **S6 — truthful duration, single-sourced.** `interview-duration.mjs` with the provider cap provably clearing the grounded max — the fix for a real four-way disagreement.
- **S7 — transcript persisted before scoring.** `complete/route.ts:128-135` — no offer-ready entry with no evidence behind it.
- **S8 — the evidence→turn jump exists at all** (`InterviewTranscriptModal.tsx:301-317`). The idea is right even though the plumbing is heuristic (F6).

## Headline question

**Can Petra design questions that reveal mentality when the candidate has prepped with an LLM — and can she trust the score to separate the best candidate from the best-presenting one?**

**Short answer: no on design, no on the score for her cohort — and the app already contains the correct answer, aimed at somebody else.**

**1. Is question generation grounded?** Meaningfully, yes — and this is the strongest link in the chain. The prep prompt receives real CV prose, not tags: `summary`, `experienceHighlights`, `workLinks`, skills-with-provenance, plus matched/missing must-haves (`match_reasoning.py:53-96`). Questions are per-candidate, not a template. **But the grounding stops at skill names** — the JD's actual prose never reaches the prompt (`:81-88`), no prior stage's output does (`automation-run.ts:203-222`), and no comp band does. **3.5/8.**

**2. Adaptive, or a rehearsable script?** Genuinely adaptive at the prompt layer, and better than I expected. `PERSONA_CRAFT_CONDENSED` (`student-interview.ts:166`) reaches Petra's cohort via `composeBrief` (`interview-run.ts:143`) and instructs: narrow to a smaller concrete sub-question rather than repeating; when a candidate makes a strong or quantitative claim, ask how they achieved or verified it; let coverage — not a question count — decide length; never announce how many questions remain. That is real anti-rehearsal craft.

**The problem is what's missing and where it went.** The one mechanism that reliably separates the prepped from the capable — *offer a hint mid-problem and watch whether they integrate it* — is a documented non-negotiable that exists only in the early-career path (`student-interview.ts:197-198`). It is never joined into `composeBrief`. Same for the case-grounded shared scenario (`interview-run.ts:267-283`) and for hint-uptake telemetry, which `interview-run.ts:457-462` populates only `if (entry && isEarlyCareer(...))` — so for every candidate Petra screens, `hint.uptake` is permanently `"not_offered"`.

**3. Does the scoring prompt reward fluency over substance?** For Petra's cohort, structurally yes. Compare the two rubrics that ship in the same JSON file:

- `early_career`: Problem decomposition · Learning agility · **Coachability** ("integrate it, deflect it, or freeze") · **Conceptual depth** ("why, not just what: tested with counterfactuals") · Motivation & direction (**"intrinsic drive over rehearsed answers"**) · Communication — **every axis behaviorally anchored (BARS), 6/6.**
- `experienced` (hers): Technical depth · Problem-solving · Communication · Experience & fit · Motivation — **0/5 anchored.**

Someone on this team knew exactly what measures mentality, wrote it down in the product's own words, and scoped it to students. An LLM-prepped candidate scoring "Communication — clarity, structure, and active listening" against no anchors, with no coachability axis and no counterfactual probe, will score *well*. That is the definition of rewarding presentation.

There is a real counterweight: the prompt forbids paraphrase and demands near-verbatim quotes (`automation.py:752-754`). Fluency alone cannot manufacture a quote. But a well-prepped candidate produces quotable, structured, specific-sounding sentences — that's what LLM prep *is*. The quote rule catches fabrication; it does not catch rehearsal.

**4. Could Petra defend a rejection?** Partially — and the gaps are in the wrong places.

*In her favour:* every rating carries a verbatim quote, quotes jump to their transcript turn, the transcript sits beside the score, uncovered competencies are honestly marked "not assessed", and the verdict is sealed into a hash-chained record.

*Against her:*
- The score was computed on roughly the first two-thirds of a head+tail sample, and the caveat she's shown overstates coverage (**F1**). Asked "did the AI hear the whole interview?", her honest answer is "I don't know, and the app told me something slightly optimistic."
- The confidence band — the field that says *treat this as provisional* — is not rendered on the verdict surface at all (**F4**). She can't say how sure the score is because she was never told.
- No rubric version, no scorer version anywhere in the UI (**F4**). "Which scale was this scored on?" — unanswerable.
- The decision she actually makes happens on a card with four dots and no quotes (**F5**).
- There is no per-candidate artifact to hand anyone (**F7**).
- If she overrules it, the record says "human:recruiter", not "Petra Nováková" (**F8**).

She could defend an *advance* — nobody audits those. She could not defend a *rejection* to a candidate who pushed back, and under EU AI Act / GDPR Art. 22 scrutiny the missing provenance is the exposed flank.

**5. Does it measure mentality or performance?**

For early-career candidates with a designed case: **mentality** — decomposition, coachability under a live hint, counterfactual transfer, with anchored scales and telemetry. That path is well built and I'd defend it.

For Petra's experienced cohort: **performance.** A CV-derived question set, adaptive follow-ups, and five unanchored axes scoring how well someone talks about work they've done. It measures *the quality of the account*, and a candidate with three hours of LLM prep gives a better account.

**Should Petra stake her name on it? Not yet — but she's closer than the score suggests.** As a *structured first-round screen* that replaces her own phone call and returns a quoted, transcript-linked summary, it earns its place and saves real hours. As a *ranking instrument that separates the best from the best-presenting*, it isn't that for her candidates today. The honest position: use it to decide who's worth her 45 minutes, never to decide who's out. Fixing F1 (one number), F4 (render fields already persisted) and F3 (extend a rubric that already exists) would change that answer materially — and none of the three requires new machinery, only pointing existing machinery at her.

## Character feedback

*(Petra, first person, cs — as she'd say it to Kateřina over coffee)*

Tak jo. Řeknu to na rovinu, protože jsem v tom šest let a viděla jsem dvě migrace ATS, které mi obě slibovaly čas.

**Tohle mi čas fakt ušetří.** Pošlu odkaz, kandidát si to odbaví večer z mobilu, a ráno mám přepis a shrnutí. Screeningový telefonát mi bere půl hodiny plus dvacet minut zápisu — a to je jen ten hovor. Tady kliknu jednou. Když vezmu, že si přepis stejně projedu, jsem někde na **35 minutách ušetřených na kandidáta**, a to není marketing, to je můj kalendář. U patnácti otevřených pozic je to ten rozdíl mezi pátkem večer v kanceláři a pátkem doma.

**A co mě fakt potěšilo:** u každého hodnocení je citace. Doslovná. A dá se na ni kliknout a skočí mi to na to místo v přepisu. To je přesně to, co po nástroji chci — ne "silný komunikátor", ale *"tady to řekl, poslechni si to."* A když se nějaká kompetence v hovoru neprobrala, napíše to. Neblafuje. To je vzácné.

**Ale.**

Ta věc, co mě sedla nejvíc do žaludku: **model nečte celý ten pohovor.** Systém si pečlivě uloží začátek a konec — správně, konec je nejcennější — a pak to na cestě k modelu ještě jednou uřízne zepředu a ten konec zahodí. A do toho konce patří ta část, kde si agent nechá potvrdit technologie, které slyšel. Tedy přesně to, co si systém sám v promptu označí jako *autoritativní*. Takže si to popírá samo. A pod tím shrnutím mi svítí hláška "hodnoceno na vzorku přepisu", která je *optimističtější* než realita. To není chyba. To je moje důvěryhodnost.

**Druhá věc: nemůžu položit vlastní otázku.** Vůbec. Nikde. Můžu klikat "vygenerovat znovu", můžu přetahovat otázky z reportu do bloků, můžu si dělat poznámky do kolonky, kterou stejně nikdo nečte — ale napsat vlastní otázku, tu jedinou, na kterou se ptám, protože znám toho manažera a vím, na čem to u něj minule spadlo? Ne. A to je přesně ta otázka, na kterou se kandidát s ChatGPT nepřipraví.

**Třetí a nejhorší.** Prohlédla jsem si, na čem se moji lidi vlastně známkují. A pak jsem si prohlédla tu druhou tabulku — tu pro studenty. Tam je *Koučovatelnost*, tam je *Pojmová hloubka — jestli chápe proč, ne jen co*, tam je doslova napsáno *"vnitřní motivace před naučenými odpověďmi"*, a ke každému stupni je popsáno, jak to vypadá. Někdo tady přesně věděl, jak se pozná myšlení od přednesu. A moji kandidáti to nedostanou. Ti dostanou pět os bez jediného popisu stupnice, kde "Komunikace — jasnost a struktura" dostane jedničku s hvězdičkou každý, kdo si to večer předtím nacvičil.

To je ta odpověď na moji otázku, i když ji nikdo nahlas neřekl: **u mých kandidátů to neměří myšlení, měří přednes.** A přednes se dá nakoupit za tři hodiny s modelem.

**Podepsala bych to pod manažera?** Doporučení "vzít dál" ano — to nikdo nezpochybňuje. **Zamítnutí ne.** Kdyby mi kandidát zavolal a zeptal se "proč", nemám mu co ukázat: žádný export, jen screenshot okna. Nikde nevidím, jak jistý si ten model byl — to číslo systém spočítá a pak ho v tom okně vůbec nezobrazí. A kdybych to já sama přebila vlastním hodnocením, do záznamu se zapíše "human:recruiter". Ne Nováková. Prostě *nějaký náborář*. Za tohle si ruku do ohně nedám.

A ještě detail, který mě štve nejvíc na každodenní úrovni: to rozhodnutí — to skutečné kliknutí "posunout / zamítnout" — dělám na kartičce ve frontě, kde jsou **čtyři tečky a žádná citace.** Ty krásné doslovné citace, kvůli kterým jsem tenhle nástroj pochválila, jsou na úplně jiné záložce. Takže buď kliknu naslepo, nebo si to obíhám. Hádej, co udělá kolegyně ve tři odpoledne u patnácté karty.

**Doporučila bych to kolegyni?** Řekla bych jí: *"Používej to, ať víš, komu dát svých pětačtyřicet minut. Nikdy podle toho nikoho neškrtej."* To je zatím poctivá věta.

A dodám ještě jedno, protože jsem naštvaná spíš zklamáním než vztekem: **ono to není daleko.** Ta správná stupnice už je napsaná, jen míří na studenty. To číslo s ořezem je jedno číslo. Ta jistota se počítá, jen se nezobrazuje. Tohle nejsou tři čtvrtletí práce — tohle jsou tři věci namířit tam, kde sedím já. Pak si o tom podpisu promluvíme znovu.

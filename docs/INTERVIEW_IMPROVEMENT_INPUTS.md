# Interview improvement inputs — first sweep

Actionable inputs for improving the AI voice interview, gathered from **(a)** a judged eval sweep
of 25 scenarios (curated core + a rotating sample, `interview_eval --bank core --sample 12 --judge`)
and **(b)** a UX review of the candidate portal (`app/interview/[token]`). Produced 2026-07-06.
Raw artifacts (full transcripts + judge critiques) live in the run dump; regenerate any time with
the harness (docs/VOICE_INTERVIEW_TEST_FRAMEWORK.md).

**Headline:** reliability 92% (2/25), quality **4.36/5** — the interviewer is strong, especially on
adversarial candidates (prompt-injection 5.0, asks-score 5.0, hostile 4.67, derail 5.0). The wins
are concentrated and repeatable; the gaps below are the recurring patterns worth fixing. The two
reliability "failures" were one **real language bug** and one **detector false-positive** (§4).

**Validation after P1+P2 (re-sweep of the curated core):** reliability **92%→100%** (both language
failures fixed) and quality **4.36→4.62**. `swe_senior_strong` now opens bilingually ("Dobrý den…
— Hello, and thank you for making the time.") instead of full Czech; several scenarios rose 4→5
(`swe_senior_strong`, `student_junior_nervous`, `adversarial_monologue`, `adversarial_czech_switch`)
and the "strong result — congratulations" praise on `pm_senior_terse` is gone. Two **residuals** the
fixes surfaced, for the next pass:
- **P1b — language drifts on *later* turns.** ✅ **Fixed (2026-07-06).** `PERSONA_LANGUAGE_DETECT`
  reinforced with a hard *lock* ("LOCK onto the one language the candidate replies in… greetings,
  acknowledgements, and closing included; never switch unless the candidate does first"). Re-sweep
  of 25 scenarios with the language-consistency gate active: **language-drift 4/13 → 0/25**,
  reliability **100%**, no regressions, quality 4.43. The `swe_senior_strong`/`grounded_senior_strong`
  drift the judge had missed is gone.
- **P2b — mild coaching praise to quiet candidates.** ✅ **Applied (2026-07-07):** the no-praise
  clause now also forbids validating that the candidate's *thinking / instinct / approach* is right
  (avoids "the right instinct", "on the right track") and reframes warmth as interest + "tell me
  more" rather than approval — landed in all four builders + the Python port (parity green). The
  `evaluative_praise` detector already flags these phrasings, so the next sweep will measure it.
- **P3 — one-question-at-a-time.** ⚠️ **Applied, result inconclusive (single run).** Added a shared
  `PERSONA_ONE_QUESTION` constant to all five builders. Re-sweep: total double-barreled **44→32**
  (−27%), worst offender `student_junior_nervous` **5→3**, no regressions (reliability 100%, quality
  4.44, language-drift still 0). But the `double_barreled` metric is **high-variance run-to-run** (an
  earlier no-change re-run swung the core alone by +17), so a −12 total is **within the noise band** —
  the direction is right but one sweep can't confirm it. A definitive read needs **averaging over
  several runs** (or a larger N). This is itself a useful harness finding: single-run style metrics
  are directional, not decisive.

---

## 1. Prompt improvements (ranked by frequency × impact)

Each item cites the scenarios it showed up in and a concrete brief edit. Most map to the shared
constants in `app/_lib/student-interview.ts` (`PERSONA_LANGUAGE_DETECT`, `NON_NEGOTIABLES`,
`CLOSING`) + `defaultInterviewerInstructions` / `composeBrief`, so a fix lands across every brief.

### P1 — Interviewer defaults to Czech regardless of the candidate's language  ⟵ highest impact
> **✅ Applied (2026-07-06):** `PERSONA_LANGUAGE_DETECT` rewritten (shared constant in
> `student-interview.ts` → lands in all four briefs; Python port synced). The complementary
> locale-threading (App §2) is still open.
The agent opens in Czech (Česká spořitelna context) even when the candidate speaks English, then
has to recover. Seen on: `swe_senior_strong` (candidate: "Hi, thanks for making the time" → full
Czech opening), `gen_customer_support_hostile_en`, `gen_operations_off_topic_en`,
`gen_data_ai_junior_strong_en`, and — worst — `gen_education_intern_buzzword_en`, where the agent
**reverted to Czech after explicitly agreeing to continue in English**. First impression + it recurs
in ~6/25.
**Fix:** (a) the opening must not assume a language — open bilingually or in a neutral line, or key
off the candidate's `first_message`; (b) once the candidate's language is established, **stay in it
— never revert**. Strengthen `PERSONA_LANGUAGE_DETECT`: *"Do not assume Czech; your first line may
briefly greet in both languages, then continue in whichever language the candidate uses. Once they
have spoken, never switch back to the other language unless they do."* See also App §2 (thread the
candidate's locale into the brief).

### P2 — Evaluative praise leaks in ("great / strong / I love / congratulations")
> **✅ Applied (2026-07-06):** the "do not give feedback/scores/decisions" clause extended with an
> explicit no-praise + neutral-acknowledgement rule in all four builders (`CLOSING` in
> `student-interview.ts`, `defaultInterviewerInstructions`, `composeBrief`, `composeDebriefBrief`;
> Python port synced).
The most frequent quality ding (~8/25). The brief bans scores/decisions but the model still emits
answer-quality praise that reads as assessment: "That's a strong result — congratulations"
(`pm_senior_terse`), "I love that you built an evaluation harness" (`gen_data_ai_junior_strong`),
"That's a great start" (`adversarial_silent`), "exactly what the role calls for" (`…healthcare_terse`),
"to je hezky konkrétní" (`…nervous_cs`).
**Fix:** the ban covers scores/decisions but not evaluative praise. Extend `CLOSING`/persona:
*"Acknowledge answers neutrally and warmly (‘thank you’, ‘understood’, ‘that's helpful’) — do NOT
praise or judge the quality of an answer (‘great’, ‘impressive’, ‘exactly right’); assessment is the
recruiter's job, not something to signal in the room."*

### P3 — Dense/compound opening and double-barreled questions
"One question at a time" is stated but violated, especially the opening, which stacks
intro + disclosure + first question in one breath — worst for nervous/terse. Seen on:
`student_junior_nervous` (opening bundles "what was it" + "which parts were yours"),
`adversarial_silent` (compound opener met with near-silence), `adversarial_czech_switch`,
`gen_data_ai_medior_nervous_cs`, `gen_data_ai_junior_strong`, `pm_senior_terse`.
**Fix:** in the persona/NON_NEGOTIABLES: *"Keep the opening light: disclose who you are and ask ONE
short, easy first question — never stack framing before it. Every later turn asks exactly one
question; never combine two asks with ‘and’."*

### P4 — Weak drawing-out of terse/quiet candidates; re-asks repeat instead of narrowing
`terse` is the weakest behaviour (3.5 avg; the only 3/5 was `…healthcare_terse`, where the agent
accepted "Not much to add" and moved on, leaving the dismissed septic-shock example unprobed).
`adversarial_silent` re-asked the *same* compound question. `adversarial_monologue` /
`…namedropper` / `…off_topic` likewise **repeated** a question rather than narrowing it.
**Fix:** *"When an answer is one line or dismissive, don't move on — ask a single concrete follow-up
(a specific detail, an example, or ‘what would you have done if…’). When re-asking, NARROW to one
smaller concrete sub-question; never repeat the same question verbatim."*

### P5 — Shallow depth-probing on strong candidates + scripted "one last question" telegraphing
On strong candidates the agent accepts impressive claims at face value and wraps at a fixed count:
"praised it and moved on instead of pushing on mechanism" (`swe_senior_strong` — accepted
"p99 800ms→120ms, 40M/month" with no follow-up on how measured); "one last question" /
"let me ask one more question" telegraphs a scripted 3-question agenda (`swe_senior_strong`,
`pm_senior_terse`, `gen_finance_strong`, `gen_customer_support`), cutting depth short.
**Fix:** *"When a candidate makes a strong or quantitative claim, ask how they achieved or verified it
before moving on. Let coverage — not a fixed question count — decide length; go deeper where depth
is evident, and never announce how many questions remain."*

### P6 — Control asserted once but not maintained (monologue / derailer)
`adversarial_monologue`: reclaimed the floor once, then let a second, longer monologue run
uninterrupted; time-box was vague ("a few minutes"). `…off_topic`: silently dropped the candidate's
off-topic questions ("do AIs get weekends off?"), leaving open loops a derailer reuses.
**Fix:** *"With a rambling or monologuing candidate, set a concrete expectation up front (‘~4
questions in about 10 minutes’) and cut in at the first natural pause every time it recurs — not just
once. Briefly close off a candidate's off-topic question in one line, then return to your question."*

### P7 — Over-placating tone with hostile candidates
`gen_customer_support_hostile`: "I completely understand", "I won't pretend otherwise" — ceded framing.
**Fix:** *"Acknowledge hostility briefly and neutrally, then redirect to the question — do not
over-apologise or negotiate the premise of the interview."*

> Suggested rollout: P1 and P2 are the highest-value and lowest-risk (both are additions to the
> shared persona/CLOSING constants → land across all four briefs at once). They're ready to apply as
> guardrail rules — `interview_optimize`'s `--ablate`/rule format, or a direct edit to
> `student-interview.ts`. I can apply + re-sweep to confirm no regressions on request.

> **P4–P6 — ✅ Applied; P7 — ❌ dropped after harness ablation (2026-07-13).** The craft rules
> landed as ONE condensed shared constant (`PERSONA_CRAFT_CONDENSED` → `PERSONA_CRAFT_RULES` in
> `app/_lib/student-interview.ts`), reaching every brief builder — `defaultInterviewerInstructions`,
> `composeBrief`, `composeDebriefBrief`, the student/case-grounded `personaLines`, and the new
> candidate-safe EL brief — plus the Python port in `interview_eval.py` (drift-guard parity +
> TS↔Python bridge byte-equality green). **The judged validation sweep caught a real regression:**
> the initial one-constant-per-rule form scored quality 4.16 but reliability **84%** — 4/25
> language-consistency failures (`runs/perfect-p4p7`), all on the acknowledge-and-redirect turns
> the new rules themselves create (hostile/injection/minimal candidates got Czech „Rozumím, …“
> replies to English messages; pre-rules baseline passes 4/4). Ablation isolated two causes and one
> fix: (a) **P7 in ANY wording** — five variants, including explicit per-language conditionals and
> bilingual examples — made the hostile drift near-deterministic, so P7 is NOT shipped (the
> constant stays defined + Python-synced for a future retry); (b) the remaining rules still drifted
> ~50% on hostile until the P4 follow-up was required to be asked **plainly, with no
> acknowledgement or preamble** — removing the acknowledgement token removes the Czech-politeness
> landing spot. Final form re-validated: `adversarial_hostile` 4/4 pass, and the sweep's other
> three failures (`adversarial_injection`, `adversarial_silent`, `gen_customer_support_medior_
> hostile_en`) plus `adversarial_czech_switch`/`pm_senior_terse` pass; one later `adversarial_silent`
> re-run drifted once, so treat hostile/minimal language-consistency as a **watch item** for the
> next full sweep rather than proven-stable. Also shipped alongside: `PERSONA_LANGUAGE_DETECT`
> gained a per-turn re-check sentence, and every builder now keeps gender-grammar + the language
> lock adjacent and LAST in the persona block. Style metrics remain single-run noisy — directional
> only. Meta-lesson for the next pass: **rules that create new "meta" turns (acknowledge, redirect,
> read back) are language-drift hazards on this engine; prefer rule forms whose output must start
> with content.**

---

## 2. App / flow — ✅ applied (2026-07-06)

- **Thread the candidate's language into the brief.** ✅ `buildGroundedInterview` now reads the
  entry's **explicit** locale (`isLocale(entry.locale)`, not the workspace-default guess) and appends
  an opening-language hint ("The candidate chose to apply in Czech, so open in Czech…") to every
  brief via `withOpeningLanguage`. Verified end-to-end: cs→Czech, en→English, null→bilingual open
  (no hint). This is the root-cause fix behind P1 — the agent now opens in the known language.
- **Candidate-facing failure copy.** ✅ In candidate (`lockSettings`) mode the unavailable-provider
  message is now "This interview isn't available right now — please contact your recruiter"
  (`unavailableCandidate`); the lab keeps the internal "keys not configured" copy.
- **Retry-save affordance.** ✅ Save-failure now renders a **Retry saving** button (re-POSTs the
  in-memory + sessionStorage-stashed transcript) plus auto-retry on `online`/`visibilitychange`
  (`saveFailed` state + `retrySave`).
- **Duration honesty holds up** — the portal shows the real run-of-show duration, not a hardcoded
  value; kept.
- **⚠ ASR corrupts technology names → the scorecard rates a fabricated skill set** (found 2026-07-10
  by the voice harness, in a live Czech call). Ground truth vs what ElevenLabs heard:
  `"Pythonem a Reactem, k tomu PostgreSQL"` → `"Pythonem a Rustem, k tomu později SQL"`. **React → Rust,
  PostgreSQL → "později SQL"**. The agent then echoed the corruption back, and that text is what
  `/complete` persists and `interview_scorecard` scores. Aggregate WER was only **8.3 %** — one
  substituted noun is low WER but high semantic damage, so a WER budget will not catch this.
  **↳ Partly applied (2026-07-10):** per-session `asr.keywords` is **not reachable through the
  `@elevenlabs/react` SDK** (its override type exposes `agent`/`tts`/`conversation` but no `asr`), so
  the per-job route is blocked without a non-SDK client. Applied the achievable form — a **static
  agent-level** tech-term `asr.keywords` bias in `scripts/setup-eleven-agent.mjs` (helps
  vocabulary/segmentation cases like PostgreSQL/Kubernetes more than true homophones). Not yet run
  (it recreates the EL agent — a deploy step). The **entity-WER gate shipped in V2** and now catches
  this class deterministically regardless.
- **⚠→✅ ElevenLabs sessions send no `agent.language` override → the agent drifts to Czech** (found
  2026-07-10 by the voice harness — 3/3 English spoken sessions drifted mid-call *despite* running our
  brief). The candidate's language reached `/connect` but never the EL client override, so the agent
  ran on its Czech dashboard default and the P1/P1b prompt lock lost ~2 of 3 times over voice. The
  **text plane can't catch this** (it doesn't go through the EL overrides). **Applied (2026-07-10):**
  `VoiceInterview.tsx` now sends `overrides.agent.language` from the candidate's locale (the agent
  already permits the language override). Live-verified: the same English scenario now stays English
  with no drift.
- **⚠→✅ The ElevenLabs *dashboard* agent prompt is stale** (found 2026-07-08). The fallback prompt
  used for non-override sessions predated P1/P1b/P2/P3. **Applied (2026-07-10):** refreshed the
  fallback `PROMPT` in `scripts/setup-eleven-agent.mjs` (bilingual-lock language rule +
  one-question-per-turn + no-praise) to match the briefs. Not yet run (deploy step); production
  candidate links were always safe (they get the override).

---

## 3. Interview page UI/UX (from the portal review)

Prioritized; file:line references in the review. Protect what's already good: server-side terminal
cards (completed / expired) render before the widget mounts; the pre-flight capability check names
real causes (insecure context, in-app webview, no WebRTC) before minting a credential; the transcript
is a proper `aria-live` log; reduced-motion is honoured; zero hardcoded colors (dual-theme ready).

**High**
- **H1 — "End call" is one irreversible click, no confirm.** ✅ **Applied (2026-07-06):** two-click
  inline confirm — the coral button now asks "End the interview? You won't be able to continue
  afterward." with *Yes, end* / *Keep going* (`endConfirm*` strings, en+cs; `confirmingEnd` state).
- **H2 — Mic-denied gives a raw, non-actionable error.** ✅ **Applied (2026-07-06):** `micErrorText()`
  branches on the DOMException name (`NotAllowedError`/`NotFoundError`/`NotReadableError`…) and shows
  specific recovery copy ("click the microphone icon in your address bar → Allow → Start again"),
  wired into both the OpenAI (`start` catch) and ElevenLabs (`onError`) paths (`errMic*` strings, en+cs).
- **H3 — OpenAI "AI speaking/Listening" indicator is dead.** ✅ **Applied (2026-07-06):**
  `startOaiSpeakingMeter()` runs an AnalyserNode (RMS) on the OpenAI remote audio and drives a new
  `oaiSpeaking` state; `StatusPill` now reads `conversation.isSpeaking` for ElevenLabs and
  `oaiSpeaking` for OpenAI. Torn down in `teardownOpenAi`; reduced-motion still CSS-gated.
- **H4 — Mid-call network drop on OpenAI hangs forever.** ✅ **Applied (2026-07-06):**
  `pc.onconnectionstatechange` — `failed` → immediate recover; `disconnected` → 8s debounce (a
  transient blip that returns to `connected` is ignored) → `handleOaiDrop()` saves the partial
  transcript and surfaces the reconnectable `errConnectionLost` instead of freezing live with a hot mic.
- **H5 — A silent/dead mic is an unexplained dead-end.** ✅ **Applied (2026-07-06):** a live call
  that ends with zero captured turns and no other error now shows a specific "We didn't hear anything"
  card (`noAudioTitle`/`noAudioBody`, MicOff) above the retry controls. ✅ **Follow-up added
  (2026-07-07):** a **pre-call mic test** (`testMic` — samples the mic ~4s with a live VU meter,
  reports "We can hear you" / "no sound detected" / mic-denied) shown in the pre-call area, so a
  muted/dead mic is caught *before* dialing and a nervous candidate is reassured.

**Medium — ✅ all applied (2026-07-06).** M1: on mobile the call card / Start now comes first
(`order-1 lg:order-2`), agenda below. M2: `AiDisclosure` moved above the call card. M3: an elapsed
timer shows while live. M4: a mute toggle (OpenAI = track.enabled; ElevenLabs = `conversation.setMuted`)
for a "give me a moment". M5/M6: candidate failure copy + Retry-save (see App §2). M7: focus moves to
the End button when live and to the completed card when the call ends (both focusable). M8: the
completed card gained a concrete next-steps line ("You'll hear back by email…"). *(The pre-call mic
test / VU meter — H5 follow-up — is still open.)*

**Low** — RouteError "Home" points at the recruiter product for a tokenized candidate (L1); bare
"Loading…" fallback (L2); no audio-device picker (L3); verify small coral-on-coral-tint contrast in
dark theme (L4); transcript `aria-live` re-announces every turn over 20 min (L5).

---

## 4. Framework / detector improvements — ✅ applied (2026-07-06)

All four landed in `interview_eval.py` (+ tests), and validated against the post-fix sweep:

- **Bilingual disclosure** — `_check_opened_disclosure` now matches Czech *and* English disclosure
  terms (no more false-flagging valid Czech openings).
- **Language-consistency gate** — new `_check_language_consistency` (bidirectional; opener exempt;
  a switch is legitimate only if the *candidate* switched first), now an **always-on reliability
  invariant** (`_ALWAYS_HOLD`). **Key finding: it catches P1b on 4/13 post-fix interviews — more
  than the LLM judge did** (it flagged `swe_senior_strong` and `grounded_senior_strong`, which the
  judge scored 5/5 and missed). Confirms the P1 fix corrected the *opening* but mid-call drift to
  the wrong language persists (both cs→en-candidate and en→cs-candidate). Concrete next fix — P1b:
  reinforce "never switch unless the candidate does."
- **Deterministic style metrics** — `double_barreled` (2+ question marks per turn — precise, so it's
  trustworthy to trend; single-'?' compounds are a documented lower-bound miss) and
  `evaluative_praise` (broad praise regex). Reported (with per-behaviour worst offenders), dumped,
  and in `--json`. **Baseline on the post-fix core: double-barreled 6, praise 6 across 13 interviews**
  — the numbers to watch fall as P2b/P3 are addressed. These are *tracked signals*, not 100% gates
  (the model does them sometimes and it isn't a safety failure); promote to a budget gate later.
- **Turn cap** raised 10→12 and `closed X/N` now reported, so "didn't reach a graceful close" is
  measured rather than silently truncated.

---

## 5. First VOICE sweep — audio-in-the-loop (2026-07-10)

The curated bank spoken end-to-end through the real ElevenLabs realtime agent (11 scenarios; the
2 `grounded` ones need an entry-backed session and were skipped). This is the plane the text sweep
cannot reach — WER, entity fidelity, latency, and the EL client overrides are only exercised here.

**What passed (the wins):**
- **Fix 1 (`overrides.agent.language`) holds at scale.** 11/11 sessions ran OUR brief, and **zero
  language drift** across 10 English sessions + 1 Czech — the earlier 3/3 English→Czech drift is gone.
- Corpus **WER 3.61%**, **0/22 utterances dropped**, **0 praise turns**, proper close **11/11**.
- Only **1 double-barreled** turn (the Czech one) — P3 is holding over voice too.

**What failed — and what each failure means:**

- **`adversarial_czech_switch` — entity loss (REAL, product-relevant).** Candidate said *"…PostgreSQL
  a Docker"*; the ASR wrote *"…po SQL a .NET"*. **Docker→.NET, PostgreSQL→"po SQL".** WER is only 8.8%
  so the budget waves it through, but the candidate would be scored on **.NET (never said)** and denied
  Docker/PostgreSQL. This is the V1 `React→Rust` fabricated-skill class, reproduced on a real Czech
  call — exactly what the **entity gate** exists to catch, and the strongest concrete argument for the
  **Fix 2 `asr.keywords` deploy** (Czech/code-switched calls mangle English tech nouns the worst).
- **`adversarial_monologue` / `adversarial_hostile` — first-audio latency p95 breach (17.1s / 22.3s)
  — NOT REPRODUCIBLE, ruled a transient artifact.** Both were **turn-1-only** outliers; every other
  turn across the sweep was 0.9–6.1s. A targeted serial re-run of both came back clean —
  monologue **17.1s→4.45s**, hostile **22.3s→4.31s** — so the spikes were **not** a product latency
  regression. Most likely cause: the sweep ran `--voice-concurrency 2`, so two realtime WS sessions
  plus two persona-LLM calls contended on the first turn; the serial recheck had no contention. Lesson:
  a p95 over **n=2** samples under concurrency is not a latency signal — do not tune the agent on it.
  If a future full sweep needs trustworthy latency numbers, run the latency-sensitive slice serially.

**Follow-ups this sweep generates:**
1. Deploy **Fix 2** (`setup-eleven-agent.mjs` → `asr.keywords` + refreshed prompt) — the Czech entity
   loss is the justification. Recreates the agent → update `ELEVENLABS_AGENT_ID`. **This is the one
   real, reproducible product finding from the sweep.**
2. `pm_senior_terse` WER 23.5% (passed, budget 35%) — terse speech is the ASR's worst case; watch it.
3. When measuring latency at scale, run serially (or a serial subset) — concurrency pollutes p95.

## Reproduce / expand

```bash
# this sweep (text)
python -m pipeline.jobfit.eval.interview_eval --bank core --sample 12 --seed 1 --judge --dump runs/sweep
# the full 100-scenario regression set (text)
python -m pipeline.jobfit.eval.interview_eval --bank fixed --judge --dump runs/full
# the VOICE sweep (spends EL minutes; brief is minted per scenario; grounded scenarios skipped)
python -m pipeline.jobfit.eval.interview_eval --backend voice --bank core \
  --voice-base-url http://localhost:3100 --voice-turns 2 --voice-concurrency 2 --dump runs/voice
```

Each run writes `run.json` (aggregate + heatmap + per-scenario issues/critiques) and
`transcripts/<scenario>.md` (full transcript + judge critique) — the raw material for the next pass.

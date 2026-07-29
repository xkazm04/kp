---
run: 2026-07-20-cases-scoring
character: tereza-candidate
journey: voice-interview
cert_level: L1
verdict: L1-conditional
reachability: unreachable (no minted interview-token fixture — env.md open question #3)
grounding:
  interviewer_brief: 5/7
  scorer_prompt: 3/8
  journey: 8/15
time_saved_min: 50
time_saved_confidence: medium
language: cs
date: 2026-07-20
---

# Tereza Králová × Voice interview — L1 (theoretical, code-grounded)

## Surface model

Followed the import chain from every affordance Tereza can touch down to the
prompt that judges her.

**The one page she reaches — `/interview/[token]`**

| Affordance | Backing code |
|---|---|
| Page resolves session by token, 404s otherwise | `app/interview/[token]/page.tsx:18-20` |
| "Completed" closed card | `page.tsx:29-36` (`interview.completedTitle/Body`) |
| Revoked / expired closed card | `page.tsx:42-49` (`isInterviewLinkExpired`) |
| Role title in the headline | `page.tsx:56` (`session.jobTitle`) |
| Duration chip — truthful, from the session | `page.tsx:27, 61` → `GROUNDED_DEFAULT_MIN` (`app/_lib/interview-duration.mjs`) |
| "AI-led" + "a human decides" chips | `page.tsx:64, 67` |
| AI disclosure block (above the call card by design) | `page.tsx:83` → `app/_components/AiDisclosure.tsx:56-73`; jurisdiction + retention fetched from `/api/compliance` (`AiDisclosure.tsx:36-44`) |
| Agenda rail — **topics only** | `page.tsx:77-81` → `app/_components/voice/InterviewSidebar.tsx:24-45` (renders `items`, i.e. `session.runOfShow`) |
| Consent checkbox + Start (provider pinned) | `page.tsx:85-91` (`lockSettings`) → `app/_components/voice/VoiceInterview.tsx:94` |

**Start → the interviewer that talks to her**

- `POST /api/interview/connect` — `app/api/interview/connect/route.ts:37`
- Guards, in order: bad token 404 (`:59-61`), lab-disabled 403 (`:62-64`), already-completed 409 (`:73-75`), revoked 409 (`:86-88`), expired 409 (`:89-94`), terminal pipeline entry → revoke-on-sight 409 (`:95-101`), per-token rate limit 6/10min (`:114-116`).
- **Consent enforced server-side**, not just a disabled button — `:155-157` → `app/_lib/interview-consent.ts:47-49`; and again as a storage invariant at `/complete` (`interview-consent.ts:55-58`).
- Brief resolution: `session0.instructions` (grounded, minted at session creation) else `defaultInterviewerInstructions` (`route.ts:135-137`).
- ElevenLabs candidate sessions get a **client-sent** candidate-safe brief — `route.ts:182-193` → `app/_lib/interview-run.ts:336-404` → allow-list sanitizers in `app/_lib/voice/candidate-brief.ts:53-88`.

**Where her questions come from (pre-call, frozen)**

- `buildGroundedInterview` — `app/_lib/interview-run.ts:215-324`. Branch order: submission debrief > case-grounded student > generic student > **prep chronology** (Tereza, a mid-career retail applicant, lands here, `:295-315`).
- The chronology is built once, ahead of the call: `app/_lib/interview-prep-run.ts:38-46` → `runAutomationTask(entryId, "prep")` → `pipeline/jobfit/automation.py:500-521`.
- That prep prompt **is** CV-grounded: `reasoning_context(candidate, job, m)` (`automation.py:503, 506-507`) carries her profile, the real job, matched skills and missing must-haves.
- Each generated question carries exactly **one** pre-written follow-up: `"followUpIfAnswer"` (`automation.py:516`) → `PrepQuestion` (`app/_lib/run-of-show.ts:15`) → `ChronologyBlock.followUp` (`run-of-show.ts:16, 122-135`).
- Final brief prose: `composeBrief` — `app/_lib/interview-run.ts:118-152`, run-of-show rendered at `:129-131`, adaptivity instruction at `:148`.

**Where her answers get judged**

- `runInterviewScorecard` — `app/_lib/interview-run.ts:430-490`.
- Transcript → notes: `buildScorecardNotes` (`app/_lib/interview-transcript.ts:177-243`), budget `MAX_SCORECARD_NOTES_CHARS = 6000` (`:57`), head+tail sampled so the **closing is preserved** (`:204-241`).
- `runAutomationTask(entryId, "scorecard", notes)` — `interview-run.ts:447` → `app/_lib/automation-run.ts:218-222` writes `notes.txt`, `--notes-file`.
- **The scoring prompt** — `pipeline/jobfit/automation.py:715-782`. Inputs: `candidate.label`, `job.title`, `notes[:4000]` (`:742-743`), optional GitHub evidence block (`:748`), the rubric (`:749-750`), rating anchors (`:751`), verbatim-evidence rule (`:752-754`), the ASR read-back trust rule (`:758-771`).
- Rubric: `pipeline/jobfit/interview-rubrics.json` — `experienced` = Technical depth · Problem-solving · **Communication** · Experience & fit · Motivation, **no BARS anchors**; `early_career` = six competencies, **every one BARS-anchored**.
- Confidence band: `_scorecard_confidence` — `automation.py:652-668`.
- Telemetry (talk ratio, `longestResponseGapSec`, hint uptake, language lock): `app/_lib/interview-telemetry.ts:94-168`, attached at `interview-run.ts:463` — **after** the scorecard call at `:447`.

## Grounding audit

**Interviewer brief (the agent that talks to her) — 5/7**

| Real context | Reaches the prompt? | Evidence |
|---|---|---|
| Her CV / profile | ✅ via prep | `automation.py:503, 506-507` |
| The real JD (title, seniority, location, mode) | ✅ | `interview-run.ts:229-231` |
| Match gaps / missing must-haves | ✅ | `automation.py:513, 545` |
| Her chosen application language | ✅ | `interview-run.ts:112-116, 233` |
| Public repo evidence (where it exists) | ✅ | `automation.py:508-509` |
| Prior pipeline history / earlier screen notes | ❌ | no such input in `runInterviewPrep` params (`interview-prep-run.ts:23-30`) |
| Comp band | ❌ | absent from `reasoning_context` inputs |

**Scoring prompt (the thing that decides her) — 3/8**

| Real context | Reaches the prompt? | Evidence |
|---|---|---|
| The transcript | ⚠️ partial — re-truncated | `automation.py:743` (`notes[:4000]`) vs budget 6000 (`interview-transcript.ts:57`) |
| The rubric + rating scale | ✅ | `automation.py:749-751` |
| Job title | ✅ (title string only, not requirements) | `automation.py:742` |
| Public repo evidence | ✅ optional | `automation.py:748` |
| **Her CV / profile** | ❌ | `interview_scorecard` reads only `candidate.label`, `.archetype`, `.role_family` — `automation.py:715, 724-725, 742` |
| **Call telemetry (timing, stalls, talk ratio, hint uptake)** | ❌ | computed at `interview-run.ts:463`, *after* the scorer ran at `:447` |
| **The interview plan** (`whatsGoodLooksLike`, what each block was probing) | ❌ | never passed; `--notes-file` is the only interview-specific arg (`automation-run.ts:218-222`) |
| Match gaps the interview was meant to close | ❌ | not in the scorecard args |

**Journey grounding: 8/15.** The machinery that *asks* is well fed. The machinery that *judges* is fed a stripped, re-truncated text file.

## Reachability

`unreachable`. Tereza's surface binding is the tokenized public pages only; `/interview/[token]` `notFound()`s without a resolvable session (`page.tsx:20`), and `env.md` open question #3 (the local token-mint path) is **unresolved** — the fixture table marks the candidate token "the single biggest L2 blocker". Every finding below is therefore design-judged, with `reachability` scored against how a real minted token would behave; none is a live-impact verdict. `l2_priority` is set on each.

## Findings

```json
[
  {
    "id": "TZ-VI-L1-01",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "The scorer sees the transcript and nothing else — no CV, no telemetry, no interview plan",
    "expected": "The thing that rates me can check what I said against what I wrote, and can tell a pause from an absence of knowledge.",
    "got": "interview_scorecard() builds its prompt from candidate.label + job.title + notes[:4000] + rubric. The profile is loaded and serialized (automation-run.ts:147) but only for the cache key and the other tasks; no CV facts enter the scorecard prompt. Deterministic telemetry that DOES measure stalls, talk ratio and hint uptake is computed after the scorer already returned.",
    "evidence": [
      "pipeline/jobfit/automation.py:715",
      "pipeline/jobfit/automation.py:741-782",
      "app/_lib/interview-run.ts:447",
      "app/_lib/interview-run.ts:463",
      "app/_lib/interview-telemetry.ts:94-168",
      "app/_lib/automation-run.ts:218-222"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "l2_priority": "Score two live sessions with identical substance but different fluency and check whether ratings track content or delivery; confirm no CV/telemetry field appears in the persisted scorecard's inputs.",
    "suggested_acceptance": "Pass the telemetry block and a compact CV summary into the scorecard prompt, with an explicit instruction that response latency is not evidence of competence."
  },
  {
    "id": "TZ-VI-L1-02",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Double truncation: TS carefully preserves the transcript's closing, Python then front-slices it off",
    "expected": "The end of my interview — including the read-back where I correct what the machine misheard — is what gets scored.",
    "got": "interview-transcript.ts spends 240 lines guaranteeing the closing survives inside a 6000-char budget, then automation.py:743 applies notes[:4000] — a silent front-slice that can discard the final ~2000 chars, i.e. exactly the read-back the same prompt (automation.py:758-764) declares AUTHORITATIVE over earlier turns. Worse, the honesty artifact lies: coverageFromNotes computes keptTurns/totalTurns from the TS sampling only, so a scorecard can report full coverage on a transcript Python truncated again.",
    "evidence": [
      "app/_lib/interview-transcript.ts:57",
      "app/_lib/interview-transcript.ts:169-243",
      "pipeline/jobfit/automation.py:743",
      "pipeline/jobfit/automation.py:758-764",
      "app/_lib/interview-transcript.ts:152-162",
      "app/_lib/interview-run.ts:473-474"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "l2_priority": "Run a >4000-char transcript ending in a read-back correction; assert the correction reaches the scorecard's entities object and that coverage reflects the real slice.",
    "suggested_acceptance": "Raise or remove the Python slice (the TS budget is already the policy authority), or make it head+tail with the same marker; fold the Python drop into coverage."
  },
  {
    "id": "TZ-VI-L1-03",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "Fluency is a fifth of my score, on an unanchored scale — and I'm the nervous one in the room",
    "expected": "If presentation counts, it counts against a written bar, not a vibe.",
    "got": "The experienced rubric scores 'Communication — Clarity, structure, and active listening' as one of five equal axes with NO BARS anchors; the model gets only the generic 1-5 scale. The early_career rubric, by contrast, gives every competency full behavioral anchors including one that explicitly separates rambling from evasion. So the cohort most likely to be an anxious non-native speaker (mid-career switchers like me) is scored on delivery against the vaguest scale in the file, by a model that cannot see that the pause was nerves.",
    "evidence": [
      "pipeline/jobfit/interview-rubrics.json (rubrics.experienced — five entries, no `anchors` key)",
      "pipeline/jobfit/interview-rubrics.json (rubrics.early_career — every entry carries `anchors`)",
      "pipeline/jobfit/automation.py:728-740",
      "pipeline/jobfit/automation.py:751"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "l2_priority": "Score a halting-but-correct answer and a fluent-but-thin answer on the same question; compare the Communication and Technical depth ratings.",
    "suggested_acceptance": "Add BARS anchors to the experienced rubric, and add a prompt directive that hesitation, accent, and non-native phrasing are not evidence against any competency."
  },
  {
    "id": "TZ-VI-L1-04",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "On an ElevenLabs-provisioned session the exact questions ride to the candidate's own browser",
    "expected": "The questions I'm being tested on aren't handed to me before I answer them.",
    "got": "ElevenLabs has no server-side prompt config, so the candidate-safe brief is returned in the /connect JSON and sent by the browser as an agent override. The sanitizer is a genuine allow-list and correctly strips goals, listenFor, redFlag and coachability stage directions — but questions and followUp are deliberately kept, so the full aloud script is a devtools tab away before I speak. Conditional: DEFAULT_VOICE_PROVIDER is 'openai' and the portal pins session.provider, so this only bites sessions minted on ElevenLabs. The portal's own agenda rail shows topics only, so the product's visible stance is 'topics are candidate-facing, questions are not' — the EL path quietly disagrees.",
    "evidence": [
      "app/api/interview/connect/route.ts:166-193",
      "app/api/interview/connect/route.ts:232-238",
      "app/_components/voice/VoiceInterview.tsx:919-927",
      "app/_lib/voice/candidate-brief.ts:53-68",
      "app/_lib/voice/types.ts:27-28",
      "app/_components/voice/InterviewSidebar.tsx:24-45"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "The sanitizer keeps assessment guidance out of the browser and that boundary is unit-tested; what it cannot do is stop the questions themselves from being readable, because ElevenLabs' flow gives no server-side place to put them.",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "med" },
    "l2_priority": "Mint an ElevenLabs candidate session and read the /connect response in the network tab; confirm whether the aloud questions are present."
  },
  {
    "id": "TZ-VI-L1-05",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "senior-quality",
    "title": "Adaptivity is a sentence of prose, not a mechanism — one static follow-up per question",
    "expected": "If it's going to judge how I think, it has to keep pulling on a thread until it holds or snaps.",
    "got": "The whole run-of-show is generated once, before the call, and frozen into session.instructions. Each prep question carries exactly one pre-written followUpIfAnswer, which becomes ChronologyBlock.followUp and renders as 'Optional follow-up'. Depth beyond that is delegated entirely to the voice model's discretion via one clause: 'with short follow-ups, and adapt to the candidate's answers'. There is no instruction to press an unsupported claim, no counterfactual requirement, no 'ask for the specific moment'. The submission-debrief brief proves the team knows how to write that — it explicitly pushes for the WHY, the rejected alternative, and 'if an answer stays generic, ask for the specific moment' — but only dev-case candidates get it. My path, the ordinary one, gets the weaker brief.",
    "evidence": [
      "app/_lib/interview-prep-run.ts:38-46",
      "pipeline/jobfit/automation.py:515-516",
      "app/_lib/run-of-show.ts:15-16",
      "app/_lib/run-of-show.ts:122-135",
      "app/_lib/interview-run.ts:129-131",
      "app/_lib/interview-run.ts:148",
      "app/_lib/interview-run.ts:206-208"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "l2_priority": "Give a confident, rehearsed, entirely generic answer to a grounded question and count how many levels deep the agent probes before moving on.",
    "suggested_acceptance": "Port the debrief brief's probing clauses (push for the WHY, the rejected alternative, the specific moment) into composeBrief."
  },
  {
    "id": "TZ-VI-L1-06",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "dimension": "trust",
    "title": "The interview ends and nothing is sent to me",
    "expected": "Every stage produces a message. This is the stage where a machine just judged me.",
    "got": "/api/interview/complete persists the transcript and triggers the scorecard; it dispatches no candidate comm. My only closure is the on-screen card ('a recruiter will review the conversation and get back to you'). If I close the tab, there is nothing in my inbox saying the interview was received — the exact shape of the silence I came in wary of.",
    "evidence": [
      "app/api/interview/complete/route.ts (no dispatchOutreach / sendComm call)",
      "app/interview/[token]/page.tsx:29-36",
      "messages/cs.json (interview.completedBody)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "l2_priority": "Complete a live session and check whether any candidate-facing comm is dispatched or only the on-screen card renders."
  },
  {
    "id": "TZ-VI-L1-07",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "dimension": "clarity",
    "title": "Stale comment: connect route says the picker defaults to ElevenLabs; it defaults to OpenAI",
    "expected": "n/a — developer-facing.",
    "got": "route.ts:46-47 states 'the picker defaults to ElevenLabs'; DEFAULT_VOICE_PROVIDER = VOICE_PROVIDER_ORDER[0] = 'openai'. Only matters because the provider choice is precisely what decides whether TZ-VI-L1-04 bites.",
    "evidence": ["app/api/interview/connect/route.ts:46-47", "app/_lib/voice/types.ts:27-28"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "low" },
    "l2_priority": "none"
  },
  {
    "id": "TZ-VI-L1-S1",
    "journey": "voice-interview",
    "character": "tereza-candidate",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "The consent, disclosure and lifecycle layer is genuinely well built",
    "got": "Consent is a hard server-side precondition before any credential is minted (403) AND a storage invariant at /complete (403) — not a disabled button. The Czech AI disclosure is real Czech, states that a human reviews every advance/offer/reject decision, that nothing adverse is automated, and that I can request human review — rendered ABOVE the Start card by deliberate design. Duration is read from the session's real run-of-show, not a hardcoded '5 minutes'. Revoked/expired/completed links render honest closed cards. The scorer's confidence band widens rather than lowering scores on a thin transcript, explicitly so 'a brief or nervous candidate is not penalised on substance'. Coachability hints never reach the browser.",
    "evidence": [
      "app/_lib/interview-consent.ts:47-58",
      "app/api/interview/connect/route.ts:155-164",
      "messages/cs.json (aiDisclosure.body)",
      "app/interview/[token]/page.tsx:72-83",
      "app/interview/[token]/page.tsx:27",
      "app/interview/[token]/page.tsx:29-49",
      "pipeline/jobfit/automation.py:652-668",
      "app/_lib/voice/candidate-brief.ts:70-85"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "All of this governs whether the interview may happen and how it is framed. None of it governs whether the resulting judgement is fair — the confidence band widens, but the ratings it qualifies are still produced from a delivery-shaped, unanchored rubric on a text-only input.",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" }
  }
]
```

## Headline question — does it discover how I think, or how well I perform?

**It measures performance. It was built to measure mentality, and for one narrow cohort it does — but not for me.**

Three code-level facts decide this.

**1. The questions are personal but pre-written; the probing is a hope, not a mechanism.**
Credit where it's due: my questions are not a fixed script an applicant can rehearse in general. `interview_prep` builds them from `reasoning_context(candidate, job, m)` — my actual profile, the actual job, my matched skills and my missing must-haves (`automation.py:503, 506-507`). Someone prepping with ChatGPT the night before cannot guess *these* questions, because they are derived from *their own* CV against *this* JD.

But the depth stops one level down. Each question carries exactly one pre-written `followUpIfAnswer` (`automation.py:516`), which becomes a single `ChronologyBlock.followUp` (`run-of-show.ts:16`) rendered as "Optional follow-up" (`interview-run.ts:131`). Everything beyond that is one clause of prose — *"with short follow-ups, and adapt to the candidate's answers"* (`interview-run.ts:148`). There is no instruction to press an unsupported claim until it holds or collapses; no counterfactual; no "ask for the specific moment". So a fluent, well-rehearsed generic answer to a personalised question survives, because nothing in the brief obliges the agent to pull the thread.

The damning part is that the team **knows how to write that brief**. The submission-debrief path does exactly what the headline asks: *"push gently for the WHY, the alternative they rejected, and what would make them decide differently"*, and *"If an answer stays generic, ask for the specific moment in THEIR submission where they made that call"* (`interview-run.ts:206-208`). Likewise, the early-career rubric is a genuine mentality instrument — Problem decomposition, Learning agility, **Coachability** measured by how a live hint is taken, Conceptual depth measured by counterfactuals — every axis BARS-anchored, with a real hint injected mid-call and its uptake tracked deterministically (`interview-telemetry.ts:119-153`). That is a "how you think" machine, and it is real.

It just isn't pointed at me. I'm mid-career, not early-career and not a dev-case candidate, so `buildGroundedInterview` routes me past both branches to the generic prep chronology (`interview-run.ts:261, 295-315`) — the weakest of the three briefs, scored on the only rubric in the file with **no behavioral anchors at all**.

**2. What the scorer receives: the transcript, and essentially nothing else.**
`interview_scorecard(candidate, job, notes)` builds its entire prompt from `candidate.label`, `job.title`, `notes[:4000]`, the rubric and the anchors (`automation.py:715, 741-782`). Concretely:

- **No CV.** The profile is serialized right there in `automation-run.ts:147` — it just never enters this prompt. So nothing can check my spoken claims against what I wrote. The one consistency mechanism that exists is the ASR read-back rule (`automation.py:758-771`), and that guards against *the machine mishearing me*, not against *me* overstating.
- **No timing, no hesitation, no self-correction.** This is the sharpest one. The system *does* compute stalls (`longestResponseGapSec`), talk ratio, hint uptake and language-lock — `interview-telemetry.ts:94-168` — and it is honest that these are proxies. But look at the order: the scorer runs at `interview-run.ts:447`; telemetry is attached to the result at `:463`. **It is computed after the judgement and stapled on.** The one dataset that could distinguish "she paused because she was searching for the Czech word" from "she paused because she didn't know" is generated too late to inform anything.
- **No interview plan.** `whatsGoodLooksLike` — what a good answer to each question was supposed to contain — is generated (`automation.py:515`) and never handed to the scorer. It grades my answers without knowing what was being probed.

**3. Yes, fluent delivery scores higher — structurally.**
The `experienced` rubric is five equally-weighted axes, one of which is *"Communication — Clarity, structure, and active listening."* That is 20% of my scorecard explicitly awarded for presentation. And unlike every early-career competency, **it carries no `anchors` key** (`interview-rubrics.json`), so `_rubric_line` emits no BARS (`automation.py:730-737`) and the model rates my Czech on the bare "1 = Well below bar … 5 = Exceptional" scale — which is precisely the condition under which an LLM falls back on surface fluency. Nowhere in the prompt is there a line telling the model that hesitation, an accent, or non-native phrasing is not evidence against a competency.

The counter-evidence, which I'll credit honestly: `_scorecard_confidence` (`automation.py:652-668`) is a deliberate, well-reasoned guard, commented *"so a brief or nervous candidate is not penalised on substance"* — a thin transcript widens the band instead of lowering the score. But a band is a caveat on a number, not a correction to it. My Communication 2 is still a Communication 2; it just arrives labelled "provisional".

And one thing genuinely undercuts the "rehearsal-proof" claim on top of everything else: on a session provisioned to ElevenLabs, the sanitized brief — topics *and the aloud questions and follow-ups* — is returned in the `/connect` JSON and re-sent by my own browser (`route.ts:182-193, 232-238`; `VoiceInterview.tsx:919-927`). The sanitizer is a real, unit-tested allow-list and correctly strips the assessment guidance. But the questions themselves survive by design, and the portal's agenda rail shows me only topics (`InterviewSidebar.tsx:24-45`) — so the product's visible stance and its ElevenLabs path disagree about what I'm allowed to see before I answer.

**Plainly: it measures performance.** It performs a personalised, well-governed, consent-clean, honestly-framed interview, and then judges it from a text file, on a delivery-weighted scale with no written bar, having thrown away — or computed too late — every signal that could have told it how I actually think. The parts needed to fix that already exist in this repo: the anchored rubric, the probing brief, the telemetry. They are simply wired to the other candidate.

## Character feedback — Tereza (first person, cs)

Tak. Otevřela jsem ten odkaz večer po práci, na telefonu, a musím říct — první dojem byl lepší, než čekala. Hned nahoře stálo, jak dlouho to potrvá, a nebylo to nějaké vymyšlené "pět minut" — bylo to číslo z toho konkrétního rozhovoru. Vedle toho dvě věcičky: *vede to AI* a *rozhoduje člověk*. A pak ten odstavec o umělé inteligenci — v češtině, kterou psal člověk, ne překladač. Že se posuzují moje dovednosti a vhodnost, že každé rozhodnutí o postupu, nabídce i zamítnutí přezkoumává člověk, že se nic nepříznivého nerozhoduje automaticky, a že si kdykoli můžu vyžádat přezkoumání člověkem. **To je přesně to, co jsem chtěla vědět, a nikdo mě k tomu nemusel nutit se doklikat.** Souhlas jsem musela odškrtnout sama a Start bez něj nešel — a co víc, zjistila jsem, že to není jen zašedlé tlačítko, ale že to server opravdu hlídá. To se cení. Tohle je poprvé, co mi firma řekla dopředu a narovinu, že mě bude poslouchat stroj.

A pak jsem začala mluvit. A tady mi to začalo být nepříjemné.

Otázky byly moje. Vážně moje — z mého životopisu, k té konkrétní pozici, ne obecné žvásty. To mě mile překvapilo, protože přesně tohle jsem čekala, že bude ta nejhorší část. Jenže když jsem odpověděla, přišla jedna doplňující otázka a šlo se dál. Kdybych byla někdo, kdo si to den předem nacvičil s ChatGPT, projde to úplně v pohodě, protože **to nikoho netlačí do hloubky.** A já — já jsem ten druhý typ. Já si věci rozmýšlím. Udělám pauzu, začnu větu znova, řeknu "vlastně ne, přesněji to bylo takhle". V normálním pohovoru s člověkem je tohle to, podle čeho poznáte, že někdo opravdu přemýšlí, a ne že odříkává. Tady jsem měla celou dobu pocit, že ta pauza jde proti mně.

A když jsem si potom v duchu srovnala, co ten stroj vlastně dostane k hodnocení, došlo mi, že ten pocit nebyl paranoia. Dostane přepis. Nic víc. **Nedostane můj životopis** — takže si ani nemůže ověřit, jestli to, co říkám, sedí s tím, co jsem napsala; a to je věc, o kterou bych stála, protože já *sedím*. Nedostane, že jsem se tři vteřiny nadechovala, protože jsem hledala slovo. Ono si to ty pauzy dokonce **spočítá** — a spočítá si je až *potom*, když už je odsouzeno. To mi přijde skoro absurdní: mají to změřené a použijí to na něco jiného.

A pětina mojí známky je za "srozumitelnost, strukturu a naslouchání". Za to, *jak* mluvím. Bez jakéhokoli popisu, co která známka znamená — u těch mladších to popsané mají, u mě ne. Takže někdo, kdo mluví plynule a sebejistě a neřekne nic, dopadne líp než já, která to mám promyšlené a řeknu to zaváhavě. Chápu, že komunikace k práci na pobočce patří. Ale ať mi tedy někdo napíše, kde je ta laťka, a ať to není o tom, jestli se zadrhnu.

Chci být fér: našla jsem tam i věc, která mě usmířila — když je rozhovor krátký nebo tenký, systém si sám řekne, že si tím není jistý, a označí hodnocení za předběžné, **výslovně proto, aby nervózní člověk nedoplatil na nervozitu.** Někdo na mě u toho kódu myslel. Jenže "nejsme si jistí" pořád znamená, že ta dvojka tam visí. Poznámka pod čarou nespraví číslo nad ní.

A poslední věc, ta nejhorší. Skončila jsem, zavřela okno — a nic. Na obrazovce mi to hezky řeklo, že si to náborář projde a ozve se. Ale do mailu nepřišlo nic. Žádné "děkujeme, přijali jsme váš pohovor". **A přesně tady jsem už jednou stála.** Zrovna po téhle fázi, kdy mě posuzoval stroj a já netuším jak to dopadlo, potřebuju v ruce něco, co mi zůstane. Jinak je to zase ta samá tichá díra, jenom modernější.

Doporučila bych to kamarádce? **Řeknu jí, ať do toho jde — a ať mluví plynule, ne pravdivě.** A to je na tom to nejsmutnější, protože ta firma si zjevně dala záležet na tom, aby to bylo poctivé. Otevřeně mi řekli, že mě hodnotí AI a že rozhoduje člověk, a to jim věřím. Jen si nejsem jistá, jestli ten člověk dostane na stůl mě — nebo jenom to, jak jsem ten večer zněla.

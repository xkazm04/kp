---
id: "0010"
title: The candidate interview keeps the provider brain and adds our director
status: accepted
date: 2026-09-18
supersedes: []
superseded-by: null
tags: [voice, interview, latency, architecture]
sources:
  - app/_lib/voice/director-types.ts
  - app/_lib/voice/director-tools.mjs
  - app/_lib/voice/director.ts
  - app/_lib/voice/director-step.ts
  - app/_lib/voice/resume.ts
  - app/_lib/db/interview-events.ts
  - app/api/interview/director/route.ts
  - docs/architecture/voice-conversation-plane.md
---

## Context

The AI voice interview at `/interview/[token]` runs the **provider-brain** design: the
realtime provider (OpenAI Realtime over WebRTC, or an ElevenLabs agent over WebSocket)
hears the candidate and decides each spoken reply itself, steered only by the brief it
was given at connect. The role-intake dialog moved to the opposite design in 2026-08 —
the **relay plane** in [voice-conversation-plane.md](../voice-conversation-plane.md),
where the provider is a speech transport and every reply is composed on our server —
and that document listed "migrate the candidate interview to this plane" as future
work.

Three forces bear on the choice for the candidate interview specifically:

- **Latency is the product.** A candidate is being assessed, not dictating a brief.
  The market bar for a live AI interviewer is roughly **700 ms p50** from the end of the
  candidate's utterance to the interviewer's first audio (Mercor's published engineering
  write-up, the figure the ai-interview-parity spark adopted). The provider brain meets
  it: speech-to-speech runs inside the provider. The relay plane's fast thread is
  "~seconds" per exchange, and its own design proposes a localized filler once a reply
  passes ~3 s — acceptable for a recruiter dictating a role, a visible defect for a
  candidate under assessment.
- **The interviewer must LEAD** (operator doctrine): hold the agenda, the clock and the
  frame, and resist a candidate who asks for a score or tries to rewrite its
  instructions. A provider brain left alone does none of that reliably — it improvises
  the order, overruns topics, and has no record of what it covered.
- **Evidence must be the candidate's words.** A covered topic has to be backed by a
  quote we can verify against the transcript (registry: structured-interview-scorecards,
  evidence-quote-requirement), and integrity observations must stay observations
  (ai-assistance-detection-and-fairness, observed-process-is-supporting-not-load-bearing).

## Decision

**Keep the provider brain for each spoken turn, and add our DIRECTOR around it.**

1. **An agenda with stable block ids** is built at connect for both providers and stored
   on `interview_sessions.agenda_json` (`InterviewAgenda` in `voice/director-types.ts`).
2. **The model leaves a record through tools** — `begin_topic`, `mark_topic_covered`,
   `report_guardrail`, `forward_question`, `end_interview` — one vocabulary
   (`voice/director-tools.mjs`) declared to OpenAI server-side and to the ElevenLabs
   agent as client tools. The browser routes each call to
   `POST /api/interview/director`, which records it in the append-only
   `interview_events` table (`db/interview-events.ts`) and answers the model.
3. **The server directs.** `voice/director.ts` derives the conversation's state from
   that record — active block, covered blocks, live time across dropped-and-resumed
   attempts — and issues at most one stage direction per exchange, prefixed
   `[Director]` and injected into the provider session by the browser. The policy is
   **coverage first, then clock**: no topic is cut before its budget; at budget the model
   is told once to ask a narrower question for a concrete instance; a block may overrun by
   up to half its budget within the agenda's slack; at the close reserve the interview
   skips to the candidate's questions; two minutes past the hard cap it ends.
4. **Provenance is checked, not trusted.** `mark_topic_covered` is accepted only when its
   evidence quote matches a persisted candidate turn (`app/_lib/quote-match.ts`);
   otherwise the model is told it was not recorded and to ask for a concrete instance.
5. **A reconnect resumes.** `voice/resume.ts` reads the same record so a second attempt
   continues from the active block with the earlier turns, instead of starting over.

## Consequences

- **The brief still reaches the provider.** OpenAI receives the private brief in its
  server-side session config; ElevenLabs still receives a client-sent, candidate-safe
  brief, so the client-sent-prompt seam the relay plane would have retired stays, and the
  allow-list sanitizers in `voice/candidate-brief.ts` stay load-bearing.
- **Directions transit the candidate's browser.** Directive text names blocks only by
  id and candidate-safe title; the director response is a projection with no
  competency, goal or brief in it.
- **Direction is advisory.** The model can ignore a stage direction; the director can
  repeat it (never inside 60 s) and, at the hard cap, tell the browser to end the call —
  but it cannot author a reply. The relay plane could.
- **ElevenLabs needs an agent redeploy.** Client tools are part of the agent's
  configuration (`scripts/setup-eleven-agent.mjs`), so every install running the
  ElevenLabs provider must re-provision its agent before the director hears from it.
  Until then that provider runs undirected, exactly as before.
- **A director outage never stalls a call.** Every failed exchange is answered
  "continue with the agenda" by the browser, and the handler itself answers every
  malformed tool call the same way. What an outage costs is direction, not the interview.
- **New surface to hold:** one public token route (per-token rate limit, coded
  refusals, body cap), one workspace-scoped table in the tenancy manifest, and one more
  table in the GDPR erasure scrub (the events hold the candidate's verbatim words).

## What would reopen this

- **The relay plane gets fast enough.** A relay fast thread measured at **p50 ≤ ~1 s**
  from end of utterance to first audio, on the audio-in-the-loop harness
  (`pipeline/jobfit/eval/voice/`), in both a Czech and an English run: the latency force
  is gone and the relay plane's control and brief privacy win.
- **The provider brain does not follow direction.** If the recorded events show the
  model ignoring `move_on` / `close_now` most of the time (say, no `begin_topic` for the
  named block within 60 s in more than half the directives across a real cohort), the
  director is theatre and the conversation has to be authored server-side.
- **A provider removes the seams this depends on** — mid-session instruction injection
  or client tools — or a customer's data-processing terms forbid the brief leaving our
  infrastructure at all.

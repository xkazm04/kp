---
name: voice-interview
promotion: discovery
surfaces: [Voice Interview, /interview/[token], /interview-lab, sub_interview/InterviewSimTab]
characters: [petra-recruiter, tereza-candidate]
language: both
---

# Voice interview — run / review an AI first-round screen

## Goal (in the user's words)
- **Tereza (cs):** "I got a link. I want to do the first-round interview now, from my phone, in
  Czech — and know a human still decides."
- **Petra (cs):** "Send the screen, then get back a transcript + a usable result I can act on —
  not raw audio I have to re-listen to."

## Definition of done (user POV)
- The candidate opens the link, consents, talks to the AI agent for the stated length, and sees an
  honest "completed / a human reviews this" close — not a dead Start button.
- The recruiter gets a transcript + a result attached to the right pipeline entry, in the same language.
- Length shown is the **real** grounded run-of-show length, not a hardcoded "5 minutes".

## Entry state / preconditions
- **Tereza:** a minted, unexpired **interview token** for a non-terminal entry (`env.md` fixture #5;
  without it her journey is `unreachable`, not failing). OpenAI Realtime **or** ElevenLabs key present.
- **Petra:** dev gate on; seeded pipeline; the entry the token belongs to.
- Keyless / no-voice-key run → AI quality findings are `scope_note`; structural L1 still applies.

## What L1 must check (structural, code-grounded)
- **Surface model / reachability:** Tereza reaches ONLY `/interview/[token]` — `app/interview/[token]/page.tsx:16-17`
  resolves the session by token and `notFound()`s otherwise; she never sees the Interview/Sim tab or `/interview-lab`.
  Confirm she needs the token fixture. Petra reaches the authed Interview sim tab + the transcript on the schedule/pipeline side.
- **Honest lifecycle states:** completed (`page.tsx:26-33`), revoked/expired (`:39-46`) render closed cards, not a broken call.
- **Grounding audit (the crux):** follow Start → `POST /api/interview/connect` (`app/api/interview/connect/route.ts:34`).
  Does the agent get the candidate's REAL context? Trace `instructions`/`groundedPrompt` (`:117-119,:148-151`):
  a **candidate-mode** session carries grounded questions; a tokenless **lab** session falls to `defaultInterviewerInstructions`
  + `QUICK_SCREEN_MIN` (`:122-131`) — generic. Flag if a real candidate session is still fed thin/default instructions
  (no CV, no JD, no comp band) — that's a senior-quality `quality-gap`.
- **Consent gate is server-side**, not just a disabled button (`:133-139`, `CONSENT_REQUIRED_ERROR`) — a trust strength to keep.
- **Denial-of-wallet guards:** bad/absent token refused before minting (`:56-61`); single-use after completed (`:70-72`).
- **Truthful duration** from `session.durationMin ?? GROUNDED_DEFAULT_MIN` (`page.tsx:24`, `interview-duration.mjs`).

## What L2 must confirm (live-only)
- **l2_priority — grounded path:** run a REAL candidate-token session (not the lab); assert the AI's questions reference
  *this* role/candidate, not generic small-talk. Verify the transcript + result land on Petra's entry via `/api/interview/by-entry`.
- **Real latency:** voice connect + turn-taking is the 15-130s-class call — an early client timeout on connect is itself a finding.
- **Bilingual:** Tereza's session runs in cs (`coerceLanguage`), Petra's review reads cs; no English leaking into the cs flow.
- **Rendering:** the run-of-show sidebar + AiDisclosure render in both themes; mobile width holds (`page.tsx:69-83`).
- **Fixture confirmed:** the token mint path (`env.md` open question #3) actually produces a session that `/connect` accepts.

## Out of scope / known
- Keyless / no-voice-key: connect 503s with a "set KEY in .env.local" message — drop one severity, `scope_note`.
- `/interview-lab` is a dev harness (gated by `INTERVIEW_LAB_ENABLED`, off in prod) — judge it as a dev tool, not a candidate surface.
- Interview *simulation* (`/api/interview/simulate`, text, no voice) is a separate sub-tab — covered structurally, not the headline here.

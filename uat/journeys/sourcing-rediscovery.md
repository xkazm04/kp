---
name: sourcing-rediscovery
promotion: discovery
surfaces: [Channels tab, Jobs tab, Match tab, "Sourcing, Campaigns & Rediscovery"]
characters: [jana-sourcer]
language: cs
---

# Sourcing, kampaň a rediscovery „stříbrných medailistů"

## Goal (in the user's words)
"Najdu lidi na roli, rozjedu oslovení a hlavně — vrátím se k těm, co kdysi těsně
nevyšli. Chci u každého vědět PROČ teď, ne jen že se shoda náhodou zvedla."

## Definition of done (user POV)
- For a role: a ranked candidate pool, an outreach campaign Jana can fire, and a
  **rediscovery list** of past applicants worth another look.
- Every rediscovered candidate comes with a **WHY-NOW** (why this person, this role,
  now) — not a bare re-score.
- The outreach copy is **on-brand** (ČS tone, real role/candidate context), not a
  generic template Jana would be embarrassed to send.

## Entry state / preconditions
- Dev gate on → workspace at `/`.
- ČS job corpus + a populated candidate pool including some rejected/closed-elsewhere
  candidates (so rediscovery has "silver medalists" to surface).

## What L1 must check (structural, code-grounded)
- **Surface model:** the recruiter candidate pool + rediscovery + campaign panels
  in `app/features/sub_jobs/RecruiterCandidates.tsx`, `RediscoverPanel.tsx`,
  `RediscoveryFeed.tsx`, `CampaignTab.tsx`; comms center in
  `app/features/sub_channels/CommsCenter.tsx`. All reachable for Jana (no role gating).
- **Grounding audit — rediscovery:** `/api/jobs/[id]/rediscover/route.ts:20`
  (`rediscoverForJob`, `app/_lib/rediscover.ts`) ranks the WHOLE pool against THIS
  job and filters to silver-medalists not already in it. Confirm the WHY-NOW is derived
  from real fit deltas, not a stock string; verify `skipped` (unscorable profiles) is
  surfaced (`route.ts:25`) so strong people aren't silently dropped.
- **Grounding audit — outreach:** `/api/jobs/[id]/candidates/outreach/route.ts:54`
  files the candidate via `createPipelineEntry` (idempotent) then drafts via
  `runAutomationTask("outreach")` (Claude CLI, `maxDuration=180`). Trace the draft
  prompt: does it get the real role title/family (from the **server-side job record**,
  `route.ts:43-51`, not the client body) + the candidate's profile? Thin context →
  generic copy = senior-quality `quality-gap`.
- **Reachability:** rediscovery returns the "No saved candidates" path if the pool is
  empty (shared `buildCandidatePool`); standing alerts (`/api/rediscovery/alerts`) need
  a publish+sweep to have fired.

## What L2 must confirm (live-only)
- l2_priority: run rediscovery on a real role and assert each WHY-NOW is **specific to
  that candidate** (cites their gap that closed / the role's new fit), not boilerplate.
- Fire one outreach and read the drafted message: ČS-branded, names the real role,
  sounds like a human first-touch. Confirm the dispatch is **once-only** (per-entry
  `outreach_sent` marker) and the candidate's button state persists on reload
  (`/api/jobs/[id]/candidates/route.ts:49-53`).
- Latency: the outreach draft spawns the Claude CLI — budget toward its **180s** ceiling;
  an early timeout is a finding.

## Out of scope / known
- The first-pass ranked shortlist + reasoning lens belongs to `jd-to-shortlist.md`.
- Inbound-channel webhook intake of applications → `comms-inbound-channels` scope.
- Keyless run: outreach draft degrades to deterministic copy; tag `scope_note`.

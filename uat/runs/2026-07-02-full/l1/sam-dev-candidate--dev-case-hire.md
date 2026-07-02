# L1 theoretical — Sam Okafor (International senior dev candidate) × dev-case-hire

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (code-derived surface model, no browser)
- **Verdict:** **L1-conditional** — with a minted token the leg completes structurally (open brief → work seed files → submit with identity), but three majors hit his exact walk-away triggers: the timebox overshoots his brevity bar 3–4×, the "live-work surface" is a plain textarea with no way to run anything, and his brief may render in Czech.
- **Grounding score (the AI surface he consumes):** case design **5/6** (see Eva's report §3) — the brief he reads is genuinely role/JD/codebase-grounded, not canned.
- **Estimated time saved (if it all worked):** **~1.5–2 h** vs the traditional half-day take-home (~4 h → brief + ≤2 h case, zero setup since the seed is in-browser) · **confidence: medium** — but measured against his own <30 min adoption bar, the design overshoots (see dch-l1-006).

---

## 1. Reachability check (BEFORE judging — his whole leg hangs on this)

Sam reaches **only** `/devcase/apply/[token]` (surface binding). The chain that mints his entry:

1. **Token mint:** publish → `LocalDistributionAdapter.publish` → `createPosting` with a CSPRNG 128-bit hex token (`app/_lib/distribution.ts:18-41`, `app/_lib/db/devcase.ts:378-395`). Resolution: `getPostingByToken` (`db/devcase.ts:416-431`); bad token → `notFound()` (`app/devcase/apply/[token]/page.tsx:24-25` — bare-URL 404 is a suppressed accepted-gap); closed posting → honest closure card (`page.tsx:31-39`).
2. **Invite delivery — real vs simulated (ship-bar evidence):** the link reaches him either (a) **manually** — Eva copies the apply URL from `ApplyTokenPill` (`ApplyTokenPill.tsx:30-41`, resolved through `publicBaseUrl` so it isn't a localhost link), or (b) via **comms** — but `sendComm` defaults to the local outbox where `queued` is a *terminal dev state* ("the outbox IS the delivery target", `app/_lib/comms.ts:34-42`); real delivery only with `COMMS_WEBHOOK_URL` (`comms.ts:97-100`). So delivery is **simulated by default and honestly documented** — already recorded run-wide as capst-l1-001; not re-raised here. Note additionally that the promote-invite (`devcase-orchestrator.ts:332-338`) and the intake ack (`distribution.ts:92-98`) **do not contain the apply link or the status link** — even a relayed invite would tell him "we'll be in touch", not where to work.
3. **Fixture verdict:** without env.md fixture #4+#5 (published case + minted token) the leg is **unreachable, not failing**. With the fixture (publish is one click in the studio) it is fully reachable. L2 preflight: publish a case, copy the pill URL.

## 2. Surface model — what Sam actually meets (file:line)

- **The page** (`page.tsx:22-98`): eyebrow + title + subtitle, **AI disclosure with data-consent line** (`page.tsx:69-72`, jurisdiction-aware — `AiDisclosure.tsx:20-63`), the brief rendered from `caseToMarkdown` which **excludes probes by construction** (only title/meta/brief/repoSeed/tasks — `DevHelpers.ts:37-58`; probes/rubric/role live in internal panels on Eva's side only, `CaseDetail.tsx:144-181`). Timebox is shown to him ("~2h timebox", `DevHelpers.ts:47`).
- **One submit path** (`page.tsx:84-95`): seed present → `LiveWorkSurface`; no seed → repo-link `DevApplyForm`. Never both.
- **LiveWorkSurface** (`LiveWorkSurface.tsx`): file list + a `<textarea>` editor (`:181-194`) over the materialized seed; session minted lazily on first interaction so a reader never orphans one (`:47-66`); observed events (open/edit/decision_log/paste magnitude — never keystrokes/screen) + the file tree flush every 8 s (`:76-104`); identity (name + validated email) required before submit (`:26-30,197-213`); double-submit guarded, error retryable, success state confirms "your work and the process behind it were captured" (`:120-156`, `messages/en.json:2657-2663` — natively fluent English).
- **Server side:** session start validates token + open posting (`app/api/devcase/session/route.ts:10-25`); flush coerces candidate-controlled payloads with caps (`session/[id]/route.ts:10-46`); submit finalizes atomically + idempotently (`session/[id]/submit/route.ts:9-30`, `db/devcase.ts:576-608`).

## 3. Cognitive walkthrough — scored acceptance criteria (identical every run)

| Criterion | Verdict | Evidence |
|---|---|---|
| **effort / time-saved** — brief and real, ≈<30 min | **FAIL → major** | the case designer's timebox is 1.0–2.0 h by seniority with a 2 h HARD cap (`design.py:31-34`); the LLM's longer estimates are clamped (`design.py:396`) — the half-day trap is genuinely dead, but a senior case ships at ~2 h, 4× his stated budget, and the number is shown to him (dch-l1-006) |
| **completion** — the live surface actually works | **PASS structurally / major reservation** | loads seed, accepts input, saves via 8 s flush with re-buffer on failure (`LiveWorkSurface.tsx:76-104`); but it is a plain textarea — no syntax highlighting, no test runner, no execution — while the case's own verification-trap asks him to *check his work* (`design.py:253-256`); "make your change safe — show how you checked it" cannot be done in-surface (dch-l1-007) |
| **clarity** — natively fluent English | **PASS for chrome / risk for the brief** | `devApply` copy is fluent (`en.json:2655-2683`); but the brief's language follows the RECRUITER's locale on the auto path (`lifecycle/route.ts:35`) with no authoring override (`NeedForm.tsx` has no language field) — a cs-authored case hands Sam a Czech brief inside English chrome (dch-l1-004) |
| **senior-quality** — measures human-AI judgment, not puzzle recall | **PASS (structural)** | the case assumes his code is LLM-generated and probes clarifying/reading-first/verification via ambiguity + a forced DECISIONS log (`design.py:249-259`); the eval explicitly never penalizes AI use (`reflect.py:224-227`, `process_events.py:120`) — this is the case he says he'd actually take |
| **trust** — AI-use disclosure an engineer takes seriously | **PASS** | `AiDisclosure` with consent + regime line (`page.tsx:72`); the work-surface intro states exactly what is observed and what is not ("process… recorded", "never keystrokes or your screen", "You may use any tools, including AI" — `en.json:2658`) — honest and specific (dch-l1-011) |
| **missing / completion** — evidence his effort mattered | **PARTIAL → major** | in-UI confirmation: yes (`LiveWorkSurface.tsx:149-156`). But the live-surface submit — the SOLE path for workspace cases (`page.tsx:84-88`) — never queues the acknowledgement comm and never resumes a collecting auto-lifecycle, unlike the repo/webhook paths (`session/[id]/submit/route.ts:20-26` vs `submit/route.ts:25-34` + `distribution.ts:88-99`); the page's own comment still claims "ack comms + lifecycle resume come free" (`page.tsx:17-21`). His work sits until a human clicks Evaluate — structurally, the void he holds against employers (dch-l1-005) |

## 4. Findings (see `dev-case-hire.findings.json`)

Majors: **dch-l1-004** (brief language follows recruiter locale; no override), **dch-l1-005** (live submit: no ack, no lifecycle resume — also bypasses the closed-posting guard), **dch-l1-006** (2 h senior timebox vs <30 min bar), **dch-l1-007** (textarea, no runner — verification tasks impossible in-surface). Strengths: **dch-l1-011** (disclosure/consent/observation transparency + identity capture), **dch-l1-013** (fairness contract — AI use never penalized, engineered and eval-gated).

## 5. Character feedback — Sam, first person (voice: direct, terse)

> Credit where due: this is the first take-home that admits my code will be AI-written and tests something real anyway. The brief tells me what's watched and what isn't — process artifacts, not keystrokes — and says outright I can use any tools. That's how you talk to an engineer in 2026. The probe stuff is invisible from my side, the English copy reads like a human wrote it, and I don't have to clone anything — the files are right there.
>
> Now the problems. The page says "~2h timebox." Two hours. I said thirty minutes; I've walked away from less. It's not a leetcode trap — it's real work — but it's real *unpaid* work, times four over my budget.
>
> And the "live work surface" is a textarea. One box, monospace, no runner, no tests. The case literally asks me to verify my change — verify it *where*? I'd be alt-tabbing to my own machine, pasting back in… which, ironically, is the exact behavior their authenticity thing is supposed to flag. If you want to watch me work, give me a surface worth working in.
>
> Submit worked, screen said "captured, the team will review it." Then — per the code — nothing. No email, and the recruiter's automation doesn't even wake up for my submission; someone has to notice me manually. I've been in that queue before. If the brief also shows up in Czech because the recruiter's UI was Czech, I'm gone in the first ten seconds.
>
> Would I finish it? If the role's worth it, probably — once. Would I tell a peer it respects your time? Not yet. Fix the length, give the editor hands, and close the loop after submit — then yes.

## 6. L2 handoff (l2_priority)

1. **dch-l1-004:** author from cs locale → open the token page as Sam (en) → what language is the brief/tasks/seed README?
2. **dch-l1-007:** live feel — edit a multi-file seed in the textarea for 10+ min; latency of the 8 s flush; does anything fight him? (theme check: both themes on the token page.)
3. **dch-l1-005:** after a live submit — outbox has no ack row? lifecycle still "collecting/awaiting submissions"?
4. **dch-l1-006:** honest timing of a real generated senior case — can it truly be finished inside its own printed timebox?
5. Fixture preflight: publish a case → copy the ApplyTokenPill URL (resolves env.md open question #3 for the devcase flow).

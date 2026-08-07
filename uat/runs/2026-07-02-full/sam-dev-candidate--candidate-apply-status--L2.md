# L2 empirical — Sam Okafor × candidate-apply-status

- **Run:** 2026-07-02-full · live `http://localhost:3009` (dev, `DEV_AUTH=0`, en, desktop 1440×900) · cert level: **L2 (empirical, live browser)** · HEAD = 3395b4c (identical to the L1 baseline)
- **L1 handoff:** `l1/sam-dev-candidate--candidate-apply-status.md` (L1-conditional; capst-l1-001 carried) · scope: apply in English, status transparency, AI disclosure — his dev-case surface is a different journey
- **Verdict:** **L2-conditional** — the flow itself passed his bar with room to spare (CV → pre-filled identity in seconds, grounded questions, fluent English, minimal status projection, live stage movement). The carried major holds exactly as predicted: the durable "signal loop" is a **queued-terminal outbox row he can never read**, and the new L2 finding sharpens it — the GDPR erasure link inside that unreadable e-mail is **also a dead relative path**.
- **Time-saved (re-measured):** with the CV upload, the identity steps cost him **two confirm-clicks instead of typing** (extraction on his .txt was effectively instant; name + e-mail pre-filled with the "Filled in from your CV — please check it's right" hint live). Whole application: scripted wall-clock **8.0 s**; realistic ~**1.5–2 min**. vs. a typical bank-ATS account-wall + long form (~15–20 min): **~15–18 min saved, high confidence** — plus status transparency no ATS he's used gives him.
- **Grounding (vs L1's 9/11):** **live-confirmed.** The greeting named his exact role and company ("Senior Java Backend Engineer – George Core Banking at Česká spořitelna"); the KO gates carried the job's real facts (Praha – Michle / hybrid / Czech · English); his GitHub handle persisted onto the entry (`github_handle: "samokafor"`); the disclosure's regime line **resolved live on the public page with no auth** ("Assessed under EU equal-treatment directives; your personal data is processed under GDPR" — the `/api/compliance` fetch worked). The profile build succeeded (`intake_degraded: 0`) — he landed as a real, matchable candidate, not a stub.

---

## 1. The walk (en, terse, senior — reconstructed from captured evidence)

**Beat 1 — `/apply/job-029` (shot `l2-capst-sam-02-name-prefill`).** No account wall. "A quick chat — no forms, no logins." I attach my CV (.txt) — the next prompt appears immediately, my name is **already in the input box**, flagged "Filled in from your CV — please check it's right." Editable default, not an auto-submit. Same at the e-mail step. This is the correct pattern and almost nobody ships it. ✓

**Beat 2 — the questions.** Archetype (three honest options), one experience question, skills, an **optional-with-skip** GitHub step that validated my handle inline and persisted it for the recruiter's deep-dive (DB: `github_handle: "samokafor"`), then three knockouts derived from the actual role — work authorization *in Praha – Michle*, *hybrid* mode, *Czech / English*. Every step had a reason to exist. The English is written, not machine-translated — no awkwardness anywhere in the flow (`messages/en.json` confirmed live). ✓

**Beat 3 — submit → "You're in 🎉" (shot `l2-capst-sam-90-done`).** Instant accept with **"Track your application status"** → `/status/as-7D4xKPgk…`. The disclosure sat under the chat the whole time: names what the AI assesses, the live-resolved regime line, retention + erasure sentence. One sentence I still flag: *"nothing adverse is decided automatically"* — rendered verbatim live, and the codebase still contains the KO auto-decline and the batch-approved auto-reject wave (**capst-l1-004 confirmed**, minor: precision, not a black box).

**Beat 4 — the outbox truth.** My acknowledgement exists: addressed to **my real e-mail**, subject "We received your application — Senior Java Backend Engineer – George Core Banking", body carrying the **same** status token as the in-page link (single mint verified) — and it is `queued` / `channel: outbox`, the documented **terminal** state. No `COMMS_WEBHOOK_URL`, no mail provider in the tree. **capst-l1-001 confirmed live**: if I close the tab without bookmarking, the durable touchpoint is a row in the recruiter's UI. And I read the e-mail body closely: the status link is absolute, but the "review or erase your data" link is `/data/er-…` — **a relative path inside an e-mail**. `dataFooter` calls `publicBaseUrl()` with no origin and no configured base, so it resolves to empty (**capst-l2-102**, new). Two links, one e-mail, two different URL disciplines — that's the kind of inconsistency that fails code review.

**Beat 5 — `/status/[token]` live movement (shots `l2-capst-sam-31-status-underreview`).** Fresh page: "Received" reached. A recruiter then moved me to Screened in the workspace drawer; my page flipped to "**Under review** — A recruiter is reviewing your profile." I checked the API surface again at L2: the JSON is still four fields — status, jobTitle, company, updatedAt. No entry id, no score, no reasoning. Minimal surface, unguessable token. Respect. ✓

## 2. L1 handoff — l2_priority answers

| # | L1 question | L2 answer | Verdict |
|---|---|---|---|
| 1 | What can he actually receive — outbox vs relay? Ack links? | Outbox only (`queued` terminal; no relay configured). Ack carries the working absolute status link + a **broken relative** erasure link. | **capst-l1-001 confirmed** (+ new capst-l2-102) |
| 2 | Grounded path on a real ČS digital/IT role | job-029, prompts named role/company/location/mode/languages; entry landed **Accepted, healthy** (not degraded), visible on the recruiter board; status link showed the live stage after the drawer move. | **confirmed — strength** |
| 3 | CV upload live: latency + pre-fill hint | .txt extraction effectively instant; name AND e-mail pre-filled as editable defaults; hint shown at both steps (run JSON: `{"value":"Sam Okafor","hintShown":true}`, `{"value":"sam.okafor.uat@example.com","hintShown":true}`). No early timeout. | **confirmed — strength** |
| 4 | Disclosure regime line resolves on the public page, no auth | Rendered live: "Assessed under EU equal-treatment directives; … under GDPR" in an anonymous session. | **confirmed** |

## 3. Scored acceptance criteria (his fixed lens; dev-case items out of scope here)

| Criterion | L2 verdict | Evidence |
|---|---|---|
| **effort/time-saved** — brief and real | **PASS** — ~10 interactions, CV pre-fill, scripted 8.0 s wall; nothing asked twice | `l2-capst-sam-run.json` |
| **completion** — live-work surface | out of scope (dev-case journey) | — |
| **clarity** — natively fluent English | **PASS** — zero machine-translation smell across apply/status/disclosure, live | shots + text dumps |
| **senior-quality** — real signal, not puzzles | out of scope here; the intake was sane and role-grounded, and my GitHub persisted as evidence | DB `github_handle` |
| **trust** — AI disclosure an engineer takes seriously | **PASS with the caveat held** — specific, jurisdiction-aware, live-resolved; the absolutist "nothing adverse is decided automatically" sentence still overclaims (capst-l1-004) | `-90-done.text.txt` |
| **missing/completion** — evidence his effort mattered, not a void | **CONDITIONAL** — in-page ack + durable-looking status link + live stage movement = real signal *if I keep the tab/bookmark*; the push half is an outbox row I can't read (capst-l1-001), with a dead erasure link inside (capst-l2-102) | dev_outbox row; shots |

## 4. Findings

See `candidate-apply-status.l2-findings.json`. His view, impact-ranked: **capst-l1-001** (confirmed — the delivery seam is the one thing between this flow and "best apply UX I've used"), **capst-l2-102** (new — dead relative erasure link; also the inconsistency signal), **capst-l1-004** (confirmed — precision of the disclosure sentence), **capst-l1-005** (confirmed accurate-today — TTL is exactly 12 months live; the copy/env drift risk stands). Strengths confirmed: capst-l1-007 (minimal candidate-safe projection + live movement), capst-l1-008 (CV pre-fill + optional GitHub + grounded KOs), capst-l1-009 (deterministic locale-pinned comms — ceiling: undeliverable by default and the footer link is relative).

## 5. Sam's feedback (first person, over the live product)

"Ran it for real this time. Verdict as a code review: approve with two blocking comments — neither of them about the UX.

The flow is the best I've used from a bank, full stop. I attached my CV and the chat pre-filled my name and e-mail as *editable defaults* with a visible 'check it's right' hint — that's the correct implementation, and I've never seen an ATS do it. Every question was about the actual role — the knockouts quoted the real location, the real hybrid setup, the real language pair. My GitHub handle was optional, validated inline, and actually landed on my record. Ninety seconds, and I got a status link that shows real movement — a recruiter touched my application and my page said so, in plain words, leaking nothing. I checked the API: still four fields. Whoever built that projection thinks about attack surface. Respect.

Blocking comment one, unchanged from the paper review: every message this system 'sends' me — including the acknowledgement holding my only durable copy of that status link — is a row in a local outbox table marked queued, which your own docs call terminal. No relay configured, no mail provider in the dependency tree. Ship a sender or stop writing 'we'll be in touch'.

Blocking comment two, new, found by actually reading the e-mail body: the status link is absolute, the GDPR 'erase your data' link right below it is `/data/er-…` — relative. In a mail client that's a dead link. Same file builds both; one takes a request origin, the other calls `publicBaseUrl()` into an unset env and silently emits garbage. The erasure page itself is genuinely good — I opened it, it's honest about what's kept after anonymization — which makes shipping a broken pointer to it worse, not better.

Small thing: the disclosure still says 'nothing adverse is decided automatically' while the repo contains an auto-decline gate and an auto-reject wave. Batch-approved, sealed, audited — fine, so *say that*. Engineers trust precision.

Would I keep talking to this employer? Yes. This respects my time more than anything else in the funnel. Close the delivery seam and fix the link discipline before a real candidate closes the tab."

**Adoption:** yes for the flow; the loop-closure promise stays conditional on delivery. **Would he tell a peer:** "apply through the chat, bookmark the status link, don't wait for e-mail."

## 6. Appendix — evidence & adversarial notes

- **Evidence set:** `shots/l2-capst-sam-02-name-prefill` (+ .text/.aria — greeting names role+company, pre-fill hint visible), `-03-github`, `-90-done` (+ .text — full conversation, disclosure, status CTA), `-31-status-underreview`, `l2-capst-sam-run.json` (per-step timings incl. prefill captures), `l2-capst-recruiter-30-sam-screened-*`; DB: his `pipeline_entries` row (Accepted→Screened, en, `github_handle`, `intake_degraded: 0`, consent +12 mo), his `dev_outbox` ack (body quoted).
- **Adversarial:** the "instant extraction" is honest for a .txt (the text extractor short-circuits; a PDF would exercise the model path — not covered this run, noted). The queued-terminal claim re-verified against `comms.ts:36-42` + absence of `COMMS_WEBHOOK_URL` in `.env.local` + hours-old seeded rows still queued. The conversational surface runs keyless/deterministic by design (server-built script, no runtime LLM turn) — so no AI-latency finding applies here; the 30–130 s budget never engaged.
- **Not covered:** PDF CV extraction latency; the dev-case surface (his main journey — separate); dark theme (no toggle exists on candidate pages).

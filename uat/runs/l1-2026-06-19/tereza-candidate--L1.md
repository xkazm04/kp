# L1 — Tereza Králová (Czech job candidate) — 2026-06-19

**Character:** Tereza Králová · retail/branch candidate at Česká spořitelna · applies on her phone in the evenings · pet peeve #1 = ghosting. Surface binding: tokenized public pages only (NOT the workspace).

**Method:** L1 theoretical (code-grounded, no browser). Surface model built from the real candidate-facing routes/components and their import chains. Reachability resolved first: every candidate surface is token-gated; the local token-mint path (env.md open Q#3) is unresolved, so these journeys are **L1-evaluable on the DESIGNED experience from code** and tagged `unreachable` for L2 until a token fixture exists. `/apply/[id]` needs only an open job id, and its submit self-mints the `/status` token — the one self-bootstrapping leg.

---

## Per-journey verdicts

| Journey | Verdict | blocker | major | minor | strength |
|---|---|---|---|---|---|
| candidate-apply-status | **L1-conditional** | 0 | 1 (token reachability) | 1 | 3 |
| voice-interview | **L1-pass** | 0 | 0 | 1 | 1 |
| offer-onboarding | **L1-conditional** | 0 | 1 (on-page accept dead-end) | 0 | 2 |

Reachability major (`tereza-token-reachability`) is a fixture/env gap, not a product defect on this surface — it bounds L2, not the designed quality. The offer-onboarding major (`tereza-offer-accept-deadend-onpage`) is a genuine product gap on her most-feared dimension.

---

## Journey 1 — candidate-apply-status → **L1-conditional**

**Surface model.** `/apply/[id]` (server component, `app/apply/[id]/page.tsx`) resolves the real job, honours lifecycle (closed role → honest card, draft → notFound, `:31-41`), and builds the chat script server-side from the real job (`buildApplyScript(job, t)`, `_lib/apply.ts:99-247`) so knockout questions are tied to the role's own `location`/`workMode`/`languages` — not boilerplate. `ConversationalApply` paints the first prompt on hydration, resumes a draft on refresh, validates email/GitHub inline, and on submit POSTs to `/api/apply/[id]`, which records consent (`recordEntryConsent(entry.id, "apply")`, `route.ts:448`), dispatches an acknowledgement comm (`dispatchApplicationReceived`, `:474`), and returns a `statusToken` (`:487`). `/status/[token]` renders the received→hired timeline with a "now" line and dedicated `not_selected`/`withdrawn` terminal cards (`status/[token]/page.tsx:77-116`).

**Grounding audit.** PASS — the apply script is built from the real job, KO questions are role-derived. Consent disclosure (`AiDisclosure showDataConsent`) is mounted before the action and states "AI assists, a human decides" + the GDPR retention line; 365-day TTL; erasure footer in every comm.

**Walkthrough (in character).** Will I try it? Yes — a link, no account wall. Will I finish? Yes, in a handful of taps, CV/GitHub skippable, draft survives a lost signal. Do I see progress? Yes — a "Track status" link the moment I'm in, and a status page I can re-open. No silence: an ack email fires, and a rejection becomes a not-selected card, never a black hole.

**Findings.** `tereza-status-no-ghosting` (strength), `tereza-consent-honest` (strength), `tereza-comms-human-czech` (strength), `tereza-apply-quick-real` (minor — short but a 8-10-turn chat is a touch more than the literal "couple of minutes"), `tereza-token-reachability` (major — fixture/env, bounds L2).

---

## Journey 2 — voice-interview → **L1-pass**

**Surface model.** `/interview/[token]` (`app/interview/[token]/page.tsx`) resolves the session by token, `notFound()`s otherwise, and renders honest closed cards for completed/revoked/expired (`:26-46`) — never a dead Start button. Duration is the grounded run-of-show length, not a hardcoded 5 min (`:24`). The client (`VoiceInterview.tsx`) gates Start on an unchecked consent box (`:91,:693`); `/api/interview/connect` enforces consent server-side before minting credentials (`:137-139`), refuses bad/expired/terminal tokens, and is single-use after completed (`:70-98`).

**Grounding audit.** CONDITIONAL — candidate-mode sessions carry `groundedPrompt` (`connect/route.ts:151`), but instructions fall back to `defaultInterviewerInstructions({role})` (`:117-119`) if the session wasn't created with grounded context. So grounding depends on the recruiter-side create path; invisible to Tereza, but the "good machinery fed thin context" risk → `tereza-voice-thin-grounding` (minor, `uncertain`, L2 to confirm).

**Walkthrough.** I open the link on my phone, see a Czech "AI-led, a human decides" badge and a real length, tick consent, and talk. If I already did it, I get an honest "completed" card, not a broken call. A human still decides — that's the reassurance I needed.

**Findings.** `tereza-voice-consent-server` (strength), `tereza-voice-thin-grounding` (minor). No majors → clean to L2 (keyless caveat: voice quality is `scope_note` without a key).

---

## Journey 3 — offer-onboarding → **L1-conditional**

**Surface model.** `/offer/[token]` shows the real company/role/salary/currency/deadline from the entry (`offer-finalize.ts:149-165`; `offer/[token]/page.tsx:178-192`), a letterhead strip, a coral <48h countdown, and a confirm-gated decline with focus on the safe option (`:241-282`). Accept POSTs `/api/offer/[token]` → `respondToOffer` → Hired + `startRun` + `dispatchOnboarding(hired, offer.token)` (`offer-finalize.ts:96-110`): **the offer token doubles as the onboarding token.** `/onboarding/[token]` is a real Czech pre-boarding questionnaire that saves back to the recruiter hand-off (`onboarding/[token]/page.tsx:21-28,144-184`).

**The crux.** The onboarding next-step EXISTS and is reachable at the same token (strength `tereza-onboarding-concrete-step`). BUT the **offer accept page itself** renders only `acceptedBodyCompany` = "Vítejte ve společnosti {company}! Náš personální tým se vám brzy ozve..." (`page.tsx:194-200`; `cs.json:485-487`) with **NO inline link** to `/onboarding/[token]`. The concrete step is delivered only by a separate email (`comms-dispatch.ts:362-365`). On the page where she just clicked Accept, Tereza sees the exact "we'll be in touch then silence" copy that is her #1 pet peeve — and has to leave for her inbox to find the step that already sits at the same token. → `tereza-offer-accept-deadend-onpage` (**major**; one `<a href={`/onboarding/${token}`}>` closes it).

**Walkthrough.** I accept — and the screen says "HR will be in touch." My stomach drops; that's the sentence that's burned me before. The next step does exist (in my email), but right here, in the moment I said yes, I'm handed a promise, not a door.

**Findings.** `tereza-offer-accept-deadend-onpage` (major), `tereza-onboarding-concrete-step` (strength), `tereza-offer-salary-grounded` (strength).

---

## Tereza's first-person verdict (L1, over the designed experience)

> Honestly? This is the first hiring process in a long time that looks like it was built by someone who's been ghosted too. I can apply from a link on my phone, in Czech, in a few taps — no "create an account" wall, no twenty boxes pretending to be a "two-minute" form. And then the thing I never get: a link that tells me where I stand. Received, under review, interview, offer — I can just look. If they say no, it's a real, kind Czech message ("Není to odraz vašeho potenciálu"), not silence. Nobody hides the AI from me; they tell me a machine helps and a person decides, and I agreed to that knowing what it meant.
>
> The voice interview I'd actually do — it's clear a human still calls it, and the link doesn't break if I already did it. My one worry is whether the AI will really ask about *this* branch job or just make small talk; I can't tell that from here.
>
> The one moment that made my old fear flare: I accept the offer, and the screen says "our HR team will be in touch." That's the sentence. I know now the real next step is sitting in my email — but in that moment, on that page, I'm holding a "congrats" and a promise, not a door. Put the onboarding link right there, the way you put the status link right there after I applied, and you'd have nailed it.
>
> Would I tell a friend at the bank to apply here? Yes — with the note that the very last step still leaves you hanging for a second longer than it should.

---

## L2 hand-off (carry forward)

1. **RESOLVE env Q#3 first** — mint candidate tokens locally (status auto-mints on apply; interview/offer/onboarding need a path). All three journeys are `unreachable` at L2 until then.
2. **Offer accept on-page link** (`tereza-offer-accept-deadend-onpage`, major) — confirm live the accept page shows no onward link and the step is email-only.
3. **Voice grounding** (`tereza-voice-thin-grounding`) — run a real candidate-token session; assert role/candidate-specific questions, not defaults.
4. **Comms prose live** (`tereza-comms-human-czech`) — render each Czech comm with real seeded values; check grammar/declension on interpolated role names.
5. **Apply timing** (`tereza-apply-quick-real`) — count taps + time the real mobile chat; check no "2-minute" copy oversells it.

---
name: candidate-apply-status
promotion: discovery
surfaces: [Application Intake & Apply Flows, /apply/[id], /apply/[id]/quick, /status/[token], Privacy Consent & Provenance]
characters: [tereza-candidate, sam-dev-candidate]
language: both
---

# Candidate apply → status — fast apply, no ghosting, honest AI use

## Goal (in the user's words)
- **Tereza (cs):** "Let me apply in a couple of minutes from a link, in Czech, and then actually
  SEE where I stand without emailing anyone."
- **Sam (en):** "I'll apply in English. Tell me plainly that AI reads my application and that a
  human still decides — and don't dark-pattern my consent."

## Definition of done (user POV)
- Apply is genuinely quick (conversational chat OR quick form) and finishes in the candidate's language.
- A status link shows received → under review → interview → offer → hired without contacting the recruiter.
- AI-use + GDPR data-processing disclosure is visible at the point of consent; submitting IS the consent,
  with a stated retention window and an erasure path — not a buried checkbox or a pre-ticked trap.

## Entry state / preconditions
- **Tereza:** an open, published job id for `/apply/[id]` (cs); a minted **status token** for `/status/[token]`
  (`env.md` fixture #5 — without it the status leg is `unreachable`).
- **Sam:** same, in en; optionally the `?lead=` enrichment token path.
- No AI key needed for the apply chat itself (script is localized server-side); follow-up enrichment may use AI.

## What L1 must check (structural, code-grounded)
- **Reachability:** both candidates reach ONLY `/apply/[id]`, `/apply/[id]/quick`, `/status/[token]` — never the workspace.
  `/apply/[id]` resolves the job and gates on lifecycle (`app/apply/[id]/page.tsx:21-41`): a closed role shows an honest
  card, a draft `notFound()`s. Status resolves by token (`app/status/[token]/page.tsx:33-42`). Confirm the status fixture.
- **"Quick" is real:** the script paints on hydration with no round-trip (`apply/[id]/page.tsx:42-47`), and `?lead=` prefill
  trims already-answered steps (`:58-75,94`) so an emailed link is never worse than no token. Count steps — if the
  "conversational" path is longer than a plain form, that's an effort finding for Tereza.
- **No-ghosting / status visibility:** `/status/[token]` renders the full timeline with a current-step "now" line and
  terminal not-selected/withdrawn states (`status/[token]/page.tsx:77-116`) — a strength against the 53%-ghosted research anchor.
- **Consent / AI disclosure (the crux — not a dark pattern):** the apply surface mounts `<AiDisclosure ... showDataConsent />`
  (`apply/[id]/ConversationalApply.tsx:601`); the component states "AI assists, a human decides" + the GDPR retention line
  (`app/_components/AiDisclosure.tsx:7-13,36`). Verify submitting records consent with a 12-month expiry + erasure link
  (consent.ts `CONSENT_TTL_DAYS`, `recordEntryConsent`) and that nothing is pre-ticked. Recruiter-side consent gating is
  `/api/pipeline/[id]/consent` (`app/api/pipeline/[id]/consent/route.ts`).
- **Grounding audit:** the chat script is built from the REAL job (`buildApplyScript(job, t)`, `apply/[id]/page.tsx:47`) — KO
  questions tied to the role, not a generic template. Flag if knockout questions are role-agnostic boilerplate.

## What L2 must confirm (live-only)
- **l2_priority — grounded/non-default path:** apply against a REAL seeded job; assert the prompts name that role; complete it
  and confirm the entry appears in the recruiter pipeline as Accepted; then open the status token and see the live stage.
- **Comms cadence:** an acknowledgement is sent on submit (Communications context) — verify the candidate isn't left silent.
- **Bilingual switch:** Tereza cs (LanguageSwitcher on the apply header, `apply/[id]/page.tsx:84-86`), Sam en — prompts re-render
  in the chosen language with no leaked strings.
- **Rendering:** apply chat + status timeline in both themes; mobile width.

## Out of scope / known
- Provenance dossier internals (how each derived field is justified) — exercised structurally, deep audit is the DPO's journey.
- Inbound channel webhooks that also create entries (Communications context) — adjacent, not the candidate-facing scope here.

# L1 — Tereza Králová (candidate) × offer-onboarding

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L1 (theoretical, code-grounded, no browser)
- **Verdict:** **L1-conditional** — once the link is in her hands, the designed experience
  is genuinely strong (no dead-end, deliberate decline, honest expiry, AI disclosure).
  The majors are about what reaches her mailbox: the delivery seam (outbox-by-default,
  name-not-address recipients), a possibly mixed-language offer email, and a terminal
  expiry that produces no message.
- **Grounding score (offer-draft AI surface):** **4/8**
- **Estimated time saved (if it all works live):** **~30 min of chasing avoided + the
  next step known the second she accepts (vs days of "People will be in touch" silence) ·
  medium confidence**

## Surface model (her two legs)

**Leg 1 — `/offer/[token]`** (`app/offer/[token]/page.tsx`)
- GET `/api/offer/[token]` → `offerView` lazily lapses a due offer, then returns status +
  jobTitle + candidateLabel + salary + currency + company (resolved from the job record) +
  expiresAt (`app/api/offer/[token]/route.ts:11-16`, `app/_lib/offer-finalize.ts:156-173`).
- The card: letterhead strip + company monogram (`page.tsx:156,196-209`), comp block with
  locale-formatted number and the offer's OWN currency — omitted rather than fabricated
  when unknown (`page.tsx:220-231`), deadline countdown turning coral inside 48 h
  (`page.tsx:267-280`, `app/_lib/offer-policy.ts:83-88`), AI disclosure pre-decision
  (`page.tsx:367`).
- Failure modes are separated by design: invalid token → its own "invalid link" card
  (`page.tsx:158-162`), load failure → retryable (`:163-173`), POST failure → inline
  banner that keeps the buttons (`:281-289`), ambiguous POST → authoritative reconcile
  (`:105-118`), past-deadline POST → 410 → definite expired card (`route.ts:32-34`,
  `page.tsx:132-135,255-261`).
- Decline goes through an `alertdialog` confirm with focus moved to the safe "Go back"
  (`page.tsx:48-56,290-331`); accept/decline POST is rate-limited per caller+token
  (`route.ts:23-25`).

**The seam between legs — how the link reaches her (THE money path)**
- The letter is dispatched with the tokenized response footer
  (`app/_lib/comms-dispatch.ts:235-246`) through `sendComm` → **local Outbox, terminal
  status `queued`, by default**; a real relay exists only when `COMMS_WEBHOOK_URL` is set
  (`app/_lib/comms.ts:13-17,36-42,97-100`).
- Recipient resolution: her captured apply `contact` if she came inbound, else her display
  NAME, else an id, else the literal `"candidate"` — never guaranteed an address
  (`comms-dispatch.ts:49-68`). A relayed send to a bare name dead-letters (loudly:
  `comms.ts:91-94`).
- Detached sends (T-48h nudge, onboarding footer, pre-boarding nudge) build the link from
  `publicBaseUrl()` with NO request origin — if `APP_BASE_URL`/`NEXT_PUBLIC_APP_BASE_URL`
  is unset, the emailed link is a host-less path (`app/_lib/public-base-url.ts:30-42`,
  `comms-dispatch.ts:431-433`, `app/_lib/offer-reminders.ts:30-31`,
  `app/_lib/preboarding-reminders.ts:33`).
- **Net:** the structural chain to a real mailbox exists (inbound contact + relay + base
  URL), but every default is the simulated half. Nothing on any candidate-facing surface
  lies about it (the Outbox is an honest audit log) — but for Tereza, undelivered equals
  the ghosting she fears.

**Leg 2 — `/onboarding/[token]`** (`app/onboarding/[token]/page.tsx`)
- Accept flips her offer token into the onboarding credential — no second token to lose:
  accepted card links `/onboarding/${offer.token}` inline (`app/offer/[token]/page.tsx:239-248`),
  the welcome email carries the same link (`offer-finalize.ts:109-111`,
  `comms-dispatch.ts:423-437`), and the resolver accepts only an ACCEPTED offer's token
  (`app/_lib/onboarding-candidate.ts:17-24`) — an unaccepted/declined token 404s, leaking
  nothing.
- The run is ensured idempotently on accept AND lazily by the page (`offer-finalize.ts:97-107`,
  `onboarding-candidate.ts:21-22`), so the link works even if the accept-time hook failed.
- The questionnaire renders the run's template fields with localized labels for the
  default keys (`page.tsx:21-28,110-111`), saves bounded answers (`app/_lib/onboarding-store.ts:349-362`),
  confirms with a saved state + "edit again" (`page.tsx:150-161`), and mirrors a timeline
  event to the recruiter (`onboarding-candidate.ts:64-67`). POST is rate-limited
  (`app/api/onboarding/candidate/[token]/route.ts:19-35`).
- If she closes the tab without filling it: ONE polite nudge re-sends the link after the
  policy delay (`preboarding-reminders.ts:20-48`) — claim-after-deliverability, at most once.

## Reachability (resolved before judging)

Tereza reaches ONLY the two tokenized pages — verified she never needs a workspace surface:
both pages are fully public routes keyed by token, both `notFound`-style on a bad token
(suppressed per accepted-gaps `example-tokenized-flows-need-real-token`). **One minted
offer-token fixture covers both legs** (accept converts it). The fixture itself is env.md
open question #3 — the L2 blocker, not a defect. Czech end-to-end: `offer` and
`candidateOnboarding` namespaces are complete in messages/cs.json.

## Walkthrough vs her scored criteria

- **offer/accept → concrete next step** ✓ (her declared major) — accept lands on the
  moss CTA "onboarding" ON the page, not only in an email (`page.tsx:239-248`); the
  questionnaire is a real, fillable next step. The old dead-end is closed. **Strength.**
- **no dead-ends / silence** ✗ **MAJOR (OO-L1-01)** — the offer email, the welcome email,
  the T-48h nudge and the pre-boarding nudge all terminate in an internal outbox unless a
  relay + base URL + captured address all exist. If any is missing, her experience
  IS "apply and wait in silence" — the exact 53% ghosting she carries. By-design and
  honestly logged, but it is the single gap between this journey and her adoption.
- **silent terminal transition** ✗ **MAJOR (OO-L1-05)** — an offer that lapses sends her
  NOTHING at expiry (`offers-store.ts:191-206` records only internal `offer_expired`
  events; no dispatch call exists). The T-48h nudge softens this only when the heartbeat
  + delivery work. She finds out by opening a dead link — expired reads honestly as
  expired (`page.tsx:255-261`), but nobody told her it happened.
- **comms sound human + Czech** ~ **MAJOR (OO-L1-03, shared)** — the deterministic chrome
  and templates localize by her stored locale and read warm
  (messages/cs.json `comms.onboarding`, `comms.offerReminder`); the LLM letter's language
  is guessed from her CV languages instead (`automation.py:110-112,727`) — an English
  letter above a Czech footer is structurally possible, and machine-mixed language is her
  "robot" tell. Also the letter names no deadline and no human contact (OO-L1-04).
- **trust / AI disclosure** ✓ — `AiDisclosure` before she decides (`page.tsx:367`); every
  comm carries the GDPR self-service data link (`comms-dispatch.ts:93-98`).
- **decline is deliberate, not a dark pattern** ✓ — confirm step, safe focus, muted
  destructive default (`page.tsx:290-331`); and a stale decline can never erase an
  accepted hire (`offers-store.ts:321-336`).
- **status truthfulness** ✓ — refresh/reopen shows the recorded state (`page.tsx:79-81`);
  flaky-phone reconcile keeps her out of "did it register?" limbo (`page.tsx:105-118`).
- **custom questionnaire fields** — minor (OO-L1-09): only the six default keys localize
  (`page.tsx:21-28`); a custom field authored in English renders English to her
  (`onboarding.ts:28-40`).

## Findings raised here

OO-L1-01 (major), OO-L1-05 (major), OO-L1-03 (major, shared), OO-L1-09 (minor), strengths
OO-L1-S1/S2 — see `offer-onboarding.findings.json`.

## Character feedback (first person, Tereza)

> Ta nabídková stránka je poprvé v celém hledání práce, kdy jsem se necítila jako číslo.
> Vidím firmu, pozici, částku, do kdy se mám rozhodnout — a když jsem klikla na přijmout,
> nečekalo mě "ozveme se", ale rovnou dotazník k nástupu. Věděla jsem, co bude dál. To je
> přesně to, co jsem vždycky chtěla: vědět, kde stojím. I to odmítnutí se mě zeptalo,
> jestli to myslím vážně — nic mě nikam netlačilo. A že mi rovnou řekli, že v procesu byla
> AI, beru; aspoň to nikdo neschovává.
>
> Jenže to všechno platí, jen když se ke mně ten odkaz vůbec dostane. Z toho, co jsem
> pochopila, ten e-mail ve výchozím nastavení nikam neodejde — zůstane v jejich systému,
> adresovaný mým jménem, ne mojí adresou. A kdybych nestihla termín, nabídka mi potichu
> propadne a nikdo mi nenapíše — na to se přijde, až když kliknu na mrtvý odkaz. Večer u
> telefonu je pro mě rozdíl mezi "napsali mi" a "nenapsali" celý rozdíl mezi touhle
> aplikací a tím, co zažívám všude jinde. Doručte mi ty zprávy, a řeknu o vás každému.

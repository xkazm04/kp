# L2 empirical — Tereza Králová × candidate-apply-status

- **Run:** 2026-07-02-full · live `http://localhost:3009` (dev, `DEV_AUTH=0` candidate side, HEAD = 3395b4c — identical to the L1 baseline) · cert level: **L2 (empirical, live browser, 390×844 mobile for her legs)**
- **L1 handoff:** `l1/tereza-candidate--candidate-apply-status.md` (L1-conditional; capst-l1-001/-002/-003 carried)
- **Verdict:** **L2-conditional** — the conversational path is live and genuinely excellent end-to-end (apply in Czech in minutes → status link → recruiter stage moves render on her page → a rejection shows a respectful card, never silence). But all three carried majors **confirmed live**: her quick path still claims "Potvrzení jsme vám poslali e-mailem" while the ack sits queued-terminal in a recruiter-side outbox, gives her **no status link at all**, and shows the data-consent sentence only **after** submitting. Plus one new L2 major: the GDPR erasure link in every e-mail she'd ever get is a **dead relative path** by default config.
- **Time-saved (re-measured):** conversational apply = **10 short steps, every transition sub-second** (scripted wall-clock 9.2 s; realistic thumb-typing ~2–3 min) vs. a 20–30 min portal form → **~20–28 min saved per application, high confidence** — *plus* the end of the status-chasing e-mail loop (she checked her own status three times this run without contacting anyone). Quick path: honestly ≤30 s (2 fields + 3 toggles) but still delivers the black hole L1 predicted — its saved minutes buy her a false promise.
- **Grounding (vs L1's 9/11):** **live-confirmed.** Every prompt named her real role ("Business Analyst – George Tribe ve společnosti Česká spořitelna"), and the KO gates were derived from the job's own facts (Praha – Michle / hybrid / Czech · English) — zero boilerplate. Comms rendered from her entry (name, role, cs locale, real tokens). The two ungrounded seams are delivery-side: no relay channel, no public base URL for the erasure link.

---

## 1. The walk (mobile 390 px, Czech, in her head)

**Beat 1 — `/apply/job-056` opens (shot `l2-capst-tereza-01-open`).** Role + Česká spořitelna in the header, her own EN/CS switcher top-right, "Krátký rozhovor — žádné formuláře, žádné přihlašování." The full AI disclosure — including the sentence she cares about, "Odesláním souhlasíte… po dobu až 12 měsíců… výmaz" — is pinned under the chat **from the first question** (`-01-open.text.txt`; `ConversationalApply.tsx:601`). She knows what she's agreeing to *before* typing her name. ✓

**Beat 2 — the chat itself (shots `-02-archetype`, `-03-ko`, `-90-done`).** CV step skippable in one tap; name; e-mail; "Co vás teď nejlépe vystihuje?" with three honest options; one experience question; skills; GitHub skippable; three yes/no gates *about this job's real location, mode and languages*. Ten steps, no dead ends, no bait-and-switch. One blemish she'd notice: she taps **"Ano"** and the chat echoes **"Yes"** — three hardcoded English bubbles in her otherwise native-Czech conversation, plus "EU equal-treatment directives" untranslated inside the Czech disclosure sentence (new **capst-l2-101**; plainly visible in `-90-done.png`).

**Beat 3 — "Jste ve hře! 🎉" + the status button.** The done card renders the **"Sledovat stav přihlášky"** link (`/status/as-KaeKGh1w…`). The outbox truth (DB, read-only): her acknowledgement exists, **addressed to her real e-mail**, in native Czech, and carries the **same** status token as the in-page button (single mint confirmed live) — but the row is `status: "queued", channel: "outbox"`, the documented *terminal* dev state; `.env.local` has no `COMMS_WEBHOOK_URL`, and no mail provider exists. **capst-l1-001 confirmed live**: had she closed the tab without tapping the button, the durable copy of her status link exists only in a workspace she can never open. And the e-mail's GDPR footer link renders as a bare `/data/er-…` — a dead path in any mail client (**capst-l2-102**, new).

**Beat 4 — `/status/[token]`, three visits (shots `-10-status-received`, `-12-status-underreview`, `-14-status-interview`).** "Přijato — Vaši přihlášku jsme přijali — čeká ve frontě na posouzení." Then the recruiter moved her (live workspace drawer, DEV_AUTH=1) and her page flipped to "**V posuzování** — Náborář/ka právě posuzuje váš profil.", then "**Pohovor** — Jste ve fázi pohovoru — sledujte e-mail kvůli termínu." Every stage move rendered on her token without her asking anyone. ✓ — with one honest wince: the Interview line tells her to *watch an e-mail inbox* that, on this config, will never receive anything (folded into capst-l1-001's evidence).

**Beat 5 — the rejection test (own fixture, shot `l2-capst-martin-15-status-rejected`).** A second test entry on job-043 was rejected recruiter-side. The status page flips to the terminal card: "**Tentokrát jste nebyl/a vybrán/a** — Děkujeme za vaši přihlášku. Tým se rozhodl pokračovat…" — no fake timeline, no silence. The rejection comm itself is humane, native Czech, GDPR-footered… and queued-terminal like everything else.

**Beat 6 — quick path `/apply/job-019/quick` (shots `l2-capst-tereza-20-quick-01-presubmit`, `-02-done`).** "Tři rychlé otázky — do 30 sekund" — true. But the pre-submit disclosure block **omits** the consent/retention sentence (screenshot-verified), which then appears on the done screen — *after* `recordLeadConsent` already stamped her consent (**capst-l1-003 confirmed, cs**). The done screen says "**Potvrzení jsme vám poslali e-mailem**" (false on this config) and offers **only** "Doplnit profil" — the page's entire `<a>` inventory is one enrichment link, **no `/status/` link**; the outbox ack for this lead carries the enrichment link (absolute, `?lang=cs`-pinned — well built) but **no status line** (**capst-l1-002 confirmed**). Her fastest path still ends in the black hole unless she does the longer chat.

**Beat 7 — her cs status link on an English device (shot `l2-capst-tereza-40-status-enbrowser`).** Fresh browser, en locale, no cookie: the page renders **entirely in English** ("Application status / Received / Under review…") with **no on-page language switcher** (aria confirms; the apply pages have one). The emailed link is built bare, not `?lang=cs`-pinned — while the quick ack's enrichment link IS pinned. **capst-l1-006 confirmed live.**

**Beat 8 — the erasure page works (shot `l2-capst-tereza-41-datapage`).** `/data/er-…` (her token) renders an honest plain-Czech inventory of what's held ("Váš životopis…, kontaktní údaje, odpovědi, záznamy z pohovoru, hodnoticí skóre") + one-tap "Vymazat mé údaje" with a truthful anonymization note. The self-service GDPR loop is real (**capst-l2-103, strength**) — it's only its emailed pointer that's broken (l2-102).

## 2. L1 handoff — l2_priority answers

| # | L1 question | L2 answer | Verdict |
|---|---|---|---|
| 1 | Where does the ack actually land? | Recruiter-side `dev_outbox` only: `queued`/`outbox` (terminal), no relay configured, no provider. Addressed to her **real e-mail** (the addressability half works); body carries the correct absolute status link + a **broken relative** erasure link. Older seeded comms (offer/onboarding, 17:47) sit queued too — systemic, not run-specific. | **capst-l1-001 confirmed** (+ new capst-l2-102) |
| 2 | Quick apply: status link + e-mail claim | Done screen (cs + en): only the enrichment CTA — zero `/status/` hrefs; "Potvrzení jsme vám poslali e-mailem" / "We've emailed you a confirmation" rendered on both. Quick ack body: enrich link only, no status line. | **capst-l1-002 confirmed** |
| 3 | Quick pre-submit consent omission, both locales | cs: consent sentence absent pre-submit, present post-submit (screenshots). en (job-020): identical. Conversational path shows it throughout — the correct pattern, live. | **capst-l1-003 confirmed** |
| 4 | Grounded happy path + stage moves + reject card | Applied on a real seeded ČS role; prompts named role/company/location/mode/languages; entry filed Accepted (healthy, not degraded); recruiter drawer moves (Screened, Interview) rendered on `/status/[token]` within one reload; rejected fixture shows the not_selected card, and a humane cs rejection comm was dispatched (queued). | **capst-l1-007 strength confirmed live** |
| 5 | cs-applied link in an en browser | English render, no on-page switch, link not locale-pinned (contrast: enrich link is). | **capst-l1-006 confirmed** |

## 3. Scored acceptance criteria (hers, applied as written)

| Criterion | L2 verdict | Evidence |
|---|---|---|
| **effort** — quick apply actually quick, mobile, no account wall | **PASS** — conversational: 10 sub-second steps at 390 px; quick: 2 fields + 3 toggles, honest ≤30 s | shots `-01…-90`, `-20-quick-*`; run JSON timings |
| **completion/missing** — status view without emailing | **PASS conversational / FAIL quick** — her token showed received → under review → interview live; quick path mints no link at all | shots `-10/-12/-14`; `-20-quick-02-done` hrefs = 1 enrichment link |
| **trust** — consent in plain Czech, before AI touches her, refusable | **PASS conversational / FAIL quick** — pinned from step 1 on the chat; post-submit-only on quick (l1-003); nothing pre-ticked anywhere | `-01-open.text.txt`, `-20-quick-01-presubmit.png` |
| **clarity/trust** — comms human, from the bank, real Czech | **PASS with a blemish** — ack + rejection are native, warm Czech from her entry's locale; the chat echoes "Yes" and the regime name in English (l2-101) | outbox bodies; `-90-done.png` |
| **trust** — no stage ends in silence | **CONDITIONAL** — the status page never goes silent (pull ✓, incl. the reject card); every push message exists but none can reach her by default (l1-001), and the erasure link inside them is dead (l2-102) | dev_outbox rows; `-15-status-rejected` |
| self-scheduling · onboarding next step | out of this journey's scope | — |

## 4. Findings (full schema in `candidate-apply-status.l2-findings.json`; impact-ranked)

1. **capst-l1-001 · major · trust · CONFIRMED LIVE** — candidate comms queued-terminal, recruiter-only; copy on quick done + status Interview line still promises e-mail.
2. **capst-l1-002 · major · missing · CONFIRMED LIVE** — quick path: no status link anywhere + false e-mail claim (cs + en).
3. **capst-l2-102 · major · trust · NEW (L2-only)** — GDPR erasure link in every candidate comm is a dead relative path when `APP_BASE_URL`/`NEXT_PUBLIC_APP_BASE_URL` is unset (`comms-dispatch.ts:93-98` → `publicBaseUrl()` with no origin, `public-base-url.ts:30-42`) — while the status link in the same e-mail is absolute. The disclosure's promised erasure path ("přes odkaz v našich e-mailech") doesn't resolve on default config.
4. **capst-l1-003 · major · trust · CONFIRMED LIVE** — quick pre-submit omits the retention sentence, both locales; consent is stamped at submit anyway.
5. **capst-l1-006 · minor · clarity · CONFIRMED LIVE** — status page has no language switcher; emailed status link not `?lang`-pinned.
6. **capst-l1-004 · minor · trust · CONFIRMED LIVE** — "nic nepříznivého se nerozhoduje automaticky" renders verbatim on both apply surfaces, both locales (KO auto-decline + wave auto-reject exist in code).
7. **capst-l1-005 · minor · trust · CONFIRMED (accurate today)** — live TTL is exactly 12 months (`consent_expires_at 2027-07-02`, env unset); the hardcoded-copy drift risk stands.
8. **capst-l2-101 · minor · clarity · NEW (L2-only)** — cs chat echoes hardcoded English "Yes"/"No" for every KO answer (`ConversationalApply.tsx:341`) + English regime names inside the Czech disclosure sentence (`AiDisclosure.tsx:58`, regime labels not localized). L1 missed it → surface-model gap: L1 audited the catalogs, not inline literals.

**Strengths confirmed live:** capst-l1-007 (no-ghosting timeline + honest terminal card + stable single-mint token), capst-l1-008 (genuinely quick, grounded, mobile-clean, own language switcher on apply), capst-l1-009 (humane locale-pinned comms + GDPR footer — ceiling now: the footer's link is relative, and delivery still rides l1-001), **capst-l2-103 · NEW strength** — the `/data/[token]` self-service page is real, honest, plain-language, with one-tap erasure and a truthful anonymization note.

Accepted-gaps check: none of the above match the baseline (tokenized-page 404s on bare URLs).

## 5. Tereza's feedback (first person, over the live product)

„Zkusila jsem to naostro, večer, z telefonu. Ta konverzační přihláška je přesně tak dobrá, jak slibovala na papíře: deset krátkých otázek, všechny o téhle konkrétní pozici — ptali se mě na Michli, na hybrid, na češtinu a angličtinu, ne na nesmysly. Za pár minut hotovo a hned tlačítko ‚Sledovat stav přihlášky'. A ono to FUNGUJE: ráno ‚Přijato', po posouzení ‚V posuzování — náborář/ka právě posuzuje váš profil', pak ‚Pohovor'. Třikrát jsem se podívala, nikomu jsem nemusela psát. A když to u té testovací přihlášky nevyšlo, stránka mi to řekla slušně a na rovinu — žádné ticho. Tohle je poprvé, co vidím, kde stojím.

Ale teď to horší, a trvám na tom. Ta rychlá verze z inzerátu mi napsala ‚Potvrzení jsme vám poslali e-mailem' — a já teď vím, že ten e-mail leží v jakési interní schránce, kterou vidí jen náboráři. Žádný odkaz na stav mi nedala. A ten souhlas na 12 měsíců mi ukázala až POTOM, co jsem odeslala. Přesně na cestě stavěné pro můj telefon mi tedy řekli nepravdu a schovali drobné písmo. A ještě jedna věc: v tom e-mailu, co mi ‚poslali', je odkaz ‚požádejte o výmaz' — a on nikam nevede, je to půlka adresy. Slibujete mi moje práva odkazem, který se nedá otevřít.

A maličkost, která mě píchla do oka: odpovídám ‚Ano' a ono to napíše ‚Yes'. Třikrát. V jinak krásné češtině.

Verdikt: tu delší cestu bych kamarádkám doporučila už dnes — je lepší než všechno, čím jsem se kdy hlásila do banky. Tu rychlou ať opraví, než ji někdo použije: dejte jí ten samý odkaz na stav, ukažte souhlas předem a přestaňte tvrdit, že jste poslali e-mail, dokud ho opravdu neposíláte."

**Adoption:** yes — conversational path + status page, today; quick path: not until l1-002/003 close. **Would she tell a peer:** yes, with the "use the chat version and bookmark the status link" caveat.

## 6. Appendix — evidence & adversarial notes

- **Evidence set:** `shots/l2-capst-tereza-01-open`, `-02-archetype`, `-03-ko`, `-90-done` (+ `.text/.aria`), `-10/-12/-14` status progression, `-15-status-rejected` (fixture), `-20-quick-01/02`, `-40-status-enbrowser`, `-41-datapage`, `l2-capst-tereza-run.json` (step timings), `l2-capst-recruiter-11/13-*` (drawer moves); DB (read-only better-sqlite3): `pipeline_entries` (her entry: Accepted→Screened→Interview, cs, consent +12 mo, healthy intake), `dev_outbox` (ack/rejection bodies quoted verbatim), `application_status_links` (single token per entry).
- **Adversarial:** (1) The queued-outbox claim is not "slow delivery" — `comms.ts:36-42` documents `queued` as terminal, `.env.local` carries no `COMMS_WEBHOOK_URL`, and 17:47-era seeded comms are still queued. (2) The mojibake in the reject fixture's name ("Vondr��ek") is a **driver artifact** (curl codepage on Windows), refuted as a product defect: Tereza's and Sam's diacritics survive end-to-end via the real browser path. (3) The reject action was fired at `POST /api/pipeline/[id] {action:"reject"}` — the identical handler the Decisions-tab reject button posts (`DecisionsTab.tsx:176,243`) — a recruiter-side driver shortcut; the candidate-facing artifacts (card + comm) are the journey evidence. Stage moves, by contrast, were done through the real drawer UI. (4) Recruiter-side observation, out of candidate scope: the board card row itself deep-links to the Match profile; the drawer opens only via the hover-revealed "Akce AI pro …" control — noted for the recruiter journeys.
- **Not covered this run:** Spark Dark on candidate pages (no theme toggle exists on the tokenized surfaces — light-only by design, unreachable for a candidate); draft-resume/lost-signal behaviour (L1-verified in code, not re-broken live); the `?lead=` enrichment chat completion (token minted and link verified present + absolute; the follow-through chat is the same surface already exercised).

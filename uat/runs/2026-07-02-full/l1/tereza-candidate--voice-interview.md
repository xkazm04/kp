# L1 theoretical — tereza-candidate × voice-interview

- **Run:** 2026-07-02-full (main @ 3395b4c) · **Cert level:** L1 (no browser, code-derived surface model)
- **Verdict:** **L1-pass** — structurally sound within her reachable surface; no majors. Her entire journey is gated on the candidate-token fixture (env.md open question #3) — `unreachable` until minted, not failing.
- **Grounding score (what shapes her experience):** the session she takes is grounded 4/6 (see Petra's report); her *own* surfaces — duration, agenda, disclosure, lifecycle states — are grounded in the real session record (5/5, no hardcoded promises).
- **Estimated time saved (designed upside):** the LLM-less way is phone-tag + a daytime call she can't take; here the emailed link runs the screen **the same evening on her phone (~20 min)** — roughly **2–4 days of latency and one impossible workday phone call avoided** · medium confidence.

## Surface model (her reachable set)

Tereza reaches **only** `/interview/[token]` (surface binding; `rubric.md` candidate gating). Verified from code:

- **Token is the credential:** `app/interview/[token]/page.tsx:16–17` resolves the session by token, `notFound()` otherwise; `/api/interview/connect` refuses a non-resolving presented token before minting anything (`connect/route.ts:57–59`). She never sees the workspace, the sim tab, or `/interview-lab` (prod-gated anyway, `app/_lib/interview-lab.ts:16–18`).
- **How she gets the link:** minted at create and **auto-delivered in her locale** through the durable Outbox channel (`create/route.ts:91–109`; `comms-dispatch.ts:403–416`); a **real relay only when `COMMS_WEBHOOK_URL` is set** (`comms.ts:36,98`) — by default delivery is simulated (ship-bar evidence: audit log + dead-letter exist; her inbox does not receive it). Recruiter copy-link is the manual fallback.
- **The portal:** honest role-titled header + intro (`page.tsx:50–55`), **truthful duration** from `session.durationMin ?? GROUNDED_DEFAULT_MIN` (`page.tsx:24,58`; single source `interview-duration.mjs:25–44` — the old "5 minutes promised, 20 delivered, capped at 10" disagreement is dead), run-of-show agenda sidebar (`page.tsx:70`; `InterviewSidebar.tsx:24–46`), readiness tips, `AiDisclosure` (`page.tsx:81`).
- **Lifecycle honesty:** completed → closed "Děkujeme" card (`page.tsx:26–33`); revoked/expired → honest inactive card (`page.tsx:39–46`), expiry from the single shared authority (`db/interviews.ts:203–212`); server refuses regardless (`connect/route.ts:71–99`). Single-use after completion (:71–73); a **failed** call stays retryable by design (`finalize-status.ts:34–37`).
- **The call:** consent checkbox (default unticked, `VoiceInterview.tsx:90`) gates Start (:713); consent is enforced **server-side** before credentials mint (`connect/route.ts:149–155`; `interview-consent.ts:49–51`) and again before a transcript persists (`complete/route.ts:63–70`). Provider pinned per session — she can't be silently switched (:44–46, :344–348). Preflight names webview/HTTP/WebRTC causes before dialing (`preflight.ts:46–56`); mic-prompt hint (:99–102, :781); 30s connect timeout (:510–522); live transcript she can read as she talks (:746–806); completed closing card reuses the portal's exact strings (:674–681); her answers survive a tab close via sendBeacon (:372–387) and a save failure is told to her, not swallowed (:278–281, `cs.json:794`).

## Reachability check (before judging)

Everything above is inside her set **once a token exists**. The fixture (env.md:127–133, open question #3) and the delivery relay are the gates; both are environment, not structure — findings placed accordingly (`vi-tereza-invite-delivery-simulated`). No out-of-set findings were kept.

## Cognitive walkthrough (in character, cs)

1. **Open the link on my phone in the evening** — the page tells me the role, that it's AI-led, transcribed, ~how long it really takes, and what we'll cover. I know what I'm walking into before I say a word. ✓
2. **Consent** — plain Czech, nothing pre-ticked, says explicitly: AI-led, transcribed for a **human** reviewer, no audio stored (`cs.json:787`). It's genuinely mine to refuse — but if I refuse, the page offers me nothing else: no "talk to a person instead", no contact. A polite dead end. ~ → `vi-tereza-consent-decline-deadend`
3. **Start** — if my mail app opens the link in its built-in preview, I get a fast, specific error… **in English** (`preflight.ts:47–55`), on an otherwise Czech page. That's the moment I'd give up. ~ → `vi-tereza-preflight-error-english`
4. **Talk** — live transcript, honest status pill, the agent is briefed to detect and follow my Czech (`student-interview.ts:147–148`) — but nothing *configures* Czech at the provider (`openai.ts:92`; `elevenlabs.ts:19`; override carries prompt only, `VoiceInterview.tsx:546–549`), so which language its FIRST sentence lands in is uncertain. ~ → `vi-tereza-agent-opening-language`
5. **Finish** — a real closing card: "recruiter will review and get back to you." If the call drops instead, I can retry the same link — I'm not locked out of my own interview. ✓
6. **Do I trust it advanced my job?** — my words are the record, a human decides (the scorecard feeds a human Decisions gate, `complete/route.ts:150–179`), and a rejected/withdrawn me can't be dragged into a screen (terminal entries revoke on sight, `connect/route.ts:93–99`). ✓

## Scored acceptance criteria (hers, applied to this journey)

| Criterion | Verdict |
|---|---|
| effort — quick, mobile, no account wall | **pass** — one tokenized page, responsive grid (`page.tsx:49,69`), no login |
| completion/missing — see where I stand | **pass** — honest completed/inactive/expired states; "human reviews" close |
| trust — AI disclosure + consent, plain cs, refusable, before AI touches me | **pass** — her headline criterion; server-enforced, unticked, no-audio claim matches transcript-only persistence (`complete/route.ts:77–102`) |
| clarity/trust — comms human + from the bank | **pass at template level** (localized invite, `create/route.ts:97`; `comms-dispatch.ts:408–414`); English preflight error is the blemish |
| completion — works around my job | **pass (designed)** — evening, phone, ~20 min, truthful length |
| trust — no stage ends in silence | **pass structurally** — completed card promises review; the scorecard actually lands on the pipeline entry |

## Findings (details in voice-interview.findings.json)

- **minor** `vi-tereza-invite-delivery-simulated` — default delivery is the local Outbox; her inbox needs `COMMS_WEBHOOK_URL` (+ the token fixture gates all of L2). `scope_note`.
- **minor** `vi-tereza-consent-decline-deadend` — refusing consent leaves no alternative/contact affordance.
- **minor** `vi-tereza-preflight-error-english` — the most-common-failure error message is hardcoded English.
- **minor** `vi-tereza-agent-opening-language` — cs language hint never reaches provider config; opening-language uncertain.
- **strengths** `vi-tereza-honest-lifecycle`, `vi-tereza-consent-server-side`, `vi-tereza-preflight-resilience`.

## Character feedback — Tereza, first person

„Čekala jsem další ‚ozveme se' — a místo toho stránka, která mi rovnou řekla: povede to AI, přepisuje se to pro člověka, zabere to asi dvacet minut, a tady je program. Nikdo se mě nesnažil obelstít — ten souhlas jsem opravdu mohla nezaškrtnout a nic nebylo předvyplněné. To se mi nestává často.

Že to můžu udělat večer z mobilu, místo abych si v práci hledala prázdnou zasedačku na telefonát — to je pro mě celý rozdíl mezi ‚přihlásím se' a ‚nepřihlásím'. A když hovor spadne, můžu to zkusit znovu; když ho dokončím, vidím poctivé ‚hotovo, člověk si to projde'. Nekřičím do prázdna.

Dvě ale. Kdybych ten souhlas dát nechtěla — protože mám právo nechtít — stránka mi nenabídne vůbec nic: žádné ‚domluvte si hovor s člověkem', žádný kontakt. A jestli se mi odkaz otevře v náhledu v mailu a ta stránka na mě spustí chybu **anglicky**, tak nevím, co mám udělat, a asi to vzdám. Jinak — tohle bych kamarádce doporučila. Jen mi ten e-mail s odkazem musí opravdu přijít."

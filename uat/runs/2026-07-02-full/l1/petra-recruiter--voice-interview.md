# L1 theoretical — petra-recruiter × voice-interview

- **Run:** 2026-07-02-full (main @ 3395b4c) · **Cert level:** L1 (no browser, code-derived surface model)
- **Verdict:** **L1-conditional** — the job completes structurally end-to-end, but two majors carry forward
- **Grounding score (agent prompt):** **4/6** (JD ✓ · CV/profile ✓ · match analysis ✓ · GitHub evidence ✓ — comp band ✗ · prior pipeline history ✗); review surface fully grounded (3/3)
- **Estimated time saved (designed upside):** ~**35–40 min per first-round screen** (30-min call + 10–15 min notes → ~1 min to send + ~5–7 min reading an evidence-anchored transcript+scorecard) · **medium confidence** — L2 must confirm live quality

## Surface model (her reachable set)

Petra is an internal user (dev gate; tabs per `app/features/tabs.ts`). Her voice-interview surfaces:

1. **Schedule tab** — `app/features/sub_schedule/ScheduleTab.tsx`
   - "Spustit pohovor s AI" per calendar entry → `POST /api/interview/create {entryId}` (:149–153), then `window.open(d.url)` (:160). 409 live-guard is explained localized (:158, `messages/cs.json:1657`).
   - Live-call state is a non-interactive pill, not a re-runnable button (:294–308); finished screens show "Přepis připraven · Zobrazit" (:286–293) → `InterviewTranscriptModal`.
   - Status polling via `GET /api/interview/by-entry?entries=` every 6s + on focus (:127–143).
2. **Create route** — `app/api/interview/create/route.ts`: billing meter gate books the whole call (:30–31); live-call reissue refusal (:53–61); revoke-first = exactly one live link (:69); `buildGroundedInterview` (:71); invite auto-delivered to the candidate via Outbox comms (:91–109); returns `{token,url,configured,delivered,revoked}` (:111–121).
3. **Agent brief** — `app/_lib/interview-run.ts:127–224`: prep-chronology brief (`composeBrief` :42–67), submission-debrief brief (:97–123), student/case scripts (:167–193); truthful duration (:212–213). Prep is CV-derived: real profile payload + job + match context + GitHub evidence into the LLM (`app/_lib/automation-run.ts:92,110,126–181`; `pipeline/jobfit/automation.py:403–424`; `pipeline/jobfit/match_reasoning.py:50–95`).
4. **Review** — `app/features/sub_schedule/InterviewTranscriptModal.tsx`: AI scorecard (recommendation badge, rubric meters, per-rating evidence) with quotes **anchored to the transcript turn** and click-to-jump (:46–68, :216–244); human scorecard rendered distinctly (:110–132); full transcript with cited-turn badges (:249–277). Scorecard synthesis: real transcript → notes → rubric-anchored task (`interview-run.ts:250–301`; `automation.py:548–587`), sealed as a decision record with model version (`app/api/interview/complete/route.ts:168–179`). Pipeline drawer mirrors the outcome (`CandidateDrawer.tsx:100–143`).
5. **Pipeline drawer alternative path** — voice panel with provider picker, copy-link, **delivered/not-delivered/revoked feedback** (`CandidateDrawer.tsx:789–836`) and a no-replacement revoke button (:840–849).

Not hers: `/interview/[token]` (Tereza's), `/interview-lab` (dev harness, `app/_lib/interview-lab.ts:16–18`), the sim sub-tab (separate journey scope).

## Reachability

All surfaces are inside her binding (Schedule, Pipeline). Preconditions: seeded pipeline entry at `calendar` approval + a voice key; keyless → `/connect` 503s with an actionable message (`connect/route.ts:123–131`) — `scope_note`, per journey. The end-to-end loop (a *completed* session feeding her review) additionally needs the candidate-token fixture — an L2 fixture item, not a structural gap.

## Grounding audit (the crux)

| Source the agent should have | Reaches the prompt? | Evidence |
|---|---|---|
| Real JD/job (title, company, seniority, location, work mode, must/nice-to-have) | ✓ | `interview-run.ts:138–142`; `match_reasoning.py:80–87` |
| Candidate's real CV/profile (skills, summary, highlights, work links) | ✓ | `automation-run.ts:92,110,147–150`; `match_reasoning.py:52–63` |
| Prior match analysis (matched skills, missing must-haves, scores) | ✓ | `match_reasoning.py:88–95` |
| GitHub/public-repo evidence (when present) | ✓ | `automation-run.ts:126–140,177–181`; `automation.py:412` |
| Role comp band / salary context | ✗ | absent from `reasoning_context` (`match_reasoning.py:50–95`) and `composeBrief` (`interview-run.ts:42–67`) |
| Prior pipeline history (screen verdict, recruiter notes, comms) | ✗ | prep prompt consumes only profile+job+match ctx (`automation.py:406–424`) |

**4/6.** Candidate-mode sessions always carry the grounded brief (stored at create, `create/route.ts:71–82`); the `defaultInterviewerInstructions` fallback at `connect/route.ts:133–135` is effectively lab-only now — the 2026-06-19 run's "thin grounding" worry is structurally addressed. Silent degrade remains possible when prep generation fails (`interview-run.ts:203–205`).

## Cognitive walkthrough (in character)

1. **Send the screen** — the button is where I schedule, labeled in Czech, one click. ✓ But after the click, *"a stalo se vůbec něco?"* — the tab that opens is the **candidate's own portal in my browser**, and nothing tells me whether the invite email went out (the drawer version tells me; this one doesn't). ✗ → finding `vi-petra-schedule-silent-delivery`.
2. **Know it's running** — the live pill + the 409 explanation are exactly right; I can't torpedo a call mid-flight. ✓
3. **Review** — transcript + scorecard on the same card, each evidence quote jumps to the moment in the conversation. This is reasoning I could defend to a manager. ✓ Scorecard prose language is the open question (likely English headline). ~
4. **Trust the machinery** — consent server-side, failed calls never scored, transcript persisted before scoring, one live link per candidate. ✓ But the interviewer brief — including debrief red flags marked "never say this aloud" — is returned to the candidate's browser by `/connect`. ✗ → `vi-petra-brief-leak-to-browser`.

## Scored acceptance criteria (hers, applied to this journey)

| Criterion | Verdict |
|---|---|
| completion — send → transcript+result, no dead end | **pass** (structurally; end-to-end loop is an L2 fixture item) |
| senior-quality/trust — reasoning cites concrete facts | **pass** — scorecard evidence quotes anchored to transcript turns (`InterviewTranscriptModal.tsx:46–68`) |
| trust — no hallucinated skills | **pass-at-design** — quotes that don't match any turn render unanchored, not mis-anchored (:67–68); live check at L2 |
| senior-quality — score with drivers | **pass** — per-competency ratings + evidence, BARS-anchored rubric (`automation.py:557–587`) |
| trust — salary with basis | **n/a here** — and the agent has no comp band at all (finding) |
| clarity — no silent success | **FAIL on ScheduleTab** — delivered/revoked flags discarded (:160 vs `CandidateDrawer.tsx:819–827`) |
| time-saved — faster than manual | **pass (designed)** — ~35–40 min/screen |
| language — Czech UI + output | **partial** — UI/rubric labels cs; scorecard prose has no locale directive (`automation-run.ts:170–172`) |

## Findings (details in voice-interview.findings.json)

- **major** `vi-petra-brief-leak-to-browser` — interviewer-internal brief (incl. debrief red flags) crosses to the candidate's browser via `/connect`; EL grounding is a client-side, tamperable override.
- **major** `vi-petra-schedule-silent-delivery` — no delivery confirmation on ScheduleTab + it opens the candidate's one-shot link in her own tab.
- **minor** `vi-petra-grounding-no-comp-no-history` — 4/6 grounding; no comp band, no pipeline history.
- **minor** `vi-petra-silent-generic-degrade` — prep failure silently ships the generic 5-min screen.
- **minor** `vi-petra-scorecard-language` — scorecard prose not locale-directed.
- **strengths** `vi-petra-review-evidence-anchored`, `vi-petra-lifecycle-guards`.

## Character feedback — Petra, first person

„Tohle je poprvé, co mi AI nástroj dává **důkazy místo dojmů**. Otevřu přepis, kliknu na citát ve scorecardu a vidím přesně tu chvíli v rozhovoru — to je věta, kterou můžu říct manažerovi, aniž bych se červenala. Otázky agenta vycházejí z reálného CV a z mezer v matchi, ne z obecné šablony; to je víc, než dělá půlka juniorních recruiterů po telefonu.

Ale dvě věci mi vadí. Za prvé: kliknu na ‚Spustit pohovor s AI' — a otevře se mi **kandidátův** portál v mojí záložce. Odešel mu e-mail? Nevím. Karta v pipeline mi to řekne, plánování ne. A stalo se vůbec něco? Za druhé — a to je horší: technicky zdatný kandidát si v prohlížeči přečte **celý můj brief**, včetně interních poznámek ‚nikdy neříkej nahlas'. Jestli tohle někdo zjistí, je po důvěře v celé kolo. Než tohle pustím na ostro, chci to spravené.

Jinak: hovor nejde omylem přepálit druhou pozvánkou, spotřeba se počítá poctivě, a když spadne spojení, nikdo neskóruje půlku rozhovoru jako hotový screening. To je přesně ta ‚nudná' spolehlivost, kterou po dvou migracích ATS umím ocenit. Adoptovala bych — podmíněně."

# L1 report — Tomáš Krejčí (backend team lead, first-time requestor) × role-intake-dialog

- **Character:** tomas-backend-team-lead · segment internal-user · lang cs
- **Journey:** role-intake-dialog (Library → Intake) · cert level **L1** (theoretical, code-grounded, no browser)
- **Behavior modes sampled:** `solution_jumper` (primary walkthrough), cross-checked against `evaluation_anxious` + `llm_era_confused`
- **Date:** 2026-08-07

---

## 1. Surface model (verified import chain, file:line)

- **Mount:** Intake is the third option of the Saved/Generate/Intake `SegmentedControl` in `app/features/library/jds/JdsSavedLedger.tsx:103` (`{ value: "intake", label: t("intake.tabLabel") }`), Tier-3 dynamic import at `JdsSavedLedger.tsx:45` (`dynamic(() => import("./intake/JdsIntakePanel")…)`), mounted with `onPromoted={reload}` at `JdsSavedLedger.tsx:121-123` so a promoted JD refreshes the Saved ledger.
- **Panel:** `app/features/library/jds/intake/JdsIntakePanel.tsx` — ledger of past sessions when none is open (`:21-64`), otherwise header (status/shape chips, Promote gated by `briefReadyToPromote` `:67,89`), degraded note `:98`, and the two-column layout chat + live brief `:101-104`.
- **Chat:** `JdsIntakeChat.tsx` — transcript bubbles (requestor right on ink, agent left on stone-100, `:45-51`), `aria-live="polite"` scroll region `:42`, "Přemýšlím…" pending bubble `:58-63`, composer disabled when `closed` (session status !== "open") `:71-72,85`.
- **Live brief:** `JdsIntakeBriefPanel.tsx` — sections Role/Outcomes/Dealbreakers/Nice-to-have/Languages/Context; `ProvenanceChip` renders `stated` (moss) / `inferred` (coral) / `default` `:12-17`, applied to each requirement `:64,74` and facet `:88`.
- **State/API client:** `jdsIntakeLogic.ts` — list/open/create/send/promote fetches against `/api/intake*`; optimistic requestor line with rollback on failure `:106,139`; `degraded` derived from `source === "deterministic"` `:121`; stale-response guard via `activeIdRef` `:44,122`.
- **Routes:** `app/api/intake/route.ts` (POST create + deterministic opener seeded `:22-26`; GET ledger `:32-41`), `[id]/route.ts` (workspace-scoped point read `:14-16`), `[id]/message/route.ts` (409 on closed `:29-31`, 4 000-char cap `:9,33`, per-IP `rateLimit` 30/10min after cheap refusals `:36-38`, exactly-once fencing contract `:40-48`, atomic persist `:59-69`), `[id]/promote/route.ts` (readiness gate `:28-33`, same `insertAnalyzingJd → startTask("jd_build")` contract as Generate `:47-60`, back-link stamped before build completes `:61-63`).
- **Runner:** `app/_lib/intake-run.ts` — opener spawns `intake_cli --opening` with **no LLM env** `:39-44`; exchange writes transcript/brief JSON files to a workdir and spawns `python -m pipeline.jobfit.intake_cli` with `buildLlmConfigEnv()` `:50-74`.
- **Engine:** `pipeline/jobfit/intake.py` — persona constants `:49-109`, `intake_system_brief` `:112-123`, transcript render capped at 48 turns `:41,133-135`, deterministic shape triage `:151-174`, localized 10-slot script `:188-229`, `_apply_answer` (everything typed → provenance `stated`, confidence 0.9) `:245-281`, read-back `:329-362`, `deterministic_turn` `:365-391`, `merge_brief` (stated never regresses to inferred `:435-437,447-448`), exchange entry `run_intake_turn` with fenced message + `generate_with_fallback` `:477-528`.
- **CLI:** `intake_cli.py` — `resolve_provider("role_intake", timeout=120)` with documented unavailable→deterministic dance `:53-56`; capability registered at `pipeline/jobfit/llm/capabilities.py:66`.
- **Schema:** `pipeline/jobfit/rolebrief.py` — `BriefRequirement`/`BriefFacet` carry `provenance` + `confidence` `:73-96`; `coerce_role_brief` never raises `:141-200`; TS mirror `app/_lib/schemas.generated.ts:208-238` (provenance at `:223,231`), re-exported as `RoleBrief` via `app/_lib/rolespec.ts:16`.
- **i18n:** `messages/cs.json:3085-3134` — full `library.tab.intake` catalog in natural Czech, incl. correct plural `turns` ("# replika / # repliky / # replik") `:3094` and the provenance chips ("řekli jste / úsudek AI / předpoklad") `:3129-3133`. Engine-side: `normalize_lang` + `language_directive` (`pipeline/jobfit/i18n.py:33-64`); the deterministic script has hand-written Czech variants (`intake.py:188-229`), not machine passthrough.
- **Guardrails verified:** rate-limit contract pins the intake limiter (`app/api/rate-limit-contract.test.ts:119-128`); tenancy test exists (`app/_lib/db/intakes-tenancy.test.ts`); every `role_intakes` query filters `workspace_id` (`app/_lib/db/intakes.ts:98,105,119,156,163,188,207`).

## 2. Grounding audit

Journey-defined inputs → the prompt (`intake.py:509-516`):

| Input | Reaches prompt? | Evidence |
| --- | --- | --- |
| Current accumulated brief (full JSON) | yes | `intake.py:510` |
| Conversation so far (last 48 turns) | yes | `intake.py:511` (`render_transcript`, `:133-135`) |
| New requestor message, fenced exactly-once | yes | `intake.py:512` (`fenced_untrusted`), not duplicated in history (`message/route.ts:40-48`) |

**Score: 3/3.** Plus the language directive (`intake.py:121`). Observation, not a defect for Phase 1: **zero workspace context** beyond the conversation reaches the prompt — no existing JD library, no team/org data, no market comp band (Market Pulse exists in the product). The agent knows only what Tomáš types. See L1-TOM-9.

## 3. The walkthrough in Tomáš's head (solution_jumper, cs)

1. **Finds it?** He lands in Library; the sub-tab says "Zadání role" (`cs.json:3086`) — his words, not "intake". The lede promises "Roli nemusíte psát" (`:3088`) — exactly his fear removed. He clicks "Nový rozhovor". ✔ (cognitive-walkthrough Q1–Q3 pass)
2. **Opener.** Deterministic, identical keyed/keyless (`api/intake/route.ts:23`, `intake.py:464-474`): "…nejsou tu žádné špatné odpovědi, klidně i mlhavě… kde tým nejvíc cítil, že tenhle člověk chybí?" (`intake.py:191`). For `evaluation_anxious` this is the load-bearing sentence — non-judgment made explicit in turn 0, before he can flinch. The question asks about his last month, not his "requirements" — his stated "what good looks like", verbatim.
3. **He jumps to a solution:** "Potřebuju seniora na Javu." LLM path: persona rule 5 tells the model to park it visibly and explore the problem behind it (`intake.py:68-70`); rule 3 keeps his "padá release" vocabulary (`:62-64`); rule 6 names his contradictions (`:70-72`); the `llm_era_confused` "do we even hire a junior now" question lands in the exploratory story register (`:81-88`) and the 90-day outcome filter (`:74-76`) is the honest answer to it — though no persona rule addresses AI-era role-shape doubt *explicitly* (L1-TOM-10).
4. **The live brief fills as he talks** — requirements and facets each with a chip: "řekli jste" vs "úsudek AI" (`JdsIntakeBriefPanel.tsx:64,88`, `cs.json:3130-3131`). The merge guard means nothing he stated can be silently downgraded or dropped by a forgetful model (`intake.py:399-456`). This is his trust criterion working — *for requirements and facets*. Title, seniority, 90-day outcomes and languages render with **no chip at all** (`JdsIntakeBriefPanel.tsx:43-57,79-83`) because the schema has no provenance slot for scalars (`rolebrief.py:103-113`) — L1-TOM-5.
5. **Close.** LLM path: read-back + one open correction, `<<END>>` only after confirmation, enforced twice (`intake.py:90-96` persona, `:506` `done` requires both flags). His correction lands via `merge_brief`. ✔ Keyless path: the read-back literally asks "Co jsem pochopil špatně nebo co chybí?" **and closes the session in the same turn** (`intake.py:390-391` → `done: True` → route sets status complete `message/route.ts:66` → composer disabled `JdsIntakeChat.tsx:71-72`). The question is unanswerable — L1-TOM-4.
6. **Promote.** Button disabled until title + one dealbreaker/90-day outcome (`intake-brief.ts:57-62`), with a Czech hint explaining why (`cs.json:3116`). One click → placeholder JD in Saved JDs, backgrounded build, intake stamped "Inzerát vytvořen" (`promote/route.ts:47-64`). The brief threads structurally into the build (`brief` in the task input `:55`), not just flattened text — HR gets something richer than his old competitor-template borrow.

**Can he get from "něco nám chybí" to a promoted brief in one sitting?** Yes on the LLM path, structurally; yes on the keyless path too, but as an honest guided form (disclosed via `degradedNote`, `cs.json:3111`) whose read-back he cannot correct.

## 4. Findings

### L1-TOM-1 · strength · persona constants encode the full research spec
- cert_level: L1 · type: strength · dimension: senior-quality
- severity: — (positive) · impact: {frequency: high, reachability: high, trust_erosion: —}
- expected: The system brief encodes the 10 rules (one question/turn, reflect-then-ask ~2:1, reuse their words, ladder musts, park solutions, name contradictions, this-or-that only after stall, 90-day anchor, rank when >6 musts, short turns) + shape triage + gated close.
- got: All ten present as ordered technique rules, plus shape triage and the `<<END>>` gate.
- evidence: `pipeline/jobfit/intake.py:49-109` (constants), `:112-123` (assembly)
- code_check: confirmed-present — each journey-named rule matched to a numbered clause.

### L1-TOM-2 · strength · provenance discipline is end-to-end and regression-proof
- cert_level: L1 · type: strength · dimension: trust
- severity: — · impact: {frequency: high, reachability: high, trust_erosion: —}
- expected: stated|inferred|default flows engine → schema → wire → chips, and a stated value can't be overwritten by an inferred one.
- got: Extraction rule ("'stated' ONLY for values the requestor actually said", `intake.py:98-109`); `merge_brief` refuses stated→inferred regression for both requirements and facets (`intake.py:435-437,447-448`); deterministic answers marked stated/0.9 (`:242,260,265`); chips localized ("řekli jste / úsudek AI / předpoklad", `cs.json:3129-3133`; `JdsIntakeBriefPanel.tsx:12-17`).
- code_check: confirmed-present.

### L1-TOM-3 · strength · keyless degradation is honest and lossless
- cert_level: L1 · type: strength · dimension: trust / completion
- severity: — · impact: {frequency: med, reachability: high, trust_erosion: —}
- expected: Keyless serves the same schema with a visible note; nothing typed is lost.
- got: Deterministic slot script fills the identical RoleBrief with everything marked stated (`intake.py:245-281`); UI shows "AI je offline — pokračujeme vedeným dotazníkem. Vaše odpovědi se ukládají stejně." (`cs.json:3111`, `JdsIntakePanel.tsx:98`, source wiring `jdsIntakeLogic.ts:121`). His pet peeve is "forms in chat clothing" — this IS one, but it says so, which by his own words ("at least the form is honest") passes.
- code_check: confirmed-present.

### L1-TOM-4 · major · deterministic read-back invites a correction the UI cannot accept
- cert_level: L1 · type: broken-flow · dimension: trust (scored criterion: "correction actually lands")
- severity: **major** · impact: {frequency: med (every keyless session + LLM-failure fallback on the final turn), reachability: high, trust_erosion: high}
- expected: The close is a grounded read-back he can correct — journey DoD and his scored criterion both require the correction to land.
- got: `deterministic_turn` emits the read-back ("Co jsem pochopil špatně nebo co chybí? Pokud nic, brief uložím.") **and `done: True` in the same payload** (`intake.py:390-391`); the route flips status to `complete` (`app/api/intake/[id]/message/route.ts:66`); the composer disables on any non-open status (`JdsIntakePanel.tsx:66`, `JdsIntakeChat.tsx:71-72,85`) and the message route 409s (`message/route.ts:29-31`). The agent asks a question into a locked textbox. The LLM path is correct (done requires model-asserted done AND `<<END>>`, `intake.py:506`, after a confirmed read-back per `:90-96`) — this is keyless/fallback-only, but keyless is explicitly in-scope for this journey.
- code_check: confirmed-broken (by construction; no code path lets a keyless correction re-open the turn).
- l2_priority: yes — confirm live that a keyless session closes on the read-back turn; also probe the mid-session LLM-failure fallback variant.

### L1-TOM-5 · major · spine scalars carry no provenance — the default "medior" masquerades as captured
- cert_level: L1 · type: trust · dimension: trust (scored criterion: "inference never masquerades as his statement")
- severity: **major** · impact: {frequency: high (title/seniority render in every session), reachability: high, trust_erosion: med-high}
- expected: Every visible brief value marked stated/inferred/default.
- got: Provenance exists only on `BriefRequirement`/`BriefFacet` (`rolebrief.py:83,94`); `title`, `seniority`, `success_criteria`, `languages` are bare scalars/lists (`rolebrief.py:104-110`), so the panel renders them chip-less (`JdsIntakeBriefPanel.tsx:43-57,79-83`). Worst case: `seniority` defaults to `"medior"` (`rolebrief.py:105`) and the read-back prints "• Role: {title} (medior)" (`intake.py:334,349`) even when seniority was skipped — a template default presented indistinguishably from his answer, in the very summary he's asked to sign off. (Mitigation noted: the deterministic script always asks seniority — `_slot_filled` returns False for it, `intake.py:295-296` — but a skip still leaves the unmarked default.)
- code_check: confirmed-absent (schema-level; the UI cannot show what the wire doesn't carry).
- l2_priority: yes — check whether an LLM-proposed title/outcome appears unmarked in a live session.

### L1-TOM-6 · minor · keyless shape triage misses marker-less backfills → 11-exchange "short path"
- cert_level: L1 · type: quality-gap · dimension: effort (scored criterion: backfill ≤ 8 exchanges)
- severity: minor · impact: {frequency: med, reachability: high (keyless only; LLM may override triage per `intake.py:505`), trust_erosion: low}
- expected: A backfill-shaped opener collapses to the short path.
- got: Deterministic triage is regex markers (`intake.py:151-160`); "Potřebuju seniora na Javu" matches neither set → after 2 requestor turns defaults to `story` (`:172-173`) → 10-slot script + read-back ≈ 11 exchanges (`:313`). "Potřebuju posilu" would match (`posil`), so his own journey phrasing survives — but the miss is one synonym away.
- code_check: confirmed-present (regex traced against the opener strings).
- l2_priority: yes — count exchanges for a marker-less backfill opener, keyed and keyless.

### L1-TOM-7 · minor · 10–120 s per exchange behind a static "Přemýšlím…"
- cert_level: L1 · type: confusion · dimension: clarity / effort
- severity: minor · impact: {frequency: high (every LLM exchange), reachability: high, trust_erosion: low-med}
- expected: Visible progress and a sane failure story during a long exchange.
- got: Provider timeout is 120 s (`intake_cli.py:54`) atop a Python spawn; the only feedback is the static pending bubble (`JdsIntakeChat.tsx:58-63`, `cs.json:3105`) with the composer locked (`:72`). Failure story is decent (error line + optimistic rollback so retry can't double-post, `jdsIntakeLogic.ts:136-140`), but 60+ s of "Přemýšlím…" reads as hung to an `evaluation_anxious` first-timer.
- code_check: confirmed-present (no interim progress mechanism exists on this surface).
- l2_priority: yes — journey explicitly budgets 10–60 s; measure real latency and the felt experience.

### L1-TOM-8 · minor · corrections only via chat; no brief editing, no re-open
- cert_level: L1 · type: missing-feature · dimension: completion / trust
- severity: minor · impact: {frequency: low-med, reachability: high, trust_erosion: med when it hits}
- expected: "I can fix it before it becomes a posting" (his words).
- got: The brief panel is read-only (`JdsIntakeBriefPanel.tsx` renders only); the sole correction channel is the dialog, and a `complete` session's composer is dead (`JdsIntakeChat.tsx:71-72`) with no re-open route (`app/api/intake/*` has no such endpoint). Journey lists re-opening as a documented known gap → scope_note; recorded because it compounds L1-TOM-4: keyless, the correction window is exactly zero.
- code_check: confirmed-absent · scope_note: known gap per journey "Out of scope / known".

### L1-TOM-9 · minor · grounding is conversation-only — no workspace context enrichment
- cert_level: L1 · type: missing-feature · dimension: senior-quality
- severity: minor (Phase-1 by-design flavor) · impact: {frequency: high, reachability: high, trust_erosion: low}
- expected (senior bar): a real talent advisor at ČS would walk in knowing the team's existing roles, prior JDs, and the market band.
- got: The prompt receives brief + transcript + fenced message only (`intake.py:509-516`); no existing-JD retrieval, no Market Pulse comp band, no team data. The journey's own grounding definition is satisfied (3/3), so this is an observation against the senior-quality ceiling, not a spec breach.
- code_check: confirmed-absent.

### L1-TOM-10 · polish · `llm_era_confused` has no explicit persona handling
- cert_level: L1 · type: quality-gap · dimension: senior-quality
- severity: polish · impact: {frequency: med for THIS character, reachability: high, trust_erosion: low}
- expected: His "do we even hire a junior now that we have AI tools?" is a named mode in the research taxonomy and the CI scenario bank.
- got: No persona clause addresses AI-era role-shape doubt explicitly (`intake.py:49-109`); the 90-day outcome anchor (`:74-76`) and the story register (`:81-88`) are the *implicit* right answer, and the mode is covered by the CI bank (out of L1's re-proving scope per journey).
- code_check: confirmed-absent (explicit clause), present-implicit (outcome anchoring).
- l2_priority: yes — ask the live agent the junior-vs-AI question and judge the answer.

### L1-TOM-11 · strength · promote seam is structural, gated, and back-linked
- cert_level: L1 · type: strength · dimension: completion
- severity: — · impact: {frequency: high, reachability: high, trust_erosion: —}
- expected: Promote reuses the existing backgrounded JD build with the brief threading structurally, with a comprehensible gate.
- got: Same three-step contract as Generate (`promote/route.ts:45-60`), `brief` passed whole into the task (`:55`) plus `needTextFromBrief` flattening (`intake-brief.ts:20-31`); deterministic `jdJobId` back-link stamped before the build finishes (`:61-63`); double-promote 409s (`:25-27`); the disabled state explains itself in Czech (`cs.json:3116`). Ledger refresh wired (`JdsSavedLedger.tsx:123`).
- code_check: confirmed-present.

### L1-TOM-12 · strength · operational guardrails all present
- cert_level: L1 · type: strength · dimension: trust
- severity: — · impact: {frequency: high, reachability: high, trust_erosion: —}
- got: Per-IP limiter 30/10min after cheap refusals, pinned by the contract test (`message/route.ts:36-38`, `rate-limit-contract.test.ts:119-128`); tenancy test colocated (`app/_lib/db/intakes-tenancy.test.ts`) and every query workspace-filtered (`db/intakes.ts:98,105,119,156,163,188,207`); the requestor message rides inside an untrusted-data fence (`intake.py:512`, `devcase/provenance.py:28-46`); message cap 4 000 chars both sides (`message/route.ts:9`, `intake.py:40`); IMMEDIATE transaction serializes racing exchanges (`db/intakes.ts:154-176`).
- code_check: confirmed-present.

## 5. Verdict

**L1-conditional.** The surface is structurally complete for Tomáš's job end to end (find → talk → live brief → promote → JD in Saved), the persona spec is a faithful encoding of the research, and the provenance machinery is genuinely regression-proof where it exists. Two majors carry forward to L2: the keyless close that asks for a correction it cannot accept (L1-TOM-4 — a direct fail of his "correction actually lands" criterion on an in-scope path), and the unmarked scalar spine, where the `medior` default can appear in the sign-off read-back as if captured (L1-TOM-5 — his stated instant-trust-kill is "a summary that claims he said things he didn't"). Neither blocks the job; both erode the exact trust this surface was designed to earn.

## 6. Time saved (if it all works)

- Baseline (his file): 2–3 h across two HR meetings + email thread + a borrowed-template JD, over two weeks.
- Designed path: 8–12 exchanges × (think/type ~30–60 s + 10–60 s model latency) ≈ **12–25 min**, one sitting, plus a background JD build he doesn't wait on.
- **Estimated saving: ~2–2.5 h and the two-week calendar spread → same-day**, *conditional on* the live register clearing the senior bar (L2) and per-exchange latency staying near the low end (L1-TOM-7). Keyless: ~10 min guided form, saving holds but the laddering/de-spec value — the part that beats his own rough-out — is absent, honestly disclosed.
- **Confidence: medium.** Structure and prompt design are verified; the felt register, Czech naturalness, and latency are exactly the things L1 cannot see.

## 7. Tomáš, first person (candid)

Tak jo. Přiznám se, že jsem to otevřel s tím, že to bude další formulář, co se tváří jako chat. První věta mě odzbrojila — "nejsou tu žádné špatné odpovědi, klidně i mlhavě" — přesně tohle mi u HR chybí. A otázka na poslední měsíc místo "jaké máte požadavky"? To je otázka, na kterou odpovědět umím.

Co se mi líbí: vidím, jak se zadání skládá, zatímco mluvím, a u každé věci je napsáno, jestli jsem to řekl já, nebo si to stroj domyslel. "Řekli jste" vs. "úsudek AI" — tohle bych podepsal. A že z toho na jeden klik vznikne inzerát, který jde HR, aniž bych psal jediný odstavec — jestli tohle funguje, tak ty dvě schůzky s HR fakt odpadnou a řeknu to i Petrovi z platform týmu.

Co mě štve: v tom náhledu je u role napsáno "(medior)" i když jsem o úrovni možná vůbec nemluvil — a v závěrečném shrnutí, pod které se mám podepsat, to vypadá jako moje slovo. To je přesně ta věc, kterou nesnáším. A když jsem to zkoušel bez AI (prý offline režim — aspoň to poctivě přiznává), tak se mě na konci zeptalo "co jsem pochopil špatně?" a zamklo mi okno dřív, než jsem stihl odpovědět. Ptát se a nedat mi odpovědět je horší než se neptat.

Adoptoval bych to? Podmíněně ano — na první roli to zkusím, protože i kdyby to bylo jen napůl tak chytré, jak vypadá ten návrh, ušetří mi to dvě schůzky a hlavně ten pocit, že jsem u výslechu. Ale jestli mi to jednou v shrnutí přiřkne něco, co jsem neřekl, končím a vracím se k tomu, že JD napíše někdo jiný. Důvěra se tady buduje po replikách a ztrácí po jedné.

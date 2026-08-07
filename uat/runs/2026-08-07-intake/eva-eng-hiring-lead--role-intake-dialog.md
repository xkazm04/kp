# L1 report — Eva Marešová (eng hiring lead) × role-intake-dialog

- run: 2026-08-07-intake · level: **L1 (theoretical, code-grounded — no browser)**
- character: `uat/characters/eva-eng-hiring-lead.md` · behavior modes sampled: `power_unit` shape + `over_specifier`
- journey: `uat/journeys/role-intake-dialog.md` · language: cs
- verdict: **L1-conditional**

---

## 1. Surface model (verified import chain, file:line)

**Mount:** Library workspace tab → Saved/Generate/Intake `SegmentedControl`
(`app/features/library/jds/JdsSavedLedger.tsx:88-105`; intake option at :103).
Tier-3 dynamic chunk, idle-deferred, stays mounted so an in-flight dialog
survives a sub-tab switch (`JdsSavedLedger.tsx:45-47`, `:121-125`).

**UI:**
- `app/features/library/jds/intake/JdsIntakePanel.tsx` — ledger of sessions (:21-64) / active session header + Promote gating (`briefReadyToPromote`, :67, :86-95), degradedNote (:98).
- `JdsIntakeChat.tsx` — transcript bubbles + composer; composer disabled when `closed` (:71-72, :85).
- `JdsIntakeBriefPanel.tsx` — the live brief; `ProvenanceChip` stated/inferred/default (:12-17); musts/nices with learnable chip (:58-78); facets with provenance (:84-92).
- `jdsIntakeLogic.ts` — fetch/state; optimistic send + rollback (:106, :139), stale-session guard (:44), promote POST **with no body** (:152).

**API (all operator-gated, workspace-scoped):**
- `app/api/intake/route.ts` — POST create + deterministic opener (:23-26), GET ledger.
- `app/api/intake/[id]/route.ts` — point read, workspace-filtered (:16).
- `app/api/intake/[id]/message/route.ts` — one exchange; 404/409/400 refusals **before** the per-IP `rateLimit` 30/10min (:28-37), transcript-before-message contract (:43-48), atomic persist (:59-69). Pinned in `app/api/rate-limit-contract.test.ts:118-129`.
- `app/api/intake/[id]/promote/route.ts` — `briefReadyToPromote` gate (:28), same three-step backgrounded `jd_build` contract as Generate (:47-60), `markIntakePromoted` stamps `jd_slug` + deterministic `jobId` (:63).

**Lib/DB:**
- `app/_lib/intake-run.ts` — spawns `pipeline.jobfit.intake_cli` per exchange (:54-69); opener spawned with **no LLM env** → deterministic both keyed and keyless (:39-44).
- `app/_lib/intake-brief.ts` — `needTextFromBrief` (:20-31), `briefIntentSummary` (:37-52), `briefReadyToPromote` (:57-62). Pure; tested in `intake-brief.test.ts`.
- `app/_lib/db/intakes.ts` — every query filters `workspace_id` incl. point reads (:103-108); IMMEDIATE transaction on dialog update (:154-176); `promotedBriefForJob` (:183-194). Table allow-listed at `app/_lib/tenancy.ts:189` with `app/_lib/db/intakes-tenancy.test.ts` colocated.

**Engine (Python):**
- `pipeline/jobfit/intake_cli.py` — provider `resolve_provider("role_intake", timeout=120)` (:54), documented keyless dance → deterministic (:56).
- `pipeline/jobfit/intake.py` — persona constants `_PERSONA_CORE/_TECHNIQUE/_SHAPE/_CLOSE` + `_EXTRACTION_RULES` (:49-109); shape triage regexes (:151-174); deterministic slot script `_Q` en/cs (:188-229); `merge_brief` stated-never-regresses guard (:399-456); per-exchange prompt = accumulated brief + last-48-turn transcript + `fenced_untrusted` message (:509-516); `generate_with_fallback` shared provenance runner (:518-526).
- `pipeline/jobfit/rolebrief.py` — RoleBrief schema: graded requirements (kind/hardness/weight/rationale/provenance/confidence, :73-85), open facets with `source_turn` (:87-97), coercion floor `coerce_role_brief` (:141-200), `brief_job_requirements` projection (:237-246).

**Promote seam:** `app/_lib/jd-build-run.ts` — `JdBuildInput.brief` (:41), brief regenerates needText for faithful replay (:235), fills `DevNeed` structurally: `stack = briefMustSkills` (:238), `responsibilities = successCriteria + responsibilities` (:239-241), seniority/roleFamily fallback (:243-244) → `runNeedAnalysis`/`runDesignArtifacts` (:252-258).

**Phase-3 grounding seam:** `app/_lib/interview-run.ts` — `promotedBriefForJob(entry.jobId, getJobWorkspace(...))` → `briefIntentSummary` (:330-337), threaded into `composeBrief` **after** the run-of-show, interviewer-internal, never read aloud (:127-166, esp. :164; digest text `intake-brief.ts:48-51`).

**Dev-case world (Eva's destination):** Dev tab authoring requires picking a **saved JD**; `buildNeed` sends `jdText = jd.body` with `stack: []`, `responsibilities: []` deliberately re-extracted from the JD markdown (`app/features/tools/devcases/useDevTabData.ts:95-113`). The structured brief is not read there (verified: `promotedBriefForJob` has exactly one consumer, interview-run.ts).

## 2. Grounding audit — 7/9

| # | Context element | Reaches the prompt/consumer? | Evidence |
|---|---|---|---|
| 1 | Accumulated RoleBrief in every exchange | ✓ | intake.py:510 |
| 2 | Full transcript (last 48 turns) | ✓ | intake.py:41, :511 |
| 3 | New message, fenced exactly-once | ✓ | intake.py:512; message route :43-48 |
| 4 | Research persona (10 rules + shape + close + extraction) | ✓ | intake.py:49-109 |
| 5 | Language directive (en/cs) | ✓ | intake.py:121 |
| 6 | Promote → JD build gets the structured brief, not just flat text | ✓ | jd-build-run.ts:233-246 |
| 7 | Interviewer grounding gets the stated intent digest | ✓ | interview-run.ts:330-338 |
| 8 | Org/workspace context (existing similar roles, team, market band) into the dialog | ✗ | prompt carries only items 1-3; nothing from jobs/market_pulse |
| 9 | Structured brief into dev-case design from her surface | ✗ | promote UI sends no `caseDesign` (jdsIntakeLogic.ts:152 vs promote route :34); Dev tab rebuilds from JD markdown (useDevTabData.ts:95-113) |

Good machinery, honestly fed on the dialog loop itself; the thin seams are around it (8, 9).

## 3. Walkthrough (as Eva, cs, power_unit + over_specifier)

1. **Entry** — Library → „Zadání role". Ledger + „Nový rozhovor". Opener is deterministic and identical keyed/keyless (route :23-26) — good first-impression discipline. Czech copy is real Czech („Kde tým nejvíc cítil, že tenhle člověk chybí?"), correct plural rules on „replika/repliky/replik" (messages/cs.json).
2. **Backfill, short path (power_unit)** — I open with „Odešel nám senior backenďák, potřebuju náhradu." The persona triages within two questions and collapses to the short path (intake.py:81-88); deterministic short script = 6 slots + read-back ≈ 7 exchanges (:308-313) — inside the journey's ≤8. **But** the Czech marker regex fails inflected forms: verified `posilu`, `náhradu`, `posila`, `dalšího` all miss `_POWER_UNIT_MARKERS` (intake.py:151-155; trailing `\b` blocks suffixes) → on the deterministic path my natural Czech backfill falls to the 10-slot story script + read-back = 11 exchanges. The LLM path can override, but the heuristic is the floor (coerce, :505).
3. **Over-specified list** — I paste 9 „musts". The persona rules 4 and 9 are exactly right for me: ladder each must once, demote what doesn't survive without arguing, and above six ask me to rank the top three (intake.py:66-69, :76-78). `merge_brief` guarantees a stated grading never regresses to an inferred one (:435-437). Deterministic path, though, swallows all 9 at weight 0.8, no laddering (:258-261).
4. **Watching the brief** — the live panel fills with per-value chips; Czech chips are excellent copy: „Řekli jste" / „Úsudek AI" / „předpoklad". But `seniority` renders with **no chip** (JdsIntakeBriefPanel.tsx:46) and defaults to `medior` (rolebrief.py:105) — intake.py:296 itself admits the default is indistinguishable from unset.
5. **Close** — read-back lists everything and asks „Co jsem pochopil špatně nebo co chybí?" — and in the same breath prints `<<END>>` and sets `done=true` (intake.py:346, :389-391) → route flips status `complete` (message route :66) → composer locks („Tento rozhovor je uzavřený", JdsIntakeChat.tsx:71). The correction I was just invited to make **cannot land** on the deterministic path; the LLM path is instructed to wait for confirmation (:94-95) but `coerce` accepts a one-shot readback+END (:506).
6. **Promote** — gate is honest (title + one must or 90-day outcome, promote route :28-33, hint tooltip on the disabled button). Build lands in Saved JDs as „Analyzing", detached, back-linked. The DevNeed is filled from the brief's graded fields — the exact asymmetry fix the concept promised (jd-build-run.ts:229-246).
7. **On to my dev case** — I pick the promoted JD in the Dev tab… and the need is re-extracted from the JD **markdown**, stack/responsibilities empty by recorded decision (useDevTabData.ts:92-98). My requestor's words have passed through two generative hops (brief → designed RoleSpec → markdown → re-analysis) before the case designer sees them; weights, rationale, provenance are gone. The direct brief→case seam exists in code (`jd_build` `options.caseDesign`) but my Promote button never offers it (bodyless POST, jdsIntakeLogic.ts:152 → `caseDesign: false`, promote route :34, :42).
8. **Later, the interview** — a candidate on this job gets an interviewer grounded in *my requestor's stated* 90-day outcomes and dealbreakers, interviewer-internal, never read aloud (interview-run.ts:325-338; intake-brief.ts:48-51). That, I can defend. „Obhájím to před ředitelem? Tady čím: tohle řekl team lead, tady je přepis."

## 4. Findings

### Strengths

**L1-EVA-S1 · strength · The research persona is machine-encoded, not vibes**
- type: quality-gap(+) · severity: — · evidence: `pipeline/jobfit/intake.py:49-109`
- The 10 rules (one question/turn, reflect-then-ask ~2:1, reuse-their-words, ladder musts, park solutions, name contradictions, this-or-that only after stall, 90-day de-spec, rank-top-3 above six musts, short turns) are literal prompt constants traceable to `docs/development/role-intake-research.md`, and the deterministic invariants are CI-gated (`pipeline/jobfit/eval/intake_eval.py`). Both her declared behavior modes (`power_unit`, `over_specifier`) have explicit handling by design.
- impact: {frequency: high, reachability: high, trust_erosion: low} · code_check: confirmed-present · resolution: open (keep)

**L1-EVA-S2 · strength · Provenance is enforced end-to-end for requirements/facets**
- evidence: intake.py:98-109 (stated only for said/confirmed), :435-448 (stated never regresses in merge), rolebrief.py:141-200 (coercion floor), JdsIntakeBriefPanel.tsx:12-17 (chips), deterministic path stamps requestor answers `stated` 0.9 (intake.py:241-266).
- This is the spine of her „obhájím to" test and it holds in code. Czech chip copy („Řekli jste") is exactly the right register.
- impact: {frequency: high, reachability: high, trust_erosion: low} · code_check: confirmed-present

**L1-EVA-S3 · strength · The promote seam is structural, not a document hand-off**
- evidence: jd-build-run.ts:229-246 (brief → DevNeed graded fields + regenerated needText for faithful task replay), promote route :47-63 (same backgrounded jd_build as Generate; jd_slug/job_id back-links), interview-run.ts:330-338 (Phase-3 interviewer grounding, workspace-derived, candidate-safe omission).
- impact: {frequency: high, reachability: high, trust_erosion: low} · code_check: confirmed-present

**L1-EVA-S4 · strength · Honest keyless degradation + abuse posture**
- evidence: deterministic opener both paths (route :23, intake-run.ts:39-44); `degradedNote` visible (JdsIntakePanel.tsx:98, cs: „AI je offline — pokračujeme vedeným dotazníkem…"); rate limit pinned by contract test; tenancy allow-listed with colocated test; fenced untrusted message (provenance.py:28).
- impact: {frequency: med, reachability: high, trust_erosion: low} · code_check: confirmed-present

### Issues

**L1-EVA-1 · broken-flow · The close invites a correction it then refuses to accept (deterministic path)**
- severity: **major** · dimension: trust + completion
- evidence: the deterministic read-back ends „Co jsem pochopil špatně nebo co chybí? Pokud nic, brief uložím. `<<END>>`" **in the same turn** that returns `done: true` (intake.py:346, :361, :389-391) → message route sets status `complete` (:66) → next message 409s (:29-31) and the composer locks (JdsIntakeChat.tsx:71-72, :85). The journey's DoD says „the close is a grounded read-back they can correct, and the correction lands" — keyless, it structurally cannot. The persona's own rule „Never emit `<<END>>` before a read-back was confirmed" (intake.py:94-95) is violated by the sibling deterministic code; and on the LLM path `coerce` accepts a one-shot readback+END too (:506) — the confirmation wait is instructed, not enforced.
- impact: {frequency: high (every completed keyless session), reachability: high, trust_erosion: high — an ignored „what did I get wrong?" is worse than not asking}
- code_check: confirmed-broken (deterministic) / present-but-unenforced (LLM) · adjacent to the documented „re-opening a completed session" gap, but this is the *close itself* breaking its promise, not a re-open wish.
- l2_priority: **high** — drive an LLM session to the read-back and test whether a correction turn is accepted before `<<END>>`.

**L1-EVA-2 · quality-gap · Czech backfill phrasing never triggers the short path (marker regex misses inflections)**
- severity: **major** · dimension: effort + senior-quality (cs) · scope_note: keyless/fallback floor; keyed LLM may triage correctly
- evidence: `_POWER_UNIT_MARKERS` (intake.py:151-155) — executed against natural Czech openers: `posilu`, `náhradu`, `posila do týmu`, `dalšího backenďáka` all **fail** (trailing `\b` after stems like `posil|náhrad` blocks Czech suffixes; only uninflected `stejná/…jako minule` match). `detect_shape` then defaults to `story` after 2 turns (:172-173) → the 10-slot script + read-back ≈ 11 exchanges (:313) instead of ≤8 — exactly the „coaching depth forced on a transactional request" her mode resents. The heuristic is also the floor whenever the LLM omits/mangles `shape` (:505).
- impact: {frequency: high for a Czech power_unit character on the deterministic path; med overall, reachability: high, trust_erosion: med}
- code_check: confirmed-broken (reproduced in Python against the exact pattern) · fix shape: stem the Czech alternatives (`posil\w*`, `náhrad\w*`, `stejn\w*`, `dalších?o?`) or drop the trailing `\b` for the Czech branch.
- l2_priority: med (L2 should count exchanges on a Czech backfill opener, keyed and keyless).

**L1-EVA-3 · missing-feature · The brief dies as a structured object at the dev-case seam — her headline job**
- severity: **major** · dimension: completion (her JTBD #1: author a dev case from the real role need)
- evidence: the direct thread exists — `jd_build` accepts `options.caseDesign` and would design the case from the brief-filled DevNeed (jd-build-run.ts:238-258) — but (a) the intake Promote button sends a bodyless POST (jdsIntakeLogic.ts:152), so `body.caseDesign === true` is always false (promote route :34, :42); no checkbox exists on the intake surface; (b) the Dev tab's authoring path re-derives the need from the JD **markdown** with `stack: []`, `responsibilities: []` by recorded decision (useDevTabData.ts:92-113), and `promotedBriefForJob` has exactly one consumer (interview-run.ts:6) — the dev-case designer never sees the graded requirements, weights, rationale, or the 90-day outcomes as *stated* data, only their twice-transformed echo (brief → designed RoleSpec → markdown → re-extraction).
- impact: {frequency: high (every intake→devcase pass she runs), reachability: high, trust_erosion: med — the case still generates, but its link to „what the team lead actually said" is narrative, not structural, which weakens her director defense}
- code_check: confirmed-absent (seam present in code, unreachable from her surfaces)
- l2_priority: **high** — L2 should promote an intake and inspect how role-specific the authored case is versus the requestor's stated musts.

**L1-EVA-4 · trust · Spine fields have no provenance; the `medior` default can masquerade as a decision**
- severity: **major** · dimension: trust
- evidence: `RoleBrief.seniority` defaults `"medior"` (rolebrief.py:105) and title/seniority/languages/success_criteria carry **no** provenance field (only requirements + facets do, rolebrief.py:73-97); intake.py:296 concedes „the default 'medior' is indistinguishable from unset"; the read-back prints „Role: … (medior)" unconditionally (intake.py:334-335, :349) and the brief panel shows the seniority chip with no ProvenanceChip (JdsIntakeBriefPanel.tsx:46). The schema's own promise — „a template default can never masquerade as something the requestor said" (rolebrief.py:23-26) — holds for requirements/facets and fails for the spine. A senior backfill promoted with an unexamined `medior` propagates into the JD build (`brief.seniority`, promote route :47) and the salary lookup.
- impact: {frequency: med (over_specifiers usually state level; vague requestors won't), reachability: high, trust_erosion: high when it fires — a wrong level on the JD is a director-visible miss}
- code_check: confirmed-absent (by-design-adjacent; the code names the gap) · l2_priority: med.

**L1-EVA-5 · quality-gap · The defensibility layer is thinner than the schema: weights/rationale/confidence/source_turn captured-or-modeled but never shown, and no export**
- severity: minor · dimension: trust (director-defense depth)
- evidence: `BriefRequirement.weight/rationale/confidence` exist (rolebrief.py:81-85) but `JdsIntakeBriefPanel` renders only skill + learnable + provenance chips (:58-78); `facet.source_turn` has no writer anywhere (rolebrief.py:96 „None until the dialog ships"; no `source_turn` in intake.py) so per-value → transcript-turn tracing is transcript-wide, not per-claim; `brief_job_requirements` documents dropping weight/rationale at the matcher projection (rolebrief.py:237-241); there is no print/export of brief+transcript for the director meeting. Her audit trail today = provenance chips + the stored transcript + the jd_slug back-link — real, but she'd screenshot a chat to defend a weight she can't see.
- impact: {frequency: med, reachability: high, trust_erosion: med}
- code_check: confirmed-absent (present-in-schema, missing-in-UI) · l2_priority: low.

**L1-EVA-6 · quality-gap · Over-specifier handling is LLM-only; keyless swallows the laundry list flat**
- severity: minor · scope_note: keyless degradation, honestly disclosed via degradedNote
- evidence: deterministic `musts` slot accepts every line at uniform weight 0.8, no laddering, no rank-top-3 (intake.py:258-261); `merge_brief` silently truncates at 24 requirements (:441) with no note in the read-back.
- impact: {frequency: low-med, reachability: high, trust_erosion: low — chips still say `stated` truthfully}
- code_check: confirmed-present (by-design floor) · l2_priority: low (L2 tests the LLM laddering live instead — that's the register check).

**L1-EVA-7 · confusion · Comment claims a consumer that doesn't exist yet**
- severity: polish
- evidence: `db/intakes.ts:179-180` names „interview grounding, decision audit" as back-link consumers; only interview-run.ts imports `promotedBriefForJob` (repo-wide grep). Doc/comment drift of the exact kind `.claude/CLAUDE.md` warns about.
- impact: {frequency: low, reachability: n/a, trust_erosion: low} · code_check: confirmed-absent.

## 5. Dialog-overlay checks (designed experience, L1 reading)

| Check | LLM path (designed) | Deterministic path | Evidence |
|---|---|---|---|
| One question per turn | ✓ rule 1 | ✓ one slot per turn | intake.py:60, :385-389 |
| Reflect before asking (expansion, not read-back) | ✓ rule 2 (~2:1) | ✗ fixed questions, no reflection — honest for a „guided form" | :61-64 |
| Reuse the speaker's words | ✓ rule 3 | ✗ (n/a — scripted) | :63-65 |
| Park premature solutions | ✓ rule 5 | ✗ (n/a) | :68-70 |
| Name contradictions aloud | ✓ rule 6 | ✗ (n/a) | :70-72 |
| Grounded, correctable read-back close | ◐ instructed but one-shot END accepted | ✗ **broken** — see L1-EVA-1 | :90-96, :346, :506 |
| Provenance honesty (stated never claimed for inferred) | ✓ enforced in merge | ✓ everything typed = stated | :100-104, :435-448, :241-266 |
| Shape economics (depth earned by ambiguity) | ✓ rule + triage | ◐ script splits 6 vs 10 slots but cs triage misfires — L1-EVA-2 | :81-88, :151-174, :308-313 |

## 6. Time-saved estimate

Baseline (her manual way): a 45-60 min intake meeting with the hiring manager + 30-60 min writing up the role need + at least one clarification round → **~1.5-2 h per role**, and the output is prose she then re-types into the Dev tab.

With this surface: a keyed power_unit dialog ≈ 7-8 exchanges × (her typing + 10-60 s per exchange) ≈ **10-20 min**, and Promote yields the JD + matchable job + interviewer grounding without a write-up step. **Estimate: ~60-90 min saved per role intake, and the artifact is better than her notes (provenance + structure).** Confidence: **medium** — L1 cannot verify live latency, the felt register, or Czech naturalness; and the estimate degrades if the Czech shape triage (L1-EVA-2) forces the 11-exchange script, or if she must re-establish the need by hand at the dev-case seam (L1-EVA-3), which claws back 10-15 min of exactly the re-typing the tool promised to kill.

## 7. Verdict

**L1-conditional.** The dialog loop itself is structurally sound and unusually honest — persona rules as citable constants, enforced provenance, real tenancy/rate-limit/i18n discipline, a promote seam that is structural rather than a document hand-off, and Phase-3 interviewer grounding that closes the loop to the candidate conversation. The conditions: the close that refuses its own invited correction (L1-EVA-1), the Czech short-path triage miss (L1-EVA-2), the brief dying as a structured object exactly at Eva's dev-case doorstep (L1-EVA-3), and the unprovenance'd `medior` spine default (L1-EVA-4). None blocks the journey end-to-end; all four are the kind she would raise in the first director demo. Majors carry forward to L2.

## 8. Eva's feedback (first person)

Tak upřímně: tohle je poprvé, co mi nástroj na „zadání role" nepřipadá jako formulář v převleku. Ty chipy — „Řekli jste" vs. „Úsudek AI" — to je přesně ta věc, kterou potřebuju, když se mě ředitel zeptá „a kdo tvrdí, že Kafka je nutná?". Odpověď: team lead, tady je přepis. To se mi obhajuje samo.

Ale tři věci mi vadí, a jedna hodně. Zaprvé — zeptáte se mě „co jsem pochopil špatně?" a v tu samou vteřinu mi zamknete okno. To je jako když si kolega na konci schůzky řekne o feedback a odejde z místnosti. Zadruhé — napíšu „potřebuju náhradu za seniora" a systém (bez klíče) se mnou stejně rozjede desetibodové koučovací kolečko. Já nemám krizi identity týmu, já mám prázdnou židli. Zatřetí, a to je pro mě to hlavní: celý ten krásný strukturovaný brief — váhy, co je nezbytné a proč — se cestou k mému dev casu rozpustí do markdownu. Case designer pak čte inzerát, ne to, co team lead řekl. Když pak ředitel srovná case s tím, co jsme si na intaku řekli, chci, aby ta nit byla vidět — ne ji vyprávět zpaměti.

A drobnost: „medior" jako tichý default bez chipu je přesně ten typ „předpokladu v převleku", který jinak celý systém tak pečlivě hlídá. Jinak — palec nahoru, tohle bych svým hiring managerům dala do ruky. Po opravě těch čtyř věcí i bez dozoru.

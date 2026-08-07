# /uat recertify — run 2026-08-07-intake (diff report)

Recertification of the fixes shipped after run `2026-08-07-intake`: the two
`fixed`-not-yet-verified resolutions (L1-EVA-3 dev-case seam; the drain build
items) re-run at L2 against the live app on `http://localhost:3000`, evidence
in `shots/` (gitignored; retained locally). Drivers:
`uat/driver/drive-recertify.mjs` (flows A/B/C/D/E) +
`uat/driver/drive-edit-kind.mjs` (targeted requirement-kind edit).

## Environment drift (caught before any check ran)

- The long-running dev server had **wedged into all-500s** after the day's
  merges (Turbopack state corruption; `/api/*` 404'd even after a plain
  restart because the stale `.next` survived). Recovery per `uat/env.md`:
  kill PID, delete `.next`, clean restart — after which every route served.
  Lesson reinforced: after multi-branch merge days, recycle the dev server
  before trusting L2 evidence.
- Two sessions share the title "Senior Java vývojář — platební tým" (the
  promoted one and the un-promoted correction-recert one). List-row status
  chips (`Inzerát vytvořen` vs `Probíhá`) are the only discriminator —
  drivers must filter on both.

## Verdicts

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | L1-EVA-3 — brief feeds dev-case seam structurally | **resolved-verified** | `D-02-jd-picked.png` (JD picked in Define-need, "Role title, stack and responsibilities are read from this JD"); live `GET /api/jds/xd5627eu?brief=1` returns `intakeBrief` with graded musts Java/Spring/Kafka; promote row shows the case-design checkbox (`C-01`, `A-*`) |
| 2 | Drain 2.1a — editable brief, provenance-honest | **resolved-verified** | `F-01`→`F-03`: Kafka kind flipped nice→must in edit mode, saved; lands under NEZBYTNÉ with `řekli jste` retained; untouched entries keep their chips |
| 3 | Drain 2.1b — re-open a completed session | **resolved-verified** | `A-06`/`A-07`: after `<<END>>` close, reopen flips status to `Probíhá`, centered system line "— Rozhovor znovu otevřel zadavatel. —" appears, edit re-enabled. Post-reopen send verified (message accepted, no 409 — the original L1-CONV-2 lock is gone) |
| 4 | Drain 2.1c — promoted brief frozen | **resolved-verified** | `C-01-promoted-frozen.png` (2nd run): frozen note shown, NO edit affordance, export still available |
| 5 | Drain 2.2a — turn citations | **resolved-verified** | `A-02-turn-chip-flash.png`: clicking `replika [1]` scrolls the chat and rings exactly turn 1's bubble mid-flash |
| 6 | Drain 2.2b — detail rows | **resolved-verified** | `E-01-detail-row.png` + journal: expanded row renders `váha` and `jistota` (+ rationale line) |
| 7 | Drain 2.2c — markdown export | **resolved-verified** | Real download captured (`export-brief.md`): per-entry provenance (`řekli jste`/`úsudek AI` · `replika [N]`) + numbered transcript; seniority carries its provenance inline |
| 8 | Drain 2.3 — grade_label beyond the tech ladder | **resolved-verified** | `B-01-grade-label.png`: "Band 5, roughly" stored verbatim as stated facet (`Zařazení podle nemocnice`, `replika [5]`); seniority stays `medior · předpoklad`; agent explicitly declines to re-box it |
| 9 | Drain 2.4 — latency honesty | **resolved-verified** | `A-latency-hint-10s.png`: at ~10 s the bubble shows the staged second line "Stále přemýšlím — pořádná odpověď obvykle zabere 30–40 sekund." |
| 10 | Voice plane (Direction 3) | **fixed / unverified** | Not verifiable on this host: `OPENAI_API_KEY` is empty in `.env.local` and the realtime transport is OpenAI-only (ElevenLabs key present but the EL adapter is design-only). The keyless fallback note renders correctly (`A-*` shots). Needs a keyed host to recertify |
| — | New regression R-1 — composer squeeze | **regressed (new)** | `C-01`, `A-05`, `B-01`: the keyless voice note (`JdsIntakeVoice` unavailable-state span, rendered inline in the composer flex row `JdsIntakeChat.tsx:131-155`) steals the row's width; the flex-1 textarea collapses to a ~1-character sliver. Typing still works (drivers passed), but visually the composer is unusable at 1440 px in cs |
| — | New polish R-2 — `<<END>>` leaks | **new (minor)** | `A-07`: the close sentinel `<<END>>` renders verbatim at the end of the final agent bubble instead of being stripped |

## Ceilings

- **#1**: seniority-selector seeding is provenance-gated (`spineProvenance.seniority === "stated"`); briefs promoted before the spine-provenance schema (incl. this fixture) don't seed the selector — correct abstention, but legacy promotes never will. Matching still doesn't consume weights (calibration-pinned, by design).
- **#2**: human edits mark `stated` wholesale; there's no per-field dirty tracking (editing only a requirement's kind rewrites the row as stated — acceptable per the drain guardrail, noted for honesty).
- **#3**: post-reopen *reply* quality unmeasured (flow hung on a driver selector, not the product); message acceptance verified, LLM continuation not re-judged.
- **#8**: grade_label capture is LLM-path; the deterministic floor stores non-enum grades as a plain facet without the dedicated label.
- **#9**: static staged copy, not elapsed-time; by design (streaming declined in drain §2.7).

## Metric deltas

- Live exchange latency measured 16–40 s this pass (16.3/22.6/20.0 s in flow
  B; 30–40 s in flow A) vs 31–40 s in the original run — same order, the
  30–40 s hint copy remains truthful.
- Time-saved estimates from the original run stand; the drain items add
  defensibility (export/citations) and correctness-of-record (edit/reopen)
  rather than changing journey duration.

## Loop state

All four drain build items (§2.1, §2.2, §2.3, §2.4) are now
**shipped + recertified**. L2-INT-5 is closed by §2.4. New findings R-1
(composer squeeze — the only regression) and R-2 (`<<END>>` leak) are recorded
in `../2026-08-07-intake/findings.json` for the next drain.

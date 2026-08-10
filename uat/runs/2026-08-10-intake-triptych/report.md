# UAT run 2026-08-10-intake-triptych — FINAL SCORECARD (L1 + L2)

Journey: **role-intake-dialog** · Characters: Eva Marešová (eng hiring lead) ·
Priya (healthcare-clinic HRBP) · Tomáš Krejčí (backend team lead).
L1 = theoretical, code-grounded (earlier today). L2 = empirical, live browser +
live API against the running dev server (this document).

## Certification reached

| character | L1 | L2 | cert level reached |
|---|---|---|---|
| eva-eng-hiring-lead | L1-pass | **L2-pass** — happy path driven end to end, promoted, no dead-end | **L2 — confirmed live** |
| tomas-backend-team-lead | L1-conditional (1 major) | **L2-conditional** — path completes live; his major reproduced with a control arm | **L2 — confirmed live, conditional** |
| hr-healthcare-clinic-hrbp | L1-conditional (2 majors) | **L2-conditional** — one major confirmed with a two-arm proof; the second confirmed in half | **L2 — confirmed live, conditional** |

The journey **reached L2 for all three characters**. Nothing structural blocked
the walk; every open item is a withheld handle or a lying label, not a broken
flow — the same shape L1 predicted, now with live proof.

## Environment + limitations (these bound the verdicts)

- **Server:** reused an already-running kp dev server on **:3000**. A second
  instance on :3005 (per `env.md`) refused to start — `Another next dev server is
  already running`, PID 30424, same directory — so the skill's reuse rule applied.
  `env.md`'s port guidance should soften from "pin :3005" to "detect the running
  instance first".
- **Keys:** `/api/health` -> `engines.gemini: true`. **The LLM path is what ran.**
  Every L1 claim scoped to the *keyless / deterministic* path (L1-HRBP-12's
  misclassification, L1-HRBP-13's mislabelled chip) is therefore **untested, not
  refuted**. Forcing keyless would mean removing the workspace's key — out of scope.
- **No OpenAI key.** The app says so itself, live: "Hlas není na tomto serveru
  nastaven — pokračujte textem." The voice-attachments defect stays unverified,
  exactly as the L1 ceiling predicted.
- **Driver contract repaired mid-run.** `drive.mjs` landed on the public marketing
  landing instead of the workspace; `env.md`'s 2026-08-07 drift note had predicted
  this and asked for the `kp_entered` cookie to be ported. Done in `drive.mjs` and
  `drive-ai.mjs`. New `uat/driver/drive-l2-inspect.mjs` added for multi-click
  navigation + spine folding. **Gotcha for the next session:** spine toggles carry
  their label as an *accessible name*, not visible text — `getByText` misses them,
  `getByRole("button", {name})` is required.

## Confirmed majors, with live evidence

### 1. L1-HRBP-11 — the market-research opt-out is real, works, and is unreachable · **CONFIRMED**

A two-arm proof; the cleanest "fix landed != fix reachable" this run produced.

- **UI arm:** the whole promote area is `checkbox "Navrhnout rovnou i praktickou
  úlohu"` + `button "Vytvořit inzerát"`. No market control anywhere. The draft
  pane asserts it unconditionally: "Finální inzerát (**včetně průzkumu mezd**)
  vznikne při Vytvořit inzerát." A browser-driven promote -> `options.marketResearch:
  true`, JD carries "**Mzda:** 103 000–154 500 CZK / month".
- **API arm:** `POST .../promote {"marketResearch": false}` -> 200,
  `options.marketResearch: false`, JD has **no salary line at all**.

### 2. L1-TOM-2 — an attachment-mined title masquerades as the requestor's words · **CONFIRMED (with a control)**

- **Arm A:** attached the saved posting `xd5627eu`; opening message named no title
  and explicitly rejected it. First LLM turn (32 s) -> `title: "Senior Java vývojář
  — platební tým"`, `spineProvenance: {title:"inferred", seniority:"inferred"}`.
- **Arm B (control, no attachment), same sentence** -> `title: "Senior backend
  engineer — platební tým"`. The attachment drove the title.
- **Render:** `Role Senior Java vývojář — platební tým senior úsudek AI` — the
  inferred chip is on *seniority*; the title is bare. A salary facet two lines
  below cites its own source correctly. The bare title also names the session in
  the sidebar and headlines the draft.
- **Wider than L1 framed it:** both live sessions carry `title: "inferred"`. The
  title is inferred by default and never chipped, attachment or not.

### 3. L1-HRBP-12 — roleFamily invisible and uneditable · **CONFIRMED in half**

Confirmed live: the Live brief shows title + seniority + provenance chip + context
facets and **no role family**; the "Upravit zadání" sheet has a title box, a
seniority combobox, a musts adder, free-form context rows — and **no roleFamily
control** — while the stored brief for that same session holds
`roleFamily: "healthcare_clinical"`. **Not reproduced:** on this keyed host the
LLM path classified the Czech nurse corpus *correctly*, so L1's misclassification
(a deterministic-classifier property) remains code-evidenced but untested live.
New live detail: a fresh intake initialises `roleFamily: "software_engineering"`
before any signal exists.

## Confirmed minors / convergent cluster

| finding | live evidence |
|---|---|
| **L1-EVA-10 · L1-HRBP-15 · L1-TOM-5** (x3 convergent) | Folded draft spine reads **"Popis pozice 0"** verbatim over a fully drafted posting. Expanded, the attachments pane is only `group: Podklady0`; **folded, it is absent from the accessibility tree entirely** — a persisted fold makes the attach affordance permanently invisible. |
| **L1-EVA-9 · L1-TOM-6** (x2 convergent) | The supersede promise rendered verbatim. After promote: `xd5627eu` still `archived_at = NULL`, new slug `t9u3iv9w`, and Saved JDs lists **two rows with the byte-identical title**, both "Koncept", both Software/Senior. Worse than L1's "look-alike" — twins. |
| **L1-TOM-3** | `build_input_json` = `needText, seniority, roleFamily, lang, options` — no attachments. But `needText` carries the distillate, so the built JD still opens with "Java — produkční zkušenost (potvrzená tvrdá podmínka requestora)". Phase boundary holds in outcome; stays minor. |

## New at L2 (L1 missed these -> surface-model gap)

- **L2-CONV-1 · minor · the SECOND spine badge lies too.** The **brief** spine
  reads **"Živé zadání 0"** over a brief holding a title, a seniority, seven
  context facets and two success criteria — because `countFor` maps it to
  `requirements`, empty in every live session. Two of three spines badge zero on a
  rich session; the folded Triptych reads as an empty workspace. **The backlog #4
  fix must repair both branches of `countFor`, not just the draft one.**
  *Why L1 missed it:* three parallel walkers all read `countFor`'s draft branch,
  found the bug there, and none paired the brief branch against a live brief shape.
- **L2-NEW-2 · minor · confirmed dealbreakers never reach `requirements[]`.**
  "Tvrdá podmínka je Java a Kafka v produkci", stated and confirmed, left
  `requirements[]` empty in all three sessions driven (3-turn API, 3-turn browser,
  pre-existing 14-turn). The edit sheet's "Nezbytné / Výhodou" block sits empty.
  Mitigated — `needText` carries them into a correct JD — so the defect is
  representational: what the requestor can inspect and correct is thinner than what
  the system knows. Compounds L2-CONV-1 (it is what the brief badge counts).

## Refuted / uncertain (appendix)

- **L2-REF-1 — REFUTED.** A mid-run scare that Czech diacritics were corrupted on
  the way into the transcript. The same sentence through the **real composer**
  stored perfectly; the mojibake came from the Windows Git-Bash curl payload.
  Recorded so no future run re-raises it.
- **L1-HRBP-13 — UNCERTAIN, not reproducible on a keyed host.** `spineProvenance`
  contains only `title` and `seniority` on the LLM path — `role_family` never
  appears, so the mislabelled "inferred" chip has nothing to render from. A
  keyless-path residual; L2 neither confirms nor refutes.

## Updated value ledger — promise vs live

| | L1 (design promise) | L2 (measured live) |
|---|---|---|
| Eva | ~75–100 min/role · medium-high | **Holds.** 22.4 s / 52.3 s / 33.3 s per exchange + 8.0 s promote -> **~2 min of model time for a promoted, provenance-tracked posting**. Confidence raised to **high**. |
| Tomáš | ~2–2.5 h + two calendar weeks -> ~15 min · medium | **Holds structurally**, docked on trust: the first value he reads is unattributed and he says he will overwrite it every time. Confidence **medium-high**. |
| Priya | ~60–90 min/role · medium | **Holds for the dialogue**, but the two withheld handles are now proven unreachable rather than merely absent in code. She cannot sign off on the output. Confidence **medium**. |

**Grounding.** Unchanged from L1 (8/10 · 15/16 · 5/8 — non-comparable denominators
by construction, see SUMMARY.md). L2 adds one live grounding fact: **attachments
reach the dialog prompt and demonstrably shape it** (the A/B title control is the
proof), and equally demonstrably **do not reach the build**.

## What passed

- **The happy path, end to end, unsupervised** — opener -> three exchanges ->
  promote -> a ready JD, `error: null`, every exchange settled, no timeout, no lost
  turn, at honest 22–52 s latency, with the composer disabling itself so the wait
  is legible. `L2-EVA-S1`.
- **The engine tells the truth about itself.** It stamped the borrowed title
  `inferred` without being asked, and chipped the salary facet with its own source:
  "(z přiloženého inzerátu, nepotvrzeno requestorem) úsudek AI". The provenance law
  is real in the data; only one renderer opted out.
- **The requestor's words survive.** "Band 5, roughly — tak tomu říká nemocnice"
  stored verbatim and echoed back as such, not translated into the product's taxonomy.
- **Keyless honesty is visible, live** — "Hlas není na tomto serveru nastaven —
  pokračujte textem" states the limit rather than degrading silently.
- **The market read discloses its own nature** when it fires: "Odhadnuto z interní
  tabulky mezd podle oborů (bez živých webových podkladů)". The complaint is that it
  cannot be declined, not that it lies.
- **Czech round-trips intact** through the real composer.
- **The Triptych's safety rails held** under live folding — min-one-open guard,
  persisted folds, keyboard-operable spines. The badge fix must work inside them.

## Panel verdict (live)

All three adopt; none can fully sign off. The engine earned *more* trust at L2 than
at L1 — it labels its own guesses without being asked — and then spends that trust
on labels that either withhold what they know (the bare title, the invisible role
family, the unreachable market switch) or assert what they do not (two spines
badging zero over a full session, a supersede note that creates twins). **The
remaining work is not intelligence; it is telling the user what the system already
knows.**

"""S2 (ADR 0027) — the supplied AI-draft critique stimulus, curated per role family.

Every case ships ONE file that is truthfully labelled as an unreviewed AI-generated draft
the candidate may use, fix or discard. Each draft carries 1-3 flaws with a single
checkable ground truth (an arithmetic slip, a fact any practitioner can look up, a comment
that contradicts the code beside it), recorded as canaries in the seed_materializer
shape and graded by the existing channel-neutral rule (artifact_checks.canary_outcomes):
fixed or flagged = caught, left in place = propagated. Nothing here is a new scoring
channel, and using the draft is never rewarded or penalised by itself — only whether its
claims were checked.

Why curated rather than templated: the keyless seed used to plant NO canaries, on purpose
("a template flaw with no real ground truth would grade candidates against noise"). These
drafts are self-contained, so each flaw is wrong in every case of its family, whatever the
brief says. The draft text never hints at its flaws beyond the truthful "unreviewed"
label, and each flaw quotes a fragment that occurs exactly once in its file (pinned by
tests/test_devcase_ai_draft.py).

Keyed by the canonical taxonomy families (``taxonomy.ROLE_FAMILIES``); the devcase
scenario vocabulary aliases onto them and anything else falls back to the
general-professional draft, so every role the keyless path can see gets one.
"""

from __future__ import annotations

from typing import Any

# The truthful label every draft opens with (tests find the draft by it).
DRAFT_LABEL = "UNREVIEWED AI-GENERATED DRAFT"
DRAFT_DIR = "drafts"
_LABEL_TEXT = (
    f"{DRAFT_LABEL}. An AI assistant wrote this file and no person has reviewed it. "
    "You may use it, fix it or discard it."
)
FALLBACK_FAMILY = "general_professional"


def _md(title: str, body: str) -> str:
    return f"> {_LABEL_TEXT}\n\n# {title}\n\n{body.strip()}\n"


def _py(body: str) -> str:
    return f"# {DRAFT_LABEL}.\n# An AI assistant wrote this file and no person has reviewed it.\n# You may use it, fix it or discard it.\n\n{body.strip()}\n"


_SOFTWARE = _py('''
"""Retry helper for calls to the partner API."""

import time


def backoff_delays(retries: int, base: float = 0.5, cap: float = 30.0) -> list[float]:
    """Exponential backoff: attempt n waits base * 2**n seconds, never more than cap."""
    return [min(cap, base * 2 * n) for n in range(retries)]


def call_with_retry(fn, retries: int = 4):
    for delay in backoff_delays(retries):
        try:
            return fn()
        except ConnectionError:
            time.sleep(delay)  # delay is in milliseconds
    return fn()
''')

_DATA_AI = _py('''
"""Hold-out split and feature scaling for the churn model."""

import numpy as np


def split_and_scale(X_all, y_all, test_share: float = 0.2, seed: int = 7):
    """Hold out test_share of the rows for testing, then standardise every feature
    with statistics computed on the training rows only."""
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(X_all))
    cut = int(len(X_all) * test_share)
    train, test = idx[:cut], idx[cut:]
    mean, std = X_all.mean(axis=0), X_all.std(axis=0)
    return (X_all[train] - mean) / std, (X_all[test] - mean) / std, y_all[train], y_all[test]
''')

DRAFTS: dict[str, dict[str, Any]] = {
    "software_engineering": {
        "path": f"{DRAFT_DIR}/ai_draft_retry.py",
        "contents": _SOFTWARE,
        "flaws": [
            {"id": "d1", "kind": "subtle_bug", "flaw": "the backoff grows linearly: 'base * 2 * n' instead of exponentially",
             "groundTruth": "base * 2 ** n, as the docstring states", "reveals": "did they read the generated helper against its own contract?"},
            {"id": "d2", "kind": "misleading_comment", "flaw": "the comment claims 'delay is in milliseconds' but time.sleep takes seconds",
             "groundTruth": "time.sleep takes seconds; the delays are seconds", "reveals": "do they trust a comment or the API it describes?"},
        ],
    },
    "data_ai": {
        "path": f"{DRAFT_DIR}/ai_draft_split.py",
        "contents": _DATA_AI,
        "flaws": [
            {"id": "d1", "kind": "subtle_bug", "flaw": "'cut = int(len(X_all) * test_share)' makes the TRAINING set the 20% share",
             "groundTruth": "cut = int(len(X_all) * (1 - test_share))", "reveals": "did they check which side of the split is which?"},
            {"id": "d2", "kind": "subtle_bug", "flaw": "'mean, std = X_all.mean(axis=0), X_all.std(axis=0)' uses all rows, leaking the test set into scaling",
             "groundTruth": "compute mean and std on X_all[train] only, as the docstring states", "reveals": "do they spot test-set leakage in generated preprocessing?"},
        ],
    },
    "product_project": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_release_plan.md",
        "contents": _md("Release plan", """
| Phase | Duration |
| --- | --- |
| Discovery | 3 weeks |
| Build | 2 weeks |
| Stabilise | 3 weeks |

Total duration: 9 weeks.

Kick-off is Monday 2 February 2026, so the launch lands on Friday 14 March 2026.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "the plan says 'Total duration: 9 weeks' but its phases sum to 8",
             "groundTruth": "3 + 2 + 3 = 8 weeks", "reveals": "did they add up the plan before adopting it?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'Friday 14 March 2026' is not a Friday",
             "groundTruth": "14 March 2026 is a Saturday; the Friday is 13 March 2026", "reveals": "do they check dates a generated plan commits to?"},
        ],
    },
    "healthcare_clinical": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_patient_handout.md",
        "contents": _md("Fever care at home (adults)", """
- Paracetamol: 500 mg to 1 g per dose, at least 4 hours apart, adult maximum 8 g in 24 hours.
- Seek advice if the temperature stays above 38.5 °C (99.5 °F) for more than 3 days.
- Drink plenty of fluids and rest.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'adult maximum 8 g in 24 hours' doubles the paracetamol ceiling",
             "groundTruth": "the adult maximum is 4 g in 24 hours", "reveals": "do they verify a dose before it reaches a patient?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'38.5 °C (99.5 °F)' converts the temperature incorrectly",
             "groundTruth": "38.5 °C is 101.3 °F", "reveals": "do they check a unit conversion in generated copy?"},
        ],
    },
    "life_sciences_research": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_protocol.md",
        "contents": _md("Assay preparation protocol", """
1. To make 100 mL of a 1:10 dilution, add 1 mL of stock to 99 mL of diluent.
2. Run n = 3 biological replicates per group across 4 groups, 24 samples in total.
3. Incubate at 37 °C for 30 minutes before reading.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'add 1 mL of stock to 99 mL of diluent' is a 1:100 dilution, not 1:10",
             "groundTruth": "10 mL of stock in 90 mL of diluent", "reveals": "do they recompute a generated protocol step?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'4 groups, 24 samples in total' does not follow from 3 replicates per group",
             "groundTruth": "3 x 4 = 12 samples", "reveals": "do they check the arithmetic their sample budget rests on?"},
        ],
    },
    "skilled_trades": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_site_notes.md",
        "contents": _md("Site notes: kitchen circuit", """
- Rule of thumb: current (A) = voltage (V) x resistance (Ω).
- The 2 kW heater on 230 V draws about 0.9 A, so it shares the 16 A circuit comfortably.
- Isolate the circuit and confirm it is dead before opening the socket.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'current (A) = voltage (V) x resistance (Ω)' misstates how current, voltage and resistance relate",
             "groundTruth": "current = voltage / resistance", "reveals": "do they catch a basic rule restated badly?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'draws about 0.9 A' understates the heater load roughly tenfold",
             "groundTruth": "2000 W / 230 V is about 8.7 A", "reveals": "do they check a load figure before sizing a circuit on it?"},
        ],
    },
    "operations_logistics": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_reorder_plan.md",
        "contents": _md("Reorder plan: SKU 4471", """
- Daily demand: 40 units. Supplier lead time: 5 days.
- Reorder point = daily demand x lead time = 400 units.
- One pallet holds 48 cartons of 12 units, i.e. 476 units per pallet.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'lead time = 400 units' doubles the reorder point",
             "groundTruth": "40 x 5 = 200 units", "reveals": "do they recompute the number stock policy rests on?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'476 units per pallet' is not 48 x 12",
             "groundTruth": "48 x 12 = 576 units", "reveals": "do they check generated arithmetic?"},
        ],
    },
    "frontline_service": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_shift_briefing.md",
        "contents": _md("Shift briefing", """
Store hours: 08:00 to 20:00 (10 hours), seven days a week.

Returns policy (from the policy manual): refunds within 14 days with a receipt.

Script for the till: we can refund any purchase within 30 days with a receipt.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'08:00 to 20:00 (10 hours)' miscounts the opening hours",
             "groundTruth": "08:00 to 20:00 is 12 hours", "reveals": "do they read the briefing before passing it on?"},
            {"id": "d2", "kind": "stale_doc", "flaw": "the till script promises 'any purchase within 30 days' against the 14-day policy",
             "groundTruth": "the script must match the policy manual: 14 days", "reveals": "do they check customer-facing copy against the source policy?"},
        ],
    },
    "sales_marketing": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_campaign_summary.md",
        "contents": _md("Campaign summary", """
- Landing page: 45 sign-ups from 1,500 visits, a conversion rate of 0.3%.
- Q2 revenue grew from 120k to 150k, a 20% increase on Q1.
- Next step: double the paid budget on the best-performing channel.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'a conversion rate of 0.3%' is off by a factor of ten",
             "groundTruth": "45 / 1,500 = 3%", "reveals": "do they recompute a headline metric before reporting it?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'a 20% increase on Q1' misstates the growth",
             "groundTruth": "120k to 150k is a 25% increase", "reveals": "do they check the growth figure a decision rests on?"},
        ],
    },
    "finance_accounting": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_invoice_notes.md",
        "contents": _md("Invoice and asset notes", """
- VAT at 21% on a net price of 1,000 CZK gives a gross price of 1,121 CZK.
- The 100,000 CZK machine is depreciated straight-line over 5 years: 25,000 CZK per year.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'a gross price of 1,121 CZK' misapplies 21% VAT",
             "groundTruth": "1,000 x 1.21 = 1,210 CZK", "reveals": "do they recompute tax before it reaches an invoice?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'25,000 CZK per year' is not 100,000 over 5 years",
             "groundTruth": "100,000 / 5 = 20,000 CZK per year", "reveals": "do they check a depreciation schedule?"},
        ],
    },
    "legal_compliance": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_gdpr_memo.md",
        "contents": _md("GDPR memo for the product team", """
- A personal data breach must be notified to the supervisory authority within 7 days of becoming aware of it.
- Users may ask for their data in a machine-readable format under Article 17 (right to data portability).
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'within 7 days of becoming aware' misstates the GDPR notification deadline",
             "groundTruth": "Article 33: within 72 hours where feasible", "reveals": "do they check a legal deadline against the text?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'Article 17 (right to data portability)' cites the wrong article",
             "groundTruth": "portability is Article 20; Article 17 is the right to erasure", "reveals": "do they verify a citation a generated memo leans on?"},
        ],
    },
    "hr_people": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_people_report.md",
        "contents": _md("Quarterly people report", """
- Annual leave: 25 days at 8 hours a day, 160 hours per employee.
- 12 people left this year in a team averaging 80 people: annual attrition is 6.7%.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'8 hours a day, 160 hours per employee' miscounts the leave hours",
             "groundTruth": "25 x 8 = 200 hours", "reveals": "do they check a generated report before it reaches payroll?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'annual attrition is 6.7%' understates attrition",
             "groundTruth": "12 / 80 = 15%", "reveals": "do they recompute the metric leadership will act on?"},
        ],
    },
    "education_academic": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_assessment_rubric.md",
        "contents": _md("Course assessment", """
Weights: essay 40%, presentation 30%, quiz 20% (total 100%).

Grade boundary example: a quiz score of 18/24 converts to 80%.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'quiz 20% (total 100%)' claims the weights sum to 100",
             "groundTruth": "40 + 30 + 20 = 90%", "reveals": "do they check a rubric before students are graded on it?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'18/24 converts to 80%' misconverts the score",
             "groundTruth": "18 / 24 = 75%", "reveals": "do they check a worked example?"},
        ],
    },
    "creative_design": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_design_spec.md",
        "contents": _md("Design spec: campaign assets", """
- Accessibility: WCAG AA asks for a contrast ratio of at least 3:1 for body text.
- Video: deliver 1920 x 1080 masters, a 4:3 aspect ratio.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'at least 3:1 for body text' misstates WCAG AA",
             "groundTruth": "WCAG AA requires 4.5:1 for body text (3:1 is for large text)", "reveals": "do they check a standard a spec cites?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'a 4:3 aspect ratio' does not match 1920 x 1080",
             "groundTruth": "1920 x 1080 is 16:9", "reveals": "do they check a delivery spec before production?"},
        ],
    },
    "customer_support": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_sla_guide.md",
        "contents": _md("Support SLA guide", """
- First response within 4 business hours. Business hours are Monday to Friday, 09:00 to 17:00.
- Worked example: a ticket opened on Friday at 16:00 is due Friday at 20:00.
- Last month: 42 of 60 survey responses were satisfied, a CSAT of 60%.
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "the example says the ticket 'is due Friday at 20:00', outside business hours",
             "groundTruth": "1 hour on Friday + 3 on Monday: due Monday at 12:00", "reveals": "do they work through an SLA example?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'a CSAT of 60%' misstates 42 of 60",
             "groundTruth": "42 / 60 = 70%", "reveals": "do they recompute a quality metric?"},
        ],
    },
    "general_professional": {
        "path": f"{DRAFT_DIR}/AI_DRAFT_planning_memo.md",
        "contents": _md("Planning memo", """
- Budget: 3 workshops at 2,400 each, 6,200 in total.
- The kick-off call is at 15:00 CET, which is 10:00 in New York (EST).
"""),
        "flaws": [
            {"id": "d1", "kind": "wrong_constant", "flaw": "'2,400 each, 6,200 in total' misadds the budget",
             "groundTruth": "3 x 2,400 = 7,200", "reveals": "do they check a generated budget line?"},
            {"id": "d2", "kind": "wrong_constant", "flaw": "'10:00 in New York' misconverts the time",
             "groundTruth": "CET is 6 hours ahead of EST: 09:00 in New York", "reveals": "do they check a time zone before inviting people?"},
        ],
    },
}

# The devcase scenario vocabulary (scenarios.DOMAINS) and other common family strings,
# mapped onto the canonical family whose draft fits them.
FAMILY_ALIASES: dict[str, str] = {
    "devops_sre": "software_engineering",
    "mobile": "software_engineering",
    "qa": "software_engineering",
    "security": "software_engineering",
    "content_marketing": "sales_marketing",
    "growth_marketing": "sales_marketing",
    "brand": "sales_marketing",
    "account_exec": "sales_marketing",
    "sdr": "sales_marketing",
    "fpna": "finance_accounting",
    "accounting": "finance_accounting",
    "product_design": "creative_design",
    "ux_research": "creative_design",
}


def resolve_family(role_family: str | None) -> str:
    fam = (role_family or "").strip().lower()
    if fam in DRAFTS:
        return fam
    return FAMILY_ALIASES.get(fam, FALLBACK_FAMILY)


def draft_for(role_family: str | None) -> dict[str, Any]:
    """The one labelled draft for this family: ``{path, contents, canaries}``, the
    canaries in seed_materializer's shape with ``path`` pointing at the draft. Fresh
    copies every call, so a caller can never mutate the catalog."""
    entry = DRAFTS[resolve_family(role_family)]
    path = entry["path"]
    return {
        "path": path,
        "contents": entry["contents"],
        "canaries": [{"id": f"draft-{f['id']}", "path": path, **{k: v for k, v in f.items() if k != "id"}} for f in entry["flaws"]],
    }

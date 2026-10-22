"""Keyless work-sample cases for the non-software role families (operator triage T13).

Before this module the keyless designer answered every non-developer role with one
generic case ("do a representative task on the supplied materials") over prose-only
materials. These are the real, deterministic replacements for five families: sales,
operations, customer support, design and marketing.

Each entry carries the case shape ``design_case`` emits (title, brief, repoSeed, tasks,
coverProbes, midFlightUpdate, a rubric) plus the STARTING FILES ``seed_materializer``
ships with it and the canaries those files carry. The files hold one under-documented
area (named in a notes file that points at material not supplied) and one verification
trap (a planted flaw with a single checkable ground truth, recorded as a canary and
graded by artifact_checks.canary_outcomes). The canary quotes its fragment and carries
``catchEvidence``, so the trap is graded wherever the candidate answers: an edit of the
seeded file, or the new file a ranking, triage plan or memo is usually written in.

A case built here is stamped ``familyCase`` (the family id); seed_materializer ships the
family files only for a case carrying that marker, never on a title match.

Pure data + a resolver: no randomness, no clock, no network, no model call. Software and
every other family never resolve here, and the keyed (LLM) path never reads this table.
"""

from __future__ import annotations

import copy
from typing import Any

from .ai_drafts import DRAFT_DIR
from .ai_drafts import _md as _draft_md
from .models import CASE_DRAFT_CANARY_PREFIX, RUBRIC_DIMENSIONS

# Catalog ids and devcase-vocabulary aliases -> case family. ``sales_marketing`` is one
# catalog family but two cases; it is split by the role title in ``resolve_case_family``.
_FAMILY_ALIASES: dict[str, str] = {
    "sales": "sales",
    "account_exec": "sales",
    "sdr": "sales",
    "marketing": "marketing",
    "content_marketing": "marketing",
    "growth_marketing": "marketing",
    "brand": "marketing",
    "operations": "operations",
    "operations_logistics": "operations",
    "customer_support": "support",
    "customer_success": "support",
    "support": "support",
    "design": "design",
    "creative_design": "design",
    "product_design": "design",
    "ux_research": "design",
}
_MARKETING_TITLE_WORDS = (
    "marketing", "seo", "content", "brand", "growth", "campaign", "social", "copywriter", "communications",
)


def resolve_case_family(role_family: str | None, title: str | None = "") -> str | None:
    """The case family for a role, or None (software, data, finance, … keep the generic path)."""
    fam = (role_family or "").strip().lower()
    if fam == "sales_marketing":
        t = (title or "").lower()
        return "marketing" if any(w in t for w in _MARKETING_TITLE_WORDS) else "sales"
    return _FAMILY_ALIASES.get(fam)


def _probe(pid: str, kind: str, where: str, reveals: str, options: list[str]) -> dict:
    return {"id": pid, "kind": kind, "where": where, "reveals": reveals, "decisionSpace": options}


def _canary(
    cid: str, kind: str, path: str, fragment: str, truth: str, reveals: str,
    evidence: list[list[str]], miss: list[list[str]],
) -> dict:
    """A family trap in the shape artifact_checks grades. ``flaw`` QUOTES the fragment (the
    grader only locates a quoted one). ``catchEvidence`` is what a catcher writes in ANY
    file (these cases are mostly answered in a new file, never an edit of the seed): the
    first group names the subject, the rest the substance, which must be the candidate's
    own reading — an echo of the notes or a negated statement does not count.
    ``missEvidence`` is what a candidate who carried the flaw writes. An answer showing
    neither is graded ``unverifiable``, never a miss (artifact_checks.canary_outcomes)."""
    return {
        "id": cid, "kind": kind, "path": path, "flaw": f"`{fragment}`",
        "groundTruth": truth, "reveals": reveals, "catchEvidence": evidence, "missEvidence": miss,
    }


# A figure in any of the spellings a candidate uses: 36000, 36,000, 36 000, 36.000, 36k,
# 36 tis. (Czech), 36 thousand; and for a figure that is not round thousands the decimal
# k-form too, 1.8k / 1,8 tis. / 67.5k (r3: "15% of 12k is 1.8k" was not read as 1,800).
# ``thousands`` is the leading part and ``rest`` the last three digits, so _k(36) matches all
# of those and _k(1, "800") matches 1,800 and 1.8k.
def _k(thousands: int, rest: str = "000") -> str:
    dec = rest.rstrip("0")
    frac = rf"[.,]{dec}0*" if dec else r"(?:[.,]0+)?"
    return rf"(?<![\d.,]){thousands}(?:[\s,.']?{rest}(?![\d])|{frac}\s?(?:k\b|tis|thousand))"


# A bare count, not a duration, a share or money ("45 minutes", "45 days", "a 45-day cycle"
# are not 45 units).
_NOT_A_UNIT = (
    r"(?![\s-]*(?:min|mins|minutes?|minut\w*|h\b|hrs?\b|hours?|hod\w*|days?\b|dn[íyů]\w*|den\b|weeks?\b|týdn\w*"
    r"|months?\b|měsíc\w*|years?\b|let\b|sec\w*|s\b|%|percent|procent|eur\b|€|czk\b|kč))"
)

# What a candidate calls a qualified signup: the CSV's word, the sales jargon for it, or the
# quality reading of it, en + cs.
_QUAL = r"(?:qualif\w*|kvalif\w*|\bsqls?\b|sales[- ]accepted|quality\s+(?:sign-?ups?|leads?))"


# A marketing figure within rounding of its true value: "62", "62.5", "62.50" and "63" for
# 62.50 (r3: "about EUR 63 per qualified signup" was not read as the recomputation).
def _near(whole: int, up: bool) -> str:
    nxt = rf"|{whole + 1}(?:[.,]0+)?" if up else ""
    return rf"(?<![\d.,])(?:{whole}(?:[.,]\d{{1,2}})?{nxt})(?![\d])"


_DECISIONS_TASK = (
    "Keep a short DECISIONS log: for every call you made where the brief was open — what you chose, "
    "the alternative you rejected, and what you would have asked the team."
)

_SALES_CSV = """account,stage,amount_eur,probability_pct,weighted_eur,last_touch,next_step_note
Northwind Foods,Negotiation,120000,60,72000,2026-09-02,Legal redlines sent back; champion on leave
Brightfield Logistics,Proposal,90000,40,54000,2026-10-15,Asked for a revised quote by month end
Cedar Health,Discovery,45000,20,9000,2026-10-14,Second call booked
Delta Print,Qualified,30000,30,9000,2026-10-16,Budget not yet discussed
Ember Retail,Proposal,60000,50,30000,2026-10-10,Waiting on procurement
Fjord Marine,Negotiation,75000,70,52500,2026-10-18,Verbal yes; contract with their lawyer
Granite Bank,Discovery,200000,10,20000,2026-10-01,Intro only
Helix Labs,Qualified,25000,35,8750,2026-10-17,Trial running
"""

_SALES_NOTES = """# Pipeline notes

Export of the open pipeline as of 2026-10-20. One row per account.

- `weighted_eur` is the amount times the stage probability.
- Priority for next-step outreach follows the qualification playbook: highest weighted value first,
  then most recent touch. Accounts with no contact for more than 30 days are re-qualified before
  any outreach.
- Tier assignment (which accounts get a call versus an email) follows the account-tiering sheet,
  which is maintained by sales ops and is not included in this pack.
"""

_OPS_INVENTORY = """sku,description,opening_qty,on_hand,reorder_point
SKU-101,Pallet strap,200,220,100
SKU-102,Stretch film,80,35,40
SKU-103,Carton 40x30,150,140,60
SKU-104,Hex bolt M8,40,55,50
SKU-105,Label roll,300,90,100
"""

_OPS_MOVEMENTS = """sku,date,qty_change,reason
SKU-101,2026-10-03,-50,shipment
SKU-101,2026-10-09,100,receipt
SKU-101,2026-10-15,-30,shipment
SKU-102,2026-10-04,-20,shipment
SKU-102,2026-10-12,-25,ADJ-7
SKU-103,2026-10-06,50,receipt
SKU-103,2026-10-14,-60,shipment
SKU-104,2026-10-05,-10,shipment
SKU-104,2026-10-10,20,receipt
SKU-104,2026-10-16,-5,shipment
SKU-105,2026-10-07,-120,shipment
SKU-105,2026-10-17,-90,shipment
"""

_OPS_NOTES = """# Stock process notes

Month-start quantities are in `inventory.csv` (`opening_qty`); every receipt, shipment and
adjustment since is in `movements.csv`. `on_hand` is the figure the warehouse system reported
on 2026-10-18. A SKU at or below its `reorder_point` is reordered.

Adjustments are logged with an `ADJ-` code. The meaning of each code is in the adjustment
code table kept by the warehouse lead; that table is not part of this pack.
"""

_SUPPORT_CSV = """id,received,plan,subject,priority,sla_hours,status,summary
T-1041,2026-10-19,Starter,Cannot reset password,medium,24,open,Reset email not arriving; checked spam
T-1042,2026-10-19,Business,Invoice shows wrong company name,low,72,open,Name typo on the PDF invoice
T-1043,2026-10-19,Enterprise,Dashboard blank after login,high,4,open,Blank screen on Chrome; Safari works
T-1044,2026-10-19,Starter,How do I invite a teammate,low,72,open,Cannot find the invite button
T-1045,2026-10-20,Business,Webhook retries failing,high,8,open,Our endpoint returns 200 but retries continue
T-1046,2026-10-20,Starter,Feature request: dark mode,low,72,open,Would like a dark theme
T-1047,2026-10-20,Business,Export is slow,low,72,open,Export took 4 minutes and the file also contained rows for a customer named Orchid Dental that we do not recognise
T-1048,2026-10-20,Enterprise,SSO login loop,high,4,open,Users bounce between IdP and app after the certificate renewal
"""

_SUPPORT_NOTES = """# Queue notes

Snapshot of the open queue on 2026-10-20. `priority` was set by the intake form from the plan
and the customer's wording; `sla_hours` follows priority.

Tickets that touch security, privacy or billing integrity go to the on-call lead rather than
the normal queue. The routing steps and the lead's rota are in the support runbook, which is
not included in this pack.
"""

_DESIGN_SPEC = """# Signup flow spec (v3)

A five-step mobile signup for a booking app, designed for a 360 px wide screen.

1. **Welcome** — headline, "Continue with email" button, "Skip for now" link.
2. **Email** — one field (email), "Next" button.
3. **Profile** — five fields on one screen: first name, last name, phone, postcode, birth date.
   "Next" button.
4. **Preferences** — three toggles and a "Next" button.
5. **Confirm** — summary list and a "Create account" button.

Error handling: a failed field shows "Invalid input" in red under the field.

Accessibility review: All tap targets meet the 44px minimum. Reviewed against the constraints
file by the design lead.
"""

_DESIGN_CONSTRAINTS = """# Constraints

- Minimum touch target: 44 x 44 px.
- No more than three form fields per screen.
- Error messages say what is wrong and how to fix it.
- The flow must be completable one-handed on a 360 px wide screen.
- Brand tokens only; no new colours.
"""

_DESIGN_COMPONENTS = """component,step,width_px,height_px
Continue with email button,1,320,48
Skip for now link,1,96,24
Email field,2,320,48
Next button,2,40,40
Phone field,3,320,48
Create account button,5,320,52
"""

_DESIGN_NOTES = """# Design notes

Component sizes were exported from the design file (`components.csv`). Analytics from the
previous flow are summarised in the research digest, which is not included in this pack; the
only figure carried over is that about one in three users dropped at the profile screen.
"""

_MKT_BRIEF = """# Campaign brief: spring launch

Goal: 150 qualified signups for the new scheduling product in six weeks.
Budget: EUR 12,000 in total, any split across channels. Audience: operations leads at companies
of 20 to 200 people.

## Last campaign, in short

Total spend EUR 11,000 for 360 signups. Email was our best channel at EUR 16.67 per signup, so
the plan is to put most of the new budget there.

"Qualified" means a signup that passes the sales-agreed definition. That definition lives in the
CRM and is not included in this pack.
"""

_MKT_RESULTS = """channel,spend_eur,clicks,signups,qualified_signups
Email,1500,2400,90,18
Paid search,4000,3100,160,64
LinkedIn ads,3500,1900,70,14
Content,2000,1500,40,16
"""

# --- the case's own AI draft -----------------------------------------------------------
#
# Every case ships one truthfully labelled, unreviewed AI draft (ADR 0027 S2). It used to be
# chosen by role family alone (ai_drafts.draft_for), so the sales case shipped a campaign
# summary and the operations case a reorder plan for an SKU absent from its inventory; no
# task mentioned it, and the AI-collaboration axis read the same for every candidate
# (council-lite T13 r2). A family case now carries a draft authored FOR it, over its own
# materials, which a task names and asks the candidate to use, fix or discard. Each draft
# carries one slip with a single checkable ground truth, written the way an assistant
# writes it (no hint beyond the label). Pasting the draft carries the slip into the work;
# correcting it states the right figure — the grader tells the two apart, and evaluate.py
# reads that on the tooling axis.

_DRAFT_SALES_PATH = f"{DRAFT_DIR}/AI_DRAFT_fjord_marine_email.md"
_DRAFT_SALES = """
Subject: Fjord Marine contract: next steps

Hi Ingrid,

Thanks again for the verbal yes on the EUR 75,000 order. To help your lawyer close it this month, we can offer 10% off for signature by 31 October, which brings the order to EUR 66,500.

I have attached the updated order form. Would Thursday at 10:00 suit you for a short call to go through any open points?

Best regards,
"""

_DRAFT_OPS_PATH = f"{DRAFT_DIR}/AI_DRAFT_reorder_quantities.md"
_DRAFT_OPS = """
Rule used: order enough to bring each SKU back to three times its reorder point.

| SKU | Reorder point | On hand | Order |
| --- | --- | --- | --- |
| SKU-102 Stretch film | 40 | 35 | 3 x 40 - 35 = 85 |
| SKU-105 Label roll | 100 | 90 | 3 x 100 - 90 = 190 |
"""

_DRAFT_SUPPORT_PATH = f"{DRAFT_DIR}/AI_DRAFT_reply_T-1043.md"
_DRAFT_SUPPORT = """
Hi,

Thank you for reporting that the dashboard stays blank after login in Chrome. Your ticket reached us at 08:30, and your Enterprise plan has a 4-hour first-response window, so you will hear back from our engineers by 13:30 at the latest.

In the meantime, please clear the browser cache and try a private window; Safari can be used as a workaround.

Kind regards,
Support team
"""

_DRAFT_DESIGN_PATH = f"{DRAFT_DIR}/AI_DRAFT_flow_revision.md"
_DRAFT_DESIGN = """
- Step 3 is split into two screens: 3a (first name, last name, phone) and 3b (postcode, birth date), so no screen has more than three fields.
- Messages under a field name the field and the fix, for example "Enter a postcode with 5 digits".
- Layout: the 320 px wide buttons and fields sit centred on the 360 px screen with 16 px side margins.
"""

_DRAFT_MKT_PATH = f"{DRAFT_DIR}/AI_DRAFT_budget_split.md"
_DRAFT_MKT = """
Based on last campaign's cost per signup:

- Email: 60%, EUR 7,200
- Paid search: 25%, EUR 3,000
- LinkedIn ads: 15%, EUR 1,500

Total: EUR 12,000, the full budget.
"""


def _draft(fam: str, path: str, title: str, body: str, kind: str, fragment: str, truth: str, reveals: str,
           evidence: list[list[str]], miss: list[list[str]]) -> dict:
    return {
        "path": path,
        "contents": _draft_md(title, body),
        "canary": _canary(f"{CASE_DRAFT_CANARY_PREFIX}{fam}", kind, path, fragment, truth, reveals, evidence, miss),
    }


_CASE_DRAFTS: dict[str, dict] = {
    "sales": _draft(
        "sales", _DRAFT_SALES_PATH, "Next-step email: Fjord Marine", _DRAFT_SALES, "wrong_constant",
        "which brings the order to EUR 66,500",
        "10% off EUR 75,000 is EUR 67,500; the draft quotes the customer EUR 1,000 less than the offer.",
        "Do they check the figure an assistant put in a customer email, or send it as written?",
        [[r"fjord", r"discount", r"\b10\s?%", r"draft", r"e-?mail", r"order", r"sleva", r"slev", r"cen[auyě]", r"nabíd"],
         [_k(67, "500"),
          r"(?:off|out|short|low|understat\w*|undercharg\w*)\s+(?:by\s+)?(?:eur\s*|€\s*)?1[\s,.']?000\b",
          r"\b1[\s,.']?000\s*(?:eur\s*|€\s*)?(?:too\s+(?:low|little)|short|less|méně)",
          r"\bo\s+1[\s,.']?000\s*(?:eur\s*|€\s*)?(?:méně|víc|více|nižší)"]],
        [[_k(66, "500")]],
    ),
    "operations": _draft(
        "operations", _DRAFT_OPS_PATH, "Reorder quantities", _DRAFT_OPS, "wrong_constant",
        "3 x 100 - 90 = 190",
        "3 x 100 - 90 is 210, not 190; the SKU-105 order would come in 20 units short of the draft's own rule.",
        "Do they recompute an assistant's order quantities before placing them?",
        [[r"sku[- ]?105", r"label roll", r"štítk", r"etiket"],
         [r"(?<![\d.,-])210(?![\d])",
          r"(?:short|low|under\w*|off|out)\s+(?:by\s+)?20\b",
          r"\b20\s+(?:units?\s+|ks\s+|kus\w*\s+)?(?:too\s+(?:few|low|little)|short|more|méně|chyb\w*)",
          r"\bo\s+20\s+(?:ks|kus\w*|méně|víc|více)"]],
        [[r"sku[- ]?105", r"label roll", r"štítk", r"etiket"], [r"(?<![\d.,-])190(?![\d])"]],
    ),
    "support": _draft(
        "support", _DRAFT_SUPPORT_PATH, "Reply to T-1043 (Dashboard blank after login)", _DRAFT_SUPPORT, "wrong_constant",
        "so you will hear back from our engineers by 13:30",
        "08:30 plus the 4-hour first-response window is 12:30; the reply promises the customer an hour past the SLA.",
        "Do they check the commitment an assistant wrote into a customer reply?",
        [[r"t[- ]?1043", r"dashboard", r"draft", r"repl", r"odpově", r"\bsla\b", r"deadline", r"respon"],
         [r"\b12[:.]30\b", r"\b12\s*h\s*30\b",
          r"(?:an|one|1)\s+hour\s+(?:late|past|over|beyond|after|too\s+late)",
          r"(?:o\s+)?hodinu\s+(?:pozd\w*|později|navíc|víc|déle)"]],
        [[r"\b13[:.]30\b"]],
    ),
    "design": _draft(
        "design", _DRAFT_DESIGN_PATH, "Signup flow: proposed revision", _DRAFT_DESIGN, "wrong_constant",
        "with 16 px side margins",
        "(360 - 320) / 2 is 20 px a side; with 16 px margins the 320 px components are not centred on a 360 px screen.",
        "Do they check the layout arithmetic an assistant proposes against the screen and the component widths?",
        [[r"margin", r"okraj", r"\brand", r"marge", r"\b320\b", r"cent(?:er|re|r)"],
         [r"(?<![\d.,])20\s*px", r"(?<![\d.,])20\s+(?:on|each|per|na)\b",
          r"\(\s*360\s*[-−–]\s*320\s*\)\s*/\s*2", r"\b8\s*px\s*(?:short|off|missing|unaccounted|chyb\w*)",
          r"(?:off|out|short)\s+by\s+8\b", r"(?<![\d.,])352(?![\d])"]],
        [[r"margin", r"okraj"], [r"(?<![\d.,])16\s*px"]],
    ),
    "marketing": _draft(
        "marketing", _DRAFT_MKT_PATH, "Budget split for the spring launch", _DRAFT_MKT, "wrong_constant",
        "LinkedIn ads: 15%, EUR 1,500",
        "15% of EUR 12,000 is EUR 1,800; the three lines add up to EUR 11,700, not the EUR 12,000 the draft states.",
        "Do they add up an assistant's budget before adopting it?",
        [[r"linkedin", r"total", r"celkem", r"\bsum", r"součet", r"budget", r"rozpočet", r"draft"],
         [_k(1, "800"), _k(11, "700"),
          r"(?<![\d.,])300\s*(?:eur\s*|€\s*)?(?:short|missing|unallocated|unaccounted|left|chyb\w*|nerozděl\w*|zbýv\w*)",
          r"(?:short|off|out|under)\s+(?:by\s+)?(?:eur\s*|€\s*)?300\b"]],
        [[r"linkedin[^\n]{0,30}" + _k(1, "500")]],
    ),
}


def case_draft(fam: str) -> dict:
    """The case's own AI draft in ai_drafts.draft_for's shape: ``{path, contents, canaries}``.
    Fresh copies every call."""
    d = copy.deepcopy(_CASE_DRAFTS[fam])
    return {"path": d["path"], "contents": d["contents"], "canaries": [d["canary"]]}


_MID_AFTER = 20


FAMILY_CASES: dict[str, dict[str, Any]] = {
    "sales": {
        "title": "Sales: qualify the open pipeline and write the next-step email",
        "brief": (
            "You have just taken over a small open pipeline. Using the export and the playbook notes, decide "
            "where the next week of outreach should go and write the first email. Scope it to ~{timebox:g}h."
        ),
        "repoSeed": (
            "pipeline.csv (the open pipeline export), pipeline_notes.md (how the team prioritises) and "
            f"{_DRAFT_SALES_PATH} (an AI assistant's first draft of the email)."
        ),
        "tasks": [
            "Qualify and rank the accounts in pipeline.csv: which three get outreach this week, and why.",
            f"Write the next-step email for the top account. {_DRAFT_SALES_PATH} is an AI assistant's first draft of it: use it, fix it or discard it.",
            "Say what you would check or ask before sending anything, and what is still unknown.",
            _DECISIONS_TASK,
        ],
        "coverProbes": [
            _probe("p1", "underspecified", "which accounts get a call versus an email (the tiering sheet is not supplied)",
                   "Do they ask for the tiering rule or silently invent one?",
                   ["Ask sales ops for the tiering sheet first", "State an assumed tiering and proceed", "Rank on weighted value alone and flag the gap"]),
            _probe("p2", "legacy_trap", "the 30-day silence rule in pipeline_notes.md against the last_touch column",
                   "Do they apply the written rule to the biggest deal, or write a warm follow-up as if it were live?",
                   ["Re-qualify the stale account before any outreach", "Send a short re-engagement email and flag the gap", "Skip the stale account and work the next one"]),
            _probe("p3", "verification_trap", "weighted_eur, which looks computed but is only a stored column",
                   "Do they recompute the weighted values, or rank on the stored column?",
                   ["Recompute every weighted value before ranking", "Spot-check the top rows", "Trust the column as exported"]),
        ],
        "midFlightUpdate": {
            "afterMinutes": _MID_AFTER,
            "update": "Quick update from the sales lead: the quarter closes a week earlier than planned, so only deals that can sign in two weeks count. Say which of your calls this changes and adjust the one that matters most.",
            "reveals": "Do they re-rank for the shorter horizon and revisit the email, or bolt a caveat onto the original plan?",
        },
        "files": [("pipeline.csv", _SALES_CSV), ("pipeline_notes.md", _SALES_NOTES)],
        "canaries": [
            _canary("case-sales-weighted", "wrong_constant", "pipeline.csv",
                    "Brightfield Logistics,Proposal,90000,40,54000",
                    "90000 x 40% is 36000, not 54000; with the correct value Brightfield drops below Fjord Marine (52500) in the ranking.",
                    "Do they recompute the weighted column, or rank on a figure that is quietly wrong?",
                    # Brightfield next to its corrected weighted value (36000 in any spelling)
                    # or the gap (overstated by 18000). Its fall below Fjord Marine is no
                    # longer a catch on its own: an answer that keeps the stored 54,000 and
                    # ranks it lower for another reason said exactly that (lite r3). A ranking
                    # counts when the corrected figure is beside it, which the figures cover.
                    [[r"brightfield"],
                     [_k(36), _k(18)]],
                    # Brightfield ranked on the stored 54000.
                    [[r"brightfield"], [_k(54)]]),
        ],
        "rubric": {
            "framing": "Turns an open pipeline into a ranked, justified week of outreach.",
            "tooling": "Uses the export and any AI help to compute and draft, then iterates.",
            "judgment": "Catches the stored figure that is wrong and the account that has gone cold.",
            "architecture": "A prioritisation and email that fit the stated playbook and horizon.",
            "transfer": "Shows the qualification and outreach judgment a seller needs day to day.",
        },
    },
    "operations": {
        "title": "Operations: reconcile the stock sheet against the movement log",
        "brief": (
            "The warehouse system reports on-hand quantities for five SKUs and the reorder list is built "
            "from them. Reconcile the sheet against the movement log and say what to reorder. Scope it to "
            "~{timebox:g}h."
        ),
        "repoSeed": (
            "inventory.csv (opening and reported quantities), movements.csv (every movement since month start), "
            f"stock_notes.md and {_DRAFT_OPS_PATH} (an AI assistant's draft of the order quantities)."
        ),
        "tasks": [
            "Reconcile each SKU: opening quantity plus movements against the reported on-hand figure.",
            f"Produce the reorder list from your reconciled quantities and the reorder points. {_DRAFT_OPS_PATH} is an AI assistant's draft of the order quantities: use it, fix it or discard it.",
            "Write the short note you would send the warehouse lead about anything that does not reconcile.",
            _DECISIONS_TASK,
        ],
        "coverProbes": [
            _probe("p1", "underspecified", "the ADJ-7 adjustment, whose code table is not supplied",
                   "Do they ask what ADJ-7 means or silently treat it as a shipment?",
                   ["Ask the warehouse lead for the code table first", "Treat it as a deduction and flag the assumption", "Exclude it and show both totals"]),
            _probe("p2", "legacy_trap", "reported on_hand versus the movement log",
                   "Do they trust the system's reported figure or rebuild it from the log?",
                   ["Rebuild every quantity from the log", "Reconcile only the SKUs near their reorder point", "Use the reported figures and note the risk"]),
            _probe("p3", "verification_trap", "a SKU whose reported quantity hides a reorder",
                   "Do they check each SKU, or accept a list that looks complete?",
                   ["Recount every SKU arithmetically", "Spot-check two SKUs", "Take the reorder list from the reported column"]),
        ],
        "midFlightUpdate": {
            "afterMinutes": _MID_AFTER,
            "update": "Quick update from the warehouse lead: reorder points are being raised by 20% for the peak season. Say which of your calls this affects and adjust the one that matters most.",
            "reveals": "Do they re-run the reorder list under the new points and flag what changes, or just note the new threshold?",
        },
        "files": [("inventory.csv", _OPS_INVENTORY), ("movements.csv", _OPS_MOVEMENTS), ("stock_notes.md", _OPS_NOTES)],
        "canaries": [
            _canary("case-ops-onhand", "wrong_constant", "inventory.csv",
                    "SKU-104,Hex bolt M8,40,55,50",
                    "40 - 10 + 20 - 5 is 45, not 55; at 45 the SKU is below its reorder point of 50 and must be reordered.",
                    "Do they reconcile every SKU, or miss the one whose reported figure hides a reorder?",
                    # SKU-104 next to its reconciled quantity (45) or the gap ("10 too high").
                    [[r"sku[- ]?104", r"hex bolt", r"šroub"],
                     [r"(?<![\d.,-])45(?![\d]|[.,]\d)" + _NOT_A_UNIT,
                      r"\b10\s*(?:units?\s*|ks\s*|kus\w*\s*)?(?:too\s+(?:high|many|much)|over\b|more than|higher|navíc|víc|více|vyšší|přebývá)",
                      r"(?:overstat\w*|over[- ]?(?:report|count)\w*|inflat\w*|off|out|high|discrepanc\w*|gap|difference|rozdíl\w*|nadsazen\w*|vyšší)\s+(?:of\s+|by\s+|o\s+)?10\b",
                      r"\bo\s+10\s+(?:ks|kus\w*|víc|více|vyšší|výš)"]],
                    # SKU-104 left at the reported 55, or kept off the reorder list.
                    [[r"sku[- ]?104", r"hex bolt", r"šroub"],
                     [r"(?<![\d.,-])55(?![\d])", r"(?:above|over|nad)\s+(?:its\s+|the\s+)?(?:reorder\s+point|point|50)",
                      r"\bno\s+(?:re)?order", r"nedoobjedn\w*|neobjedn\w*"]]),
        ],
        "rubric": {
            "framing": "Turns a sheet and a log into a clear reconciliation and reorder decision.",
            "tooling": "Uses spreadsheet or AI help to compute, then checks the arithmetic.",
            "judgment": "Catches the SKU that does not reconcile and the code nobody explained.",
            "architecture": "A repeatable reconciliation that fits the stated reorder rule.",
            "transfer": "Shows the process discipline an operations role needs.",
        },
    },
    "support": {
        "title": "Customer support: triage the open ticket queue",
        "brief": (
            "Eight tickets are open and you are the only person on the queue this shift. Triage them, "
            "reply to the ones you can close, and route the rest. Scope it to ~{timebox:g}h."
        ),
        "repoSeed": (
            "tickets.csv (the open queue snapshot), queue_notes.md (how routing works) and "
            f"{_DRAFT_SUPPORT_PATH} (an AI assistant's draft reply to T-1043)."
        ),
        "tasks": [
            "Triage tickets.csv into an order of work, with a one-line reason per ticket.",
            f"Write the customer reply for the three tickets you would answer first. An AI assistant has drafted the reply to T-1043 in {_DRAFT_SUPPORT_PATH}: use it, fix it or discard it.",
            "Name every ticket you would route to someone else, to whom, and what you would tell them.",
            _DECISIONS_TASK,
        ],
        "coverProbes": [
            _probe("p1", "underspecified", "who security or privacy tickets go to (the runbook is not supplied)",
                   "Do they ask who the on-call lead is or invent a route?",
                   ["Ask for the runbook before routing", "Route to the on-call lead named in the notes and flag the gap", "Handle it in the normal queue with a note"]),
            _probe("p2", "legacy_trap", "priority and sla_hours, set by the intake form from the customer's wording",
                   "Do they read the summary or go by the priority the form assigned?",
                   ["Re-read every summary and re-prioritise", "Trust the form except for obvious outliers", "Work strictly in priority order"]),
            _probe("p3", "verification_trap", "a low-priority ticket whose summary describes another customer's data",
                   "Do they catch the escalation hiding in a low-priority ticket?",
                   ["Escalate at once and stop work on it", "Reply to the customer and escalate in parallel", "Answer the speed complaint and leave the priority"]),
        ],
        "midFlightUpdate": {
            "afterMinutes": _MID_AFTER,
            "update": "Quick update from the team lead: an outage is ticking in for Enterprise customers, so Enterprise tickets now get the first reply within the hour. Say which of your calls this affects and adjust the one that matters most.",
            "reveals": "Do they re-order the queue and revisit replies, or add the new rule on top of the old order?",
        },
        "files": [("tickets.csv", _SUPPORT_CSV), ("queue_notes.md", _SUPPORT_NOTES)],
        "canaries": [
            _canary("case-support-escalation", "subtle_bug", "tickets.csv",
                    "Export took 4 minutes and the file also contained rows for a customer named Orchid Dental that we do not recognise",
                    "The ticket is filed as a low-priority speed complaint, but the summary reports another customer's data in this customer's export: a privacy incident that goes to the on-call lead.",
                    "Do they notice the escalation behind a low priority, or answer the speed complaint?",
                    # T-1047 (or Orchid Dental) next to the privacy reading of it, in any of the
                    # four delivery locales. Routing to on-call is NOT the catch: the queue
                    # notes say to route security tickets there, and a triage that sends the
                    # next ticket (T-1048) to on-call was credited with it (lite r2).
                    [[r"t[- ]?1047", r"orchid"],
                     [r"privacy", r"personal data", r"data (?:breach|leak\w*|exposure|protection)", r"\bleak\w*",
                      r"gdpr", r"(?:another|other|different|wrong|foreign)\s+(?:customer|client|account|company)",
                      r"someone else", r"cross[- ]?(?:tenant|customer|account)", r"confidentialit",
                      r"(?:orchid(?:\s+dental)?|another\s+(?:customer|client|account|company))(?:'s|’s)?\s+(?:records|rows|data|details|information)",
                      # cs
                      r"soukrom", r"osobní(?:ch)?\s+(?:údaj|dat)", r"únik", r"ochran\w*\s+(?:osobních\s+)?(?:dat|údajů)",
                      r"ciz(?:í|ího|ích|ímu)\s+(?:klient|zákazník|firm|společnost|data|údaj)", r"jiného\s+(?:klienta|zákazníka)",
                      # de, fr
                      r"datenschutz", r"datenleck", r"dsgvo", r"fremde\w*\s+(?:kunde|daten)",
                      r"fuite", r"données personnelles", r"rgpd", r"autre client"]],
                    # T-1047 answered as the speed complaint it was filed as.
                    [[r"t[- ]?1047"],
                     [r"\bslow", r"speed", r"\btips?\b", r"smaller exports?", r"performance", r"low[- ]priority",
                      r"pomal", r"rychlost", r"\btip\w*"]]),
        ],
        "rubric": {
            "framing": "Turns a raw queue into an ordered, reasoned shift plan.",
            "tooling": "Uses AI drafting for replies, then edits them against the real ticket.",
            "judgment": "Catches the escalation the intake form hid and routes it properly.",
            "architecture": "A triage order and routing that fit the stated policy and SLAs.",
            "transfer": "Shows the queue judgment and customer tone a support role needs.",
        },
    },
    "design": {
        "title": "Design: critique and revise the signup flow against its constraints",
        "brief": (
            "A five-step signup flow has been through review. Critique it against the stated constraints "
            "and the component sizes, then revise it. Scope it to ~{timebox:g}h."
        ),
        "repoSeed": (
            "flow_spec.md (the flow), constraints.md, components.csv (exported component sizes), design_notes.md "
            f"and {_DRAFT_DESIGN_PATH} (an AI assistant's draft revision)."
        ),
        "tasks": [
            "Critique flow_spec.md against constraints.md: list each violation with the step it is on.",
            f"Revise the flow so it meets the constraints; describe the changed screens in words or a sketch. {_DRAFT_DESIGN_PATH} is an AI assistant's draft revision: use it, fix it or discard it.",
            "Say how you would test the revision with five users and what result would make you change it again.",
            _DECISIONS_TASK,
        ],
        "coverProbes": [
            _probe("p1", "underspecified", "the drop at the profile screen (the research digest is not supplied)",
                   "Do they ask for the research or treat one headline figure as the whole story?",
                   ["Ask for the research digest first", "Use the one figure and state its limits", "Design for the drop without the figure"]),
            _probe("p2", "legacy_trap", "flow_spec.md's accessibility sign-off against components.csv",
                   "Do they trust the review line or measure the sizes?",
                   ["Check every component against the constraint", "Check only the primary buttons", "Accept the review as written"]),
            _probe("p3", "verification_trap", "a tap-target claim that passes a glance but not the data",
                   "Do they verify the claim, or carry it into their revision?",
                   ["Verify each size and correct the claim", "Fix the obvious ones and note the rest", "Keep the sign-off and add new screens"]),
        ],
        "midFlightUpdate": {
            "afterMinutes": _MID_AFTER,
            "update": "Quick update from the product lead: legal now requires a consent checkbox with a link to the terms before account creation. Say which of your calls this affects and adjust the one that matters most.",
            "reveals": "Do they re-balance the flow around the new element, or append it to the last screen?",
        },
        "files": [
            ("flow_spec.md", _DESIGN_SPEC),
            ("constraints.md", _DESIGN_CONSTRAINTS),
            ("components.csv", _DESIGN_COMPONENTS),
            ("design_notes.md", _DESIGN_NOTES),
        ],
        "canaries": [
            _canary("case-design-targets", "stale_doc", "flow_spec.md",
                    "All tap targets meet the 44px minimum",
                    "components.csv lists the Next button at 40 x 40 and the Skip for now link at 96 x 24, both below the 44 px minimum.",
                    "Do they measure the components, or repeat the review's claim?",
                    # A named undersized component (or "tap target") next to its real size or a
                    # "below 44" reading of it — affirmed, so "none are below 44 px" is not one.
                    [[r"\bnext\b", r"\bskip\b", r"tap target", r"touch target", r"tlačítk", r"odkaz", r"dotyk"],
                     [r"\b40\s*(?:x|×|by)\s*40\b", r"\b(?:96|40)\s*(?:x|×|by)\s*24\b", r"\b40\s*px\b",
                      r"(?:below|under|smaller than|less than|short of|fails?|violat\w*|miss\w*)\s+(?:the\s+)?44", r"<\s*44",
                      r"(?:does\s+not|doesn't|do\s+not|don't|not|never)\s+(?:meet|reach|satisfy)\w*\s+(?:the\s+)?(?:44|minim)",
                      r"\b24\s*px\s*(?:high|tall)", r"(?:height|tall)\s*(?:of\s*)?24\b",
                      r"(?:pod|menší\s+než|nesplň\w*)\s+(?:limit\w*\s+|minim\w*\s+)?44"]],
                    # The review's claim carried: targets said to meet the minimum.
                    [[r"(?:tap|touch)\s+targets?", r"sign-?off", r"accessibility review", r"\b44\b", r"dotyk"],
                     [r"\b(?:all|every)\b[^.\n]{0,30}\b(?:meet|pass|fine|ok|compliant)", r"\bnone\s+(?:are|is|of them)?\s*(?:below|under|smaller)",
                      r"(?:meet|meets|pass|passes)\s+(?:the\s+)?(?:44|minimum)", r"\bno\s+change", r"(?<!\w)splň\w*"]]),
        ],
        "rubric": {
            "framing": "Turns a reviewed flow and a constraint list into a clear critique and revision plan.",
            "tooling": "Uses design and AI tooling to explore options, then checks them against the data.",
            "judgment": "Catches the sign-off that the component sizes contradict.",
            "architecture": "A revised flow whose structure fits the constraints and the screen.",
            "transfer": "Shows the critique and constraint discipline a design role needs.",
        },
    },
    "marketing": {
        "title": "Marketing: plan a launch campaign from a brief and last campaign's results",
        "brief": (
            "You are planning a six-week launch campaign. Use the brief and the results of the last "
            "campaign to decide the budget split and the first two weeks of activity. Scope it to "
            "~{timebox:g}h."
        ),
        "repoSeed": (
            "campaign_brief.md (goal, budget, audience, last-campaign summary), results.csv (last campaign by "
            f"channel) and {_DRAFT_MKT_PATH} (an AI assistant's proposed budget split)."
        ),
        "tasks": [
            "Analyse results.csv: which channels earned their spend, and on what measure.",
            f"Propose the budget split for the EUR 12,000 and the first two weeks of activity. {_DRAFT_MKT_PATH} is an AI assistant's proposed split: use it, fix it or discard it.",
            "State the one number you would watch in week one and what would make you move budget.",
            _DECISIONS_TASK,
        ],
        "coverProbes": [
            _probe("p1", "underspecified", "what counts as a qualified signup (the CRM definition is not supplied)",
                   "Do they ask for the definition or assume the qualified column is the target?",
                   ["Ask sales for the definition first", "Use the qualified column and state the assumption", "Plan to signups and flag the gap"]),
            _probe("p2", "legacy_trap", "the brief's summary of the last campaign, written before the qualified numbers",
                   "Do they read the table behind the summary or inherit its conclusion?",
                   ["Recompute every channel from results.csv", "Check the top channel only", "Follow the brief's plan"]),
            _probe("p3", "verification_trap", "a cost-per-signup claim that ignores quality",
                   "Do they check cost per qualified signup, or plan on the headline figure?",
                   ["Rank channels by cost per qualified signup", "Compare both measures and weigh them", "Use cost per signup as stated"]),
        ],
        "midFlightUpdate": {
            "afterMinutes": _MID_AFTER,
            "update": "Quick update from the head of marketing: EUR 3,000 of the budget is now reserved for a conference, so the campaign has EUR 9,000. Say which of your calls this affects and adjust the one that matters most.",
            "reveals": "Do they re-allocate with the lower budget in mind, or just trim every channel by the same share?",
        },
        "files": [("campaign_brief.md", _MKT_BRIEF), ("results.csv", _MKT_RESULTS)],
        "canaries": [
            _canary("case-marketing-cost", "stale_doc", "campaign_brief.md",
                    "Email was our best channel at EUR 16.67 per signup",
                    "Per qualified signup Paid search is best at EUR 62.50 (4000 / 64) against Email at EUR 83.33 (1500 / 18); the brief's figure ignores quality.",
                    "Do they recompute on qualified signups, or build the plan on the brief's claim?",
                    # A channel next to its cost per QUALIFIED signup (62.50 / 83.33 within
                    # rounding, 250 / 125 beside the qualified measure) or its qualified share
                    # (18 of 90, 20% / 40% near the word for qualified). Naming "cost per
                    # qualified signup" is not a catch: task 3 asks for the number to watch, and
                    # a plan built on EUR 16.67 can still name it (lite r2). Nor is comparison
                    # wording on its own: "email remains best even on qualified signups" keeps
                    # the brief's conclusion (lite r3); a comparison counts when one of these
                    # figures is beside it.
                    [[r"paid search", r"\bemail\b", r"e-mail", r"linkedin", r"\bcontent\b"],
                     [_near(62, up=True), _near(83, up=False),
                      rf"(?<![\d.,])(?:250|125)(?![\d])[^.;\n]{{0,25}}(?:per|/)\s*{_QUAL}",
                      r"\b(?:18\s*(?:of|/|out of|z)\s*90|64\s*(?:of|/|out of|z)\s*160|14\s*(?:of|/|out of|z)\s*70"
                      r"|16\s*(?:of|/|out of|z)\s*40)\b",
                      rf"\b(?:20|40)\s*%[^.;,\n]{{0,40}}{_QUAL}", rf"{_QUAL}[^.;,\n]{{0,40}}\b(?:20|40)\s*%",
                      r"only\s+18\b", r"jen\s+18\b"]],
                    # The brief's headline carried: Email best on cost per signup.
                    [[r"\bemail\b", r"e-mail"],
                     [r"16[.,]67", r"\bbest\s+channel", r"\b(?:most|bulk|majority)\b[^.\n]{0,30}\b(?:budget|spend|money)",
                      r"nejlepší\s+kanál"]]),
        ],
        "rubric": {
            "framing": "Turns a brief and a results table into a clear campaign plan.",
            "tooling": "Uses analysis and AI tooling to compute, then checks the figures.",
            "judgment": "Catches the summary the data contradicts and plans on the right measure.",
            "architecture": "A budget split and schedule that fit the goal and the stated budget.",
            "transfer": "Shows the channel judgment a marketing role needs.",
        },
    },
}


# --- Czech delivery ------------------------------------------------------------------------
#
# The keyless designer wrote every family case in English, so a Czech-posted role (the
# seeded contact-centre role job-115, and every seeded ČS posting) handed its candidate an
# English brief (council-lite T13 r2, goal 4). The candidate-facing text renders in Czech
# when the case is delivered in Czech; the starting files stay as authored (they are data
# the canaries and their evidence are pinned to), and the internal probe notes stay English.

_DECISIONS_TASK_CS = (
    "Veďte krátký log rozhodnutí v DECISIONS.md: u každého rozhodnutí, kde zadání nechávalo prostor, zapište, "
    "co jste zvolili, jakou alternativu jste zamítli a na co byste se zeptali týmu."
)
_MID_TAIL_CS = "Napište, kterých vašich rozhodnutí se to týká, a upravte to nejdůležitější."
_USE_FIX_CS = "můžete ho použít, opravit, nebo zahodit."

_CS: dict[str, dict[str, Any]] = {
    "sales": {
        "title": "Obchod: kvalifikujte otevřený pipeline a napište e-mail s dalším krokem",
        "brief": (
            "Právě jste převzali malý otevřený pipeline. Podle exportu a poznámek k playbooku rozhodněte, kam půjde "
            "oslovování v příštím týdnu, a napište první e-mail. Rozsah zhruba ~{timebox:g} h."
        ),
        "repoSeed": (
            "pipeline.csv (export otevřeného pipeline), pipeline_notes.md (jak tým určuje priority) a "
            f"{_DRAFT_SALES_PATH} (první verze e-mailu od AI asistenta)."
        ),
        "tasks": [
            "Kvalifikujte a seřaďte účty v pipeline.csv: které tři oslovíte tento týden a proč.",
            f"Napište e-mail s dalším krokem pro účet na prvním místě. {_DRAFT_SALES_PATH} je jeho první verze od AI asistenta: {_USE_FIX_CS}",
            "Uveďte, co byste před odesláním čehokoli ověřili nebo se zeptali a co zůstává neznámé.",
            _DECISIONS_TASK_CS,
        ],
        "midFlightUpdate": (
            "Rychlá zpráva od vedoucího obchodu: kvartál se uzavírá o týden dřív, než se plánovalo, takže se počítají "
            f"jen obchody, které lze podepsat do dvou týdnů. {_MID_TAIL_CS}"
        ),
    },
    "operations": {
        "title": "Provoz: odsouhlaste skladovou evidenci s logem pohybů",
        "brief": (
            "Skladový systém hlásí stav pěti položek (SKU) a z něj se sestavuje seznam k doobjednání. Odsouhlaste "
            "evidenci s logem pohybů a napište, co doobjednat. Rozsah zhruba ~{timebox:g} h."
        ),
        "repoSeed": (
            "inventory.csv (počáteční a hlášené množství), movements.csv (všechny pohyby od začátku měsíce), "
            f"stock_notes.md a {_DRAFT_OPS_PATH} (návrh objednacích množství od AI asistenta)."
        ),
        "tasks": [
            "Odsouhlaste každé SKU: počáteční množství plus pohyby proti hlášenému stavu na skladě.",
            f"Sestavte seznam k doobjednání z odsouhlasených množství a bodů pro objednání. {_DRAFT_OPS_PATH} je návrh objednacích množství od AI asistenta: {_USE_FIX_CS}",
            "Napište krátkou zprávu vedoucímu skladu o všem, co nesouhlasí.",
            _DECISIONS_TASK_CS,
        ],
        "midFlightUpdate": (
            "Rychlá zpráva od vedoucího skladu: body pro objednání se na sezónní špičku zvyšují o 20 %. "
            f"{_MID_TAIL_CS}"
        ),
    },
    "support": {
        "title": "Zákaznická podpora: roztřiďte frontu otevřených tiketů",
        "brief": (
            "Otevřených je osm tiketů a na frontě jste tuto směnu sami. Roztřiďte je, odpovězte na ty, které můžete "
            "uzavřít, a zbytek předejte dál. Rozsah zhruba ~{timebox:g} h."
        ),
        "repoSeed": (
            "tickets.csv (snímek otevřené fronty), queue_notes.md (jak funguje předávání) a "
            f"{_DRAFT_SUPPORT_PATH} (odpověď na T-1043 navržená AI asistentem)."
        ),
        "tasks": [
            "Seřaďte tikety z tickets.csv do pořadí práce, u každého s jednořádkovým zdůvodněním.",
            f"Napište zákaznickou odpověď na tři tikety, na které byste odpověděli nejdřív. Odpověď na T-1043 už navrhl AI asistent v {_DRAFT_SUPPORT_PATH}: {_USE_FIX_CS}",
            "Uveďte každý tiket, který byste předali někomu jinému, komu a co byste mu napsali.",
            _DECISIONS_TASK_CS,
        ],
        "midFlightUpdate": (
            "Rychlá zpráva od vedoucí týmu: u zákazníků Enterprise naskakuje výpadek, takže tikety Enterprise teď "
            f"dostanou první odpověď do hodiny. {_MID_TAIL_CS}"
        ),
    },
    "design": {
        "title": "Design: zhodnoťte a upravte registrační flow podle jeho omezení",
        "brief": (
            "Pětikrokové registrační flow prošlo revizí. Zhodnoťte ho podle stanovených omezení a velikostí "
            "komponent a pak ho upravte. Rozsah zhruba ~{timebox:g} h."
        ),
        "repoSeed": (
            "flow_spec.md (flow), constraints.md, components.csv (exportované velikosti komponent), design_notes.md "
            f"a {_DRAFT_DESIGN_PATH} (návrh úprav od AI asistenta)."
        ),
        "tasks": [
            "Zhodnoťte flow_spec.md podle constraints.md: vypište každé porušení i s krokem, kde k němu dochází.",
            f"Upravte flow tak, aby omezení splňovalo; změněné obrazovky popište slovy nebo náčrtem. {_DRAFT_DESIGN_PATH} je návrh úprav od AI asistenta: {_USE_FIX_CS}",
            "Popište, jak byste úpravu otestovali s pěti uživateli a jaký výsledek by vás přiměl ji změnit znovu.",
            _DECISIONS_TASK_CS,
        ],
        "midFlightUpdate": (
            "Rychlá zpráva od produktového vedoucího: právní oddělení nově vyžaduje před vytvořením účtu zaškrtávací "
            f"políčko souhlasu s odkazem na podmínky. {_MID_TAIL_CS}"
        ),
    },
    "marketing": {
        "title": "Marketing: naplánujte launch kampaň podle briefu a výsledků minulé kampaně",
        "brief": (
            "Plánujete šestitýdenní launch kampaň. Podle briefu a výsledků minulé kampaně rozhodněte o rozdělení "
            "rozpočtu a o aktivitách na první dva týdny. Rozsah zhruba ~{timebox:g} h."
        ),
        "repoSeed": (
            "campaign_brief.md (cíl, rozpočet, publikum, shrnutí minulé kampaně), results.csv (minulá kampaň po "
            f"kanálech) a {_DRAFT_MKT_PATH} (rozdělení rozpočtu navržené AI asistentem)."
        ),
        "tasks": [
            "Analyzujte results.csv: které kanály si své náklady vydělaly a podle jaké metriky.",
            f"Navrhněte rozdělení rozpočtu 12 000 EUR a aktivity na první dva týdny. {_DRAFT_MKT_PATH} je rozdělení navržené AI asistentem: {_USE_FIX_CS}",
            "Uveďte jedno číslo, které byste v prvním týdnu sledovali, a co by vás přimělo přesunout rozpočet.",
            _DECISIONS_TASK_CS,
        ],
        "midFlightUpdate": (
            "Rychlá zpráva od vedoucí marketingu: 3 000 EUR z rozpočtu je nově vyhrazeno na konferenci, takže kampaň "
            f"má 9 000 EUR. {_MID_TAIL_CS}"
        ),
    },
}

# Czech-only letters; a posting is Czech when they make up a real share of its letters
# (one diacritic in a name does not make an English posting Czech).
_CS_LETTERS = frozenset("áčďéěíňóřšťúůýž")
_CS_MIN_SHARE = 0.02
_CS_MIN_COUNT = 5


def posting_lang(*texts: str | None) -> str:
    """``"cs"`` when the posting (title, JD text) is written in Czech, else ``"en"``.

    The role's language signal the data already carries: the seeded ČS postings are written
    in Czech, while their ``languages`` list (Czech + English) does not say which one the
    candidate reads. Keyless and deterministic — a letter count, no model."""
    text = " ".join(t for t in texts if t).lower()
    letters = sum(1 for ch in text if ch.isalpha())
    cs = sum(1 for ch in text if ch in _CS_LETTERS)
    return "cs" if letters and cs >= _CS_MIN_COUNT and cs / letters >= _CS_MIN_SHARE else "en"


def case_lang(title: str | None) -> str:
    """The language a family case was delivered in, read off its title (``"cs"`` or ``"en"``)."""
    return "cs" if title and title in {v["title"] for v in _CS.values()} else "en"


def family_case_for(role_family: str | None, title: str | None = "", *, lang: str = "en") -> dict | None:
    """A fresh copy of the case entry for this role, or None when it keeps the generic path.

    The copy carries ``rubricDimensions`` (the canonical names/labels/weights with this
    family's descriptions) so a caller never rebuilds it, and ``lang``: with ``lang="cs"``
    the candidate-facing text (title, brief, repoSeed, tasks, the mid-flight update) is the
    Czech rendering."""
    fam = resolve_case_family(role_family, title)
    if fam is None:
        return None
    entry = copy.deepcopy(FAMILY_CASES[fam])
    entry["family"] = fam
    entry["lang"] = "cs" if lang == "cs" else "en"
    if entry["lang"] == "cs":
        cs = _CS[fam]
        entry.update({k: copy.deepcopy(cs[k]) for k in ("title", "brief", "repoSeed", "tasks")})
        entry["midFlightUpdate"]["update"] = cs["midFlightUpdate"]
    entry["rubricDimensions"] = [{**d, "description": entry["rubric"][d["name"]]} for d in RUBRIC_DIMENSIONS]
    return entry

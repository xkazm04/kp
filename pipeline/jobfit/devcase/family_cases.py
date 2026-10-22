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
graded by the existing artifact_checks rule).

Pure data + a resolver: no randomness, no clock, no network, no model call. Software and
every other family never resolve here, and the keyed (LLM) path never reads this table.
"""

from __future__ import annotations

import copy
from typing import Any

from .models import RUBRIC_DIMENSIONS

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


def _canary(cid: str, kind: str, path: str, flaw: str, truth: str, reveals: str) -> dict:
    return {"id": cid, "kind": kind, "path": path, "flaw": flaw, "groundTruth": truth, "reveals": reveals}


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

Total spend EUR 11,000 for 370 signups. Email was our best channel at EUR 16.67 per signup, so
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

_MID_AFTER = 20


FAMILY_CASES: dict[str, dict[str, Any]] = {
    "sales": {
        "title": "Sales: qualify the open pipeline and write the next-step email",
        "brief": (
            "You have just taken over a small open pipeline. Using the export and the playbook notes, decide "
            "where the next week of outreach should go and write the first email. Scope it to ~{timebox:g}h."
        ),
        "repoSeed": "pipeline.csv (the open pipeline export) and pipeline_notes.md (how the team prioritises).",
        "tasks": [
            "Qualify and rank the accounts in pipeline.csv: which three get outreach this week, and why.",
            "Draft the next-step email for the top account.",
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
                    "Do they recompute the weighted column, or rank on a figure that is quietly wrong?"),
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
        "repoSeed": "inventory.csv (opening and reported quantities), movements.csv (every movement since month start) and stock_notes.md.",
        "tasks": [
            "Reconcile each SKU: opening quantity plus movements against the reported on-hand figure.",
            "Produce the reorder list from your reconciled quantities and the reorder points.",
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
                    "Do they reconcile every SKU, or miss the one whose reported figure hides a reorder?"),
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
        "repoSeed": "tickets.csv (the open queue snapshot) and queue_notes.md (how routing works).",
        "tasks": [
            "Triage tickets.csv into an order of work, with a one-line reason per ticket.",
            "Write the customer reply for the three tickets you would answer first.",
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
                    "Do they notice the escalation behind a low priority, or answer the speed complaint?"),
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
        "repoSeed": "flow_spec.md (the flow), constraints.md, components.csv (exported component sizes) and design_notes.md.",
        "tasks": [
            "Critique flow_spec.md against constraints.md: list each violation with the step it is on.",
            "Revise the flow so it meets the constraints; describe the changed screens in words or a sketch.",
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
                    "Do they measure the components, or repeat the review's claim?"),
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
        "repoSeed": "campaign_brief.md (goal, budget, audience, last-campaign summary) and results.csv (last campaign by channel).",
        "tasks": [
            "Analyse results.csv: which channels earned their spend, and on what measure.",
            "Propose the budget split for the EUR 12,000 and the first two weeks of activity.",
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
                    "Do they recompute on qualified signups, or build the plan on the brief's claim?"),
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


def family_case_for(role_family: str | None, title: str | None = "") -> dict | None:
    """A fresh copy of the case entry for this role, or None when it keeps the generic path.

    The copy carries ``rubricDimensions`` (the canonical names/labels/weights with this
    family's descriptions) so a caller never rebuilds it."""
    fam = resolve_case_family(role_family, title)
    if fam is None:
        return None
    entry = copy.deepcopy(FAMILY_CASES[fam])
    entry["rubricDimensions"] = [{**d, "description": entry["rubric"][d["name"]]} for d in RUBRIC_DIMENSIONS]
    return entry

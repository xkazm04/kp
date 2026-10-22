"""T13 — the keyless work sample for the non-software families is a real, deterministic case."""

import json
import re
import unittest

from pipeline.jobfit.devcase.artifact_checks import _fragment, canary_outcomes, evidence_caught
from pipeline.jobfit.devcase.design import design_case, design_role
from pipeline.jobfit.devcase.evaluation_pipeline import EvaluationInputs, run_evaluation
from pipeline.jobfit.devcase.family_cases import FAMILY_CASES, resolve_case_family
from pipeline.jobfit.devcase.lifecycle_eval import _check_case
from pipeline.jobfit.devcase.models import RUBRIC_DIMENSIONS, CaseScenario, DevNeed, NeedAnalysis, RoleSpec
from pipeline.jobfit.devcase.seed_materializer import CANARY_KINDS, MAX_SEED_FILES, deterministic_seed
from pipeline.jobfit.tests.devcase_fakes import TextReply

# family -> (role_family the code uses, a title)
_ROLES = {
    "sales": ("sales_marketing", "Account Executive"),
    "marketing": ("sales_marketing", "Growth Marketing Manager"),
    "operations": ("operations_logistics", "Operations Analyst"),
    "support": ("customer_support", "Support Specialist"),
    "design": ("creative_design", "Product Designer"),
}


def _case(role_family: str, title: str):
    need = DevNeed(title=title, role_family=role_family, seniority_target="medior")
    analysis = NeedAnalysis(real_stack=["CRM"], core_responsibilities=["x"], true_complexity="medium", risk_areas=[])
    role, _ = design_role(need, analysis, provider=None)
    role["title"], role["roleFamily"] = title, role_family
    case, source = design_case(need, analysis, role, provider=None)
    return need, role, case, source


def _seed(role: dict, case: dict):
    scn = CaseScenario.model_validate({**case, "id": "c1"})
    spec = RoleSpec.model_validate({"title": role["title"], "roleFamily": role["roleFamily"], "seniority": "medior"})
    return deterministic_seed(scn, spec)


class TestFamilyCases(unittest.TestCase):
    def test_each_family_gets_its_own_case(self):
        titles = set()
        for fam, (rf, title) in _ROLES.items():
            _, _, case, source = _case(rf, title)
            self.assertEqual(source, "deterministic")
            self.assertEqual(case["title"], FAMILY_CASES[fam]["title"])
            self.assertNotIn("representative", case["title"])
            self.assertNotIn("Do a representative", " ".join(case["tasks"]))
            self.assertGreaterEqual(len(case["tasks"]), 3)
            self.assertLessEqual(len(case["tasks"]), 4)
            self.assertTrue(any("DECISIONS" in t for t in case["tasks"]))
            self.assertTrue(case["midFlightUpdate"]["update"])
            self.assertEqual(len(case["coverProbes"]), 3)
            titles.add(case["title"])
        self.assertEqual(len(titles), 5)

    def test_case_passes_the_lifecycle_validator(self):
        for rf, title in _ROLES.values():
            _, _, case, _ = _case(rf, title)
            self.assertEqual(_check_case(case, None), [])

    def test_deterministic(self):
        for rf, title in _ROLES.values():
            _, role, case_a, _ = _case(rf, title)
            _, _, case_b, _ = _case(rf, title)
            self.assertEqual(json.dumps(case_a, sort_keys=True), json.dumps(case_b, sort_keys=True))
            self.assertEqual(json.dumps(_seed(role, case_a), sort_keys=True), json.dumps(_seed(role, case_b), sort_keys=True))

    def test_seed_files_exist_and_are_non_empty(self):
        for fam, (rf, title) in _ROLES.items():
            _, role, case, _ = _case(rf, title)
            seed = _seed(role, case)
            files = {f["path"]: f["contents"] for f in seed["files"]}
            for path, _contents in FAMILY_CASES[fam]["files"]:
                self.assertTrue(files.get(path, "").strip(), f"{fam}: {path} missing or empty")
            self.assertIn("README.md", files)
            self.assertIn("DECISIONS.md", files)
            self.assertLessEqual(len(files), MAX_SEED_FILES)
            self.assertEqual(len(files), len(seed["files"]))  # no duplicate paths
            # the unreviewed AI draft device is still there, and the files named in the brief exist
            self.assertTrue(any("UNREVIEWED AI-GENERATED DRAFT" in c for c in files.values()))
            for path, _c in FAMILY_CASES[fam]["files"]:
                self.assertIn(path.split("/")[-1], case["repoSeed"])

    def test_canaries_point_into_the_files_and_quote_a_unique_fragment(self):
        for fam, (rf, title) in _ROLES.items():
            _, role, case, _ = _case(rf, title)
            seed = _seed(role, case)
            files = {f["path"]: f["contents"] for f in seed["files"]}
            family_ids = [c for c in seed["canaries"] if c["id"].startswith("case-")]
            self.assertEqual(len(family_ids), 1, fam)
            for c in seed["canaries"]:
                self.assertIn(c["kind"], CANARY_KINDS)
                self.assertIn(c["path"], files)
                if c["id"].startswith("case-"):
                    # the grader's own extraction, not the raw string: an unquoted fragment
                    # is one the grader cannot locate (council-lite T13 r1)
                    frag = _fragment(c["flaw"])
                    self.assertIsNotNone(frag, f"{fam}/{c['id']}: flaw quotes no fragment")
                    self.assertEqual(files[c["path"]].count(frag), 1, f"{fam}/{c['id']}")
                self.assertTrue(c["groundTruth"])

    def test_rubric_has_the_evaluator_shape(self):
        for rf, title in _ROLES.values():
            _, _, case, _ = _case(rf, title)
            rub = case["rubricDimensions"]
            self.assertEqual([d["name"] for d in rub], [d["name"] for d in RUBRIC_DIMENSIONS])
            self.assertAlmostEqual(sum(d["weight"] for d in rub), 1.0)
            for d, canon in zip(rub, RUBRIC_DIMENSIONS):
                self.assertEqual((d["label"], d["weight"]), (canon["label"], canon["weight"]))
                self.assertTrue(d["description"])
            CaseScenario.model_validate({**case, "id": "c1"})  # the model accepts it

    def test_planted_ground_truth_is_actually_true(self):
        # sales: Brightfield's stored weighted value is wrong, the others are right
        rows = [r.split(",") for r in dict(FAMILY_CASES["sales"]["files"])["pipeline.csv"].strip().splitlines()[1:]]
        wrong = [r[0] for r in rows if int(r[2]) * int(r[3]) // 100 != int(r[4]) and abs(int(r[2]) * int(r[3]) / 100 - int(r[4])) > 1]
        self.assertEqual(wrong, ["Brightfield Logistics"])
        # ops: exactly SKU-104 fails to reconcile
        files = dict(FAMILY_CASES["operations"]["files"])
        moves: dict[str, int] = {}
        for r in files["movements.csv"].strip().splitlines()[1:]:
            sku, _d, q, _r = r.split(",")
            moves[sku] = moves.get(sku, 0) + int(q)
        bad = [r.split(",")[0] for r in files["inventory.csv"].strip().splitlines()[1:]
               if int(r.split(",")[2]) + moves[r.split(",")[0]] != int(r.split(",")[3])]
        self.assertEqual(bad, ["SKU-104"])
        # marketing: paid search is best per qualified signup
        res = [r.split(",") for r in dict(FAMILY_CASES["marketing"]["files"])["results.csv"].strip().splitlines()[1:]]
        best = min(res, key=lambda r: int(r[1]) / int(r[4]))[0]
        self.assertEqual(best, "Paid search")

    def test_resolver_leaves_software_and_other_families_alone(self):
        for rf in ("software_engineering", "data_ai", "finance_accounting", "hr_people", "legal_compliance", "general_professional", "", None):
            self.assertIsNone(resolve_case_family(rf, "Backend Engineer"))
        self.assertEqual(resolve_case_family("sales_marketing", "SEO Specialist"), "marketing")
        self.assertEqual(resolve_case_family("sales_marketing", "Key Account Manager"), "sales")

    def test_software_role_is_unchanged(self):
        need, role, case, _ = _case("software_engineering", "Backend Engineer")
        self.assertEqual(case["title"], "Backend Engineer: a representative work-sample")
        self.assertIn("Do a representative", case["tasks"][0])
        self.assertEqual([d["description"] for d in case["rubricDimensions"]], [d["description"] for d in RUBRIC_DIMENSIONS])
        seed = _seed(role, case)
        self.assertEqual([f["path"] for f in seed["files"]][:2], ["README.md", "DECISIONS.md"])
        self.assertEqual(len(seed["files"]), 3)

    def test_model_designed_case_keeps_the_skeleton_seed(self):
        # a keyed (LLM) case carries no familyCase marker, so no family files are attached to it
        _, role, case, _ = _case("customer_support", "Support Specialist")
        case = {k: v for k, v in case.items() if k != "familyCase"}
        case["title"] = "A case the model wrote"
        self.assertEqual(len(_seed(role, case)["files"]), 3)

    def test_keyed_reply_without_a_title_gets_no_family_files(self):
        # council-lite T13 r1 (a): a model reply with no title used to inherit the family title,
        # and the title-only seed match then shipped the family files beside the model's tasks.
        for fam, (rf, title) in _ROLES.items():
            need = DevNeed(title=title, role_family=rf, seniority_target="medior")
            analysis = NeedAnalysis(real_stack=["CRM"], core_responsibilities=["x"], true_complexity="medium", risk_areas=[])
            role, _ = design_role(need, analysis, provider=None)
            role["title"], role["roleFamily"] = title, rf
            reply = {"brief": "The model's brief.", "tasks": ["The model's task one", "The model's task two"],
                     "coverProbes": [{"id": "p1", "kind": "ambiguity", "where": "w", "reveals": "r", "decisionSpace": ["a", "b"]}]}
            case, source = design_case(need, analysis, role, provider=TextReply(reply))
            self.assertEqual(source, "llm", fam)
            self.assertNotIn("familyCase", case, fam)
            self.assertNotEqual(case["title"], FAMILY_CASES[fam]["title"], fam)
            seed = _seed(role, case)
            paths = {f["path"] for f in seed["files"]}
            for path, _c in FAMILY_CASES[fam]["files"]:
                self.assertNotIn(path, paths, f"{fam}: {path} shipped beside a model-written case")
            self.assertFalse([c for c in seed["canaries"] if c["id"].startswith("case-")], fam)
            # even a model that happens to echo the family title does not get the files
            seed = _seed(role, {**case, "title": FAMILY_CASES[fam]["title"]})
            self.assertFalse({p for p, _c in FAMILY_CASES[fam]["files"]} & {f["path"] for f in seed["files"]}, fam)

    def test_marker_for_another_family_ships_nothing(self):
        _, role, case, _ = _case("customer_support", "Support Specialist")
        self.assertEqual(case["familyCase"], "support")
        self.assertEqual(len(_seed(role, {**case, "familyCase": "sales"})["files"]), 3)

    def test_marketing_brief_agrees_with_its_results_table(self):
        files = dict(FAMILY_CASES["marketing"]["files"])
        rows = [r.split(",") for r in files["results.csv"].strip().splitlines()[1:]]
        spend, signups = sum(int(r[1]) for r in rows), sum(int(r[3]) for r in rows)
        brief = files["campaign_brief.md"]
        m = re.search(r"Total spend EUR ([\d,]+) for (\d+) signups", brief)
        self.assertIsNotNone(m)
        self.assertEqual(int(m.group(1).replace(",", "")), spend)
        self.assertEqual(int(m.group(2)), signups)
        email = next(r for r in rows if r[0] == "Email")
        self.assertIn(f"EUR {int(email[1]) / int(email[3]):.2f} per signup", brief)


# --- grader-level: the family trap is SCORED, wherever the answer is written ------------------
#
# Per family: a catching answer (in the seeded file, and in a new file) gets the trap graded as
# caught and judgment credit from the real evaluator; a naive answer gets the trap graded as
# missed and no judgment. Answers are what a candidate plausibly writes, not the evidence regexes.

_CATCH_NEW = {
    "sales": ("outreach_plan.md",
              "# Outreach plan\n\n1. Northwind Foods - 72000 weighted, but last touch 2026-09-02 is >30 days: re-qualify first.\n"
              "2. Fjord Marine - 52500, verbal yes, push the contract.\n"
              "3. Brightfield Logistics - the export says 54000 but 90000 x 40% is 36,000, so it drops below Fjord.\n"),
    "marketing": ("campaign_plan.md",
                  "# Plan\n\nThe brief ranks on cost per signup. Per qualified signup Paid search is EUR 62.50 "
                  "(4000/64) and Email EUR 83.33 (1500/18), so the bulk of the budget goes to paid search.\n"),
    "operations": ("reconciliation.md",
                   "# Reconciliation\n\nSKU-104 Hex bolt M8: 40 - 10 + 20 - 5 = 45, the system says 55.\n"
                   "At 45 it is under the reorder point of 50, so it goes on the reorder list.\n"),
    "support": ("triage.md",
                "# Triage\n\n1. T-1047 first: the export contained Orchid Dental's rows - that is another customer's data, "
                "a privacy incident. Route to the on-call lead now.\n2. T-1043 and T-1048, Enterprise, 4h SLA.\n"),
    "design": ("critique.md",
               "# Critique\n\n- Step 2: the Next button is 40 x 40, below the 44 px minimum, so the sign-off is not true.\n"
               "- Step 3: five fields on one screen, the limit is three.\n"),
}
_NAIVE_NEW = {
    "sales": ("outreach_plan.md",
              "# Outreach plan\n\n1. Northwind Foods - 72000 weighted, highest value.\n"
              "2. Brightfield Logistics - 54000 weighted, send the revised quote.\n3. Fjord Marine - 52500.\n"),
    "marketing": ("campaign_plan.md",
                  "# Plan\n\nEmail was the best channel at EUR 16.67 per signup, so EUR 8,000 goes to email, "
                  "the rest to paid search. Target: 150 qualified signups.\n"),
    "operations": ("reconciliation.md",
                   "# Reconciliation\n\nAll SKUs taken from the reported on_hand column.\n"
                   "Reorder: SKU-102 (35 vs 40), SKU-105 (90 vs 100). SKU-104 at 55 is above its point of 50.\n"),
    "support": ("triage.md",
                "# Triage\n\n1. T-1043 and T-1048, Enterprise, 4h SLA.\n2. T-1045 webhook retries.\n"
                "3. T-1047 export is slow - low priority, reply with tips for smaller exports.\n"),
    "design": ("critique.md",
               "# Critique\n\n- Step 3: five fields on one screen, the limit is three.\n"
               "- The error message 'Invalid input' does not say how to fix it. Tap targets were reviewed and meet the minimum.\n"),
}


def _catch_in_seeded_file(fam: str, files: dict[str, str]) -> tuple[str, str]:
    """The catcher's edit of the seeded file (and nothing else)."""
    c = next(c for c in FAMILY_CASES[fam]["canaries"])
    body = files[c["path"]]
    fixes = {
        "sales": ("Brightfield Logistics,Proposal,90000,40,54000", "Brightfield Logistics,Proposal,90000,40,36000"),
        "operations": ("SKU-104,Hex bolt M8,40,55,50", "SKU-104,Hex bolt M8,40,45,50"),
        "support": ("T-1047,2026-10-20,Business,Export is slow,low,72,open",
                    "T-1047,2026-10-20,Business,PRIVACY: another customer's data in export,high,4,escalated to on-call lead"),
        "design": ("All tap targets meet the 44px minimum.",
                   "The Next button (40 x 40) and Skip for now link (96 x 24) are below the 44px minimum."),
        "marketing": ("Email was our best channel at EUR 16.67 per signup, so",
                      "Email looked best at EUR 16.67 per signup, but per qualified signup Paid search wins (62.50 vs 83.33), so"),
    }[fam]
    assert fixes[0] in body, (fam, fixes[0])
    return c["path"], body.replace(fixes[0], fixes[1])


def _naive_in_seeded_file(fam: str, files: dict[str, str]) -> tuple[str, str]:
    """A naive edit of the seeded file: touched, but the trap carried along."""
    c = next(c for c in FAMILY_CASES[fam]["canaries"])
    return c["path"], files[c["path"]] + "\n" + "Reviewed - looks good, proceeding as written.\n"


def _grade(fam: str, edits: dict[str, str]):
    rf, title = _ROLES[fam]
    _, role, case, _ = _case(rf, title)
    seed = _seed(role, case)
    submitted = {f["path"]: f["contents"] for f in seed["files"]}
    submitted.update(edits)
    files = [{"path": p, "contents": c} for p, c in submitted.items()]
    outcomes = canary_outcomes(seed, files)
    family = next(o for o in outcomes if o["id"].startswith("case-"))
    run = run_evaluation(
        EvaluationInputs(commits=[], case=case, role=role, probes=case["coverProbes"], seed=seed, files=files),
        provider=None,
    )
    return family, run.result["evaluation"]["dimensionScores"]["judgment"]


class TestFamilyTrapIsGraded(unittest.TestCase):
    def test_every_family_canary_carries_compilable_evidence_that_the_seed_cannot_satisfy(self):
        for fam, entry in FAMILY_CASES.items():
            for c in entry["canaries"]:
                groups = c["catchEvidence"]
                self.assertGreaterEqual(len(groups), 2, fam)
                for g in groups:
                    for rx in g:
                        re.compile(rx)
                # the seed's own text, quoted back whole, never catches its own trap
                for _p, body in entry["files"]:
                    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
                    self.assertFalse(evidence_caught(groups, [lines]), f"{fam}: seed text satisfies the evidence")

    def test_a_catcher_in_a_new_file_is_credited_and_a_naive_answer_is_not(self):
        for fam in FAMILY_CASES:
            with self.subTest(family=fam):
                caught, j_caught = _grade(fam, dict([_CATCH_NEW[fam]]))
                missed, j_naive = _grade(fam, dict([_NAIVE_NEW[fam]]))
                self.assertEqual(caught["status"], "flagged", caught)
                self.assertEqual(missed["status"], "propagated", missed)
                self.assertGreater(j_caught, 0)
                self.assertEqual(j_naive, 0)
                self.assertGreater(j_caught, j_naive)

    def test_a_catcher_in_the_seeded_file_is_credited_and_a_naive_edit_is_not(self):
        for fam in FAMILY_CASES:
            with self.subTest(family=fam):
                rf, title = _ROLES[fam]
                _, role, case, _ = _case(rf, title)
                files = {f["path"]: f["contents"] for f in _seed(role, case)["files"]}
                caught, j_caught = _grade(fam, dict([_catch_in_seeded_file(fam, files)]))
                missed, j_naive = _grade(fam, dict([_naive_in_seeded_file(fam, files)]))
                self.assertIn(caught["status"], ("addressed", "flagged"), caught)
                self.assertEqual(missed["status"], "propagated", missed)
                self.assertGreater(j_caught, 0)
                self.assertEqual(j_naive, 0)

    def test_support_privacy_catcher_no_longer_scores_like_a_naive_answer(self):
        _, j_caught = _grade("support", dict([_CATCH_NEW["support"]]))
        _, j_naive = _grade("support", dict([_NAIVE_NEW["support"]]))
        self.assertGreater(j_caught, j_naive)

    def test_a_catch_said_only_in_the_chat_counts(self):
        rf, title = _ROLES["support"]
        _, role, case, _ = _case(rf, title)
        seed = _seed(role, case)
        files = [*seed["files"], {"path": "triage.md", "contents": _NAIVE_NEW["support"][1]}]
        chat = [{"role": "user", "text": "T-1047 looks like Orchid Dental's data leaked into this export - who is on call?"}]
        out = next(o for o in canary_outcomes(seed, files, chat) if o["id"].startswith("case-"))
        self.assertEqual(out["status"], "flagged")


if __name__ == "__main__":
    unittest.main()

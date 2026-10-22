"""T13 — the keyless work sample for the non-software families is a real, deterministic case."""

import json
import unittest

from pipeline.jobfit.devcase.design import design_case, design_role
from pipeline.jobfit.devcase.family_cases import FAMILY_CASES, resolve_case_family
from pipeline.jobfit.devcase.lifecycle_eval import _check_case
from pipeline.jobfit.devcase.models import RUBRIC_DIMENSIONS, CaseScenario, DevNeed, NeedAnalysis, RoleSpec
from pipeline.jobfit.devcase.seed_materializer import CANARY_KINDS, MAX_SEED_FILES, deterministic_seed

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
                    self.assertEqual(files[c["path"]].count(c["flaw"]), 1, f"{fam}/{c['id']}")
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
        # a keyed (LLM) case has a different title, so no family files are attached to it
        _, role, case, _ = _case("customer_support", "Support Specialist")
        case = {**case, "title": "A case the model wrote"}
        self.assertEqual(len(_seed(role, case)["files"]), 3)


if __name__ == "__main__":
    unittest.main()

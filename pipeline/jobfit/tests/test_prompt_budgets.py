from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.gemini as G
import pipeline.jobfit.group_compare as GC
import pipeline.jobfit.match_reasoning as MR
from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import score_job

_JOB = normalize_job(
    {
        "title": "Senior Backend Engineer",
        "seniority": "senior",
        "role_family": "software_engineering",
        "description": "Backend team.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
)


class CapBlockTest(unittest.TestCase):
    """Per-block prompt budgets: over-budget input is cut with an explicit
    marker; under-budget input passes through byte-identical."""

    def test_under_budget_passes_byte_identical(self) -> None:
        text = "Þe qüick brown fox — příliš žluťoučký kůň.\n" * 10
        self.assertIs(G._cap_block(text, len(text)), text)  # exact-at-budget included
        self.assertIs(G._cap_block(text, len(text) + 1), text)

    def test_over_budget_truncates_with_marker(self) -> None:
        text = "x" * 1_001
        capped = G._cap_block(text, 1_000)
        self.assertTrue(capped.startswith("x" * 1_000))
        self.assertTrue(capped.endswith("\n[truncated at 1000 chars]"))
        # Nothing of the over-budget tail survives beyond the marker.
        self.assertEqual(len(capped), 1_000 + len("\n[truncated at 1000 chars]"))

    def test_marker_names_the_actual_budget(self) -> None:
        capped = G._cap_block("y" * (G.JD_BLOCK_MAX_CHARS + 5), G.JD_BLOCK_MAX_CHARS)
        self.assertIn(f"[truncated at {G.JD_BLOCK_MAX_CHARS} chars]", capped)


class AnalyzePromptBudgetsTest(unittest.TestCase):
    """The assembled cv_analysis prompt must bound each input block (JD, company,
    redacted CV text) at its budget — and leave in-bounds inputs byte-identical.
    Patches the model call and inspects the prompt that would have been sent
    (same harness as test_prompt_locale)."""

    def _capture_prompt(self, **kwargs: object) -> str:
        captured: dict[str, str] = {}

        def fake_grounded(**call_kwargs: object) -> G.GroundedAnswer:
            captured["prompt"] = str(call_kwargs.get("prompt", ""))
            return G.GroundedAnswer(text="{}", payload={"profile": {"raw_text": "x"}})

        fd, name = tempfile.mkstemp(suffix=".txt")
        os.write(fd, b"Some CV text")
        os.close(fd)
        tmp = Path(name)
        try:
            with mock.patch.object(G, "grounded_answer", fake_grounded):
                G.analyze_profile_with_gemini(tmp, **kwargs)  # type: ignore[arg-type]
        finally:
            tmp.unlink()
        return captured["prompt"]

    def test_over_budget_jd_is_truncated_with_marker(self) -> None:
        jd = "J" * (G.JD_BLOCK_MAX_CHARS + 500)
        prompt = self._capture_prompt(job_description_text=jd)
        self.assertIn(f"[truncated at {G.JD_BLOCK_MAX_CHARS} chars]", prompt)
        self.assertNotIn(jd, prompt)  # the full block must not ride through
        self.assertIn("J" * G.JD_BLOCK_MAX_CHARS, prompt)  # the in-budget prefix does

    def test_over_budget_company_is_truncated_with_marker(self) -> None:
        company = "C" * (G.COMPANY_BLOCK_MAX_CHARS + 500)
        prompt = self._capture_prompt(company_text=company)
        self.assertIn(f"[truncated at {G.COMPANY_BLOCK_MAX_CHARS} chars]", prompt)
        self.assertNotIn(company, prompt)

    def test_over_budget_blind_cv_text_is_truncated_with_marker(self) -> None:
        cv_text = "V" * (G.CV_TEXT_BLOCK_MAX_CHARS + 500)
        prompt = self._capture_prompt(blind_text=cv_text)
        self.assertIn(f"[truncated at {G.CV_TEXT_BLOCK_MAX_CHARS} chars]", prompt)
        self.assertNotIn(cv_text, prompt)

    def test_under_budget_blocks_pass_through_verbatim_without_marker(self) -> None:
        jd = "Senior Python engineer, Praha. Kafka, Airflow, GCP."
        company = "Česká spořitelna — Erste group, ~10k employees."
        cv_text = "Redacted CV for [NAME]: 6 years Python, dbt, Snowflake."
        prompt = self._capture_prompt(
            job_description_text=jd, company_text=company, blind_text=cv_text
        )
        self.assertIn(jd, prompt)
        self.assertIn(company, prompt)
        self.assertIn(cv_text, prompt)
        self.assertNotIn("[truncated at", prompt)

    def test_jd_fit_rule_still_engages_for_capped_jd(self) -> None:
        # Capping must not flip the "no job description supplied" branch.
        prompt = self._capture_prompt(job_description_text="J" * (G.JD_BLOCK_MAX_CHARS + 1))
        self.assertIn("Populate job_fit fully", prompt)
        self.assertNotIn("return job_fit as null", prompt)


class EvalFixturesFarUnderCapsTest(unittest.TestCase):
    """Regression guard for the 'eval suite unaffected' invariant: every eval CV
    fixture must stay FAR under the CV-text budget (< half), so the caps can
    never perturb an eval run. Measured at introduction: fixtures max 1,277
    chars, fixtures_csas max 2,293 — vs a 60,000-char budget."""

    def test_every_eval_cv_fixture_is_far_under_the_cv_budget(self) -> None:
        eval_dir = Path(G.__file__).resolve().parent / "eval"
        fixtures = sorted(eval_dir.glob("fixtures*/**/*.txt"))
        self.assertTrue(fixtures, "expected eval fixtures to exist")
        for fixture in fixtures:
            size = len(fixture.read_text(encoding="utf-8"))
            self.assertLess(
                size,
                G.CV_TEXT_BLOCK_MAX_CHARS // 2,
                f"{fixture.name} ({size} chars) is no longer far under the CV budget",
            )

class ReasoningPromptBudgetsTest(unittest.TestCase):
    """The per-match reasoning prompt inlines four candidate-authored free-prose fields
    VERBATIM (summary, experienceHighlights, aspirations, workLinks) and nothing bounded
    them: a CV can carry a 200 KB "summary", which is billed on every Explain-fit call
    and pushes the role facts out of the model's attention. Same contract as the gemini
    blocks above — an over-budget block is cut with an explicit marker, an in-budget one
    is byte-identical."""

    def _ctx(self, **fields: object) -> dict:
        cand = MR.MatchCandidate(
            skills=["Python"],
            seniority="senior",
            role_family="software_engineering",
            languages=["English"],
            **fields,  # type: ignore[arg-type]
        )
        return MR.reasoning_context(cand, _JOB, score_job(cand, _JOB))

    def test_an_oversized_summary_is_cut_with_a_marker(self) -> None:
        ctx = self._ctx(summary="S" * (MR.SUMMARY_MAX_CHARS + 500))
        self.assertIn(f"[truncated at {MR.SUMMARY_MAX_CHARS} chars]", ctx["candidate"]["summary"])
        self.assertNotIn("S" * (MR.SUMMARY_MAX_CHARS + 1), MR.build_prompt(ctx))

    def test_an_oversized_highlight_link_and_aspiration_are_cut(self) -> None:
        ctx = self._ctx(
            experience_highlights=["H" * (MR.HIGHLIGHT_MAX_CHARS + 50)],
            work_links=["L" * (MR.WORK_LINK_MAX_CHARS + 50)],
            aspirations=["A" * (MR.ASPIRATION_MAX_CHARS + 50)],
        )
        cand = ctx["candidate"]
        self.assertIn(f"[truncated at {MR.HIGHLIGHT_MAX_CHARS} chars]", cand["experienceHighlights"][0])
        self.assertIn(f"[truncated at {MR.WORK_LINK_MAX_CHARS} chars]", cand["workLinks"][0])
        self.assertIn(f"[truncated at {MR.ASPIRATION_MAX_CHARS} chars]", cand["aspirations"][0])

    def test_ordinary_cv_prose_passes_through_untouched(self) -> None:
        summary = "Senior Python engineer, 8 years, payments."
        highlight = "Cut checkout latency 40% by rewriting the ledger sync."
        ctx = self._ctx(summary=summary, experience_highlights=[highlight], aspirations=["Lead a platform team."])
        prompt = MR.build_prompt(ctx)
        self.assertEqual(ctx["candidate"]["summary"], summary)
        self.assertIn(highlight, prompt)
        self.assertNotIn("[truncated at", prompt)


class GroupComparePromptBudgetsTest(unittest.TestCase):
    """The comparison prompt inlines each candidate's LABEL and per-candidate VERDICT —
    both derived from CV text (group-eval-run.ts) — and neither was bounded."""

    def _ctx(self, **cand: object) -> dict:
        base = {"label": "Alice", "archetype": "bau", "seniority": "senior", "total": 70}
        return {"roleTitle": "Backend Engineer", "candidates": [{**base, **cand}]}

    def test_an_oversized_verdict_is_cut_with_a_marker(self) -> None:
        prompt = GC.build_prompt(self._ctx(verdict="V" * (MR.COMPARE_VERDICT_MAX_CHARS + 500)))
        self.assertIn(f"[truncated at {MR.COMPARE_VERDICT_MAX_CHARS} chars]", prompt)
        self.assertNotIn("V" * (MR.COMPARE_VERDICT_MAX_CHARS + 1), prompt)

    def test_an_oversized_label_is_cut_with_a_marker(self) -> None:
        prompt = GC.build_prompt(self._ctx(label="L" * (MR.COMPARE_LABEL_MAX_CHARS + 200)))
        self.assertIn(f"[truncated at {MR.COMPARE_LABEL_MAX_CHARS} chars]", prompt)

    def test_ordinary_candidate_prose_passes_through_untouched(self) -> None:
        verdict = "Strong senior backend fit; ships payments infrastructure."
        prompt = GC.build_prompt(self._ctx(verdict=verdict))
        self.assertIn(verdict, prompt)
        self.assertNotIn("[truncated at", prompt)


if __name__ == "__main__":
    unittest.main()

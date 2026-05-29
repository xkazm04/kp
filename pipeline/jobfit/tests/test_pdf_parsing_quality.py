from __future__ import annotations

import os
import unittest
from pathlib import Path

from pipeline.jobfit.extractors import extract_text
from pipeline.jobfit.gemini import extract_profile_text_with_gemini
from pipeline.jobfit.profiling import build_profile


ROOT = Path(__file__).resolve().parents[3]
TECHNICAL_CV = ROOT / "samples" / "profile-fixtures" / "technical-cv.pdf"
LINKEDIN_PROFILE = ROOT / "samples" / "profile-fixtures" / "linkedin-profile.pdf"


def quality_summary(text: str) -> dict[str, int | float]:
    profile = build_profile(text)
    letter_spaced_hits = text.count("L L M") + text.count("R e a c t") + text.count("P y t h o n")
    return {
        "length": len(text),
        "years": profile.years_experience,
        "letter_spaced_hits": letter_spaced_hits,
    }


class PdfParsingQualityTest(unittest.TestCase):
    @unittest.skipUnless(LINKEDIN_PROFILE.exists(), "personal CV fixture removed")
    def test_pypdf_extracts_linkedin_export_well(self) -> None:
        text = extract_text(LINKEDIN_PROFILE)
        summary = quality_summary(text)
        self.assertGreater(summary["length"], 5000)
        self.assertEqual(summary["letter_spaced_hits"], 0)

    @unittest.skipUnless(TECHNICAL_CV.exists(), "personal CV fixture removed")
    def test_pypdf_collapses_letter_spaced_text(self) -> None:
        text = extract_text(TECHNICAL_CV)
        summary = quality_summary(text)
        self.assertEqual(summary["letter_spaced_hits"], 0)

    @unittest.skipUnless(
        TECHNICAL_CV.exists() and bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
        "needs the CV fixture + a Gemini API key",
    )
    def test_gemini_pdf_extraction_returns_structured_skills(self) -> None:
        _gemini_text, structured, _notes = extract_profile_text_with_gemini(TECHNICAL_CV)
        gemini_skills = structured.get("skills") or []
        self.assertGreaterEqual(len(gemini_skills), 5)


if __name__ == "__main__":
    unittest.main()

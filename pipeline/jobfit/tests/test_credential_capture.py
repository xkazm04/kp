"""P0-4: licenses/certs, publications/patents, and work links are captured as
first-class structured fields on the analysis profile (not lost in free-text) —
AND that capture actually reaches the deterministic credential gate.

Capture alone is worthless: the whole point of structured ``credentials`` is that
``credentials.credential_checks`` can screen them (a JD-required regulated licence the
candidate does not hold, or a held regulated licence whose date has passed). Until
2026-08-22 nothing in the suite bound the two — ``test_credentials.py`` exercises the
gate on hand-built dicts, this file exercised the capture, and the wiring in
``pipeline.analyze_cv`` between them was untested. Feeding the gate an empty list
instead of ``profile.credentials`` passed the entire 185-test scope green while
inverting BOTH outcomes the gate exists for: every candidate for a regulated role reads
"licence not found" (a false positive that withholds a real nurse's licence), and an
expired licence is never flagged (a false negative that advances an unlicensed hire).
:class:`CredentialGateIsFedTheCapturedCredentialsTest` closes that seam end to end.
"""
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.pipeline as P
from pipeline.jobfit.pipeline import _profile_from_payload


class CredentialCaptureTest(unittest.TestCase):
    def _payload(self, **extra):
        base = {
            "name": "Sarah Mitchell",
            "years_experience": 8,
            "current_seniority": "senior",
            "role_family": "healthcare_clinical",
            "education_level": "bachelor",
            "skills": ["ICU"],
            "languages": ["English"],
            "traits": [],
        }
        base.update(extra)
        return base

    def test_credentials_publications_links_captured(self) -> None:
        prof = _profile_from_payload(
            self._payload(
                credentials=[
                    {"name": "Registered Nurse license", "issuer": "MA Board of Nursing",
                     "identifier": "RN1234567", "expiry": "2027", "kind": "license"},
                    {"name": "CCRN", "issuer": "AACN", "kind": "certification"},
                    {"name": "", "issuer": "ignored"},  # nameless → dropped
                ],
                publications=[
                    {"title": "Sepsis bundle outcomes in the ICU", "venue": "Crit Care Med", "year": "2023"},
                    {"title": ""},  # titleless → dropped
                ],
                links=["https://orcid.org/0000-0001", "https://example.org/portfolio"],
            ),
            raw_text="Sarah Mitchell RN CV ...",
        )
        self.assertEqual(len(prof.credentials), 2)
        self.assertEqual(prof.credentials[0].kind, "license")
        self.assertEqual(prof.credentials[0].identifier, "RN1234567")
        self.assertEqual(prof.credentials[1].name, "CCRN")
        self.assertEqual(len(prof.publications), 1)
        self.assertEqual(prof.publications[0].kind, "publication")  # defaulted
        self.assertIn("https://orcid.org/0000-0001", prof.links)

    def test_empty_when_absent(self) -> None:
        prof = _profile_from_payload(self._payload(), raw_text="x")
        self.assertEqual(prof.credentials, [])
        self.assertEqual(prof.publications, [])
        self.assertEqual(prof.links, [])

    def test_unknown_kinds_normalized(self) -> None:
        prof = _profile_from_payload(
            self._payload(
                credentials=[{"name": "Series 7", "kind": "weird"}],
                publications=[{"title": "US Patent 123", "kind": "patent"}],
            ),
            raw_text="x",
        )
        self.assertEqual(prof.credentials[0].kind, "certification")  # unknown → default
        self.assertEqual(prof.publications[0].kind, "patent")


class CredentialGateIsFedTheCapturedCredentialsTest(unittest.TestCase):
    """The captured credentials must be the ones the deterministic gate screens.

    Drives the real ``analyze_cv`` with the Gemini call and the text extractor mocked
    (same harness as test_analyze_honesty_fields / test_pipeline — no network, no key),
    so the only thing under test is that ``pipeline`` hands ``profile.credentials`` to
    ``credential_checks``. Both directions are pinned because they fail differently:
    a severed wire flags a HELD licence as missing and silently drops an EXPIRED one.
    """

    JD = "ICU Registered Nurse wanted. Active RN license required."

    def _payload(self, credentials: list[dict]) -> dict:
        return {
            "profile": {
                "raw_text": "Sarah Mitchell, ICU nurse. " * 10,
                "name": "Sarah Mitchell",
                "years_experience": 8,
                "current_seniority": "senior",
                "role_family": "healthcare_clinical",
                "education_level": "bachelor",
                "skills": ["ICU"],
                "languages": ["English"],
                "traits": [],
                "credentials": credentials,
            },
            "score": {"experience": 25, "skills": 24, "role_seniority": 23, "education": 12, "traits": 10, "total": 94},
            "salary": {"minimum": 90000, "maximum": 130000, "currency": "CZK", "period": "month"},
            "strengths": ["Strong ICU track record"],
            "gaps": [],
            "recommendations": [],
            "explanation": "Solid candidate.",
            "job_fit": {
                "score": 80,
                "summary": "Good fit.",
                "matching_skills": ["ICU"],
                "missing_skills": [],
                "seniority_alignment": "aligned",
                "role_alignment": "aligned",
                "salary_assessment": "in band",
                "recommendations": [],
            },
        }

    def _checks(self, credentials: list[dict]) -> list[str]:
        payload = self._payload(credentials)
        with mock.patch.object(P, "extract_text", lambda _p: payload["profile"]["raw_text"]), mock.patch.object(
            P, "analyze_profile_with_gemini", lambda *a, **k: (payload, [], {})
        ):
            result = P.analyze_cv(Path("cv.pdf"), job_description_text=self.JD)
        return [c for c in result.sanity_checks if c.startswith("Credential:")]

    def test_held_licence_is_not_reported_missing(self) -> None:
        # The candidate HOLDS the RN licence the JD demands, and the capture proved it
        # lands on the profile — so the gate must see it and stay silent. A gate fed an
        # empty list instead would flag every regulated-role candidate as unlicensed.
        checks = self._checks([{"name": "Registered Nurse license", "issuer": "MA Board of Nursing", "kind": "license"}])
        self.assertEqual(checks, [], "the captured RN licence never reached credential_checks")

    def test_expired_held_licence_is_flagged_from_the_captured_expiry(self) -> None:
        # The other direction: the expiry check can only fire on a CAPTURED credential,
        # so this fails the moment the wire is cut (an unlicensed hire advances silently).
        checks = self._checks(
            [{"name": "Registered Nurse license", "issuer": "MA Board of Nursing", "expiry": "2019-03", "kind": "license"}]
        )
        self.assertTrue(any("in the past" in c for c in checks), checks)
        self.assertTrue(any("2019-03" in c for c in checks), checks)

    def test_absent_licence_is_still_reported_missing(self) -> None:
        # Guardrail so the two asserts above cannot be satisfied by a gate that never
        # runs: with no credentials captured, the required-licence finding must appear.
        checks = self._checks([])
        self.assertTrue(any("Registered Nurse" in c and "not found" in c for c in checks), checks)


if __name__ == "__main__":
    unittest.main()

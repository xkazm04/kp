"""P0-4: licenses/certs, publications/patents, and work links are captured as
first-class structured fields on the analysis profile (not lost in free-text)."""
import unittest

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


if __name__ == "__main__":
    unittest.main()

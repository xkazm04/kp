from __future__ import annotations

import unittest
from datetime import date

from pipeline.jobfit.credentials import credential_checks

TODAY = date(2026, 6, 25)


class CredentialChecksTest(unittest.TestCase):
    def test_required_licence_missing_is_flagged(self) -> None:
        jd = "Seeking a Registered Nurse for our ICU. RN license required."
        flags = credential_checks(jd, [], today=TODAY)
        self.assertTrue(any("Registered Nurse" in f and "manual review" in f for f in flags))

    def test_required_licence_held_is_not_flagged(self) -> None:
        jd = "Seeking a Registered Nurse for our ICU. RN license required."
        creds = [{"name": "Registered Nurse license", "expiry": "", "kind": "license"}]
        flags = credential_checks(jd, creds, today=TODAY)
        self.assertEqual(flags, [])

    def test_expired_regulated_licence_is_flagged(self) -> None:
        jd = "Broker-dealer role; FINRA Series 7 required."
        creds = [{"name": "FINRA Series 7", "expiry": "2019-03", "kind": "license"}]
        flags = credential_checks(jd, creds, today=TODAY)
        # Held, so NOT 'missing'; but the past date must be surfaced.
        self.assertFalse(any("not found" in f for f in flags))
        self.assertTrue(any("in the past" in f for f in flags))

    def test_non_regulated_cert_with_past_date_is_not_flagged(self) -> None:
        # An AWS cert issued in 2021 is not a regulated hard-gate licence — bounding
        # the expiry check to regulated licences keeps this from being noise.
        creds = [{"name": "AWS Certified Solutions Architect", "expiry": "2021-01", "kind": "certification"}]
        flags = credential_checks("Cloud engineer wanted.", creds, today=TODAY)
        self.assertEqual(flags, [])

    def test_future_dated_licence_is_not_flagged_expired(self) -> None:
        jd = "Broker-dealer role; FINRA Series 7 required."
        creds = [{"name": "FINRA Series 7", "expiry": "2028-12", "kind": "license"}]
        flags = credential_checks(jd, creds, today=TODAY)
        self.assertEqual(flags, [])

    def test_no_jd_and_no_creds_is_empty(self) -> None:
        self.assertEqual(credential_checks(None, None, today=TODAY), [])

    def test_unrelated_role_does_not_flag(self) -> None:
        # A normal software JD names no regulated licence — no findings.
        flags = credential_checks("Backend engineer, Go and Postgres.", [], today=TODAY)
        self.assertEqual(flags, [])


if __name__ == "__main__":
    unittest.main()

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

    def test_two_year_expiry_uses_later_year_not_issue(self) -> None:
        # bug-ui-scan-2026-07-09 (#5): a string carrying BOTH an issue and an expiry
        # year must read the LATER (expiry) year. Pre-fix re.search grabbed 2020
        # (issue) and false-flagged a still-current 2028 licence as expired.
        jd = "Broker-dealer role; FINRA Series 7 required."
        creds = [{"name": "FINRA Series 7", "expiry": "Issued 2020, expires 2028", "kind": "license"}]
        flags = credential_checks(jd, creds, today=TODAY)
        self.assertFalse(any("in the past" in f for f in flags))
        self.assertEqual(flags, [])

    def test_two_year_expiry_both_past_is_flagged(self) -> None:
        # Both years past → the max (2019) is still < today → genuinely expired.
        creds = [{"name": "FINRA Series 7", "expiry": "Issued 2013, expired 2019", "kind": "license"}]
        flags = credential_checks("Broker-dealer role; FINRA Series 7 required.", creds, today=TODAY)
        self.assertTrue(any("in the past" in f for f in flags))

    def test_same_year_stray_number_is_not_read_as_month(self) -> None:
        # bug-ui-scan-2026-07-09 (#5): expiry in the current year with no real month;
        # a stray id ("#3") must not be read as month 3 and false-flag past. Pre-fix
        # the yearless month scan matched "3" (< today's month 6) and flagged.
        creds = [{"name": "FINRA Series 7", "expiry": "2026 renewal, cert #3", "kind": "license"}]
        flags = credential_checks("Broker-dealer role; FINRA Series 7 required.", creds, today=TODAY)
        self.assertEqual(flags, [])

    def test_same_year_earlier_month_still_flagged(self) -> None:
        # Guard: a real earlier-this-year month (03 < today's 06) still flags past.
        creds = [{"name": "FINRA Series 7", "expiry": "2026-03", "kind": "license"}]
        flags = credential_checks("Broker-dealer role; FINRA Series 7 required.", creds, today=TODAY)
        self.assertTrue(any("in the past" in f for f in flags))

    def test_no_jd_and_no_creds_is_empty(self) -> None:
        self.assertEqual(credential_checks(None, None, today=TODAY), [])

    def test_unrelated_role_does_not_flag(self) -> None:
        # A normal software JD names no regulated licence — no findings.
        flags = credential_checks("Backend engineer, Go and Postgres.", [], today=TODAY)
        self.assertEqual(flags, [])


class HeldButUnstatedTest(unittest.TestCase):
    """A JD-required licence counts as held only when the CV's own text states it."""

    JD = "ICU Registered Nurse wanted. Active RN license required."
    LISTED = [{"name": "Registered Nurse (RN)", "issuer": "State Board of Nursing", "kind": "license"}]

    def test_listed_but_unstated_licence_is_flagged(self) -> None:
        cv = "ICU nurse, 8 years at a city hospital intensive care unit. BSN, 2016."
        flags = credential_checks(self.JD, self.LISTED, today=TODAY, cv_text=cv)
        self.assertEqual([f.code for f in flags], ["credential_unstated"])

    def test_licence_the_cv_states_is_not_flagged(self) -> None:
        cv = "ICU nurse, 8 years. Registered Nurse, state Board of Nursing. BSN, 2016."
        self.assertEqual(credential_checks(self.JD, self.LISTED, today=TODAY, cv_text=cv), [])

    def test_licence_number_in_the_cv_counts_as_stated(self) -> None:
        creds = [{"name": "Registered Nurse (RN)", "identifier": "MA-447120", "kind": "license"}]
        cv = "ICU nurse, 8 years. Licence MA-447120. BSN, 2016."
        self.assertEqual(credential_checks(self.JD, creds, today=TODAY, cv_text=cv), [])

    def test_unreadable_cv_raises_nothing_new(self) -> None:
        # Nothing was read, so the document can neither confirm nor refute the list.
        self.assertEqual(credential_checks(self.JD, self.LISTED, today=TODAY, cv_text="  "), [])
        self.assertEqual(credential_checks(self.JD, self.LISTED, today=TODAY), [])

    def test_unrequired_licence_is_not_checked(self) -> None:
        flags = credential_checks("Cloud engineer wanted.", self.LISTED, today=TODAY, cv_text="Engineer.")
        self.assertEqual(flags, [])


if __name__ == "__main__":
    unittest.main()

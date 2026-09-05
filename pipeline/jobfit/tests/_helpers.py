"""Shared test factories + named thresholds for the unittest suite.

This is a plain importable module, NOT a pytest ``conftest.py`` — the suite runs
under ``python -m unittest discover`` (see package.json ``test:python``), where
conftest fixtures would never fire. Import the factories explicitly.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from unittest import mock

from pipeline.jobfit.jobs import normalize_job

# Named thresholds, replacing inline magic numbers across the suite.
STRONG_SKILL_SCORE = 0.6  # a confident must-have skill match
PARTIAL_SKILL_SCORE = 0.5  # a transferable/adjacent skill match
MIN_CONFIDENCE_SPREAD = 8  # min total spread between confidence_high/low
MIN_LINKEDIN_TEXT_LEN = 5000  # a real LinkedIn export is at least this long


def mkjob(**over):
    """A normalized job with sensible defaults; override any field via kwargs."""
    base = {
        "title": "Role",
        "seniority": "senior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "A team building things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return normalize_job(base)


@contextmanager
def env(*clear: str, **overrides: str | None):
    """Isolate named env vars for the block; the rest of the environment survives.

    Four modules had each grown their own version of this — two as `_clean_env`
    rebuilding `os.environ` into a `mock.patch.dict(..., clear=True)`, two as
    ad-hoc pop/restore in a try/finally — and they disagreed on the part that
    matters: a `clear=True` patch also deletes PATH, TMP and the suite's own
    hermeticity vars, so a test written that way passes locally and fails wherever
    the code under test shells out. This one CLEARS ONLY WHAT IT IS TOLD TO.

        with env("ELEVENLABS_API_KEY", "KP_OFFLINE"):        # unset these
        with env(ENV_VAR, OPENAI_API_KEY="k"):               # unset one, set one
        with env(OPENAI_BASE_URL=None):                      # None also unsets

    Positional names are unset; keyword `None` is unset; any other keyword value is
    set. Restoration is `mock.patch.dict`'s, so it survives an exception in the body.
    """
    with mock.patch.dict(os.environ, {}, clear=False):
        for key in clear:
            os.environ.pop(key, None)
        for key, value in overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield

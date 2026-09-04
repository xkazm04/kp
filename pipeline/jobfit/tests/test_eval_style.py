"""Pins for the eval suite's ONE color decision.

``_style.should_color`` consolidates three opt-outs that used to be re-derived in
three entry points: an explicit ``--no-color``, the ``NO_COLOR`` convention, and a
non-TTY stream. Nothing tested it, so the module that exists to stop the three
copies drifting had no guard of its own — and every one of these opt-outs is the
difference between a readable CI log and one full of escape sequences.
"""

from __future__ import annotations

import io
import os
import unittest
from types import SimpleNamespace
from unittest import mock

from pipeline.jobfit.eval._style import _make_styler, should_color


class _Stream(io.StringIO):
    def __init__(self, tty: bool):
        super().__init__()
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


class ShouldColorTest(unittest.TestCase):
    def setUp(self):
        # NO_COLOR may be set in the shell running the suite; these cases are about
        # the other two opt-outs, so start from a known-clean environment.
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("NO_COLOR", None)

    def test_a_tty_gets_color(self):
        self.assertTrue(should_color(None, _Stream(tty=True)))

    def test_a_pipe_does_not(self):
        # The CI case: stdout redirected, so ANSI would be literal noise in the log.
        self.assertFalse(should_color(None, _Stream(tty=False)))

    def test_the_no_color_flag_wins_over_a_tty(self):
        self.assertFalse(should_color(SimpleNamespace(no_color=True), _Stream(tty=True)))

    def test_an_args_namespace_without_the_flag_is_fine(self):
        # Entry points that have no --no-color pass their own args through unchanged.
        self.assertTrue(should_color(SimpleNamespace(json=True), _Stream(tty=True)))

    def test_no_color_env_disables_even_when_empty(self):
        # The NO_COLOR convention is "set at all", not "set to something truthy".
        for value in ("1", "", "0", "false"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"NO_COLOR": value}):
                self.assertFalse(should_color(None, _Stream(tty=True)))


class StylerTest(unittest.TestCase):
    def test_disabled_styler_is_a_no_op(self):
        style = _make_styler(False)
        self.assertEqual(style("PASS", "green", "bold"), "PASS")

    def test_enabled_styler_wraps_and_resets(self):
        style = _make_styler(True)
        self.assertEqual(style("PASS", "green"), "[32mPASS[0m")
        self.assertEqual(style("PASS", "green", "bold"), "[32;1mPASS[0m")

    def test_an_unknown_name_is_dropped_rather_than_emitting_a_broken_escape(self):
        style = _make_styler(True)
        self.assertEqual(style("x", "chartreuse"), "x")
        self.assertEqual(style("x", "chartreuse", "red"), "[31mx[0m")


if __name__ == "__main__":
    unittest.main()

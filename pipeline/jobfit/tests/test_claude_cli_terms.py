"""The Claude CLI engine is refused on a production deployment.

kp's default engine is the Claude Code CLI on a developer's own Claude seat, and
docs/architecture/llm-provider-layer.md called that "local/dev only" for months
with NOTHING behind the sentence: a keyless `next start` — a customer's
self-hosted install — resolved straight to it and processed real candidate data
under Anthropic's Consumer Terms (no DPA, therefore no GDPR Art. 28 processing
contract, and inputs eligible for training since 2025-08-28).

Three properties, and the third is the one that makes this safe to ship:

1. Production + the consumer lane + no unlock => refused, and refused as a
   DEGRADE (``availability()`` names its reason, routing serves the deterministic
   answer) — never as a crash on a dev box, because degrading keylessly is a
   product property here.
2. ``KP_ALLOW_CLI_ENGINE`` unlocks it, mirroring KP_ALLOW_OPEN: an operator who
   means it says so out loud, once, in one variable.
3. The stripping of ``ANTHROPIC_API_KEY`` is what CREATES the consumer lane.
   With a key let through, the same CLI runs under Commercial terms with a DPA —
   so the registry lane keeps the key in production and there is nothing to
   refuse, while the dev/batch lane's subscription default is untouched.
"""

from __future__ import annotations

import subprocess
import unittest
from unittest import mock

from pipeline.jobfit.claude_cli import (
    CLI_ENGINE_UNLOCK_ENV,
    CONSUMER_TERMS_REASON,
    CONSUMER_TERMS_REFUSAL,
    PROBE_POLICY_FORBIDDEN,
    ClaudeCliError,
    ClaudeCliProvider,
    is_production_deployment,
)
from pipeline.jobfit.llm.base import AVAILABILITY_REASONS
from pipeline.jobfit.llm.registry import provider_availability, resolve_provider
from pipeline.jobfit.llm import test_cli
from pipeline.jobfit.llm.adapters import GeminiProvider
from pipeline.jobfit.tests._helpers import env

# Every env var these tests depend on, cleared as a set so a developer's own
# exported ANTHROPIC_API_KEY (or a stray KP_OFFLINE) cannot decide the verdict.
_POLICY_ENV = (
    "NODE_ENV",
    CLI_ENGINE_UNLOCK_ENV,
    "KP_OFFLINE",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
)

SUCCESS_ENVELOPE = (
    '{"type":"result","subtype":"success","is_error":false,"result":"pong",'
    '"duration_ms":1,"num_turns":1,"session_id":"s","total_cost_usd":0.01}'
)


def _installed():
    """Pretend the binary is on PATH, so `not_installed` can never mask a verdict."""
    return mock.patch("pipeline.jobfit.claude_cli.shutil.which", return_value="claude")


class ProductionVetoTest(unittest.TestCase):
    """The three cases the guard exists for."""

    def test_production_without_the_unlock_is_refused(self) -> None:
        with env(*_POLICY_ENV, NODE_ENV="production"), _installed():
            provider = ClaudeCliProvider()
            self.assertEqual(provider.availability(), (False, CONSUMER_TERMS_REASON))
            self.assertFalse(provider.available())

    def test_production_with_the_unlock_is_allowed(self) -> None:
        with env(*_POLICY_ENV, NODE_ENV="production", **{CLI_ENGINE_UNLOCK_ENV: "1"}), _installed():
            provider = ClaudeCliProvider()
            self.assertEqual(provider.availability(), (True, None))
            self.assertTrue(provider.available())

    def test_dev_is_never_affected(self) -> None:
        """The dev/batch lane is the lane this engine was written for; a guard that
        broke it would trade one real problem for a worse one."""
        with env(*_POLICY_ENV), _installed():
            self.assertFalse(is_production_deployment())
            self.assertEqual(ClaudeCliProvider().availability(), (True, None))

    def test_the_unlock_accepts_the_same_tokens_as_kp_offline(self) -> None:
        for value in ("1", "true", "yes", "on"):
            with self.subTest(value=value):
                with env(*_POLICY_ENV, NODE_ENV="production", **{CLI_ENGINE_UNLOCK_ENV: value}), _installed():
                    self.assertTrue(ClaudeCliProvider().available())
        for value in ("0", "false", "", "no"):
            with self.subTest(value=value):
                with env(*_POLICY_ENV, NODE_ENV="production", **{CLI_ENGINE_UNLOCK_ENV: value}), _installed():
                    self.assertFalse(ClaudeCliProvider().available())

    def test_the_offline_seal_still_answers_first(self) -> None:
        """Reason priority: offline_policy -> consumer_terms_policy -> not_installed.
        Under KP_OFFLINE this engine cannot reach Anthropic at all, so naming the
        terms would send the operator to fix the second-most-fundamental thing."""
        with env(*_POLICY_ENV, NODE_ENV="production", KP_OFFLINE="1"), _installed():
            self.assertEqual(ClaudeCliProvider().availability(), (False, "offline_policy"))


class RefusalShapeTest(unittest.TestCase):
    """A refusal degrades where routing asks, and is loud where a call is made."""

    def test_the_registry_still_routes_but_the_provider_reports_unavailable(self) -> None:
        """The seam that keeps this a degrade: resolve_provider hands back the
        provider it always did, and the caller's `if not available(): provider =
        None` dance drops to the deterministic answer. Raising out of the resolver
        would have turned a policy refusal into a 500 on a keyless box."""
        # Gemini forced unavailable: the config-less production default prefers it
        # when it can serve, and a keyless box — the case this test is about — is
        # exactly where that preference cannot help and the CLI was reached.
        with env(*_POLICY_ENV, "KP_LLM_CONFIG", NODE_ENV="production"), _installed(), \
                mock.patch.object(GeminiProvider, "available", lambda self: False):
            provider = resolve_provider("match_reasoning")
            self.assertEqual(provider_availability(provider), (False, CONSUMER_TERMS_REASON))

    def test_an_explicit_claude_cli_config_row_is_refused_too(self) -> None:
        """An explicit row beats the Gemini production default unconditionally —
        so if the row could opt out of the terms veto, the veto would be optional."""
        config = '{"useCases": {"match_reasoning": {"provider": "claude_cli"}}}'
        with env(*_POLICY_ENV, NODE_ENV="production", KP_LLM_CONFIG=config), _installed():
            provider = resolve_provider("match_reasoning")
            self.assertEqual(provider_availability(provider), (False, CONSUMER_TERMS_REASON))

    def test_a_call_that_was_actually_made_fails_loudly_and_spawns_nothing(self) -> None:
        calls: list[object] = []

        def runner(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0, stdout=SUCCESS_ENVELOPE, stderr="")

        with env(*_POLICY_ENV, NODE_ENV="production"), _installed(), mock.patch(
            "pipeline.jobfit.claude_cli.subprocess.run", runner
        ):
            with self.assertRaises(ClaudeCliError) as ctx:
                ClaudeCliProvider().complete("x")
        self.assertEqual(ctx.exception.subtype, CONSUMER_TERMS_REASON)
        self.assertEqual(calls, [], "the veto precedes the spawn")

    def test_the_probe_names_the_policy_instead_of_promising_a_route(self) -> None:
        with env(*_POLICY_ENV, NODE_ENV="production"), _installed():
            probe = ClaudeCliProvider().probe()
        self.assertEqual(probe.status, PROBE_POLICY_FORBIDDEN)
        self.assertEqual(probe.detail, CONSUMER_TERMS_REFUSAL)

    def test_the_message_names_the_actual_reason(self) -> None:
        """Not "not permitted here". An operator who reads this must be able to
        decide whether the unlock is legitimate for their deployment."""
        message = CONSUMER_TERMS_REFUSAL.lower()
        for phrase in ("consumer", "subscription", "dpa", "training", "kp_allow_cli_engine"):
            self.assertIn(phrase, message, phrase)

    def test_the_reason_is_a_declared_vocabulary_member_with_an_operator_hint(self) -> None:
        self.assertIn(CONSUMER_TERMS_REASON, AVAILABILITY_REASONS)
        self.assertIn(CONSUMER_TERMS_REASON, test_cli._REASON_HINT)


class BillingLaneTest(unittest.TestCase):
    """Stripping the key is not a cost detail — it decides the contract."""

    def test_stripping_the_key_is_what_creates_the_consumer_lane(self) -> None:
        with env(*_POLICY_ENV, ANTHROPIC_API_KEY="sk-live-xxx"):
            self.assertEqual(ClaudeCliProvider().billing_lane(), "subscription")
            self.assertEqual(ClaudeCliProvider(strip_api_key=False).billing_lane(), "api")

    def test_no_key_at_all_is_the_consumer_lane_however_the_flag_is_set(self) -> None:
        with env(*_POLICY_ENV):
            self.assertEqual(ClaudeCliProvider(strip_api_key=False).billing_lane(), "subscription")

    def test_the_api_lane_is_not_refused_in_production(self) -> None:
        """Commercial terms come with a DPA, so there is nothing for the guard to
        refuse — the guard is about the consumer seat, not about the CLI."""
        with env(*_POLICY_ENV, NODE_ENV="production", ANTHROPIC_API_KEY="sk-live-xxx"), _installed():
            provider = ClaudeCliProvider(strip_api_key=False)
            self.assertEqual(provider.availability(), (True, None))

    def test_the_registry_keeps_a_production_key_and_strips_it_in_dev(self) -> None:
        """The lane is picked by registry._cli_strip_api_key, not inherited from
        the module default (which serves the eval/batch scripts and stays True)."""
        config = '{"useCases": {"match_reasoning": {"provider": "claude_cli"}}}'
        with env(*_POLICY_ENV, NODE_ENV="production", KP_LLM_CONFIG=config, ANTHROPIC_API_KEY="sk-live-xxx"), _installed():
            provider = resolve_provider("match_reasoning")
            self.assertFalse(provider.strip_api_key)
            self.assertEqual(provider.billing_lane(), "api")
            self.assertEqual(provider.availability(), (True, None))
        with env(*_POLICY_ENV, KP_LLM_CONFIG=config, ANTHROPIC_API_KEY="sk-live-xxx"), _installed():
            provider = resolve_provider("match_reasoning")
            self.assertTrue(provider.strip_api_key, "dev keeps the subscription seat")

    def test_a_production_key_reaches_the_child_process(self) -> None:
        """The end of the chain: keeping the flag off has to actually put the key
        in the child's environment, or the "Commercial terms" claim above is a
        comment rather than a fact."""
        seen: dict[str, object] = {}

        def runner(args, **kwargs):
            seen.update(kwargs)
            return subprocess.CompletedProcess(args, 0, stdout=SUCCESS_ENVELOPE, stderr="")

        with env(*_POLICY_ENV, NODE_ENV="production", ANTHROPIC_API_KEY="sk-live-xxx"), _installed(), mock.patch(
            "pipeline.jobfit.claude_cli.subprocess.run", runner
        ):
            ClaudeCliProvider(strip_api_key=False).complete("x")
        self.assertEqual(seen["env"].get("ANTHROPIC_API_KEY"), "sk-live-xxx")

    def test_the_batch_lane_default_still_spends_the_subscription(self) -> None:
        """Non-vacuity for the paragraph above: pipeline/jobfit/eval/* constructs a
        bare ClaudeCliProvider() on purpose, and its mass runs must stay on the
        seat rather than silently moving to metered billing."""
        seen: dict[str, object] = {}

        def runner(args, **kwargs):
            seen.update(kwargs)
            return subprocess.CompletedProcess(args, 0, stdout=SUCCESS_ENVELOPE, stderr="")

        with env(*_POLICY_ENV, ANTHROPIC_API_KEY="sk-live-xxx"), _installed(), mock.patch(
            "pipeline.jobfit.claude_cli.subprocess.run", runner
        ):
            ClaudeCliProvider().complete("x")
        self.assertNotIn("ANTHROPIC_API_KEY", seen["env"])


class EnvironmentSignalTest(unittest.TestCase):
    """ONE reader of the deployment mode, shared with the Gemini production default."""

    def test_node_env_is_the_signal_and_only_production_counts(self) -> None:
        for value, expected in (("production", True), ("development", False), ("test", False), ("", False)):
            with self.subTest(value=value):
                with env(*_POLICY_ENV, NODE_ENV=value):
                    self.assertIs(is_production_deployment(), expected)
        with env(*_POLICY_ENV):
            self.assertFalse(is_production_deployment())

    def test_the_gemini_production_default_reads_the_same_helper(self) -> None:
        """Two readers of NODE_ENV would mean two answers to one question — the
        terms guard on in one and off in the other."""
        import inspect

        from pipeline.jobfit.llm import registry

        source = inspect.getsource(registry)
        self.assertNotIn('getenv("NODE_ENV")', source)
        self.assertIn("is_production_deployment()", source)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

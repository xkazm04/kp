"""Repo scan (App master P2): the heuristic walker, the coercer, and read-only access.

Four properties carry the feature and are pinned here:

* **The heuristic walk is the floor and it is honest.** On a fixture repo it finds
  the declared gates, the context map, the churn and the sizes — and reports the
  things it cannot know (candidate objectives) as `unknown` rather than filling
  them. On kp itself the context count equals ``context-map.json``'s, which is the
  concept's own acceptance check for this phase.
* **It is byte-reproducible.** Two walks of an unchanged tree produce identical
  JSON, so a re-scan that differs means the repo differed.
* **The coercer merges, it does not replace.** A partial answer keeps the
  heuristic values; a hallucinated field, a hallucinated hot-spot path and an
  invented baseline are all dropped.
* **The in-repo session cannot write.** The argv carries `--permission-mode plan`,
  a read-only allowlist and a write denylist, and asking for a write tool raises.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.appmaster import DossierFinding, RepoDossier
from pipeline.jobfit.claude_cli import (
    READ_ONLY_PERMISSION_MODE,
    READ_ONLY_TOOLS,
    WRITE_TOOL_DENYLIST,
    ClaudeCliProvider,
)
from pipeline.jobfit.repo_scan import (
    FALLBACK_CLASSES,
    REDACTED,
    SECRET_FILE_GLOBS,
    SOURCE_HEURISTIC,
    build_heuristic_dossier,
    bind_provider_to_repo,
    build_prompt,
    claude_deny_rules,
    classify_fallback,
    coerce_repo_dossier,
    is_secret_file,
    read_churn,
    read_declared_gates,
    redact_dossier,
    redact_secret_values,
    repo_scan_settings_json,
    scan_repo,
    walk_files,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _make_fixture_repo(root: Path) -> None:
    """A small but REALISTIC repo: manifests, a context map, CI, source, junk."""
    _write(
        root / "package.json",
        json.dumps(
            {
                "name": "fixture-app",
                "scripts": {
                    "dev": "next dev",
                    "start": "next start",
                    "build": "next build",
                    "lint": "eslint",
                    "typecheck": "tsc --noEmit",
                    "test:unit": "node --test",
                    "check:design": "node scripts/design.mjs",
                    "i18n:check": "node scripts/i18n-check.mjs",
                    "market:build": "node scripts/build-market.mjs",
                },
            }
        ),
    )
    _write(
        root / "context-map.json",
        json.dumps(
            {
                "contexts": [
                    {"name": "billing", "category": "lib", "file_paths": ["src/billing.ts", "src/pay.ts"]},
                    {"name": "ui-shell", "category": "ui", "file_paths": ["src/shell.tsx"]},
                ]
            }
        ),
    )
    _write(root / "CLAUDE.md", "# fixture\n\nRun `npm run typecheck` before proposing.\n")
    _write(root / ".github/workflows/ci.yml", "name: ci\n")
    _write(root / "src/billing.ts", "export const rate = 1;\n")
    _write(root / "src/pay.ts", "export const pay = () => 1;\n")
    _write(root / "src/shell.tsx", "export const Shell = () => null;\n")
    _write(root / "pipeline/score.py", "SCORE = 1\n")
    _write(root / "src/analytics/kpi.ts", "export const kpi = 'signups';\n")
    # The noise a walk must NOT count.
    _write(root / "node_modules/left-pad/index.js", "module.exports = 1;\n")
    _write(root / ".next/cache/blob", "x")
    # ...and the files it must never open, name or count. Real content on purpose:
    # a test whose ".env" is empty proves nothing about what leaks.
    _write(root / ".env", "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nDB_PASSWORD=hunter2\n")
    _write(root / ".env.local", "OPENAI_API_KEY=sk-livekeylivekeylivekeylivekey\n")
    _write(root / "deploy/server.pem", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----\n")
    _write(root / "deploy/id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blb\n-----END OPENSSH PRIVATE KEY-----\n")
    _write(root / "src/analytics/kpi.key", "not a real key, but named like one")


class HeuristicWalkTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "fixture"
        self.root.mkdir()
        _make_fixture_repo(self.root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_walk_reads_the_repos_own_declarations(self) -> None:
        dossier = build_heuristic_dossier(self.root, generated_at="2026-01-01T00:00:00+00:00")

        self.assertEqual(dossier.source, SOURCE_HEURISTIC)
        self.assertEqual(dossier.size.contexts, 2)
        self.assertEqual({c.name for c in dossier.contexts}, {"billing", "ui-shell"})
        # Sizes count the app, never node_modules / .next.
        self.assertEqual(dossier.size.source_files, 5)  # 3 ts/tsx + 1 py + 1 kpi.ts
        self.assertIn("TypeScript", dossier.stack)
        self.assertIn("Python", dossier.stack)

        gates = dossier.declared_gates
        self.assertIn("npm run typecheck", gates)
        self.assertIn("npm run lint", gates)
        self.assertIn("npm run build", gates)
        self.assertIn("npm run test:unit", gates)
        self.assertIn("npm run check:design", gates)
        # A namespaced gate is found whichever way round it is written — this is
        # where a prefix-only rule silently loses half a repo's gates.
        self.assertIn("npm run i18n:check", gates)
        # `dev` / `start` are not gates: they prove nothing.
        self.assertNotIn("npm run dev", gates)
        self.assertNotIn("npm run start", gates)
        # …and neither is building a DATA file, which is why `build` matches only
        # as a whole script name.
        self.assertNotIn("npm run market:build", gates)
        self.assertIn("ci: .github/workflows/ci.yml", gates)

        # The KPI signal is a PATH, never an interpreted number.
        self.assertIn("src/analytics/kpi.ts", dossier.existing_kpis)

    def test_unknowable_fields_are_reported_unknown_not_filled(self) -> None:
        dossier = build_heuristic_dossier(self.root, generated_at="2026-01-01T00:00:00+00:00")
        self.assertEqual(dossier.candidate_objectives, [])
        self.assertEqual(dossier.field_provenance["candidateObjectives"], "unknown")
        self.assertEqual(dossier.field_provenance["size"], "heuristic")
        # A maintainer-load line without git history says so; it never invents a headcount.
        self.assertIn("unknown", dossier.maintainer_load_estimate)

    def test_missing_gates_are_a_stated_risk(self) -> None:
        bare = Path(self._tmp.name) / "bare"
        bare.mkdir()
        _write(bare / "README.md", "nothing here")
        dossier = build_heuristic_dossier(bare, generated_at="2026-01-01T00:00:00+00:00")
        refs = {f.ref for f in dossier.risk_areas}
        self.assertIn("declaredGates", refs)
        self.assertIn("ci", refs)
        self.assertIn("context-map.json", refs)

    def test_the_walk_is_byte_reproducible(self) -> None:
        stamp = "2026-01-01T00:00:00+00:00"
        first = build_heuristic_dossier(self.root, generated_at=stamp).model_dump(by_alias=True)
        second = build_heuristic_dossier(self.root, generated_at=stamp).model_dump(by_alias=True)
        self.assertEqual(
            json.dumps(first, sort_keys=True, ensure_ascii=False),
            json.dumps(second, sort_keys=True, ensure_ascii=False),
            "two walks of an unchanged tree must be identical — otherwise a re-scan diff means nothing",
        )

    def test_scan_repo_without_a_provider_is_the_heuristic_dossier(self) -> None:
        payload, source = scan_repo(self.root, provider=None, generated_at="2026-01-01T00:00:00+00:00")
        self.assertEqual(source, SOURCE_HEURISTIC)
        self.assertEqual(payload["source"], SOURCE_HEURISTIC)
        # And it still validates as the schema P1 published.
        RepoDossier.model_validate(payload)

    def test_makefile_targets_are_read_as_gates(self) -> None:
        _write(self.root / "Makefile", "test:\n\techo hi\nrun:\n\techo no\n")
        gates = read_declared_gates(self.root)
        self.assertIn("make test", gates)
        self.assertNotIn("make run", gates)


class ChurnTest(unittest.TestCase):
    """Churn needs a real git history, so this builds one."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "repo"
        self.root.mkdir()
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.com",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.com",
        }
        self.env = env
        self._git("init", "-q")
        for i in range(3):
            _write(self.root / "hot.ts", f"export const v = {i};\n")
            self._git("add", "-A")
            self._git("commit", "-q", "-m", f"change {i}")
        _write(self.root / "cold.ts", "export const c = 1;\n")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "cold")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=str(self.root), env=self.env, check=False, capture_output=True)

    def test_hot_spots_rank_by_churn_and_carry_their_denominator(self) -> None:
        dossier = build_heuristic_dossier(self.root, generated_at="2026-01-01T00:00:00+00:00")
        if not dossier.hot_spots:
            self.skipTest("git is unavailable in this environment")
        self.assertEqual(dossier.hot_spots[0].ref, "hot.ts")
        # The note states the count AND the window it was counted over.
        self.assertIn("of the last", dossier.hot_spots[0].note)
        self.assertIn("distinct author", dossier.maintainer_load_estimate)


class CoerceTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "fixture"
        self.root.mkdir()
        _make_fixture_repo(self.root)
        self.base = build_heuristic_dossier(self.root, generated_at="2026-01-01T00:00:00+00:00")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_a_partial_answer_keeps_the_heuristic_values(self) -> None:
        merged = coerce_repo_dossier({"maintainerLoadEstimate": "about one part-time owner"}, self.base)
        self.assertEqual(merged.maintainer_load_estimate, "about one part-time owner")
        self.assertEqual(merged.field_provenance["maintainerLoadEstimate"], "llm")
        # Everything the model did not answer survives, with its heuristic stamp.
        self.assertEqual(merged.size, self.base.size)
        self.assertEqual(merged.declared_gates, self.base.declared_gates)
        self.assertEqual(merged.field_provenance["declaredGates"], "heuristic")
        self.assertEqual(merged.candidate_objectives, [])
        self.assertEqual(merged.field_provenance["candidateObjectives"], "unknown")

    def test_counted_facts_cannot_be_overwritten_by_the_model(self) -> None:
        merged = coerce_repo_dossier(
            {
                "size": {"files": 99999, "sourceFiles": 99999, "contexts": 77},
                "contexts": [{"name": "invented", "category": "ui", "fileCount": 4}],
                "declaredGates": ["npm run please"],
                "repo": {"rootPath": "/etc"},
                "source": "llm",
            },
            self.base,
        )
        self.assertEqual(merged.size, self.base.size)
        self.assertEqual([c.name for c in merged.contexts], [c.name for c in self.base.contexts])
        self.assertEqual(merged.declared_gates, self.base.declared_gates)
        self.assertEqual(merged.repo.root_path, self.base.repo.root_path)

    def test_a_hallucinated_hot_spot_path_is_dropped_with_its_rationale(self) -> None:
        base = self.base.model_copy(deep=True)
        base.hot_spots = [DossierFinding(ref="src/billing.ts", note="changed in 4 of the last 10 commit(s)")]
        merged = coerce_repo_dossier(
            {
                "hotSpots": [
                    {"ref": "src/billing.ts", "note": "pricing rules churn with every promo"},
                    {"ref": "src/does-not-exist.ts", "note": "this file does not exist"},
                ]
            },
            base,
        )
        refs = [f.ref for f in merged.hot_spots]
        self.assertEqual(refs, ["src/billing.ts"])
        # The counted fact is kept AND the model's reason is appended to it.
        self.assertIn("changed in 4", merged.hot_spots[0].note)
        self.assertIn("promo", merged.hot_spots[0].note)

    def test_an_invented_baseline_is_refused(self) -> None:
        merged = coerce_repo_dossier(
            {
                "candidateObjectives": [
                    {"kpiKey": "gate_pass_rate", "label": "Gate pass rate", "baseline": "unknown",
                     "target": 0.95, "unit": "ratio", "direction": "gte", "windowDays": 30},
                    {"kpiKey": "p95_latency", "label": "p95", "baseline": 120, "target": None,
                     "unit": "ms", "direction": "lte", "windowDays": 14},
                    {"label": "no key at all", "baseline": None},
                ]
            },
            self.base,
        )
        keys = [o.kpi_key for o in merged.candidate_objectives]
        self.assertEqual(keys, ["gate_pass_rate", "p95_latency"])  # the keyless entry is dropped
        self.assertIsNone(merged.candidate_objectives[0].baseline, "a string baseline is not a reading")
        self.assertEqual(merged.candidate_objectives[1].baseline, 120.0)
        self.assertIsNone(merged.candidate_objectives[1].target, "an unset target stays unset")
        self.assertEqual(merged.field_provenance["candidateObjectives"], "llm")

    def test_a_non_object_answer_keeps_the_heuristic_dossier(self) -> None:
        for junk in ("not json", ["a", "list"], 42, None):
            merged = coerce_repo_dossier(junk, self.base)
            self.assertEqual(merged.source, SOURCE_HEURISTIC)
            self.assertEqual(merged.model_dump(by_alias=True), self.base.model_dump(by_alias=True))

    def test_the_prompt_carries_the_grounding_and_the_baseline_rule(self) -> None:
        prompt = build_prompt(self.base, {"CLAUDE.md": "run typecheck"})
        self.assertIn("npm run typecheck", prompt)  # the walk's facts are in the prompt
        self.assertIn("baseline", prompt)
        self.assertIn("MUST be null", prompt)
        self.assertIn("do not invent paths", prompt)


class ReadOnlyAccessTest(unittest.TestCase):
    """The scanned repo must not be writable by the agent reading it."""

    def _provider(self) -> ClaudeCliProvider:
        # `command` is an absolute-looking path so `_executable()` resolves without
        # requiring the CLI to be installed in the test environment.
        return ClaudeCliProvider(command=__file__)

    def test_repo_bound_argv_is_read_only(self) -> None:
        bound = self._provider().with_repo_access("/repo")
        args = bound.cli_args()
        self.assertIn("--permission-mode", args)
        self.assertEqual(args[args.index("--permission-mode") + 1], READ_ONLY_PERMISSION_MODE)

        allowed = args[args.index("--allowedTools") + 1]
        self.assertEqual(allowed, ",".join(READ_ONLY_TOOLS))
        # One comma-joined argument, so the variadic flag cannot eat the next one.
        self.assertEqual(args[args.index("--allowedTools") + 2], "--disallowedTools")

        denied = args[args.index("--disallowedTools") + 1]
        for tool in WRITE_TOOL_DENYLIST:
            self.assertIn(tool, denied)
        for tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
            self.assertNotIn(tool, allowed.split(","))
        self.assertEqual(bound.cwd, "/repo")

    def test_binding_a_repo_does_not_mutate_the_shared_provider(self) -> None:
        provider = self._provider()
        provider.with_repo_access("/repo")
        self.assertIsNone(provider.cwd)
        self.assertIsNone(provider.allowed_tools)
        self.assertIsNone(provider.permission_mode)

    def test_a_write_tool_is_refused_rather_than_granted(self) -> None:
        with self.assertRaises(ValueError):
            self._provider().with_repo_access("/repo", allowed_tools=("Read", "Write"))
        with self.assertRaises(ValueError):
            self._provider().with_repo_access("/repo", allowed_tools=("Read", "Bash"))

    def test_an_unknown_permission_mode_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            ClaudeCliProvider(command=__file__, permission_mode="yolo")

    def test_a_plain_provider_carries_no_repo_flags(self) -> None:
        args = self._provider().cli_args()
        self.assertNotIn("--permission-mode", args)
        self.assertNotIn("--allowedTools", args)
        self.assertNotIn("--disallowedTools", args)


class KpSelfScanTest(unittest.TestCase):
    """The concept's own acceptance check for P2: the dossier of kp must agree
    with kp's declared context map. This is the test that would catch a walker
    that silently stopped reading the map (or started counting the wrong thing)."""

    def test_context_count_matches_context_map_json(self) -> None:
        context_map = REPO_ROOT / "context-map.json"
        if not context_map.is_file():
            self.skipTest("context-map.json is not present in this checkout")
        declared = json.loads(context_map.read_text(encoding="utf-8"))["contexts"]
        dossier = build_heuristic_dossier(REPO_ROOT, generated_at="2026-01-01T00:00:00+00:00")
        self.assertEqual(dossier.size.contexts, len(declared))
        self.assertEqual(len(dossier.contexts), len(declared))
        # And the gates kp declares about itself are the ones AGENTS.md tells an
        # agent to run — including the two written verb-last.
        for gate in (
            "npm run typecheck",
            "npm run lint",
            "npm run test:unit",
            "npm run test:python:gate",
            "npm run design:check",
            "npm run i18n:check",
            "npm run build",
        ):
            self.assertIn(gate, dossier.declared_gates)


class FallbackClassificationTest(unittest.TestCase):
    """The fallback reason is a diagnostic; the CLASS is what the panel renders.

    ``classify_fallback`` is the SINGLE definition of that closed vocabulary — the
    TS mirror in app/_lib/repo-scan-run.ts is checked against this tuple by a
    node:test that reads this file. The cases below are the real reason lines
    ``devcase.provenance.describe_fallback`` produces for each way the in-repo
    agent can fail, so a rewording of one of those messages fails here rather
    than silently collapsing a nameable failure into "unknown".
    """

    # VERBATIM from claude_cli.py's raise sites, prefixed the way
    # describe_fallback prefixes them ("<ExceptionType>: <message>"). Copied
    # rather than imported on purpose: if one of those messages is reworded, this
    # test is the thing that notices, instead of a nameable failure quietly
    # becoming "provider_error" on the operator's screen.
    CASES = (
        ("ClaudeCliError: Claude CLI not found (command='claude'). Is it installed and on PATH?", "agent_not_installed"),
        ("ClaudeCliError: Claude CLI timed out after 300s", "agent_timeout"),
        ("ClaudeCliError: Claude did not return parseable JSON: '{oops'", "agent_unparseable"),
        ("ClaudeCliError: Claude CLI produced no output (exit 1).", "agent_unparseable"),
        ("ClaudeCliError: Claude CLI output was not JSON: 'hello'", "agent_unparseable"),
        ("ClaudeCliError: Unexpected CLI envelope type: list", "agent_unparseable"),
        ("ClaudeCliError: Claude CLI stdout exceeded the 8000000 byte cap (runaway output; a normal envelope is kilobytes)", "agent_output_too_large"),
        ("ClaudeCliError: Claude CLI returned an error (subtype=error_max_turns): unknown", "agent_refused"),
    )

    def test_every_named_failure_gets_its_own_class(self) -> None:
        for reason, expected in self.CASES:
            with self.subTest(reason=reason):
                self.assertEqual(classify_fallback(reason), expected)

    def test_an_unrecognised_reason_is_a_provider_error_not_a_lie(self) -> None:
        # Something happened and it came from the provider call — say that much
        # rather than claiming a class the message does not support.
        self.assertEqual(classify_fallback("ValueError: the model answered in Klingon"), "provider_error")

    def test_no_reason_at_all_is_unknown(self) -> None:
        self.assertEqual(classify_fallback(None), "unknown")
        self.assertEqual(classify_fallback(""), "unknown")

    def test_classification_is_case_insensitive(self) -> None:
        self.assertEqual(classify_fallback("TimeoutError: The CLI TIMED OUT"), "agent_timeout")

    def test_every_result_is_inside_the_declared_vocabulary(self) -> None:
        # The UI renders `scan.fellBack<Class>` keys built from this tuple; a class
        # outside it is a key that does not exist in any of the four catalogs.
        for reason, _ in self.CASES:
            self.assertIn(classify_fallback(reason), FALLBACK_CLASSES)
        for odd in (None, "", "boom", "Exception: ", "not found"):
            self.assertIn(classify_fallback(odd), FALLBACK_CLASSES)


class SecretFileScopeTest(unittest.TestCase):
    """`.env` and friends are out of scope — for the model AND for the walk.

    Before this, only DIRECTORIES were skipped: the in-repo session was handed the
    repository root with Read/Grep/Glob and nothing stopped it opening `.env`,
    `*.pem` or `id_rsa`, and its free-text answers land verbatim in `dossier_json`
    and go out on the wire. The fence (CLI deny rules) and the floor (the walk
    never touching them) are pinned here; the redaction backstop is the next class.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "fixture"
        self.root.mkdir()
        _make_fixture_repo(self.root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_the_name_test_is_by_basename_and_case_insensitive(self) -> None:
        for name in (
            ".env",
            ".env.local",
            ".ENV",
            "deploy/server.pem",
            "deploy/id_rsa",
            "a/b/c/ID_ED25519",
            "x/.netrc",
            "config/credentials.json",
            "secrets.yml",
            "service-account-prod.json",
        ):
            with self.subTest(name=name):
                self.assertTrue(is_secret_file(name), name)
        for name in ("README.md", "src/billing.ts", "environment.ts", "keyboard.tsx", "package.json"):
            with self.subTest(name=name):
                self.assertFalse(is_secret_file(name), name)

    def test_the_walk_never_counts_a_secret_file(self) -> None:
        # Counting is not innocent: the EXTENSION feeds the stack line, so a
        # counted `*.pem` publishes "this repo keeps private keys" by another door.
        total, by_ext = walk_files(self.root)
        self.assertNotIn(".pem", by_ext)
        self.assertNotIn(".key", by_ext)
        dossier = build_heuristic_dossier(self.root, generated_at="2026-01-01T00:00:00+00:00")
        blob = json.dumps(dossier.model_dump(by_alias=True), ensure_ascii=False)
        for forbidden in (".env", "server.pem", "id_rsa", "AKIAIOSFODNN7EXAMPLE", "hunter2", "sk-livekey"):
            self.assertNotIn(forbidden, blob, f"{forbidden} reached the dossier")
        # NON-VACUITY: the walk still found the repo it was pointed at.
        self.assertGreater(total, 5)
        self.assertIn(".ts", by_ext)

    def test_a_committed_secret_never_becomes_a_hot_spot(self) -> None:
        # git history is the one door the filesystem walk does not guard: a
        # committed `.env` churns like any other file.
        if subprocess.run(["git", "--version"], capture_output=True).returncode != 0:
            self.skipTest("git is not available")
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "T",
            "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "T",
            "GIT_COMMITTER_EMAIL": "t@example.com",
        }
        for args in (["init", "-q"], ["add", "-A", "-f"], ["commit", "-q", "-m", "seed"]):
            subprocess.run(["git", *args], cwd=self.root, env=env, capture_output=True, check=False)
        ranked, commits, _authors = read_churn(self.root, depth=50)
        if commits == 0:
            self.skipTest("the fixture commit did not take in this environment")
        paths = [p for p, _ in ranked]
        self.assertTrue(paths, "the churn read found no paths at all")
        for path in paths:
            self.assertFalse(is_secret_file(path), f"{path} was published as a hot spot")

    def test_the_deny_rules_cover_every_glob_at_the_root_and_below(self) -> None:
        rules = claude_deny_rules()
        for pattern in SECRET_FILE_GLOBS:
            self.assertIn(f"Read(./{pattern})", rules)
            self.assertIn(f"Read(./**/{pattern})", rules)
        # Read rules ONLY: the CLI (v2.1.258) refuses to match Grep/Glob path rules
        # and says so on stderr, and a Read rule already covers every file-reading
        # tool. Emitting the others would add a warning line to every scan.
        for rule in rules:
            self.assertTrue(rule.startswith("Read("), rule)

    def test_the_settings_payload_only_ever_takes_access_away(self) -> None:
        payload = json.loads(repo_scan_settings_json())
        self.assertEqual(set(payload), {"permissions"})
        self.assertEqual(set(payload["permissions"]), {"deny"})
        self.assertIn("Read(./.env)", payload["permissions"]["deny"])

    def test_a_repo_bound_provider_carries_the_deny_rules(self) -> None:
        provider = ClaudeCliProvider(command=__file__)
        bound = bind_provider_to_repo(provider, "/repo")
        args = bound.cli_args()
        self.assertIn("--settings", args)
        deny = json.loads(args[args.index("--settings") + 1])["permissions"]["deny"]
        self.assertIn("Read(./.env)", deny)
        self.assertIn("Read(./**/*.pem)", deny)
        # The read-only stance is still the one with_repo_access validated.
        self.assertEqual(args[args.index("--permission-mode") + 1], READ_ONLY_PERMISSION_MODE)
        # ...and the shared provider did not inherit any of it.
        self.assertEqual(provider.extra_args, ())


class RedactionTest(unittest.TestCase):
    """The backstop. The deny rules are a fence with assumptions in them (a flag, a
    rule grammar, a CLI version), and every non-Claude adapter has no fence at all,
    so every refined free-text field is swept for secret-SHAPED values on the way
    out. Narrow on purpose: the negatives below must survive untouched."""

    POSITIVES = (
        ("AKIAIOSFODNN7EXAMPLE", "an AWS access key id"),
        ("aws key AKIAIOSFODNN7EXAMPLE in config", "embedded in a sentence"),
        ("-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----", "a PEM block"),
        ("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz", "an assignment with a keyspace"),
        ("sk-abcdefghijklmnopqrstuvwxyz012345", "a provider key on its own"),
        ("ghp_abcdefghijklmnopqrstuvwxyz0123", "a GitHub token"),
        ("DB_PASSWORD: correcthorsebatterystapler", "a colon assignment"),
    )

    NEGATIVES = (
        "https://github.com/acme/widget/blob/main/src/pay.ts",
        "deadbeefcafebabe1234567890abcdef12345678",
        "The billing module is the riskiest area: three owners, no tests.",
        "app/_lib/db/core.ts",
        "npm run test:unit",
        "KEY=short",
        "Set OPENAI_API_KEY in your environment before running.",
    )

    def test_every_secret_shape_is_masked_and_counted(self) -> None:
        for text, why in self.POSITIVES:
            with self.subTest(why=why):
                masked, hits = redact_secret_values(text)
                self.assertGreaterEqual(hits, 1, why)
                self.assertIn(REDACTED, masked)
                # The secret itself is gone, not merely annotated.
                for token in (
                    "AKIAIOSFODNN7EXAMPLE",
                    "MIIEow",
                    "sk-abcdefghij",
                    "ghp_abcdefghij",
                    "correcthorsebatterystapler",
                ):
                    if token in text:
                        self.assertNotIn(token, masked)

    def test_ordinary_text_survives_untouched(self) -> None:
        for text in self.NEGATIVES:
            with self.subTest(text=text):
                masked, hits = redact_secret_values(text)
                self.assertEqual(hits, 0, text)
                self.assertEqual(masked, text)

    def test_the_sweep_reaches_every_free_text_field_and_returns_the_count(self) -> None:
        dossier = {
            "maintainerLoadEstimate": "one maintainer; deploy key AKIAIOSFODNN7EXAMPLE is shared",
            "riskAreas": [{"ref": "src/pay.ts", "rationale": "hardcoded sk-abcdefghijklmnopqrstuvwxyz"}],
            "hotSpots": [{"ref": "src/billing.ts", "rationale": "changes weekly"}],
            "candidateObjectives": [
                {"label": "cut GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0 usage", "rationale": None}
            ],
            "existingKpis": ["src/analytics/kpi.ts", "note: DB_PASSWORD=correcthorsebatterystapler"],
            "contexts": [{"name": "billing"}],
        }
        hits = redact_dossier(dossier)
        self.assertEqual(hits, 4)
        blob = json.dumps(dossier, ensure_ascii=False)
        for token in ("AKIAIOSFODNN7EXAMPLE", "sk-abcdefghij", "ghp_abcdefghij", "correcthorsebatterystapler"):
            self.assertNotIn(token, blob)
        # Untouched fields stay byte-identical; a sweep must not rewrite the dossier.
        self.assertEqual(dossier["hotSpots"][0]["rationale"], "changes weekly")
        self.assertEqual(dossier["contexts"], [{"name": "billing"}])

    def test_a_clean_dossier_reports_zero_and_is_unchanged(self) -> None:
        clean = {
            "maintainerLoadEstimate": "two maintainers, steady cadence",
            "riskAreas": [{"ref": "src/pay.ts", "rationale": "no tests"}],
            "hotSpots": [],
            "candidateObjectives": [],
            "existingKpis": ["src/analytics/kpi.ts"],
        }
        before = json.dumps(clean, sort_keys=True)
        self.assertEqual(redact_dossier(clean), 0)
        self.assertEqual(json.dumps(clean, sort_keys=True), before)

    def test_a_non_dossier_is_survived_not_raised_on(self) -> None:
        for odd in (None, [], "text", 7):
            self.assertEqual(redact_dossier(odd), 0)

if __name__ == "__main__":
    unittest.main()

"""Headless Claude Code CLI as a batch LLM engine for dev / test workloads.

Runs ``claude -p --output-format json`` as a subprocess and returns the
assistant's final text from the ``result`` field. With ``ANTHROPIC_API_KEY``
unset the CLI executes under the user's Claude subscription (Pro/Max) rather
than metered API billing, which makes it the cheap engine for *mass* jobs:
preparing synthetic test data, bulk fixture generation, and large eval sweeps.

This is intentionally separate from ``gemini.py``. The production
single-analysis path stays on Gemini (multimodal CV bytes, grounding); this
provider is a text-in/text-out batch tool for offline data prep and quality
iteration, where running hundreds of calls on the subscription beats paying
per token.

Usage::

    from pipeline.jobfit.claude_cli import ClaudeCliProvider

    claude = ClaudeCliProvider()
    if claude.available():
        text = claude.complete("Write a one-line Czech junior-dev job ad.").text
        ad = claude.complete_json("Return JSON {title, must_have:[...]} for ...")
        results = claude.map([p1, p2, p3])  # concurrent, subscription-billed
"""

from __future__ import annotations

import copy
import json
import os
import re
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Sequence

# Keys we strip from the child environment so the CLI uses the subscription
# (interactive auth) instead of falling back to metered API billing.
_API_KEY_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")

# Vendor session-nesting markers, stripped UNCONDITIONALLY (session hygiene is
# not a billing choice, so this is not gated on strip_api_key): kp batch runs
# are routinely launched from inside an agent session, and these riding into
# the child make it start as a nested invocation instead of a fresh top-level
# session. CLAUDE_CODE_SIMPLE is the worst leak of the set — it is what
# `--bare` sets, and an inherited value would flip the child into bare mode's
# API-key-only auth, silently defeating the seat selection above.
# List verified against CLI 2.1.245 on 2026-08-25.
_SESSION_MARKER_ENV = (
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_SIMPLE",
)

DEFAULT_TIMEOUT_S = 180

# Hard cap on the captured stdout (mirrors the 4 MB runaway-subprocess cap the
# sibling ascent transport uses). A normal envelope is kilobytes; anything near
# this size is a runaway child, and an unbounded capture is host memory spent
# before the parser ever sees a byte. NOTE the honest limit of this
# implementation: subprocess.run buffers the whole stream before returning, so
# the cap bounds what kp retains and parses, not the child's peak accumulation
# — kill-on-breach would require replacing the run seam with a Popen read
# loop, which the mocked-subprocess test harness and the timeout handling both
# pin; recorded as accepted residue in .ai/registry-conformance.md.
MAX_STDOUT_BYTES = 4 * 1024 * 1024

# --------------------------------------------------------------------------- #
# The mode seam — a closed vocabulary, not constructor-kwarg assembly
# --------------------------------------------------------------------------- #
#
# Every provider instance is in exactly ONE mode, chosen at construction:
#
#   generate   text-in/text-out batch work (fixtures, evals, drafts). The child
#              runs in a NEUTRAL temp cwd so it loads no ambient project
#              instructions — spawned from kp's repo root, `claude -p` would
#              otherwise fold kp's own CLAUDE.md into every batch prompt,
#              contaminating and taxing it. No tool grants, no permission mode.
#   repo_scan  the read-only repository dossier scan. Entered ONLY through
#              :meth:`ClaudeCliProvider.with_repo_access`, which owns the
#              read-only stance validation (allowlist/denylist/plan mode).
#
# These are separate seams on purpose: folding them into kwargs made
# "which mode am I in?" a bug that type-checks (a caller could pair
# `permission_mode="acceptEdits"` with a repo cwd and bypass the validation).
MODES = ("generate", "repo_scan")

_NEUTRAL_CWD: str | None = None


def _neutral_cwd() -> str:
    """A per-process empty temp directory the `generate` child runs in.

    Neutrality is the point: no CLAUDE.md above it that the CLI would
    auto-discover, no project settings, no accidental repo access via relative
    paths. Created lazily, reused for the process lifetime (it stays empty, so
    leaking it to the OS temp cleaner is fine)."""
    global _NEUTRAL_CWD
    if _NEUTRAL_CWD is None or not os.path.isdir(_NEUTRAL_CWD):
        _NEUTRAL_CWD = tempfile.mkdtemp(prefix="kp-claude-neutral-")
    return _NEUTRAL_CWD

# --------------------------------------------------------------------------- #
# Running the CLI *inside* somebody else's repository (app-master repo_scan, P2)
# --------------------------------------------------------------------------- #
#
# The repo dossier is worth having only if the agent actually reads the repo, and
# that is exactly the moment the tool becomes dangerous: kp is pointed at a
# checkout the operator owns, on the operator's own box, and a scan that could
# WRITE there would be a scanning tool that edits your codebase. So read-only is
# a hard requirement enforced three ways at once — an allowlist, a denylist, and
# `--permission-mode plan` (which refuses edits at the session level) — rather
# than by trusting the prompt to ask nicely.
#
# Flags verified against `claude --help` on 2026-08-23:
#   --allowedTools <tools...>       comma- or space-separated; passed as ONE
#                                   comma-joined argument so the variadic option
#                                   cannot swallow the flags that follow it
#   --disallowedTools <tools...>    same grammar; deny wins over allow
#   --permission-mode <mode>        acceptEdits | auto | bypassPermissions |
#                                   manual | dontAsk | plan
# `--add-dir` is deliberately NOT used: the scan is confined to `cwd`.

PERMISSION_MODES = ("acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")

# The only mode this module will pair with a repo binding. `plan` is the CLI's
# own read-only session mode; every other choice can author a file.
READ_ONLY_PERMISSION_MODE = "plan"

# What a repo scan may do: read files, search them, and read git HISTORY. Note the
# git entries are scoped (`git log:*` / `git diff:*` / `git show:*`), never a bare
# `Bash` — a bare Bash grant is a write grant with extra steps.
READ_ONLY_TOOLS: tuple[str, ...] = (
    "Read",
    "Grep",
    "Glob",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git show:*)",
)

# Belt and braces: even if a future edit widens the allowlist, these can never be
# granted on a repo-bound session (deny takes precedence in the CLI).
WRITE_TOOL_DENYLIST: tuple[str, ...] = (
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "WebFetch",
)


def _tool_head(tool: str) -> str:
    """`Bash(git log:*)` -> `Bash`; `Read` -> `Read`. The comparable identity."""
    return tool.split("(", 1)[0].strip()


def _validated_permission_mode(mode: str | None) -> str | None:
    """Refuse a mode the installed CLI does not have.

    An unknown value would be passed straight through to `--permission-mode` and
    the CLI would exit on an argument error — an engine fault the caller would
    read as "the model failed", which is the wrong diagnosis entirely.
    """
    if mode is None:
        return None
    if mode not in PERMISSION_MODES:
        raise ValueError(
            f"unknown Claude CLI permission mode {mode!r} (known: {', '.join(PERMISSION_MODES)})"
        )
    return mode


class ClaudeCliError(RuntimeError):
    """Raised when the CLI is missing, times out, errors, or returns junk."""

    def __init__(self, message: str, *, stderr: str = "", subtype: str | None = None):
        super().__init__(message)
        self.stderr = stderr
        self.subtype = subtype


# Probe statuses — a closed vocabulary, three-valued at minimum (registry
# availability-probe: install and authorization fail differently and are
# repaired differently; `unknown` renders as unknown, never as a neighbor).
PROBE_READY = "ready"
PROBE_UNAUTHED = "installed_unauthed"
PROBE_NOT_INSTALLED = "not_installed"
PROBE_POLICY_FORBIDDEN = "policy_forbidden"
PROBE_UNKNOWN = "unknown"

# `claude --version` prints e.g. "2.1.245 (Claude Code)"; parse leniently,
# keep only the semantic version.
_VERSION_RE = re.compile(r"(\d+\.\d+\.\d+)")
_VERSION_CACHE: dict[str, str | None] = {}


def _cli_version(executable: str, *, timeout: int = 15) -> str | None:
    """The installed CLI's semantic version, or None when undeterminable.

    Cached per resolved executable for the process lifetime — the binary does
    not change mid-run, and the probe should stay cheap enough to run before
    every batch. Flag verified against `claude --help` on 2026-08-25
    (CLI 2.1.245): `-v, --version  Output the version number`.
    """
    if executable in _VERSION_CACHE:
        return _VERSION_CACHE[executable]
    version: str | None = None
    try:
        completed = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
        )
        match = _VERSION_RE.search(completed.stdout or "")
        version = match.group(1) if match else None
    except Exception:
        version = None
    _VERSION_CACHE[executable] = version
    return version


@dataclass(frozen=True)
class ClaudeCliProbe:
    """One :meth:`ClaudeCliProvider.probe` answer — a record, not a boolean.

    ``status`` is the headline (one of the ``PROBE_*`` values); the rest is the
    capability data behind it. ``detail`` carries a bounded diagnostic prefix
    when the answer is not ``ready`` (a login prompt, a policy veto, raw output
    that failed to parse) — the repair differs per cause, so the cause travels.
    """

    status: str
    installed: bool
    path: str | None = None
    version: str | None = None
    auth_method: str | None = None
    subscription_type: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class ClaudeResult:
    """One ``claude -p`` invocation: the answer text plus the envelope metadata."""

    text: str
    raw: dict[str, Any] = field(default_factory=dict)
    cost_usd: float = 0.0
    duration_ms: int = 0
    num_turns: int = 0
    session_id: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)

    def json(self) -> Any:
        """Parse ``text`` as JSON (tolerates markdown fences / surrounding prose)."""
        return _extract_json(self.text)


class ClaudeCliProvider:
    """Thin wrapper around the headless ``claude`` CLI.

    Parameters
    ----------
    command:
        Executable name or path. Defaults to ``"claude"`` (resolved on PATH).
    model:
        Optional ``--model`` value (e.g. ``"sonnet"``, ``"haiku"``). ``None``
        uses the CLI's configured default.
    timeout:
        Per-call wall-clock budget in seconds.
    strip_api_key:
        When True (default) remove ``ANTHROPIC_API_KEY`` / ``ANTHROPIC_AUTH_TOKEN``
        from the child env so the call runs on the subscription, not the API.
    extra_args:
        Extra CLI flags appended verbatim (escape hatch for power users).
    mode:
        One of :data:`MODES`. ``"generate"`` (default) is the neutral
        text-in/text-out batch seam — the child runs in an empty temp cwd with
        no tool grants. ``"repo_scan"`` is entered via
        :meth:`with_repo_access`, which owns the read-only stance; the
        stance kwargs (``cwd`` / ``allowed_tools`` / ``disallowed_tools`` /
        ``permission_mode``) are refused on a directly-constructed provider so
        the modes cannot be re-assembled from kwargs.
    """

    def __init__(
        self,
        *,
        command: str = "claude",
        model: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        strip_api_key: bool = True,
        extra_args: Sequence[str] = (),
        mode: str = "generate",
        cwd: str | None = None,
        allowed_tools: Sequence[str] | None = None,
        disallowed_tools: Sequence[str] | None = None,
        permission_mode: str | None = None,
    ) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown Claude CLI mode {mode!r} (known: {', '.join(MODES)})")
        if mode == "repo_scan":
            raise ValueError(
                "repo_scan mode has one door: with_repo_access(cwd) — it validates "
                "the read-only stance; constructing it directly would skip that"
            )
        # Vocabulary check first so an unknown mode string still gets the
        # informative error, then the seam check: stance kwargs belong to
        # `repo_scan`, whose ONLY door is with_repo_access (it validates the
        # read-only triple). Accepting them here would let a caller pair e.g.
        # permission_mode="acceptEdits" with a repo cwd, bypassing the door.
        _validated_permission_mode(permission_mode)
        stance_kwargs = {
            "cwd": cwd,
            "allowed_tools": allowed_tools,
            "disallowed_tools": disallowed_tools,
            "permission_mode": permission_mode,
        }
        offered = sorted(k for k, v in stance_kwargs.items() if v is not None)
        if offered:
            raise ValueError(
                "ClaudeCliProvider refuses stance kwargs at construction "
                f"({', '.join(offered)}): repo access goes through with_repo_access(), "
                "which validates the read-only triple; generate mode runs in a "
                "neutral cwd with no grants by design"
            )
        self.command = command
        self.model = model
        self.timeout = timeout
        self.strip_api_key = strip_api_key
        self.extra_args = tuple(extra_args)
        self.mode = mode
        self.cwd: str | None = None
        self.allowed_tools: tuple[str, ...] | None = None
        self.disallowed_tools: tuple[str, ...] | None = None
        self.permission_mode: str | None = None

    # -- repo binding -------------------------------------------------------

    def with_repo_access(
        self,
        cwd: str,
        *,
        allowed_tools: Sequence[str] = READ_ONLY_TOOLS,
        timeout: int | None = None,
    ) -> "ClaudeCliProvider":
        """A COPY of this provider bound to ``cwd``, read-only.

        Returns a copy rather than mutating in place so a provider handed out by
        the registry (``MonitoredClaudeCli``, which subclasses this) keeps its
        telemetry identity while one call site borrows it for a repo scan — and
        so no other caller inherits a repo binding it never asked for.

        The read-only guarantee is not advisory: the allowlist is intersected
        with nothing (it is taken as given) but is *validated* against
        :data:`WRITE_TOOL_DENYLIST`, the denylist is always applied, and the
        session runs in :data:`READ_ONLY_PERMISSION_MODE`. Ask for a write tool
        and this raises instead of quietly granting it.
        """
        offending = sorted({t for t in allowed_tools if _tool_head(t) in WRITE_TOOL_DENYLIST})
        if offending:
            raise ValueError(
                "with_repo_access refuses write-capable tools on a scanned repo: "
                + ", ".join(offending)
            )
        # A BARE `Bash` grant is a write grant with extra steps (`Bash` alone
        # permits `rm`, `>file`, `git commit`). Scoped forms are fine.
        bare_bash = [t for t in allowed_tools if t.strip() == "Bash"]
        if bare_bash:
            raise ValueError(
                "with_repo_access refuses an unscoped Bash grant — use a scoped form "
                'like "Bash(git log:*)"'
            )
        clone = copy.copy(self)
        clone.mode = "repo_scan"
        clone.cwd = cwd
        clone.allowed_tools = tuple(allowed_tools)
        clone.disallowed_tools = WRITE_TOOL_DENYLIST
        clone.permission_mode = READ_ONLY_PERMISSION_MODE
        if timeout is not None:
            clone.timeout = timeout
        return clone

    def cli_args(self) -> list[str]:
        """The argv this provider would run (executable resolved). Exported so the
        read-only contract is assertable without spawning a subprocess."""
        args = [self._executable(), "-p", "--output-format", "json"]
        if self.mode == "generate":
            # User-config isolation: the operator's own hooks can print AFTER
            # the envelope on stdout and break the strict whole-string parse.
            # `--setting-sources project` loads only project-level settings —
            # and generate's neutral temp cwd has none, so the child runs with
            # no user hooks/settings noise at all. Verified live 2026-08-25
            # against CLI 2.1.245 (seat auth intact: authMethod claude.ai,
            # firstParty). `--bare` was deliberately REJECTED for this job:
            # its help states auth becomes "strictly ANTHROPIC_API_KEY or
            # apiKeyHelper" — the exact billing flip the env strip exists to
            # prevent. repo_scan keeps default sources (behavior parity).
            args += ["--setting-sources", "project"]
        if self.model:
            args += ["--model", self.model]
        if self.permission_mode:
            args += ["--permission-mode", self.permission_mode]
        # ONE comma-joined argument per list: `--allowedTools` is variadic, so
        # separate items would let it swallow the following flag.
        if self.allowed_tools:
            args += ["--allowedTools", ",".join(self.allowed_tools)]
        if self.disallowed_tools:
            args += ["--disallowedTools", ",".join(self.disallowed_tools)]
        args += list(self.extra_args)
        return args

    # -- discovery ----------------------------------------------------------

    def available(self) -> bool:
        """True if the CLI is resolvable on PATH (or ``command`` is an abs path).

        Refuses under KP_OFFLINE: the CLI reaches Anthropic's cloud via a subprocess
        (not ``fetch``, so the TS egress guard can't see it), so the no-egress flag
        must block it here → the caller falls back to deterministic (offline.py)."""
        from .llm.offline import is_offline

        if is_offline():
            return False
        return shutil.which(self.command) is not None or os.path.isfile(self.command)

    def probe(self, *, timeout: int = 15) -> ClaudeCliProbe:
        """Install + authorization probe, proven WITHOUT spending tokens.

        :meth:`available` answers "is the binary reachable" (cheap, no
        subprocess); a logged-out CLI still passes it and fails only on the
        first paid call. This probe closes that gap using the CLI's own
        auth-status command — verified live on 2026-08-25 against CLI 2.1.245:
        ``claude auth status --json`` is a local check printing
        ``{"loggedIn": bool, "authMethod": ..., "subscriptionType": ...}``,
        exits without any model call, and spends no tokens.

        The KP_OFFLINE policy veto comes FIRST, before any filesystem lookup,
        and names itself (``policy_forbidden``) — a policy refusal repaired as
        "install the binary" is the wrong fix twice over. Auth state that
        cannot be determined (old CLI without the subcommand, junk output) is
        ``unknown`` — never inferred ready, never inferred unauthed.
        """
        from .llm.offline import is_offline

        if is_offline():
            return ClaudeCliProbe(
                status=PROBE_POLICY_FORBIDDEN,
                installed=False,
                detail="KP_OFFLINE forbids cloud egress; the CLI reaches Anthropic's cloud",
            )
        resolved = shutil.which(self.command) or (
            self.command if os.path.isfile(self.command) else None
        )
        if not resolved:
            return ClaudeCliProbe(status=PROBE_NOT_INSTALLED, installed=False)

        version = _cli_version(resolved, timeout=timeout)
        try:
            completed = subprocess.run(
                [resolved, "auth", "status", "--json"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                env=self._child_env(),  # same env the real run gets: seat, not key
                timeout=timeout,
            )
        except Exception as exc:
            return ClaudeCliProbe(
                status=PROBE_UNKNOWN,
                installed=True,
                path=resolved,
                version=version,
                detail=f"auth status probe failed: {type(exc).__name__}: {exc}"[:300],
            )

        try:
            payload = json.loads((completed.stdout or "").strip())
            logged_in = payload.get("loggedIn")
        except (json.JSONDecodeError, AttributeError):
            payload, logged_in = {}, None
        if not isinstance(logged_in, bool):
            # Junk / missing field / pre-`auth status` CLI: unknown stays unknown.
            raw = (completed.stdout or completed.stderr or "").strip()
            return ClaudeCliProbe(
                status=PROBE_UNKNOWN,
                installed=True,
                path=resolved,
                version=version,
                detail=f"unrecognized auth status output: {raw[:200]!r}",
            )
        return ClaudeCliProbe(
            status=PROBE_READY if logged_in else PROBE_UNAUTHED,
            installed=True,
            path=resolved,
            version=version,
            auth_method=payload.get("authMethod"),
            subscription_type=payload.get("subscriptionType"),
            detail=None if logged_in else "CLI installed but not logged in (run: claude login)",
        )

    def _executable(self) -> str:
        """Resolve ``command`` to a launchable path.

        On Windows the npm-installed ``claude`` is a ``.CMD`` shim; passing the
        bare name to ``subprocess.run`` fails because ``CreateProcess`` does not
        apply ``PATHEXT``. ``shutil.which`` does, so we resolve first and invoke
        the absolute path. The prompt goes over stdin (never argv), so the
        ``.cmd`` quoting hazards don't apply.
        """
        resolved = shutil.which(self.command)
        if resolved:
            return resolved
        if os.path.isfile(self.command):
            return self.command
        raise ClaudeCliError(
            f"Claude CLI not found (command={self.command!r}). Is it installed and on PATH?"
        )

    # -- single call --------------------------------------------------------

    def complete(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
    ) -> ClaudeResult:
        """Run one prompt and return the parsed :class:`ClaudeResult`.

        ``system`` is prepended to the prompt as a delimited preamble (robust
        across CLI versions; no dependency on a specific system-prompt flag).
        """
        if not prompt or not prompt.strip():
            raise ValueError("prompt must be non-empty")

        full_prompt = prompt
        if system and system.strip():
            full_prompt = f"<system>\n{system.strip()}\n</system>\n\n{prompt}"

        args = self.cli_args()

        try:
            completed = subprocess.run(
                args,
                input=full_prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                env=self._child_env(),
                cwd=self._spawn_cwd(),
                timeout=timeout or self.timeout,
            )
        except FileNotFoundError as exc:
            raise ClaudeCliError(
                f"Claude CLI not found (command={self.command!r}). Is it installed and on PATH?"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise ClaudeCliError(
                f"Claude CLI timed out after {timeout or self.timeout}s"
            ) from exc

        stdout = completed.stdout or ""
        if len(stdout.encode("utf-8", errors="ignore")) > MAX_STDOUT_BYTES:
            raise ClaudeCliError(
                f"Claude CLI stdout exceeded the {MAX_STDOUT_BYTES} byte cap "
                "(runaway output; a normal envelope is kilobytes)",
                stderr=(completed.stderr or "")[:2000],
            )
        return self._parse_envelope(stdout, completed.stderr or "", completed.returncode)

    # -- batch / mass execution --------------------------------------------

    def map(
        self,
        prompts: Sequence[str],
        *,
        system: str | None = None,
        max_workers: int = 4,
        return_exceptions: bool = True,
    ) -> list[ClaudeResult | ClaudeCliError]:
        """Run many prompts concurrently (one subprocess each); preserves order.

        Each call is an independent ``claude -p`` process, so this is I/O bound —
        a small thread pool gives real parallelism. With ``return_exceptions``
        (default) a failed item yields its :class:`ClaudeCliError` instead of
        aborting the whole batch, so a single bad prompt can't sink a sweep.
        """
        prompts = list(prompts)
        if not prompts:
            return []
        workers = max(1, min(max_workers, len(prompts)))

        def _one(p: str) -> ClaudeResult | ClaudeCliError:
            try:
                return self.complete(p, system=system)
            except ClaudeCliError as exc:
                if return_exceptions:
                    return exc
                raise
            except Exception as exc:
                # complete() can also raise a non-ClaudeCliError (e.g. ValueError on an
                # empty prompt). Without this, pool.map re-raises it and aborts the
                # WHOLE batch — sinking every other item's result, the opposite of the
                # "one bad prompt can't sink a sweep" guarantee above. Wrap it as a
                # ClaudeCliError so callers that skip those (run_judge) skip this too.
                if return_exceptions:
                    return ClaudeCliError(f"{type(exc).__name__}: {exc}")
                raise

        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(_one, prompts))

    # -- convenience --------------------------------------------------------

    def complete_json(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
        expected_keys: Sequence[str] | None = None,
    ) -> Any:
        """Run a prompt expected to return JSON and parse it (object or array).

        Appends a terse 'JSON only' instruction and extracts the last complete
        JSON value from the result, tolerating markdown fences or stray prose.
        Pass ``expected_keys`` when the schema is known to pin the answer object
        even if the model echoes an example object alongside it.
        """
        guarded = (
            f"{prompt}\n\n"
            "Respond with ONLY valid JSON — no markdown fences, no commentary."
        )
        result = self.complete(guarded, system=system, timeout=timeout)
        try:
            return _extract_json(result.text, expected_keys=expected_keys)
        except ValueError as exc:
            raise ClaudeCliError(
                f"Claude did not return parseable JSON: {result.text[:300]!r}"
            ) from exc

    # -- internals ----------------------------------------------------------

    def _spawn_cwd(self) -> str | None:
        """Where the child runs. ``repo_scan``: the bound repository (set by
        :meth:`with_repo_access`). ``generate``: a NEUTRAL empty temp dir —
        never the caller's cwd, so the CLI's CLAUDE.md auto-discovery finds
        nothing and batch prompts stay uncontaminated by kp's own agent
        instructions."""
        if self.mode == "repo_scan":
            return self.cwd
        return _neutral_cwd()

    def _child_env(self) -> dict[str, str]:
        # Strips applied AFTER env construction, at this single spawn door, so
        # nothing can re-introduce a stripped variable behind them.
        env = dict(os.environ)
        if self.strip_api_key:
            for key in _API_KEY_ENV:
                env.pop(key, None)
        for key in _SESSION_MARKER_ENV:  # always: the child is a fresh top-level session
            env.pop(key, None)
        return env

    def _parse_envelope(self, stdout: str, stderr: str, returncode: int) -> ClaudeResult:
        stdout = stdout.strip()
        if not stdout:
            raise ClaudeCliError(
                f"Claude CLI produced no output (exit {returncode}).", stderr=stderr
            )
        try:
            envelope = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise ClaudeCliError(
                f"Claude CLI output was not JSON: {stdout[:300]!r}", stderr=stderr
            ) from exc

        if not isinstance(envelope, dict):
            raise ClaudeCliError(f"Unexpected CLI envelope type: {type(envelope).__name__}")

        subtype = envelope.get("subtype")
        if envelope.get("is_error") or (subtype and subtype != "success"):
            raise ClaudeCliError(
                f"Claude CLI returned an error (subtype={subtype}): "
                f"{envelope.get('result') or envelope.get('error') or 'unknown'}",
                stderr=stderr,
                subtype=subtype,
            )

        text = str(envelope.get("result") or "")
        return ClaudeResult(
            text=text,
            raw=envelope,
            cost_usd=float(envelope.get("total_cost_usd") or 0.0),
            duration_ms=int(envelope.get("duration_ms") or 0),
            num_turns=int(envelope.get("num_turns") or 0),
            session_id=envelope.get("session_id"),
            usage=envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {},
        )


def _scan_json_values(text: str) -> list[Any]:
    """Every top-level JSON value embedded in ``text``, in order of appearance.

    Walks the string, and at each ``{``/``[`` attempts ``raw_decode``; on success
    it records the value and skips past it, on failure it advances one char. A
    nested ``{`` inside a decoded value is consumed as part of that value, so the
    list holds only *top-level* values (an array of objects is one entry).
    """
    decoder = json.JSONDecoder()
    values: list[Any] = []
    idx, n = 0, len(text)
    while idx < n:
        if text[idx] in "{[":
            try:
                value, end = decoder.raw_decode(text, idx)
                values.append(value)
                idx = end
                continue
            except json.JSONDecodeError:
                pass
        idx += 1
    return values


def _extract_json(text: str, *, expected_keys: Sequence[str] | None = None) -> Any:
    """Best-effort JSON extraction from an LLM text answer.

    Returns the LAST complete top-level JSON value (preferring a fenced ```json
    block when present). Returning the last value — not the first — is deliberate:
    few-shot prompts often make the model echo the example schema object before
    the real answer, and the old first-value behaviour silently returned that
    echo. When ``expected_keys`` is given, the last value carrying any of those
    keys wins, which pins the answer even if it isn't the trailing value.
    Raises ``ValueError`` if nothing parses.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")

    # Prefer fenced blocks (the model's deliberate answer envelope) if any parse.
    candidates: list[Any] = []
    for block in re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL):
        candidates.extend(_scan_json_values(block.strip()))
    if not candidates:
        candidates = _scan_json_values(text)
    if not candidates:
        raise ValueError("no JSON value found")

    if expected_keys:
        keyed = [v for v in candidates if isinstance(v, dict) and any(k in v for k in expected_keys)]
        if keyed:
            return keyed[-1]
    return candidates[-1]

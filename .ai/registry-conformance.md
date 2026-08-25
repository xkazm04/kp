# Registry conformance — software-engineering
contributor: kazda-dev-box · audited: 2026-08-25 · re-verified after hardening: 2026-08-25

Scope of this audit: subject `agent-cli-transport` (bundle digest
`sha256:f397e66be7bcad4f`) against context `py-llm-runtime` —
`pipeline/jobfit/claude_cli.py` plus its `pipeline/jobfit/llm/` wiring
(`monitor.py` MonitoredClaudeCli, `capabilities.py`, `registry.py`, `offline.py`).
Earlier verdicts (2026-08-23, three UI/recruiting pairs) live as pair states in
`.ai/registry-map.json`; this file holds the per-technique detail one map cell
cannot. The borrowed `spawn-contract` / `termination-and-reaping` techniques
were not judged here (subprocess-lifecycle is its own subject).

The R1–R6 deviations recorded in the first pass were implemented the same day
(commits `b249e220`, `bcf840f7`, `99b4fa81`, `5743d7fb`, `f22ff019`); the table
below is the post-hardening state, evidence lines against that tree.

| subject | technique | status | evidence |
|---|---|---|---|
| agent-cli-transport | (golden-path transport contract) | followed | Typed closed `mode` vocabulary (MODES, claude_cli.py:90) as separate seams, not one parameterized function: stance kwargs are refused at construction (:344-370) so `permission_mode="acceptEdits"` can no longer be paired with a repo cwd outside the door; `repo_scan` is constructible ONLY via `with_repo_access` (:346-350, :384-427), which validates the read-only triple and flips the mode (:421); `generate` spawns in a per-process empty temp cwd (`_spawn_cwd`:706-715, `_neutral_cwd`:95-105) so the CLI's CLAUDE.md auto-discovery finds nothing — pinned by a test asserting the spawn cwd is neutral, empty, and not the caller's (tests/test_claude_cli.py ModeSeamTest). |
| agent-cli-transport | availability-probe | followed | `probe()` (claude_cli.py:487-568) answers install and authorization separately, zero-token: `claude auth status --json` verified live 2026-08-25 against CLI 2.1.245, run under the same stripped child env the real spawn gets; result is a record (ClaudeCliProbe:268 — status/path/version/auth_method/subscription_type/detail) with a closed status vocabulary (:228-232) in which `unknown` renders as unknown, never a neighbor (:540-550); version captured leniently and cached per executable (`_cli_version`:240-263); the KP_OFFLINE policy veto comes first, before any filesystem lookup, and names itself `policy_forbidden` (:505-510). `available()` stays the cheap shared predicate (:478). |
| agent-cli-transport | subscription-auth-selection | followed | Billing-key strip at the single spawn door, applied after env construction (claude_cli.py:41, :716-726), default-on with metered an explicit constructor choice, test-pinned on the child's real env (tests/test_claude_cli.py ApiKeyEnvTest). Session-nesting hygiene now included: `_SESSION_MARKER_ENV` (:52-58 — CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SSE_PORT, CLAUDE_CODE_SIMPLE) popped unconditionally (:723-724), not gated on strip_api_key — an inherited CLAUDE_CODE_SIMPLE would flip the child into `--bare`'s API-key-only auth. Pinned by test_session_markers_stripped_unconditionally. |
| agent-cli-transport | output-normalization | followed | Single-result-object dialect parsed once (_parse_envelope, claude_cli.py:727-761); stderr kept separate and carried on errors; stdin fed and closed; envelope error state authoritative with subtype surfaced (:743-750); bounded raw prefix on unparseable output; empty output a named failure; last-value extraction with fenced-block preference and expected_keys pinning (`_extract_json`:788+). New: 4MB stdout cap (MAX_STDOUT_BYTES:70, enforced :626-632) — honest residue: subprocess.run buffers fully, so the cap bounds retention/parse, not the child's peak accumulation (kill-on-breach would replace the run seam with a Popen read loop; recorded, accepted); user-config isolation for generate via `--setting-sources project` (:435-443, verified live 2026-08-25, seat auth intact; `--bare` rejected because its help pins auth to ANTHROPIC_API_KEY — the billing flip the strip prevents). Remaining nice-to-have, not load-bearing: no rung telemetry on the extraction ladder. |
| agent-cli-transport | permission-stance-enforcement | followed | Unchanged three layers (`--permission-mode plan`, scoped allowlist with bare-Bash refusal, write-tool denylist where deny beats allow) behind one door (`with_repo_access`:384-427), now STRENGTHENED by the mode seam: the stance can no longer be assembled from constructor kwargs at all (:344-370), and mode vocabulary is validated pre-spawn (:341-345). Argv assertable without spawning (cli_args:428). |
| agent-cli-transport | dated-capability-matrix | followed | Flag rows carry dates and the version they were verified against (claude_cli.py:117-127, re-verified 2026-08-25 against `claude --help`), `VERIFIED_CLI_VERSION = "2.1.245"` (:139) names the pin, the comment names its own recomputation (:130-138), and drift is version-TRIGGERED at runtime: `_warn_on_version_drift` (:145-163) probes once per process (cached `--version` subprocess on the first real call, complete():608) and logs a warning pointing argument errors at the matrix rows first — log-only, never a failure, per the technique ("may keep serving on the old data, but the staleness is visible"). Feature capability gating unchanged (llm/capabilities.py). |
| agent-cli-transport | fallback-ladder | followed | Ladder unchanged (CLI seat → metered adapters → deterministic floor, ledger-recorded, `source` honest). Descent now carries its reason: `availability()` returns `(bool, reason)` with `offline_policy` distinguished from `not_installed` (claude_cli.py:459-477 — the voice modules' shape), the shared predicate `provider_availability` covers every adapter (llm/registry.py:116-135; bare-bool adapters collapse to generic `unavailable`), and all seven Python CLI seats thread it — plus `disabled` for `--no-llm` — into `emit_deterministic(use_case, reason=…)`, which writes an optional `reason` key on the deterministic sidecar line (llm/monitor.py:165-210). Policy-forbidden reads as forbidden-by-policy in the descent record, not as binary-missing. |

## Deviations backlog

The 2026-08-25 backlog (R1–R6, mirrored in `docs/BACKLOG.md` § Registry
conformance — agent-cli-transport) is fully implemented and the items are
marked done there. Accepted residue, recorded rather than hidden:

- **Cap is retention-bound, not accumulation-bound** (output-normalization):
  `subprocess.run` buffers the whole stream before the 4MB check; killing the
  child mid-stream on breach would mean a Popen read loop with its own
  timeout/stderr threading, which the mocked-`subprocess.run` test harness and
  the Windows `.CMD` shim handling both pin. Revisit only if a real runaway is
  ever observed.
- **No rung telemetry on the JSON-extraction ladder** (output-normalization):
  the ladder itself (direct → fenced → scan, last-value, expected_keys) is
  present; which rung fired is not recorded. Enhancement, not a contract rule.
- **Non-CLI adapters still answer a bare bool** (fallback-ladder): their
  descent reason collapses to generic `"unavailable"` until `availability()`
  is modeled on each adapter (missing-key vs missing-SDK).

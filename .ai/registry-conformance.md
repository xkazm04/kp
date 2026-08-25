# Registry conformance — software-engineering
contributor: kazda-dev-box · audited: 2026-08-25

Scope of this audit: subject `agent-cli-transport` (bundle digest
`sha256:f397e66be7bcad4f`) against context `py-llm-runtime` —
`pipeline/jobfit/claude_cli.py` plus its `pipeline/jobfit/llm/` wiring
(`monitor.py` MonitoredClaudeCli, `capabilities.py`, `registry.py`, `offline.py`).
Earlier verdicts (2026-08-23, three UI/recruiting pairs) live as pair states in
`.ai/registry-map.json`; this file holds the per-technique detail one map cell
cannot. The borrowed `spawn-contract` / `termination-and-reaping` techniques
were not judged here (subprocess-lifecycle is its own subject).

| subject | technique | status | evidence |
|---|---|---|---|
| agent-cli-transport | (golden-path transport contract) | deviation | No typed closed `mode`: stance is assembled from constructor kwargs (claude_cli.py:169-190), so a caller can pair `permission_mode="acceptEdits"` with a repo `cwd` without `with_repo_access`'s validation; and the generate path inherits the caller's cwd by design (claude_cli.py:157-161), so the child loads ambient project instructions (kp's own CLAUDE.md when run from repo root) into every batch prompt — the contract requires a neutral working directory for `generate`. |
| agent-cli-transport | availability-probe | partial | available() (claude_cli.py:256-266) proves install via shutil.which — the same resolution the spawn uses (_executable:277, the Windows .CMD shim case handled) — and enforces the KP_OFFLINE policy veto before any filesystem lookup (:260-266, llm/offline.py:35). But it never proves authorization: a logged-out CLI reports available and fails only on the first paid call; no version capture, no three-valued result, no probe record. |
| agent-cli-transport | subscription-auth-selection | partial | Strip of ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN at the single spawn door, applied after env construction (claude_cli.py:40, :404-409), default-on with the metered path an explicit constructor choice, pinned by a test that reads the child env (tests/test_claude_cli.py:111-121). Missing only the session-nesting hygiene: vendor session markers (CLAUDECODE etc.) ride into the child, and kp batch runs are routinely launched from inside agent sessions. |
| agent-cli-transport | output-normalization | partial | Single-result-object dialect parsed once (claude_cli.py:411-445); stderr kept separate and carried on errors (capture_output, ClaudeCliError.stderr:118-121); stdin fed and closed (input=, :312); envelope error state authoritative with the tool's subtype surfaced as a value (:427-434); bounded raw prefix on unparseable output (:420-422); empty output is a named failure (:413); last-value extraction ladder with fenced-block preference and expected_keys pinning (:472-500). Missing: no byte cap on accumulated stdout; no user-config isolation flag, so a user hook printing after the envelope breaks the strict whole-string parse; no rung telemetry on the extraction ladder. |
| agent-cli-transport | permission-stance-enforcement | followed | Three layers worn together: `--permission-mode plan` (claude_cli.py:69), scoped allowlist with git-subcommand scoping and a bare-Bash refusal (:74-81, :222-227), write-tool denylist where deny beats allow (:85-91) — all behind one door (`with_repo_access`:194-235) that raises on write-capable requests; mode vocabulary validated pre-spawn (:99-112); variadic lists comma-joined (:247-250); argv assertable without spawning (cli_args:237). Edit stance n/a — kp never runs the CLI in edit mode. |
| agent-cli-transport | dated-capability-matrix | partial | The miniature discipline the technique endorses is present — flags pinned with "verified against `claude --help` on 2026-08-23" (claude_cli.py:56-63) — and features declare required capabilities against a provider matrix that gates routing at resolve time (llm/capabilities.py:24-85, unsupported_caps:161-164). But no version probe exists anywhere, so nothing marks the dated rows stale when the CLI updates; the comment rots silently. |
| agent-cli-transport | fallback-ladder | partial | The ladder is realized and labeled: CLI seat → metered API adapters behind the same surface (llm/registry.py, llm/base.py) → deterministic floor as a stated product property (automation.py:4, campaign.py:19, match_reasoning.py:5), with floor serves ledger-recorded (emit_deterministic, llm/monitor.py:165-184) and dossier `source` kept honest (llm/capabilities.py:65-70); `available()` is the one shared predicate, offline policy centralized (llm/offline.py). Missing: descent reason — available() returns a bare False, so policy-forbidden (KP_OFFLINE) and binary-missing are indistinguishable downstream, exactly the confusion the technique warns repairs the wrong cause. |

## Deviations backlog

Ranked by value; effort in brackets. Mirrored in `docs/BACKLOG.md` § Registry
conformance — agent-cli-transport.

1. [M] **Typed mode seam with a neutral generate cwd.** Introduce a closed
   `mode` vocabulary (`generate` | `readonly-scan`) on ClaudeCliProvider;
   `generate` spawns in a neutral temp cwd so ambient project instructions
   (kp's own CLAUDE.md) stop contaminating and taxing every batch prompt;
   `with_repo_access` becomes the `readonly-scan` constructor. Closes the
   golden-path deviation and the constructor-bypass hole.
2. [S] **Zero-token authorization probe.** Beside `available()`, a `probe()`
   that runs the installed CLI's auth-status command where the version offers
   one (verify against `--help`; record as a dated matrix row) and returns
   authorized / unauthorized / unknown — never inferring authorized from a
   credential file or a which() hit.
3. [S] **Session-nesting marker strip.** Pop the vendor session markers
   (CLAUDECODE and companions) in `_child_env` alongside the billing keys, and
   extend the child-env test to pin it.
4. [S] **Stdout cap + user-config isolation.** Bound the captured stdout with
   the child killed on breach; pass the strongest user-settings isolation flag
   that does not break seat auth (verify against `--help`, date the comment) so
   user hooks cannot append noise after the envelope.
5. [M] **Version-triggered re-verification.** Record the CLI version on first
   use per process (or in the probe record); when it differs from the version
   the dated flag comments were verified against, log the staleness so argument
   errors point first at the matrix, not the model.
6. [S] **Named descent reasons.** Let availability carry its reason (offline
   policy vs not installed) — the sibling voice modules' `(bool, reason)` shape
   already models this — and thread it into `emit_deterministic` so a fleet
   living on the floor is diagnosable.

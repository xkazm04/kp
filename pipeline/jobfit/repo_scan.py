"""Repo dossier — what a machine can read off a codebase before a role is composed.

Phase P2 of ``docs/concepts/app-master.md`` §3 step 2. Produces the
:class:`~pipeline.jobfit.appmaster.RepoDossier` the App-master intake is composed
from, by two paths that are deliberately *stacked*, not alternatives:

1. **The heuristic walker always runs first.** It reads what the repo says about
   itself — ``context-map.json``, ``CLAUDE.md`` / ``AGENTS.md``, ``package.json``
   scripts, Python manifests, CI workflow files, git history, file counts — and
   fills a complete ``RepoDossier`` with ``source: "heuristic"``. That is the
   keyless result (degrading without keys is a product property here), and it is
   *also* the grounding the LLM path is handed.
2. **The LLM path refines that dossier**, it does not replace it. Claude Code runs
   IN the repository, read-only (see
   :meth:`~pipeline.jobfit.claude_cli.ClaudeCliProvider.with_repo_access`), and is
   asked for exactly the four things a file walk cannot honestly produce:
   ``riskAreas``, a rationale on each ``hotSpot``, ``candidateObjectives`` and
   ``maintainerLoadEstimate``. :func:`coerce_repo_dossier` merges its answer onto
   the heuristic base: fields the model omitted keep their heuristic values, and
   fields the model is not allowed to touch (``size``, ``contexts``,
   ``declaredGates``, the repo binding) are dropped from its answer with a note.

The split matters because a dossier is *an inference about someone else's
codebase*. Counting files is a fact; "this module is risky" is a judgment; and
"the baseline for this KPI is 40%" — when nobody has measured it — is a
fabrication. So the walker never guesses a rationale, the coercer never lets the
model overwrite a counted fact, and ``candidateObjectives`` are required to carry
a *null* baseline unless a real reading exists (`baseline-unknown honesty`).

Every field carries provenance (``fieldProvenance``): ``heuristic`` for what was
read off disk, ``llm`` for what the model established, ``unknown`` for the holes
neither could fill. A hole must read as a hole.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from .appmaster import (
    APP_MASTER_PROMPT_VERSION,
    DossierContext,
    DossierFinding,
    Objective,
    RepoDossier,
    RepoRef,
    RepoSize,
)
from .devcase.provenance import (
    SOURCE_DETERMINISTIC,
    SOURCE_LLM,
    generate_with_fallback,
)

_LOG = logging.getLogger(__name__)

REPO_SCAN_PROMPT_VERSION = APP_MASTER_PROMPT_VERSION

# The whole-dossier source values RepoDossier.source accepts. generate_with_fallback
# speaks the devcase vocabulary ("llm" / "deterministic"); the dossier's own literal
# calls the non-LLM path what it actually is.
SOURCE_HEURISTIC = "heuristic"

# ---- Fallback classification -------------------------------------------------
#
# ``generate_with_fallback`` records WHY a refinement fell back as a free-text
# ``"<ExceptionType>: <message>"`` line (devcase/provenance.describe_fallback).
# That line is a diagnostic, not a UI string: it is English, unbounded in shape,
# and it can quote provider output. What the operator needs is the CLASS — "the
# agent is not installed" reads very differently from "the agent timed out", and
# only one of them is worth waiting for.
#
# This is the SINGLE definition of that closed vocabulary. The TS side carries a
# copy (``REPO_SCAN_FALLBACK_CLASSES`` in app/_lib/repo-scan-run.ts) and a guard
# test reads THIS tuple out of this file and asserts set equality, so the two can
# never drift into a chip that renders a class the catalog has no words for.
FALLBACK_CLASSES = (
    "agent_not_installed",
    "agent_timeout",
    "agent_unparseable",
    "agent_refused",
    "agent_output_too_large",
    "provider_error",
    "unknown",
)

# Matched in order against the lower-cased reason line. Ordered most-specific
# first: "timed out" is checked before the generic provider bucket, and the
# not-found probe before either, because the CLI's own not-found message also
# mentions the command.
_FALLBACK_PATTERNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("agent_not_installed", ("not found", "on path", "is it installed")),
    ("agent_timeout", ("timed out", "timeout")),
    ("agent_output_too_large", ("exceeded the", "byte cap", "runaway output")),
    ("agent_unparseable", ("parseable json", "was not json", "produced no output", "unexpected cli envelope")),
    ("agent_refused", ("returned an error", "subtype=")),
)


def classify_fallback(reason: str | None) -> str:
    """Collapse a free-text fallback reason to one of :data:`FALLBACK_CLASSES`.

    Never raises and never returns a class outside the tuple: an unrecognised
    reason is ``"unknown"``, which the UI renders as a generic "the agent fell
    back" rather than as silence. An empty reason is ``"unknown"`` too — the
    caller only asks when a fallback actually happened.
    """
    text = (reason or "").lower()
    for cls, needles in _FALLBACK_PATTERNS:
        if any(n in text for n in needles):
            return cls
    # A recognisable exception type with no matching message still says more than
    # nothing: everything the LLM path can raise came from a provider call.
    return "provider_error" if text else "unknown"

# Wall-clock budget for the in-repo agent. Bounded on purpose: the scan is an
# intake step somebody is waiting on, and a repo big enough to need longer is a
# repo whose heuristic floor is the honest answer anyway.
LLM_TIMEOUT_S = 240

# Output cap for the model's JSON, applied at the provider boundary via the
# per-field caps below plus these list ceilings. A dossier is read by a human in a
# panel; an 80-item risk list is noise, not thoroughness.
MAX_FINDINGS = 12
MAX_OBJECTIVES = 6
MIN_OBJECTIVES = 3
MAX_STACK = 12
MAX_KPIS = 12
MAX_NOTE_CHARS = 300
MAX_CONTEXTS = 400

# Directories a source walk must never descend into: build output, dependency
# trees, virtualenvs, caches and the VCS store. Without this the file counts
# describe node_modules, not the app.
SKIP_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".next",
        ".next-empty",
        ".turbo",
        ".venv",
        "venv",
        "env",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "dist",
        "build",
        "out",
        "coverage",
        ".cache",
        ".idea",
        ".vscode",
        "target",
        "vendor",
        ".gradle",
        ".terraform",
        "test-results",
        "playwright-report",
    }
)

# Extension -> the stack name it implies. Only unambiguous ones: guessing a
# framework from a file extension is exactly the brittle classifier
# repo-snapshot.ts deliberately refuses to write.
_STACK_BY_EXT: dict[str, str] = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".rs": "Rust",
    ".go": "Go",
    ".java": "Java",
    ".kt": "Kotlin",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".swift": "Swift",
    ".sql": "SQL",
    ".css": "CSS",
    ".scss": "CSS",
}

SOURCE_EXTENSIONS = frozenset(_STACK_BY_EXT)

# What counts as a DECLARED GATE — the repo's own answer to "how do I know this
# still works". Two rules, and the split between them is the whole point:
#
#   _GATE_EXACT     the whole script name. `build` is a gate; `market:build`
#                   (which builds a DATA file) is not, and only the exact rule
#                   keeps those apart.
#   _GATE_SEGMENTS  any colon-delimited segment. Namespaced gates go both ways in
#                   the wild — `test:unit` and `check:design` put the verb first,
#                   `design:check` and `i18n:check` put it last — and a prefix-only
#                   rule silently loses half of them. kp's own `design:check` and
#                   `i18n:check` are exactly that case.
#
# Deliberately narrow otherwise: `dev`, `start`, `db:dump`, `polar:setup` prove
# nothing, and inventing gates would hand an App master a mandate to pass checks
# nobody runs.
_GATE_EXACT = ("lint", "typecheck", "build")
_GATE_SEGMENTS = ("test", "check", "lint", "typecheck")


def _is_gate_script(name: str) -> bool:
    lowered = name.strip().lower()
    if lowered in _GATE_EXACT:
        return True
    return any(segment in _GATE_SEGMENTS for segment in lowered.split(":"))


def _clip(value: Any, limit: int = MAX_NOTE_CHARS) -> str:
    return "" if value is None else str(value).strip()[:limit]


def _read_text(path: Path, limit: int = 200_000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:limit]
    except OSError:
        return ""


# A manifest must be read WHOLE or not at all: truncating it yields invalid JSON,
# which the walker would then silently report as "the repo declares no contexts".
# kp's own context-map.json is ~1 MB, so the excerpt cap used for prose files is
# far too small here. The ceiling still exists (a runaway file is not read into
# memory), it is just sized for real manifests.
_MAX_MANIFEST_BYTES = 16 * 1024 * 1024


def _read_json(path: Path) -> Any:
    text = _read_text(path, _MAX_MANIFEST_BYTES)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        _LOG.warning("repo_scan: %s is not valid JSON — skipped", path.name)
        return None


# --------------------------------------------------------------------------- #
# The heuristic walk
# --------------------------------------------------------------------------- #


def walk_files(root: Path) -> tuple[int, Counter[str]]:
    """``(total files, Counter of extension -> count)``, skipping :data:`SKIP_DIRS`.

    One pass; the caller derives sizes, the stack and the source-file count from
    the counter, so a big repo is walked exactly once.
    """
    total = 0
    by_ext: Counter[str] = Counter()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".git"))
        for name in filenames:
            total += 1
            ext = os.path.splitext(name)[1].lower()
            if ext:
                by_ext[ext] += 1
    return total, by_ext


def read_context_map(root: Path) -> tuple[list[DossierContext], str | None]:
    """The repo's own feature map, when it declares one.

    kp publishes ``context-map.json``; the shape is ``{contexts: [{name, category,
    file_paths|filePaths}]}``. A repo without one is not a lesser repo — it just
    has no declared contexts, and the dossier says so by carrying none.
    """
    for candidate in ("context-map.json", ".context-map.json"):
        path = root / candidate
        data = _read_json(path)
        if not isinstance(data, dict):
            continue
        raw = data.get("contexts")
        if not isinstance(raw, list):
            continue
        contexts: list[DossierContext] = []
        for entry in raw[:MAX_CONTEXTS]:
            if not isinstance(entry, dict):
                continue
            files = entry.get("file_paths") or entry.get("filePaths") or []
            contexts.append(
                DossierContext(
                    name=_clip(entry.get("name"), 200),
                    category=_clip(entry.get("category"), 60),
                    file_count=len(files) if isinstance(files, list) else 0,
                )
            )
        return contexts, candidate
    return [], None


def read_declared_gates(root: Path) -> list[str]:
    """The repo's OWN gate commands, in the form a human would type them.

    npm scripts named ``test*`` / ``check*`` / ``lint`` / ``typecheck`` / ``build``
    become ``npm run <name>``; a Python project's test entry point is inferred only
    from a manifest that actually declares one. Nothing here is invented: a repo
    that declares no gates gets an empty list, which is a finding.
    """
    gates: list[str] = []
    pkg = _read_json(root / "package.json")
    if isinstance(pkg, dict):
        scripts = pkg.get("scripts")
        if isinstance(scripts, dict):
            for name in sorted(str(k) for k in scripts):
                if _is_gate_script(name):
                    gates.append(f"npm run {name}")
    pyproject = _read_text(root / "pyproject.toml", 40_000)
    if pyproject:
        if "[tool.pytest" in pyproject:
            gates.append("pytest")
        if "[tool.ruff" in pyproject:
            gates.append("ruff check .")
        if "[tool.mypy" in pyproject:
            gates.append("mypy .")
    if (root / "Makefile").is_file():
        makefile = _read_text(root / "Makefile", 40_000)
        for target in sorted(set(re.findall(r"^([A-Za-z0-9_.-]+):", makefile, flags=re.MULTILINE))):
            if _is_gate_script(target):
                gates.append(f"make {target}")
    # Stable order, no duplicates — the dossier is compared across runs.
    seen: set[str] = set()
    return [g for g in gates if not (g in seen or seen.add(g))]


def read_ci_workflows(root: Path) -> list[str]:
    """CI workflow file names (``.github/workflows/*``, ``.gitlab-ci.yml``, …).

    Names only. What a workflow *does* is a judgment the LLM path can make with the
    file in front of it; listing the files is the fact.
    """
    found: list[str] = []
    workflows = root / ".github" / "workflows"
    if workflows.is_dir():
        try:
            found += sorted(
                f".github/workflows/{p.name}"
                for p in workflows.iterdir()
                if p.is_file() and p.suffix.lower() in (".yml", ".yaml")
            )
        except OSError:
            pass
    for single in (".gitlab-ci.yml", "azure-pipelines.yml", "Jenkinsfile", ".circleci/config.yml"):
        if (root / single).is_file():
            found.append(single)
    return found


def _git(root: Path, args: list[str], timeout: int = 30) -> str:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return completed.stdout if completed.returncode == 0 else ""


def read_churn(root: Path, depth: int = 200) -> tuple[list[tuple[str, int]], int, int]:
    """Churn hot spots over the last ``depth`` commits: ``(paths, commits, authors)``.

    The path list comes from ``git log --name-only``, NOT ``--oneline``: the
    concept names ``--oneline`` but that format prints no paths at all, so it
    cannot answer "what changes most". Ties break on the path name so the walk is
    reproducible.
    """
    log = _git(
        root,
        ["log", "--no-merges", "--pretty=format:%x00%an", "--name-only", f"-n{depth}"],
    )
    if not log:
        return [], 0, 0
    counts: Counter[str] = Counter()
    authors: set[str] = set()
    commits = 0
    for line in log.splitlines():
        if line.startswith("\x00"):
            commits += 1
            author = line[1:].strip()
            if author:
                authors.add(author)
            continue
        path = line.strip()
        if path:
            counts[path] += 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_FINDINGS]
    return ranked, commits, len(authors)


def read_kpi_signals(root: Path) -> list[str]:
    """Existing KPI signals the repo already carries — kept deliberately simple.

    Looks for the places a project usually keeps them (a ``kpi``-named file, an
    analytics module/directory) and reports the PATHS, not an interpretation. An
    App master's value ledger has to start from what is already measured, and the
    honest version of that is "here is where measurement lives", not a number
    invented from a filename.
    """
    hits: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".git"))
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        depth = rel_dir.count("/") if rel_dir else 0
        if depth > 4:
            dirnames[:] = []
            continue
        for name in dirnames:
            if name.lower() in ("analytics", "kpi", "kpis", "metrics", "telemetry"):
                hits.append(f"{rel_dir}/{name}".lstrip("/"))
        for name in filenames:
            lowered = name.lower()
            if "kpi" in lowered and os.path.splitext(lowered)[1] in (
                *SOURCE_EXTENSIONS,
                ".json",
                ".md",
                ".yml",
                ".yaml",
            ):
                hits.append(f"{rel_dir}/{name}".lstrip("/"))
    return sorted(set(hits))[:MAX_KPIS]


def read_agent_docs(root: Path) -> dict[str, str]:
    """The repo's instructions to a machine reader, when it wrote any.

    ``CLAUDE.md`` / ``AGENTS.md`` / ``CONTRIBUTING.md`` are where a project states
    its own conventions and gates. Excerpted (not summarised) so the LLM path gets
    the repo's own words as grounding rather than the walker's paraphrase.
    """
    docs: dict[str, str] = {}
    for name in ("CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md", "CONTRIBUTING.md", "README.md"):
        text = _read_text(root / name, 6_000)
        if text.strip():
            docs[name] = text
    return docs


def _stack_from_extensions(by_ext: Counter[str], root: Path) -> list[str]:
    """Languages, most-used first — counted, never inferred from a framework name."""
    per_language: Counter[str] = Counter()
    for ext, count in by_ext.items():
        language = _STACK_BY_EXT.get(ext)
        if language:
            per_language[language] += count
    ranked = [name for name, _ in sorted(per_language.items(), key=lambda kv: (-kv[1], kv[0]))]
    # Manifests are a fact about the toolchain, so they may name themselves.
    if (root / "package.json").is_file() and "Node.js" not in ranked:
        ranked.append("Node.js")
    if any((root / m).is_file() for m in ("pyproject.toml", "requirements.txt", "setup.py")):
        if "Python" not in ranked:
            ranked.append("Python")
    if (root / "Cargo.toml").is_file() and "Rust" not in ranked:
        ranked.append("Rust")
    if (root / "go.mod").is_file() and "Go" not in ranked:
        ranked.append("Go")
    return ranked[:MAX_STACK]


def _maintainer_load(commits: int, authors: int, depth: int) -> str:
    """Prose, never a fabricated headcount.

    The only thing the walker can honestly say is how many distinct authors touched
    the last N commits. That is not "how many maintainers this needs" — so it is
    reported as what it is, with its denominator attached.
    """
    if commits == 0:
        return "no git history was readable — maintainer load is unknown"
    if authors == 0:
        return f"{commits} commit(s) in the last {depth} with no author recorded — maintainer load is unknown"
    return (
        f"{authors} distinct author(s) across the last {commits} commit(s); "
        "this is a count of who touched the repo, not an estimate of how many people it needs"
    )


def _heuristic_risks(
    *,
    gates: list[str],
    ci: list[str],
    contexts: list[DossierContext],
    commits: int,
) -> list[DossierFinding]:
    """Risks a file walk can state as FACTS, and only those.

    Each entry names a thing that is missing or unreadable — never a judgment about
    code quality, which is what the LLM path is for. An empty list is a legitimate
    outcome and does not mean "no risks".
    """
    findings: list[DossierFinding] = []
    if not gates:
        findings.append(
            DossierFinding(
                ref="declaredGates",
                note="no gate commands are declared (no test/lint/typecheck/build script found) — "
                "an App master would have nothing to prove a change by",
            )
        )
    if not ci:
        findings.append(
            DossierFinding(
                ref="ci",
                note="no CI workflow files were found — gates, if any, run only on someone's machine",
            )
        )
    if not contexts:
        findings.append(
            DossierFinding(
                ref="context-map.json",
                note="the repo declares no machine-readable context/feature map — "
                "ownership has to be inferred per change",
            )
        )
    if commits == 0:
        findings.append(
            DossierFinding(
                ref="git",
                note="git history was not readable from this path — churn and cadence are unknown",
            )
        )
    return findings[:MAX_FINDINGS]


def build_heuristic_dossier(
    root: str | Path,
    *,
    dossier_id: str = "",
    repo_url: str | None = None,
    main_branch: str = "main",
    generated_at: str = "",
    churn_depth: int = 200,
) -> RepoDossier:
    """The deterministic file-walk dossier — the keyless result AND the grounding.

    Pure with respect to time: ``generated_at`` is a parameter, not a clock read,
    so two walks of an unchanged tree are byte-identical (pinned by
    ``test_repo_scan``). Every non-empty field is stamped ``heuristic``; the two
    fields a walk cannot honestly produce — ``riskAreas`` beyond missing-artifact
    facts, and ``candidateObjectives`` — are left for the LLM path and stamped
    ``unknown`` when it did not run.
    """
    root_path = Path(root)
    total_files, by_ext = walk_files(root_path)
    source_files = sum(count for ext, count in by_ext.items() if ext in SOURCE_EXTENSIONS)
    contexts, context_map_ref = read_context_map(root_path)
    gates = read_declared_gates(root_path)
    ci = read_ci_workflows(root_path)
    ranked_churn, commits, authors = read_churn(root_path, churn_depth)
    kpis = read_kpi_signals(root_path)

    hot_spots = [
        DossierFinding(
            ref=path,
            note=f"changed in {count} of the last {commits} commit(s)",
        )
        for path, count in ranked_churn
    ]
    # CI files are a fact about the gate surface and belong beside the declared
    # gates, so they ride as gate entries with their own honest phrasing.
    declared = list(gates)
    for workflow in ci:
        declared.append(f"ci: {workflow}")

    provenance: dict[str, str] = {
        "stack": SOURCE_HEURISTIC,
        "size": SOURCE_HEURISTIC,
        "declaredGates": SOURCE_HEURISTIC,
        "contexts": SOURCE_HEURISTIC,
        "hotSpots": SOURCE_HEURISTIC,
        "riskAreas": SOURCE_HEURISTIC,
        "existingKpis": SOURCE_HEURISTIC,
        "maintainerLoadEstimate": SOURCE_HEURISTIC,
        # Nothing on disk states what this app should aim at next. An empty list
        # with an `unknown` stamp is the honest report; the intake dialog (P3)
        # asks the operator, and the LLM path proposes.
        "candidateObjectives": "unknown",
    }

    return RepoDossier(
        dossier_id=dossier_id,
        repo=RepoRef(url=repo_url, root_path=str(root_path), main_branch=main_branch),
        source=SOURCE_HEURISTIC,
        generated_at=generated_at,
        stack=_stack_from_extensions(by_ext, root_path),
        size=RepoSize(files=total_files, source_files=source_files, contexts=len(contexts)),
        declared_gates=declared,
        contexts=contexts,
        hot_spots=hot_spots,
        risk_areas=_heuristic_risks(gates=gates, ci=ci, contexts=contexts, commits=commits),
        existing_kpis=kpis,
        maintainer_load_estimate=_maintainer_load(commits, authors, churn_depth),
        candidate_objectives=[],
        field_provenance=provenance,
        prompt_version=REPO_SCAN_PROMPT_VERSION,
    )


# --------------------------------------------------------------------------- #
# The LLM refinement
# --------------------------------------------------------------------------- #

SYSTEM = (
    "You are reading a codebase to brief the hiring of an App master — the single "
    "accountable owner of this application's value. You are READ-ONLY: you may read, "
    "search and inspect git history, and you must not write, edit or run anything that "
    "changes the repository. Ground every statement in something you actually read, and "
    "say 'unknown' rather than filling a gap. Return ONLY the JSON object asked for."
)

# The keys the model may return. Everything else in its object is dropped: `size`,
# `contexts` and `declaredGates` are COUNTED facts, and letting a model restate a
# count is how a dossier acquires a number nobody measured.
REFINABLE_KEYS = ("riskAreas", "hotSpots", "candidateObjectives", "maintainerLoadEstimate", "existingKpis")


def build_prompt(base: RepoDossier, docs: dict[str, str], lang: str = "en") -> str:
    """The refinement prompt: here is what the walk established, tell me the rest."""
    grounding = base.model_dump(by_alias=True)
    # The model does not need the full context list to reason about risk, and a
    # 143-entry array crowds out the actual question.
    grounding["contexts"] = grounding["contexts"][:40]
    doc_block = "\n\n".join(
        f"--- {name} (excerpt) ---\n{text[:4000]}" for name, text in sorted(docs.items())
    )
    return f"""You are in the repository at `{base.repo.root_path}`. Read it.

A deterministic file walk already established the facts below. Do NOT restate or
correct them — they are counted, not guessed:

{json.dumps(grounding, ensure_ascii=False, indent=2)}

The repository's own instructions to a machine reader:

{doc_block or "(none found)"}

Your job is the part a file walk cannot do. Read the hot-spot files, the declared
gates and the history, then return ONLY this JSON object:

{{
  "riskAreas": [{{"ref": "<path / module / command>", "note": "<one line: what could break, and why you believe it>"}}],
  "hotSpots":  [{{"ref": "<path from the list above>", "note": "<one line: WHY this churns — not that it churns>"}}],
  "candidateObjectives": [
    {{"kpiKey": "<snake_case key>", "label": "<what it measures, in one line>",
      "baseline": <number or null>, "target": <number or null>, "unit": "<unit>",
      "direction": "gte" | "lte", "windowDays": <int>}}
  ],
  "maintainerLoadEstimate": "<prose: how much attention this repo appears to need, and on what evidence>",
  "existingKpis": ["<a metric this repo ALREADY measures, as a path or a name>"]
}}

Rules:
- {MIN_OBJECTIVES}-{MAX_OBJECTIVES} candidateObjectives. Each must be something THIS
  repo could plausibly move, drawn from what you read.
- `baseline` MUST be null unless you found an actual reading in the repo. An
  invented baseline is worse than none: it makes an unmeasured objective look
  measured. The same rule applies to `target` — null when nobody has set one.
- Keep every `note` to one sentence.
- `hotSpots[].ref` must come from the list above; do not invent paths.
- No prose outside the JSON object. Answer in {lang}.
"""


def _finding_list(value: Any, limit: int = MAX_FINDINGS) -> list[DossierFinding]:
    out: list[DossierFinding] = []
    if not isinstance(value, list):
        return out
    for entry in value[:limit]:
        if not isinstance(entry, dict):
            continue
        ref = _clip(entry.get("ref"), 300)
        note = _clip(entry.get("note"))
        if not ref and not note:
            continue
        out.append(DossierFinding(ref=ref, note=note))
    return out


def _number_or_none(value: Any) -> float | None:
    """A real reading, or None. Booleans and strings are NOT numbers here.

    This is the baseline-unknown rule in code: a model that answers `"unknown"`,
    `""` or `0` for a baseline it never read must not produce a float.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _objective_list(value: Any) -> list[Objective]:
    out: list[Objective] = []
    if not isinstance(value, list):
        return out
    for entry in value[:MAX_OBJECTIVES]:
        if not isinstance(entry, dict):
            continue
        key = _clip(entry.get("kpiKey") or entry.get("kpi_key"), 120)
        if not key:
            continue
        direction = _clip(entry.get("direction"), 8).lower()
        window = entry.get("windowDays") or entry.get("window_days")
        window_days = int(window) if isinstance(window, (int, float)) and not isinstance(window, bool) else 30
        out.append(
            Objective(
                kpi_key=key,
                label=_clip(entry.get("label")),
                baseline=_number_or_none(entry.get("baseline")),
                target=_number_or_none(entry.get("target")),
                unit=_clip(entry.get("unit"), 40),
                direction="lte" if direction == "lte" else "gte",
                window_days=window_days if window_days > 0 else 30,
            )
        )
    return out


def coerce_repo_dossier(raw: Any, base: RepoDossier) -> RepoDossier:
    """Merge a model's answer onto the heuristic dossier — defensively.

    Three rules, in order:

    * **Only the refinable keys are read.** ``size``, ``contexts``,
      ``declaredGates``, ``repo`` and ``source`` are counted facts or the caller's
      own input; a model that returns them is ignored (the drop is logged).
    * **An omitted field keeps its heuristic value.** A model that answered three
      of five questions does not blank the other two.
    * **A field the model actually filled is stamped ``llm``**, so the panel can
      tell what was read off disk from what was judged.

    ``hotSpots`` refs are intersected with the churn list: the model may explain a
    hot spot, not invent one. A ref it made up is dropped, and its rationale with
    it — an explanation of a file that never churned explains nothing.
    """
    if not isinstance(raw, dict):
        _LOG.warning("repo_scan: LLM returned %s, not an object — keeping the heuristic dossier", type(raw).__name__)
        return base

    dropped = sorted(k for k in raw if k not in REFINABLE_KEYS)
    if dropped:
        _LOG.warning(
            "repo_scan: dropped non-refinable key(s) from the LLM answer: %s", ", ".join(dropped)
        )

    merged = base.model_copy(deep=True)
    provenance = dict(base.field_provenance)

    risks = _finding_list(raw.get("riskAreas"))
    if risks:
        # The heuristic risks are missing-artifact FACTS; the model's are judgments.
        # Keep both, facts first, deduped by ref.
        seen = {f.ref for f in merged.risk_areas}
        merged.risk_areas = merged.risk_areas + [f for f in risks if f.ref not in seen]
        merged.risk_areas = merged.risk_areas[:MAX_FINDINGS]
        provenance["riskAreas"] = SOURCE_LLM

    hot = _finding_list(raw.get("hotSpots"))
    if hot:
        known = {f.ref: f for f in merged.hot_spots}
        for finding in hot:
            existing = known.get(finding.ref)
            if existing is None:
                continue  # invented path — dropped with its rationale
            if finding.note:
                # Keep the counted churn fact AND the model's reason for it.
                existing.note = f"{existing.note}; {finding.note}"[: MAX_NOTE_CHARS * 2]
        provenance["hotSpots"] = SOURCE_LLM

    objectives = _objective_list(raw.get("candidateObjectives"))
    if objectives:
        merged.candidate_objectives = objectives
        provenance["candidateObjectives"] = SOURCE_LLM

    load = _clip(raw.get("maintainerLoadEstimate"), 600)
    if load:
        merged.maintainer_load_estimate = load
        provenance["maintainerLoadEstimate"] = SOURCE_LLM

    kpis = raw.get("existingKpis")
    if isinstance(kpis, list):
        extra = [_clip(k, 200) for k in kpis if _clip(k, 200)]
        if extra:
            seen_kpis = set(merged.existing_kpis)
            merged.existing_kpis = (
                merged.existing_kpis + [k for k in extra if not (k in seen_kpis or seen_kpis.add(k))]
            )[:MAX_KPIS]
            provenance["existingKpis"] = SOURCE_LLM

    merged.source = SOURCE_LLM
    merged.field_provenance = provenance
    return merged


def bind_provider_to_repo(provider: Any, root: str | Path) -> Any:
    """Give the provider read-only access to ``root`` when it is the Claude CLI.

    Only the local Claude CLI can actually *run in* a repository; every other
    adapter is a text API. Those still get the refinement prompt — it carries the
    heuristic dossier and the repo's own docs as grounding — they just answer from
    that grounding instead of from the files. That is a real difference and it is
    why ``source`` stays honest either way.
    """
    binder = getattr(provider, "with_repo_access", None)
    if callable(binder):
        return binder(str(root), timeout=LLM_TIMEOUT_S)
    return provider


def scan_repo(
    root: str | Path,
    *,
    provider: Any | None = None,
    lang: str = "en",
    dossier_id: str = "",
    repo_url: str | None = None,
    main_branch: str = "main",
    generated_at: str = "",
    churn_depth: int = 200,
) -> tuple[dict[str, Any], str]:
    """Scan ``root`` and return ``(dossier, source)`` with ``source`` ∈ {llm, heuristic}.

    The heuristic walk always runs. With no provider (keyless, ``--no-llm``, or a
    provider that reported unavailable) that walk IS the answer. With one, the walk
    becomes the grounding and the model refines it; if the model call raises, the
    walk is still the answer and the reason rides on the artifact
    (``generate_with_fallback``'s contract, same as every other LLM step here).
    """
    root_path = Path(root)
    base = build_heuristic_dossier(
        root_path,
        dossier_id=dossier_id,
        repo_url=repo_url,
        main_branch=main_branch,
        generated_at=generated_at,
        churn_depth=churn_depth,
    )
    if provider is None:
        return base.model_dump(by_alias=True), SOURCE_HEURISTIC

    docs = read_agent_docs(root_path)
    prompt = build_prompt(base, docs, lang=lang)
    bound = bind_provider_to_repo(provider, root_path)

    result, source = generate_with_fallback(
        bound,
        prompt,
        SYSTEM,
        lambda: base.model_dump(by_alias=True),
        lambda payload: coerce_repo_dossier(payload, base).model_dump(by_alias=True),
        _LOG,
        expected_keys=REFINABLE_KEYS,
    )
    # generate_with_fallback speaks "llm"/"deterministic"; the dossier's own
    # vocabulary calls the non-LLM path "heuristic". Translate at the boundary so
    # the persisted `source` is always one of the two the schema allows.
    return result, SOURCE_HEURISTIC if source == SOURCE_DETERMINISTIC else SOURCE_LLM


__all__ = [
    "FALLBACK_CLASSES",
    "LLM_TIMEOUT_S",
    "REFINABLE_KEYS",
    "REPO_SCAN_PROMPT_VERSION",
    "SKIP_DIRS",
    "SOURCE_HEURISTIC",
    "bind_provider_to_repo",
    "classify_fallback",
    "build_heuristic_dossier",
    "build_prompt",
    "coerce_repo_dossier",
    "read_agent_docs",
    "read_churn",
    "read_context_map",
    "read_declared_gates",
    "scan_repo",
    "walk_files",
]

"""LLM-era controls #3 + #6 — mechanical checks against KNOWN ground truth.

Two deterministic evaluators over the submitted file tree (Live Work Surface
sessions submit their tree; both checks quietly no-op when files are absent):

* canary_outcomes — the seed carried planted flaws with known ground truth
  (seed_materializer v2). Per canary: was the flaw ADDRESSED (the flawed fragment
  is gone), FLAGGED (called out in the DECISIONS log or a stakeholder/assistant
  message), PROPAGATED (still present), or UNVERIFIABLE (the fragment could not be
  located in the seed — no grading against noise).

* baseline_similarity — the case froze one-shot naive-LLM solutions at approval
  (LLM-era controls #6). Similarity of the candidate's DELTA to each baseline's
  delta answers "what did the human add beyond the bare model?". NEVER a penalty
  (the fairness contract): high similarity only aims the authorship interview.

Pure + import-light so both are unit-testable without an LLM.
"""
from __future__ import annotations

import difflib
import re

# A canary's `flaw` quotes the flawed fragment; we accept '…', "…" or `…` quoting.
_QUOTE_RE = re.compile(r"[\"'`]([^\"'`]{4,200})[\"'`]")


def _fragment(flaw: str) -> str | None:
    """The longest quoted fragment in the flaw description — the checkable token."""
    frags = _QUOTE_RE.findall(flaw or "")
    return max(frags, key=len) if frags else None


# A canary verdict only means something when the submitted file is an EDIT of the
# seed file. Below this share of surviving seed lines, the file was rebuilt from a
# different base and "the flawed fragment is gone" carries no signal. Deliberately
# low: honest heavy edits keep imports/structure lines; full rewrites don't.
_DESCENT_MIN_SEED_LINE_SURVIVAL = 0.3


def _descends_from_seed(seed_body: str, sub_body: str) -> bool:
    seed_lines = [ln for ln in seed_body.splitlines() if ln.strip()]
    if not seed_lines:
        return True  # empty seed file — nothing to descend from, don't block grading
    sub_lines = set(sub_body.splitlines())
    survived = sum(1 for ln in seed_lines if ln in sub_lines)
    return survived / len(seed_lines) >= _DESCENT_MIN_SEED_LINE_SURVIVAL


def _by_path(files: list[dict] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for f in files or []:
        if isinstance(f, dict) and f.get("path"):
            out[str(f["path"])] = str(f.get("contents") or "")
    return out


def canary_outcomes(seed: dict | None, files: list[dict] | None, chat: list[dict] | None = None) -> list[dict]:
    """Per-canary verdicts. Empty list when the seed has no canaries or no
    submitted tree is available (repo submissions)."""
    canaries = [c for c in ((seed or {}).get("canaries") or []) if isinstance(c, dict)]
    submitted = _by_path(files)
    if not canaries or not submitted:
        return []
    seeded = _by_path((seed or {}).get("files"))
    # Everywhere the candidate could have CALLED OUT a flaw without editing it away:
    # the decision log + anything they said to the assistant/stakeholder.
    voiced = "\n".join(
        [submitted.get(p, "") for p in submitted if re.search(r"decision", p, re.IGNORECASE)]
        + [str(m.get("text") or "") for m in (chat or []) if isinstance(m, dict) and m.get("role") == "user"]
    ).lower()

    out: list[dict] = []
    for c in canaries:
        path = str(c.get("path") or "")
        frag = _fragment(str(c.get("flaw") or ""))
        seed_body = seeded.get(path, "")
        sub_body = submitted.get(path, "")
        if not frag or frag not in seed_body:
            status = "unverifiable"
            note = "flawed fragment could not be located in the seed — not graded"
        elif path not in submitted:
            # The canary's file is absent from the submitted tree (a partial/changed-files
            # submission that never touched it). The flaw was NOT addressed — it simply
            # survived unexamined. Without this, an absent file read as "fragment gone"
            # and scored a free "addressed" (case-sim round 2 finding).
            status = "propagated"
            note = "the canary's file was not part of the submission — the planted flaw survived untouched"
        elif not _descends_from_seed(seed_body, submitted[path]):
            # The submitted file does not descend from the seed version (a rewrite from
            # a different base, or a same-path file invented from scratch). "The fragment
            # is gone" proves nothing there — case-sim round 3: verdicts minted off a
            # foreign base fed the LLM judge as ground truth and INVERTED the ranking
            # (a delegator's invented file scored a free "addressed"). Unverifiable is
            # the honest verdict; the live interview grades it instead.
            status = "unverifiable"
            note = "submitted file does not descend from the seed version — not mechanically gradable"
        else:
            mentioned = bool(frag.lower() in voiced) or bool(path and path.lower() in voiced and "wrong" in voiced)
            if frag not in sub_body:
                status = "addressed"
                note = "the flawed fragment is gone from the submitted file"
            elif mentioned:
                status = "flagged"
                note = "flaw left in place but called out in the decision log / dialogue"
            else:
                status = "propagated"
                note = "the planted flaw survived into the submission untouched"
        out.append(
            {
                "id": str(c.get("id") or ""),
                "kind": str(c.get("kind") or ""),
                "path": path,
                "status": status,
                "note": note,
                # Internal context for the evaluator/followups — never candidate-facing.
                "reveals": str(c.get("reveals") or ""),
            }
        )
    return out


def _delta_paths(files: dict[str, str], seed: dict[str, str]) -> dict[str, str]:
    """The files that differ from the seed (the author's actual contribution)."""
    return {p: body for p, body in files.items() if seed.get(p, "") != body}


def _added_lines(seed_body: str, body: str) -> set[str]:
    """The non-blank lines in ``body`` that do not appear in the seed version —
    the author's line-level contribution to that file."""
    seed_lines = set(seed_body.splitlines())
    return {ln for ln in body.splitlines() if ln.strip() and ln not in seed_lines}


def baseline_similarity(baseline: dict | None, seed: dict | None, files: list[dict] | None) -> dict:
    """Similarity (0..1) of the submission's delta to each frozen one-shot baseline's
    delta. {available: False} when either side is missing.

    Comparison is Jaccard over ADDED LINES against the seed (case-sim round 2:
    whole-content SequenceMatcher collapsed to noise whenever the baseline solver's
    per-file clipping meant the two sides held different-sized copies of the same
    file — line-level contribution survives that). Files absent from the seed
    (created by both sides) compare over all their non-blank lines.
    """
    solutions = [s for s in ((baseline or {}).get("solutions") or []) if isinstance(s, dict)]
    submitted = _by_path(files)
    if not solutions or not submitted:
        return {"available": False, "bestSimilarity": 0.0, "perBaseline": []}
    seeded = _by_path((seed or {}).get("files"))
    sub_delta = _delta_paths(submitted, seeded)

    per: list[dict] = []
    for i, sol in enumerate(solutions):
        base_delta = _delta_paths(_by_path(sol.get("files")), seeded)
        paths = sorted(set(sub_delta) | set(base_delta))
        # Decision log is the candidate's own voice — exclude it from the mechanical
        # similarity so a shared log template can't inflate the score.
        paths = [p for p in paths if not re.search(r"decision", p, re.IGNORECASE)]
        if not paths:
            per.append({"baseline": i, "similarity": 0.0, "comparedPaths": 0})
            continue
        weighted = 0.0
        total = 0
        for p in paths:
            seed_body = seeded.get(p, "")
            a = _added_lines(seed_body, sub_delta.get(p, "")) if p in sub_delta else set()
            b = _added_lines(seed_body, base_delta.get(p, "")) if p in base_delta else set()
            union = a | b
            if not union:
                continue
            w = len(union)
            weighted += (len(a & b) / len(union)) * w
            total += w
        per.append({"baseline": i, "similarity": round(weighted / total, 3) if total else 0.0, "comparedPaths": len(paths)})
    best = max((p["similarity"] for p in per), default=0.0)
    return {"available": True, "bestSimilarity": best, "perBaseline": per}


# --- submission excerpts (W0.2) ---------------------------------------------
#
# The evaluation used to grade a summary of a summary: reflect_commits inferred
# behaviour from commit METADATA, assess_tooling read that inference, and
# evaluate_submission scored the two inferences — the candidate's actual work never
# reached any prompt (tiger devcase#2). The submitted tree was already parsed here for
# canaries and baseline distance; these excerpts hand the same tree to the graders so a
# probe verdict can cite a real file instead of the shape of a commit subject.
#
# Budgets are deliberate: the whole point is a bounded, highest-signal slice, not the
# repo. Added lines only (the author's contribution against the seed), biggest
# contribution first, hard-capped per file and overall.

_EXCERPT_MAX_FILES = 6
_EXCERPT_MAX_LINES_PER_FILE = 40
_EXCERPT_MAX_CHARS = 6000


def submission_excerpts(
    seed: dict | None,
    files: list[dict] | None,
    *,
    max_files: int = _EXCERPT_MAX_FILES,
    max_lines_per_file: int = _EXCERPT_MAX_LINES_PER_FILE,
    max_chars: int = _EXCERPT_MAX_CHARS,
) -> list[dict]:
    """The candidate's own contribution, excerpted for an evaluation prompt.

    One entry per changed file — ``{path, addedLines, addedLineCount, truncated}`` —
    ordered by how much was contributed, capped at ``max_files`` files /
    ``max_lines_per_file`` lines each / ``max_chars`` total. Returns ``[]`` when no tree
    was submitted (repo-link submissions), so every caller stays optional.

    Unlike :func:`baseline_similarity` the decision log is KEPT: there it would let a
    shared template inflate a similarity score, here it is the candidate's own reasoning
    and among the most gradable things they wrote.

    The content is candidate-authored and therefore adversarial — callers must fence it
    (``provenance.fenced_untrusted``) before it enters a prompt.
    """
    submitted = _by_path(files)
    if not submitted:
        return []
    seeded = _by_path((seed or {}).get("files"))
    changed = _delta_paths(submitted, seeded)

    ranked = sorted(
        ((p, sorted(_added_lines(seeded.get(p, ""), body))) for p, body in changed.items()),
        key=lambda item: (-len(item[1]), item[0]),
    )

    out: list[dict] = []
    budget = max_chars
    for path, added in ranked:
        if len(out) >= max_files or budget <= 0:
            break
        if not added:
            continue  # changed only by deletion/whitespace — no contributed line to show
        kept: list[str] = []
        for line in added[:max_lines_per_file]:
            clipped = line[:400]
            if len(clipped) > budget:
                break
            kept.append(clipped)
            budget -= len(clipped)
        if not kept:
            break
        out.append(
            {
                "path": path,
                "addedLines": kept,
                "addedLineCount": len(added),
                "truncated": len(kept) < len(added),
            }
        )
    return out


def check_evidence(canaries: list[dict], baseline: dict) -> list[str]:
    """Human-readable lines for the evaluation context / UI."""
    out: list[str] = []
    graded = [c for c in canaries if c.get("status") != "unverifiable"]
    if graded:
        caught = sum(1 for c in graded if c["status"] in ("addressed", "flagged"))
        out.append(f"Planted canaries: caught {caught}/{len(graded)} (" + ", ".join(f"{c['id']}:{c['status']}" for c in graded) + ").")
    if baseline.get("available"):
        sim = baseline.get("bestSimilarity") or 0.0
        if sim >= 0.85:
            out.append(f"Submission is ~{int(sim * 100)}% similar to the one-shot naive-LLM baseline — probe live what the candidate added beyond the bare model (not a score penalty).")
        elif sim > 0:
            out.append(f"Submission diverges from the one-shot baseline (similarity {sim:.2f}) — the human's own contribution is visible.")
    return out

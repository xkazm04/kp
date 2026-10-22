"""LLM-era controls #3 + #6 — mechanical checks against KNOWN ground truth.

Two deterministic evaluators over the submitted file tree (Live Work Surface
sessions submit their tree; both checks quietly no-op when files are absent):

* canary_outcomes — the seed carried planted flaws with known ground truth
  (seed_materializer v2). Per canary: was the flaw ADDRESSED (the flawed fragment
  is gone), FLAGGED (called out in the DECISIONS log or a stakeholder/assistant
  message), PROPAGATED (still present), or UNVERIFIABLE (the fragment could not be
  located in the seed, or nothing the candidate wrote either confirms or refutes the
  catch — no grading against noise, and never scored as a miss).

* baseline_similarity — the case froze one-shot naive-LLM solutions at approval
  (LLM-era controls #6). Similarity of the candidate's DELTA to each baseline's
  delta answers "what did the human add beyond the bare model?". NEVER a penalty
  (the fairness contract): high similarity only aims the authorship interview.

Pure + import-light so both are unit-testable without an LLM.
"""
from __future__ import annotations

import re

from .seed_materializer import MAX_FILE_CHARS as _MAX_FILE_CHARS

# A canary's `flaw` quotes the flawed fragment; we accept '…', "…" or `…` quoting.
_QUOTE_RE = re.compile(r"[\"'`]([^\"'`]{4,200})[\"'`]")

# "This is wrong" in every locale a case can be delivered in. The brief, the seed's
# DECISIONS scaffolding and both chat personas render in the posting's language
# (`devcase_cli --lang`), so the FLAGGED verdict below — flaw left in place but called
# out — must not depend on the candidate writing English. While this was the literal
# substring "wrong", a Czech candidate whose DECISIONS log said "config.py — RATE mi
# přijde špatně" scored `propagated` ("the planted flaw survived untouched"), the
# strongest negative the canary check can emit, for behaviour an English candidate got
# credit for. Direct equivalents only (a wider synonym set would over-credit, since a
# false FLAGGED reads to the evaluator as read-and-verified); "incorrect" is the one
# English addition — the exact synonym whose omission was the same artifact.
_FLAGGED_WRONG_RE = re.compile(
    r"\b(wrong|incorrect)\b"
    r"|\b(špatn|spatn|chybn|nesprávn|nespravn)"  # cs
    r"|\b(falsch)"  # de
    r"|\b(faux|fausse|erroné|errone)",  # fr
    re.IGNORECASE,
)


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


# A canary may also carry ``catchEvidence``: what a candidate who CAUGHT the flaw writes
# down, wherever they write it. The fragment rule above only sees an edit to the seeded
# file, and a work sample outside software is mostly answered in a NEW file (a ranking,
# a triage plan, a memo), so a family case's trap was ungradable or read as missed for
# exactly the candidates who caught it (council-lite T13 r1). Each group is a list of
# case-insensitive regexes, any of which satisfies the group; the trap counts as caught
# when ONE statement satisfies EVERY group (the account and its corrected figure, the
# ticket and the privacy reading of it). Only the candidate's own lines count: a line that
# appears anywhere in the seed never does, so the planted text quoted back cannot catch its
# own trap.
#
# council-lite T13 r2 found the rule misgrading plausible answers both ways, so it is
# stricter about WHAT counts as a statement and what it says:
#   * the unit is one line, not a three-line window: a triage that answers T-1047 as a slow
#     export and routes the next ticket to on-call on the following line was credited with
#     the catch. A short heading line naming the subject is read with the line after it.
#   * the FIRST group is the subject (the account, the ticket) and is matched as written;
#     every later group is the substance and is matched with the seed's own phrasing masked
#     out, so echoing the queue notes ("security, privacy or billing integrity go to the
#     on-call lead") or an instruction is not a catch.
#   * a substance match negated earlier in its clause ("none are below 44 px") does not
#     count.
# A canary may carry ``missEvidence`` in the same shape: what a candidate who carried the
# flaw writes (the stale figure, the speed-complaint reading). It is matched as written —
# the paste IS the evidence — and so is the flawed fragment itself appearing in any file
# the candidate wrote. With neither a catch nor a miss to point at, the verdict is
# ``unverifiable``: the planted-canary standard grades only what the work shows.
_SHINGLE = 4
_HEADING_MAX_CHARS = 60
_WORD_RE = re.compile(r"\w+", re.UNICODE)
_NEGATOR_RE = re.compile(
    r"\b(?:no|not|none|never|nothing|neither|nor|without|cannot)\b|n't\b"
    r"|\b(?:žádn\w*|není|nejsou|nikdy|nic)\b"  # cs
    r"|\b(?:kein\w*|nicht|nie)\b"  # de
    r"|\b(?:aucun\w*|pas|jamais|sans)\b",  # fr
    re.IGNORECASE,
)
_CLAUSE_BREAK_RE = re.compile(r"[.;:!?,()\[\]|—–]|\s-\s|\b(?:but|however|ale|avšak|jenže|aber|mais)\b", re.IGNORECASE)


def _contributed_blocks(seeded: dict[str, str], submitted: dict[str, str], chat: list[dict] | None) -> list[list[str]]:
    """The candidate's own lines, one block per submitted file and per chat message they
    sent, with every line the seed already carried (in any file) left out."""
    seed_lines = {ln.strip() for body in seeded.values() for ln in body.splitlines() if ln.strip()}
    texts = [submitted[p] for p in sorted(submitted)]
    texts += [str(m.get("text") or "") for m in (chat or []) if isinstance(m, dict) and m.get("role") == "user"]
    blocks = []
    for text in texts:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip() and ln.strip() not in seed_lines]
        if lines:
            blocks.append(lines)
    return blocks


def seed_shingles(seeded: dict[str, str] | list[str]) -> frozenset[tuple[str, ...]]:
    """Every run of ``_SHINGLE`` consecutive words in the seed — the phrasing an echo
    reuses. Accepts the path->body map or bare texts."""
    texts = seeded.values() if isinstance(seeded, dict) else seeded
    out: set[tuple[str, ...]] = set()
    for body in texts:
        words = [w.lower() for w in _WORD_RE.findall(body)]
        out.update(tuple(words[i : i + _SHINGLE]) for i in range(len(words) - _SHINGLE + 1))
    return frozenset(out)


def _mask_echo(line: str, shingles: frozenset[tuple[str, ...]]) -> str:
    """The line with every word that sits in a seed-phrased run blanked out."""
    if not shingles:
        return line
    spans = [(m.start(), m.end(), m.group().lower()) for m in _WORD_RE.finditer(line)]
    masked = [False] * len(spans)
    for i in range(len(spans) - _SHINGLE + 1):
        if tuple(s[2] for s in spans[i : i + _SHINGLE]) in shingles:
            for j in range(i, i + _SHINGLE):
                masked[j] = True
    chars = list(line)
    for (start, end, w), m in zip(spans, masked):
        # A figure is the candidate's own arithmetic even beside the seed's words
        # ("LinkedIn ads: 15%, EUR 1,800" against the draft's "EUR 1,500").
        if m and not any(ch.isdigit() for ch in w):
            chars[start:end] = " " * (end - start)
    return "".join(chars)


def _negated(text: str, start: int) -> bool:
    """A negator earlier in the clause that holds ``start``."""
    head = text[:start]
    breaks = list(_CLAUSE_BREAK_RE.finditer(head))
    clause = head[breaks[-1].end() :] if breaks else head
    return bool(_NEGATOR_RE.search(clause))


def _affirmed(rx: re.Pattern, text: str) -> bool:
    return any(not _negated(text, m.start()) for m in rx.finditer(text))


def _statements(lines: list[str], subject: list[re.Pattern]) -> list[str]:
    """Lines, with a short subject-only heading read together with the line after it."""
    out: list[str] = []
    for i, ln in enumerate(lines):
        out.append(ln)
        heading = ln.startswith("#") or ln.endswith(":") or len(ln) <= _HEADING_MAX_CHARS
        if heading and i + 1 < len(lines) and any(rx.search(ln) for rx in subject):
            out.append(f"{ln}\n{lines[i + 1]}")
    return out


def _compile(groups: list[list[str]] | None) -> list[list[re.Pattern]]:
    return [[re.compile(rx, re.IGNORECASE) for rx in g] for g in (groups or []) if g]


def evidence_caught(
    groups: list[list[str]] | None, blocks: list[list[str]], shingles: frozenset[tuple[str, ...]] = frozenset()
) -> bool:
    """True when one statement states the catch: the subject (group one) as written, every
    later group affirmed in the statement with the seed's phrasing (``shingles``) masked."""
    compiled = _compile(groups)
    if not compiled:
        return False
    subject, substance = compiled[0], compiled[1:]
    for lines in blocks:
        for unit in _statements(lines, subject):
            if not any(rx.search(unit) for rx in subject):
                continue
            body = _mask_echo(unit, shingles)
            if all(any(_affirmed(rx, body) for rx in g) for g in substance):
                return True
    return False


def evidence_missed(groups: list[list[str]] | None, blocks: list[list[str]]) -> bool:
    """True when one statement carries the flaw: every group matched as written."""
    compiled = _compile(groups)
    if not compiled:
        return False
    for lines in blocks:
        for unit in _statements(lines, compiled[0]):
            if all(any(rx.search(unit) for rx in g) for g in compiled):
                return True
    return False


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

    blocks: list[list[str]] | None = None
    shingles: frozenset[tuple[str, ...]] | None = None

    out: list[dict] = []
    for c in canaries:
        path = str(c.get("path") or "")
        frag = _fragment(str(c.get("flaw") or ""))
        seed_body = seeded.get(path, "")
        sub_body = submitted.get(path, "")
        groups = c.get("catchEvidence") if isinstance(c.get("catchEvidence"), list) else None
        if groups:
            if blocks is None:
                blocks = _contributed_blocks(seeded, submitted, chat)
                shingles = seed_shingles(seeded)
            stated = evidence_caught(groups, blocks, shingles or frozenset())
        else:
            stated = False
        located = bool(frag) and frag in seed_body
        edited = path in submitted and sub_body != seed_body
        if groups and not (located and edited and _descends_from_seed(seed_body, sub_body)):
            # An evidence-bearing canary is gradable in ANY file the candidate submitted:
            # the ground truth stated in their own work is the catch, the flaw carried
            # into it (the miss evidence, or the flawed fragment itself in a file they
            # wrote) the miss, and neither is no signal. The seeded file handed back
            # untouched is not an edit of it. (An edit still goes through the fragment
            # rule below.)
            miss = c.get("missEvidence") if isinstance(c.get("missEvidence"), list) else None
            written = [body for p, body in submitted.items() if p != path and body != seeded.get(p)]
            written += [str(m.get("text") or "") for m in (chat or []) if isinstance(m, dict) and m.get("role") == "user"]
            carried = bool(frag) and any(frag.lower() in body.lower() for body in written)
            if stated:
                status = "flagged"
                note = "the candidate's own work states the ground truth the planted flaw contradicts"
            elif carried or evidence_missed(miss, blocks or []):
                status = "propagated"
                note = "the candidate's own work carries the planted flaw — it went uncaught"
            else:
                status = "unverifiable"
                note = "nothing the candidate wrote either states the ground truth or carries the flaw — not graded"
        elif not located:
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
            mentioned = stated or bool(frag.lower() in voiced) or bool(
                path and path.lower() in voiced and _FLAGGED_WRONG_RE.search(voiced)
            )
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


def _added_lines_in_order(seed_body: str, body: str) -> list[str]:
    """:func:`_added_lines` in the order the author WROTE them (first occurrence wins) —
    a decision log is a sequence, and a sorted set reads it alphabetised."""
    seed_lines = set(seed_body.splitlines())
    seen: set[str] = set()
    out: list[str] = []
    for ln in body.splitlines():
        if ln.strip() and ln not in seed_lines and ln not in seen:
            seen.add(ln)
            out.append(ln)
    return out


def baseline_similarity(baseline: dict | None, seed: dict | None, files: list[dict] | None) -> dict:
    """Similarity (0..1) of the submission's delta to each frozen one-shot baseline's
    delta. {available: False} when either side is missing.

    Comparison is Jaccard over ADDED LINES against the seed (case-sim round 2:
    whole-content SequenceMatcher collapsed to noise whenever the baseline solver's
    per-file clipping meant the two sides held different-sized copies of the same
    file — line-level contribution survives that). Files absent from the seed
    (created by both sides) compare over all their non-blank lines.

    A path is NOT comparable when the baseline's copy sits at the generation budget
    (``MAX_FILE_CHARS``, where ``baseline.coerce`` clips) and the submitted copy is
    longer: the baseline's added lines stop at the clip while the submission's do not,
    so every candidate, a pure delegator included, reads as original. Such paths are
    dropped and named in ``budgetExceededPaths``; with nothing left the result is
    ``available: False`` (no signal), never a number from a broken ruler.
    """
    solutions = [s for s in ((baseline or {}).get("solutions") or []) if isinstance(s, dict)]
    submitted = _by_path(files)
    if not solutions or not submitted:
        return {"available": False, "bestSimilarity": 0.0, "perBaseline": []}
    seeded = _by_path((seed or {}).get("files"))
    sub_delta = _delta_paths(submitted, seeded)

    per: list[dict] = []
    over_all: set[str] = set()
    for i, sol in enumerate(solutions):
        base_delta = _delta_paths(_by_path(sol.get("files")), seeded)
        paths = sorted(set(sub_delta) | set(base_delta))
        # Decision log is the candidate's own voice — exclude it from the mechanical
        # similarity so a shared log template can't inflate the score.
        paths = [p for p in paths if not re.search(r"decision", p, re.IGNORECASE)]
        base_files = _by_path(sol.get("files"))
        over = [
            p for p in paths
            if len(base_files.get(p, "")) >= _MAX_FILE_CHARS and len(submitted.get(p, "")) > _MAX_FILE_CHARS
        ]
        over_all.update(over)
        paths = [p for p in paths if p not in over]
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
    if over_all and all(p["comparedPaths"] == 0 for p in per):
        return {"available": False, "bestSimilarity": 0.0, "perBaseline": per, "budgetExceededPaths": sorted(over_all)}
    best = max((p["similarity"] for p in per), default=0.0)
    out: dict = {"available": True, "bestSimilarity": best, "perBaseline": per}
    if over_all:
        out["budgetExceededPaths"] = sorted(over_all)
    return out


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
        ((p, _added_lines_in_order(seeded.get(p, ""), body)) for p, body in changed.items()),
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

"""Synthetic candidate submissions for testing the evaluation side (Part 2).

Each archetype is a git trace (commit messages, NEWEST-FIRST — as GitHub returns them) that
embodies a known behaviour, so we can check the evaluator DISCRIMINATES: a 'strong' candidate
(reads first, tests, recovers) should outrank a 'naive one-shot' or an 'AI-over-reliant' one
who looks productive but never verifies. Same planted-defect philosophy as scenarios.py, but
for the submission/evaluation half of the lifecycle. Expandable to non-IT later.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SubmissionArchetype:
    name: str
    expected: str  # "strong" | "weak"
    commit_messages: list[str]  # newest-first (IT/software flavour)
    general_messages: list[str] = field(default_factory=list)  # non-IT flavour (work/process trace)


ARCHETYPES: list[SubmissionArchetype] = [
    SubmissionArchetype(
        "strong",
        "strong",
        commit_messages=[
            "docs: write up assumptions + one open question for the reviewer",
            "test: add coverage for the tricky edge case I found",
            "fix: handle the edge case surfaced while reading the legacy module",
            "feat: implement the feature behind the existing contract",
            "test: add a failing test for the new behaviour first",
            "explore: read ingest.py and the existing tests before changing anything",
        ],
        general_messages=[
            "write up assumptions + one open question for the reviewer",
            "validate: fact-check the key numbers/claims against the source",
            "fix the error I found while reviewing the existing materials",
            "produce the core deliverable per the brief",
            "outline + a first draft to check direction with a stakeholder",
            "review and understand the existing materials and brand/style before drafting",
        ],
    ),
    SubmissionArchetype(
        "naive_oneshot",
        "weak",
        commit_messages=["fix typo", "implement the whole task"],
        general_messages=["fix a typo", "do the whole deliverable in one pass"],
    ),
    SubmissionArchetype(
        "ai_overreliant",
        "weak",
        commit_messages=["final", "fix lint errors", "make the failing tests pass", "add more code", "implement everything in one go"],
        general_messages=["final", "polish the wording", "make it look finished", "add more sections", "generate the whole deliverable at once"],
    ),
    SubmissionArchetype(
        "thrasher",
        "weak",
        commit_messages=["actually fix it this time", "revert the revert", "does this even work?", "revert previous attempt", "try a completely different approach", "first attempt"],
        general_messages=["redo it again", "scrap that version", "does this read right?", "revert previous draft", "try a completely different angle", "first attempt"],
    ),
]


def commit_trace(arch: SubmissionArchetype, domain: str = "it") -> list[dict]:
    """A trace shaped like the GitHub fetch (sha, message, date), newest-first. For non-IT
    domains the trace is a work/process log; the evaluator's LLM path reads it the same way."""
    msgs = arch.commit_messages if domain == "it" or not arch.general_messages else arch.general_messages
    return [
        {"sha": f"{arch.name[:3]}{i:02d}", "message": m, "date": f"2026-05-{20 - i:02d}T10:00:00Z"}
        for i, m in enumerate(msgs)
    ]


def all_submissions(domain: str = "it") -> list[tuple[SubmissionArchetype, list[dict]]]:
    return [(a, commit_trace(a, domain)) for a in ARCHETYPES]

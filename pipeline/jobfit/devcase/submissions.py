"""Synthetic candidate submissions for testing the evaluation side (Part 2).

Each archetype is a git trace (commit messages, NEWEST-FIRST — as GitHub returns them) that
embodies a known behaviour, so we can check the evaluator DISCRIMINATES: a 'strong' candidate
(reads first, tests, recovers) should outrank a 'naive one-shot' or an 'AI-over-reliant' one
who looks productive but never verifies. Same planted-defect philosophy as scenarios.py, but
for the submission/evaluation half of the lifecycle. Expandable to non-IT later.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SubmissionArchetype:
    name: str
    expected: str  # "strong" | "weak"
    commit_messages: list[str]  # newest-first


ARCHETYPES: list[SubmissionArchetype] = [
    SubmissionArchetype(
        "strong",
        "strong",
        [
            "docs: write up assumptions + one open question for the reviewer",
            "test: add coverage for the tricky edge case I found",
            "fix: handle the edge case surfaced while reading the legacy module",
            "feat: implement the feature behind the existing contract",
            "test: add a failing test for the new behaviour first",
            "explore: read ingest.py and the existing tests before changing anything",
        ],
    ),
    SubmissionArchetype(
        "naive_oneshot",
        "weak",
        [
            "fix typo",
            "implement the whole task",
        ],
    ),
    SubmissionArchetype(
        "ai_overreliant",
        "weak",
        [
            "final",
            "fix lint errors",
            "make the failing tests pass",
            "add more code",
            "implement everything in one go",
        ],
    ),
    SubmissionArchetype(
        "thrasher",
        "weak",
        [
            "actually fix it this time",
            "revert the revert",
            "does this even work?",
            "revert previous attempt",
            "try a completely different approach",
            "first attempt",
        ],
    ),
]


def commit_trace(arch: SubmissionArchetype) -> list[dict]:
    """A commit trace shaped like the GitHub fetch (sha, message, date), newest-first."""
    n = len(arch.commit_messages)
    return [
        {"sha": f"{arch.name[:3]}{i:02d}", "message": m, "date": f"2026-05-{20 - i:02d}T10:00:00Z"}
        for i, m in enumerate(arch.commit_messages)
    ]


def all_submissions() -> list[tuple[SubmissionArchetype, list[dict]]]:
    return [(a, commit_trace(a)) for a in ARCHETYPES]

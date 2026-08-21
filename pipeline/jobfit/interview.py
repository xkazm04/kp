"""Mock interview question generator grounded in CV gaps.

Uses the existing job_fit signals (missing skills, must-prove evidence,
recruiter risk flags) plus the candidate profile to generate 8-12 likely
interview questions split into behavioral, technical, and red-flag-defense
buckets, each with a STAR-style answer scaffold drawn from the candidate.
Every question is tied to a specific evidence gap so the user knows exactly
what experience to surface.
"""

from __future__ import annotations

import re

from .models import CandidateProfile, InterviewKit, InterviewQuestion, JobFitResult, StarScaffold


# --- "there are no risks" is not a risk ---------------------------------------
# `recruiter_risk_flags` is a free-text LLM list with no "return [] when clean"
# contract, so a clean CV routinely comes back as a SENTENCE saying there are none
# ("No major red flags", "No significant concerns identified"). Fed forward
# verbatim, that absence becomes an accusation: a red-flag-defense question asking
# the candidate to explain away "no significant concerns", an ANTIPATTERN row in
# the soft-signal panel (soft_signals._folded_risk_flags), and a phantom entry in
# the evidence-gap count. The original guard tested only for the literal substring
# "no major", so every other phrasing of the same non-finding slipped through.
#
# Matched CONSERVATIVELY — a leading negative quantifier followed only by
# intensifier adjectives and then a risk noun. A genuine finding that merely opens
# with "No" ("No evidence of Kubernetes in the CV", "Candidate lists no
# certifications, which is a concern for the compliance requirement") names no risk
# noun in that position and is kept. The original "no major" substring test is kept
# as an explicit OR so this can only ever filter MORE non-findings, never fewer.
_NO_RISK_RE = re.compile(
    r"\b(?:no|none|nil|zero|nothing)\b"
    r"(?:\s+(?:major|significant|obvious|serious|severe|real|notable|apparent|immediate|"
    r"critical|glaring|clear|specific|particular|other|further|additional|material))*"
    r"\s+(?:red[\s-]flags?|risks?|concerns?|concerning|issues?|blockers?|warnings?|"
    r"problems?|reservations?|gaps?|weaknesses?)\b",
    re.IGNORECASE,
)

# A model answering "nothing to report" with a bare token rather than a sentence.
# Whole-string match only, so it can never swallow a real finding.
_BARE_NEGATIVE_RE = re.compile(r"^\W*(?:none|nil|n\s*/\s*a|na|nothing|no)\W*$", re.IGNORECASE)


def is_no_risk_statement(flag: str) -> bool:
    """True when a ``recruiter_risk_flags`` entry ASSERTS THE ABSENCE of a risk.

    Such an entry must never be surfaced as a finding — see the note above. Shared
    with :mod:`soft_signals` so the interview kit, the gap count, and the antipattern
    panel can't disagree about what counts as a real flag.
    """
    text = (flag or "").strip()
    if not text:
        return True
    if "no major" in text.casefold():  # the original marker, preserved verbatim
        return True
    return bool(_BARE_NEGATIVE_RE.match(text) or _NO_RISK_RE.search(text))


def real_risk_flags(job_fit: JobFitResult | None) -> list[str]:
    """The ``recruiter_risk_flags`` that actually name a risk. Empty for ``None``."""
    return [f for f in (getattr(job_fit, "recruiter_risk_flags", None) or []) if not is_no_risk_statement(f)]


_BEHAVIORAL_TARGET = 4
_TECHNICAL_TARGET = 4
_RED_FLAG_TARGET = 3
_MAX_QUESTIONS = 12
_MIN_QUESTIONS = 8


def build_interview_kit(
    candidate: CandidateProfile,
    job_fit: JobFitResult | None,
) -> InterviewKit | None:
    """Generate a mock interview kit grounded in the candidate's evidence gaps.

    Returns ``None`` when there's no job_fit context — the kit is only useful
    against a target role description.
    """
    if job_fit is None:
        return None

    behavioral = _behavioral_questions(candidate, job_fit)
    technical = _technical_questions(candidate, job_fit)
    red_flag = _red_flag_questions(candidate, job_fit)

    questions: list[InterviewQuestion] = []
    questions.extend(behavioral[:_BEHAVIORAL_TARGET])
    questions.extend(technical[:_TECHNICAL_TARGET])
    questions.extend(red_flag[:_RED_FLAG_TARGET])

    if len(questions) < _MIN_QUESTIONS:
        for fallback in _fallback_questions(candidate, job_fit):
            if len(questions) >= _MIN_QUESTIONS:
                break
            questions.append(fallback)

    questions = questions[:_MAX_QUESTIONS]
    summary = _summary(candidate, job_fit, questions)
    return InterviewKit(summary=summary, questions=questions)


def _behavioral_questions(candidate: CandidateProfile, job_fit: JobFitResult) -> list[InterviewQuestion]:
    candidate_label = candidate.name or "you"
    role_label = candidate.role_family.replace("_", " ")
    top_skills = ", ".join(candidate.skills[:3]) if candidate.skills else "your strongest recent delivery area"
    proof_points = job_fit.must_prove_evidence or []

    questions: list[InterviewQuestion] = []

    if proof_points:
        first_proof = proof_points[0]
        questions.append(
            InterviewQuestion(
                bucket="behavioral",
                question=(
                    f"Walk us through a recent project where you had to demonstrate {_humanize(first_proof)}. "
                    "What was the outcome?"
                ),
                evidence_gap=f"Must-prove: {first_proof}",
                star_scaffold=StarScaffold(
                    situation=(
                        f"Anchor in a recent {role_label} engagement where {_humanize(first_proof)} was the central concern."
                    ),
                    task=(
                        f"Frame {candidate_label} as the owner of the outcome — what was on the line, who was the stakeholder?"
                    ),
                    action=(
                        f"Cite concrete steps using {top_skills}: design choice, instrumentation, validation, and the call you made."
                    ),
                    result=(
                        "Quantify: time saved, defects avoided, users impacted, or delivery speed — and what you would change."
                    ),
                ),
            )
        )

    if len(proof_points) > 1:
        second_proof = proof_points[1]
        questions.append(
            InterviewQuestion(
                bucket="behavioral",
                question=(
                    f"Tell us about a time you had to prove {_humanize(second_proof)} to a skeptical stakeholder."
                ),
                evidence_gap=f"Must-prove: {second_proof}",
                star_scaffold=StarScaffold(
                    situation="Pick a moment of disagreement or uncertainty inside a delivery you led.",
                    task=(
                        f"Make explicit what {candidate_label} was accountable for and the decision criteria."
                    ),
                    action=(
                        "Walk through how you mapped data/evidence to the stakeholder's risk model — meeting, doc, demo."
                    ),
                    result=(
                        "Close with the call that was made, the measurable improvement, and the trust earned for the next decision."
                    ),
                ),
            )
        )

    questions.append(
        InterviewQuestion(
            bucket="behavioral",
            question=(
                "Describe a delivery where you had to translate ambiguous business goals into a working technical plan."
            ),
            evidence_gap="Stakeholder/business-analysis evidence",
            star_scaffold=StarScaffold(
                situation="Choose a project where the brief landed vague — pick one with a real handoff to engineering.",
                task="State the gap you owned: missing requirements, conflicting priorities, or unclear success metric.",
                action=(
                    f"Show your discovery loop — interviews, written requirements, prototypes — and the tooling ({top_skills})."
                ),
                result="End with the shipped scope, who validated it, and the metric that proved the translation worked.",
            ),
        )
    )

    if len(proof_points) > 2:
        third_proof = proof_points[2]
        questions.append(
            InterviewQuestion(
                bucket="behavioral",
                question=(
                    f"Give us an example that shows {_humanize(third_proof)} in your day-to-day work."
                ),
                evidence_gap=f"Must-prove: {third_proof}",
                star_scaffold=StarScaffold(
                    situation="Pick a recurring situation, not a one-off — interviewers want repeatable habits.",
                    task="Describe what you owned and the constraint that made it non-trivial.",
                    action=(
                        f"Show the technique you applied (drawn from {top_skills}) and the tradeoff you accepted."
                    ),
                    result="Close with the change in team velocity, defect rate, or stakeholder confidence.",
                ),
            )
        )

    return questions


def _technical_questions(candidate: CandidateProfile, job_fit: JobFitResult) -> list[InterviewQuestion]:
    questions: list[InterviewQuestion] = []
    matching = candidate.skills[:5]
    matching_label = ", ".join(matching) if matching else "your strongest stack"
    missing = job_fit.missing_skills or []

    for skill in missing[:3]:
        questions.append(
            InterviewQuestion(
                bucket="technical",
                question=(
                    f"How would you design or evaluate a solution that requires {skill}? "
                    "Walk us through the architecture and the tradeoffs."
                ),
                evidence_gap=f"Missing skill keyword: {skill}",
                star_scaffold=StarScaffold(
                    situation=(
                        f"Bridge from your closest analog using {matching_label} — name the project where you faced the same problem class."
                    ),
                    task="Define the requirements: scale, latency, reliability, evaluation, governance, cost.",
                    action=(
                        f"Sketch the architecture, then explicitly map each component to whether you'd use {skill} or a substitute, and why."
                    ),
                    result=(
                        "End with the validation plan and how you would close the gap (course, side project, mentor, sandbox) inside 30 days."
                    ),
                ),
            )
        )

    if matching:
        questions.append(
            InterviewQuestion(
                bucket="technical",
                question=(
                    f"Pick one of your strongest tools ({matching[0]}) and tell us when you would NOT use it on this role."
                ),
                evidence_gap="Self-aware tooling judgement (matching skill calibration)",
                star_scaffold=StarScaffold(
                    situation="Frame a real tradeoff you have lived through, not a textbook one.",
                    task="State the constraint that pushed you off the default tool.",
                    action="Describe the alternative you reached for and the criteria you used to switch.",
                    result="Close with the cost you paid and the cost you avoided — interviewers reward tool humility.",
                ),
            )
        )

    questions.append(
        InterviewQuestion(
            bucket="technical",
            question=(
                "Take one AI/automation feature you shipped to production. How did you evaluate quality before and after release?"
            ),
            evidence_gap="AI delivery quality (evaluation, validation, monitoring)",
            star_scaffold=StarScaffold(
                situation=f"Pick the highest-impact AI delivery in your timeline — something using {matching_label}.",
                task="State the quality bar you committed to and who held you accountable to it.",
                action=(
                    "Show the eval setup: dataset, metrics, baseline, regression checks, prompt/version control, human review."
                ),
                result="Close with what the metric did over time and what you would build first if you started again.",
            ),
        )
    )

    if len(missing) > 3:
        skill = missing[3]
        questions.append(
            InterviewQuestion(
                bucket="technical",
                question=(
                    f"If we asked you to ramp on {skill} in the first 30 days, what would your plan look like?"
                ),
                evidence_gap=f"Ramp-up plan for missing skill: {skill}",
                star_scaffold=StarScaffold(
                    situation="Ground the plan in a real ramp you have done before — show the pattern, not a wish list.",
                    task="Define what 'productive in 30 days' means for this role and stakeholder.",
                    action=(
                        f"Lay out week-by-week milestones bridging from {matching_label} into {skill}: reading, sandbox, shadowing, first PR."
                    ),
                    result="End with the deliverable you would commit to at day 30 and how you'd let the team verify it.",
                ),
            )
        )

    return questions


def _red_flag_questions(candidate: CandidateProfile, job_fit: JobFitResult) -> list[InterviewQuestion]:
    candidate_label = candidate.name or "the candidate"
    questions: list[InterviewQuestion] = []
    flags = real_risk_flags(job_fit)

    for flag in flags[:_RED_FLAG_TARGET]:
        humanized = _humanize(flag)
        questions.append(
            InterviewQuestion(
                bucket="red-flag-defense",
                question=(
                    f"A recruiter reading your CV might worry that {humanized.lower()}. How do you address that head-on?"
                ),
                evidence_gap=f"Recruiter risk: {flag}",
                star_scaffold=StarScaffold(
                    situation="Acknowledge the concern in one sentence — defensiveness reads worse than the gap itself.",
                    task=(
                        f"Reframe it as the question {candidate_label} would ask in their place, and show you've thought it through."
                    ),
                    action=(
                        "Cite the closest evidence you DO have, plus the deliberate plan to close the rest "
                        "(timeline, mentor, sandbox project, side delivery)."
                    ),
                    result=(
                        "Close with a concrete proof point — a project, metric, or testimonial — and offer a follow-up artifact."
                    ),
                ),
            )
        )

    if not flags:
        questions.append(
            InterviewQuestion(
                bucket="red-flag-defense",
                question=(
                    "Walk us through the weakest part of your CV against this role and how you would compensate for it."
                ),
                evidence_gap="Self-assessed gap (no recruiter flag detected)",
                star_scaffold=StarScaffold(
                    situation="Pick one real gap — interviewers reward calibration, not bravado.",
                    task="Frame the gap in terms of role outcomes, not missing keywords.",
                    action="Show your closest analog evidence and the explicit plan to close the rest.",
                    result="End with a measurable commitment for the first 90 days that the interviewer can hold you to.",
                ),
            )
        )

    return questions


def _fallback_questions(candidate: CandidateProfile, job_fit: JobFitResult) -> list[InterviewQuestion]:
    candidate_label = candidate.name or "you"
    matches = ", ".join(job_fit.matching_skills[:3]) if job_fit.matching_skills else "your strongest delivery area"
    return [
        InterviewQuestion(
            bucket="behavioral",
            question=(
                f"What is the strongest signal that {candidate_label} would thrive on this team within the first 90 days?"
            ),
            evidence_gap="Cultural and onboarding fit",
            star_scaffold=StarScaffold(
                situation="Pick a comparable team transition you have done before.",
                task="Define what 'thriving' meant in that context — usually a stakeholder, not a metric.",
                action=f"Show the rituals you set up using {matches}: rapid wins, documentation, paired delivery.",
                result="Close with the moment the team trusted you with a harder problem.",
            ),
        ),
        InterviewQuestion(
            bucket="technical",
            question=(
                f"Pick a recent decision you made using {matches} and explain the alternative you rejected and why."
            ),
            evidence_gap="Decision quality on matching strengths",
            star_scaffold=StarScaffold(
                situation="Choose a fork in the road, not a smooth path.",
                task="State the criteria you used to compare the options.",
                action="Walk through the rejected option's failure mode in concrete terms.",
                result="Close with how the chosen path proved out in production.",
            ),
        ),
    ]


def _summary(
    candidate: CandidateProfile,
    job_fit: JobFitResult,
    questions: list[InterviewQuestion],
) -> str:
    name = candidate.name or "Candidate"
    behavioral = sum(1 for question in questions if question.bucket == "behavioral")
    technical = sum(1 for question in questions if question.bucket == "technical")
    red_flag = sum(1 for question in questions if question.bucket == "red-flag-defense")
    gap_count = len(job_fit.missing_skills or []) + len(real_risk_flags(job_fit))
    return (
        f"{name}: {len(questions)} mock questions ({behavioral} behavioral, {technical} technical, "
        f"{red_flag} red-flag-defense) tied to {gap_count} evidence gap(s) from the job description."
    )


def _humanize(text: str) -> str:
    cleaned = text.strip().rstrip(".:")
    return cleaned[:200] if cleaned else "this expectation"

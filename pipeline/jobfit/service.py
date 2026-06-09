from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .extractors import extract_text
from .pipeline import analyze_cv

ProgressCallback = Callable[[str, str], None]


def analyze(
    cv_path: Path,
    *,
    grounding: bool = False,
    job_description_path: Path | None = None,
    job_description_text: str | None = None,
    company_path: Path | None = None,
    company_text: str | None = None,
    lang: str = "en",
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Run the CV analysis pipeline and return its serialized result.

    ``lang`` is the output locale for the LLM-generated narrative (en | cs);
    canonical code values, skills, and proper nouns stay verbatim regardless.
    """
    job_text = job_description_text
    if job_description_path is not None:
        job_text = extract_text(job_description_path)

    company = company_text
    if company_path is not None:
        company = extract_text(company_path)

    result = analyze_cv(
        cv_path,
        job_description_text=job_text,
        company_text=company,
        use_grounding=grounding,
        lang=lang,
        progress=progress,
    )

    return result.model_dump(by_alias=True, exclude_none=True)

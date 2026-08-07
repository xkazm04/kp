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
    job_json_path: Path | None = None,
    company_path: Path | None = None,
    company_text: str | None = None,
    lang: str = "en",
    progress: ProgressCallback | None = None,
    blind: bool = False,
) -> dict[str, Any]:
    """Run the CV analysis pipeline and return its serialized result.

    ``lang`` is the output locale for the LLM-generated narrative (en | cs);
    canonical code values, skills, and proper nouns stay verbatim regardless.
    """
    job_text = job_description_text
    if job_description_path is not None:
        job_text = extract_text(job_description_path)

    # The structured Job record backing the JD (optional). Read here, parsed +
    # validated INSIDE analyze_cv so a malformed file degrades to a repair note
    # on the result instead of failing the whole (paid) analysis.
    job_json = job_json_path.read_text(encoding="utf-8") if job_json_path is not None else None

    company = company_text
    if company_path is not None:
        company = extract_text(company_path)

    result = analyze_cv(
        cv_path,
        job_description_text=job_text,
        job_json=job_json,
        company_text=company,
        use_grounding=grounding,
        lang=lang,
        progress=progress,
        blind=blind,
    )

    return result.model_dump(by_alias=True, exclude_none=True)

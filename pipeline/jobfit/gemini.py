from __future__ import annotations

import json
import mimetypes
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

from google import genai
from google.genai import types

from .taxonomy import ROLE_FAMILIES


GEMINI_MODEL = "gemini-3-flash-preview"


ANALYSIS_RESPONSE_SCHEMA = {
    "profile": {
        "raw_text": "complete extracted profile text with diacritics preserved",
        "name": "candidate name or null",
        "headline": "one-line professional headline",
        "years_experience": "number, total relevant years",
        "current_seniority": "one of: junior | medior | senior | lead",
        "role_family": f"one of: {' | '.join(ROLE_FAMILIES)}",
        "skills": ["..."],
        "education_level": "one of: phd | master | bachelor | university | unknown",
        "languages": ["..."],
        "traits": ["..."],
        "evidence": ["short factual signals supporting the assessment"],
        "parsing_notes": ["notes about the document or extraction"],
    },
    "score": {
        "total": "integer 0-100",
        "experience": "integer 0-25",
        "skills": "integer 0-30",
        "role_seniority": "integer 0-23",
        "education": "integer 0-12",
        "traits": "integer 0-10",
    },
    "salary": {
        "currency": "CZK",
        "period": "month",
        "minimum": "integer monthly gross",
        "maximum": "integer monthly gross",
        "midpoint": "integer monthly gross",
        "confidence": "one of: low | medium | high | grounded",
        "rationale": ["..."],
    },
    "market_evidence": {
        "summary": "current Czech tech market context for this profile",
        "suggested_minimum_czk": "integer or null",
        "suggested_maximum_czk": "integer or null",
        "confidence": "one of: low | medium | high",
        "notes": ["..."],
    },
    "strengths": ["..."],
    "gaps": ["..."],
    "recommendations": ["..."],
    "explanation": "concise 3-5 sentence explanation of score and salary",
    "job_fit": {
        "score": "integer 0-100",
        "summary": "...",
        "matching_skills": ["..."],
        "missing_skills": ["..."],
        "seniority_alignment": "...",
        "role_alignment": "...",
        "salary_assessment": "...",
        "recommendations": ["..."],
        "interview_talking_points": ["..."],
        "cv_rewrite_suggestions": ["..."],
        "must_prove_evidence": ["..."],
        "negotiation_angle": "...",
        "recruiter_risk_flags": ["..."],
    },
}


def load_local_env() -> None:
    if load_dotenv is None:
        return
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env.local", override=False)
    load_dotenv(root / ".env", override=False)


def get_gemini_api_key() -> str:
    load_local_env()
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Set GEMINI_API_KEY or GOOGLE_API_KEY to use Gemini analysis.")
    return api_key


def get_client() -> genai.Client:
    _remove_null_proxy_env()
    return genai.Client(api_key=get_gemini_api_key())


def _remove_null_proxy_env() -> None:
    for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
        if os.getenv(key) == "http://127.0.0.1:9":
            os.environ.pop(key, None)


@dataclass(frozen=True)
class GroundedAnswer:
    """Result of one Gemini call: text, parsed JSON payload, grounding sources, token usage."""

    text: str
    payload: dict[str, Any] = field(default_factory=dict)
    sources: list[str] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)


def grounded_answer(
    *,
    prompt: str,
    parts: Sequence[Any] = (),
    response_mime_type: str | None = None,
    use_grounding: bool = False,
    temperature: float = 0.1,
    max_output_tokens: int = 8000,
    parse_json: bool = False,
    fallback: GroundedAnswer | None = None,
) -> GroundedAnswer:
    """Single seam for every Gemini-backed feature.

    Builds the request, invokes the model, extracts grounding sources, and
    optionally parses the response body as JSON. If ``fallback`` is provided
    any raised exception (network, auth, JSON parse) returns the fallback
    rather than propagating — used by callers that prefer silent degradation.
    """
    config_kwargs: dict[str, Any] = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
    }
    if use_grounding:
        config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
    elif response_mime_type:
        config_kwargs["response_mime_type"] = response_mime_type

    contents: list[Any] = [prompt, *parts]

    try:
        client = get_client()
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(**config_kwargs),
        )
        text = (response.text or "").strip()
        sources = _grounding_sources(response) if use_grounding else []
        payload = _parse_json(text) if parse_json and text else {}
        usage = _usage_metadata(response)
    except Exception:
        if fallback is not None:
            return fallback
        raise

    return GroundedAnswer(text=text, payload=payload, sources=sources, usage=usage)


def _usage_metadata(response: Any) -> dict[str, int]:
    """Extract token counts from the Gemini response — best-effort, never raises."""
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return {}
    out: dict[str, int] = {}
    for key, attr in (
        ("prompt_tokens", "prompt_token_count"),
        ("candidate_tokens", "candidates_token_count"),
        ("total_tokens", "total_token_count"),
        ("cached_tokens", "cached_content_token_count"),
    ):
        value = getattr(meta, attr, None)
        if isinstance(value, int):
            out[key] = value
    return out


def extract_profile_text_with_gemini(
    path: Path, source_hint: str = "cv"
) -> tuple[str, dict[str, Any], list[str]]:
    prompt = (
        "Extract the candidate profile text from this document for CV/job-fit analysis. "
        "Preserve Czech diacritics. Reconstruct words that are visually letter-spaced in PDFs. "
        "Prioritize recent technical roles, skills, education, languages, and measurable experience. "
        "Return strict JSON with keys raw_text, structured_profile, parsing_notes. "
        "structured_profile should contain name, headline, recent_roles, skills, education, languages, leadership_evidence, measurable_achievements. "
        f"Document source hint: {source_hint}."
    )
    answer = grounded_answer(
        prompt=prompt,
        parts=[types.Part.from_bytes(data=path.read_bytes(), mime_type=_mime_type(path))],
        response_mime_type="application/json",
        temperature=0.0,
        max_output_tokens=12000,
        parse_json=True,
    )
    raw_text = str(answer.payload.get("raw_text") or "").strip()
    notes = answer.payload.get("parsing_notes")
    parsing_notes = [str(item) for item in notes] if isinstance(notes, list) else []
    structured_profile_raw = answer.payload.get("structured_profile")
    structured_profile = structured_profile_raw if isinstance(structured_profile_raw, dict) else {}
    if not raw_text:
        raise RuntimeError("Gemini did not return raw_text for the uploaded profile.")
    return raw_text, structured_profile, parsing_notes


def analyze_profile_with_gemini(
    path: Path,
    job_description_text: str | None = None,
    company_text: str | None = None,
    use_grounding: bool = False,
    evidence: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> tuple[dict[str, Any], list[str], dict[str, int]]:
    """Single Gemini call returning a structured analysis payload.

    Combines profile extraction, score-shape, salary range, grounded market
    context, and optional job-fit evaluation in one request. Returns
    ``(payload, grounding_sources, token_usage)``.

    ``evidence`` is the deterministic pre-pass output (detected company type,
    salary signals, anchor band, candidate skills found in raw text). Gemini
    is asked to reconcile its own reading with these findings rather than
    invent freely.

    All narrative output is always English even when the input CV is Czech —
    bilingual output was retired because mixed-language LLM outputs were
    unreliable. The CV's raw_text retains its original language; only the
    LLM-generated narrative fields are guaranteed English.
    """
    job_block = (job_description_text or "").strip()
    company_block = (company_text or "").strip()
    schema_text = json.dumps(ANALYSIS_RESPONSE_SCHEMA, ensure_ascii=False, indent=2)
    evidence_text = json.dumps(evidence or {}, ensure_ascii=False, indent=2)

    grounding_line = (
        "- Use grounded web results to fill market_evidence with current Prague/Czech tech salary signals.\n"
        if use_grounding
        else "- Fill market_evidence from your own market knowledge (no web access). Set confidence to low or medium.\n"
    )
    job_fit_rule = (
        "- Populate job_fit fully against the supplied job description.\n"
        if job_block
        else "- No job description was supplied: return job_fit as null.\n"
    )

    prompt = (
        "You are a precise HR tech analyst for the Czech Republic technology market.\n"
        "Analyze the attached CV/profile document and return ONE strict JSON object that matches this shape exactly:\n\n"
        f"{schema_text}\n\n"
        "Deterministic findings from a pre-pass over the raw extracted text and the supplied company text:\n"
        f"{evidence_text}\n\n"
        "Rules:\n"
        "- Output JSON only, no markdown fences, no commentary.\n"
        "- The CV may be in Czech. Preserve Czech diacritics in profile.raw_text and reconstruct letter-spaced PDF words. Skill names, technology names, and proper nouns stay verbatim.\n"
        "- Every other freeform field (strengths, gaps, recommendations, explanation, summary, salary.rationale, all job_fit text fields, market_evidence.summary/notes) MUST be written in English regardless of the CV language. Translate Czech content into clean English in those fields.\n"
        "- Salary numbers are monthly gross CZK based on the current Prague/Czech tech market.\n"
        "- Use the deterministic anchor_band as the primary anchor for your salary range. Adjust within roughly ±20% only if the document supplies stronger evidence (rare specialism, exceptional seniority signal, executive scope). Cite the anchor in salary.rationale.\n"
        "- Your role_family must be one of the families above. Prefer detected_role_family unless the CV's recent roles point clearly elsewhere; explain disagreement in evidence.\n"
        "- Treat detected_signals as inputs you should weigh, not facts you must echo. They reflect the deterministic taxonomy match — refine or correct based on the CV.\n"
        "- score sub-totals must respect the listed maxima and roughly sum to total.\n"
        "- Do not invent facts that are not supported by the document or grounded sources.\n"
        f"{grounding_line}"
        f"{job_fit_rule}"
        "\n"
        f"Job description:\n{job_block or 'No job description supplied.'}\n\n"
        f"Company context:\n{company_block or 'No company context supplied.'}\n"
    )

    from .logger import write_prompt_artifact

    if request_id:
        write_prompt_artifact(request_id, "prompt.txt", prompt)
    answer = grounded_answer(
        prompt=prompt,
        parts=[types.Part.from_bytes(data=path.read_bytes(), mime_type=_mime_type(path))],
        response_mime_type="application/json",
        use_grounding=use_grounding,
        temperature=0.1,
        max_output_tokens=16000,
        parse_json=True,
    )
    if request_id:
        write_prompt_artifact(request_id, "response.txt", answer.text or "")
    if not answer.text:
        raise RuntimeError("Gemini returned an empty analysis response.")
    if not answer.payload:
        raise RuntimeError("Gemini returned non-JSON output.")
    return answer.payload, answer.sources, answer.usage


def _grounding_sources(response: Any) -> list[str]:
    sources: list[str] = []
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        metadata = getattr(candidate, "grounding_metadata", None)
        chunks = getattr(metadata, "grounding_chunks", None) if metadata else None
        for chunk in chunks or []:
            web = getattr(chunk, "web", None)
            uri = getattr(web, "uri", None) if web else None
            if uri:
                sources.append(str(uri))
    return list(dict.fromkeys(sources))


def _parse_json(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    try:
        parsed, _ = decoder.raw_decode(text.strip())
        return parsed
    except json.JSONDecodeError:
        pass
    match = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL)
    if match:
        parsed, _ = decoder.raw_decode(match.group(1).strip())
        return parsed
    start = text.find("{")
    if start >= 0:
        parsed, _ = decoder.raw_decode(text[start:].strip())
        return parsed
    raise RuntimeError("Gemini returned non-JSON output.")


def _mime_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"

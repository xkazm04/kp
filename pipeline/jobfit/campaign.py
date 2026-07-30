"""Sourcing campaign pack (Erika gap E1) — ad copy + 15s video scripts per job.

Generates the creative a recruiter needs to run the social-sourcing playbook for
one job: 6–12 short feed-ready ad-copy variants plus 15-second vertical video
SCRIPTS, each following the proven 4-beat formula (hook → role+offer → proof →
CTA). KP generates the scripts only — avatar/video rendering stays external.

Honesty contract (stricter than the marketing genre it imitates):
- Only the supplied job facts may appear in the copy. No invented pay, benefits,
  team details, or testimonials — which is also why the "employee POV" hook type
  from the original playbook is intentionally absent: we cannot fabricate a
  testimonial. A "skills" (stack) hook replaces it for tech roles.
- A field normalize_job stamped with an assumed value (``Job.defaulted_fields``)
  is a PHANTOM the ad never stated — treated here as absent, so an assumed
  "Praha", "medior", or market-anchor salary band is never advertised as fact.
- Missing facts surface as stable warning CODES (``no_salary``, ``no_location``)
  the UI localizes — codes on the wire, copy in the catalogs.

Mirrors the automation.py task pattern: ClaudeCliProvider when available, a
deterministic builder otherwise, coerce() validating the LLM result at the
trust boundary. See docs/features/jobs/README.md (E1).
"""

from __future__ import annotations

import json
from typing import Any

from .i18n import language_directive, normalize_lang
from .jobs import Job
from .market_config import ACTIVE_MARKET, MarketConfig, currency_unit

CAMPAIGN_PROMPT_VERSION = "campaign-pack-v1"

# Hook taxonomy (canonical codes; the UI maps them to localized labels). The
# 4-beat playbook's "employee POV" is deliberately not a member — see module doc.
HOOK_TYPES: tuple[str, ...] = ("number", "location", "problem", "skills")
HOOK_FALLBACK = "problem"

VARIANT_TARGET = 8   # what the LLM is asked for (playbook: 6–12 per role)
VARIANT_MAX = 12     # hard cap applied at the trust boundary

# Stable warning codes (wire contract; localized in the UI catalogs).
WARN_NO_SALARY = "no_salary"
WARN_NO_LOCATION = "no_location"
WARN_NO_SKILLS = "no_skills"

def _system_prompt(market: MarketConfig = ACTIVE_MARKET) -> str:
    """The copywriter system prompt, with the target market named from config
    instead of a hardcoded "Czech". For the Czech default (descriptor "Czech")
    this is byte-identical to the literal it replaced, so the pilot never regresses;
    a re-homed market tells the model the RIGHT market on every generation."""
    market_phrase = market.market_descriptor or ACTIVE_MARKET.market_descriptor
    return (
        f"You are a recruitment-marketing copywriter for the {market_phrase} tech market. "
        "Be concrete, plain, and "
        "honest: use ONLY the supplied job facts — never invent pay, benefits, testimonials, or team "
        "details. Write in the requested language. Output strict JSON only."
    )

# Deterministic-fallback template strings. Candidate-facing, so they ship in
# both supported candidate languages; campaign copy is generated PER language
# (the pack's `language`), not per recruiter locale.
_T: dict[str, dict[str, str]] = {
    "en": {
        "ctaUrl": "Apply now — it takes about 30 seconds: {url}",
        "cta": "Apply now — it takes about 30 seconds.",
        "problemHook": "Looking for your next {role} role?",
        "offerPay": "{role} — {salary}.",
        "offer": "{role}.",
        "hiringIn": "Hiring in {place}.",
    },
    "cs": {
        "ctaUrl": "Přihlaste se hned — zabere to asi 30 sekund: {url}",
        "cta": "Přihlaste se hned — zabere to asi 30 sekund.",
        "problemHook": "Hledáte další krok jako {role}?",
        "offerPay": "{role} — {salary}.",
        "offer": "{role}.",
        "hiringIn": "Hledáme v {place}.",
    },
    # Formal register (Sie), matching messages/de.json.
    "de": {
        "ctaUrl": "Jetzt bewerben — dauert nur etwa 30 Sekunden: {url}",
        "cta": "Jetzt bewerben — dauert nur etwa 30 Sekunden.",
        "problemHook": "Suchen Sie Ihre nächste Position als {role}?",
        "offerPay": "{role} — {salary}.",
        "offer": "{role}.",
        "hiringIn": "Wir suchen in {place}.",
    },
    # Formal register (vous); French typography uses a narrow no-break space
    # (U+202F) before ':' and '?', matching messages/fr.json.
    "fr": {
        "ctaUrl": "Postulez maintenant — cela prend environ 30 secondes : {url}",
        "cta": "Postulez maintenant — cela prend environ 30 secondes.",
        "problemHook": "Vous cherchez votre prochain poste de {role} ?",
        "offerPay": "{role} — {salary}.",
        "offer": "{role}.",
        "hiringIn": "Nous recrutons à {place}.",
    },
}


def _salary_label(job: Job, lang: str, market: MarketConfig = ACTIVE_MARKET) -> str | None:
    """Human salary-band label from the job's band, or None when absent.
    Statedness is _job_facts's call — it drops the label for an anchored band.

    The currency+period unit comes from the active market's config
    (:func:`currency_unit`), so a non-CZK market renders its OWN unit instead of a
    hardcoded "Kč/CZK"; for the Czech default this is byte-identical ("Kč/měsíc"
    for cs, "CZK/month" otherwise). The thousands separator stays a space (Czech
    convention) — number-formatting parity across markets is a stated non-goal."""
    band = job.salary_band or []
    if len(band) < 2 or not band[0] or not band[1]:
        return None
    lo, hi = int(band[0]), int(band[1])
    fmt = lambda n: f"{n:,}".replace(",", " ")  # noqa: E731 — tiny local formatter
    unit = currency_unit(lang, market=market)
    return f"{fmt(lo)}–{fmt(hi)} {unit}"


def _job_facts(job: Job, lang: str, market: MarketConfig = ACTIVE_MARKET) -> dict[str, Any]:
    """The ONLY facts the copy may use. A DEFAULT_POLICY phantom (recorded in
    ``defaulted_fields``) or a blank string is absent — never advertised."""
    defaulted = set(job.defaulted_fields or [])

    def stated(value: str, field: str) -> str | None:
        v = (value or "").strip()
        return v if v and field not in defaulted else None

    musts = [r.skill for r in job.requirements if r.kind == "must_have"]
    skills = (musts or job.detected_skills)[:6]
    return {
        "title": job.title,
        "seniority": stated(job.seniority, "seniority"),
        "company": stated(job.company, "company"),
        "location": stated(job.location, "location"),
        "workMode": stated(job.work_mode, "work_mode"),
        "languages": job.languages,
        # Same stated-only rule as the fields above: an anchor band normalize_job
        # stamped ("salary_band" phantom) is absent, so WARN_NO_SALARY fires.
        "salary": None if "salary_band" in defaulted else _salary_label(job, lang, market),
        "topSkills": skills,
        "descriptionExcerpt": (job.description or "")[:600],
    }


def _fact_warnings(facts: dict[str, Any]) -> list[str]:
    """Stable codes for the concrete facts the pack had to do without —
    computed from the facts (not the output), so both paths report alike."""
    warnings: list[str] = []
    if not facts["salary"]:
        warnings.append(WARN_NO_SALARY)
    if not facts["location"] and not facts["workMode"]:
        warnings.append(WARN_NO_LOCATION)
    if not facts["topSkills"]:
        warnings.append(WARN_NO_SKILLS)
    return warnings


def _variant(hook_type: str, hook: str, ad_copy: str, script: dict[str, str]) -> dict[str, Any]:
    return {"hookType": hook_type, "hook": hook, "adCopy": ad_copy, "videoScript": script}


def _prompt(facts: dict[str, Any], lang: str, apply_url: str) -> str:
    link_line = (
        f"{apply_url} (a quick-apply form that takes about 30 seconds — say so in the CTA)"
        if apply_url
        else "(none supplied — close with a plain “apply now” CTA, still noting it takes ~30 seconds)"
    )
    return (
        "Create a sourcing campaign pack for the job below: short social-feed ad-copy variants plus "
        "15-second vertical video scripts (Facebook/Instagram Reels style).\n\n"
        f"JOB FACTS — the ONLY facts you may use (a null field is UNKNOWN; never guess it):\n"
        f"{json.dumps(facts, ensure_ascii=False)}\n\n"
        f"APPLICATION LINK: {link_line}\n\n"
        "RULES (a proven 4-beat formula):\n"
        f"- Produce exactly {VARIANT_TARGET} variants, mixing hook types: number (pay or another concrete "
        "figure), location (city / work mode), problem (a pain this role solves for the candidate), "
        "skills (the stack).\n"
        "- hook (0–1.5s): a specific number, place, or problem. NEVER open with the company name.\n"
        "- offer (1.5–6s): the role and pay in plain language. If salary is null, do NOT invent one.\n"
        "- proof (6–11s): concrete facts only (stack, location, work mode, salary). No testimonials.\n"
        "- cta (11–15s): one low-friction action referencing the ~30-second application.\n"
        "- Ban boilerplate in every language: 'competitive salary', 'join our team', 'dynamic "
        "environment', 'fast-paced', 'konkurenceschopný plat', 'dynamické prostředí', 'mladý kolektiv'.\n"
        "- adCopy: 2–4 short feed-ready sentences ending with the CTA (include the link when supplied).\n\n"
        'Return JSON only: {"variants": [{"hookType": "number|location|problem|skills", "hook": str, '
        '"adCopy": str, "videoScript": {"hook": str, "offer": str, "proof": str, "cta": str}}]}\n'
        + language_directive(lang)
    )


def draft_campaign_pack(
    job: Job,
    *,
    lang: str = "en",
    apply_url: str = "",
    provider: Any | None = None,
    market: MarketConfig = ACTIVE_MARKET,
) -> tuple[dict[str, Any], str]:
    """Draft the campaign pack for one job. Returns (pack, source).

    pack = {variants, warnings: [code...], applyUrl, language, promptVersion}.
    LLM via `provider` when supplied/available; deterministic otherwise — the
    fallback assembles one honest variant per hook type that has facts to stand
    on (so it may produce fewer than VARIANT_TARGET; `source` says which path ran).
    """
    lang = normalize_lang(lang)
    if lang not in _T:
        lang = "en"
    facts = _job_facts(job, lang, market)
    t = _T[lang]
    cta = t["ctaUrl"].format(url=apply_url) if apply_url else t["cta"]

    def deterministic() -> dict[str, Any]:
        role = f"{facts['seniority']} {facts['title']}".strip() if facts["seniority"] else facts["title"]
        salary = facts["salary"]
        place = " · ".join(x for x in (facts["location"], facts["workMode"]) if x)
        skills = facts["topSkills"]
        offer = (t["offerPay"] if salary else t["offer"]).format(role=role, salary=salary)
        # Proof beat = the strongest true specifics we hold, most concrete first.
        proof_parts = [p for p in (", ".join(skills[:3]) if skills else "", place, salary or "") if p]
        proof = ". ".join(proof_parts) + "." if proof_parts else offer

        variants: list[dict[str, Any]] = []
        if salary:
            variants.append(_variant("number", f"{salary}.", f"{salary}. {offer} {cta}",
                                     {"hook": f"{salary}.", "offer": offer, "proof": proof, "cta": cta}))
        if place:
            hook = t["hiringIn"].format(place=place)
            variants.append(_variant("location", hook, f"{hook} {offer} {cta}",
                                     {"hook": hook, "offer": offer, "proof": proof, "cta": cta}))
        if skills:
            hook = " · ".join(skills[:3]) + "."
            variants.append(_variant("skills", hook, f"{hook} {offer} {cta}",
                                     {"hook": hook, "offer": offer, "proof": proof, "cta": cta}))
        # The problem hook needs no facts beyond the role itself, so the fallback
        # always yields at least one variant — a pack can never come back empty.
        hook = t["problemHook"].format(role=role)
        variants.append(_variant("problem", hook, f"{hook} {offer} {cta}",
                                 {"hook": hook, "offer": offer, "proof": proof, "cta": cta}))
        return {"variants": variants}

    def coerce(payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict) or not isinstance(payload.get("variants"), list):
            return deterministic()
        variants: list[dict[str, Any]] = []
        for item in payload["variants"][:VARIANT_MAX]:
            if not isinstance(item, dict):
                continue
            hook = str(item.get("hook") or "").strip()
            ad_copy = str(item.get("adCopy") or "").strip()
            if not hook or not ad_copy:
                continue
            raw_script = item.get("videoScript") if isinstance(item.get("videoScript"), dict) else {}
            script = {k: str(raw_script.get(k) or "").strip() for k in ("hook", "offer", "proof", "cta")}
            hook_type = str(item.get("hookType") or "").strip().lower()
            variants.append(_variant(hook_type if hook_type in HOOK_TYPES else HOOK_FALLBACK, hook, ad_copy, script))
        if not variants:
            return deterministic()
        return {"variants": variants}

    # automation.py's _generate, inlined for the campaign's own _SYSTEM: try the
    # LLM; on a missing provider OR any error fall back to the deterministic pack.
    if provider is None:
        result, source = deterministic(), "deterministic"
    else:
        try:
            result, source = coerce(provider.complete_json(_prompt(facts, lang, apply_url), system=_system_prompt(market))), "llm"
        except Exception:
            result, source = deterministic(), "deterministic"

    # E5 — per-variant apply links: every occurrence of the base URL in a
    # variant's copy is rewritten to carry that variant's id (&v=v1…), so a lead
    # arriving through the quick-apply form attributes back to the exact
    # creative that won it (pipeline_entries.source_variant). The base URL stays
    # on the pack for display.
    if apply_url:
        sep = "&" if "?" in apply_url else "?"
        for i, variant in enumerate(result.get("variants", [])):
            variant_id = f"v{i + 1}"
            variant_url = f"{apply_url}{sep}v={variant_id}"
            variant["variantId"] = variant_id
            variant["applyUrl"] = variant_url
            variant["adCopy"] = str(variant.get("adCopy", "")).replace(apply_url, variant_url)
            script = variant.get("videoScript")
            if isinstance(script, dict):
                for beat, text in script.items():
                    script[beat] = str(text).replace(apply_url, variant_url)

    result["warnings"] = _fact_warnings(facts)
    result["applyUrl"] = apply_url
    result["language"] = lang
    result["promptVersion"] = CAMPAIGN_PROMPT_VERSION
    return result, source

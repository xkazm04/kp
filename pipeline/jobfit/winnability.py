"""Pre-publish JD winnability coach (idea-aa039d0c).

Recruiters author or ingest a JD blind and only discover the role is unfillable
AFTER publishing yields an empty pipeline. kp already owns the scoring engine
(``ko_filter`` + ``score_job``), the shared candidate pool, and the market
salary bands (``role_band``) — this turns them into a "will this JD actually
fill?" advisor that runs BEFORE the role goes live.

The assessment is a set of counterfactual re-runs against the live pool, all of
which reuse the exact production scorers so the coach can never disagree with
what publishing would actually surface:

  * eligible / qualified now — pass the hard gates, and of those, score at or
    above the promising tier;
  * loosen-a-gate deltas — drop one required language (or the education floor)
    and recount eligibility: "requiring German drops 8 of 10 — make it
    nice_to_have (+8 eligible)";
  * demote-a-must-have deltas — flip one must_have to nice_to_have and recount
    the *qualified* pool: a must-have nobody has is silently capping the field;
  * salary vs market — the JD's band against ``role_band(family, seniority)``.

Pure (no I/O, no LLM) so the contract is unit-testable and the counterfactuals
are deterministic; ``winnability_cli`` wires it to the pool + a draft Job.
"""

from __future__ import annotations

from .jobs import Job
from .market_config import ACTIVE_MARKET, MarketConfig
from .matching import FIT_PROMISING_THRESHOLD, MatchCandidate, ko_filter, score_job


def _same_currency(a: str | None, b: str | None) -> bool:
    """Whether two currency codes are directly comparable (the pipeline does no FX).

    Mirrors the TS ``isSameCurrency`` contract (app/_lib/salary-band.ts):
    case/whitespace-insensitive, an absent value normalizes to "". Gating the
    salary verdict on this keeps the coach from comparing a EUR job band against a
    CZK market band and reporting a confident-but-meaningless "30% under"."""
    return (a or "").strip().upper() == (b or "").strip().upper()


def _eligible(candidates: list[MatchCandidate], job: Job) -> set[int]:
    """Indices of candidates that clear every hard gate for ``job``."""
    return {i for i, c in enumerate(candidates) if ko_filter(c, job)[0]}


def _qualified(candidates: list[MatchCandidate], job: Job, eligible: set[int], threshold: int) -> set[int]:
    """Eligible candidates whose headline score reaches ``threshold``."""
    return {i for i in eligible if score_job(candidates[i], job).total >= threshold}


def assess_winnability(
    candidates: list[MatchCandidate],
    job: Job,
    *,
    fit_threshold: int = FIT_PROMISING_THRESHOLD,
    market: MarketConfig = ACTIVE_MARKET,
) -> dict:
    """Grade how fillable ``job`` is against the current candidate pool.

    Every figure is derived by re-running the production scorers, so the coach's
    "+N if you loosen this" promises are exactly what publishing would yield.
    """
    pool = len(candidates)
    base_elig = _eligible(candidates, job)
    # Score each eligible candidate against the base job ONCE and reuse the result
    # for BOTH the qualified count and the missing-skill map below — the two used to
    # each run their own full score_job pass over the same (candidate, job) pairs.
    base_results = {i: score_job(candidates[i], job) for i in base_elig}
    base_qual = {i for i in base_elig if base_results[i].total >= fit_threshold}

    # --- Hard-gate loosen counterfactuals: drop one gate, recount ELIGIBILITY.
    # A positive delta means the gate is the *sole* blocker for that many people
    # (dropping it can only restore candidates KO'd by it alone).
    loose_gates: list[dict] = []
    for lang in dict.fromkeys(job.languages):  # de-dupe, keep order
        variant = job.model_copy(update={"languages": [l for l in job.languages if l != lang]})
        delta = len(_eligible(candidates, variant)) - len(base_elig)
        if delta > 0:
            loose_gates.append({"kind": "language", "value": lang, "eligibleDelta": delta})
    if job.min_education and job.min_education != "none":
        variant = job.model_copy(update={"min_education": "none"})
        delta = len(_eligible(candidates, variant)) - len(base_elig)
        if delta > 0:
            loose_gates.append({"kind": "education", "value": job.min_education, "eligibleDelta": delta})
    loose_gates.sort(key=lambda g: g["eligibleDelta"], reverse=True)

    # --- Must-have demote counterfactuals: flip one must_have to nice_to_have,
    # recount the QUALIFIED pool. Skills aren't hard gates — they cap the score —
    # so the lever here is "qualified" (eligible AND scoring well), not eligibility.
    must_haves: list[dict] = []
    base_missing = {i: set(base_results[i].missing_skills) for i in base_elig}
    requirements = job.requirements
    for idx, req in enumerate(requirements):
        if req.kind != "must_have":
            continue
        demoted = [
            r.model_copy(update={"kind": "nice_to_have"}) if j == idx else r
            for j, r in enumerate(requirements)
        ]
        variant = job.model_copy(update={"requirements": demoted})
        qual_v = _qualified(candidates, job=variant, eligible=base_elig, threshold=fit_threshold)
        must_haves.append(
            {
                "skill": req.skill,
                "missingAmongEligible": sum(1 for miss in base_missing.values() if req.skill in miss),
                "qualifiedDelta": len(qual_v) - len(base_qual),
            }
        )
    # Surface the must-have that frees up the most candidates first.
    must_haves.sort(key=lambda m: (m["qualifiedDelta"], m["missingAmongEligible"]), reverse=True)

    # --- Salary vs market. role_band lives in `taxonomy`, but `jobs` already
    # imports it to anchor bands at parse time; read it through that re-export so
    # this module's import surface stays inside the matching/jobs core.
    from .taxonomy import role_band

    market_band = role_band(job.role_family, job.seniority)
    job_band = list(job.salary_band[:2]) if len(job.salary_band) >= 2 else None
    # Both bands are bare [lo, hi] with NO currency of their own: the market band
    # (role_band) is denominated in the BENCHMARK market's currency
    # (``ACTIVE_MARKET`` — a guard test keeps salary_benchmarks.json in step), and
    # the JD's band in the currency of the market it was authored for (``market``).
    # In the single-market pilot these are the same (CZK) and the verdict is
    # byte-identical; the moment a non-CZK band is compared against the CZK
    # benchmark the numeric "below market" test is meaningless (the app does no FX),
    # so we SILENCE it rather than emit a confident-but-wrong verdict — the exact
    # cross-currency trap the TS isSameCurrency guard was built to prevent.
    market_currency = ACTIVE_MARKET.currency
    job_currency = market.currency
    comparable = _same_currency(job_currency, market_currency)
    salary: dict = {
        "family": job.role_family,
        "seniority": job.seniority,
        "jobBand": job_band,
        "marketBand": list(market_band) if market_band else None,
        "jobCurrency": job_currency,
        "marketCurrency": market_currency,
        "currencyComparable": comparable,
        # Below market when the JD's TOP sits under the market FLOOR — an
        # unambiguous "you're paying less than anyone else for this role" signal.
        # None (not False) when the currencies aren't comparable: honestly absent,
        # never a wrong "not below market" claim across an unconverted FX gap.
        "belowMarket": (
            bool(job_band and market_band and job_band[1] < market_band[0]) if comparable else None
        ),
    }
    if comparable and job_band and market_band and market_band[0] > 0:
        # How far the JD's top sits relative to the market floor (negative = below).
        salary["topVsMarketFloorPct"] = round(100 * (job_band[1] - market_band[0]) / market_band[0])

    return {
        "poolSize": pool,
        "eligible": len(base_elig),
        "qualified": len(base_qual),
        "fitThreshold": fit_threshold,
        "looseGates": loose_gates,
        "looseMustHaves": must_haves,
        "salary": salary,
    }

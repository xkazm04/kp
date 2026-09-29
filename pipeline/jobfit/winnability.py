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

from itertools import combinations

from .jobs import Job
from .market_config import ACTIVE_MARKET, MarketConfig
from .matching import FIT_PROMISING_THRESHOLD, MatchCandidate, _norm_currency, ko_filter, score_job

# Must-haves considered for the pair fallback: C(8, 2) = 28 extra passes at most.
_PAIR_CANDIDATES = 8


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
        variant = job.model_copy(update={"languages": [other for other in job.languages if other != lang]})
        delta = len(_eligible(candidates, variant)) - len(base_elig)
        if delta > 0:
            loose_gates.append({"kind": "language", "value": lang, "eligibleDelta": delta})
    if job.min_education and job.min_education != "none":
        variant = job.model_copy(update={"min_education": "none"})
        delta = len(_eligible(candidates, variant)) - len(base_elig)
        if delta > 0:
            loose_gates.append({"kind": "education", "value": job.min_education, "eligibleDelta": delta})
    loose_gates.sort(key=lambda g: g["eligibleDelta"], reverse=True)

    # --- Masked gates. A single-gate delta only counts people that gate blocks ALONE,
    # so anyone failing two gates is recovered by neither lever: the sum of the
    # deltas UNDERSTATES what removing the gates together restores, and when every
    # excluded candidate fails two gates each delta is 0 and looseGates is empty on
    # exactly the pool the gates jointly empty. One extra pass with every levered
    # gate removed exposes it; it is reported as its own row, never folded into the
    # per-gate deltas, because it names no single culprit.
    joint_gates: list[dict] = []
    for lang in dict.fromkeys(job.languages):
        joint_gates.append({"kind": "language", "value": lang})
    if job.min_education and job.min_education != "none":
        joint_gates.append({"kind": "education", "value": job.min_education})
    joint_loosen: dict | None = None
    if len(joint_gates) >= 2:
        variant = job.model_copy(update={"languages": [], "min_education": "none"})
        joint_delta = len(_eligible(candidates, variant)) - len(base_elig)
        sole_sum = sum(g["eligibleDelta"] for g in loose_gates)
        if joint_delta > sole_sum:
            joint_loosen = {"eligibleDelta": joint_delta, "soleBlockerSum": sole_sum, "gates": joint_gates}

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

    # A candidate several must-haves short can sit under the bar by more than any ONE
    # demotion buys (each moves the score a few points), so every single delta reads 0
    # and the verdict "the pool is not close" is wrong: a PAIR reaches it. Only when no
    # single lever moves anyone, try each pair of must-haves that some eligible candidate
    # lacks (demoting one a candidate HOLDS lowers their score, so a demote-everything
    # pass is not a bound). Pairs are real counterfactuals like the singles, ranked
    # best-first, capped at _PAIR_CANDIDATES skills so the extra passes stay bounded.
    joint_demote: list[dict] = []
    if not any(m["qualifiedDelta"] > 0 for m in must_haves):
        lacking = [m["skill"] for m in must_haves if m["missingAmongEligible"] > 0][:_PAIR_CANDIDATES]
        kinds = {r.skill: idx for idx, r in enumerate(requirements) if r.kind == "must_have"}
        for a, b in combinations(dict.fromkeys(lacking), 2):
            demoted = [
                r.model_copy(update={"kind": "nice_to_have"}) if idx in (kinds[a], kinds[b]) else r
                for idx, r in enumerate(requirements)
            ]
            variant = job.model_copy(update={"requirements": demoted})
            delta = len(_qualified(candidates, job=variant, eligible=base_elig, threshold=fit_threshold)) - len(base_qual)
            if delta > 0:
                joint_demote.append({"skills": [a, b], "qualifiedDelta": delta})
        joint_demote.sort(key=lambda p: p["qualifiedDelta"], reverse=True)

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
    # The currency the POSTING stated when it stated one (the seeker-side _salary_flag
    # reads it the same way); only an ad that named none is read in the units of the
    # market it was authored for. Answering every ad in the market's currency compared
    # a EUR-stated range with the CZK benchmark as if it were CZK.
    job_currency = _norm_currency(job.salary_currency) if job.salary_currency else market.currency
    comparable = _same_currency(job_currency, market_currency)
    # Both sides of the comparison must be STATED by the ad. A salary_band stamped from
    # the market anchor IS the market band, so top-vs-floor against itself can never
    # read "below" and the coach answers a clean "not below market" for an ad that
    # named no pay; a seniority stamped from DEFAULT_POLICY selects the band of a level
    # the ad never claimed, so a stated range is judged against an assumed one. The
    # seeker-side _salary_flag already reads a defaulted band as "posting states no
    # pay"; this is the same rule. Silence (None), never a verdict.
    assumed = [f for f in ("salary_band", "seniority") if f in job.defaulted_fields]
    if "salary_band" in assumed:
        job_band = None
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
            bool(job_band and market_band and job_band[1] < market_band[0])
            if comparable and not assumed
            else None
        ),
        # Which of the ad's own inputs the verdict was silenced for (empty = none).
        "assumedInputs": assumed,
    }
    if comparable and not assumed and job_band and market_band and market_band[0] > 0:
        # How far the JD's top sits relative to the market floor (negative = below).
        salary["topVsMarketFloorPct"] = round(100 * (job_band[1] - market_band[0]) / market_band[0])

    return {
        "poolSize": pool,
        "eligible": len(base_elig),
        "qualified": len(base_qual),
        "fitThreshold": fit_threshold,
        "looseGates": loose_gates,
        **({"jointLoosen": joint_loosen} if joint_loosen else {}),
        "looseMustHaves": must_haves,
        **({"jointDemote": joint_demote} if joint_demote else {}),
        "salary": salary,
    }

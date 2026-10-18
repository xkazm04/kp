"""Twin-cast match harness: what does the CURRENT scorer pay for a claim, and what for proof?

The question (scoring hunt C5): in an era where a CV can be stuffed with AI-written
keywords for free, how much of a match score can a candidate buy without evidence,
and how much more does the same skill set earn once evidence backs it? This module
MEASURES that on the existing scorer. It changes no weight and adds no scorer —
every number comes from ``matching.score_job`` over the committed seed candidates
(``data/seed_candidates``) and job corpus (``data/seed_jobs``), loaded the way
``eval/matching_eval.py`` and ``seed_pipeline.py`` load them.

Every (candidate, job) pair is scored for five in-memory twins of the SAME person:

  base       — the seed profile as shipped
  stuffed    — base + every job requirement the candidate does not already name,
               as a bare ``self_declared`` claim (AI-written keywords, no proof)
  proven     — the SAME added skills, backed by job evidence (``professional``)
  learnable  — base + proof for only the job's learnable must-haves
  prereq     — base + proof for only the job's prerequisite must-haves

Metrics (all means over the scored pairs unless stated):

  free_claim_gain    stuffed - base
  proof_premium      proven - stuffed
  tier_crossings     pairs whose fit tier differs between twins, each with a reason code
  neutrality         gender-marked and Czech-vs-English name deltas on the full job list
  per_archetype      the same gains and the stuffed-beats-proven rate, split by archetype
  hardness           lift per proven requirement, learnable vs prerequisite (the scorer
                     reads ``JobRequirement.hardness`` nowhere, so these should be equal)

Keyless by construction: there is no LLM mode. ``--no-llm`` is accepted so the
command line reads the same as its siblings, and asserts nothing more than what is
already true. The output is stamped SYNTHETIC (seed candidates are generated, not
people) and carries a fingerprint over the inputs, the scorer sources and the
results, so two runs can be compared by one string.

Run:  python -m pipeline.jobfit.eval.matching_era_eval --no-llm [--json] [--strict]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from ..jobs import Job
from ..matching import (
    _DEFAULT_CORPUS,
    PROOF_PREVIEW_WEIGHTS,
    MatchCandidate,
    ProofReason,
    ProofWeights,
    fit_tier_for,
    load_corpus,
    proof_scorer_version,
    score_job,
)
from ..profile import CandidateProfileV2, Evidence, SkillClaim
from ..transform import build_match_candidate
from .neutrality import PERTURBATIONS, gender_pairs

ROOT = Path(__file__).resolve().parents[3]
CANDIDATES_PATH = ROOT / "data" / "seed_candidates" / "candidates.json"
JOBFIT_DIR = Path(__file__).resolve().parents[1]

STAMP = "SYNTHETIC"
SCHEMA = "matching-era-eval/1"
# The scorer sources whose bytes define "the scorer version" for the fingerprint.
SCORER_SOURCES = ("matching.py", "taxonomy.py", "jobs.py", "transform.py")
TWINS = ("base", "stuffed", "proven", "learnable", "prereq")
# Longest list of crossings printed in the pretty report; --json carries all of them.
LISTED_CROSSINGS = 15
# The cohorts C6 must not cost a tier: the preview lowers credit on bare claims, and
# early-career candidates are the ones whose skills are most often only claimed.
PROTECTED_ARCHETYPES = ("student", "career_switcher")
# The English control the Czech-name delta is read against (a perturbation-registry pair).
CZ_PAIR_AXIS = "cz"
EN_PAIR_AXIS = "en"


def scorer_version() -> str:
    """Hash of the scorer sources, line endings normalised so a CRLF checkout agrees."""
    h = hashlib.sha256()
    for name in SCORER_SOURCES:
        text = (JOBFIT_DIR / name).read_bytes().replace(b"\r\n", b"\n")
        h.update(name.encode() + b"\0" + text + b"\0")
    return h.hexdigest()[:16]


def _canon(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# -- twin construction (in memory only) --------------------------------------


def _held(candidate: MatchCandidate) -> set[str]:
    return {s.casefold().strip() for s in candidate.skills}


def _missing_requirements(candidate: MatchCandidate, job: Job, *, hardness: str | None = None, musts_only: bool = False) -> list[str]:
    """Job requirement skills the candidate does not already name, in corpus order."""
    held = _held(candidate)
    out: list[str] = []
    for req in job.requirements:
        if musts_only and req.kind != "must_have":
            continue
        if hardness is not None and req.hardness != hardness:
            continue
        key = req.skill.casefold().strip()
        if key in held or key in {s.casefold().strip() for s in out}:
            continue
        out.append(req.skill)
    return out


def _stuffed(profile: CandidateProfileV2, skills: list[str]) -> CandidateProfileV2:
    # Shallow copy with REPLACED lists: the seed profile is never mutated, and a deep
    # copy per twin was most of the run time.
    claims = [*profile.skill_claims, *(SkillClaim(skill=s, provenance="self_declared") for s in skills)]
    return profile.model_copy(update={"skill_claims": claims})


def _proven(profile: CandidateProfileV2, skills: list[str]) -> CandidateProfileV2:
    if not skills:
        return profile
    proof = Evidence(kind="job", title="Evidenced work", text="Shipped work using these skills.", skills=list(skills), provenance="professional")
    return profile.model_copy(update={"evidence": [*profile.evidence, proof]})


def _score(profile: CandidateProfileV2, job: Job, proof: ProofWeights | None = None):
    return score_job(build_match_candidate(profile), job, proof=proof)


def _crossing_reason(lo, hi) -> str:
    """Why the tier moved: the score dimension that moved most, and what in skills moved it."""
    deltas = {
        "skills": hi.skills_score - lo.skills_score,
        "career": hi.career_score - lo.career_score,
        "personal": hi.personal_score - lo.personal_score,
    }
    dim = max(deltas, key=lambda k: (abs(deltas[k]), k))
    if abs(deltas[dim]) < 1e-9:
        return "no_dimension_moved"
    if dim == "skills":
        if len(hi.matched_skills) > len(lo.matched_skills):
            return "skills_newly_matched"
        if len(hi.unproven_skills) > len(lo.unproven_skills):
            return "skills_unproven_credit"
        return "skills_strength_shift"
    return f"{dim}_shift"


# -- the cast ----------------------------------------------------------------


def load_candidates(path: Path = CANDIDATES_PATH) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def _mean(xs: list[float]) -> float:
    return round(sum(xs) / len(xs), 4) if xs else 0.0


def measure(
    records: list[dict[str, Any]],
    jobs: list[Job],
    proof: ProofWeights | None = None,
    *,
    rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The twin-cast metrics under the default scorer, or under the C6 preview.

    ``rows``, when given, receives one row per pair (base and stuffed totals, tiers
    and, under the preview, the reasons codes) for :func:`compare_preview`."""
    pairs: list[dict[str, Any]] = []
    crossings: list[dict[str, Any]] = []
    # per (candidate) best base job, for the per-candidate crossing view
    best_by_cand: dict[str, tuple[int, str]] = {}
    hardness_lift: dict[str, list[float]] = {"learnable": [], "prerequisite": []}
    profiles: list[tuple[str, CandidateProfileV2]] = []
    for i, rec in enumerate(records):
        profiles.append((str(rec.get("id", f"cand-{i:03d}")), CandidateProfileV2.model_validate(rec)))

    for cid, profile in profiles:
        base_cand = build_match_candidate(profile)
        for job in jobs:
            added = _missing_requirements(base_cand, job)
            learn = _missing_requirements(base_cand, job, hardness="learnable", musts_only=True)
            prereq = _missing_requirements(base_cand, job, hardness="prerequisite", musts_only=True)
            why_base: list[ProofReason] = []
            why_stuffed: list[ProofReason] = []
            res = {
                "base": score_job(base_cand, job, proof=proof, proof_reasons=why_base),
                "stuffed": score_job(
                    build_match_candidate(_stuffed(profile, added)), job, proof=proof, proof_reasons=why_stuffed
                ),
                "proven": _score(_proven(profile, added), job, proof),
                "learnable": _score(_proven(profile, learn), job, proof),
                "prereq": _score(_proven(profile, prereq), job, proof),
            }
            t = {k: v.total for k, v in res.items()}
            pairs.append({"c": cid, "j": job.id, "arch": profile.archetype, "n_added": len(added), **t})
            if rows is not None:
                rows.append(
                    {
                        "c": cid,
                        "j": job.id,
                        "arch": profile.archetype,
                        **{k: (res[k].total, res[k].fit_tier) for k in ("base", "stuffed")},
                        "why_base": why_base,
                        "why_stuffed": why_stuffed,
                    }
                )
            if learn:
                hardness_lift["learnable"].append((t["learnable"] - t["base"]) / len(learn))
            if prereq:
                hardness_lift["prerequisite"].append((t["prereq"] - t["base"]) / len(prereq))
            if cid not in best_by_cand or (t["base"], job.id) > best_by_cand[cid]:
                best_by_cand[cid] = (t["base"], job.id)
            for lo_k, hi_k, kind in (("base", "stuffed", "free_claim"), ("stuffed", "proven", "proof_premium")):
                lo_t, hi_t = fit_tier_for(t[lo_k]), fit_tier_for(t[hi_k])
                if lo_t != hi_t:
                    crossings.append(
                        {
                            "kind": kind,
                            "candidate": cid,
                            "job": job.id,
                            "archetype": profile.archetype,
                            "from_tier": lo_t,
                            "to_tier": hi_t,
                            "from_total": t[lo_k],
                            "to_total": t[hi_k],
                            "reason": _crossing_reason(res[lo_k], res[hi_k]),
                        }
                    )

    n = len(pairs)
    free = [p["stuffed"] - p["base"] for p in pairs]
    prem = [p["proven"] - p["stuffed"] for p in pairs]
    crossings.sort(key=lambda c: (c["kind"], c["candidate"], c["job"]))
    best_pairs = {(cid, jid) for cid, (_t, jid) in best_by_cand.items()}
    best_cross = [c for c in crossings if c["kind"] == "free_claim" and (c["candidate"], c["job"]) in best_pairs]

    per_arch: dict[str, dict[str, Any]] = {}
    by_arch: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in pairs:
        by_arch[p["arch"]].append(p)
    for arch in sorted(by_arch):
        ps = by_arch[arch]
        per_arch[arch] = {
            "pairs": len(ps),
            "free_claim_gain": _mean([p["stuffed"] - p["base"] for p in ps]),
            "proof_premium": _mean([p["proven"] - p["stuffed"] for p in ps]),
            "stuffed_beats_proven_rate": round(sum(1 for p in ps if p["stuffed"] > p["proven"]) / len(ps), 4),
            "mean_loss_to_stuffing": _mean([max(0, p["stuffed"] - p["proven"]) for p in ps]),
            "crossings": sum(1 for c in crossings if c["archetype"] == arch),
        }

    crossing_reasons: dict[str, int] = defaultdict(int)
    for c in crossings:
        crossing_reasons[f"{c['kind']}:{c['reason']}"] += 1

    return {
        "candidates": len(profiles),
        "jobs": len(jobs),
        "pairs": n,
        "free_claim_gain": _mean(free),
        "free_claim_gain_max": max(free) if free else 0,
        "proof_premium": _mean(prem),
        "mean_total": {k: _mean([p[k] for p in pairs]) for k in TWINS},
        "tier_crossings": {
            "free_claim": sum(1 for c in crossings if c["kind"] == "free_claim"),
            "proof_premium": sum(1 for c in crossings if c["kind"] == "proof_premium"),
            "free_claim_at_best_job": len(best_cross),
            "best_job_pairs": len(best_pairs),
            "by_reason": dict(sorted(crossing_reasons.items())),
            "listed": crossings,
        },
        "hardness": {
            "learnable_lift_per_requirement": _mean(hardness_lift["learnable"]),
            "prerequisite_lift_per_requirement": _mean(hardness_lift["prerequisite"]),
            "learnable_samples": len(hardness_lift["learnable"]),
            "prerequisite_samples": len(hardness_lift["prerequisite"]),
        },
        "per_archetype": per_arch,
        "neutrality": _neutrality(profiles, jobs, proof),
        "best_jobs": {cid: {"job": jid, "total": tot} for cid, (tot, jid) in sorted(best_by_cand.items())},
    }


def _neutrality(profiles: list[tuple[str, CandidateProfileV2]], jobs: list[Job], proof: ProofWeights | None = None) -> dict[str, Any]:
    """Name deltas over every (candidate, job) score: masculine vs feminine, Czech vs English.

    Only the display name changes between the twins; any non-zero delta is a defect.
    """
    named = [p for p in PERTURBATIONS if p.pair in (CZ_PAIR_AXIS, EN_PAIR_AXIS) and p.prose is None]
    by_axis = {(p.pair, p.gender): p.name for p in named}

    def totals(name: str) -> list[int]:
        out: list[int] = []
        for _cid, profile in profiles:
            cand = build_match_candidate(profile.model_copy(update={"display_name": name}))
            out.extend(score_job(cand, job, proof=proof).total for job in jobs)
        return out

    cz_m, cz_f = totals(by_axis[(CZ_PAIR_AXIS, "m")]), totals(by_axis[(CZ_PAIR_AXIS, "f")])
    en_m, en_f = totals(by_axis[(EN_PAIR_AXIS, "m")]), totals(by_axis[(EN_PAIR_AXIS, "f")])

    def delta(a: list[int], b: list[int]) -> dict[str, Any]:
        d = [x - y for x, y in zip(a, b)]
        return {
            "mean": _mean(d),
            "max_abs": max((abs(x) for x in d), default=0),
            "nonzero": sum(1 for x in d if x),
            "n": len(d),
        }

    return {
        "czech_gender_pair": delta(cz_f, cz_m),
        "english_gender_pair": delta(en_f, en_m),
        "czech_vs_english_male": delta(cz_m, en_m),
        "czech_vs_english_female": delta(cz_f, en_f),
        "pairs_registered": len(gender_pairs(PERTURBATIONS)),
    }


_TIER_RANK = {"partial": 0, "promising": 1, "strong": 2}


def compare_preview(
    base_rows: list[dict[str, Any]], preview_rows: list[dict[str, Any]], base: dict[str, Any]
) -> dict[str, Any]:
    """Default scorer vs the C6 preview, pair by pair, for the base and stuffed twins.

    ``changed_without_reason`` must be 0: the preview owes a reasons line for every
    score it moves. ``protected_tier_losses_at_best_job`` are the early-career base
    candidates whose tier at their default-scorer best job fell under the preview.
    """
    changed = unexplained = 0
    by_code: dict[str, int] = defaultdict(int)
    tier_losses: list[dict[str, Any]] = []
    deltas: list[float] = []
    for old, new in zip(base_rows, preview_rows, strict=True):
        for twin in ("base", "stuffed"):
            old_total, new_total = old[twin][0], new[twin][0]
            reasons = new[f"why_{twin}"]
            for r in reasons:
                by_code[r.code] += 1
            if new_total != old_total:
                changed += 1
                if not reasons:
                    unexplained += 1
        deltas.append(float(new["base"][0] - old["base"][0]))
        at_best = base["best_jobs"][old["c"]]["job"] == old["j"]
        if at_best and old["arch"] in PROTECTED_ARCHETYPES and _TIER_RANK[new["base"][1]] < _TIER_RANK[old["base"][1]]:
            tier_losses.append(
                {
                    "candidate": old["c"],
                    "job": old["j"],
                    "archetype": old["arch"],
                    "from": f"{old['base'][1]}({old['base'][0]})",
                    "to": f"{new['base'][1]}({new['base'][0]})",
                    "reasons": [r.text for r in new["why_base"]],
                }
            )
    return {
        "changed_scores": changed,
        "changed_without_reason": unexplained,
        "reasons_by_code": dict(sorted(by_code.items())),
        "base_twin_mean_delta": _mean(deltas),
        "protected_archetypes": list(PROTECTED_ARCHETYPES),
        "protected_tier_losses_at_best_job": tier_losses,
    }


def run(
    records: list[dict[str, Any]] | None = None,
    jobs: list[Job] | None = None,
    *,
    preview: ProofWeights | None = None,
) -> dict[str, Any]:
    """One stamped, fingerprinted report. Pure: the same inputs give the same string.

    ``preview`` adds the C6 proof-weights preview, measured by the same cast and
    side by side with the default scorer, under its own scorer stamp; the
    fingerprint then covers both."""
    records = load_candidates() if records is None else records
    jobs = load_corpus(_DEFAULT_CORPUS) if jobs is None else jobs
    base_rows: list[dict[str, Any]] | None = [] if preview is not None else None
    results = measure(records, jobs, rows=base_rows)
    inputs = {
        "candidates": _sha(_canon(records)),
        "jobs": _sha(_canon([j.model_dump(mode="json") for j in jobs])),
    }
    scorer = scorer_version()
    body = {"stamp": STAMP, "schema": SCHEMA, "inputs": inputs, "scorer_version": scorer, "results": results}
    if preview is not None:
        preview_rows: list[dict[str, Any]] = []
        preview_results = measure(records, jobs, preview, rows=preview_rows)
        body["preview"] = {
            "scorer_version": f"{scorer}+{proof_scorer_version(preview)}",
            "weights": preview._asdict(),
            "results": preview_results,
            "comparison": compare_preview(base_rows or [], preview_rows, results),
        }
    body["fingerprint"] = _sha(_canon(body))[:16]
    return body


def integrity_failures(report: dict[str, Any]) -> list[str]:
    """What --strict gates: the measurement's own integrity, never the scorer's merit."""
    bad: list[str] = []
    r = report["results"]
    if report.get("stamp") != STAMP:
        bad.append("SYNTHETIC stamp missing")
    if r["pairs"] != r["candidates"] * r["jobs"] or r["pairs"] == 0:
        bad.append(f"pair count {r['pairs']} != {r['candidates']} x {r['jobs']}")
    if any(not c.get("reason") for c in r["tier_crossings"]["listed"]):
        bad.append("a tier crossing has no reason code")
    sections = [("", r)]
    if "preview" in report:
        sections.append(("preview ", report["preview"]["results"]))
        if report["preview"]["comparison"]["changed_without_reason"]:
            bad.append("a preview score changed with no reasons line")
    for label, res in sections:
        nb = res["neutrality"]
        for key in ("czech_gender_pair", "english_gender_pair", "czech_vs_english_male", "czech_vs_english_female"):
            if nb[key]["max_abs"] != 0:
                bad.append(f"{label}name delta on {key}: max |{nb[key]['max_abs']}|")
    return bad


# -- output ------------------------------------------------------------------


def _format(report: dict[str, Any]) -> str:
    r = report["results"]
    tc = r["tier_crossings"]
    nb = r["neutrality"]
    lines = [
        f"[{report['stamp']}] matching era eval - twin cast, keyless",
        f"fingerprint {report['fingerprint']}  scorer {report['scorer_version']}",
        f"{r['candidates']} candidates x {r['jobs']} jobs = {r['pairs']} pairs",
        "",
        "mean total      " + "  ".join(f"{k} {r['mean_total'][k]}" for k in TWINS),
        f"free-claim gain {r['free_claim_gain']:+}  (max {r['free_claim_gain_max']:+})   stuffed - base",
        f"proof premium   {r['proof_premium']:+}   proven - stuffed",
        f"tier crossings  free-claim {tc['free_claim']}/{r['pairs']} pairs"
        f" ({tc['free_claim_at_best_job']}/{tc['best_job_pairs']} at each candidate's best job);"
        f" proof {tc['proof_premium']}/{r['pairs']}",
    ]
    for reason, count in tc["by_reason"].items():
        lines.append(f"  {reason}: {count}")
    for c in tc["listed"][:LISTED_CROSSINGS]:
        lines.append(f"  - {c['kind']} {c['candidate']} @ {c['job']}: {c['from_tier']}({c['from_total']}) -> {c['to_tier']}({c['to_total']}) [{c['reason']}]")
    if len(tc["listed"]) > LISTED_CROSSINGS:
        lines.append(f"  ... {len(tc['listed']) - LISTED_CROSSINGS} more (--json lists all)")
    h = r["hardness"]
    lines += [
        f"hardness lift/req  learnable {h['learnable_lift_per_requirement']:+}  prerequisite {h['prerequisite_lift_per_requirement']:+}",
        "neutrality (max |delta|, nonzero/n)  "
        + "  ".join(f"{k} {v['max_abs']},{v['nonzero']}/{v['n']}" for k, v in nb.items() if isinstance(v, dict)),
        "per archetype:",
    ]
    for arch, a in r["per_archetype"].items():
        lines.append(
            f"  {arch:16} gain {a['free_claim_gain']:+}  premium {a['proof_premium']:+}"
            f"  stuffed>proven {a['stuffed_beats_proven_rate']:.1%}  loss {a['mean_loss_to_stuffing']}  crossings {a['crossings']}"
        )
    if "preview" in report:
        lines += ["", *_format_preview(report)]
    return "\n".join(lines)


def _format_preview(report: dict[str, Any]) -> list[str]:
    """Base and preview side by side: the C6 targets, then what the preview changed."""
    pv = report["preview"]
    b, p, cmp_ = report["results"], pv["results"], pv["comparison"]

    def row(label: str, base_v: Any, prev_v: Any, target: str) -> str:
        return f"  {label:28} {str(base_v):>12} {str(prev_v):>12}   {target}"

    def nonzero(res: dict[str, Any]) -> int:
        return sum(v["nonzero"] for v in res["neutrality"].values() if isinstance(v, dict))

    def at_best(res: dict[str, Any]) -> str:
        return f"{res['tier_crossings']['free_claim_at_best_job']}/{res['tier_crossings']['best_job_pairs']}"

    def lift(res: dict[str, Any]) -> str:
        h = res["hardness"]
        return f"{h['learnable_lift_per_requirement']:+}/{h['prerequisite_lift_per_requirement']:+}"

    lines = [
        f"proof-weights PREVIEW (opt-in, not the default)  scorer {pv['scorer_version']}",
        "  " + "  ".join(f"{k}={v:g}" for k, v in pv["weights"].items()),
        row("metric", "base", "preview", "C6 target"),
        row("free-claim gain", f"{b['free_claim_gain']:+}", f"{p['free_claim_gain']:+}", "<= 2.0"),
        row("free-claim crossings @best", at_best(b), at_best(p), "0"),
        row("proof premium", f"{b['proof_premium']:+}", f"{p['proof_premium']:+}", ">= base"),
        row("name deltas (nonzero)", nonzero(b), nonzero(p), "0"),
        row("hardness lift learn/prereq", lift(b), lift(p), "learnable < prereq"),
        row("protected tier losses @best", "-", len(cmp_["protected_tier_losses_at_best_job"]), "0"),
        f"  changed scores {cmp_['changed_scores']} (base+stuffed twins), without a reason {cmp_['changed_without_reason']};"
        f" base-twin mean delta {cmp_['base_twin_mean_delta']:+}",
        "  reasons " + "  ".join(f"{k}: {v}" for k, v in cmp_["reasons_by_code"].items()),
    ]
    for loss in cmp_["protected_tier_losses_at_best_job"]:
        lines.append(f"  - tier loss {loss['archetype']} {loss['candidate']} @ {loss['job']}: {loss['from']} -> {loss['to']}")
    return lines


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    parser = argparse.ArgumentParser(description="Keyless twin-cast match harness (measures only).")
    parser.add_argument("--no-llm", action="store_true", help="Accepted for symmetry; this harness has no LLM mode.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="Exit 1 if the measurement's own integrity checks fail.")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Also measure the C6 proof-weights preview (opt-in, never the default) side by side.",
    )
    args = parser.parse_args(argv)
    preview = PROOF_PREVIEW_WEIGHTS if args.preview else None

    try:
        records, jobs = load_candidates(), load_corpus(_DEFAULT_CORPUS)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"matching_era_eval: cannot load the seed inputs ({exc}); run the seed builders first.\n")
        return 2
    if not records or not jobs:
        sys.stderr.write("matching_era_eval: empty candidate seed or job corpus.\n")
        return 2

    first = run(records, jobs, preview=preview)
    if args.json:
        print(json.dumps(first, indent=2, ensure_ascii=False))
    else:
        print(_format(first))
    if not args.strict:
        return 0
    second = run(records, jobs, preview=preview)
    print(f"fingerprint run 1: {first['fingerprint']}", file=sys.stderr)
    print(f"fingerprint run 2: {second['fingerprint']}", file=sys.stderr)
    bad = integrity_failures(first)
    if first["fingerprint"] != second["fingerprint"]:
        bad.append("fingerprint differs between two runs")
    for b in bad:
        print(f"STRICT FAIL: {b}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

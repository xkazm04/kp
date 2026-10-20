"""The choice instrument: rank recogniser candidates on OUR errors, not on a leaderboard.

The plane already knows that an aggregate word error rate is the wrong scalar for this
product — ``wer.entity_fidelity`` exists because a live Czech call scored 8.33% WER, sat
comfortably inside a 35% budget, and still turned "React" into "Rust" and "PostgreSQL"
into "později SQL", so the candidate would have been rated on a fabricated skill set.
That lesson was wired into the SESSION gate and never into an ENGINE decision, because
until ``recognizers`` there was no way to run a second engine at all.

This module closes that. It runs every candidate over the SAME synthesized audio under
the SAME degradation and reports both numbers, with one contract borrowed from the
finding above:

    Optimize decisive-term recall. Demote the aggregate error rate to a threshold.

The aggregate keeps a real job — an engine whose bulk accuracy collapses is unusable
however well it preserves nouns — but it must never RANK the candidates, because ranking
is the operation it performs worst. Measured on this harness's own reference set, the two
metrics select different engines: an arm at 0.167 aggregate WER (substituting two domain
nouns) beats an arm at 0.278 (garbling only function words) while scoring 0.667 recall
against 1.000. On the decisive utterance both arms scored an identical 0.231. So the
report below prints the disagreement explicitly rather than leaving it to be noticed.

Every number travels with what it was taken over: utterance count, and the degradation
condition. A recall figure without those is not a measurement, and it is the form in
which every published ranking arrives.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from . import audio, tts
from .recognizers import Recognizer, RecognizerError, get, load_from_env, names
from .wer import corpus_entity_fidelity, corpus_wer

# The demoted metric's threshold. Not a ranking input: an engine above it is disqualified
# outright, an engine below it is ranked on recall alone. Matches the session gate's
# default budget so the two surfaces do not quietly disagree about "unusable".
DEFAULT_WER_THRESHOLD = 0.35


@dataclass(frozen=True)
class ReferenceUtterance:
    """One line of the selection set: what was said, and in which language."""

    text: str
    lang: str = "en"


@dataclass
class EngineResult:
    name: str
    pairs: list[tuple[str, str]] = field(default_factory=list)
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error

    @property
    def wer(self) -> float:
        return corpus_wer(self.pairs).wer if self.pairs else 1.0

    @property
    def recall(self) -> float:
        return corpus_entity_fidelity(self.pairs).recall if self.pairs else 0.0

    @property
    def missing(self) -> tuple[str, ...]:
        return corpus_entity_fidelity(self.pairs).missing if self.pairs else ()


@dataclass
class BakeoffReport:
    results: list[EngineResult]
    condition: str
    utterances: int
    wer_threshold: float = DEFAULT_WER_THRESHOLD

    @property
    def scored(self) -> list[EngineResult]:
        return [r for r in self.results if r.ok]

    @property
    def eligible(self) -> list[EngineResult]:
        """Cleared the demoted metric's threshold. Only these are ranked."""
        return [r for r in self.scored if r.wer <= self.wer_threshold]

    def by_recall(self) -> list[EngineResult]:
        """The ranking that decides. Ties broken by the aggregate, which is what a
        threshold metric is for once it has stopped ranking."""
        return sorted(self.eligible, key=lambda r: (-r.recall, r.wer, r.name))

    def by_wer(self) -> list[EngineResult]:
        """The ranking a leaderboard would give. Reported only to expose disagreement."""
        return sorted(self.eligible, key=lambda r: (r.wer, r.name))

    def inversions(self) -> list[tuple[str, str]]:
        """Pairs (better_on_recall, better_on_wer) the two metrics order differently.

        A non-empty list is the whole argument for this module: on this set, choosing on
        the aggregate would buy a different engine than choosing on the errors that
        actually damage the product.
        """
        out: list[tuple[str, str]] = []
        rows = self.eligible
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                if a.recall > b.recall and a.wer > b.wer:
                    out.append((a.name, b.name))
                elif b.recall > a.recall and b.wer > a.wer:
                    out.append((b.name, a.name))
        return out


def build_audio(ref: ReferenceUtterance, *, gain: float, noise_snr_db: float | None, seed: int) -> bytes:
    """Synthesize once per utterance and degrade once — then hand the SAME bytes to every
    engine. Re-synthesizing per engine would make the arms differ by more than the engine,
    which is the one thing a paired comparison exists to prevent."""
    pcm = tts.synthesize(ref.text, ref.lang)
    effect = audio.make_effect(gain=gain, noise_snr_db=noise_snr_db, seed=seed)
    return effect(pcm) if effect is not None else pcm


def run_bakeoff(
    refs: list[ReferenceUtterance],
    engines: list[Recognizer],
    *,
    gain: float = 1.0,
    noise_snr_db: float | None = None,
    seed: int = 0,
    wer_threshold: float = DEFAULT_WER_THRESHOLD,
) -> BakeoffReport:
    results = [EngineResult(name=e.name) for e in engines]
    unreachable: dict[str, str] = {}
    for engine, result in zip(engines, results):
        ok, reason = engine.available()
        if not ok:
            # An unreachable engine is REPORTED, never silently dropped: a ranking over a
            # population that was never assembled is the failure this whole module is
            # about, one level up.
            result.error = reason
            unreachable[engine.name] = reason

    for ref in refs:
        pcm = build_audio(ref, gain=gain, noise_snr_db=noise_snr_db, seed=seed)
        for engine, result in zip(engines, results):
            if not result.ok:
                continue
            try:
                heard = engine.transcribe(pcm, lang=ref.lang)
            except RecognizerError as exc:
                result.error = str(exc)
                result.pairs.clear()
                continue
            result.pairs.append((ref.text, heard))

    return BakeoffReport(
        results=results,
        condition=audio.describe(gain, noise_snr_db),
        utterances=len(refs),
        wer_threshold=wer_threshold,
    )


def format_report(report: BakeoffReport) -> list[str]:
    lines = [
        "## Recogniser bake-off — ranked on decisive-term recall",
        f"   n={report.utterances} utterance(s)   condition: {report.condition}",
        f"   aggregate WER is a threshold at {report.wer_threshold:.0%}, not a ranking input",
        "",
    ]
    if not report.scored:
        lines.append("  no engine produced a transcript")
    for r in report.by_recall():
        lines.append(f"  {r.name:<20} recall {r.recall:6.1%}   WER {r.wer:6.1%}")
        if r.missing:
            lines.append(f"  {'':<20} lost: {', '.join(r.missing)}")

    disqualified = [r for r in report.scored if r.wer > report.wer_threshold]
    for r in disqualified:
        lines.append(f"  {r.name:<20} DISQUALIFIED — WER {r.wer:.1%} over the {report.wer_threshold:.0%} threshold")
    for r in report.results:
        if not r.ok:
            lines.append(f"  {r.name:<20} UNREACHABLE — {r.error}")

    inv = report.inversions()
    if inv:
        lines.append("")
        lines.append("  METRIC DISAGREEMENT — the aggregate would buy a different engine:")
        for better_recall, better_wer in inv:
            lines.append(f"    recall prefers {better_recall}; aggregate WER prefers {better_wer}")
        lines.append("    Choose on recall. The aggregate is dominated by tokens that decide nothing.")
    elif len(report.eligible) > 1:
        lines.append("")
        lines.append("  the two metrics agree on this set — the aggregate was a sufficient proxy here")
    return lines


# The default selection set. Small and ours, per the standard: held-out lines chosen for
# the terms they carry rather than for coverage. The first is the verbatim ground truth
# from the live Czech V1 call that produced the entity-fidelity metric in the first place,
# and it is the in-sentence language-switch case — a Czech sentence carrying English
# technology nouns — which is the case this product has already been broken by once.
DEFAULT_SET: list[ReferenceUtterance] = [
    ReferenceUtterance("Poslední rok dělám hlavně s Pythonem a Reactem, k tomu PostgreSQL a Docker.", "cs"),
    ReferenceUtterance("I led a team of five building a payments ledger on PostgreSQL and Kafka.", "en"),
    ReferenceUtterance("We deployed with Kubernetes and Terraform, and monitored it with Prometheus.", "en"),
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipeline.jobfit.eval.voice.bakeoff",
        description="Rank ASR engines on decisive-term recall over this product's own audio.",
    )
    parser.add_argument("--engine", action="append", default=[], metavar="NAME",
                        help="registered engine to score (repeatable); default: all registered")
    parser.add_argument("--gain", type=float, default=1.0, help="amplitude scale (<1 = quieter)")
    parser.add_argument("--noise-snr-db", type=float, default=None, help="additive noise at this SNR")
    parser.add_argument("--seed", type=int, default=0, help="degradation seed (a run is reproducible)")
    parser.add_argument("--wer-threshold", type=float, default=DEFAULT_WER_THRESHOLD)
    args = parser.parse_args(argv)

    loaded = load_from_env()
    wanted = args.engine or names()
    if not wanted:
        print(
            "no recognizers registered.\n"
            "  Add one with an environment variable, e.g.\n"
            '    KP_ASR_CMD_WHISPER="whisper-cli -m ggml-base.bin -l {lang} -nt -f {audio}"\n'
            "  then re-run. Registered from env this run: none.",
            file=sys.stderr,
        )
        return 2
    if loaded:
        print(f"registered from environment: {', '.join(loaded)}", file=sys.stderr)

    ok, reason = tts.available("en")
    if not ok:
        print(f"the selection set cannot be synthesized: {reason}", file=sys.stderr)
        return 2

    try:
        engines = [get(n) for n in wanted]
    except KeyError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    report = run_bakeoff(
        DEFAULT_SET, engines,
        gain=args.gain, noise_snr_db=args.noise_snr_db, seed=args.seed,
        wer_threshold=args.wer_threshold,
    )
    print("\n".join(format_report(report)))
    return 0 if report.eligible else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())

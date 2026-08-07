"""case-sim round evaluator — run every bundle-<persona>.json in a round folder
through the REAL devcase evaluation pipeline and write eval-<persona>.json beside it.

Usage:
    python casesim/eval_round.py casesim/round-YYYY-MM-DD-slug [--llm]

Deterministic by default (structure/discrimination testing is cheap and hermetic);
--llm routes each step through the configured provider like production.

Prints a compact per-persona summary table at the end.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def run_eval(round_dir: Path, bundle_path: Path, use_llm: bool) -> dict:
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    case = json.loads((round_dir / "case.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)

        def w(name: str, data) -> str:
            p = td_path / name
            p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return str(p)

        args = [
            sys.executable,
            "-m",
            "pipeline.jobfit.devcase.devcase_cli",
            "evaluate-submission",
            "--commits-json", w("commits.json", []),
            "--probes-json", w("probes.json", case.get("coverProbes") or []),
            "--case-json", w("case.json", case),
            "--role-json", str(round_dir / "role.json"),
            "--events-json", w("events.json", bundle.get("events") or []),
        ]
        if bundle.get("chat"):
            args += ["--chat-json", w("chat.json", bundle["chat"])]
        if bundle.get("files"):
            args += ["--files-json", w("files.json", bundle["files"])]
        if (round_dir / "seed.json").exists():
            args += ["--seed-json", str(round_dir / "seed.json")]
        if (round_dir / "baseline.json").exists():
            args += ["--baseline-json", str(round_dir / "baseline.json")]
        if not use_llm:
            args += ["--no-llm"]
        proc = subprocess.run(args, capture_output=True, text=True, cwd=REPO, timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(f"{bundle_path.name}: {proc.stderr.strip()[:500]}")
        return json.loads(proc.stdout)


def main() -> int:
    round_dir = REPO / sys.argv[1] if not Path(sys.argv[1]).is_absolute() else Path(sys.argv[1])
    use_llm = "--llm" in sys.argv
    rows = []
    for bundle_path in sorted(round_dir.glob("bundle-*.json")):
        persona = bundle_path.stem.replace("bundle-", "")
        envelope = run_eval(round_dir, bundle_path, use_llm)
        out = round_dir / f"eval-{persona}.json"
        out.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        r = envelope["result"]
        dims = r["evaluation"].get("dimensionScores", {})
        oc = r.get("observedChecks") or {}
        psig = oc.get("promptSignals") or {}
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        bulk_paste = any(
            e.get("kind") == "paste" and (e.get("size") or 0) >= 600  # PASTE_BULK_CHARS
            for e in (bundle.get("events") or [])
        )
        canaries = ",".join(f"{c['id']}:{c['status'][:4]}" for c in oc.get("canaryOutcomes", [])) or "-"
        rows.append({
            "persona": persona,
            **{k: dims.get(k) for k in ("framing", "tooling", "judgment", "architecture", "transfer")},
            "transferScore": r["transfer"].get("transferScore"),
            "prompts": psig.get("assistantPrompts"),
            "clarify": psig.get("clarifyingQuestions"),
            "briefPaste": psig.get("briefPasteRatio"),
            "bulkPaste": "Y" if bulk_paste else "-",
            "canaries": canaries,
            "baseSim": (oc.get("baselineSimilarity") or {}).get("bestSimilarity", "-"),
            "source": envelope.get("source"),
        })
    cols = ["persona", "framing", "tooling", "judgment", "architecture", "transfer", "transferScore", "prompts", "clarify", "briefPaste", "bulkPaste", "canaries", "baseSim", "source"]
    print("| " + " | ".join(cols) + " |")
    print("|" + "---|" * len(cols))
    for row in rows:
        print("| " + " | ".join(str(row.get(c, "")) for c in cols) + " |")

    # Mechanical discrimination verdict (round-1 follow-up, relaxed after round 2):
    # only the SOUND invariants are asserted — the verifier must top every other
    # canonical persona, and the delegator must rank strictly last among them. The
    # middle order (prompt-crafter vs minimal) is submission-dependent by design: a
    # disciplined minimalist with honest judgment can legitimately beat an
    # unverified prompt-jockey, and forcing a fixed middle order (round 2's first
    # assert) flagged a correct LLM ranking as a failure. The gamer is deliberately
    # NOT asserted — whether it fools the signals is a per-round finding to analyze.
    by = {r["persona"]: r.get("transferScore") or 0 for r in rows}
    canonical = [p for p in ("verifier", "prompt-crafter", "minimal", "delegator") if p in by]
    if len(canonical) >= 2:
        ok = True
        if "verifier" in by:
            ok = all(by["verifier"] >= by[p] for p in canonical)
        if "delegator" in by:
            ok = ok and all(by[p] > by["delegator"] for p in canonical if p != "delegator")
        ranked = sorted(canonical, key=lambda p: -by[p])
        print(f"\ndiscrimination: {'PASS' if ok else 'FAIL'} ({' > '.join(f'{p}:{by[p]}' for p in ranked)})")
        if not ok:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

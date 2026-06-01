from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .extractors import extract_text


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="Extract plain text from a CV/JD document (PDF, DOCX, TXT, MD)."
    )
    parser.add_argument("path", type=Path)
    args = parser.parse_args()

    # Reuse the exact extractor the CV pipeline uses (service.analyze) so a
    # caller that only has the file reads the SAME text the main analysis does.
    try:
        text = extract_text(args.path)
    except ValueError as exc:
        print(json.dumps({"error": str(exc), "status": 400}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 — surface any extractor failure as a 500
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({"text": text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

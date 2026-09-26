"""Extract a designed-CV PDF the two ways a hiring system might (scripts/cv/roundtrip.mjs).

A dev tool, not the pipeline: PyMuPDF and pypdfium2 are not in requirements.txt, and the
round trip that calls this is a declared npm script, never a request path.

  content order  pypdf's extract_text(): the order glyphs sit in the page's content
                 stream - what a text-order parser reads.
  positional     PyMuPDF words sorted by line (y) then x, with no column detection -
                 what a naive geometry-based parser reads. Two columns side by side on
                 one baseline come back as ONE line, which is exactly the failure the
                 round trip looks for.

Also returned: every text span's size, weight and colour (for the type-scale table), and,
with --png DIR, page one of each PDF rendered to PNG through pdfium.

Usage: python scripts/cv/extract_pdf.py [--png DIR] a.pdf [b.pdf ...]  -> JSON on stdout
"""

from __future__ import annotations

import json
import os
import sys


def positional_lines(page) -> list[str]:
    words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word_no
    rows: list[dict] = []
    for x0, y0, x1, y1, word, *_ in sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        yc = (y0 + y1) / 2
        h = max(y1 - y0, 1.0)
        row = rows[-1] if rows else None
        if row is not None and abs(row["yc"] - yc) <= h * 0.45:
            row["words"].append((x0, word))
        else:
            rows.append({"yc": yc, "words": [(x0, word)]})
    return [" ".join(w for _, w in sorted(r["words"], key=lambda t: t[0])) for r in rows]


def spans_of(page, page_no: int) -> list[dict]:
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue
                out.append(
                    {
                        "page": page_no,
                        "text": text,
                        "size": round(span["size"], 2),
                        "bold": bool(span["flags"] & 16) or "bold" in span["font"].lower() or "semibold" in span["font"].lower(),
                        "font": span["font"],
                        "color": "#%06x" % span["color"],
                        "y": round(span["bbox"][1], 1),
                        "y1": round(span["bbox"][3], 1),
                    }
                )
    return out


def main(argv: list[str]) -> int:
    png_dir = None
    if argv and argv[0] == "--png":
        png_dir = argv[1]
        argv = argv[2:]
    import fitz  # PyMuPDF
    from pypdf import PdfReader

    result = {}
    for path in argv:
        reader = PdfReader(path)
        doc = fitz.open(path)
        entry = {
            "pages": len(reader.pages),
            "title": (reader.metadata or {}).get("/Title"),
            "content": [p.extract_text() or "" for p in reader.pages],
            "positional": ["\n".join(positional_lines(p)) for p in doc],
            "spans": [s for i, p in enumerate(doc) for s in spans_of(p, i + 1)],
            # (base font, embedded file type) - "n/a" is a font the file does not carry.
            "fonts": sorted({(f[3], f[1]) for p in doc for f in p.get_fonts(full=True)}),
            "tagged": bool(reader.trailer["/Root"].get("/StructTreeRoot")),
            "bytes": os.path.getsize(path),
        }
        if png_dir:
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(path)
            base = os.path.splitext(os.path.basename(path))[0]
            pngs = []
            for i in range(len(pdf)):
                target = os.path.join(png_dir, f"{base}-p{i + 1}.png")
                pdf[i].render(scale=1.6).to_pil().save(target)
                pngs.append(target)
            entry["png"] = pngs
            pdf.close()
        result[path] = entry
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

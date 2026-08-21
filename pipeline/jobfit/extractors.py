from __future__ import annotations

import re
import unicodedata
import zipfile
from pathlib import Path

try:
    # defusedxml blocks entity-expansion ("billion laughs") bombs that stdlib
    # ElementTree would happily expand. Declared in requirements.txt; the size
    # cap below still bounds the input if it is somehow absent.
    from defusedxml.ElementTree import fromstring as _xml_fromstring
except ImportError:  # pragma: no cover
    from xml.etree.ElementTree import fromstring as _xml_fromstring


# Resource bounds: a real CV/JD is tiny, so these only ever trip on a malformed
# or hostile upload (zip bomb, multi-GB PDF). Generous, but not unbounded.
MAX_INPUT_BYTES = 25 * 1024 * 1024  # on-disk file size
MAX_DOCX_XML_BYTES = 40 * 1024 * 1024  # decompressed word/document.xml
MAX_PDF_PAGES = 200
MAX_TEXT_CHARS = 2_000_000  # cumulative extracted-text budget


MOJIBAKE_REPLACEMENTS = {
    "ÄŤ": "č",
    "ÄŚ": "Č",
    "ÄŒ": "Č",
    "Ä›": "ě",
    "Äš": "Ě",
    "ÄŹ": "ď",
    "ÄŽ": "Ď",
    "Ĺˇ": "š",
    "Ĺ ": "Š",
    "Ĺľ": "ž",
    "Ĺ˝": "Ž",
    "Ĺ™": "ř",
    "Ĺ�": "Ř",
    "ĹŻ": "ů",
    "Ăˇ": "á",
    "Ă©": "é",
    "Ă­": "í",
    "Ăł": "ó",
    "Ăş": "ú",
    "Ă˝": "ý",
}


def _reject_oversized(path: Path) -> None:
    """Cheap first gate: reject an oversized file before opening/decompressing it."""
    try:
        size = path.stat().st_size
    except OSError:
        return
    if size > MAX_INPUT_BYTES:
        raise ValueError(
            f"File is too large ({size // (1024 * 1024)} MB); limit is {MAX_INPUT_BYTES // (1024 * 1024)} MB."
        )


# Legacy single-byte code pages still reach the CV path as .txt/.md uploads: a
# "save as ANSI" on a Czech Windows box writes cp1250, a Western one cp1252.
# Reading those with ``errors="ignore"`` DELETED every byte that isn't valid
# UTF-8, so a Czech CV arrived with all of its diacritics silently gone
# ("Jiří Řezáč, Česká spořitelna" -> "Ji ez, esk spoitelna") and the name,
# company and taxonomy passes — and, in blind mode, the very text sent to the
# model — all ran on the mangled string.
#
# Which ANSI page it is cannot be read off the accented bytes themselves: cp1250's
# č/ě/ř/ů/ň/ď occupy the same slots as cp1252's è/ì/ø/ù/ò/ï, so either decode looks
# equally "letter-like". Š/š/Ž/ž DO discriminate — they sit at the SAME four
# positions in BOTH pages, so seeing one is evidence about the DOCUMENT (a
# Central-European language) rather than an artifact of the guess, and they are
# near-ubiquitous in Czech running text ("zkušenosti", "společnost", "služby",
# "možnost") while absent from French and German.
_CENTRAL_EUROPEAN_MARKERS = (b"\x8a", b"\x9a", b"\x8e", b"\x9e")  # Š š Ž ž in cp1250 AND cp1252


def _decode_text_document(data: bytes) -> str:
    """Decode a plain-text document, tolerating legacy single-byte code pages.

    UTF-8 first, via ``utf-8-sig`` so a Windows BOM is consumed instead of left as
    a stray U+FEFF glued to the first line (where it breaks the top-of-document
    name heuristics). A failure there proves the bytes are not UTF-8, so we pick a
    Windows ANSI page: cp1250 when the stream carries a Central-European marker
    byte, else cp1252. Whichever loses is still tried, because cp1252 leaves
    0x81/0x8D/0x8F/0x90/0x9D undefined — Ť/ť live at two of them, so a Czech
    document carrying one fails cp1252 outright and lands on cp1250 regardless.
    ``latin-1`` never fails and is the backstop.

    Known limit: a Czech document with no Š/š/Ž/ž/Ť/ť at all is read as cp1252, so
    its carons come out as Western grave accents. That is a visible mis-mapping
    rather than the previous silent deletion of every diacritic, and it is what a
    dedicated charset detector (an unpinned transitive dependency here) would be
    needed to settle.
    """
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    central_european = any(marker in data for marker in _CENTRAL_EUROPEAN_MARKERS)
    for encoding in ("cp1250", "cp1252") if central_european else ("cp1252", "cp1250"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def extract_text(path: Path) -> str:
    _reject_oversized(path)
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return _decode_text_document(path.read_bytes())[:MAX_TEXT_CHARS]
    if suffix == ".docx":
        return _extract_docx(path)
    if suffix == ".pdf":
        return _extract_pdf(path)
    raise ValueError(f"Unsupported file type: {suffix}. Use PDF, DOCX, TXT, or MD.")


def clean_text(text: str) -> str:
    text = repair_text_encoding(text)
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\x00", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def repair_text_encoding(text: str) -> str:
    """Repair common UTF-8-as-Windows-1250 mojibake seen in Czech PDFs/exports."""
    mojibake_markers = ("Ä", "Ĺ", "Ĺˇ", "Ĺľ", "Ĺ™", "Ă")
    if not any(marker in text for marker in mojibake_markers):
        return text
    replaced = text
    for broken, fixed in MOJIBAKE_REPLACEMENTS.items():
        replaced = replaced.replace(broken, fixed)
    try:
        repaired = text.encode("cp1250").decode("utf-8")
    except UnicodeError:
        return replaced
    return max((text, replaced, repaired), key=_czech_signal_score)


def _czech_signal_score(text: str) -> int:
    return sum(text.lower().count(char) for char in "áčďéěíňóřšťúůýž")


def _extract_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as docx:
        try:
            info = docx.getinfo("word/document.xml")
        except KeyError as exc:
            raise ValueError("DOCX is missing word/document.xml.") from exc
        # Guard the zip-bomb vector: a tiny .docx can declare a multi-GB body.
        if info.file_size > MAX_DOCX_XML_BYTES:
            raise ValueError(
                f"DOCX body is too large when decompressed ({info.file_size // (1024 * 1024)} MB) — possible zip bomb."
            )
        xml = docx.read("word/document.xml")
    root = _xml_fromstring(xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        texts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
        if texts:
            paragraphs.append("".join(texts))
    return clean_text("\n".join(paragraphs))


# Single source for the letter-spaced-run phenomenon (pypdf emitting
# ``K n o w l e d g e`` — runs of single Unicode letters separated by single
# spaces). ``[^\W\d_]`` is the Unicode-letter class shared by both consumers; the
# REPAIR pass (collapse_letter_spacing) and the COUNT pass (count_letter_spacing,
# used by pipeline.compare_extraction_quality) intentionally differ only in their
# run threshold ({2,} repairs aggressively, {3,} counts conservatively) and
# boundary style — kept explicit here rather than re-derived in pipeline.py.
_LETTER = r"[^\W\d_]"

_LETTER_SPACED_RUN = re.compile(
    rf"(?<!{_LETTER})(?:{_LETTER}\s){{2,}}{_LETTER}(?!{_LETTER})",
    flags=re.UNICODE,
)

_LETTER_SPACED_COUNT = re.compile(
    rf"\b(?:{_LETTER}\s){{3,}}{_LETTER}\b",
    flags=re.UNICODE,
)


# DoS bound (bug-ui-scan 2026-06-20 critical): the letter-spacing repair is an O(n)
# pass with a Python callback per match, so running it on a multi-megabyte adversarial
# buffer (e.g. "a a a a …" x 2 MB, the exact pathology it "repairs", at extreme length)
# can pin a worker's CPU — a DoS on the public extract/apply path. A real CV's extracted
# text is well under ~100 KB, so cap the repaired window and the number of collapses.
MAX_REPAIR_CHARS = 200_000
MAX_LETTER_SPACED_SUBS = 50_000


def collapse_letter_spacing(text: str) -> str:
    """Repair letter-spaced PDF text where each character is separated by a space.

    pypdf occasionally emits e.g. ``K n o w l e d g e`` for what should be
    ``Knowledge`` when the source PDF uses character-positioned text. The regex
    looks for runs of three or more single letters separated by single spaces
    and bounded by non-letter characters, then collapses the inner spaces.
    Compound terms like ``K n o w l e d g e - b a s e s`` become
    ``Knowledge - bases``; the surrounding spaces are intentionally preserved
    to avoid over-merging legitimate ``word - word`` separators.

    Bounded against adversarial input: only the leading ``MAX_REPAIR_CHARS`` are
    repaired (a CV longer than that is already pathological) and at most
    ``MAX_LETTER_SPACED_SUBS`` runs are collapsed, so a crafted multi-MB buffer
    can't exhaust CPU. The unrepaired tail passes through verbatim.
    """
    collapse = lambda match: match.group(0).replace(" ", "")  # noqa: E731
    if len(text) <= MAX_REPAIR_CHARS:
        return _LETTER_SPACED_RUN.sub(collapse, text, count=MAX_LETTER_SPACED_SUBS)
    head = _LETTER_SPACED_RUN.sub(collapse, text[:MAX_REPAIR_CHARS], count=MAX_LETTER_SPACED_SUBS)
    return head + text[MAX_REPAIR_CHARS:]


def count_letter_spacing(text: str) -> int:
    """Count letter-spaced runs (the {3,} extraction-quality signal).

    Conservative twin of :func:`collapse_letter_spacing`'s repair pattern, shared
    so both views of "letter-spaced" derive from one ``_LETTER`` class in one file
    (see ``pipeline.compare_extraction_quality``)."""
    return sum(1 for _ in _LETTER_SPACED_COUNT.finditer(text))


def _extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF parsing requires pypdf. Install it with: pip install pypdf") from exc

    reader = PdfReader(str(path))
    # Bound both the page count and the cumulative text so a giant/malicious PDF
    # can't exhaust memory during extraction.
    pages: list[str] = []
    total = 0
    for i, page in enumerate(reader.pages):
        if i >= MAX_PDF_PAGES or total >= MAX_TEXT_CHARS:
            break
        chunk = page.extract_text() or ""
        pages.append(chunk)
        total += len(chunk)
    return clean_text(collapse_letter_spacing("\n".join(pages)))

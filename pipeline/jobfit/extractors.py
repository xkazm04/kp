from __future__ import annotations

import re
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree


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


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore")
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
        xml = docx.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        texts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
        if texts:
            paragraphs.append("".join(texts))
    return clean_text("\n".join(paragraphs))


_LETTER_SPACED_RUN = re.compile(
    r"(?<![^\W\d_])(?:[^\W\d_]\s){2,}[^\W\d_](?![^\W\d_])",
    flags=re.UNICODE,
)


def collapse_letter_spacing(text: str) -> str:
    """Repair letter-spaced PDF text where each character is separated by a space.

    pypdf occasionally emits e.g. ``K n o w l e d g e`` for what should be
    ``Knowledge`` when the source PDF uses character-positioned text. The regex
    looks for runs of three or more single letters separated by single spaces
    and bounded by non-letter characters, then collapses the inner spaces.
    Compound terms like ``K n o w l e d g e - b a s e s`` become
    ``Knowledge - bases``; the surrounding spaces are intentionally preserved
    to avoid over-merging legitimate ``word - word`` separators.
    """
    return _LETTER_SPACED_RUN.sub(lambda match: match.group(0).replace(" ", ""), text)


def _extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF parsing requires pypdf. Install it with: pip install pypdf") from exc

    reader = PdfReader(str(path))
    pages = [page.extract_text() or "" for page in reader.pages]
    return clean_text(collapse_letter_spacing("\n".join(pages)))

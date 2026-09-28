"""Build the designed CV's fonts: static, single-file, Latin + Latin Extended.

    python scripts/cv/build-cv-fonts.py            # writes public/fonts/cv/*.woff2 + OFL files
    python scripts/cv/build-cv-fonts.py --check    # verifies the committed files match a rebuild

WHY THE CV HAS FONTS OF ITS OWN. The product loads its faces through next/font, which
serves VARIABLE fonts split into per-script files (latin, latin-ext). Chromium's PDF writer
embeds a variable font as a Type 3 font, and a word that mixes the two files switches font
mid-word: in the operator's own exported CV both pypdf and PyMuPDF read "Každan" and
"Česká Spořitelna" back with a break at every diacritic (measured 2026-09-28) - the name
an applicant-tracking parser files the candidate under. A STATIC instance covering both
ranges in ONE file embeds as TrueType and extracts whole (registry recruiting/
cv-presentation-and-parseability, export-format-and-round-trip-verification).

WHERE THEY COME FROM. The official variable fonts in the Google Fonts repository (all SIL
Open Font License 1.1, which permits this: instancing, subsetting and redistribution under
the same licence, with the licence text beside the files). Each download is checked
against the SHA-256 recorded below, so a rebuild is the same bytes or it refuses.

cv.css declares the families ("KP CV Inter" and friends) with these files first and the
product's own faces as the fallback.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "fonts" / "cv"
RAW = "https://raw.githubusercontent.com/google/fonts/{rev}/ofl/{path}"
REV = "main"

# family key -> (repository path of the variable font, its licence, sha256 or None, instances)
# Each instance: (file stem, {axis: value}). Axes not named keep their default.
FACES: dict[str, dict] = {
    "inter": {
        "font": "inter/Inter%5Bopsz,wght%5D.ttf",
        "ofl": "inter/OFL.txt",
        "sha256": "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
        "family": "KP CV Inter",
        "instances": [("inter-400", {"wght": 400, "opsz": 14}), ("inter-500", {"wght": 500, "opsz": 14}), ("inter-600", {"wght": 600, "opsz": 14}), ("inter-700", {"wght": 700, "opsz": 14})],
    },
    "fraunces": {
        "font": "fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
        "ofl": "fraunces/OFL.txt",
        "sha256": "177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb",
        "family": "KP CV Fraunces",
        "instances": [
            ("fraunces-400", {"wght": 400, "opsz": 24, "SOFT": 0, "WONK": 0}),
            ("fraunces-500", {"wght": 500, "opsz": 48, "SOFT": 0, "WONK": 0}),
            ("fraunces-600", {"wght": 600, "opsz": 48, "SOFT": 0, "WONK": 0}),
        ],
    },
    "bricolage": {
        "font": "bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf",
        "ofl": "bricolagegrotesque/OFL.txt",
        "sha256": "413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682",
        "family": "KP CV Bricolage",
        "instances": [("bricolage-500", {"wght": 500, "opsz": 24, "wdth": 100}), ("bricolage-700", {"wght": 700, "opsz": 48, "wdth": 100})],
    },
    "mono": {
        "font": "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
        "ofl": "jetbrainsmono/OFL.txt",
        "sha256": "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
        "family": "KP CV Mono",
        "instances": [("mono-400", {"wght": 400}), ("mono-500", {"wght": 500})],
    },
}

# Latin, Latin-1, Latin Extended-A/B and Additional (every European Latin script the four
# catalog locales and a CV's employers need), IPA-free; combining marks; the punctuation,
# currency, letterlike, arrow, math and geometric blocks a CV's bullets and dates use.
UNICODES = (
    [*range(0x0020, 0x007F), *range(0x00A0, 0x0250)]
    + [*range(0x02B0, 0x0370), *range(0x1E00, 0x1F00)]
    + [*range(0x2000, 0x2070), *range(0x20A0, 0x20D0), *range(0x2100, 0x2150), *range(0x2190, 0x2200), *range(0x2200, 0x2300), *range(0x25A0, 0x2600)]
)
FEATURES = ["kern", "liga", "calt", "clig", "ccmp", "locl", "mark", "mkmk", "tnum", "lnum", "pnum", "onum", "case", "frac", "ss01", "zero"]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "kp-cv-font-build/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def build(check: bool) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    drift: list[str] = []
    for key, face in FACES.items():
        data = fetch(RAW.format(rev=REV, path=face["font"]))
        digest = hashlib.sha256(data).hexdigest()
        if face["sha256"] and digest != face["sha256"]:
            print(f"{key}: the upstream font changed (sha256 {digest}); refusing to build from unknown bytes", file=sys.stderr)
            return 2
        print(f"{key}: {len(data):,} bytes, sha256 {digest}")
        licence = fetch(RAW.format(rev=REV, path=face["ofl"]))
        (OUT / f"OFL-{key}.txt").write_bytes(licence)
        for stem, axes in face["instances"]:
            font = TTFont(io.BytesIO(data))
            fvar = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes}
            pins = {tag: max(lo, min(hi, axes.get(tag, dflt))) for tag, (lo, dflt, hi) in fvar.items()}
            static = instancer.instantiateVariableFont(font, pins)
            opts = subset.Options()
            opts.flavor = "woff2"
            opts.layout_features = FEATURES
            opts.name_IDs = ["*"]
            opts.name_languages = ["*"]
            opts.notdef_outline = True
            opts.glyph_names = False
            sub = subset.Subsetter(opts)
            sub.populate(unicodes=UNICODES)
            sub.subset(static)
            buf = io.BytesIO()
            static.flavor = "woff2"
            # Reproducible bytes: keep the source's own timestamps (fontTools stamps "now"
            # into head.modified on save, and --check would then never match).
            static.recalcTimestamp = False
            static["head"].modified = font["head"].created
            static.save(buf)
            target = OUT / f"{stem}.woff2"
            if check:
                if not target.exists() or target.read_bytes() != buf.getvalue():
                    drift.append(target.name)
            else:
                target.write_bytes(buf.getvalue())
            print(f"  {stem}.woff2 {len(buf.getvalue()):,} bytes {pins}")
    if check and drift:
        print("differs from a rebuild: " + ", ".join(drift), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    sys.exit(build(ap.parse_args().check))

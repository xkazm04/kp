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

WHAT EACH FILE CALLS ITSELF. The instancer keeps the variable font's names: every Inter
weight came out as "Inter-Regular", Bricolage 500 as "96pt ExtraBold" and Fraunces as
"9pt Black" - the name a PDF embeds and a text extractor reports as the run's font, which
is where a parser that reads weight from the font name gets it. Each static instance is
named for what it is ("Inter-SemiBold"), with the weight and bold bits to match.
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
# Each instance: (file stem, {axis: value}). Axes not named keep their default. `name` is the
# family each file calls itself (none of the four licences reserves its font name); `family`
# is the one cv.css declares.
FACES: dict[str, dict] = {
    "inter": {
        "font": "inter/Inter%5Bopsz,wght%5D.ttf",
        "ofl": "inter/OFL.txt",
        "sha256": "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
        "name": "Inter",
        "family": "KP CV Inter",
        "instances": [("inter-400", {"wght": 400, "opsz": 14}), ("inter-500", {"wght": 500, "opsz": 14}), ("inter-600", {"wght": 600, "opsz": 14}), ("inter-700", {"wght": 700, "opsz": 14})],
    },
    "fraunces": {
        "font": "fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
        "ofl": "fraunces/OFL.txt",
        "sha256": "177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb",
        "name": "Fraunces",
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
        "name": "Bricolage Grotesque",
        "family": "KP CV Bricolage",
        "instances": [("bricolage-500", {"wght": 500, "opsz": 24, "wdth": 100}), ("bricolage-700", {"wght": 700, "opsz": 48, "wdth": 100})],
    },
    "mono": {
        "font": "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
        "ofl": "jetbrainsmono/OFL.txt",
        "sha256": "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
        "name": "JetBrains Mono",
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

WEIGHT_NAMES = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}
# Every name record the variable font carried about ITS naming: family, style, unique id,
# full name, PostScript name, typographic family/style, WWS family/style, and the
# variations PostScript prefix a static font has no use for.
RENAMED_IDS = (1, 2, 3, 4, 6, 16, 17, 21, 22, 25)


def name_instance(font: TTFont, family: str, weight: int) -> None:
    """Name a static instance for what it is: "Inter" SemiBold, PostScript "Inter-SemiBold"."""
    style = WEIGHT_NAMES[weight]
    ribbi = weight in (400, 700)  # the four styles the legacy family/style pair can express
    postscript = f"{family.replace(' ', '')}-{style}"
    records = {
        1: family if ribbi else f"{family} {style}",
        2: style if ribbi else "Regular",
        3: f"{font['head'].fontRevision:.3f};{postscript}",
        4: f"{family} {style}",
        6: postscript,
        16: family,
        17: style,
    }
    table = font["name"]
    for name_id in RENAMED_IDS:
        table.removeNames(nameID=name_id)
    for name_id, value in records.items():
        table.setName(value, name_id, 3, 1, 0x409)
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    bold, regular = 1 << 5, 1 << 6  # fsSelection bits
    os2.fsSelection = (os2.fsSelection & ~(bold | regular)) | (bold if weight == 700 else 0) | (regular if weight == 400 else 0)
    font["head"].macStyle = (font["head"].macStyle & ~1) | (1 if weight == 700 else 0)


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
            name_instance(static, face["name"], int(axes["wght"]))
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

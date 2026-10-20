"""Pins docs/architecture/price-book.md to MTOK_PRICES, in both directions: every
model and both of its rates appear in the book with the same number, and no book row
names a MTOK_PRICES entry the code no longer has. The TypeScript tables have the same
pin in app/_lib/price-book.test.ts."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit.llm.base import MTOK_PRICES

BOOK = Path(__file__).resolve().parents[3] / "docs" / "architecture" / "price-book.md"
HOME = re.compile(r'`pipeline/jobfit/llm/base\.py:MTOK_PRICES\["([^"]+)"\]\.(in|out)`')


def _book_rows() -> list[tuple[str, str, float]]:
    rows: list[tuple[str, str, float]] = []
    for line in BOOK.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) != 7:
            continue
        match = HOME.search(cells[6])
        if match:
            rows.append((match.group(1), match.group(2), float(cells[2])))
    return rows


class PriceBookPinsMtokPrices(unittest.TestCase):
    def test_every_code_rate_is_in_the_book(self) -> None:
        rows = {(model, side): rate for model, side, rate in _book_rows()}
        for model, (price_in, price_out) in MTOK_PRICES.items():
            for side, value in (("in", price_in), ("out", price_out)):
                self.assertIn((model, side), rows, f"price-book.md has no {model} {side} row")
                self.assertEqual(rows[(model, side)], value, f"{model} {side} drifted from the book")

    def test_no_book_row_names_a_missing_key(self) -> None:
        for model, side, _ in _book_rows():
            self.assertIn(model, MTOK_PRICES, f"price-book.md names {model} ({side}), not in MTOK_PRICES")

    def test_book_rows_are_not_duplicated(self) -> None:
        keys = [(model, side) for model, side, _ in _book_rows()]
        self.assertEqual(len(keys), len(set(keys)))


if __name__ == "__main__":
    unittest.main()

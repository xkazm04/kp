"""The backbone parity fixtures are checked from the PYTHON side too.

``app/_lib/app-master/backbone.ts`` is a line-for-line port of
:func:`pipeline.jobfit.appmaster.backbone_score`, pinned by
``app/_lib/app-master/backbone.test.ts`` against ``__fixtures__/backbone-*.json``
— files a human regenerates by running ``__fixtures__/generate.py`` by hand.

The header of ``backbone.ts`` claims "if either side moves, the fixtures stop
matching and the build says so". That was only ever half true. If the TS PORT
moves, ``backbone.test.ts`` goes red. If the PYTHON AUTHORITY moves — a weight,
a threshold, a reason string in ``appmaster.py`` — nothing re-runs the generator,
so the fixtures keep asserting the old rubric, the TS port keeps reproducing
them, and a roster verdict ships that silently disagrees with the authority it
claims to mirror.

This is the missing half, and it needs no new CI step: the gated suite already
runs everything under ``pipeline/jobfit/tests``. Every case in ``generate.py``'s
own ``CASES`` table is re-scored IN MEMORY through the generator's own path and
compared, byte for byte after canonical JSON, against the checked-in file.

Fail-first evidence (2026-09-05): with the authority's score perturbed by 10% in
memory (a stand-in for a weight moving in ``appmaster.py``), this module fails on
all three fixtures with the diff and the regenerate instruction, while
``backbone.test.ts`` stays green — which is exactly the hole. Nothing on disk was
touched by that experiment.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "app" / "_lib" / "app-master" / "__fixtures__"
GENERATOR = FIXTURE_DIR / "generate.py"


def _load_generator():
    """Import ``generate.py`` as a module.

    It is not inside a package (it lives beside the JSON it writes, under
    ``app/``), so it is loaded by path. Importing it does NOT run ``main()`` —
    the script guards on ``__name__``, so nothing is written to disk here.
    """
    spec = importlib.util.spec_from_file_location("app_master_fixture_generator", GENERATOR)
    assert spec is not None and spec.loader is not None, GENERATOR
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _canonical(value):
    """The comparison form: JSON with sorted keys, so a dict-ordering difference
    is never reported as a rubric change, and a float is compared through the
    same repr the fixture was written with."""
    return json.dumps(value, sort_keys=True)


class BackboneFixtureParityTests(unittest.TestCase):
    """The checked-in fixtures still equal what the authority produces today."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.generator = _load_generator()

    def test_generator_and_fixtures_exist(self) -> None:
        # NON-VACUITY: every assertion below is a loop over CASES, so an empty
        # table or a renamed directory would make this module pass while
        # checking nothing.
        self.assertTrue(GENERATOR.is_file(), f"the generator moved: {GENERATOR}")
        self.assertGreaterEqual(len(self.generator.CASES), 3)
        for name in self.generator.CASES:
            self.assertTrue((FIXTURE_DIR / f"backbone-{name}.json").is_file(), name)

    def test_every_fixture_still_equals_the_python_authority(self) -> None:
        backbone_model = self.generator.PerformanceBackbone
        score = self.generator.backbone_score

        for name, payload in self.generator.CASES.items():
            with self.subTest(case=name):
                path = FIXTURE_DIR / f"backbone-{name}.json"
                stored = json.loads(path.read_text(encoding="utf-8"))

                # The INPUT half: the fixture must be the case the generator
                # would write today, not a hand-edited variant of it.
                self.assertEqual(
                    _canonical(json.loads(json.dumps(payload))),
                    _canonical(stored["backbone"]),
                    f"backbone-{name}.json's input no longer matches CASES in generate.py",
                )

                # The OUTPUT half: re-score in memory and compare. This is the
                # assertion the TS side cannot make — it reads the fixture, so a
                # rubric change in appmaster.py is invisible to it.
                fresh = score(backbone_model.model_validate(payload))
                self.assertEqual(
                    _canonical(json.loads(json.dumps(fresh))),
                    _canonical(stored["expected"]),
                    (
                        f"pipeline.jobfit.appmaster.backbone_score no longer reproduces "
                        f"backbone-{name}.json. The rubric moved: regenerate with "
                        f"`python app/_lib/app-master/__fixtures__/generate.py` and re-run "
                        f"`npm run test:unit` for the TS port."
                    ),
                )

    def test_the_fixture_provenance_is_recorded(self) -> None:
        # The files claim where they came from; a fixture that lost that claim is
        # a fixture nobody can regenerate.
        for name in self.generator.CASES:
            stored = json.loads((FIXTURE_DIR / f"backbone-{name}.json").read_text(encoding="utf-8"))
            self.assertEqual(stored["_generatedBy"], "app/_lib/app-master/__fixtures__/generate.py")
            self.assertEqual(stored["_source"], "pipeline.jobfit.appmaster.backbone_score")


if __name__ == "__main__":
    unittest.main()

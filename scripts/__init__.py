"""Makes ``python -m scripts.<name>`` work, which the headless analysis scripts
have claimed to support since they were written and never did.

The scripts import their shared helpers as ``from _common import ...`` — a
top-level import, which resolves only when ``scripts/`` itself is on
``sys.path``. Python puts it there for ``python scripts/analyze.py`` (the
script's own directory) but NOT for ``python -m scripts.analyze``, where
``sys.path[0]`` is the repository root instead. So the module form raised
``ModuleNotFoundError: No module named '_common'`` at import time, before argv
was even parsed.

Importing a package runs this file first, so putting the directory on the path
here fixes every script in the folder at once, without editing five identical
import blocks or making them relative (a relative import would then break the
``python scripts/analyze.py`` form, which is the one the docs actually teach and
the one people use).

``scripts/_common.py`` puts the repository ROOT on the path for the opposite
reason — so ``pipeline.jobfit`` resolves when a script is launched from
somewhere else. The two together are what make both invocation forms work from
any working directory, and ``pipeline/jobfit/tests/test_scripts_entrypoints.py``
runs both so the claim cannot rot again.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

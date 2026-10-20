"""The engine seam: what the selection instrument is allowed to point AT.

The session driver (``el_ws``) speaks one provider's realtime CONVERSATION protocol
directly. That is the right shape for a regression test of that integration and the
wrong shape for a CHOICE between engines: a measurement welded to the incumbent can
score a regression and cannot score a candidate. Before this module the plane held an
excellent regression instrument and no choice instrument, so "which recogniser should
we use" fell back to whatever a vendor's leaderboard said — which ranks engines on
someone else's error distribution, not on ours.

A recogniser here is ONE method — PCM in, transcript out — deliberately much narrower
than a session. Choosing an engine needs neither turn-taking nor barge-in nor agent
replies; it needs the transcript the scorer will grade. Keeping the seam at that width
is what lets an offline binary and a hosted service sit behind the same name, and it is
why this is a new boundary rather than an abstraction over ``ElVoiceSession``.

Adding a candidate is a ``register()`` call or one environment variable, never an edit
to the harness.

Audio contract is the plane's existing one: 16-bit mono PCM at 16 kHz (``tts`` emits it,
``audio`` degrades it). Engines that want a file get a WAV wrapper built here, so the
contract stays PCM at every seam the harness owns.
"""

from __future__ import annotations

import io
import os
import shlex
import shutil
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol, runtime_checkable

TARGET_RATE = 16_000
SAMPLE_WIDTH = 2
CHANNELS = 1

# A candidate that cannot be reached must say WHY, in the same shape tts.available() uses:
# the reader learns "binary not on PATH", not "engine failed". A bake-off that silently
# drops an unreachable engine reports a ranking over a population it never assembled.
Availability = tuple[bool, str]


class RecognizerError(RuntimeError):
    """The engine was reachable and did not produce a transcript."""


@runtime_checkable
class Recognizer(Protocol):
    """PCM in, transcript out. The whole seam."""

    name: str

    def available(self) -> Availability:
        """(ok, reason) — is this engine usable right now, on this machine?"""
        ...

    def transcribe(self, pcm: bytes, *, lang: str = "en") -> str:
        """16 kHz mono PCM16 -> transcript text. Empty string means "heard nothing"."""
        ...


def pcm_to_wav(pcm: bytes, *, rate: int = TARGET_RATE) -> bytes:
    """Wrap raw PCM16 in a RIFF header. Every local ASR CLI takes a file, not a stream."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


@dataclass
class CallableRecognizer:
    """An in-process engine — a stub, a fake, or a Python-native model already imported.

    This is also what the tests use, so the seam is exercised without a subprocess.
    """

    name: str
    fn: Callable[[bytes, str], str]
    _reason: str = ""

    def available(self) -> Availability:
        return (True, "") if not self._reason else (False, self._reason)

    def transcribe(self, pcm: bytes, *, lang: str = "en") -> str:
        return self.fn(pcm, lang) or ""


@dataclass
class CommandRecognizer:
    """A local engine driven as a subprocess over a temp WAV.

    This is the drop-in path for an offline open-weights recogniser (whisper.cpp,
    faster-whisper, sherpa-onnx, vosk) WITHOUT the harness taking a dependency on any of
    them: the engine is a command template, so trying a new one is a string, and the
    project's install surface does not grow a model runtime it only needs at bake-off
    time.

    ``template`` is a shell-style command containing ``{audio}`` (required) and
    optionally ``{lang}``. stdout is the transcript.

        CommandRecognizer("whisper-cpp", "whisper-cli -m ggml-base.bin -l {lang} -nt -f {audio}")

    Rights note, because it is the one axis no probe can establish: an open-weights
    engine's licence governs what may be done with its OUTPUT, and a bake-off that ranks
    an engine the product may not ship has spent its budget on an unusable answer. Read
    the licence before adding a candidate here, not after it wins.
    """

    name: str
    template: str
    timeout_s: float = 120.0

    def _tokens(self) -> list[str]:
        """Split the template WITHOUT letting the splitter see a filesystem path.

        Two Windows hazards, both silent. ``shlex.split`` in POSIX mode treats ``\\`` as an
        escape, so formatting the path in first turns ``C:\\Users\\...\\tmp.wav`` into
        ``C:Users...tmp.wav`` and the engine reports a missing file for a file the harness
        definitely wrote. Splitting first fixes the substituted path; ``posix=False`` fixes
        the same corruption in paths the OPERATOR wrote into the template (a model path is
        the common case), at the cost of leaving quote characters on the tokens, which is
        why they are stripped here. This does not depend on the host OS running the
        harness: a Windows-style path can land in the template on any platform, so the
        protection has to be unconditional, not gated on ``os.name``.
        """
        toks = shlex.split(self.template, posix=False)
        return [t[1:-1] if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'" else t for t in toks]

    def _argv(self, audio_path: str, lang: str) -> list[str]:
        return [t.format(audio=audio_path, lang=lang) for t in self._tokens()]

    def available(self) -> Availability:
        if "{audio}" not in self.template:
            return False, f"{self.name}: command template has no {{audio}} placeholder"
        try:
            argv = self._argv("_probe.wav", "en")
        except (KeyError, IndexError, ValueError) as exc:
            return False, f"{self.name}: unusable command template ({exc})"
        if not argv:
            return False, f"{self.name}: empty command template"
        if shutil.which(argv[0]) is None:
            return False, f"{self.name}: {argv[0]} is not on PATH"
        return True, ""

    def transcribe(self, pcm: bytes, *, lang: str = "en") -> str:
        ok, reason = self.available()
        if not ok:
            raise RecognizerError(reason)
        # NamedTemporaryFile(delete=False) + explicit unlink: on Windows a still-open
        # handle cannot be reopened by the child, so the file is closed before the call.
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        try:
            tmp.write(pcm_to_wav(pcm))
            tmp.close()
            proc = subprocess.run(
                self._argv(tmp.name, lang),
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired as exc:
            raise RecognizerError(f"{self.name}: timed out after {self.timeout_s:g}s") from exc
        finally:
            try:
                Path(tmp.name).unlink()
            except OSError:
                pass
        if proc.returncode != 0:
            err = (proc.stderr or "").strip().splitlines()
            tail = err[-1] if err else f"exit {proc.returncode}"
            raise RecognizerError(f"{self.name}: {tail}")
        return (proc.stdout or "").strip()


# ---------------------------------------------------------------------------
# Registry. A candidate is registered, not wired in.
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Recognizer] = {}

ENV_PREFIX = "KP_ASR_CMD_"


def register(recognizer: Recognizer, *, replace: bool = False) -> None:
    name = recognizer.name
    if not name:
        raise ValueError("a recognizer needs a name — it is how the bake-off reports it")
    if name in _REGISTRY and not replace:
        raise ValueError(f"recognizer {name!r} is already registered (pass replace=True)")
    _REGISTRY[name] = recognizer


def unregister(name: str) -> None:
    _REGISTRY.pop(name, None)


def get(name: str) -> Recognizer:
    if name not in _REGISTRY:
        known = ", ".join(sorted(_REGISTRY)) or "(none registered)"
        raise KeyError(f"unknown recognizer {name!r}; registered: {known}")
    return _REGISTRY[name]


def names() -> list[str]:
    return sorted(_REGISTRY)


def load_from_env(environ: dict[str, str] | None = None) -> list[str]:
    """Register a command engine per ``KP_ASR_CMD_<NAME>`` variable.

    Lets a machine try a local model without committing a path or a model choice to the
    repo, which is the whole point of the local lane: the engine under test is an
    operator's decision, and the harness should not encode one machine's answer.

        KP_ASR_CMD_WHISPER="whisper-cli -m /models/ggml-base.bin -l {lang} -nt -f {audio}"
    """
    env = os.environ if environ is None else environ
    added: list[str] = []
    for key, value in env.items():
        if not key.startswith(ENV_PREFIX) or not value.strip():
            continue
        name = key[len(ENV_PREFIX):].lower()
        if not name:
            continue
        register(CommandRecognizer(name=name, template=value.strip()), replace=True)
        added.append(name)
    return sorted(added)

"""Local TTS for the synthetic candidate — Piper (ONNX, CPU, offline).

Text -> 16-bit mono PCM at 16 kHz, the exact format the ElevenLabs realtime WebSocket expects
for ``user_audio_chunk``. Piper voices synthesize at their own rate (22 050 Hz for the *-medium
voices), so we resample with soxr (best quality) / scipy / numpy-linear, in that order — never
``audioop``, which is deprecated and gone in Python 3.13.

Voices live in ``data/piper`` (gitignored, ~63 MB each):

    python -m piper.download_voices --download-dir data/piper en_US-lessac-medium cs_CZ-jirka-medium

Generation is fully offline — the only egress in the voice plane is the ElevenLabs session itself.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np

# The realtime protocol's user-audio format: pcm_16000, 16-bit signed, mono.
TARGET_RATE = 16_000
SAMPLE_WIDTH = 2
CHANNELS = 1

# One voice per interview language. Swap/extend for the accent matrix (V2).
VOICES: dict[str, str] = {
    "en": "en_US-lessac-medium",
    "cs": "cs_CZ-jirka-medium",
}


def voice_dir() -> Path:
    """Where the .onnx / .onnx.json voice files live (override with PIPER_VOICE_DIR)."""
    env = os.environ.get("PIPER_VOICE_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[4] / "data" / "piper"


def voice_path(lang: str) -> Path:
    name = VOICES.get(lang) or VOICES["en"]
    return voice_dir() / f"{name}.onnx"


def available(lang: str = "en") -> tuple[bool, str]:
    """(ok, reason) — is the TTS engine usable for this language?"""
    try:
        import piper  # noqa: F401
    except ImportError:
        return False, "piper-tts is not installed (pip install piper-tts)"
    p = voice_path(lang)
    if not p.exists():
        return False, f"voice model missing: {p} (python -m piper.download_voices --download-dir {voice_dir()} {VOICES.get(lang, '')})"
    return True, ""


def resample_to_16k(pcm: bytes, src_rate: int) -> bytes:
    """16-bit mono PCM at ``src_rate`` -> 16-bit mono PCM at 16 kHz."""
    if src_rate == TARGET_RATE:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16)
    if samples.size == 0:
        return b""
    try:  # best quality
        import soxr

        out = soxr.resample(samples.astype(np.float32), src_rate, TARGET_RATE)
    except ImportError:
        try:
            from scipy.signal import resample_poly

            from math import gcd

            g = gcd(src_rate, TARGET_RATE)
            out = resample_poly(samples.astype(np.float32), TARGET_RATE // g, src_rate // g)
        except ImportError:  # last resort: linear interpolation (adequate for band-limited speech)
            n_out = int(round(samples.size * TARGET_RATE / src_rate))
            out = np.interp(
                np.linspace(0, samples.size - 1, n_out, dtype=np.float64),
                np.arange(samples.size),
                samples.astype(np.float64),
            )
    return np.clip(np.rint(out), -32768, 32767).astype(np.int16).tobytes()


@lru_cache(maxsize=4)
def _load_voice(lang: str):
    from piper import PiperVoice

    ok, why = available(lang)
    if not ok:
        raise RuntimeError(why)
    return PiperVoice.load(str(voice_path(lang)))


def synthesize(text: str, lang: str = "en", *, gain: float = 1.0) -> bytes:
    """Speak ``text`` -> 16-bit mono PCM @16 kHz. ``gain`` (<1 = quieter) is the hook the V2
    mumbling / low-volume probes use."""
    text = (text or "").strip()
    if not text:
        return b""
    voice = _load_voice(lang)
    chunks = list(voice.synthesize(text))
    if not chunks:
        return b""
    src_rate = chunks[0].sample_rate
    pcm = b"".join(c.audio_int16_bytes for c in chunks)
    out = resample_to_16k(pcm, src_rate)
    if gain != 1.0 and out:
        samples = np.frombuffer(out, dtype=np.int16).astype(np.float32) * gain
        out = np.clip(np.rint(samples), -32768, 32767).astype(np.int16).tobytes()
    return out


def silence(ms: int) -> bytes:
    """``ms`` of digital silence in the target format (the idle 'mic' between utterances)."""
    return b"\x00\x00" * int(TARGET_RATE * ms / 1000)


def duration_s(pcm: bytes) -> float:
    return len(pcm) / (TARGET_RATE * SAMPLE_WIDTH * CHANNELS)

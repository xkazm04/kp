"""Audio degradations for the adversarial-audio probes (V2).

Real candidates don't call from a studio. These pure, deterministic transforms let the harness
speak the SAME persona through a controlled degradation and measure how transcript fidelity
(WER, and especially entity fidelity) degrades:

  * additive noise at a target SNR  — a noisy room / cheap headset,
  * gain reduction                  — a quiet / distant / mumbling speaker.

All operate on 16-bit mono PCM (the format the realtime protocol takes). Seeded, so a run is
reproducible and a regression is a real regression, not resampled RNG.
"""

from __future__ import annotations

from typing import Callable

import numpy as np


def apply_gain(pcm: bytes, gain: float) -> bytes:
    """Scale amplitude (<1 = quieter). 1.0 is a no-op."""
    if gain == 1.0 or not pcm:
        return pcm
    s = np.frombuffer(pcm, dtype=np.int16).astype(np.float64) * gain
    return np.clip(np.rint(s), -32768, 32767).astype(np.int16).tobytes()


def mix_noise(pcm: bytes, snr_db: float, *, seed: int = 0) -> bytes:
    """Add white Gaussian noise scaled so the signal-to-noise ratio is ``snr_db``. Lower dB = more
    noise; ~10 dB is a noticeably noisy line, ~0 dB is severe."""
    if not pcm:
        return pcm
    s = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
    sig_power = float(np.mean(s * s))
    if sig_power <= 0:  # silence has no SNR to target
        return pcm
    noise = np.random.default_rng(seed).standard_normal(s.size)
    noise_power = float(np.mean(noise * noise)) or 1.0
    target_noise_power = sig_power / (10.0 ** (snr_db / 10.0))
    noise *= np.sqrt(target_noise_power / noise_power)
    return np.clip(np.rint(s + noise), -32768, 32767).astype(np.int16).tobytes()


def measure_snr_db(clean_pcm: bytes, noisy_pcm: bytes) -> float:
    """SNR of ``noisy`` relative to ``clean`` (the residual is the noise) — for tests/reporting."""
    c = np.frombuffer(clean_pcm, dtype=np.int16).astype(np.float64)
    n = np.frombuffer(noisy_pcm, dtype=np.int16).astype(np.float64)
    m = min(c.size, n.size)
    if m == 0:
        return float("inf")
    c, n = c[:m], n[:m]
    sig = float(np.mean(c * c))
    err = float(np.mean((n - c) ** 2))
    if err <= 0:
        return float("inf")
    return 10.0 * np.log10(sig / err)


def make_effect(*, gain: float = 1.0, noise_snr_db: float | None = None, seed: int = 0) -> Callable[[bytes], bytes] | None:
    """Compose gain + noise into one ``pcm -> pcm`` transform (gain first, then noise so the SNR is
    measured against the actually-transmitted signal). None when there is nothing to apply."""
    if gain == 1.0 and noise_snr_db is None:
        return None

    def _effect(pcm: bytes) -> bytes:
        out = apply_gain(pcm, gain)
        if noise_snr_db is not None:
            out = mix_noise(out, noise_snr_db, seed=seed)
        return out

    return _effect


def describe(gain: float, noise_snr_db: float | None) -> str:
    parts = []
    if noise_snr_db is not None:
        parts.append(f"noise@{noise_snr_db:g}dB")
    if gain != 1.0:
        parts.append(f"gain@{gain:g}")
    return "+".join(parts) or "clean"

"""The voice plane's half of the E-SH-4 no-egress seal.

``elevenlabs_backend.py`` has always refused to reach api.elevenlabs.io under ``KP_OFFLINE``
(docs/architecture/self-hosting.md §7), and the harness doc claimed the spoken plane "inherits
the same seal". It did not: the realtime WebSocket driver, the app client and the session runner
had no ``KP_OFFLINE`` check at all, so an air-gapped install could still open a signed
``wss://api.elevenlabs.io`` session and stream a candidate's synthesized speech to a cloud host.
This module is the seal they now share.

Two shapes, mirroring the rest of the eval suite:

* :func:`voice_backend_available` — ``(ok, reason)``, the CLI preflight shape
  (``elevenlabs_backend.available``). The eval contract turns a False into **exit 2**.
* :func:`refuse_if_offline` — raises :class:`OfflineRefused` at the moment of egress, so a
  library caller that skipped the preflight still cannot reach the cloud.

The seal is about EGRESS, not about the loopback hop: talking to the kp dev server on
``localhost`` is on-box and stays legal under ``KP_OFFLINE`` (:func:`is_local_url` is what
decides). What is refused is every call that CAUSES cloud traffic — minting ElevenLabs
credentials, opening the realtime socket, or starting a run that does both.
"""

from __future__ import annotations

from ...llm.offline import is_offline

# What the harness would reach if the seal were not here. Named in every refusal so an
# operator reading a CI log knows which host was blocked, not just that "something" was.
EGRESS_HOST = "api.elevenlabs.io"


class OfflineRefused(RuntimeError):
    """A voice-plane call that would egress was refused by the KP_OFFLINE seal."""


def _reason(what: str) -> str:
    return (
        f"KP_OFFLINE is set (air-gapped no-egress mode): refusing to {what}. "
        f"The voice harness drives a REAL ElevenLabs realtime session ({EGRESS_HOST}) — there is "
        "no on-box alternative, so the spoken plane cannot run sealed. Unset KP_OFFLINE to use it."
    )


def voice_backend_available() -> tuple[bool, str]:
    """``(ok, reason)`` — may the spoken voice backend run in this environment?

    Preflight shape, deliberately identical to ``elevenlabs_backend.available()`` so both
    backends produce the same exit-2 refusal through the eval CLI contract."""
    if is_offline():
        return False, _reason("run the spoken voice backend")
    return True, ""


def refuse_if_offline(what: str) -> None:
    """Raise :class:`OfflineRefused` when the no-egress seal is on.

    ``what`` completes "refusing to …" — e.g. ``"open the ElevenLabs realtime WebSocket"``."""
    if is_offline():
        raise OfflineRefused(_reason(what))

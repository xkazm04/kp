"""Talk to the running kp app the way the browser does.

The voice harness deliberately mints its session through the APP's own endpoints rather than
hitting ElevenLabs directly, so a voice run exercises the real thing: session lifecycle
(created → in_progress → completed), the consent gate, credential minting, billing/metering, the
transcript persist, and — for entry-backed sessions — the scorecard.

Requires the dev server (`npm run dev`, default http://localhost:3000). The tokenless lab path is
dev-only (`isInterviewLabEnabled()`).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

DEFAULT_BASE_URL = "http://localhost:3000"


class AppError(RuntimeError):
    pass


def _post(base_url: str, path: str, body: dict, *, timeout: int = 60) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (localhost)
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise AppError(f"POST {path} -> {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise AppError(f"POST {path} failed ({exc.reason}). Is the dev server running at {base_url}?") from exc


def get_availability(base_url: str = DEFAULT_BASE_URL, *, timeout: int = 30) -> dict[str, bool]:
    try:
        with urllib.request.urlopen(f"{base_url.rstrip('/')}/api/interview/connect", timeout=timeout) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8")).get("availability", {})
    except urllib.error.URLError as exc:
        raise AppError(f"GET /api/interview/connect failed ({exc.reason}). Is the dev server running at {base_url}?") from exc


def simulate(
    base_url: str = DEFAULT_BASE_URL,
    *,
    mode: str = "regular",
    provider: str = "elevenlabs",
    language: str | None = None,
) -> dict[str, Any]:
    """Mint a **mode="candidate"** demo session (entryId stays null).

    This is the cheap way to exercise the REAL brief over voice: /connect returns ``agentPrompt``
    only for candidate-mode sessions (connect/route.ts:176), so the tokenless lab path silently
    tests ElevenLabs' stale dashboard prompt instead of ours. No pipeline entry is touched and no
    invite is dispatched. No entry ⇒ no scorecard: use :func:`create` for that."""
    body: dict[str, Any] = {"mode": mode, "provider": provider}
    if language:
        body["language"] = language
    return _post(base_url, "/api/interview/simulate", body)


def create(
    base_url: str = DEFAULT_BASE_URL,
    *,
    entry_id: str,
    provider: str = "elevenlabs",
    language: str | None = None,
    force: bool = True,
) -> dict[str, Any]:
    """Mint an ENTRY-BACKED candidate session: the grounded brief for that entry, and — because
    the session carries an entryId — /complete also synthesizes the scorecard. Side effects: it
    revokes the entry's open sessions and dispatches an invite through the Outbox."""
    body: dict[str, Any] = {"entryId": entry_id, "provider": provider, "force": force}
    if language:
        body["language"] = language
    return _post(base_url, "/api/interview/create", body, timeout=180)  # buildGroundedInterview may run prep


def connect(
    base_url: str = DEFAULT_BASE_URL,
    *,
    provider: str = "elevenlabs",
    consent: bool = True,
    token: str | None = None,
    language: str | None = None,
) -> dict[str, Any]:
    """Mint provider credentials + flip the session live. Returns
    ``{sessionId, token, provider, agentPrompt, connect: {signedUrl}}``.

    Omit ``token`` for a throwaway lab session (dev only); pass a candidate link's token to drive a
    real entry-backed session (that's the path that produces a scorecard)."""
    body: dict[str, Any] = {"provider": provider, "consent": consent}
    if token:
        body["token"] = token
    if language:
        body["language"] = language
    data = _post(base_url, "/api/interview/connect", body)
    if not data.get("connect", {}).get("signedUrl"):
        raise AppError(f"connect returned no signedUrl (provider={provider}): {data}")
    return data


def complete(
    base_url: str,
    *,
    token: str,
    session_id: str,
    transcript: list[dict],
    status: str = "completed",
) -> dict[str, Any]:
    """Persist the transcript exactly as the browser does on hang-up. For an entry-backed session
    with a non-empty transcript this also triggers the scorecard."""
    return _post(
        base_url,
        "/api/interview/complete",
        {"token": token, "sessionId": session_id, "transcript": transcript, "status": status},
        timeout=180,  # scorecard synthesis can spawn the LLM pipeline
    )

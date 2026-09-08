"""Drive the REAL intake API the way the composer does (HTTP simulation).

The in-process mode calls ``intake.run_intake_turn`` directly — it certifies the
dialog engine. This client certifies the PRODUCT: session creation, the JD
riding along as an attachment, every message through
``POST /api/intake/[id]/message`` (rate limits, persistence, the brief the route
actually stores) and finally ``POST /api/intake/[id]/promote`` — the step that
turns a captured brief into a JD + Job, and the only one that can prove a
simulated intake produces something promotable.

Two guards sit in front of every request, following the voice harness's
precedent (``eval/voice/app_client.py``):

* the base URL must be a loopback / private-network kp server, or a host the
  operator explicitly allowlisted (``KP_INTAKE_APP_ALLOWED_HOSTS``);
* under ``KP_OFFLINE`` only a genuine loopback host is allowed — the on-box hop
  stays legal, anything else is refused rather than quietly dialled.

Only ``urllib`` — the eval suite adds no runtime dependency for a bench harness.

Rate limits: the message and promote routes raise their ceilings to 600/10min
when the SERVER runs with ``KP_BENCH_MODE=1``; ``POST /api/intake`` (session
create) does NOT, so a run longer than 30 sessions per 10 minutes will meet a
429 there. That is why every call honours ``Retry-After`` instead of failing:
the run gets slower, never wrong.
"""

from __future__ import annotations

import ipaddress
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit

from ..llm.offline import is_local_url, is_offline

DEFAULT_BASE_URL = "http://localhost:3000"
ALLOWED_HOSTS_ENV = "KP_INTAKE_APP_ALLOWED_HOSTS"
MAX_RETRIES = 5
DEFAULT_RETRY_AFTER = 30.0
MAX_RETRY_AFTER = 600.0


class IntakeHttpError(RuntimeError):
    """A non-retryable HTTP failure from the intake API.

    ``code`` is the app's own error CODE when the body carried one
    (docs/architecture/api-contracts.md §1.1) — the client never invents a
    message of its own for a refusal the server named.
    """

    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def env_allowed_hosts(env: dict[str, str] | None = None) -> frozenset[str]:
    raw = (env if env is not None else os.environ).get(ALLOWED_HOSTS_ENV, "")
    return frozenset(h.strip().rstrip(".").lower() for h in raw.split(",") if h.strip())


def is_loopback(host: str) -> bool:
    host = (host or "").strip().rstrip(".").lower()
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class IntakeHttpClient:
    """Minimal urllib client for the operator-gated intake routes."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        allowed_hosts: frozenset[str] | set[str] | None = None,
        *,
        timeout: int = 180,
        sleep: Any = time.sleep,
    ) -> None:
        self.allowed_hosts = frozenset(h.lower() for h in (allowed_hosts or env_allowed_hosts()))
        self.base_url = self._validate(base_url)
        self.timeout = timeout
        self._sleep = sleep

    # --- guards -----------------------------------------------------------

    def _validate(self, base_url: str) -> str:
        url = (base_url or "").strip()
        if not url:
            raise IntakeHttpError("base_url is empty — pass the kp server, e.g. http://localhost:3000")
        parsed = urlsplit(url if "://" in url else f"http://{url}")
        if parsed.scheme.lower() not in ("http", "https"):
            raise IntakeHttpError(f"base_url {url!r} must be an http(s) URL (got {parsed.scheme!r})")
        host = (parsed.hostname or "").strip().rstrip(".").lower()
        if not host:
            raise IntakeHttpError(f"base_url {url!r} has no host")
        if is_offline() and not is_loopback(host):
            raise IntakeHttpError(
                f"KP_OFFLINE is set (air-gapped no-egress mode): refusing to drive {host!r}. "
                "Only a loopback kp server is on-box; point --http at localhost or unset KP_OFFLINE."
            )
        if host in self.allowed_hosts or is_local_url(url):
            return url.rstrip("/")
        raise IntakeHttpError(
            f"base_url {url!r} is not a loopback/private kp server. This harness creates sessions, "
            f"posts role descriptions and PROMOTES them into real jobs, so it only talks to your own "
            f"server; add {host!r} to {ALLOWED_HOSTS_ENV} if you really mean it."
        )

    # --- transport --------------------------------------------------------

    def _request(self, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        attempt = 0
        while True:
            request = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method, headers=headers)
            try:
                # The host was proven loopback/private/allowlisted in _validate.
                with urllib.request.urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                    raw = response.read().decode("utf-8")
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:600]
                code = None
                try:
                    payload = json.loads(detail)
                    code = payload.get("code") or payload.get("error")
                except (ValueError, AttributeError):
                    payload = None
                if exc.code == 429 and attempt < MAX_RETRIES:
                    attempt += 1
                    self._sleep(self._retry_after(exc.headers.get("Retry-After")))
                    continue
                raise IntakeHttpError(
                    f"{method} {path} -> {exc.code}" + (f" [{code}]" if code else "") + f": {detail}",
                    status=exc.code,
                    code=code if isinstance(code, str) else None,
                ) from exc
            except urllib.error.URLError as exc:
                raise IntakeHttpError(
                    f"{method} {path} failed ({exc.reason}). Is the kp server running at {self.base_url}?"
                ) from exc

    @staticmethod
    def _retry_after(header: str | None) -> float:
        try:
            seconds = float((header or "").strip())
        except ValueError:
            return DEFAULT_RETRY_AFTER
        return min(max(seconds, 1.0), MAX_RETRY_AFTER)

    # --- routes -----------------------------------------------------------

    def create(self, lang: str = "en") -> dict[str, Any]:
        return self._request("POST", "/api/intake", {"lang": lang})

    def attach(self, session_id: str, title: str, text: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/intake/{session_id}/attachments",
            {"action": "add", "kind": "note", "title": title[:120], "text": text},
        )

    def message(self, session_id: str, text: str) -> dict[str, Any]:
        return self._request("POST", f"/api/intake/{session_id}/message", {"message": text[:4000]})

    def promote(self, session_id: str, *, market_research: bool = False, case_design: bool = False) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/intake/{session_id}/promote",
            {"marketResearch": market_research, "caseDesign": case_design},
        )

    def get(self, session_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/intake/{session_id}")


# --- the HTTP half of the simulation ---------------------------------------

ATTACHMENT_TEXT_MAX = 20_000


def simulate_http(
    client: IntakeHttpClient,
    persona_provider: Any | None,
    posting: Any,
    scenario: dict,
    cap: int = 30,
    *,
    promote: bool = True,
) -> dict[str, Any]:
    """One full intake session against the running app.

    create → attach the JD as a note → answer turn by turn (the persona's first
    reply answers the seeded opener) → promote. Returns the same
    ``turns/brief/shape/done`` the in-process path produces, plus
    ``promoted`` (``{slug, jobId}`` or ``None``) and the session id, so
    ``check_dialog`` grades both paths identically.
    """
    lang = scenario.get("lang", "en")
    session = client.create(lang)
    session_id = session["id"]
    transcript = session.get("transcript") or []
    opener = transcript[-1]["text"] if transcript else ""
    turns: list[dict] = [{"role": "interviewer", "text": opener}]
    brief: dict = session.get("brief") or {}
    shape: str | None = session.get("shape")
    done = False

    body = getattr(posting, "body", "") or ""
    title = getattr(posting, "title", "") or scenario.get("title") or scenario["name"]
    if body:
        client.attach(session_id, f"JD — {title}"[:120], body[:ATTACHMENT_TEXT_MAX])

    golden = list(scenario.get("golden_answers") or [])
    index = 0
    for _ in range(cap):
        if persona_provider is None:
            if index >= len(golden):
                break
            message = golden[index]
            index += 1
        else:
            from .intake_eval import _persona_turn  # local import: one persona renderer, not two

            message = _persona_turn(persona_provider, scenario, turns)
        result = client.message(session_id, message)
        turns.append({"role": "candidate", "text": message})
        turns.append({"role": "interviewer", "text": result.get("reply", "")})
        brief = result.get("brief") or brief
        shape = result.get("shape") or shape
        done = bool(result.get("done"))
        if done:
            break

    promoted: dict[str, Any] | None = None
    promote_error: str | None = None
    if promote and done:
        try:
            promoted = client.promote(session_id)
        except IntakeHttpError as exc:
            # A refused promote is a FINDING about the brief, not a crashed run.
            promote_error = exc.code or str(exc)[:200]
    return {
        "session_id": session_id,
        "turns": turns,
        "brief": brief,
        "shape": shape,
        "done": done,
        "promoted": promoted,
        "promote_error": promote_error,
    }

"""KP_OFFLINE — hard no-egress mode for air-gapped self-host installs.

E-SH-4 (docs/architecture/self-hosting.md §7). When ``KP_OFFLINE`` is truthy, cloud LLM engines
refuse to run (``available()`` → False → the call site's deterministic fallback),
so nothing reaches api.openai.com / generativelanguage / api.anthropic.com / the
Claude CLI's cloud. The ONLY endpoint that stays usable is a genuinely **on-box /
private-network** model server — a loopback / unix-socket / private-IP / LAN-service
``base_url`` (Ollama, vLLM, an in-VPC proxy). A ``base_url`` (or Azure endpoint) that
resolves to a *public* host is NOT trusted just because it was configured: it is
sealed off exactly like the default cloud path (:func:`is_local_url` decides), so a
stray ``OPENAI_BASE_URL=https://api.openai.com/v1`` can never defeat the seal.

This is the Python half; the TS half guards ``fetch`` at server startup
(app/_lib/offline.ts) so the same flag also blocks GitHub/Polar/voice/JS-SDK egress.
Both are application-level backstops — the ultimate guarantee is a network egress
policy at the deployment layer, which SELF_HOSTING.md recommends alongside this flag.
"""

from __future__ import annotations

import ipaddress
import os
from typing import Mapping
from urllib.parse import urlsplit

_TRUTHY = {"1", "true", "yes", "on"}

# Hostname suffixes that only ever name an on-box / private-network service, never a
# public host — the mDNS / Docker / K8s / LAN conventions a self-host actually uses.
_LOCAL_HOST_SUFFIXES = (".local", ".internal", ".lan", ".home.arpa")
# Unix-domain-socket URL schemes (openai/httpx transports): on-box by construction.
_UNIX_SOCKET_SCHEMES = {"unix", "unix+http", "http+unix", "unix+https", "https+unix"}


def is_offline(env: Mapping[str, str] | None = None) -> bool:
    """True when KP_OFFLINE is set to a truthy value (1/true/yes/on)."""
    value = (env if env is not None else os.environ).get("KP_OFFLINE", "")
    return value.strip().lower() in _TRUTHY


def is_local_url(url: str | None) -> bool:
    """True when ``url`` names a genuinely on-box / private-network inference
    endpoint — one that stays inside an air-gapped deployment and may therefore
    keep serving under :func:`is_offline`. False for any public / routable host,
    which would egress candidate data off the box.

    Treated as local (allowed under KP_OFFLINE):

    * loopback — ``localhost``, ``127.0.0.0/8``, ``::1``
    * an RFC1918 / link-local / unique-local **private-IP** literal
    * a unix-domain-socket endpoint (``unix://`` / ``http+unix://`` …)
    * a bare single-label hostname (``ollama``, ``vllm``) or a ``*.local`` /
      ``*.internal`` / ``*.lan`` / ``*.home.arpa`` name — the container-/LAN-service
      DNS names a self-host reaches its private model server by

    NOT local (sealed off even when explicitly configured): ``api.openai.com``,
    ``openrouter.ai``, ``*.openai.azure.com``, any other dotted public FQDN, a
    public-IP literal, or a forwarding proxy. This is what stops a leftover cloud
    ``base_url`` from silently defeating the no-egress seal.
    """
    if not url or not url.strip():
        return False
    candidate = url.strip()
    # A bare ``host:port`` (no scheme) would parse the host as the scheme — prefix
    # ``//`` so it lands in netloc; a real ``scheme://…`` already contains ``://``.
    parsed = urlsplit(candidate if "://" in candidate else f"//{candidate}")
    if parsed.scheme.lower() in _UNIX_SOCKET_SCHEMES:
        return True
    host = (parsed.hostname or "").strip().rstrip(".").lower()
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        # Loopback / private / link-local IP literals never route off the box.
        return ip.is_loopback or ip.is_private or ip.is_link_local
    # A non-IP hostname: a single label (no dot) or an explicitly-private suffix is
    # a container/LAN service name; a dotted public FQDN (api.openai.com) is not.
    if "." not in host:
        return True
    return host.endswith(_LOCAL_HOST_SUFFIXES)

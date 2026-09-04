"""The voice harness's app client: base_url validation, the KP_OFFLINE seal, and the wire shape.

``app_client`` posts candidate transcripts and mints ElevenLabs credentials, and until now its
only statement about where it may point was a lint comment (``# noqa: S310 (localhost)``) with no
test behind it. Everything here is deterministic: the "server" is a ``http.server`` on 127.0.0.1
recording what it received, so no dev server, no ElevenLabs minutes, no network.
"""

from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from pipeline.jobfit.eval.voice import app_client
from pipeline.jobfit.eval.voice.seal import OfflineRefused


class _Handler(BaseHTTPRequestHandler):
    """Answers the four endpoints the harness uses; records every request on the server."""

    def log_message(self, *args):  # keep the unittest output clean
        pass

    def _send(self, payload: dict, code: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler's contract
        self.server.seen.append(("GET", self.path, None))
        self._send({"availability": {"elevenlabs": True, "openai": False}})

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        self.server.seen.append(("POST", self.path, body))
        if self.path == "/api/interview/connect":
            self._send({"sessionId": "s1", "token": "tok", "agentPrompt": "brief",
                        "connect": {"signedUrl": "wss://example.invalid/x"}})
        elif self.path == "/api/interview/simulate":
            self._send({"sessionId": "s1", "token": "tok"})
        elif self.path == "/api/interview/create":
            self._send({"sessionId": "s2", "token": "tok2"})
        elif self.path == "/api/interview/complete":
            self._send({"session": {"transcript": body.get("transcript") or []}, "scorecard": None})
        else:
            self._send({"error": "not found"}, 404)


class _FakeApp:
    """A loopback kp stand-in: ``with _FakeApp() as base_url:``."""

    def __enter__(self) -> str:
        self.httpd = HTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.seen = []
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return f"http://127.0.0.1:{self.httpd.server_port}"

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        return False

    @property
    def seen(self):
        return self.httpd.seen


class _Env:
    """Set/clear env vars for one block, restoring exactly what was there."""

    def __init__(self, **values):
        self.values = values
        self.saved: dict[str, str | None] = {}

    def __enter__(self):
        for k, v in self.values.items():
            self.saved[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return self

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return False


class TestBaseUrlValidation(unittest.TestCase):
    def test_loopback_and_private_hosts_are_accepted(self):
        for url in ("http://localhost:3000", "http://127.0.0.1:3100/", "http://192.168.1.9:3000",
                    "http://kp.internal:3000", "http://kp:3000", "https://[::1]:3000"):
            with self.subTest(url=url):
                self.assertTrue(app_client.validate_base_url(url).startswith(("http://", "https://")))

    def test_trailing_slash_is_stripped_once(self):
        self.assertEqual(app_client.validate_base_url("http://localhost:3000/"), "http://localhost:3000")

    def test_public_host_is_refused(self):
        with _Env(KP_VOICE_APP_ALLOWED_HOSTS=None):
            for url in ("https://kp.example.com", "http://8.8.8.8:3000", "https://api.elevenlabs.io"):
                with self.subTest(url=url), self.assertRaises(app_client.AppError) as cm:
                    app_client.validate_base_url(url)
                self.assertIn("not a loopback/private", str(cm.exception))

    def test_non_http_scheme_and_empty_are_refused(self):
        for url in ("file:///etc/passwd", "ftp://localhost/x", "gopher://localhost", ""):
            with self.subTest(url=url), self.assertRaises(app_client.AppError):
                app_client.validate_base_url(url)

    def test_allowlist_env_opens_one_host(self):
        with _Env(KP_VOICE_APP_ALLOWED_HOSTS="staging.kp.example.com"):
            self.assertEqual(
                app_client.validate_base_url("https://staging.kp.example.com/"),
                "https://staging.kp.example.com",
            )
            with self.assertRaises(app_client.AppError):
                app_client.validate_base_url("https://other.example.com")

    def test_every_entry_point_validates(self):
        """A bad base_url is refused before any socket is opened, on every public call."""
        bad = "https://kp.example.com"
        with _Env(KP_VOICE_APP_ALLOWED_HOSTS=None, KP_OFFLINE=None):
            with self.assertRaises(app_client.AppError):
                app_client.get_availability(bad)
            with self.assertRaises(app_client.AppError):
                app_client.simulate(bad)
            with self.assertRaises(app_client.AppError):
                app_client.create(bad, entry_id="e1")
            with self.assertRaises(app_client.AppError):
                app_client.connect(bad)
            with self.assertRaises(app_client.AppError):
                app_client.complete(bad, token="t", session_id="s", transcript=[])


class TestOfflineSeal(unittest.TestCase):
    def test_credential_minting_is_refused_offline(self):
        app = _FakeApp()
        with app as base, _Env(KP_OFFLINE="1"):
            for name, call in (("simulate", lambda: app_client.simulate(base)),
                               ("create", lambda: app_client.create(base, entry_id="e1")),
                               ("connect", lambda: app_client.connect(base))):
                with self.subTest(call=name), self.assertRaises(OfflineRefused) as cm:
                    call()
                self.assertIn("api.elevenlabs.io", str(cm.exception))
            # Refused BEFORE the wire: the fake app was never asked for anything.
            self.assertEqual(app.seen, [])

    def test_loopback_read_still_works_offline(self):
        """The seal is about cloud egress, not the on-box hop: reading availability from the
        operator's own server stays legal under KP_OFFLINE."""
        with _FakeApp() as base, _Env(KP_OFFLINE="1"):
            self.assertEqual(app_client.get_availability(base), {"elevenlabs": True, "openai": False})


class TestAgainstFakeServer(unittest.TestCase):
    def test_round_trip(self):
        with _FakeApp() as base, _Env(KP_OFFLINE=None):
            fake = base
            avail = app_client.get_availability(fake)
            self.assertTrue(avail["elevenlabs"])
            minted = app_client.simulate(fake, mode="student", language="cs")
            self.assertEqual(minted["token"], "tok")
            session = app_client.connect(fake, token="tok", language="cs")
            self.assertEqual(session["connect"]["signedUrl"], "wss://example.invalid/x")
            saved = app_client.complete(fake, token="tok", session_id="s1",
                                        transcript=[{"role": "candidate", "text": "hi"}])
            self.assertEqual(len(saved["session"]["transcript"]), 1)

    def test_connect_without_signed_url_is_an_error(self):
        class _NoUrl(_Handler):
            def do_POST(self):  # noqa: N802
                n = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(n)
                self._send({"sessionId": "s1"})

        httpd = HTTPServer(("127.0.0.1", 0), _NoUrl)
        httpd.seen = []
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            with _Env(KP_OFFLINE=None), self.assertRaises(app_client.AppError) as cm:
                app_client.connect(f"http://127.0.0.1:{httpd.server_port}")
            self.assertIn("signedUrl", str(cm.exception))
        finally:
            httpd.shutdown()
            httpd.server_close()
            t.join(timeout=5)

    def test_http_error_carries_the_status_and_body(self):
        class _Boom(_Handler):
            def do_POST(self):  # noqa: N802
                n = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(n)
                self._send({"error": "SESSION_LOCKED"}, 409)

        httpd = HTTPServer(("127.0.0.1", 0), _Boom)
        httpd.seen = []
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            with _Env(KP_OFFLINE=None), self.assertRaises(app_client.AppError) as cm:
                app_client.simulate(f"http://127.0.0.1:{httpd.server_port}")
            self.assertIn("409", str(cm.exception))
            self.assertIn("SESSION_LOCKED", str(cm.exception))
        finally:
            httpd.shutdown()
            httpd.server_close()
            t.join(timeout=5)

    def test_unreachable_server_names_the_base_url(self):
        with _Env(KP_OFFLINE=None), self.assertRaises(app_client.AppError) as cm:
            # Port 1 on loopback: valid target, nothing listening.
            app_client.get_availability("http://127.0.0.1:1", timeout=5)
        self.assertIn("127.0.0.1:1", str(cm.exception))


if __name__ == "__main__":
    unittest.main()

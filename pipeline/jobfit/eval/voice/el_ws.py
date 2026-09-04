"""Headless ElevenLabs realtime driver — the synthetic candidate's mouth and ears.

Speaks the protocol the browser SDK speaks, with no browser, no microphone and no speakers:

  client -> {"user_audio_chunk": "<base64 PCM16 mono 16 kHz>"}      (streamed at real-time pace)
  client -> {"type": "pong", "event_id": N}                          (answering the server ping)
  server -> conversation_initiation_metadata | user_transcript | agent_response
            | audio | interruption | vad_score | ping

Two details make it behave like a real call rather than a batch upload:

* **The mic never stops.** A background task emits a 100 ms chunk every 100 ms — our synthesized
  speech when queued, digital silence otherwise. Server-side VAD sees a continuous stream, so
  end-of-turn detection and (later) barge-in behave as they do for a human.
* **Audio is paced in real time.** Latency and turn-taking are meaningless if you dump the whole
  utterance at once, so a 4-second reply takes 4 seconds to speak.

Collected per session: the transcript (as the browser would record it), the spoken GROUND TRUTH
(for WER), and first-audio latency per turn.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from dataclasses import dataclass, field

from websockets.asyncio.client import connect as ws_connect

from . import tts
from .seal import refuse_if_offline

CHUNK_MS = 100
# Pause after the agent's audio has finished PLAYING before we take our turn.
AGENT_GAP_S = 0.4
# The agent's TEXT (agent_response) lands before its audio starts. Wait at least this long for
# audio to begin before concluding the turn was genuinely text-only — otherwise we talk over it.
NO_AUDIO_GRACE_S = 3.0
# Silence streamed after an utterance so server VAD sees end-of-speech.
TRAILING_SILENCE_MS = 900
DEFAULT_AGENT_RATE = 16_000


@dataclass
class VoiceSessionResult:
    conversation_id: str | None = None
    turns: list[dict] = field(default_factory=list)          # browser-shaped VoiceTurn[]
    agent_responses: list[str] = field(default_factory=list)
    user_transcripts: list[str] = field(default_factory=list)  # EL's ASR of what we said
    ground_truth: list[str] = field(default_factory=list)      # what we ACTUALLY said
    latencies_s: list[float] = field(default_factory=list)     # speech-end -> first agent audio
    interruptions: int = 0
    agent_audio_s: float = 0.0
    errored: str | None = None


class ElVoiceSession:
    """One headless spoken interview over the ElevenLabs realtime WebSocket."""

    def __init__(self, signed_url: str, agent_prompt: str | None = None, language: str | None = None):
        self.signed_url = signed_url
        self.agent_prompt = agent_prompt
        self.language = language
        self.result = VoiceSessionResult()

        self._ws = None
        self._buf = bytearray()
        self._buf_lock = asyncio.Lock()
        self._closing = False

        # per-turn state
        self._speech_end: float | None = None
        self._first_audio_after_speech: float | None = None
        self._last_audio_at: float | None = None
        self._saw_agent_activity = False
        # The agent's audio arrives FASTER than real time (the client is expected to play it), so
        # "chunks stopped arriving" is NOT "the agent stopped talking". Track a virtual playback
        # clock: the wall-clock instant at which the audio we've received finishes playing. Without
        # this the harness talks over the agent and its speech is dropped.
        self._agent_rate = DEFAULT_AGENT_RATE
        self._playback_end: float | None = None

    # -- lifecycle ----------------------------------------------------------

    async def __aenter__(self):
        # The E-SH-4 no-egress seal, at the exact byte of egress: this socket is a
        # wss:// session to api.elevenlabs.io carrying the candidate's speech. The
        # CLI preflights refuse earlier (exit 2); this catches a direct library caller.
        refuse_if_offline("open the ElevenLabs realtime WebSocket")
        self._ws = await ws_connect(self.signed_url, max_size=16 * 1024 * 1024, ping_interval=20)
        await self._send_init()
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._mic_task = asyncio.create_task(self._mic_loop())
        return self

    async def __aexit__(self, *exc):
        self._closing = True
        for task in (getattr(self, "_mic_task", None), getattr(self, "_recv_task", None)):
            if task:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001 — teardown is best-effort
                    pass
        if self._ws:
            await self._ws.close()
        return False

    async def _send_init(self) -> None:
        init: dict = {"type": "conversation_initiation_client_data"}
        agent: dict = {}
        if self.agent_prompt:
            # Exactly what VoiceInterview.tsx sends: the candidate-safe prompt as an override.
            agent["prompt"] = {"prompt": self.agent_prompt}
        if self.language:
            agent["language"] = self.language
        if agent:
            init["conversation_config_override"] = {"agent": agent}
        await self._ws.send(json.dumps(init))

    # -- the mic: 100 ms of audio every 100 ms, forever ---------------------

    async def _mic_loop(self) -> None:
        n_bytes = int(tts.TARGET_RATE * tts.SAMPLE_WIDTH * CHUNK_MS / 1000)
        interval = CHUNK_MS / 1000
        next_at = time.monotonic()
        while not self._closing:
            async with self._buf_lock:
                chunk = bytes(self._buf[:n_bytes])
                del self._buf[:n_bytes]
            if len(chunk) < n_bytes:
                chunk += b"\x00" * (n_bytes - len(chunk))  # idle mic = silence
            try:
                await self._ws.send(json.dumps({"user_audio_chunk": base64.b64encode(chunk).decode("ascii")}))
            except Exception:  # noqa: BLE001 — socket closed under us
                return
            next_at += interval
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))

    # -- the ears -----------------------------------------------------------

    async def _recv_loop(self) -> None:
        try:
            async for raw in self._ws:
                await self._handle(json.loads(raw))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            self.result.errored = f"{type(exc).__name__}: {exc}"

    def _apply_agent_format(self, fmt: str) -> None:
        """Turn the agent's declared output format into the bytes -> seconds clock.

        ONLY raw PCM is measurable here ("pcm_16000" -> 16000). The old rule — any trailing
        digits — also fired on the other formats the EL dashboard offers, and produced a
        confidently wrong clock instead of an error:

        * ``mp3_22050_32`` parsed its BITRATE as the sample rate (32), so every chunk read
          ~500x too long, ``_playback_end`` ran minutes into the future and every turn burned
          the full 90 s timeout — a healthy agent reported as "agent did not reply".
        * ``ulaw_8000`` is 1 byte per sample, so a 16-bit reading HALVED every duration and
          the harness took its turn while the agent was still talking; its speech was cut and
          the utterances came back dropped or garbled, scored as ASR failure.

        Neither is a number this driver can honestly compute, so the run fails with the
        reason rather than reporting mis-paced audio as a measurement.
        """
        fmt = fmt.strip().lower()
        if not fmt:
            return  # not declared — keep the protocol default (pcm_16000)
        tail = fmt.rsplit("_", 1)[-1]
        if fmt.startswith("pcm_") and tail.isdigit() and int(tail) > 0:
            self._agent_rate = int(tail)
            return
        self.result.errored = (
            f"agent_output_audio_format={fmt!r} is not raw PCM — this driver paces turns by "
            "converting agent audio bytes to seconds and can only do that for pcm_<rate>; "
            "set the agent's output format to PCM"
        )

    async def _handle(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "ping":
            ev = msg.get("ping_event") or {}
            await self._ws.send(json.dumps({"type": "pong", "event_id": ev.get("event_id")}))
        elif kind == "conversation_initiation_metadata":
            ev = msg.get("conversation_initiation_metadata_event") or {}
            self.result.conversation_id = ev.get("conversation_id")
            self._apply_agent_format(str(ev.get("agent_output_audio_format") or ""))
        elif kind == "user_transcript":
            text = ((msg.get("user_transcription_event") or {}).get("user_transcript") or "").strip()
            if text:
                self.result.user_transcripts.append(text)
                self.result.turns.append({"role": "candidate", "text": text})
        elif kind == "agent_response":
            text = ((msg.get("agent_response_event") or {}).get("agent_response") or "").strip()
            if text:
                self.result.agent_responses.append(text)
                self.result.turns.append({"role": "interviewer", "text": text})
            self._saw_agent_activity = True
        elif kind == "audio":
            now = time.monotonic()
            b64 = ((msg.get("audio_event") or {}).get("audio_base_64")) or ""
            dur = len(base64.b64decode(b64)) / (self._agent_rate * tts.SAMPLE_WIDTH)
            self.result.agent_audio_s += dur
            # Advance the playback clock: this chunk plays after whatever is already queued.
            self._playback_end = max(self._playback_end or now, now) + dur
            if self._speech_end is not None and self._first_audio_after_speech is None:
                self._first_audio_after_speech = now
                self.result.latencies_s.append(now - self._speech_end)  # time-to-first-audio
            self._last_audio_at = now
            self._saw_agent_activity = True
        elif kind == "interruption":
            self.result.interruptions += 1
            self._playback_end = time.monotonic()  # the agent stopped talking; drop queued playback

    # -- turn taking --------------------------------------------------------

    def begin_turn(self) -> None:
        """Reset per-turn latency/playback state. Call before speaking each utterance."""
        self._speech_end = None
        self._first_audio_after_speech = None
        self._last_audio_at = None
        self._saw_agent_activity = False
        self._playback_end = None

    async def speak(self, text: str, lang: str = "en", *, effect=None) -> float:
        """Synthesize + stream ``text`` at real-time pace; returns its duration in seconds.
        ``effect`` (pcm->pcm) applies an audio degradation (noise / gain) — the V2 probes."""
        pcm = tts.synthesize(text, lang)
        if effect is not None:
            pcm = effect(pcm)
        self.result.ground_truth.append(text)
        async with self._buf_lock:
            self._buf.extend(pcm)
            self._buf.extend(tts.silence(TRAILING_SILENCE_MS))
        while True:  # drained == we've finished speaking (trailing silence keeps the mic alive)
            async with self._buf_lock:
                if not self._buf:
                    break
            await asyncio.sleep(0.02)
        # End of SPEECH, not end of the mic buffer. The drain above also streamed
        # TRAILING_SILENCE_MS of digital silence, at real-time pace, so it took exactly that
        # long — stamping the drain instant charged the pad to nobody and reported every
        # first-audio latency ~0.9 s SHORT (a call whose real p95 was 8.5 s read as 7.6 s and
        # passed the 8 s budget). The provider's end-of-turn detection runs during that pad
        # and a candidate sits through it, so it belongs INSIDE the measured latency.
        self._speech_end = time.monotonic() - TRAILING_SILENCE_MS / 1000.0
        return tts.duration_s(pcm)

    async def wait_for_agent_start(self, timeout: float = 30.0) -> bool:
        """Return once the agent has STARTED responding (before it finishes) — the cue for a
        barge-in probe to cut in mid-utterance. False on timeout."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.result.errored:
                return False  # the driver has already failed; waiting cannot fix it
            if self._saw_agent_activity:
                return True
            await asyncio.sleep(0.05)
        return False

    async def wait_for_agent_turn(self, timeout: float = 90.0) -> bool:
        """Block until the agent has FINISHED SPEAKING — i.e. the audio it streamed has finished
        playing on our virtual clock, plus a small human gap. False on timeout.

        Waiting on chunk-arrival quiet instead would talk over the agent: EL pushes the whole
        utterance in a couple of seconds even though it is 20 seconds of speech."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:  # 1) any sign of life (text usually lands before audio)
            # A driver-level failure (a dead socket, an unmeasurable audio format) cannot be
            # waited out: without this the harness burned the WHOLE timeout per turn on a
            # session it already knew was broken, and reported the timeout as the reason.
            if self.result.errored:
                return False
            if self._saw_agent_activity:
                break
            await asyncio.sleep(0.05)
        else:
            return False
        activity_at = time.monotonic()
        while time.monotonic() < deadline:  # 2) its speech has finished playing
            if self.result.errored:
                return False
            now = time.monotonic()
            if self._playback_end is not None:
                # Playback drained AND no chunk has arrived recently (a slow network can let the
                # clock run dry mid-utterance; requiring both keeps us from cutting the agent off).
                arrival_quiet = self._last_audio_at is None or (now - self._last_audio_at) >= AGENT_GAP_S
                if now >= self._playback_end + AGENT_GAP_S and arrival_quiet:
                    return True
            elif now - activity_at > NO_AUDIO_GRACE_S:
                return True  # audio never started: a genuinely text-only turn
            await asyncio.sleep(0.05)
        return False

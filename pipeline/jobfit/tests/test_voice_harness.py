"""CI guard for the voice plane's pure pieces (no network, no ElevenLabs minutes).

The WebSocket driver and the smoke CLI need a live agent, so they're exercised by
`python -m pipeline.jobfit.eval.voice.v0_smoke`. Everything deterministic is pinned here:
WER (the metric the whole plane rests on), the 16 kHz PCM contract, and the request mapping.
"""

import unittest

from pipeline.jobfit.eval.voice import tts
from pipeline.jobfit.eval.voice.wer import corpus_wer, normalize, wer


class TestNormalize(unittest.TestCase):
    def test_lowercases_and_strips_punctuation(self):
        self.assertEqual(normalize("Hi, thanks!  I built a ledger."), ["hi", "thanks", "i", "built", "a", "ledger"])

    def test_preserves_czech_diacritics(self):
        # "reky" vs "řeky" is a REAL ASR error — normalization must not hide it.
        self.assertEqual(normalize("Řeky"), ["řeky"])
        self.assertNotEqual(normalize("řeky"), normalize("reky"))

    def test_nfc_composed_and_decomposed_compare_equal(self):
        self.assertEqual(normalize("řek"), normalize("řek"))  # combining caron vs precomposed

    def test_empty(self):
        self.assertEqual(normalize("   "), [])

    def test_edge_punctuation_is_not_a_word(self):
        # ' and - are kept for INTRA-word use only. At a word edge they used to survive as
        # tokens, so a persona line written with a dash charged the ASR a deletion for a
        # sound no TTS ever makes, and a quoted word scored a substitution against a
        # correctly heard one.
        self.assertEqual(normalize("sure - I led the migration"), ["sure", "i", "led", "the", "migration"])
        self.assertEqual(normalize("'yes' -- really"), ["yes", "really"])
        self.assertEqual(normalize("e-mail don't"), ["e-mail", "don't"])  # intra-word survives
        self.assertEqual(wer("sure - I led it", "sure I led it").wer, 0.0)


class TestWer(unittest.TestCase):
    def test_perfect_match_is_zero(self):
        r = wer("I built a payments ledger", "i built a payments ledger!")
        self.assertEqual(r.wer, 0.0)
        self.assertEqual((r.substitutions, r.deletions, r.insertions), (0, 0, 0))

    def test_substitution(self):
        r = wer("I built a ledger", "I built a leger")
        self.assertEqual(r.substitutions, 1)
        self.assertEqual(r.wer, 0.25)  # 1 error / 4 ref words

    def test_deletion_and_insertion(self):
        self.assertEqual(wer("a b c", "a c").deletions, 1)
        self.assertEqual(wer("a c", "a b c").insertions, 1)

    def test_hallucination_from_silence_is_full_error(self):
        # Nothing said, ASR invented words.
        self.assertEqual(wer("", "hello there").wer, 1.0)
        self.assertEqual(wer("", "").wer, 0.0)

    def test_wer_can_exceed_one(self):
        r = wer("yes", "yes indeed absolutely certainly")
        self.assertGreater(r.wer, 1.0)

    def test_accuracy_clamps(self):
        self.assertEqual(wer("yes", "yes").accuracy, 1.0)
        self.assertEqual(wer("yes", "a b c d").accuracy, 0.0)

    def test_corpus_wer_pools_errors_not_means(self):
        # 0 errors / 4 words, then 1 error / 1 word -> 1/5, NOT mean(0, 1.0)=0.5
        agg = corpus_wer([("a b c d", "a b c d"), ("x", "y")])
        self.assertEqual(agg.ref_words, 5)
        self.assertAlmostEqual(agg.wer, 0.2)


class TestPcmContract(unittest.TestCase):
    def test_silence_is_16k_16bit_mono(self):
        pcm = tts.silence(100)
        self.assertEqual(len(pcm), int(tts.TARGET_RATE * tts.SAMPLE_WIDTH * 0.1))
        self.assertAlmostEqual(tts.duration_s(pcm), 0.1, places=6)

    def test_resample_is_a_noop_at_target_rate(self):
        pcm = tts.silence(50)
        self.assertIs(tts.resample_to_16k(pcm, tts.TARGET_RATE), pcm)

    def test_resample_preserves_duration_and_width(self):
        import numpy as np

        # 0.25 s of a 440 Hz tone at 22 050 Hz (Piper's native rate for the -medium voices)
        src_rate = 22_050
        t = np.arange(int(src_rate * 0.25)) / src_rate
        tone = (np.sin(2 * np.pi * 440 * t) * 12000).astype(np.int16).tobytes()
        out = tts.resample_to_16k(tone, src_rate)
        self.assertEqual(len(out) % 2, 0)  # still 16-bit frames
        self.assertAlmostEqual(tts.duration_s(out), 0.25, places=2)

    def test_resample_of_empty_is_empty(self):
        self.assertEqual(tts.resample_to_16k(b"", 22_050), b"")

    def test_available_reports_reason_for_missing_voice(self):
        ok, why = tts.available("en")
        if not ok:
            self.assertTrue(why)  # must explain itself, never a bare False


class TestVoiceMetricsAndGates(unittest.TestCase):
    """V1: percentiles, spoken-text clipping, and the voice reliability invariants."""

    def _run(self, **over):
        from pipeline.jobfit.eval.voice.session_runner import VoiceRun

        r = VoiceRun(scenario="t")
        r.ground_truth = over.pop("ground_truth", ["hello there friend"])
        r.heard = over.pop("heard", ["hello there friend"])
        r.latencies_s = over.pop("latencies_s", [1.0])
        r.agent_prompt_used = over.pop("agent_prompt_used", True)
        for k, v in over.items():
            setattr(r, k, v)
        return r

    def test_percentile_nearest_rank(self):
        from pipeline.jobfit.eval.voice.session_runner import percentile

        self.assertIsNone(percentile([], 0.5))
        self.assertEqual(percentile([5.0], 0.95), 5.0)
        self.assertEqual(percentile([1.0, 2.0, 3.0], 0.5), 2.0)
        self.assertEqual(percentile([1.0, 2.0, 3.0, 4.0], 0.95), 4.0)

    def test_clip_spoken_cuts_on_word_boundary(self):
        from pipeline.jobfit.eval.voice.session_runner import MAX_SPOKEN_CHARS, clip_spoken

        long = "alpha bravo " * 40
        out = clip_spoken(long)
        self.assertLessEqual(len(out), MAX_SPOKEN_CHARS + 1)  # +1 for the appended period
        self.assertFalse(out[:-1].endswith(" "))
        self.assertNotIn("brav.", out)  # never a mid-word slice
        self.assertEqual(clip_spoken("  short   reply "), "short reply")

    def test_dropped_utterance_detected(self):
        run = self._run(ground_truth=["hi there"], heard=["..."])
        self.assertEqual(run.dropped, [0])

    def test_clean_run_has_no_issues(self):
        from pipeline.jobfit.eval.voice.session_runner import voice_checks

        run = self._run()
        run.stored_turns = 0
        run.turns = []
        self.assertEqual(voice_checks(run, wer_budget=0.35, latency_budget_s=8.0), [])

    def test_gates_fire(self):
        from pipeline.jobfit.eval.voice.session_runner import voice_checks

        dropped = voice_checks(self._run(heard=["..."]), wer_budget=0.35, latency_budget_s=8.0)
        self.assertTrue(any("dropped" in i for i in dropped))

        bad_wer = voice_checks(self._run(heard=["totally different words here"]), wer_budget=0.10, latency_budget_s=8.0)
        self.assertTrue(any("WER" in i for i in bad_wer))

        slow = voice_checks(self._run(latencies_s=[20.0]), wer_budget=0.35, latency_budget_s=8.0)
        self.assertTrue(any("latency" in i for i in slow))

        # The finding that motivated V1: a session that didn't run OUR brief must not pass silently.
        dash = voice_checks(self._run(agent_prompt_used=False), wer_budget=0.35, latency_budget_s=8.0)
        self.assertTrue(any("dashboard prompt" in i for i in dash))

    def test_persist_mismatch_is_an_issue(self):
        from pipeline.jobfit.eval.voice.session_runner import voice_checks

        run = self._run()
        run.turns = [{"role": "interviewer", "text": "a"}, {"role": "candidate", "text": "b"}]
        run.stored_turns = 1  # /complete clamped or dropped a turn
        self.assertTrue(any("persisted" in i for i in voice_checks(run, wer_budget=0.35, latency_budget_s=8.0)))

    def test_metrics_payload_shape(self):
        run = self._run(latencies_s=[0.5, 2.5])
        m = run.metrics()
        for key in ("wer", "wer_words", "latencies", "latency_p50", "latency_p95", "dropped",
                    "utterances", "interruptions", "agent_prompt_used", "ground_truth", "heard"):
            self.assertIn(key, m)
        self.assertEqual(m["dropped"], 0)
        self.assertEqual(m["utterances"], 1)


class TestEntityFidelity(unittest.TestCase):
    """The V2 metric — catches the React->Rust class that aggregate WER misses."""

    def test_domain_terms_prefix_matches_czech_inflection(self):
        from pipeline.jobfit.eval.voice.wer import domain_terms

        self.assertEqual(
            domain_terms("Dělám hlavně s Pythonem a Reactem, k tomu PostgreSQL a Docker."),
            {"python", "react", "postgresql", "docker"},
        )

    def test_longest_prefix_wins_and_no_false_positive(self):
        from pipeline.jobfit.eval.voice.wer import domain_terms

        self.assertEqual(domain_terms("we used javascript"), {"javascript"})  # not also "java"
        self.assertEqual(domain_terms("a reactionary opinion"), set())        # "react" must not match

    def test_the_v1_finding_is_caught(self):
        # The exact ground-truth vs ASR from the live Czech V1 call.
        from pipeline.jobfit.eval.voice.wer import corpus_wer, entity_fidelity

        gt = "Poslední rok dělám hlavně s Pythonem a Reactem, k tomu PostgreSQL a Docker."
        heard = "Poslední rok dělám hlavně s Pythonem a Rustem, k tomu později SQL a Docker."
        ef = entity_fidelity(gt, heard)
        self.assertEqual(set(ef.missing), {"react", "postgresql"})
        self.assertAlmostEqual(ef.recall, 0.5)
        self.assertFalse(ef.ok)
        # …and the very reason it needs its own gate: aggregate WER stays INSIDE the default budget,
        # so a WER gate waves this through while two skills were fabricated.
        self.assertLess(corpus_wer([(gt, heard)]).wer, 0.35)

    def test_no_terms_is_perfect(self):
        from pipeline.jobfit.eval.voice.wer import entity_fidelity

        ef = entity_fidelity("thanks for making the time", "thanks for making the time")
        self.assertTrue(ef.ok)
        self.assertEqual(ef.total, 0)

    def test_corpus_pools_missing(self):
        from pipeline.jobfit.eval.voice.wer import corpus_entity_fidelity

        agg = corpus_entity_fidelity([("I use React", "I use React"), ("with Kafka", "with Kafta")])
        self.assertEqual(list(agg.missing), ["kafka"])
        self.assertAlmostEqual(agg.recall, 0.5)  # 1 kept of 2


class TestAudioEffects(unittest.TestCase):
    def _tone(self, secs=0.3, rate=16000):
        import numpy as np

        t = np.arange(int(rate * secs)) / rate
        return (np.sin(2 * np.pi * 300 * t) * 8000).astype(np.int16).tobytes()

    def test_mix_noise_hits_target_snr(self):
        from pipeline.jobfit.eval.voice.audio import measure_snr_db, mix_noise

        clean = self._tone()
        noisy = mix_noise(clean, 10.0, seed=1)
        self.assertAlmostEqual(measure_snr_db(clean, noisy), 10.0, delta=0.5)

    def test_lower_snr_is_noisier(self):
        from pipeline.jobfit.eval.voice.audio import measure_snr_db, mix_noise

        clean = self._tone()
        self.assertLess(measure_snr_db(clean, mix_noise(clean, 0.0, seed=1)),
                        measure_snr_db(clean, mix_noise(clean, 20.0, seed=1)))

    def test_noise_is_seeded_reproducible(self):
        from pipeline.jobfit.eval.voice.audio import mix_noise

        clean = self._tone()
        self.assertEqual(mix_noise(clean, 10.0, seed=7), mix_noise(clean, 10.0, seed=7))

    def test_gain_scales_amplitude(self):
        import numpy as np

        from pipeline.jobfit.eval.voice.audio import apply_gain

        clean = self._tone()
        quiet = np.frombuffer(apply_gain(clean, 0.25), dtype=np.int16)
        loud = np.frombuffer(clean, dtype=np.int16)
        self.assertAlmostEqual(np.abs(quiet).max() / np.abs(loud).max(), 0.25, delta=0.02)

    def test_make_effect_none_when_clean(self):
        from pipeline.jobfit.eval.voice.audio import describe, make_effect

        self.assertIsNone(make_effect())
        self.assertEqual(describe(1.0, None), "clean")
        self.assertEqual(describe(0.5, 10.0), "noise@10dB+gain@0.5")
        self.assertIsNotNone(make_effect(noise_snr_db=10.0))


class TestBargeInGate(unittest.TestCase):
    def _run(self, barge_in, barged):
        from pipeline.jobfit.eval.voice.session_runner import VoiceRun

        r = VoiceRun(scenario="t")
        r.ground_truth = ["hi"]
        r.heard = ["hi"]
        r.latencies_s = [1.0]
        r.barge_in = barge_in
        r.barged = barged
        r.agent_prompt_used = True
        return r

    def test_barge_in_is_informational_not_gated(self):
        # A no-yield is reported (run.barged) but must NOT fail the gate — it can be the EL agent's
        # interruption config rather than a defect, and a hard gate would just flag config as failure.
        from pipeline.jobfit.eval.voice.session_runner import voice_checks

        self.assertEqual(voice_checks(self._run(True, False), wer_budget=0.35, latency_budget_s=8.0), [])
        self.assertEqual(voice_checks(self._run(True, True), wer_budget=0.35, latency_budget_s=8.0), [])
        self.assertTrue(self._run(True, False).metrics()["barge_in"])  # still surfaced in metrics

    def test_entity_gate_in_voice_checks(self):
        from pipeline.jobfit.eval.voice.session_runner import VoiceRun, voice_checks

        r = VoiceRun(scenario="t")
        r.ground_truth = ["I used React and Docker"]
        r.heard = ["I used Rust and Docker"]
        r.latencies_s = [1.0]
        issues = voice_checks(r, wer_budget=0.90, latency_budget_s=8.0)  # WER budget deliberately loose
        self.assertTrue(any("domain term" in i and "react" in i for i in issues))


class TestVoiceBackendAggregate(unittest.TestCase):
    def test_corpus_wer_pools_across_sessions(self):
        from pipeline.jobfit.eval.interview_eval import Row, _aggregate

        def row(name, S, N, lat):
            r = Row(scenario=name, brief="default", behavior="b", seniority="senior", turns=[],
                    ended=True, errored=False, source="voice")
            r.voice = {"wer": S / N, "wer_words": N, "substitutions": S, "deletions": 0, "insertions": 0,
                       "latencies": lat, "latency_p50": lat[0], "latency_p95": lat[-1], "dropped": 0,
                       "utterances": 1, "interruptions": 0, "agent_audio_s": 5.0, "agent_prompt_used": True}
            return r

        agg = _aggregate([row("a", 0, 90, [1.0]), row("b", 10, 10, [3.0])])
        v = agg["voice"]
        self.assertEqual(v["sessions"], 2)
        self.assertEqual(v["wer_words"], 100)
        self.assertAlmostEqual(v["corpus_wer"], 0.10)  # 10 errors / 100 words, NOT mean(0, 1.0)
        self.assertEqual(v["brief_ours"], 2)

    def test_no_voice_key_without_voice_rows(self):
        from pipeline.jobfit.eval.interview_eval import Row, _aggregate

        r = Row(scenario="a", brief="default", behavior="b", seniority="senior", turns=[],
                ended=True, errored=False, source="llm")
        self.assertNotIn("voice", _aggregate([r]))


class TestElRequestMapping(unittest.TestCase):
    """The EL text backend's mapping is shared conceptually with the voice plane's overrides."""

    def test_scenario_to_request_carries_persona(self):
        from pipeline.jobfit.eval import elevenlabs_backend as el
        from pipeline.jobfit.eval.interview_eval import _scenario_from_dict

        s = _scenario_from_dict({
            "name": "t", "candidate_prompt": "be terse", "first_message": "hi",
            "language": "cs", "expect": {"must_hold": ["no_decision"], "handles": "terse"},
        })
        cfg = el.scenario_to_request(s)["simulation_specification"]["simulated_user_config"]
        self.assertEqual(cfg["prompt"], "be terse")
        self.assertEqual(cfg["language"], "cs")


class TestBriefIsMintedPerScenario(unittest.TestCase):
    """A voice run must speak each scenario at the brief it is SCORED against.

    `agent_prompt_used` only asserts that *a* brief came back from /connect, so minting one
    global sim mode would run a student scenario against the default brief and still pass every
    gate — a paid, confident, wrong result. These pin the derivation.
    """

    def _scn(self, name, brief):
        from pipeline.jobfit.eval.interview_eval import _scenario_from_dict

        return _scenario_from_dict({"name": name, "brief": brief, "candidate_prompt": "p", "first_message": "hi"})

    def test_map_matches_the_simulate_route(self):
        from pipeline.jobfit.eval.interview_eval import BRIEF_SIM_MODE

        # simulate/route.ts: "regular" -> defaultInterviewerInstructions, "student" -> studentInterviewerInstructions.
        self.assertEqual(BRIEF_SIM_MODE["default"], "regular")
        self.assertEqual(BRIEF_SIM_MODE["student"], "student")
        # `grounded` has no sim mode — it only exists on an entry-backed session.
        self.assertNotIn("grounded", BRIEF_SIM_MODE)

    def test_split_sends_grounded_to_the_entry_path(self):
        from pipeline.jobfit.eval.interview_eval import sim_brief_split

        runnable, needs_entry = sim_brief_split([
            self._scn("a", "default"), self._scn("b", "student"), self._scn("c", "grounded"),
        ])
        self.assertEqual([s.name for s in runnable], ["a", "b"])
        self.assertEqual([s.name for s in needs_entry], ["c"])

    def test_curated_bank_has_a_grounded_scenario_to_skip(self):
        # If this ever goes empty the skip path stops being exercised by the real bank.
        from pipeline.jobfit.eval.interview_eval import load_scenarios, sim_brief_split

        _, needs_entry = sim_brief_split(load_scenarios())
        self.assertTrue(needs_entry, "expected at least one grounded scenario in the curated bank")

    def test_run_scenarios_voice_derives_mode_from_each_brief(self):
        import asyncio

        from pipeline.jobfit.eval import interview_eval as ie
        from pipeline.jobfit.eval.voice import session_runner
        from pipeline.jobfit.eval.voice.session_runner import VoiceRun

        seen: dict[str, str] = {}

        async def fake_run(s, *, sim_mode, **kw):
            seen[s.name] = sim_mode
            return VoiceRun(scenario=s.name, turns=[], ground_truth=["hi"], heard=["hi"], agent_prompt_used=True)

        orig = session_runner.run_voice_scenario
        session_runner.run_voice_scenario = fake_run
        try:
            ie.run_scenarios_voice(
                [self._scn("d", "default"), self._scn("s", "student")],
                base_url="http://unused", turns=1,
            )
        finally:
            session_runner.run_voice_scenario = orig
            asyncio.set_event_loop_policy(None)

        self.assertEqual(seen, {"d": "regular", "s": "student"})

    def test_explicit_sim_mode_overrides_every_scenario(self):
        import asyncio

        from pipeline.jobfit.eval import interview_eval as ie
        from pipeline.jobfit.eval.voice import session_runner
        from pipeline.jobfit.eval.voice.session_runner import VoiceRun

        seen: dict[str, str] = {}

        async def fake_run(s, *, sim_mode, **kw):
            seen[s.name] = sim_mode
            return VoiceRun(scenario=s.name, turns=[], ground_truth=["hi"], heard=["hi"], agent_prompt_used=True)

        orig = session_runner.run_voice_scenario
        session_runner.run_voice_scenario = fake_run
        try:
            ie.run_scenarios_voice(
                [self._scn("d", "default"), self._scn("s", "student")],
                base_url="http://unused", turns=1, sim_mode="student-case",
            )
        finally:
            session_runner.run_voice_scenario = orig
            asyncio.set_event_loop_policy(None)

        self.assertEqual(seen, {"d": "student-case", "s": "student-case"})


class TestAgentAudioFormatClock(unittest.TestCase):
    """The agent's declared output format IS the driver's bytes -> seconds clock.

    Reading a rate off a format that isn't raw PCM produced a confidently wrong clock, and
    the wrong clock is indistinguishable from a broken agent in the report.
    """

    def _sess(self):
        from pipeline.jobfit.eval.voice.el_ws import ElVoiceSession

        return ElVoiceSession("wss://unused")

    def test_pcm_rate_is_read(self):
        s = self._sess()
        s._apply_agent_format("pcm_24000")
        self.assertEqual(s._agent_rate, 24_000)
        self.assertIsNone(s.result.errored)

    def test_undeclared_format_keeps_the_protocol_default(self):
        s = self._sess()
        s._apply_agent_format("")
        self.assertEqual(s._agent_rate, 16_000)
        self.assertIsNone(s.result.errored)

    def test_mp3_bitrate_is_not_a_sample_rate(self):
        # "mp3_22050_32" used to parse 32 as the sample rate: every chunk read ~500x too
        # long, so wait_for_agent_turn burned the whole timeout against a healthy agent.
        s = self._sess()
        s._apply_agent_format("mp3_22050_32")
        self.assertEqual(s._agent_rate, 16_000)
        self.assertIn("not raw PCM", s.result.errored or "")

    def test_ulaw_is_refused_rather_than_halved(self):
        # 1 byte/sample read as 2 halves every duration -> the harness talks over the agent.
        s = self._sess()
        s._apply_agent_format("ulaw_8000")
        self.assertIn("not raw PCM", s.result.errored or "")

    def test_a_failed_driver_does_not_wait_out_the_timeout(self):
        import asyncio
        import time

        s = self._sess()
        s.result.errored = "boom"

        async def go():
            t0 = time.monotonic()
            got = await s.wait_for_agent_turn(timeout=5.0)
            return got, time.monotonic() - t0

        got, elapsed = asyncio.run(go())
        self.assertFalse(got)
        self.assertLess(elapsed, 1.0)  # not the 5 s deadline


class TestSpeechEndReference(unittest.TestCase):
    """first-audio latency is measured from the last SPOKEN sample, not from the mic pad."""

    def test_speech_end_excludes_the_trailing_silence(self):
        import asyncio
        import time

        from pipeline.jobfit.eval.voice import el_ws, tts

        class FakeWs:
            def __init__(self):
                self.sent = 0

            async def send(self, _payload):
                self.sent += 1

        async def scenario():
            call = el_ws.ElVoiceSession("wss://unused")
            call._ws = FakeWs()
            mic = asyncio.create_task(call._mic_loop())
            try:
                await call.speak("hello", "en")
                return time.monotonic() - call._speech_end
            finally:
                call._closing = True
                mic.cancel()
                try:
                    await mic
                except asyncio.CancelledError:
                    pass

        orig_synth, orig_pad = tts.synthesize, el_ws.TRAILING_SILENCE_MS
        tts.synthesize = lambda text, lang="en", **kw: tts.silence(200)
        el_ws.TRAILING_SILENCE_MS = 300
        try:
            gap = asyncio.run(scenario())
        finally:
            tts.synthesize, el_ws.TRAILING_SILENCE_MS = orig_synth, orig_pad

        # speak() returns once the pad has finished streaming, so "now" is one pad past the
        # last spoken sample. Stamping the drain instant instead reported every latency short
        # by exactly the pad — 0.9 s off an 8 s budget in the real config.
        self.assertAlmostEqual(gap, 0.3, delta=0.15)


class TestSmokePreflight(unittest.TestCase):
    def test_preflight_checks_the_voice_the_scenario_will_speak(self):
        # Checking a fixed "en" let a Czech scenario mint a REAL (paid) session and only then
        # blow up inside speak() with no cs_CZ model on disk.
        import argparse
        import asyncio

        from pipeline.jobfit.eval import interview_eval as ie
        from pipeline.jobfit.eval.interview_eval import _scenario_from_dict
        from pipeline.jobfit.eval.voice import tts, v0_smoke

        asked: list[str] = []
        scn = _scenario_from_dict(
            {"name": "cz", "candidate_prompt": "p", "first_message": "ahoj", "language": "cs"}
        )

        def fake_available(lang="en"):
            asked.append(lang)
            return False, "voice model missing"

        orig_sel, orig_av = ie.select_scenarios, tts.available
        ie.select_scenarios = lambda **kw: [scn]
        tts.available = fake_available
        try:
            args = argparse.Namespace(
                base_url="http://unused.invalid", scenario="cz", lang=None, kind="sim",
                sim_mode="regular", entry=None, turns=1, timeout=5.0,
                wer_budget=0.35, latency_budget=8.0, no_color=True,
            )
            self.assertEqual(asyncio.run(v0_smoke._run(args)), 2)
        finally:
            ie.select_scenarios, tts.available = orig_sel, orig_av

        self.assertEqual(asked, ["cs"])


if __name__ == "__main__":
    unittest.main()

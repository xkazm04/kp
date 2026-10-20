"""CI guard for the engine seam and the choice instrument (no network, no models).

``recognizers`` and ``bakeoff`` exist so the plane can score a CANDIDATE engine, not just
regress the incumbent. Everything here is deterministic: the seam's contract, the WAV
wrapper, the registry, and — the reason the module exists — that the report detects when
the aggregate error rate and decisive-term recall disagree about which engine to buy.

Synthesis needs Piper voices, so the bake-off's audio path is exercised with a stubbed
synthesizer rather than skipped; the scoring and ranking logic is what CI must pin.
"""

import io
import unittest
import wave
from unittest import mock

from pipeline.jobfit.eval.voice import bakeoff as bo
from pipeline.jobfit.eval.voice import recognizers as rec

NL = "\n"


def _pcm(nsamples: int = 1600) -> bytes:
    return b"\x01\x00" * nsamples


def _fixed(name: str, replies: dict[bytes, str]):
    """An engine that returns a canned transcript keyed by the PCM it was handed."""
    return rec.CallableRecognizer(name=name, fn=lambda pcm, lang: replies.get(pcm, ""))


def _scripted(name: str, replies: list[str]):
    """An engine that returns ``replies`` in order, one per utterance."""
    it = iter(replies)
    return rec.CallableRecognizer(name=name, fn=lambda pcm, lang: next(it, ""))


class TestPcmToWav(unittest.TestCase):
    def test_wraps_pcm_in_a_readable_16k_mono_wav(self):
        data = _pcm(800)
        blob = rec.pcm_to_wav(data)
        with wave.open(io.BytesIO(blob), "rb") as w:
            self.assertEqual(w.getnchannels(), 1)
            self.assertEqual(w.getsampwidth(), 2)
            self.assertEqual(w.getframerate(), 16_000)
            self.assertEqual(w.readframes(w.getnframes()), data)

    def test_empty_pcm_still_produces_a_valid_wav(self):
        # An engine handed a zero-length utterance must get a parseable file, not a
        # truncated one — "heard nothing" and "could not read the file" are different
        # outcomes and the scorer treats them differently.
        with wave.open(io.BytesIO(rec.pcm_to_wav(b"")), "rb") as w:
            self.assertEqual(w.getnframes(), 0)


class TestRegistry(unittest.TestCase):
    def setUp(self):
        self._saved = dict(rec._REGISTRY)
        rec._REGISTRY.clear()

    def tearDown(self):
        rec._REGISTRY.clear()
        rec._REGISTRY.update(self._saved)

    def test_register_and_get_round_trip(self):
        e = rec.CallableRecognizer(name="stub", fn=lambda pcm, lang: "hi")
        rec.register(e)
        self.assertIs(rec.get("stub"), e)
        self.assertEqual(rec.names(), ["stub"])

    def test_duplicate_registration_is_refused_unless_replacing(self):
        rec.register(rec.CallableRecognizer(name="dup", fn=lambda p, lang: ""))
        with self.assertRaises(ValueError):
            rec.register(rec.CallableRecognizer(name="dup", fn=lambda p, lang: ""))
        rec.register(rec.CallableRecognizer(name="dup", fn=lambda p, lang: "x"), replace=True)
        self.assertEqual(rec.get("dup").transcribe(b""), "x")

    def test_unknown_engine_names_the_registered_ones(self):
        rec.register(rec.CallableRecognizer(name="a", fn=lambda p, lang: ""))
        with self.assertRaises(KeyError) as ctx:
            rec.get("nope")
        self.assertIn("a", str(ctx.exception))

    def test_env_registers_a_command_engine_per_variable(self):
        added = rec.load_from_env({"KP_ASR_CMD_WHISPER": "whisper -f {audio}", "PATH": "/usr/bin"})
        self.assertEqual(added, ["whisper"])
        self.assertIsInstance(rec.get("whisper"), rec.CommandRecognizer)

    def test_env_ignores_blank_values(self):
        self.assertEqual(rec.load_from_env({"KP_ASR_CMD_X": "   "}), [])


class TestCommandRecognizer(unittest.TestCase):
    def test_missing_binary_is_reported_as_unavailable_not_raised(self):
        e = rec.CommandRecognizer(name="ghost", template="definitely-not-a-real-binary-xyz -f {audio}")
        ok, reason = e.available()
        self.assertFalse(ok)
        self.assertIn("not on PATH", reason)

    def test_template_without_audio_placeholder_is_unavailable(self):
        ok, reason = rec.CommandRecognizer(name="bad", template="echo hello").available()
        self.assertFalse(ok)
        self.assertIn("{audio}", reason)

    def test_transcribe_on_an_unavailable_engine_raises_with_the_reason(self):
        e = rec.CommandRecognizer(name="ghost", template="definitely-not-a-real-binary-xyz -f {audio}")
        with self.assertRaises(rec.RecognizerError):
            e.transcribe(_pcm())

    def test_a_windows_audio_path_survives_the_split(self):
        # Regression: formatting the path in BEFORE splitting let shlex eat the
        # backslashes, so a real temp file arrived at the engine as
        # "C:UserskazdaAppDataLocalTemptmp.wav" and every engine reported a missing file
        # for a file the harness had just written. Caught by an end-to-end run, not by a
        # unit test, which is why one exists now.
        e = rec.CommandRecognizer(name="w", template="engine -l {lang} -f {audio}")
        argv = e._argv(r"C:\Users\kazda\AppData\Local\Temp\tmp1234.wav", "cs")
        self.assertEqual(argv[-1], r"C:\Users\kazda\AppData\Local\Temp\tmp1234.wav")
        self.assertEqual(argv[2], "cs")

    def test_a_windows_path_written_into_the_template_survives_too(self):
        # The same corruption, one level earlier: an operator's model path in the template.
        e = rec.CommandRecognizer(name="w", template=r"engine -m C:\models\ggml-base.bin -f {audio}")
        argv = e._argv("/tmp/a.wav", "en")
        self.assertIn(r"C:\models\ggml-base.bin", argv)


class TestBakeoffScoring(unittest.TestCase):
    """The module's reason to exist: the two metrics can rank engines differently."""

    # The live Czech V1 call, verbatim — the utterance that produced entity fidelity.
    GT = "Poslední rok dělám hlavně s Pythonem a Reactem, k tomu PostgreSQL a Docker."
    # Real ASR output from that call: two domain nouns substituted, frame intact.
    HEARD_A = "Poslední rok dělám hlavně s Pythonem a Rustem, k tomu později SQL a Docker."
    # The complementary error class: function words and inflection wrong, nouns intact.
    HEARD_B = "Poslední rok dělal hlavně Pythonem a Reactem k tomu PostgreSQL Docker"

    REFS = [
        bo.ReferenceUtterance(GT, "cs"),
        bo.ReferenceUtterance("I use React", "en"),
        bo.ReferenceUtterance("with Kafka", "en"),
    ]
    SAID_A = [HEARD_A, "I use React", "with Kafka"]
    SAID_B = [HEARD_B, "I used React", "with the Kafka"]

    def _run(self, refs, said_a, said_b, **kw):
        engines = [_scripted("subs-nouns", said_a), _scripted("garbles-glue", said_b)]
        with mock.patch.object(bo.tts, "synthesize", return_value=_pcm()):
            return bo.run_bakeoff(refs, engines, **kw)

    def _named(self, report, name):
        return next(x for x in report.results if x.name == name)

    def test_on_the_decisive_utterance_the_aggregate_cannot_separate_them(self):
        # The sharpest form of the finding, and the reason a per-utterance WER gate could
        # never have caught this: substituting two domain nouns and garbling two function
        # words cost the SAME number of tokens, so the aggregate is not merely wrong about
        # the ranking — on this utterance it is blind.
        r = self._run([self.REFS[0]], [self.HEARD_A], [self.HEARD_B])
        a, b = self._named(r, "subs-nouns"), self._named(r, "garbles-glue")
        self.assertAlmostEqual(a.wer, b.wer)
        self.assertLess(a.recall, b.recall)
        self.assertEqual(set(a.missing), {"postgresql", "react"})
        self.assertEqual(b.missing, ())

    def test_across_the_set_the_two_metrics_invert(self):
        r = self._run(self.REFS, self.SAID_A, self.SAID_B)
        a, b = self._named(r, "subs-nouns"), self._named(r, "garbles-glue")
        # The aggregate prefers the engine that fabricated two skills...
        self.assertLess(a.wer, b.wer)
        # ...and recall prefers the other one, outright.
        self.assertGreater(b.recall, a.recall)

    def test_recall_decides_the_ranking(self):
        r = self._run(self.REFS, self.SAID_A, self.SAID_B)
        self.assertEqual([x.name for x in r.by_recall()][0], "garbles-glue")
        self.assertEqual([x.name for x in r.by_wer()][0], "subs-nouns")

    def test_the_disagreement_is_reported_not_left_to_be_noticed(self):
        r = self._run(self.REFS, self.SAID_A, self.SAID_B)
        self.assertEqual(r.inversions(), [("garbles-glue", "subs-nouns")])
        text = NL.join(bo.format_report(r))
        self.assertIn("METRIC DISAGREEMENT", text)
        self.assertIn("Choose on recall", text)

    def test_agreement_is_reported_too(self):
        # A clean engine and a noun-dropping one: both metrics agree, and the report says
        # so rather than staying silent — an absent warning must not read as a passed one.
        r = self._run(self.REFS, self.SAID_A, [self.GT, "I use React", "with Kafka"])
        self.assertEqual(r.inversions(), [])
        self.assertIn("the two metrics agree", NL.join(bo.format_report(r)))

    def test_wer_threshold_disqualifies_rather_than_ranks(self):
        # garbles-glue has PERFECT recall and is still removed from the ranking for
        # breaching the aggregate threshold: the demoted metric gates, it does not rank.
        r = self._run(self.REFS, self.SAID_A, self.SAID_B, wer_threshold=0.20)
        self.assertEqual([x.name for x in r.by_recall()], ["subs-nouns"])
        self.assertEqual(self._named(r, "garbles-glue").recall, 1.0)
        self.assertIn("DISQUALIFIED", NL.join(bo.format_report(r)))

    def test_condition_and_n_travel_with_the_numbers(self):
        r = self._run(self.REFS, self.SAID_A, self.SAID_B)
        self.assertEqual(r.utterances, 3)
        self.assertEqual(r.condition, "clean")
        head = NL.join(bo.format_report(r))
        self.assertIn("n=3", head)
        self.assertIn("clean", head)

    def test_degraded_condition_is_named_in_the_report(self):
        r = self._run(self.REFS, self.SAID_A, self.SAID_B, noise_snr_db=10.0, gain=0.5)
        self.assertIn("noise@10dB", r.condition)
        self.assertIn("gain@0.5", r.condition)


class TestBakeoffReachability(unittest.TestCase):
    def test_an_unreachable_engine_is_reported_never_silently_dropped(self):
        pcm = _pcm()
        ghost = rec.CommandRecognizer(name="ghost", template="definitely-not-a-real-binary-xyz -f {audio}")
        engines = [_fixed("ok", {pcm: "I use React"}), ghost]
        with mock.patch.object(bo.tts, "synthesize", return_value=pcm):
            r = bo.run_bakeoff([bo.ReferenceUtterance("I use React", "en")], engines)
        self.assertEqual([x.name for x in r.scored], ["ok"])
        text = NL.join(bo.format_report(r))
        self.assertIn("UNREACHABLE", text)
        self.assertIn("ghost", text)

    def test_an_engine_that_fails_mid_run_drops_its_partial_scores(self):
        # A half-scored engine must not be ranked on the utterances it happened to
        # survive — that is a maximum taken over a subset it selected itself.
        pcm = _pcm()

        def _boom(_pcm_in, _lang):
            raise rec.RecognizerError("engine died")

        engines = [_fixed("ok", {pcm: "I use React"}), rec.CallableRecognizer(name="flaky", fn=_boom)]
        with mock.patch.object(bo.tts, "synthesize", return_value=pcm):
            r = bo.run_bakeoff([bo.ReferenceUtterance("I use React", "en")], engines)
        flaky = next(x for x in r.results if x.name == "flaky")
        self.assertFalse(flaky.ok)
        self.assertEqual(flaky.pairs, [])

    def test_every_engine_hears_the_same_bytes(self):
        # The paired-arm rule: re-synthesizing per engine would make the arms differ by
        # more than the engine under test.
        seen: list[int] = []
        pcm = _pcm()
        engines = [
            rec.CallableRecognizer(name=f"e{i}", fn=lambda p, lang: seen.append(id(p)) or "x")
            for i in range(3)
        ]
        with mock.patch.object(bo.tts, "synthesize", return_value=pcm) as synth:
            bo.run_bakeoff([bo.ReferenceUtterance("hello", "en")], engines)
        self.assertEqual(synth.call_count, 1)
        self.assertEqual(len(set(seen)), 1)


class TestDefaultSelectionSet(unittest.TestCase):
    def test_the_set_carries_decisive_terms(self):
        from pipeline.jobfit.eval.voice.wer import domain_terms

        for ref in bo.DEFAULT_SET:
            self.assertTrue(domain_terms(ref.text), f"no decisive terms in: {ref.text}")

    def test_the_set_keeps_the_in_sentence_language_switch_case(self):
        # The recorded corruption is a Czech sentence carrying English technology nouns.
        # It is the case this product has already been broken by, and the case a
        # one-language-at-a-time synthesizer is least able to generate more of, so it
        # must not be dropped from the set by a later tidy-up.
        cs = [r for r in bo.DEFAULT_SET if r.lang == "cs"]
        self.assertTrue(cs)
        self.assertIn("react", " ".join(r.text.lower() for r in cs))


if __name__ == "__main__":
    unittest.main()

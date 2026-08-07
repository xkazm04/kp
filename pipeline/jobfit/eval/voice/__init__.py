"""Voice plane for the interview eval — a synthetic candidate that actually SPEAKS.

The text plane (``interview_eval``) tests the interviewer's brain. This package adds the
audio-in-the-loop plane: local Piper TTS generates the candidate's speech, a headless driver
streams it into the real ElevenLabs realtime session (via the app's own /api/interview/connect,
so session lifecycle + /complete + scoring all run for real), and the protocol's transcript
events come back for scoring.

Because the harness GENERATES the speech from known text, it knows the ground truth — which makes
ASR fidelity (word error rate) a deterministic, gateable number that no text test and no human
vibecheck can produce.

Design: docs/VOICE_INTERVIEW_TEST_FRAMEWORK.md §9.
"""

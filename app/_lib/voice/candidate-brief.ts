// Candidate-safe GROUNDED brief for ElevenLabs candidate sessions.
//
// WHY THIS EXISTS: OpenAI candidate sessions receive the full grounded brief
// SERVER-SIDE (adapter.connect puts it in the client_secrets session config),
// but ElevenLabs' signed-url flow has no server-side prompt config — its prompt
// override is CLIENT-SENT (VoiceInterview.tsx → overrides.agent.prompt), which
// means anything we deliver transits the candidate's BROWSER and is a devtools
// tab away. EL candidate sessions therefore used to run on a generic role-title
// prompt — half the provider matrix ran ungrounded interviews.
//
// THE SECURITY BOUNDARY IS THE SANITIZER IN THIS FILE. It is an explicit
// ALLOW-LIST transform: a candidate-safe block is CONSTRUCTED from scratch out
// of the few fields that are candidate-facing — the topic LABEL, the questions
// the agent asks aloud anyway, and the time-boxes. Everything else — `goal`
// (routinely embeds "Listen for:" / whatsGoodLooksLike assessment guidance),
// `listenFor`, `redFlag`, coachability stage directions, any field added to the
// source shapes in the future — does not survive, because nothing survives that
// is not explicitly picked. Never turn this into a deny-list ("copy the object,
// delete the private fields"): a new private field upstream would silently leak.
//
// PICKING THE FIELD IS NOT ENOUGH FOR THE TOPIC. An earlier revision of this
// comment justified topics with "the portal already renders session.runOfShow to
// the candidate". The portal does render it (app/interview/[token]/page.tsx →
// InterviewSidebar), but that is a PRECEDENT, not a safety proof — and it is the
// same leak: `session.runOfShow` IS `chronology[].topic`
// (interview-run.ts::buildGroundedInterview), the topic is the LLM's free-text
// `competency` from an interviewer prompt that says "Cover the missing
// must-haves", and both /api/interview/connect and /api/interview/complete
// fixture those topics as "Test automation fundamentals (missing must-have)" /
// "Motivation (aspiration mismatch)" — the annotation shapes TP-L2-VOICE-01
// found in the wild — precisely because they carry them. /complete's projection
// strips `runOfShow` for that reason. So the topic's CONTENT is scrubbed here
// (candidateSafeTopic) rather than trusted; the portal's own rendering of the
// raw run-of-show is a separate leak, outside this module.
//
// Pure and dependency-free below the persona constants so the boundary is
// unit-testable without a DB (candidate-brief.test.ts pins that internal
// fixtures cannot survive).

import {
  PERSONA_CRAFT_RULES,
  PERSONA_GENDER_GRAMMAR,
  PERSONA_LANGUAGE_DETECT,
  PERSONA_ONE_QUESTION,
} from "../student-interview";

/** The ONLY shape that reaches the candidate-safe prompt. Constructed, never copied. */
export type CandidateSafeBlock = {
  topic: string;
  /** Time-box in minutes when the source block carries one. */
  fromMin?: number;
  toMin?: number;
  /** The questions the agent asks aloud — candidate-facing by definition. */
  questions: string[];
};

const asCleanString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const asQuestionList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(asCleanString).filter((q): q is string => q !== null) : [];

/** A candidate-facing agenda entry is a LABEL, not prose: the interviewer-facing
 *  fields are where guidance belongs, so anything past this is truncated rather
 *  than narrated to the candidate. */
const MAX_TOPIC_CHARS = 80;

/** Scrub a topic LABEL down to what a candidate may hear (see the header note).
 *  Assessment annotations ride INSIDE the label as a bracketed aside —
 *  "Test automation fundamentals (missing must-have)", "Motivation (aspiration
 *  mismatch)" — so asides are removed (an unterminated bracket cuts to the end)
 *  and the remainder is length-capped. A label that is nothing BUT an aside
 *  scrubs to empty and returns null, which drops the whole block. Deliberately a
 *  shape rule, not a vocabulary: a new annotation phrase still lands in the same
 *  bracket, and a deny-list of phrases would silently miss the next one. */
export function candidateSafeTopic(raw: unknown): string | null {
  const s = asCleanString(raw);
  if (!s) return null;
  const stripped = s
    .replace(/[([][^)\]]*[)\]]/g, " ") // a complete "(…)" / "[…]" aside
    .replace(/[([][\s\S]*$/, " ") // an unterminated aside takes the rest of the label
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, "")
    .trim();
  if (!stripped) return null;
  return stripped.length > MAX_TOPIC_CHARS ? stripped.slice(0, MAX_TOPIC_CHARS).trimEnd() : stripped;
}

/** Allow-list pick from an interview-prep chronology block ({ topic, goal,
 *  questions, followUp, fromMin, toMin }). `goal` is deliberately NOT picked —
 *  prep goals embed whatsGoodLooksLike / "Listen for:" assessment guidance.
 *  `followUp` IS picked (into questions): it is interrogative material the
 *  agent asks aloud, same class as questions. The topic is picked through
 *  candidateSafeTopic — the label itself carries gap annotations. */
export function sanitizeChronologyBlock(block: unknown): CandidateSafeBlock | null {
  if (!block || typeof block !== "object") return null;
  const b = block as Record<string, unknown>;
  const topic = candidateSafeTopic(b.topic);
  if (!topic) return null;
  const questions = asQuestionList(b.questions);
  const followUp = asCleanString(b.followUp);
  if (followUp) questions.push(followUp);
  const out: CandidateSafeBlock = { topic, questions };
  if (typeof b.fromMin === "number" && Number.isFinite(b.fromMin)) out.fromMin = b.fromMin;
  if (typeof b.toMin === "number" && Number.isFinite(b.toMin)) out.toMin = b.toMin;
  return out;
}

/** Allow-list pick from a student-script / case-scenario phase. `listenFor`,
 *  `goal`, `feeds` and `caseRef` never survive; the phase name rides the same
 *  candidateSafeTopic scrub as a chronology topic (a designed case's phase names
 *  are generated too). The probe survives ONLY when it
 *  is a plain aloud question: coachability phases (feeds includes
 *  "Coachability") carry scripted stage directions — the deliberate hint the
 *  agent injects and observes — which must never reach the browser, so those
 *  phases keep only their topic. */
export function sanitizeScenarioPhase(phase: unknown): CandidateSafeBlock | null {
  if (!phase || typeof phase !== "object") return null;
  const p = phase as Record<string, unknown>;
  const topic = candidateSafeTopic(p.phase);
  if (!topic) return null;
  const feeds = Array.isArray(p.feeds) ? p.feeds : [];
  const isCoachability = feeds.some((f) => typeof f === "string" && f.toLowerCase() === "coachability");
  const probe = isCoachability ? null : asCleanString(p.probe);
  return { topic, questions: probe ? [probe] : [] };
}

/** Allow-list pick from a submission-debrief followup ({ question, listenFor,
 *  redFlag, decision, id }): ONLY the question — the thing asked aloud —
 *  survives. */
export function sanitizeFollowupQuestion(followup: unknown): string | null {
  if (!followup || typeof followup !== "object") return null;
  return asCleanString((followup as Record<string, unknown>).question);
}

/** Compose the candidate-safe grounded brief from sanitized blocks. Same shared
 *  persona contract as every other builder; the run-of-show lines carry ONLY
 *  what the sanitizers emitted. `intro` is optional aloud narration (e.g. a
 *  case scenario's caseIntro — the agent reads it to the candidate anyway). */
export function composeCandidateBrief(opts: {
  company: string;
  roleLine: string;
  candidateLabel?: string | null;
  durationMin: number;
  blocks: CandidateSafeBlock[];
  intro?: string | null;
}): string {
  const name = opts.candidateLabel ? ` You are speaking with ${opts.candidateLabel}.` : "";
  const runOfShow = opts.blocks
    .map((b, i) => {
      const box = typeof b.fromMin === "number" && typeof b.toMin === "number" ? ` (${b.fromMin}–${b.toMin} min)` : "";
      const qs = b.questions.map((q) => `“${q}”`).join(" ");
      return `${i + 1}. ${b.topic}${box}${qs ? ` — Ask: ${qs}.` : ""}`;
    })
    .join("  ");
  return [
    `You are a warm, professional first-round screening interviewer at ${opts.company} for the ${opts.roleLine} role.${name}`,
    PERSONA_ONE_QUESTION,
    ...PERSONA_CRAFT_RULES,
    // Gender-grammar + language lock stay ADJACENT and LAST (see student-interview.ts).
    PERSONA_GENDER_GRAMMAR,
    PERSONA_LANGUAGE_DETECT,
    `Begin by briefly introducing yourself as an AI assistant and the ${opts.roleLine} position in two or three sentences, and mention that the call is transcribed for a human recruiter.`,
    ...(opts.intro ? [`After your introduction, narrate this context to the candidate conversationally in at most two minutes: ${opts.intro}`] : []),
    `Then lead the conversation through this run of show (about ${opts.durationMin} minutes total), keeping each topic roughly time-boxed. Ask the listed questions naturally, one at a time, with short follow-ups, and adapt to the candidate's answers:`,
    runOfShow,
    "Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the candidate their thinking, instinct, or approach is right (avoid “great”, “impressive”, “exactly right”, “the right instinct”, “on the right track”) — stay warm by showing interest and inviting them to continue (“thank you”, “understood”, “tell me more”), not by approving. When the agenda is covered, invite the candidate's questions, thank them, and say a human recruiter will review the conversation.",
  ].join(" ");
}

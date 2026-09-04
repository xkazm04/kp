import { loadAnalysis, parseStoredGithubAnalysis, setAnalysisDisposition, setAnalysisGithub } from "@/app/_lib/db/analyses";
import { candidateLabelWithholdsPii, recordAnalysisDispositionEvents } from "@/app/_lib/db/pipeline";
import { maskCandidateName, scrubPiiFromPayload } from "@/app/_lib/consent";
import { githubAnalysisSchema } from "@/app/_lib/schemas";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";


// Defensive ceiling for an attached GitHub payload. A real GithubAnalysis is
// tens of KB; anything near this is malformed or hostile, not a deep-dive.
const MAX_GITHUB_JSON_BYTES = 256 * 1024;

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  // Defense in depth (see the sibling list route): this door serves ONE candidate's whole
  // CV payload, so it re-asserts the seat rather than trusting middleware's session check.
  const denied = await requireCapabilityCoded("read", requireCapability);
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const found = loadAnalysis(slug, ws);
    if (!found) return jsonRefusal("ANALYSIS_NOT_FOUND", 404);
    // Read-time consent gate (bug-ui-scan-2026-07-09 privacy-consent-provenance #3): if the
    // linked candidate's consent has EXPIRED (or they've been anonymized), scrub the full CV
    // payload + GitHub dossier and mask the label SYNCHRONOUSLY here — don't keep serving the
    // whole CV in the drawer/History until the deferred anonymize sweep runs. Uses the same
    // de-identified projection anonymizeEntry would persist, so the read stays lawful even if
    // the sweep is stalled.
    const withhold = candidateLabelWithholdsPii(found.row.candidate_label, ws);
    return jsonOk({
      slug: found.row.slug,
      candidateLabel: withhold ? maskCandidateName(found.row.candidate_label) : found.row.candidate_label,
      jdSlug: found.row.jd_slug,
      score: found.row.score,
      roleFamily: found.row.role_family,
      seniority: found.row.seniority,
      createdAt: found.row.created_at,
      // WHICH PRODUCER made this row: 'llm' | 'deterministic', and the provider that
      // served it. NULL on a row saved before the columns existed — the consumer reads
      // that as UNKNOWN and must not render it as either. Not PII, so it survives the
      // consent gate below: it describes the ENGINE, not the candidate.
      engine: found.row.engine ?? null,
      engineProvider: found.row.engine_provider ?? null,
      disposition: found.row.disposition ?? null,
      decisionNote: found.row.decision_note ?? null,
      analysis: withhold ? scrubPiiFromPayload(found.payload) : found.payload,
      // GH1 — the attached GitHub deep-dive, when one was persisted. Parsed
      // defensively: a corrupt column yields null, never a 500. Withheld under the
      // consent gate (it embeds the candidate's real GitHub identity + repos).
      githubAnalysis: withhold ? null : parseStoredGithubAnalysis(found.row.github_json, slug),
    });
  } catch (error) {
    // The thrown message carries the db path and the payload parser's detail; the client
    // gets the code and resolves it in its own language.
    return safeJsonError(error, `api:analyses/${slug}`, "ANALYSIS_LOAD_FAILED");
  }
}

// PATCH → record the recruiter's disposition + note on this analysis (RES5),
// OR attach the GitHub deep-dive result (GH1). The two writes are independent:
// a body carrying `githubAnalysis` is the deep-dive attach (validated against
// githubAnalysisSchema so only a real payload is ever persisted); otherwise
// disposition semantics are unchanged ("advance"|"hold"|"pass", else clears).
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  // The WRITE door: it records a recruiter's advance/hold/pass on a candidate and echoes
  // it onto their pipeline entries as a decision event. `pipeline:write` is the
  // capability that names exactly that authority (roles.ts: "recruiter operations: move
  // candidates, decisions, comms"), so a `viewer` seat may read the analysis and may not
  // decide on it. This closes its row in route-capability-coverage.test.ts.
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as {
      disposition?: unknown;
      note?: unknown;
      githubAnalysis?: unknown;
    };

    if (body.githubAnalysis !== undefined) {
      const parsed = githubAnalysisSchema.safeParse(body.githubAnalysis);
      if (!parsed.success) return jsonRefusal("ANALYSIS_GITHUB_INVALID", 400);
      const json = JSON.stringify(parsed.data);
      // `maxBytes` rides alongside as DATA so the client can say the number in its own
      // sentence instead of the server shipping English prose with a figure baked in.
      if (json.length > MAX_GITHUB_JSON_BYTES) {
        return jsonRefusal("ANALYSIS_GITHUB_TOO_LARGE", 413, { maxBytes: MAX_GITHUB_JSON_BYTES });
      }
      const ok = setAnalysisGithub(slug, json, ws);
      if (!ok) return jsonRefusal("ANALYSIS_NOT_FOUND", 404);
      return jsonOk({ ok: true });
    }

    const disposition = typeof body.disposition === "string" ? body.disposition : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
    const ok = setAnalysisDisposition(slug, disposition, note, ws);
    if (!ok) return jsonRefusal("ANALYSIS_NOT_FOUND", 404);
    // d95fed6d — echo the decision onto the candidate's pipeline record(s) so
    // it shows in the drawer history instead of living only on the history
    // page. Best-effort and clear-skipping: clearing a disposition isn't a
    // decision worth narrating, and a failed echo must not fail the save.
    if (disposition) {
      try {
        const saved = loadAnalysis(slug, ws);
        if (saved) recordAnalysisDispositionEvents(saved.row.candidate_label, disposition, ws, note);
      } catch (error) {
        console.error(`[api:analyses] disposition echo failed for "${slug}"`, error);
      }
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return safeJsonError(error, `api:analyses/${slug}`, "ANALYSIS_SAVE_FAILED");
  }
}

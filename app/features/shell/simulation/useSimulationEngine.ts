// The "observation + real-click engine" half of SimulationProvider, split out so
// the provider stays under the 200-line file cap. Verbatim logic — board
// observation (getEntries/entriesFor/topScreened), DOM polling (waitDom/waitEntry),
// the real-click dispatcher (clickEl), pipeline advances (advance/advanceTo), and
// the group-evaluation runner (runGroupEval). Takes the provider's shared
// ctrl ref + patch/beat/log so this stays wired to the SAME run-control state.
import { useCallback, type MutableRefObject } from "react";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import type { GroupEvalPayload } from "@/app/features/hiring/decisions/GroupEvalModal";
import type { PipelineEntryView } from "@/app/_lib/db";
import { compareByMatchScoreDesc } from "@/app/_lib/match-score";
import { JSON_HEADERS, MAX_STAGE_ADVANCES, SimStop, sleep, type SimState } from "./simulationProviderTypes";

export function useSimulationEngine({
  ctrl,
  patch,
  log,
  beat,
}: {
  ctrl: MutableRefObject<{ stop: boolean; paused: boolean; wake: (() => void) | null }>;
  patch: (p: Partial<SimState>) => void;
  log: (text: string) => void;
  beat: (ms: number) => Promise<void>;
}) {
  const getEntries = useCallback(async (): Promise<PipelineEntryView[]> => {
    // Throw on a non-OK response instead of letting `?? []` coerce a transient 500 into an
    // empty board — which read as "intake returned none" and silently halted the sim beat.
    // A throw surfaces the failure to the sim run's error handling.
    const r = await fetch("/api/pipeline");
    if (!r.ok) throw new Error(`pipeline fetch failed (${r.status})`);
    const p = await r.json();
    return (p.entries as PipelineEntryView[]) ?? [];
  }, []);

  // The sim walk repeatedly re-fetches the whole board and selects the cohort for
  // the role under demo. Co-locate that selection so the jobId scope and the stage
  // strings live in one place: `entriesFor` is the job-scoped (optionally
  // stage-scoped) cohort; `topScreened` is the highest-matchScore Screened entry
  // (the candidate the walk follows).
  const entriesFor = useCallback(
    async (jobId: string, stage?: string): Promise<PipelineEntryView[]> =>
      (await getEntries()).filter((e) => e.jobId === jobId && (stage === undefined || e.stage === stage)),
    [getEntries]
  );

  const topScreened = useCallback(
    // Best-first via the shared null-safe comparator: an unscored entry sorts
    // last (never fabricated into a "score 0" pick), so the sim follows a
    // candidate who was actually measured.
    async (jobId: string): Promise<PipelineEntryView | undefined> =>
      (await entriesFor(jobId, "Screened")).sort(compareByMatchScoreDesc)[0],
    [entriesFor]
  );

  // Poll a DOM predicate until satisfied (element appears / iframe ready).
  const waitDom = useCallback(async <T,>(probe: () => T | null, timeout = 9000): Promise<T | null> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (ctrl.current.stop) throw new SimStop();
      const v = probe();
      if (v) return v;
      await sleep(120);
    }
    return null;
  }, [ctrl]);

  // Poll the server until a pipeline entry matches (so we don't race the UI's fetch).
  // FAILURE POLICY (shared with advanceTo): a timeout means an expected server
  // transition never happened, so the next step's precondition is broken — THROW a
  // clear, labelled message that halts the demo (surfaced as "Failed: …" by run's
  // catch), rather than returning a silent false and walking on stale state. `label`
  // names what we were waiting for so the halt message is legible per call site.
  const waitEntry = useCallback(
    async (id: string, pred: (e: PipelineEntryView) => boolean, label: string, timeout = 9000): Promise<void> => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (ctrl.current.stop) throw new SimStop();
        const e = (await getEntries()).find((x) => x.id === id);
        if (e && pred(e)) return;
        await sleep(250);
      }
      throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for ${label}.`);
    },
    [ctrl, getEntries]
  );

  // Dispatch a REAL click on a rendered element (main doc or an iframe doc).
  const clickEl = useCallback(
    async (selector: string, o: { title: string; caption: string; doc?: Document }): Promise<boolean> => {
      const doc = o.doc ?? document;
      const el = (await waitDom(() => doc.querySelector(selector) as HTMLElement | null)) as HTMLElement | null;
      if (!el) return false;
      if (!o.doc) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        patch({ spotlight: { selector, title: o.title, caption: o.caption } });
      }
      await beat(1100); // let the viewer see what's about to be clicked
      el.click(); // native click bubbles to the React root → the real handler fires
      await beat(700);
      return true;
    },
    [beat, patch, waitDom]
  );

  const advance = useCallback(async (entryId: string): Promise<string> => {
    // actor:"sim" — truthful audit attribution (gsim-l2-103): these accepts are
    // engine-driven, so the pipeline event records auto_advanced and the sealed
    // decision record names "auto:sim", never "human:recruiter". The route only
    // honors the downgrade (human → automated), so this claims no authority.
    const r = await fetch(`/api/pipeline/${entryId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept", actor: "sim" }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error ?? "advance failed");
    notifyDataChanged(); // open board/queue re-fetches live
    return p.entry?.stage as string;
  }, []);

  // Advance an entry until it reaches `stage`, bounded by the real pipeline depth.
  // FAILURE POLICY (shared with waitEntry): if the target isn't reached within the
  // bound — the entry stalled or overshot — THROW so the demo halts with a clear
  // message instead of silently returning the wrong stage and breaking a later step
  // cryptically. Callers that are deliberately best-effort (the cohort match) opt
  // out by catching this explicitly.
  const advanceTo = useCallback(
    async (entryId: string, stage: string): Promise<string> => {
      let st = "";
      for (let i = 0; i < MAX_STAGE_ADVANCES; i++) {
        st = await advance(entryId);
        if (st === stage) return st;
      }
      throw new Error(`Could not advance entry ${entryId} to "${stage}" within ${MAX_STAGE_ADVANCES} steps (stalled at "${st || "unknown"}").`);
    },
    [advance]
  );

  // Run + show a group evaluation for a role (keyless: deterministic ranking when
  // no LLM). Starts the existing group_eval task, polls the saved evaluation, and
  // surfaces the comparison modal.
  const runGroupEval = useCallback(
    async (jobId: string, roleTitle: string) => {
      const candidates = (await entriesFor(jobId))
        .map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
      patch({ groupEval: { roleTitle, payload: null, loading: true, error: null } });
      try {
        await fetch("/api/tasks", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ kind: "group_eval", params: { roleKey: jobId, roleTitle, jobId, candidates } }),
        });
        const TIMEOUT_MS = 25_000;
        const deadline = Date.now() + TIMEOUT_MS;
        let payload: GroupEvalPayload | null = null;
        while (Date.now() < deadline) {
          if (ctrl.current.stop) throw new SimStop();
          const ev = await fetch(`/api/decisions/group-eval?role=${encodeURIComponent(jobId)}`).then((r) => r.json()).catch(() => null);
          if (ev?.evaluation?.payload) {
            payload = ev.evaluation.payload as GroupEvalPayload;
            break;
          }
          await sleep(400);
        }
        if (payload) {
          patch({ groupEval: { roleTitle, payload, loading: false, error: null } });
        } else {
          // Timed out waiting for the evaluation to be written. Surface it explicitly
          // (the modal renders this message) rather than dropping to a blank/"run one"
          // comparison during the climactic Offer step.
          const error = `The group evaluation didn't finish within ${Math.round(
            TIMEOUT_MS / 1000
          )}s. The candidates are still in the pipeline — the comparison just couldn't be generated in time.`;
          patch({ groupEval: { roleTitle, payload: null, loading: false, error } });
          log("⚠︎ Group evaluation timed out — showing an unavailable notice.");
        }
      } catch (e) {
        if (e instanceof SimStop) throw e;
        // Same honest-failure treatment as the timeout: show why, don't blank out.
        patch({
          groupEval: { roleTitle, payload: null, loading: false, error: "The group evaluation couldn't be generated." },
          screenWave: null,
        });
      }
    },
    [ctrl, entriesFor, log, patch]
  );

  return { getEntries, entriesFor, topScreened, waitDom, waitEntry, clickEl, advance, advanceTo, runGroupEval };
}

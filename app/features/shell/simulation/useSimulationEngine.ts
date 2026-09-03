// The "observation + real-click engine" half of SimulationProvider, split out so
// the provider stays under the 200-line file cap. Verbatim logic — board
// observation (getBoard/getEntries/entriesFor/topScreened), DOM polling (waitDom/waitEntry),
// the real-click dispatcher (clickEl), pipeline advances (advance/advanceTo), and
// the group-evaluation runner (runGroupEval). Takes the provider's shared
// ctrl ref + patch/beat/log so this stays wired to the SAME run-control state.
import { useCallback, type MutableRefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { resolveErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GroupEvalPayload } from "@/app/features/hiring/decisions/GroupEvalModal";
import type { PipelineEntryView } from "@/app/_lib/db/pipeline";
import { DEFAULT_STAGE_AXIS, stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";
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
  // A failed advance ends up in the guided demo's visible "Failed: …" status, and
  // this demo is public (/?sim=auto, no login) — so it must never be the route's
  // English `error`. Resolve the machine `code`, fall back to the dock's own copy.
  // The pure resolveErrorMessage rather than useErrorMessage(): the hook returns a
  // fresh closure per render, which would destabilize the memoized callbacks the
  // walk depends on. Both translators are stable.
  const t = useTranslations("pipeline.controlCenter");
  const tErrors = useTranslations("errors");
  // The engine's OWN failure copy (fetch/timeout/stall, the group-evaluation
  // unavailable notice). Each of these lands in the public demo's visible
  // "Failed: …" status or in the comparison modal, so none of it may stay English.
  const tSim = useTranslations("simulation");
  const locale = useLocale();
  const errMsg = useCallback(
    (payload: ApiErrorPayload, fallback: string) => {
      type ErrorKey = Parameters<typeof tErrors>[0];
      return resolveErrorMessage(payload, fallback, (c) => tErrors.has(c as ErrorKey), (c) => tErrors(c as ErrorKey));
    },
    [tErrors]
  );

  // The board this run is driving: the workspace's own entries AND its own column
  // axis, which /api/pipeline already ships beside them. The axis is per-workspace
  // DATA (Settings → Hiring composes it; stage ids are free-form and a team may add,
  // reorder or drop columns), so every stage question the walk asks — where an
  // accept landed, which column carries the offer role, how deep the board is — has
  // to be answered from HERE rather than from the shipped 5-stage literal. Reading
  // the axis off the same response the entries come from costs nothing extra and
  // keeps the two consistent by construction.
  const getBoard = useCallback(async (): Promise<{ entries: PipelineEntryView[]; axis: StageDef[] }> => {
    // Throw on a non-OK response instead of letting `?? []` coerce a transient 500 into an
    // empty board — which read as "intake returned none" and silently halted the sim beat.
    // A throw surfaces the failure to the sim run's error handling.
    const r = await fetch("/api/pipeline");
    if (!r.ok) throw new Error(tSim("error.pipelineFetch", { status: r.status }));
    const p = await r.json();
    const axis = (p.stages as StageDef[] | undefined) ?? [];
    return {
      entries: (p.entries as PipelineEntryView[]) ?? [],
      axis: axis.length > 0 ? axis : DEFAULT_STAGE_AXIS.map((s) => ({ ...s })),
    };
  }, [tSim]);

  const getEntries = useCallback(async (): Promise<PipelineEntryView[]> => (await getBoard()).entries, [getBoard]);

  // Read a JSON body that MUST have succeeded. Same FAILURE POLICY as
  // waitEntry/advanceTo/getBoard: on a non-OK response the body is an ERROR object,
  // so a caller's `?? []` / `?? 0` silently coerces it into a zero-shape and the
  // demo NARRATES an outcome the server never produced. Resolve the machine code
  // into the reader's language, fall back to the control center's own copy, and
  // THROW so run()'s catch shows "Failed: …".
  const okJson = useCallback(
    async <T,>(r: Response): Promise<T> => {
      const p = (await r.json().catch(() => ({}))) as T & ApiErrorPayload;
      if (!r.ok) throw new Error(errMsg(p, t("errorRun")));
      return p;
    },
    [errMsg, t]
  );

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
    //
    // The screened column is a PARAMETER, not the literal "Screened": the walk
    // resolves it from the live axis by role (screenedLandingStage), so a workspace
    // whose screening column is called something else still yields a candidate to
    // follow instead of an empty cohort and a bogus "intake returned none" halt.
    async (jobId: string, screenedStage: string): Promise<PipelineEntryView | undefined> =>
      (await entriesFor(jobId, screenedStage)).sort(compareByMatchScoreDesc)[0],
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
      throw new Error(tSim("error.waitTimeout", { seconds: Math.round(timeout / 1000), label }));
    },
    [ctrl, getEntries, tSim]
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
    if (!r.ok) throw new Error(errMsg(p, t("errorRun")));
    notifyDataChanged(); // open board/queue re-fetches live
    return p.entry?.stage as string;
  }, [t, errMsg]);

  // Advance an entry until it reaches `stage`, bounded by the real pipeline depth.
  // FAILURE POLICY (shared with waitEntry): if the target isn't reached within the
  // bound — the entry stalled or overshot — THROW so the demo halts with a clear
  // message instead of silently returning the wrong stage and breaking a later step
  // cryptically. Callers that are deliberately best-effort (the cohort match) opt
  // out by catching this explicitly.
  const advanceTo = useCallback(
    async (entryId: string, stage: string): Promise<string> => {
      // Bound + target checked against the LIVE board, not the shipped 5-stage list.
      // Two distinct failures the compile-time bound hid:
      //   • a workspace may compose up to PIPELINE_STAGES_MAX columns, so a bound of
      //     4 refuses a target that IS reachable on a deeper board;
      //   • the `offer` role is OPTIONAL on a composed axis and stage ids are
      //     free-form, so a target the axis simply does not have used to be
      //     discovered only AFTER the loop had accepted the candidate through every
      //     remaining column — extending a real offer and landing them on the
      //     terminal stage — on the way to failing. Refuse before the FIRST advance,
      //     and stop at the terminal column, where further accepts can only re-fire
      //     terminal-stage side effects.
      const { axis } = await getBoard();
      const maxSteps = axis.length > 1 ? axis.length - 1 : MAX_STAGE_ADVANCES;
      let st = "";
      if (axis.some((s) => s.id === stage)) {
        for (let i = 0; i < maxSteps; i++) {
          st = await advance(entryId);
          if (st === stage) return st;
          if (stageHasRole(st, "terminal", axis)) break;
        }
      }
      throw new Error(
        tSim("error.advanceStalled", {
          stage,
          steps: maxSteps,
          current: st || tSim("error.unknownStage"),
        })
      );
    },
    [advance, getBoard, tSim]
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
        // A refused start (a TASK_BUDGET_EXHAUSTED 429 since wave 17, any 4xx) must not
        // fall through to a 25 s poll that ends in a timeout sentence: surface the
        // server's code as the group-eval error now, like every other engine call.
        await okJson(
          await fetch("/api/tasks", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ kind: "group_eval", params: { roleKey: jobId, roleTitle, jobId, candidates } }),
          })
        );
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
          const timeoutLabel = new Intl.NumberFormat(locale, {
            style: "unit",
            unit: "second",
            unitDisplay: "narrow",
            maximumFractionDigits: 0,
          }).format(Math.round(TIMEOUT_MS / 1000));
          const error = tSim("error.groupEvalTimeout", { seconds: timeoutLabel });
          patch({ groupEval: { roleTitle, payload: null, loading: false, error } });
          log(tSim("log.groupEvalTimedOut"));
        }
      } catch (e) {
        if (e instanceof SimStop) throw e;
        // Same honest-failure treatment as the timeout: show why, don't blank out.
        patch({
          groupEval: {
            roleTitle,
            payload: null,
            loading: false,
            // okJson already resolved the server's code into the reader's language.
            error: e instanceof Error && e.message ? e.message : tSim("error.groupEvalFailed"),
          },
          screenWave: null,
        });
      }
    },
    [ctrl, entriesFor, locale, log, patch, tSim]
  );

  return { getBoard, getEntries, okJson, entriesFor, topScreened, waitDom, waitEntry, clickEl, advance, advanceTo, runGroupEval };
}

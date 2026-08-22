// The scripted walk (step() + run()) half of SimulationProvider, split out so the
// provider stays under the 200-line file cap. Verbatim logic — the whole
// design → source → match → screen → interview → offer → hired chronology,
// driven through the SAME engine functions (real clicks, API calls, DOM waits)
// the provider used to own inline.
//
// i18n: this file is the guided demo's SCRIPT — every step title, spotlight
// caption and log line a prospect reads on `/?sim=auto`, the destination of the
// landing page's localized "Try the live demo" CTA. All of it reads from the
// `simulation` namespace; the only English left is the audit actor string on the
// screening approval (see `approvedBy` below), which is deliberately stable.
import { useCallback, type MutableRefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { clearedTabScopedParams } from "@/app/features/shell/tabs";
import { jdJobId } from "@/app/_lib/jd-limits";
import { screenedLandingStage, stageWithRole } from "@/app/_lib/pipeline-stages";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { SIM_COMPANY, SIM_ROLE, SIM_SALARY, SIM_SCREEN_POLICY, SIM_TITLE } from "./constants";
import { applyCompanyTemplate } from "./simCompanyTemplate";
import { CLEAR_OVERLAYS, JSON_HEADERS, SimStop, sleep, type ScreenWave, type SimState, type StepOpts } from "./simulationProviderTypes";
import type { useSimulationEngine } from "./useSimulationEngine";

/** The audit actor recorded on the demo's screening approval. NOT localized on
 *  purpose: it is written into a sealed decision record (the Art. 22
 *  human-approval gate), where the actor is an identity a reviewer and an
 *  exporter compare across runs and tenants — not UI chrome. Translating it
 *  would mint four different "who approved this" values for one scripted
 *  approval and make the audit trail locale-dependent. The persisted screening
 *  `rationale` is English for exactly the same reason; the UI renders its
 *  localized mirror from `reasonCode` instead (see SimDecisionWave). */
const DEMO_APPROVER = "Guided demo (auto-approved)";

/** What /api/decisions/screen-wave returns. Every field optional: the response is
 *  only trustworthy once its status has been checked (see `okJson`), and the
 *  approval token is minted by the preview for the commit to carry. */
type ScreenWaveResponse = Partial<ScreenWave> & { approvalToken?: string };

export function useSimulationWalk({
  ctrl,
  patch,
  log,
  nav,
  beat,
  gate,
  engine,
}: {
  ctrl: MutableRefObject<{ stop: boolean; paused: boolean; wake: (() => void) | null }>;
  patch: (p: Partial<SimState>) => void;
  log: (text: string) => void;
  nav: (updates: Record<string, string | null>) => void;
  beat: (ms: number) => Promise<void>;
  gate: () => Promise<void>;
  engine: ReturnType<typeof useSimulationEngine>;
}) {
  const { getBoard, okJson, entriesFor, topScreened, waitDom, waitEntry, clickEl, advance, advanceTo, runGroupEval } = engine;
  const t = useTranslations("simulation");
  // The demo JD prints a salary band; its digit grouping follows the active
  // locale like every other figure in the app (app/_lib/format.ts).
  const locale = useLocale();
  // The pipeline stage the server hands back is a wire code ("Offer"); the log
  // line shows its localized label, falling back to the code for a stage the
  // enum catalog doesn't know.
  const tEnums = useTranslations("enums");
  const stageLabel = useCallback(
    (stage: string) => {
      const key = `stage.${stage}` as Parameters<typeof tEnums>[0];
      return tEnums.has(key) ? tEnums(key) : stage;
    },
    [tEnums]
  );

  const step = useCallback(
    async (o: StepOpts) => {
      patch({ phase: o.id, status: o.title, spotlight: { selector: o.target, title: o.title, caption: o.caption } });
      log(o.caption);
      nav({ tab: o.tab, ...(o.navExtra ?? {}) });
      await beat(o.readMs ?? 1600);
      if (o.action) await o.action();
      notifyDataChanged(); // reflect this phase's mutations in any open view
      await beat(o.settleMs ?? 1000);
      await gate();
    },
    [beat, gate, log, nav, patch]
  );

  const run = useCallback(async () => {
    let jobId = "";
    let targetId = "";
    let targetLabel = "";
    let offerToken = "";
    // The one prose field of the demo RoleSpec (constants.ts keeps the matcher
    // input — enum codes, languages, skill tokens — locale-invariant), plus the
    // branded JD body built from the same copy.
    const responsibilities = [
      t("jd.responsibility.backend"),
      t("jd.responsibility.mentor"),
      t("jd.responsibility.design"),
    ];
    const role = { ...SIM_ROLE, responsibilities };
    const jdMarkdown = applyCompanyTemplate({
      title: SIM_TITLE,
      company: SIM_COMPANY,
      seniority: SIM_ROLE.seniority,
      responsibilities,
      mustHaves: SIM_ROLE.mustHaves,
      niceToHaves: SIM_ROLE.niceToHaves,
      salaryBand: [SIM_SALARY.suggestedMinimum, SIM_SALARY.suggestedMaximum],
      copy: {
        aboutHeading: t("jd.aboutHeading"),
        roleHeading: t("jd.roleHeading"),
        lookingForHeading: t("jd.lookingForHeading"),
        niceToHaveHeading: t("jd.niceToHaveHeading"),
        weOfferHeading: t("jd.weOfferHeading"),
        howToApplyHeading: t("jd.howToApplyHeading"),
        aboutBody: t("jd.aboutBody", { company: SIM_COMPANY }),
        weOfferBody: t("jd.weOfferBody"),
        howToApplyBody: t("jd.howToApplyBody"),
        period: t("jd.period"),
        locale,
      },
    });
    try {
      log(t("log.resetting"));
      await fetch("/api/sim/reset", { method: "POST" });

      // The columns THIS workspace's board actually has. The axis is per-workspace
      // data (Settings → Hiring composes it: free-form stage ids, extra rounds, an
      // optional offer column), so every stage the walk names is resolved from it BY
      // ROLE. Reading it once here is safe — nothing in a run edits the axis — and
      // it is what stops the demo from chasing columns that exist only on the
      // shipped board: with the literals, a renamed entry column made "sourced"
      // count 0 over a full pool, the cohort advance dragged every candidate toward
      // the terminal stage looking for a "Screened" that was not there, and the run
      // died on "intake returned none".
      const { axis } = await getBoard();
      const entryStage = stageWithRole("entry", axis) ?? "Accepted";
      const screenedStage = screenedLandingStage(axis) || "Screened";
      const offerStage = stageWithRole("offer", axis) ?? "Offer";

      await step({
        id: "design",
        tab: "library",
        target: '[data-sim="jd-builder"]',
        title: t("step.design.title"),
        caption: t("step.design.caption", { title: SIM_TITLE }),
        navExtra: {
          jdTitle: SIM_TITLE,
          jdCompany: SIM_COMPANY,
          jdSeniority: SIM_ROLE.seniority,
          jdFamily: SIM_ROLE.roleFamily,
          jdNeed: responsibilities.join(". ") + ".",
        },
        readMs: 2200,
      });

      await step({
        id: "source",
        tab: "jobs",
        target: '[data-sim="job-drafts"]',
        title: t("step.source.title"),
        caption: t("step.source.caption"),
        // Leaving the JD builder: clear the prefill (and any other tab-scoped
        // param) from the canonical allowlist rather than re-listing jd* keys.
        navExtra: clearedTabScopedParams(),
        action: async () => {
          // Save as a DRAFT (no sourcing yet).
          const save = await fetch("/api/jds/save", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title: SIM_TITLE, body: jdMarkdown, role, salary: SIM_SALARY, company: SIM_COMPANY }),
          }).then((r) => r.json());
          jobId = save.jobId ?? jdJobId(save.slug);
          log(t("log.savedDraft", { jobId }));
          notifyDataChanged(); // the Jobs tab picks up the new draft
          await beat(900);

          // Source into Pipeline — a real click on the draft's button (sources the pool).
          const clicked = await clickEl(`[data-sim-entry="${jobId}"] [data-sim-click="publish"]`, {
            title: t("step.source.clickTitle"),
            caption: t("step.source.clickCaption"),
          });
          if (!clicked) {
            log(t("log.draftNotVisible"));
            await fetch(`/api/jobs/${jobId}/publish`, { method: "POST" });
          }

          // Wait for the sourced entries to land.
          let sourced = 0;
          const deadline = Date.now() + 12_000;
          while (Date.now() < deadline) {
            if (ctrl.current.stop) throw new SimStop();
            sourced = (await entriesFor(jobId, entryStage)).length;
            if (sourced > 0) break;
            await sleep(400);
          }
          // A RAW number into the plural, never a pre-formatted string.
          log(t("log.sourced", { count: sourced }));
          notifyDataChanged();
        },
      });

      await step({
        id: "match",
        tab: "channels",
        target: '[data-sim="channel-inbound"]',
        title: t("step.match.title"),
        caption: t("step.match.caption"),
        action: async () => {
          // An inbound application arrives via the careers-page channel → Accepted.
          await beat(700);
          const inbound = await fetch("/api/sim/inbound", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ jobId }) }).then((r) => r.json());
          if (inbound?.label) log(t("log.inbound", { candidate: inbound.label }));
          notifyDataChanged();
          await beat(1400);

          // Match all intake (the entry column) → the screened column (first-wave
          // evaluation: match + AI screen), both resolved from this board's axis.
          const intake = await entriesFor(jobId, entryStage);
          // Best-effort cohort advance: this is the ONE site that deliberately opts
          // out of advanceTo's throw-on-failure policy — a stray un-advanceable stub
          // shouldn't abort the whole demo. Log each straggler and continue; the
          // `if (!top)` guard below still HALTS if the cohort produced nobody Screened.
          // Count what ACTUALLY reached the screened column, not how many were in
          // intake: the loop tolerates stragglers, so `intake.length` narrated
          // "5 candidates matched → Screened" directly above the two "stuck,
          // skipping" lines that contradicted it.
          let matched = 0;
          for (const e of intake) {
            try {
              await advanceTo(e.id, screenedStage);
              matched++;
            } catch (err) {
              if (err instanceof SimStop) throw err;
              log(
                t("log.stuck", {
                  candidate: e.candidateLabel,
                  reason: err instanceof Error ? err.message : t("log.advanceFailed"),
                })
              );
            }
          }
          const top = await topScreened(jobId, screenedStage);
          if (!top) throw new Error(t("error.noScreened"));
          targetId = top.id;
          targetLabel = top.candidateLabel;
          patch({ targetLabel });
          log(
            t("log.matched", {
              count: matched,
              candidate: targetLabel,
              score: top.matchScore ?? t("log.noScore"),
            })
          );
        },
      });

      // SCREEN — the first AUTOMATED decision wave: rank the matched cohort,
      // auto-reject the weakest below threshold (audited, with rationale),
      // early-career never rejected; the survivor proceeds toward interview.
      await step({
        id: "screen",
        tab: "analytics",
        target: '#main',
        title: t("step.screen.title"),
        caption: t("step.screen.caption"),
        action: async () => {
          // Preview first to get the approval token, then commit the reviewed set
          // (the Art. 22 human-approval gate) — the demo mirrors the recruiter's
          // review→approve flow rather than a solely-automated commit.
          // Override thresholds are single-sourced in SIM_SCREEN_POLICY
          // (constants.ts), coupled to its inboundScoreFloor by an invariant (the
          // scripted applicant must outscore the reject ceiling, or it gets
          // auto-rejected mid-demo). constants.test.ts pins that invariant.
          //
          // BOTH calls go through okJson: a non-OK screen-wave response is an error
          // object, and `wave.decisions ?? []` / `?? 0` used to coerce it into the
          // zero shape — so the modal announced "0 matched · 0 auto-rejected · 0
          // advanced" over a cohort the previous step had just logged as matched,
          // and the walk carried on to log "passed screening" for an automated
          // decision wave that never ran. This route is reachably non-OK: it is
          // requireOperator-gated and explicitly rejects the anonymous demo-workspace
          // session (401), refuses a commit whose approval token is missing or no
          // longer matches the reviewed set (409), and 400s a rejected override. A
          // labelled throw halts the run with "Failed: …" instead of a green lie —
          // the same failure policy waitEntry / advanceTo / getBoard already use.
          const screenWaveBody = { jobId, override: SIM_SCREEN_POLICY.screenWaveOverride };
          const wavePreview = await okJson<ScreenWaveResponse>(
            await fetch("/api/decisions/screen-wave", {
              method: "POST",
              headers: JSON_HEADERS,
              body: JSON.stringify({ ...screenWaveBody, dryRun: true }),
            })
          );
          // A missing token is not silently committed as "no approval": the route's
          // Art. 22 gate refuses a token-less commit (409), which okJson surfaces.
          const wave = await okJson<ScreenWaveResponse>(
            await fetch("/api/decisions/screen-wave", {
              method: "POST",
              headers: JSON_HEADERS,
              body: JSON.stringify({ ...screenWaveBody, approvalToken: wavePreview.approvalToken, approvedBy: DEMO_APPROVER }),
            })
          );
          patch({ screenWave: { decisions: wave.decisions ?? [], rejected: wave.rejected ?? 0, kept: wave.kept ?? 0, cohort: wave.cohort ?? 0 } });
          notifyDataChanged();
          await beat(3400); // let the viewer read the audit
          patch({ screenWave: null });
          log(t("log.screenWave", { rejected: wave.rejected ?? 0, kept: wave.kept ?? 0 }));

          // The survivor proceeds toward the interview: attach the deterministic
          // screening recommendation, then accept it. Accepting a screening_review
          // IS the advance — pipeline.ts moves the entry exactly one stage
          // (Screened → Interview) AND sets the calendar gate in the same step.
          // (gsim-l2-101: a bare advance() before the draft used to double-advance
          // the survivor to Offer, so the interview step's advanceTo("Offer")
          // bare-accepted an Offer-stage entry into a phantom Hired and the walk
          // crashed at the Interview→Offer seam. One accept, one stage.)
          await fetch("/api/sim/screen-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          // accept the screening review: one stage forward + the calendar gate.
          // WAIT on the stage the accept ACTUALLY produced, not on the literal
          // "Interview": which column lies one step past screening is workspace data,
          // so on a board that inserts a round (or renames the column) both halves of
          // the old predicate stayed false for the full 9s and the tour died.
          const landed = await advance(targetId);
          await waitEntry(targetId, (e) => e.stage === landed || e.approvalKind === "calendar", t("wait.screeningGate"));
          notifyDataChanged();
          log(t("log.passedScreening", { candidate: targetLabel }));
        },
        readMs: 1800,
      });

      // INTERVIEW — automate the round (candidate self-schedules), or assign a slot
      // manually. The driver takes the automate path; manual Confirm is the fallback.
      await step({
        id: "interview",
        tab: "schedule",
        target: '[data-sim="schedule"]',
        title: t("step.interview.title"),
        caption: t("step.interview.caption", { candidate: targetLabel }),
        action: async () => {
          let scheduled = false;
          try {
            // AUTOMATE: mint a self-scheduling link; the candidate picks a slot.
            const inv = await fetch("/api/schedule/invite", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) }).then((r) => r.json());
            if (inv?.token) {
              patch({ frame: { url: `/schedule/${inv.token}`, title: t("step.interview.frameTitle") } });
              await beat(2400); // let the viewer watch the candidate's slot picker
              const slots = await fetch(`/api/schedule/${inv.token}`).then((r) => r.json()).then((p) => p.slots ?? []);
              const slot = slots[0];
              if (slot) {
                // Confirming fires approve_event on the entry + sends a confirmation.
                await fetch(`/api/schedule/${inv.token}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ slot: slot.label, slotAt: slot.value }) });
                log(t("log.selfScheduled", { candidate: targetLabel, slot: slot.label }));
                scheduled = true;
                notifyDataChanged();
              }
              await beat(800);
              patch({ frame: null });
            }
          } catch {
            patch({ frame: null });
          }
          if (!scheduled) {
            // MANUAL fallback: the recruiter confirms a slot on the shared calendar.
            const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="confirm"]`, {
              title: t("step.interview.confirmTitle"),
              caption: t("step.interview.confirmCaption", { candidate: targetLabel }),
            });
            if (!clicked) {
              log(t("log.scheduleNotVisible"));
              await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "approve_event", detail: "Tue 14:00" }) });
              notifyDataChanged();
            }
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "calendar", t("wait.slotConfirmed"));
          const st = await advanceTo(targetId, offerStage);
          log(t("log.stage", { stage: stageLabel(st) }));
        },
        readMs: 1500,
      });

      // OFFER — group-evaluate the role's field, then a real click on ‘Send offer’.
      await step({
        id: "offer",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: t("step.offer.title"),
        caption: t("step.offer.caption", { candidate: targetLabel }),
        action: async () => {
          // Group evaluation: compare the field for the role before committing.
          await runGroupEval(jobId, SIM_TITLE);
          await beat(2600); // let the viewer read the comparison
          patch({ groupEval: null, screenWave: null });

          await fetch("/api/sim/offer-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          nav({ tab: "decisions" });
          await beat(600);
          const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="accept"]`, {
            title: t("step.offer.clickTitle"),
            caption: t("step.offer.clickCaption", { candidate: targetLabel }),
          });
          if (!clicked) {
            log(t("log.offerNotVisible"));
            // actor:"sim" — the engine (not a recruiter) extends here, so the
            // offer_terms seal reads "auto:sim" (gsim-l2-103).
            await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept", actor: "sim" }) });
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "offer_review", t("wait.offerExtended"));
          const { token } = await fetch(`/api/sim/offer-link?entryId=${targetId}`).then((r) => r.json());
          if (!token) throw new Error(t("error.offerTokenMissing"));
          offerToken = token;
          log(t("log.offerSent"));
        },
        settleMs: 1200,
      });

      // HIRED — the candidate opens their real offer page and clicks Accept.
      await step({
        id: "hired",
        tab: "pipeline",
        target: '[data-sim="pipeline-board"]',
        title: t("step.hired.title"),
        caption: t("step.hired.caption", { candidate: targetLabel }),
        action: async () => {
          patch({ frame: { url: `/offer/${offerToken}`, title: t("step.hired.frameTitle") } });
          await beat(1400); // let the candidate page load + the viewer see it
          const doc = await waitDom(() => {
            const ifr = document.querySelector("iframe[data-sim-frame]") as HTMLIFrameElement | null;
            const d = ifr?.contentDocument ?? null;
            return d && d.querySelector('[data-sim-click="offer-accept"]') ? d : null;
          });
          const clicked = doc
            ? await clickEl('[data-sim-click="offer-accept"]', {
                title: t("step.hired.acceptTitle"),
                caption: t("step.hired.acceptCaption"),
                doc,
              })
            : false;
          if (!clicked) {
            log(t("log.offerPageUnreachable"));
            await fetch(`/api/offer/${offerToken}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ response: "accept" }) });
          }
          await beat(1600); // show the ‘accepted’ confirmation
          patch({ frame: null });
          log(t("log.accepted"));
        },
        readMs: 1200,
        settleMs: 1400,
      });

      patch({ done: true, running: false, status: t("status.done"), ...CLEAR_OVERLAYS });
    } catch (e) {
      if (e instanceof SimStop) {
        patch({ running: false, status: t("status.stopped"), ...CLEAR_OVERLAYS });
        log(t("log.stopped"));
        return;
      }
      const msg = e instanceof Error ? e.message : t("status.genericError");
      patch({ running: false, error: msg, status: t("status.failed", { message: msg }), ...CLEAR_OVERLAYS });
      log(t("log.error", { message: msg }));
    }
  }, [advance, advanceTo, beat, clickEl, ctrl, entriesFor, getBoard, okJson, topScreened, locale, log, nav, patch, runGroupEval, stageLabel, step, t, waitDom, waitEntry]);

  return { run };
}

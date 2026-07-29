// The scripted walk (step() + run()) half of SimulationProvider, split out so the
// provider stays under the 200-line file cap. Verbatim logic — the whole
// design → source → match → screen → interview → offer → hired chronology,
// driven through the SAME engine functions (real clicks, API calls, DOM waits)
// the provider used to own inline.
import { useCallback, type MutableRefObject } from "react";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { jdJobId } from "@/app/_lib/jd-limits";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import { SIM_COMPANY, SIM_JD_MARKDOWN, SIM_ROLE, SIM_SALARY, SIM_SCREEN_POLICY, SIM_TITLE } from "./constants";
import { CLEAR_OVERLAYS, JSON_HEADERS, SimStop, sleep, type SimState, type StepOpts } from "./simulationProviderTypes";
import type { useSimulationEngine } from "./useSimulationEngine";

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
  const { entriesFor, topScreened, waitDom, waitEntry, clickEl, advance, advanceTo, runGroupEval } = engine;

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
    try {
      log("Resetting prior simulation runs…");
      await fetch("/api/sim/reset", { method: "POST" });

      await step({
        id: "design",
        tab: "library",
        target: '[data-sim="jd-builder"]',
        title: "Designing the job description",
        caption: `Filling the JD builder for "${SIM_TITLE}" — the role spec drives matching, sourcing and the offer band.`,
        navExtra: {
          jdTitle: SIM_TITLE,
          jdCompany: SIM_COMPANY,
          jdSeniority: SIM_ROLE.seniority,
          jdFamily: SIM_ROLE.roleFamily,
          jdNeed: SIM_ROLE.responsibilities.join(". ") + ".",
        },
        readMs: 2200,
      });

      await step({
        id: "source",
        tab: "jobs",
        target: '[data-sim="job-drafts"]',
        title: "Source into Pipeline",
        caption: "The JD is saved as a draft. Sourcing it from the Jobs tab takes it live and pulls the candidate pool into the pipeline.",
        // Leaving the JD builder: clear the prefill (and any other tab-scoped
        // param) from the canonical allowlist rather than re-listing jd* keys.
        navExtra: clearedTabScopedParams(),
        action: async () => {
          // Save as a DRAFT (no sourcing yet).
          const save = await fetch("/api/jds/save", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title: SIM_TITLE, body: SIM_JD_MARKDOWN, role: SIM_ROLE, salary: SIM_SALARY, company: SIM_COMPANY }),
          }).then((r) => r.json());
          jobId = save.jobId ?? jdJobId(save.slug);
          log(`Saved as draft · ${jobId}`);
          notifyDataChanged(); // the Jobs tab picks up the new draft
          await beat(900);

          // Source into Pipeline — a real click on the draft's button (sources the pool).
          const clicked = await clickEl(`[data-sim-entry="${jobId}"] [data-sim-click="publish"]`, {
            title: "Source into Pipeline",
            caption: "This takes the JD live and sources the candidate pool into the pipeline.",
          });
          if (!clicked) {
            log("(draft not visible — sourcing via API)");
            await fetch(`/api/jobs/${jobId}/publish`, { method: "POST" });
          }

          // Wait for the sourced entries to land.
          let sourced = 0;
          const deadline = Date.now() + 12_000;
          while (Date.now() < deadline) {
            if (ctrl.current.stop) throw new SimStop();
            sourced = (await entriesFor(jobId, "Accepted")).length;
            if (sourced > 0) break;
            await sleep(400);
          }
          log(`Live · sourced ${sourced} candidates → Accepted`);
          notifyDataChanged();
        },
      });

      await step({
        id: "match",
        tab: "channels",
        target: '[data-sim="channel-inbound"]',
        title: "Intake & match",
        caption: "Candidates enter via channels: an application arrives on the careers page (‘Accepted’) alongside the proactively-sourced pool; all intake is then scored and matched.",
        action: async () => {
          // An inbound application arrives via the careers-page channel → Accepted.
          await beat(700);
          const inbound = await fetch("/api/sim/inbound", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ jobId }) }).then((r) => r.json());
          if (inbound?.label) log(`📥 ${inbound.label} applied via the careers page → Accepted`);
          notifyDataChanged();
          await beat(1400);

          // Match all intake (Accepted) → Screened (first-wave evaluation: match + AI screen).
          const intake = await entriesFor(jobId, "Accepted");
          // Best-effort cohort advance: this is the ONE site that deliberately opts
          // out of advanceTo's throw-on-failure policy — a stray un-advanceable stub
          // shouldn't abort the whole demo. Log each straggler and continue; the
          // `if (!top)` guard below still HALTS if the cohort produced nobody Screened.
          for (const e of intake) {
            try {
              await advanceTo(e.id, "Screened");
            } catch (err) {
              if (err instanceof SimStop) throw err;
              log(`⚠︎ ${e.candidateLabel} stuck before Screened — skipping (${err instanceof Error ? err.message : "advance failed"})`);
            }
          }
          const top = await topScreened(jobId);
          if (!top) throw new Error("No Screened candidate to walk (intake returned none).");
          targetId = top.id;
          targetLabel = top.candidateLabel;
          patch({ targetLabel });
          log(`Matched ${intake.length} candidates → Screened · following ${targetLabel} (match ${top.matchScore ?? "—"}) to Hired`);
        },
      });

      // SCREEN — the first AUTOMATED decision wave: rank the matched cohort,
      // auto-reject the weakest below threshold (audited, with rationale),
      // early-career never rejected; the survivor proceeds toward interview.
      await step({
        id: "screen",
        tab: "analytics",
        target: '#main',
        title: "Screening · automated wave",
        caption: "The first automated decision: score the matched candidates, auto-reject the weakest below threshold (each with a rationale), and pass the rest.",
        action: async () => {
          // Preview first to get the approval token, then commit the reviewed set
          // (the Art. 22 human-approval gate) — the demo mirrors the recruiter's
          // review→approve flow rather than a solely-automated commit.
          // Override thresholds are single-sourced in SIM_SCREEN_POLICY
          // (constants.ts), coupled to its inboundScoreFloor by an invariant (the
          // scripted applicant must outscore the reject ceiling, or it gets
          // auto-rejected mid-demo). constants.test.ts pins that invariant.
          const screenWaveBody = { jobId, override: SIM_SCREEN_POLICY.screenWaveOverride };
          const wavePreview = await fetch("/api/decisions/screen-wave", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ ...screenWaveBody, dryRun: true }),
          }).then((r) => r.json());
          const wave = await fetch("/api/decisions/screen-wave", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ ...screenWaveBody, approvalToken: wavePreview.approvalToken, approvedBy: "Guided demo (auto-approved)" }),
          }).then((r) => r.json());
          patch({ screenWave: { decisions: wave.decisions ?? [], rejected: wave.rejected ?? 0, kept: wave.kept ?? 0, cohort: wave.cohort ?? 0 } });
          notifyDataChanged();
          await beat(3400); // let the viewer read the audit
          patch({ screenWave: null });
          log(`Screening wave · ${wave.rejected ?? 0} auto-rejected (with rationale), ${wave.kept ?? 0} advanced · early-career protected`);

          // The survivor proceeds toward the interview: attach the deterministic
          // screening recommendation, then accept it. Accepting a screening_review
          // IS the advance — pipeline.ts moves the entry exactly one stage
          // (Screened → Interview) AND sets the calendar gate in the same step.
          // (gsim-l2-101: a bare advance() before the draft used to double-advance
          // the survivor to Offer, so the interview step's advanceTo("Offer")
          // bare-accepted an Offer-stage entry into a phantom Hired and the walk
          // crashed at the Interview→Offer seam. One accept, one stage.)
          await fetch("/api/sim/screen-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          await advance(targetId); // accept the screening review: Screened → Interview + calendar gate
          await waitEntry(targetId, (e) => e.stage === "Interview" || e.approvalKind === "calendar", "screening to open the interview / calendar gate");
          notifyDataChanged();
          log(`${targetLabel} passed screening → Interview`);
        },
        readMs: 1800,
      });

      // INTERVIEW — automate the round (candidate self-schedules), or assign a slot
      // manually. The driver takes the automate path; manual Confirm is the fallback.
      await step({
        id: "interview",
        tab: "schedule",
        target: '[data-sim="schedule"]',
        title: "Interview",
        caption: `Automating the interview round — ${targetLabel} self-schedules (vs. assigning a slot manually).`,
        action: async () => {
          let scheduled = false;
          try {
            // AUTOMATE: mint a self-scheduling link; the candidate picks a slot.
            const inv = await fetch("/api/schedule/invite", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) }).then((r) => r.json());
            if (inv?.token) {
              patch({ frame: { url: `/schedule/${inv.token}`, title: "Candidate self-schedules" } });
              await beat(2400); // let the viewer watch the candidate's slot picker
              const slots = await fetch(`/api/schedule/${inv.token}`).then((r) => r.json()).then((p) => p.slots ?? []);
              const slot = slots[0];
              if (slot) {
                // Confirming fires approve_event on the entry + sends a confirmation.
                await fetch(`/api/schedule/${inv.token}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ slot: slot.label, slotAt: slot.value }) });
                log(`${targetLabel} self-scheduled · ${slot.label}`);
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
              title: "Confirm the interview",
              caption: `Recruiter confirms ${targetLabel}'s interview slot.`,
            });
            if (!clicked) {
              log("(schedule card not visible — confirming via API)");
              await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "approve_event", detail: "Tue 14:00" }) });
              notifyDataChanged();
            }
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "calendar", "the interview slot to be confirmed");
          const st = await advanceTo(targetId, "Offer");
          log(`→ ${st}`);
        },
        readMs: 1500,
      });

      // OFFER — group-evaluate the role's field, then a real click on ‘Send offer’.
      await step({
        id: "offer",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: "Extending the offer",
        caption: `Comparing the role's candidates, then sending the offer to ${targetLabel}.`,
        action: async () => {
          // Group evaluation: compare the field for the role before committing.
          await runGroupEval(jobId, SIM_TITLE);
          await beat(2600); // let the viewer read the comparison
          patch({ groupEval: null, screenWave: null });

          await fetch("/api/sim/offer-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          nav({ tab: "decisions" });
          await beat(600);
          const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="accept"]`, {
            title: "Send offer",
            caption: `Recruiter clicks ‘Send offer’ — a secure accept/decline link goes to ${targetLabel}.`,
          });
          if (!clicked) {
            log("(offer card not visible — extending via API)");
            // actor:"sim" — the engine (not a recruiter) extends here, so the
            // offer_terms seal reads "auto:sim" (gsim-l2-103).
            await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept", actor: "sim" }) });
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "offer_review", "the offer to be extended");
          const { token } = await fetch(`/api/sim/offer-link?entryId=${targetId}`).then((r) => r.json());
          if (!token) throw new Error("offer token not found after extend");
          offerToken = token;
          log("Offer sent · secure link generated");
        },
        settleMs: 1200,
      });

      // HIRED — the candidate opens their real offer page and clicks Accept.
      await step({
        id: "hired",
        tab: "pipeline",
        target: '[data-sim="pipeline-board"]',
        title: "Candidate accepts",
        caption: `${targetLabel} opens the secure link and accepts — they move to Hired and onboarding begins.`,
        action: async () => {
          patch({ frame: { url: `/offer/${offerToken}`, title: "Candidate's view" } });
          await beat(1400); // let the candidate page load + the viewer see it
          const doc = await waitDom(() => {
            const ifr = document.querySelector("iframe[data-sim-frame]") as HTMLIFrameElement | null;
            const d = ifr?.contentDocument ?? null;
            return d && d.querySelector('[data-sim-click="offer-accept"]') ? d : null;
          });
          const clicked = doc
            ? await clickEl('[data-sim-click="offer-accept"]', { title: "Accept offer", caption: "The candidate accepts the offer.", doc })
            : false;
          if (!clicked) {
            log("(offer page not reachable — accepting via API)");
            await fetch(`/api/offer/${offerToken}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ response: "accept" }) });
          }
          await beat(1600); // show the ‘accepted’ confirmation
          patch({ frame: null });
          log("Accepted · moved to Hired · onboarding comm queued");
        },
        readMs: 1200,
        settleMs: 1400,
      });

      patch({ done: true, running: false, status: "Done — candidate hired 🎉", ...CLEAR_OVERLAYS });
    } catch (e) {
      if (e instanceof SimStop) {
        patch({ running: false, status: "Stopped", ...CLEAR_OVERLAYS });
        log("Simulation stopped.");
        return;
      }
      const msg = e instanceof Error ? e.message : "Simulation failed.";
      patch({ running: false, error: msg, status: `Failed: ${msg}`, ...CLEAR_OVERLAYS });
      log(`Error: ${msg}`);
    }
  }, [advance, advanceTo, beat, clickEl, ctrl, entriesFor, topScreened, log, nav, patch, runGroupEval, step, waitDom, waitEntry]);

  return { run };
}

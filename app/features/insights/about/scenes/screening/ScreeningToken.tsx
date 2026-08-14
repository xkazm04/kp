"use client";

import { Field, Part, Slot, Wire, Wires } from "../../stage/parts";
import { useSceneClock } from "../../stage/useSceneClock";
import { INK, SKIN } from "../../stage/motion";
import { stageOf, type Rect } from "../../stage/stages";
import { bottomOf, topOf, vCurve } from "../../stage/threads";
import { CodeLabel, SceneStatus, statusPicker } from "../shared";

/*
 * Chapter 3, variant C — THE APPROVAL TOKEN.
 *
 * Metaphor: a signed receipt that stops matching. The evidence-first register
 * turned into a safety property — the thing the recruiter approved and the
 * thing the server is about to do must be provably the same set of people.
 *
 * Bulk auto-rejection is the one screening action that is irreversible and
 * candidate-visible, so it runs preview → approve → commit, and the preview is
 * FINGERPRINTED (`screenWaveApprovalToken` in app/_lib/screen-wave.ts):
 *
 *     sha256(`${jobId}|${policyVersion}|${sortedRejectIds.join(",")}`).slice(0,32)
 *
 * The server recomputes it from the live cohort at commit. If a single new
 * application arrived in between, the set differs, the token differs, and the
 * commit is refused with a 409 — you approved a set, not a rule. Two further
 * details make the scene honest rather than triumphant: `approvedBy` from the
 * request body is IGNORED (the approver is bound to the authenticated
 * operator), and 5% of the would-be rejects are deliberately spared as a
 * calibration holdout so the score's own accuracy stays falsifiable.
 *
 * Beats (CYCLE = 16 @ 900ms ≈ 14.4s):
 *   0 outline · 1 the cohort · 2 the policy · 3 the reject set
 *   4 the holdout is carved out · 5 the fingerprint · 6 approval
 *   7 a new application arrives · 8 the set drifts · 9 recompute
 *   10 mismatch · 11 409 · 12-15 hold
 */

const CYCLE = 16;
const STILL = 12;

const COHORT = 40;
const WOULD_REJECT = 8;
const HELD_OUT = 1; // DEFAULT_HOLDOUT_PERCENT = 5 → 5% of 8, floored to a real person

const TOKEN_BEFORE = "9f2c41ab…";
const TOKEN_AFTER = "c07be5d1…";

// ── Geometry ────────────────────────────────────────────────────────────────
const PREVIEW: Rect = { x: 0, y: 0, w: 46, h: 34 };
const TOKEN: Rect = { x: 0, y: 40, w: 46, h: 20 };
const APPROVE: Rect = { x: 0, y: 66, w: 46, h: 18 };

const DRIFT: Rect = { x: 54, y: 0, w: 46, h: 26 };
const RECOMPUTE: Rect = { x: 54, y: 32, w: 46, h: 20 };
const REFUSAL: Rect = { x: 54, y: 58, w: 46, h: 26 };

const statusAt = statusPicker({
  0: "screening wave — nothing is applied until you commit",
  2: "policy: reject bottom 20% where match < 45",
  3: `would reject ${WOULD_REJECT} of ${COHORT}`,
  4: `holdout 5% — ${HELD_OUT} spared so the score stays falsifiable`,
  5: "screenWaveApprovalToken(jobId, policyVersion, sortedRejectIds)",
  6: `approved by the authenticated operator — approvedBy from the body is ignored`,
  7: "meanwhile: one new application arrives",
  9: "the server recomputes the token from the LIVE cohort",
  10: `${TOKEN_BEFORE} ≠ ${TOKEN_AFTER}`,
  11: "409 — the candidate set changed since you previewed it",
});

export function ScreeningToken() {
  const { ref, phase, reduced } = useSceneClock(CYCLE, { stillTick: STILL });
  const at = (n: number) => phase >= n;
  const rejecting = at(4) ? WOULD_REJECT - HELD_OUT : WOULD_REJECT;

  return (
    <div ref={ref}>
      <Field min="min-h-[34rem] sm:min-h-[38rem]">
        <Wires>
          <Wire d={vCurve(bottomOf(PREVIEW, 0.5), topOf(TOKEN, 0.5))} drawn={at(5)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(TOKEN, 0.5), topOf(APPROVE, 0.5))} drawn={at(6)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(DRIFT, 0.5), topOf(RECOMPUTE, 0.5))} drawn={at(9)} stroke={INK.line} reduced={reduced} />
          <Wire d={vCurve(bottomOf(RECOMPUTE, 0.5), topOf(REFUSAL, 0.5))} drawn={at(11)} stroke={INK.act} reduced={reduced} />
          {/* The commit that does not happen. Dashed, never drawn. */}
          <Wire d="M 46 75 C 52 75, 52 71, 54 71" drawn dashed stroke={INK.quiet} reduced={reduced} />
        </Wires>

        {/* ── What you were shown ───────────────────────────────────────── */}
        <Slot rect={PREVIEW} stage={stageOf({ shell: 1, body: 1, detail: 3, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>dryRun: true</CodeLabel>
          <Part show={at(2)} reduced={reduced} className="mt-1.5 block text-base leading-snug text-ink">
            Reject bottom 20% where match &lt; 45
          </Part>
          {/* The cohort as a grid of marks: the set is a set of PEOPLE, and a
              count alone would let the reader forget that. */}
          <div className="mt-3 flex flex-wrap gap-1">
            {Array.from({ length: COHORT }, (_, i) => {
              const doomed = i < WOULD_REJECT;
              const spared = at(4) && i === WOULD_REJECT - 1;
              return (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-[2px] ${SKIN} ${
                    spared ? "bg-dial-amber" : doomed && at(3) ? "bg-coral" : "bg-stone-200"
                  }`}
                  style={{ transitionDelay: reduced ? "0ms" : `${i * 12}ms` }}
                />
              );
            })}
          </div>
          <Part show={at(4)} reduced={reduced} className="mt-2.5 block text-meta text-steel">
            {rejecting} to reject · {HELD_OUT} held out (amber) as the clean arm
          </Part>
        </Slot>

        {/* ── The fingerprint ───────────────────────────────────────────── */}
        <Slot rect={TOKEN} stage={stageOf({ shell: 5, body: 5, detail: 5, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>approvalToken</CodeLabel>
          <Part show={at(5)} reduced={reduced} className="mt-1 block font-mono text-base text-ink">
            {TOKEN_BEFORE}
          </Part>
          <Part show={at(5)} i={1} reduced={reduced} className="mt-1 block text-meta leading-snug text-steel">
            sha256(job · policy · the sorted ids themselves)
          </Part>
        </Slot>

        <Slot rect={APPROVE} stage={stageOf({ shell: 6, body: 6, detail: 6, chosen: 6 }, phase)} chosen={at(6)} reduced={reduced} className="p-3">
          <CodeLabel>human approval</CodeLabel>
          <Part show={at(6)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            Bound to the authenticated operator, not to a name in the request body.
          </Part>
        </Slot>

        {/* ── What changed underneath ───────────────────────────────────── */}
        <Slot rect={DRIFT} stage={stageOf({ shell: 7, body: 7, detail: 8, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>meanwhile</CodeLabel>
          <Part show={at(7)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            One new application lands on the role.
          </Part>
          <Part show={at(8)} reduced={reduced} className="mt-2 block text-meta text-steel">
            The bottom 20% is now a different 20%.
          </Part>
        </Slot>

        <Slot rect={RECOMPUTE} stage={stageOf({ shell: 9, body: 9, detail: 10, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>recomputed at commit</CodeLabel>
          <Part show={at(9)} reduced={reduced} className="mt-1 block font-mono text-base text-coral">
            {TOKEN_AFTER}
          </Part>
          <Part show={at(10)} reduced={reduced} className="mt-1 block text-meta text-steel">
            Compared against what you actually approved.
          </Part>
        </Slot>

        <Slot rect={REFUSAL} stage={stageOf({ shell: 11, body: 11, detail: 11, chosen: null }, phase)} reduced={reduced} className="p-3">
          <CodeLabel>409</CodeLabel>
          <Part show={at(11)} reduced={reduced} className="mt-1 block text-base leading-snug text-ink">
            &ldquo;The candidate set changed since you previewed it. Review the refreshed set and approve again.&rdquo;
          </Part>
          <Part show={at(11)} i={1} reduced={reduced} className="mt-2 block text-meta leading-snug text-steel">
            You approved a set of people, not a rule that keeps running.
          </Part>
        </Slot>
      </Field>

      <SceneStatus phase={phase} reduced={reduced} text={statusAt(phase)} />
    </div>
  );
}

// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): the ControlDock phase
// stepper conveyed done/current/upcoming through color + an aria-hidden icon ONLY —
// a screen-reader user heard seven bare phase labels and a colorblind user couldn't
// tell moss-done from stone-upcoming. This pure helper single-sources the tri-state
// derivation (previously two inline booleans in the JSX with no "upcoming" concept),
// so the ControlDock can attach an accessible-name state to every step and the
// visual + a11y state can't drift. Extracted to a .ts sibling so `npm run test:unit`
// (node --test, .tsx cannot be loaded) can pin the mapping.

export type PhaseStepState = "completed" | "current" | "upcoming";

/**
 * Which state a phase step is in, given the active phase index and whether the sim
 * has finished. Precedence matches the old inline JSX exactly:
 *   • done  = simDone || activeIdx > index   (a passed step, or the whole run finished)
 *   • active = activeIdx === index && !simDone
 * but adds the third, previously-nameless bucket ("upcoming") so every step carries a
 * spoken state. When the run is done, EVERY step reads "completed" (the run reached Hired).
 */
export function phaseStepState(params: { activeIdx: number; index: number; simDone: boolean }): PhaseStepState {
  const { activeIdx, index, simDone } = params;
  if (activeIdx === index && !simDone) return "current";
  if (simDone || activeIdx > index) return "completed";
  return "upcoming";
}

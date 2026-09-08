/**
 * The four traced step glyphs, keyed by StepKey.
 *
 * A plain object literal on purpose: the briefing renders whichever glyph the
 * focused step names, and the React compiler forbids *calling* a component-
 * returning function during render — so the consumer indexes this map and hands
 * the data to one `MotionizedGlyph` instance.
 *
 * The art is one /motionize sheet traced per tile, so the four belong to a single
 * family (identical ink weight, one palette). Every fill resolves through
 * glyphTokens to a `var(--color-…)` brand token, so both themes come free.
 */

import type { TracedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { STEP_COMPANY_GLYPH } from "@/app/_components/glyph/glyphs/stepCompanyGlyph";
import { STEP_FIRST_ROLE_GLYPH } from "@/app/_components/glyph/glyphs/stepFirstRoleGlyph";
import { STEP_CASE_GLYPH } from "@/app/_components/glyph/glyphs/stepCaseGlyph";
import { STEP_CHANNELS_GLYPH } from "@/app/_components/glyph/glyphs/stepChannelsGlyph";
import type { StepKey } from "./setupGettingStartedModel";

export const STEP_GLYPHS: Record<StepKey, TracedGlyph> = {
  // `finishSetup` reopens the wizard, whose subject is the workspace itself — the
  // same thing the company glyph draws. It shares that art rather than shipping a
  // fifth tile off-family: the briefing shows ONE glyph at a time, so the two are
  // never on screen together, and inventing a new drawing for "the wizard" would
  // be a picture of a dialog rather than of the thing being set up.
  finishSetup: STEP_COMPANY_GLYPH,
  company: STEP_COMPANY_GLYPH,
  firstRole: STEP_FIRST_ROLE_GLYPH,
  case: STEP_CASE_GLYPH,
  channels: STEP_CHANNELS_GLYPH,
};

// Source guard for the three public "door" clients that a candidate or a
// colleague reaches WITHOUT a session: the GDPR data page, the invite accept
// form and the operator sign-in. None of them can load under `node --test`
// (JSX + hooks need a bundler/DOM) and none is covered by the keyless Playwright
// subset today, so the properties below are asserted against the SOURCE — the
// same technique as app/api/rate-limit-contract.test.ts and
// upload-size-contract.test.ts.
//
// What it pins, and why each line exists (every one of these FAILS against the
// code as it stood before 2026-09-02, which is what makes the file non-vacuous):
//
//  1. The recurring surfaces come from app/_components/ui/recipes.ts. The data
//     door hand-rolled three button class strings and the login door hand-rolled
//     a fourth — so the dual-theme press-down, the focus ring and the disabled
//     treatment were four independent re-derivations, and Spark Dark got
//     whatever they happened to include.
//  2. Every interactive control on these doors is at least 44px tall (`h-11`).
//     They were `h-10` / `py-2`: under the WCAG 2.5.8 (AA) target-size floor on
//     the exact surfaces most likely to be opened on a phone, from an email.
//  3. The erasure confirm is a real `role="alertdialog"` wired to the shared
//     `useDialogA11y` hook, with the SAFE action first in the DOM (the hook
//     focuses the first focusable, so Cancel must precede the destructive
//     button). It used to be a plain <div> of two buttons, destructive first,
//     with no focus move, no Escape and no trap — for an irreversible action.
//  4. The data door offers a RETRY on a retryable load failure, and a
//     `Skeleton`-shaped loading state rather than a bare line of text.
//  5. The data door carries a LanguageSwitcher: its link is ?lang=-pinned to the
//     language of the letter it rode on, so a forwarded link can land a reader on
//     a legal affordance in a language they do not read, with no other chrome to
//     escape through.
//
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Line endings normalised: a checkout with core.autocrlf=true carries CRLF, and a
// marker that spans a newline would then never match (the same Windows trap the
// rate-limit contract documents).
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const DATA_CLIENT = "./DataClient.tsx";
const INVITE_FORM = "../../invite/[token]/AcceptForm.tsx";
const LOGIN_CLIENT = "../../login/LoginClient.tsx";

// Every className that a `<button` or `<a` carries on these doors, in source order.
function buttonClassNames(src: string): string[] {
  const out: string[] = [];
  const re = /<(?:button|a)\b([\s\S]*?)>/g;
  for (const m of src.matchAll(re)) {
    const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(m[1]);
    if (cls) out.push(cls[1] ?? cls[2] ?? "");
  }
  return out;
}

for (const rel of [DATA_CLIENT, INVITE_FORM, LOGIN_CLIENT]) {
  test(`${rel}: every button/link control clears the 44px touch target (h-11 / min-h-11)`, () => {
    const src = read(rel);
    const classes = buttonClassNames(src);
    assert.ok(classes.length > 0, "expected to find at least one control");
    for (const cls of classes) {
      // A control with no height utility at all is fine only when it is not a
      // sized control (none exist on these doors today); h-10 or py-2 is the
      // regression this pins.
      assert.ok(!/\bh-10\b/.test(cls), `a control is still h-10 (40px): ${cls}`);
      assert.ok(!/\bpy-2\b/.test(cls), `a control still sizes itself with py-2: ${cls}`);
      assert.match(cls, /\b(?:h-11|min-h-11)\b/, `a control declares no 44px height: ${cls}`);
    }
  });

  test(`${rel}: button styling comes from recipes.ts, not a hand-rolled class string`, () => {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_components\/ui\/recipes"/, "must import the shared recipes");
    for (const cls of buttonClassNames(src)) {
      // The recipes carry the fill/border; a control that paints its own is the
      // re-derivation this pins. (A text link — underline, no fill — is exempt.)
      const paintsItsOwnFill = /\bbg-(?:stone|coral|moss|red|ink)-?\d*\b/.test(cls) || /\bborder-stone-200\b/.test(cls);
      assert.ok(!paintsItsOwnFill, `a control hand-rolls its own fill/border instead of using a recipe: ${cls}`);
    }
  });
}

// ── the other four doors (/perfect wave 20, offer-and-skill-doors-match-their-siblings)
//
// The scan above covered three doors and stopped. The four it did NOT scan are
// where the same defects had survived: the offer card a candidate accepts a JOB
// on hand-rolled its confirm buttons, the status page hand-rolled its retry and
// refresh, the NPS card hand-rolled its send and an eleven-cell scale at 36px,
// and the signup form's only button was `py-2` on `bg-stone-900` — a raw neutral
// that is not even in the theme-mapped set. A guard that names three files is a
// guard that watches whichever door was last remembered.
//
// The rule differs in ONE way from the loop above, deliberately: these doors
// compose the TOUCH-SIZED recipes (`BTN_PRIMARY_LG` / `BTN_SECONDARY_LG`), whose
// h-11 lives in recipes.ts rather than at the call site. So a control satisfies
// the 44px floor either by carrying `h-11`/`min-h-11` itself OR by composing one
// of those two recipes — and the recipes' own height is pinned below, so the
// indirection cannot quietly shrink.
const OFFER_CLIENT = "../../offer/[token]/OfferClient.tsx";
const STATUS_CLIENT = "../../status/[token]/StatusClient.tsx";
const STATUS_NPS = "../../status/[token]/StatusNpsCard.tsx";
const SIGNUP_CLIENT = "../../signup/SignupClient.tsx";

/** Whole `<button …>` / `<a …>` open tags, so a rule can read the element's role
 *  as well as its classes. */
function controlTags(src: string): string[] {
  // The arrow substitution is load-bearing: a non-greedy scan to the next ">"
  // stops INSIDE `onClick={() => …}`, so every control with an inline handler —
  // which on these doors is most of them — yielded a fragment carrying no
  // className and was silently skipped. Masking the arrows first is what makes
  // the scan actually see them.
  const masked = src.replace(/=>/g, "=»");
  return [...masked.matchAll(/<(?:button|a)\b([^>]*?)>/g)].map((m) => m[1]);
}

function classOf(tag: string): string | null {
  const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag);
  return cls ? (cls[1] ?? cls[2] ?? "") : null;
}

const TOUCH_RECIPES = /\$\{BTN_(?:PRIMARY|SECONDARY)_LG\}/;

test("the touch-sized recipes are what this file's 44px rule leans on — they must BE 44px", () => {
  const recipes = read("../../_components/ui/recipes.ts");
  for (const name of ["BTN_PRIMARY_LG", "BTN_SECONDARY_LG"]) {
    const at = recipes.indexOf(`export const ${name} =`);
    assert.ok(at >= 0, `${name} must exist — the doors compose it for their touch target`);
    assert.match(recipes.slice(at, at + 200), /\bh-11\b/, `${name} must carry h-11`);
  }
});

for (const rel of [OFFER_CLIENT, STATUS_CLIENT, STATUS_NPS, SIGNUP_CLIENT]) {
  test(`${rel}: every control clears the 44px touch target`, () => {
    const src = read(rel);
    const tags = controlTags(src);
    assert.ok(tags.length > 0, "expected to find at least one control");
    for (const tag of tags) {
      const cls = classOf(tag);
      if (cls === null) continue;
      assert.ok(!/\bh-(?:8|9|10)\b/.test(cls), `a control is under 44px: ${cls}`);
      assert.ok(!/\bpy-(?:1|1\.5|2)\b/.test(cls), `a control still sizes itself with padding: ${cls}`);
      assert.ok(
        /\b(?:h-11|min-h-11)\b/.test(cls) || TOUCH_RECIPES.test(cls),
        `a control declares no 44px height and composes no touch recipe: ${cls}`
      );
    }
  });

  test(`${rel}: button styling comes from recipes.ts, not a hand-rolled class string`, () => {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_components\/ui\/recipes"/, "must reuse the shared recipes");
    for (const tag of controlTags(src)) {
      const cls = classOf(tag);
      if (cls === null) continue;
      // The NPS 0-10 scale is a `radiogroup` of eleven cells, not an action: it is
      // a SCALE whose selected/unselected tint is its whole meaning, and no BTN_*
      // recipe expresses that. Sized (44px) by the rule above, tinted by itself.
      if (/role="radio"/.test(tag)) continue;
      const paintsItsOwnFill = /\bbg-(?:stone|coral|moss|red|ink)-?\d*\b/.test(cls) || /\bborder-stone-200\b/.test(cls);
      assert.ok(!paintsItsOwnFill, `a control hand-rolls its own fill/border instead of using a recipe: ${cls}`);
    }
  });

  test(`${rel}: no text-xs — the door's floor is the type scale`, () => {
    // 12px on a page read on a phone, from an email, often by someone who is not
    // a daily user of this product. `text-meta` is the scale's small step.
    assert.ok(!/\btext-xs\b/.test(read(rel)), "text-xs must not appear on a public door");
  });
}

test("OfferClient: the decline confirm is a real MODAL alertdialog on the shared hook, safe action first", () => {
  const src = read(OFFER_CLIENT);
  // It claimed the role and hand-rolled ONE focus() call: no trap, no Escape, no
  // focus restore, no aria-modal — over an irreversible action, on the door where
  // the stakes are highest of the four.
  assert.match(src, /useDialogA11y/, "the confirm must use the shared dialog hook");
  assert.match(src, /role="alertdialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /aria-labelledby="decline-confirm-title"/);
  assert.match(src, /aria-describedby="decline-confirm-desc"/);
  const after = src.slice(src.indexOf('role="alertdialog"'));
  const cancelAt = after.indexOf("onClick={onCancel}");
  const confirmAt = after.indexOf("onClick={onConfirm}");
  assert.ok(cancelAt >= 0 && confirmAt >= 0, "expected both a cancel and a confirm handler in the dialog");
  assert.ok(cancelAt < confirmAt, "Cancel must precede the destructive action so focus lands on the safe option");
});

test("OfferClient: the deadline is formatted in ONE named zone, never the viewer's", () => {
  const src = read(OFFER_CLIENT);
  assert.match(src, /formatOfferDeadline\(offer\.expiresAt, locale\)/, "the label must go through the shared formatter");
  assert.ok(
    !/dateStyle: "medium", timeStyle: "short"/.test(src),
    "the viewer-zone Intl call is the bug — one instant read as three calendar days"
  );
});

test("StatusNpsCard: the failure is announced, and so is the thanks it swaps to", () => {
  const src = read(STATUS_NPS);
  // "That didn't go through" replaced nothing and announced nothing: a screen
  // reader user pressed Send and heard silence over an answer that was DROPPED.
  const failedAt = src.indexOf('t("failed")');
  assert.ok(failedAt >= 0, "expected the failure copy");
  assert.match(src.slice(Math.max(0, failedAt - 200), failedAt), /role="alert"/, "the failure must be a live region");
  const thanksAt = src.indexOf('t("thanks")');
  assert.ok(thanksAt >= 0, "expected the thanks copy");
  assert.match(src.slice(Math.max(0, thanksAt - 300), thanksAt), /role="status"/, "the thanks swap must be announced");
});

test("DataClient: the erasure confirm is a real alertdialog on the shared hook, safe action first", () => {
  const src = read(DATA_CLIENT);
  assert.match(src, /useDialogA11y/, "the confirm must use the shared dialog hook (focus move, Escape, trap)");
  assert.match(src, /role="alertdialog"/, "an irreversible confirm is an alertdialog, not a plain div");
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /aria-labelledby="erase-confirm-title"/);
  assert.match(src, /aria-describedby="erase-confirm-desc"/);

  // useDialogA11y focuses the FIRST focusable inside the dialog, so DOM order is
  // the whole mechanism: Cancel must come before the destructive button, which
  // also puts the destructive action last visually (the offer door's shape).
  const dialogAt = src.indexOf('role="alertdialog"');
  const after = src.slice(dialogAt);
  const cancelAt = after.indexOf('onClick={onCancel}');
  const confirmAt = after.indexOf('onClick={onConfirm}');
  assert.ok(cancelAt >= 0 && confirmAt >= 0, "expected both a cancel and a confirm handler in the dialog");
  assert.ok(cancelAt < confirmAt, "Cancel must precede the destructive action so focus lands on the safe option");
});

test("DataClient: a retryable load failure offers a retry; a dead link does not", () => {
  const src = read(DATA_CLIENT);
  assert.match(src, /onClick=\{retryLoad\}/, "the retryable branch must render a retry control");
  // The retry is gated on the failure KIND — a retry button over a 404 is a loop
  // with no exit, and the dead-link copy already says the link is gone.
  assert.match(src, /loadFailure === "retryable" \? \(/, "the retry must be gated on the retryable failure kind");
  assert.match(src, /loadFailure === "dead"/, "404 must stay a distinct, non-retryable ending");
});

test("DataClient: the loading state is a Skeleton, and the page carries a LanguageSwitcher", () => {
  const src = read(DATA_CLIENT);
  assert.match(src, /import \{ Skeleton \} from "@\/app\/_components\/Skeleton"/);
  assert.match(src, /<Skeleton /, "the loading state must reserve the page's shape, not print a line of text");
  assert.match(src, /aria-busy="true"/, "the skeleton must announce itself as busy");
  assert.match(src, /import \{ LanguageSwitcher \} from "@\/app\/_components\/LanguageSwitcher"/);
  assert.match(src, /<LanguageSwitcher \/>/);
});

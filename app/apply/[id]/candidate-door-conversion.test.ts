import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Conversion guards for the two CANDIDATE-facing doors (the conversational chat
// and the one-screen quick form). Each pins a leak that was live and is cheap to
// silently regress in a restyle/refactor:
//   (a) a knockout question must not STEER the answer with a success tone,
//   (b) a decline must not be a dead end,
//   (c) the quick form's submit must never be a dead disabled button.
// Source-contract tests — the repo pattern for UI wiring unit tests can't reach
// (no DOM renderer in the unit runner).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("chat knockout buttons are tonally neutral — neither answer is signposted as the passing one", () => {
  const src = read("ApplyStepControls.tsx");
  // Isolate the ko branch's control block: everything between the `step.type === "ko"`
  // test and the next branch (`step.type === "choice"`).
  const koBlock = src.slice(src.indexOf('step.type === "ko"'), src.indexOf('step.type === "choice"'));
  assert.ok(koBlock.length > 0, "could not locate the ko control block");
  assert.equal(
    (koBlock.match(/\$\{BTN_SECONDARY\}/g) ?? []).length,
    2,
    "both KO buttons compose the SAME shared recipe — neither can be restyled on its own"
  );
  // The rendered classes only — the block's prose deliberately explains the moss ban.
  const classNames = [...koBlock.matchAll(/className=\{`([^`]*)`\}/g)].map((m) => m[1]);
  assert.ok(classNames.length >= 2, "expected a className on each KO button");
  for (const cls of classNames) {
    assert.doesNotMatch(
      cls,
      /moss/,
      "moss (the success tone) must not style a KO answer — it tells the candidate which answer passes the gate"
    );
  }
});

function mainBlocks(src: string): string[] {
  return src.split(/return\s*\(/).slice(1).filter((block) => block.includes("<main"));
}

function closedRoleBlock(src: string): string {
  const start = src.indexOf("if (!isJobOpenForApplications");
  assert.ok(start >= 0, "could not locate the closed-role gate");
  const rest = src.slice(start);
  const end = rest.indexOf("\n  }\n");
  assert.ok(end > 0, "could not find the end of the closed-role block");
  return rest.slice(0, end);
}

test("a closed role renders apply.roleClosed and does not mount the chat or the quick form", () => {
  const pages: { rel: string; form: string }[] = [
    { rel: "page.tsx", form: "ConversationalApply" },
    { rel: "quick/page.tsx", form: "QuickApplyForm" },
  ];
  for (const { rel, form } of pages) {
    const src = read(rel);
    const closed = closedRoleBlock(src);
    assert.match(closed, /t\("roleClosed"\)/, `${rel} closed branch must render apply.roleClosed`);
    assert.match(closed, /status === "draft"\) notFound\(\)/, `${rel} drafts 404`);
    assert.doesNotMatch(closed, new RegExp(form), `${rel} closed branch must not mount ${form}`);
    assert.match(src, new RegExp(`<${form}`), `${rel} open path still mounts ${form}`);
    const mutated = closed.replace("{t(\"roleClosed\")}", `<${form} />`);
    assert.match(mutated, new RegExp(form), `non-vacuity: ${rel} closed branch that mounts ${form} fails this pin`);
  }
});

test("ApplyFollowup buttons compose the shared recipes instead of the banned primary literal", () => {
  const src = read("ApplyFollowup.tsx");
  assert.match(src, /from "@\/app\/_components\/ui\/recipes"/, "ApplyFollowup must import the button recipes");
  assert.match(src, /BTN_PRIMARY/, "Submit is BTN_PRIMARY");
  assert.match(src, /BTN_GHOST/, "Skip is BTN_GHOST");
  assert.doesNotMatch(
    src,
    /bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel/,
    "ApplyFollowup hand-rolls the primary the a11y contract bans"
  );
  assert.doesNotMatch(src, /rounded-md border border-stone-200 bg-white px-\d/, "ApplyFollowup hand-rolls the secondary");
});

test("every apply-page HTML return mounts LanguageSwitcher, including the closed-role card", () => {
  for (const rel of ["page.tsx", "quick/page.tsx"] as const) {
    const src = read(rel);
    const blocks = mainBlocks(src);
    assert.ok(blocks.length >= 2, `${rel} expected closed + open HTML returns`);
    for (const block of blocks) {
      assert.match(block, /LanguageSwitcher/, `${rel} HTML return missing LanguageSwitcher`);
    }
    const closed = blocks.find((b) => b.includes('t("roleClosed")'));
    assert.ok(closed, `${rel} has no closed-role <main>`);
    const without = closed.replace(/<LanguageSwitcher\s*\/>/, "");
    assert.doesNotMatch(
      without,
      /LanguageSwitcher/,
      `non-vacuity: ${rel} closed-role branch without the switcher fails this pin`
    );
  }
});

test("the conversational done card renders the status link the way quick is pinned", () => {
  const card = read("ApplyDoneCard.tsx");
  const view = read("ConversationalApply.tsx");
  assert.match(
    card,
    /done\.result === "accepted" && done\.statusToken/,
    "the done card only links when the outcome is accepted and carries a token"
  );
  assert.match(card, /\/status\/\$\{done\.statusToken\}/, "the done screen links to /status/<token>");
  assert.match(card, /t\("trackStatus"\)/, "the link uses the shared apply.trackStatus label");
  assert.match(view, /<ApplyDoneCard done=\{done\}/, "ConversationalApply still mounts the done card");
  const mutated = card.replace("/status/${done.statusToken}", "/");
  assert.doesNotMatch(
    mutated,
    /\/status\/\$\{done\.statusToken\}/,
    "non-vacuity: a copy of ApplyDoneCard without the href fails this pin"
  );
});

test("a declined outcome is recoverable in place", () => {
  // The done card, the view that wires it, and the submit hook that owns `done`
  // — the three links of the restart chain, since the card was split out.
  const card = read("ApplyDoneCard.tsx");
  const view = read("ConversationalApply.tsx");
  const submit = read("use-apply-submit.ts");
  assert.match(
    card,
    /done\.result === "declined" \? \(/,
    "the done screen forks on a decline to offer a restart"
  );
  assert.match(card, /onClick=\{onRestart\}/, "the decline restart goes through the card's restart callback");
  assert.match(card, /t\("declinedRestartNote"\)/, "the restart is honest that the earlier answers are gone");
  assert.match(
    view,
    /<ApplyDoneCard done=\{done\} onRestart=\{restartConversation\}/,
    "…and that callback is the start-over machinery, not a separate path"
  );
  assert.match(view, /resetSubmit\(\);/, "restartConversation resets the submit state");
  assert.match(submit, /setDone\(null\)/, "resetSubmit clears the done state so the chat actually re-runs");
});

test("the quick form's submit is always live and names what is missing", () => {
  const src = read("quick/QuickApplyForm.tsx");
  assert.match(
    src,
    /disabled=\{submitting\}\r?\n\s*aria-describedby=[^\r\n]*\r?\n\s*className=\{`\$\{BTN_PRIMARY\} mt-5/,
    "submit is disabled only while POSTing"
  );
  assert.doesNotMatch(src, /disabled=\{!ready\}/, "the dead !ready-disabled submit is gone");
  assert.match(src, /firstMissingControlId/, "an incomplete submit resolves the first blocking control");
  assert.match(src, /setIncompleteError\(t\("quick\.incompleteHint"\)\)/, "…and raises a localized hint");
  assert.match(src, /incompleteError \? \(\r?\n\s*<p id="qa-incomplete-error" role="alert"/, "the hint renders as an assertive alert");
  assert.match(src, /el\?\.focus\(\);/, "…and moves focus to that control");
  assert.match(src, /el\?\.scrollIntoView\(/, "…and scrolls it into view (KO gates sit below the fold on a phone)");
  assert.match(src, /jumpTo\(missing\)/, "…through the one shared jump helper");
});

test("every painted apply-page main, including the closed-role card, mounts LanguageSwitcher", () => {
  const src = read("page.tsx");
  const mains = [...src.matchAll(/<main[\s\S]*?<\/main>/g)].map((m) => m[0]);
  assert.ok(mains.length >= 2, "open path and closed-role path each have a main");
  for (const main of mains) {
    assert.match(main, /<LanguageSwitcher \/>/, "a closed-role visit is still escapable into the candidate's language");
  }
  const draftGate = src.slice(src.indexOf('if (status === "draft")'), src.indexOf("return ("));
  assert.match(draftGate, /notFound\(\)/, "drafts 404 rather than painting a card");
  assert.doesNotMatch(draftGate, /LanguageSwitcher/, "the draft notFound path does not mount a switcher");
});

test("the quick form keeps its honeypot and the strict server KO contract untouched", () => {
  const src = read("quick/QuickApplyForm.tsx");
  assert.match(src, /company_url/, "the honeypot field is still posted");
  assert.match(src, /aria-hidden="true"/, "…and still out of the a11y tree");
  // Every KO answer is still gathered client-side before any POST — the server
  // reads an ABSENT key as a fail, so an incomplete form must never reach it.
  assert.match(src, /koSteps\.find\(\(s\) => ko\[s\.id\] === undefined\)/, "an unanswered KO gate still blocks the POST");
});

test("the conversational chat posts the same company_url honeypot as the quick form", () => {
  const view = read("ConversationalApply.tsx");
  const submit = read("use-apply-submit.ts");
  assert.match(view, /name="company_url"/, "the off-screen field is named company_url");
  assert.match(view, /aria-hidden="true"/, "…and is out of the a11y tree");
  assert.match(view, /tabIndex=\{-1\}/, "…and out of the tab order");
  assert.match(view, /autoComplete="off"/, "…and not autofilled as a real company URL");
  assert.doesNotMatch(view, /type="hidden"/, "not type=hidden — bots skip those");
  assert.match(submit, /company_url: companyUrl/, "the final POST body includes company_url");
});

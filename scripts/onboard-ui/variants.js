/*
 * Variant registry for the KP installer wizard.
 *
 * core.js owns every piece of behaviour: the SSE state machine, the card logic,
 * the POSTs. A variant owns only three things:
 *
 *   1. a stylesheet (studio.css / spark.css / guide.css),
 *   2. a copy overlay (phase labels, headings, button words),
 *   3. optional per-element decoration (a hook core calls after it builds a node).
 *
 * That is the whole render seam. Nothing here reads or writes wizard state, so
 * switching variants mid-run cannot lose a session: core keeps the DOM, flips
 * `data-variant`, re-applies copy and re-runs `decorate` over the existing tree.
 */
(() => {
  "use strict";

  /* The Kandidate logomark, inlined from app/landing/_components/KandidateMark.tsx.
     Same three CSS hooks: currentColor badge, --k-fg letter, --k-accent dot. */
  const MARK = `<svg class="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect width="48" height="48" rx="12" fill="currentColor"/>
    <path d="M15 12v24M15.5 25.5 31 12M15.5 24.5 32 36" stroke="var(--k-fg,#fdf8ee)"
          stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="38.5" cy="36" r="3.4" fill="var(--k-accent,#d65a4a)"/>
  </svg>`;

  /* A second drawn mark for Spark: the mascot peers over the stage. Built from
     the same geometry so it reads as the same character, not a second brand. */
  const MASCOT = `<svg class="mascot-svg" viewBox="0 0 120 96" fill="none" aria-hidden="true">
    <ellipse cx="60" cy="82" rx="38" ry="7" fill="var(--shade)"/>
    <rect x="18" y="10" width="84" height="66" rx="20" fill="var(--k-badge)" stroke="var(--k-line)" stroke-width="3"/>
    <path d="M40 28v30M40.5 45 62 28M40.5 43 64 58" stroke="var(--k-fg)" stroke-width="7"
          stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="84" cy="58" r="6" fill="var(--k-accent)"/>
    <path d="M14 34c-6 4-6 14 0 18M106 34c6 4 6 14 0 18" stroke="var(--k-line)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  const VARIANTS = {
    studio: {
      id: "studio",
      label: "Studio",
      css: "studio.css",
      blurb: "Refined editorial light",
      copy: {
        "app.title": "Set up KP",
        "app.sub": "This runs KP's own setup assistant on your machine, on your Claude subscription. Nothing happens without your say-so.",
        "phase.welcome": "Welcome",
        "phase.mode": "Install mode",
        "phase.checks": "System checks",
        "phase.capabilities": "Capabilities",
        "phase.boot": "Boot & verify",
        "phase.voice": "Spoken output",
        "phase.done": "Your install",
      },
      decorate() {},
    },

    spark: {
      id: "spark",
      label: "Spark",
      css: "spark.css",
      blurb: "Sticker-sheet dark",
      copy: {
        "app.title": "Let's wire up KP",
        "app.sub": "KP's setup assistant, running right here on your machine and your own Claude subscription. It asks before it touches anything.",
        "phase.welcome": "Hello there",
        "phase.mode": "How you'll run it",
        "phase.checks": "Kicking the tyres",
        "phase.capabilities": "Pick your powers",
        "phase.boot": "Lighting it up",
        "phase.voice": "Give it a voice",
        "phase.done": "What you've got",
        "checks.title": "What's on this machine",
        "done.title": "Here's your install",
        "activity.title": "The long version",
        "act.always": "Allow all run",
      },
      /* Sticker tilt: alternate the lean so a stack of cards reads as a pile,
         not a column. Deterministic (index-derived), never random — a card must
         not jitter when the stage re-renders. */
      decorate(el, kind, index) {
        if (kind === "card" || kind === "panel") {
          const lean = [-0.7, 0.5, -0.4, 0.8][(index || 0) % 4];
          el.style.setProperty("--tilt", lean + "deg");
        }
      },
    },

    guide: {
      id: "guide",
      label: "Guide",
      css: "guide.css",
      blurb: "One thing at a time",
      copy: {
        "app.title": "Setting up KP",
        "app.sub": "We'll go one question at a time. You can stop at any point — nothing is lost.",
        "phase.welcome": "Getting started",
        "phase.mode": "How will you use it?",
        "phase.checks": "Checking your computer",
        "phase.capabilities": "Choosing features",
        "phase.boot": "Starting the app",
        "phase.voice": "Testing the voice",
        "phase.done": "All done",
        "checks.title": "Checking your computer",
        "checks.note": "These are things KP needs. A red row means something is missing — the assistant will tell you how to fix it.",
        "boot.title": "Starting KP",
        "voice.title": "Should KP speak out loud?",
        "voice.note": "Press play to hear each option. If you don't need spoken output, skip this — you can turn it on later.",
        "done.title": "KP is set up",
        "done.note": "Nothing here is permanent — any one of these can be set up again later, on its own.",
        "act.allow": "Yes, go ahead",
        "act.deny": "No, skip this",
        "act.always": "Yes — and stop asking this time",
        "act.continue": "Continue",
        "act.skip": "Skip for now",
        "perm.title": "KP setup would like to run a command",
        "activity.title": "Technical details",
        "receipts.title": "What you've answered so far",
      },
      decorate() {},
    },
  };

  window.KP_VARIANTS = VARIANTS;
  window.KP_MARK = MARK;
  window.KP_MASCOT = MASCOT;
})();

/*
 * Every string the studio says, in one place.
 *
 * ENGLISH ONLY, deliberately, and only for v1. The standalone installer this
 * page elevates is English-only too, and the concept note
 * (docs/concepts/onboarding-in-app.md) puts the four catalogs in increment 3 —
 * so shipping half-translated keys now would mean four catalog entries per line
 * for copy that is still moving. Collecting them here instead makes that
 * increment a mechanical lift: every literal is already named, already
 * exhaustive, and already outside the JSX.
 *
 * (It also keeps them out of `i18next/no-literal-string`'s way honestly rather
 * than by disable comments — the rule reads JSX text nodes, and a named constant
 * is not one. Same shape the landing's Wordmark uses.)
 *
 * The register is the setup wizard's, read off SetupOnboardingWizard: plain
 * second person, marketing warmth at the opening, functional in the middle,
 * flatly honest at the end. Nothing here assumes the reader knows what a relay,
 * a provider or an env file is.
 */

export const COPY = {
  /* the page itself */
  title: "Setting up KP",
  sub: "One question at a time. You can stop at any point — nothing already written is lost.",
  brand: "KandiDate",

  /* the empty state — no fragment, or nothing answering */
  emptyEyebrow: "Onboarding studio",
  emptyTitle: "No setup session attached",
  emptyBody:
    "This page is the app-native face of the installer. The installer itself runs in your terminal, outside the app, so it can keep working even while the app is restarting.",
  emptyHowTitle: "Start it from the repository folder",
  emptyHowNote:
    "The command prints a link with a one-time token in it. Open that link and it hands you straight back here.",
  emptyRetry: "Try connecting again",
  lostTitle: "The installer stopped answering",
  lostBody:
    "The setup session on this port is not responding. It may have been closed in the terminal, or the machine may have gone to sleep. Starting it again gives you a fresh link.",
  deniedTitle: "This link is wrong or has expired",
  deniedBody:
    "The installer is running and answered — it just refused the token in this link. Each run mints its own, so a link from an earlier session will not open this one. Start the installer again and use the link it prints.",

  /* connection */
  connConnecting: "Connecting to the installer…",
  connOpen: "Connected",
  connRetrying: "Reconnecting…",
  connLost: "Not connected",

  /* controls */
  start: "Start setting up",
  startAgain: "Start again",
  stop: "Stop",
  stopping: "Stopping…",
  advanced: "Other options",
  runOnly: "Set up only",
  run: "Run just this",
  advNote:
    "A check run looks at your computer and tells you what it found — it asks nothing and changes nothing. Or pick one feature to set up on its own.",

  /* rail */
  railTitle: "Your plan",
  railPending: "…then a plan, once I've looked",

  /* fallback phase labels, used when the agent declared no plan */
  phaseAssess: "Having a look",
  phaseWelcome: "Getting started",
  phaseMode: "How will you use it?",
  phaseChecks: "Checking your computer",
  phaseCapabilities: "Choosing features",
  phaseBoot: "Starting the app",
  phaseVoice: "Testing the voice",
  phaseDone: "All done",

  /* status / stage */
  ready: "Ready when you are.",
  enforceOn: "Every command asks before it runs",
  unrequestedTitle: "Ran without asking",

  /* probes */
  assessTitle: "Having a look at your computer…",
  assessNote: "Nothing is being changed. This is just a look at what is already installed.",
  checksTitle: "Checking your computer",
  checksNote:
    "These are the things KP needs. A red row means something is missing — the assistant will say how to fix it.",
  assessMore: "Show me all the details",
  assessLess: "Hide the details",

  /* cards */
  cardQueue: "more to answer after this",
  continue: "Continue",
  otherOption: "Something else…",
  otherPlaceholder: "Type your own answer",
  secretKicker: "Secure value",
  secretNote:
    "Typed here, written straight into .env.local. It is never shown back, never logged, and never reaches the assistant — the assistant is only told whether a value is set.",
  secretAlreadySet: "This variable already has a value in your env file.",
  save: "Save",
  skip: "Skip for now",
  keep: "Keep current",
  replace: "Replace",
  permTitle: "KP setup would like to run a command",
  allow: "Yes, go ahead",
  deny: "No, skip this",

  /* resolutions — how a settled card reads on the stage */
  resAllowed: "Allowed.",
  resDenied: "Skipped — nothing ran.",
  resWithdrawn: "Withdrawn — setup was stopped.",
  resAnswered: "Answered.",
  resSettled: "Settled.",
  resSavedSuffix: " saved to .env.local.",
  resKeptSuffix: " left as it is.",
  resSkippedSuffix: " skipped.",
  receiptSet: "set",
  receiptKept: "kept current",
  receiptSkipped: "skipped",
  /* The other face answered it. The standalone page stays open behind the
     hand-off tab, so this is an ordinary thing to happen, not an error. */
  resolvedElsewhere: "Answered in the installer's own window.",
  rejoined: "Rejoined a setup session that is already running.",

  /* boot */
  bootTitle: "Starting KP",
  bootChecking: "Checking",
  bootOpen: "Open KP",

  /* voice */
  voiceTitle: "Should KP speak out loud?",
  voiceNote:
    "Press play to hear each option. If you do not need spoken output, skip this — you can turn it on later.",
  voiceLoading: "Asking the app which speech engines are installed…",
  voiceLocked: "This install is locked to:",
  voiceNone:
    "The app reports no speech engines at all — spoken output stays off, and the app answers an honest 503 when asked to speak.",
  voice401:
    "The app is password-protected, so this page cannot probe its speech engines through the installer. That is the auth working as designed — open KP and audition the voices inside it (Interview lab → compare panel).",
  voicePlay: "Play sample",
  voiceDefault: "Make this the default",
  voiceSkip: "Skip spoken output",
  voiceSkipped: "Skipped",
  voiceChosen: "This is now the default.",
  voiceCurrent: "Currently the default.",
  voiceSpeaks: "Speaks:",

  /* matrix / reward */
  doneTitle: "KP is set up",
  doneNote: "Nothing here is permanent — any one of these can be set up again later, on its own.",
  rewardTitle: "You're already set up",
  rewardNote:
    "Your computer already had everything it needed, so there was nothing to ask you. Here is what KP can do.",
  addonTitle: "Would you like to add anything else?",
  addonPrefix: "Set up",
  addonAsked: "Asked for",
  handoffTitle: "Next: make it yours",
  handoffBody:
    "Capability setup is done. The workspace has its own short first-run flow — company, team, pipeline — and that is where KP stops being an install and starts being yours.",
  handoffCta: "Open the workspace",
  restartNote:
    "Values written during this session reach the app only after it restarts. If something still reads as missing inside KP, restart the server before believing it.",

  /* receipts + activity */
  receiptsTitle: "What you've answered so far",
  activityTitle: "Technical details",
  activityEmpty: "Nothing yet.",
  activityYou: "You: ",

  /* terminal */
  endedDone: "Setup finished. Everything above is what this install can actually do.",
  endedStopped:
    "Stopped at your request. Nothing further was run; whatever was already written to .env.local is still there.",
  endedErrorPrefix: "The setup session ended with exit code",
  titleDone: "Setup finished",
  titleStopped: "Setup stopped",
  titleError: "Setup hit an error",
} as const;

/** The label for a fallback phase id — the plan's own labels always win. */
export const FALLBACK_PHASE_LABEL: Record<string, string> = {
  assess: COPY.phaseAssess,
  welcome: COPY.phaseWelcome,
  mode: COPY.phaseMode,
  checks: COPY.phaseChecks,
  capabilities: COPY.phaseCapabilities,
  boot: COPY.phaseBoot,
  voice: COPY.phaseVoice,
  done: COPY.phaseDone,
};

/** What the host settled on its own, in words. */
export const NOTICE_LABEL: Record<string, string> = {
  "auto-allowed": "Allowed automatically",
  "repeat-allowed": "Allowed again",
  "unrequested-run": "Ran without asking",
  other: "Note",
};

/** The single-group runs the advanced panel offers, mirroring the installer's. */
export const RUN_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "check", label: "Check only — a doctor pass, no questions" },
  { value: "llm-engine", label: "LLM engine" },
  { value: "gemini", label: "CV analysis (Gemini)" },
  { value: "voice", label: "Voice interviews" },
  { value: "tts", label: "Spoken output" },
  { value: "github-signal", label: "GitHub signal" },
  { value: "kp-secret", label: "Key encryption" },
  { value: "operator-auth", label: "Operator password" },
  { value: "comms", label: "Email sending" },
  { value: "calendar", label: "Calendar" },
  { value: "edge", label: "Edge relay" },
  { value: "observability", label: "Observability" },
];

/** The command that starts the installer, quoted in the empty state. */
export const START_COMMAND = "npm run onboard:ui";

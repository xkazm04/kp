/*
 * KP installer wizard — the whole page.
 *
 * ONE state machine, ONE SSE reader, ONE set of card logic, ONE design. The
 * three-variant prototyping rig (studio/spark/guide + a switcher + a copy
 * overlay) served its purpose and is gone: the operator picked Guide as the
 * baseline and Spark's left rail as the one thing worth carrying across, so
 * this file now speaks Guide's register directly and wizard.css skins it.
 *
 * The layout that survived: a calm left rail carrying the plan (labels, not
 * dots — dots cannot say "Capability keys"), one centred card at a time on the
 * stage, everything answered shrinking into the receipt list.
 *
 * The primary surface is "what is happening + what I need from you". Agent
 * prose is NOT the UI: every {type:"narration"} goes to the Activity drawer,
 * closed by default, and the stage carries only the status line, live decision
 * cards and the phase panels.
 */
(() => {
  "use strict";

  const TOKEN = new URLSearchParams(location.search).get("t") || "";

  /* The Kandidate logomark, inlined from app/landing/_components/KandidateMark.tsx.
     Three CSS hooks: currentColor badge, --k-fg letter, --k-accent dot. */
  const MARK = `<svg class="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect width="48" height="48" rx="12" fill="currentColor"/>
    <path d="M15 12v24M15.5 25.5 31 12M15.5 24.5 32 36" stroke="var(--k-fg,#fdf8ee)"
          stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="38.5" cy="36" r="3.4" fill="var(--k-accent,#d65a4a)"/>
  </svg>`;

  /* ---------------------------------------------------------------- phases */
  /* v0.3: the step plan is DECLARED by the agent ({type:"plan"}) once it has
     assessed the machine and the operator has picked a journey. Until then — and
     for the runs that never declare one (a doctor pass, a single-group run) —
     this fixed list is the fallback stepper. `assess` leads it because assess is
     the one phase that always arrives BEFORE any plan.

     Driven by {type:"phase"} events ONLY — never by sniffing prose. A phase we
     have not seen stays "ahead"; the list is ordered, so an out-of-order event
     still lights everything before it. */
  const FALLBACK_PHASES = ["assess", "welcome", "mode", "checks", "capabilities", "boot", "voice", "done"];
  const PHASES = FALLBACK_PHASES; // kept under the old name for the mock harness

  /* One voice, Guide's: plain words, second person, nothing that assumes the
     reader knows what a relay or a provider is. Written through `data-copy`
     markers rather than typed into the markup so a wording change is one edit
     here and not a hunt through the builders. */
  const COPY = {
    "app.title": "Setting up KP",
    "app.sub": "We'll go one question at a time. You can stop at any point — nothing is lost.",
    "rail.title": "Your plan",
    "phase.assess": "Having a look",
    "phase.__pending": "…then a plan, once I've looked",
    "phase.welcome": "Getting started",
    "phase.mode": "How will you use it?",
    "phase.checks": "Checking your computer",
    "phase.capabilities": "Choosing features",
    "phase.boot": "Starting the app",
    "phase.voice": "Testing the voice",
    "phase.done": "All done",
    "checks.title": "Checking your computer",
    "checks.note": "These are things KP needs. A red row means something is missing — the assistant will tell you how to fix it.",
    "assess.title": "Having a look at your computer…",
    "assess.note": "Nothing is being changed. This is just a look at what is already installed.",
    "assess.more": "Show me all the details",
    "assess.less": "Hide the details",
    "boot.title": "Starting KP",
    "voice.title": "Should KP speak out loud?",
    "voice.note": "Press play to hear each option. If you don't need spoken output, skip this — you can turn it on later.",
    "done.title": "KP is set up",
    "done.note": "Nothing here is permanent — any one of these can be set up again later, on its own.",
    "receipts.title": "What you've answered so far",
    "activity.title": "Technical details",
    "act.allow": "Yes, go ahead",
    "act.deny": "No, skip this",
    "act.continue": "Continue",
    "act.save": "Save",
    "act.skip": "Skip for now",
    "act.keep": "Keep current",
    "act.replace": "Replace",
    "act.start": "Start setting up",
    "act.advanced": "Other options",
    "act.run": "Run just this",
    "perm.title": "KP setup would like to run a command",
    "adv.note": "A check run looks at your computer and tells you what it found — it asks nothing and changes nothing. Or pick one feature to set up on its own.",
    "adv.label": "Set up only",
    "reward.title": "You're already set up",
    "reward.note": "Your computer already had everything it needed, so there was nothing to ask you. Here is what KP can do.",
    "addon.title": "Would you like to add anything else?",
    "enforce.on": "Commands ask before they run",
  };

  /* The quiet lines the host writes when its own policy decided something. Each
     is a fact the operator is entitled to but must not be interrupted by, so
     they live in the Activity drawer — except `unrequested-run`, which is the
     one that means the asking contract slipped and gets a visible strip. */
  const NOTICE_LABELS = {
    "auto-allowed": "Allowed automatically",
    "repeat-allowed": "Allowed again",
    "unrequested-run": "Ran without asking",
  };

  /* ----------------------------------------------------------------- state */
  const state = {
    started: false,
    running: false,
    finished: null, // {kind:"done"|"stopped"|"error", text}
    stopPending: false,
    phase: null,
    phaseSeen: new Set(),
    plan: null, // [{id,label}] once the agent declares one; null = fallback stepper
    lastStep: null, // index of the last step the phase stream actually matched
    assessing: false,
    assessSummary: null,
    sawWork: false, // a secret or permission card was shown -> not a short-circuit
    status: "",
    probes: new Map(), // name -> {status, detail}
    cards: [], // live decision cards, newest last
    receipts: [], // {label, value}
    narration: [], // markdown blocks
    unread: 0,
    drawerOpen: false,
    notices: [], // {kind, text}
    app: null, // {port, alive}
    /* The highest `seq` this page has processed. Every event carries one, and
       so does every entry in the `hello` replay block — which is what makes an
       EventSource auto-reconnect idempotent: the second `hello` replays state
       this page already rendered, and each entry is dropped on its own seq
       rather than on a guess about whether this is a first connect. */
    maxSeq: 0,
    selfPort: null, // the wizard server's own port, from hello.self
    studio: false, // hello.studio — is the in-app studio on offer at all?
    studioOffered: false, // the hand-off is drawn once, not on every health poll
    tts: null, // {loading|error|providers|preferred|allowed|chosen|skipped}
    matrix: null, // the capability matrix markdown, once it has arrived
  };

  /* --------------------------------------------------------------- helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function copy(key) {
    return COPY[key] || key;
  }
  /* `data-copy` is how a string declares which entry in COPY it is. It is set
     here (and read once at boot for the static shell) so that a label which
     changes state — assess.more/assess.less — swaps by key, not by literal. */
  function setCopy(node, key) {
    node.dataset.copy = key;
    node.textContent = copy(key);
    return node;
  }
  function applyCopy(root) {
    (root || document).querySelectorAll("[data-copy]").forEach((n) => {
      n.textContent = copy(n.dataset.copy);
    });
  }

  /* ------------------------------------------------------ tiny markdown */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  }
  function md(src) {
    const lines = String(src == null ? "" : src).replace(/\r/g, "").split("\n");
    let out = "", i = 0, listType = null;
    const closeList = () => { if (listType) { out += `</${listType}>`; listType = null; } };
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out += `<pre>${esc(buf.join("\n"))}</pre>`;
        continue;
      }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeList();
        const t = readTable(lines, i);
        i = t.next;
        out += "<table><thead><tr>" + t.head.map((h) => `<th>${inline(h)}</th>`).join("") +
          "</tr></thead><tbody>" +
          t.rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>";
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { closeList(); out += `<h4>${inline(h[2])}</h4>`; i++; continue; }
      const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (li) {
        const want = /^\d/.test(li[1]) ? "ol" : "ul";
        if (listType !== want) { closeList(); out += `<${want}>`; listType = want; }
        out += `<li>${inline(li[2])}</li>`; i++; continue;
      }
      if (!line.trim()) { closeList(); i++; continue; }
      closeList();
      out += `<p>${inline(line)}</p>`; i++;
    }
    closeList();
    return out;
  }
  function readTable(lines, i) {
    const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = cells(lines[i]);
    let j = i + 2;
    const rows = [];
    while (j < lines.length && /^\s*\|/.test(lines[j])) rows.push(cells(lines[j++]));
    return { head, rows, next: j };
  }

  /* -------------------------------------------------------------- network */
  async function post(path, body) {
    try {
      const res = await fetch(path + "?t=" + encodeURIComponent(TOKEN), {
        method: "POST",
        headers: { "content-type": "application/json", "x-onboard-token": TOKEN },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (json && json.error) setStatus(json.error, true);
      return json || {};
    } catch (e) {
      setStatus("Could not reach the installer: " + e.message, true);
      return { error: String(e.message) };
    }
  }
  async function getJSON(path) {
    const res = await fetch(path + (path.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(TOKEN), {
      headers: { "x-onboard-token": TOKEN },
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json };
  }

  /* =======================================================================
     DOM skeleton — built once, never rebuilt.

     Both steppers exist in the DOM at all times: the rail carries the plan with
     its labels, and the dots are what is left of it once the viewport is too
     narrow for a rail. CSS picks one; nothing here re-renders on a resize.
     ======================================================================= */
  const root = el("div", "wz");
  root.innerHTML = `
    <header class="wz-top">
      <div class="wz-brand">
        <span class="wz-mark"></span>
        <span class="wz-brandtext">
          <span class="wz-title" data-copy="app.title"></span>
          <span class="wz-sub" data-copy="app.sub"></span>
        </span>
      </div>
      <div class="wz-controls">
        <!-- v0.3: ONE way in. The old run-mode picker asked the operator to
             classify their own machine before anything had looked at it — the
             decision the agent now makes for them, and then puts back to them as
             a journey card with the findings attached. Everything else here is
             the escape hatch, not the road. -->
        <button class="btn btn-primary btn-start" id="wz-start" data-copy="act.start"></button>
        <button class="btn btn-quiet" id="wz-stop">Stop</button>
        <button class="btn btn-quiet wz-adv-toggle" id="wz-adv" aria-expanded="false"
                aria-controls="wz-adv-panel" data-copy="act.advanced"></button>
      </div>
      <div class="wz-adv-panel" id="wz-adv-panel" hidden>
        <label class="wz-runwrap">
          <span class="wz-runlabel" data-copy="adv.label"></span>
          <select class="wz-run" id="wz-run">
            <option value="check">Check only — a doctor pass, no questions</option>
            <option value="llm-engine">LLM engine</option>
            <option value="gemini">CV analysis (Gemini)</option>
            <option value="voice">Voice interviews</option>
            <option value="tts">Spoken output</option>
            <option value="github-signal">GitHub signal</option>
            <option value="kp-secret">Key encryption</option>
            <option value="operator-auth">Operator password</option>
            <option value="comms">Email sending</option>
            <option value="calendar">Calendar</option>
            <option value="edge">Edge relay</option>
            <option value="observability">Observability</option>
          </select>
        </label>
        <button class="btn btn-outline" id="wz-runbtn" data-copy="act.run"></button>
        <p class="wz-adv-note" data-copy="adv.note"></p>
      </div>
    </header>

    <nav class="wz-rail" aria-label="Setup progress">
      <div class="wz-railtop">
        <span class="wz-mark"></span>
        <span class="wz-railname" data-copy="app.title"></span>
      </div>
      <p class="wz-raileyebrow" data-copy="rail.title"></p>
      <ol class="wz-steps" id="wz-steps"></ol>
      <div class="wz-railfoot">
        <div class="wz-meta" id="wz-meta" hidden></div>
      </div>
    </nav>

    <main class="wz-main">
      <div class="wz-dots" id="wz-dots" aria-hidden="true"></div>
      <div class="wz-statusbar">
        <span class="wz-pulse" aria-hidden="true"></span>
        <p class="wz-status" id="wz-status" role="status" aria-live="polite">Ready when you are.</p>
      </div>
      <!-- The host's enforcement posture, shown only when it actually says what
           it is. See applyEnforcement below for why an absent field is silent. -->
      <p class="wz-enforce" id="wz-enforce" hidden></p>
      <div class="wz-stage" id="wz-stage">
        <section class="wz-warnings" id="wz-warnings"></section>
        <section class="wz-asks" id="wz-asks"></section>
        <section class="wz-panels" id="wz-panels"></section>
        <section class="wz-receipts" id="wz-receipts" hidden>
          <h3 class="wz-receipts-h" data-copy="receipts.title"></h3>
          <ul id="wz-receipt-list"></ul>
        </section>
      </div>
      <form class="wz-say" id="wz-say">
        <input type="text" id="wz-msg" placeholder="Tell the assistant something…" autocomplete="off">
        <button class="btn btn-quiet" type="submit">Send</button>
      </form>
    </main>

    <aside class="wz-activity" id="wz-activity">
      <button class="wz-activity-toggle" id="wz-activity-toggle" aria-expanded="false">
        <span data-copy="activity.title"></span>
        <span class="wz-badge" id="wz-unread" hidden>0</span>
        <span class="wz-caret" aria-hidden="true">▾</span>
      </button>
      <div class="wz-activity-body" id="wz-activity-body" hidden></div>
    </aside>
  `;
  document.body.appendChild(root);

  // Two marks in the DOM, never two on screen: the rail carries it while there
  // is a rail, and the header brand takes over below the rail's breakpoint.
  root.querySelectorAll(".wz-mark").forEach((n) => { n.innerHTML = MARK; });
  applyCopy(root);

  const asksEl = $("#wz-asks", root);
  const warnEl = $("#wz-warnings", root);
  const panelsEl = $("#wz-panels", root);
  const stepsEl = $("#wz-steps", root);
  const dotsEl = $("#wz-dots", root);
  const statusEl = $("#wz-status", root);
  const activityBody = $("#wz-activity-body", root);
  const unreadEl = $("#wz-unread", root);
  const startBtn = $("#wz-start", root);
  const stopBtn = $("#wz-stop", root);
  const runSel = $("#wz-run", root);
  const runBtn = $("#wz-runbtn", root);
  const advToggle = $("#wz-adv", root);
  const advPanel = $("#wz-adv-panel", root);

  /* -------------------------------------------------------------- stepper */
  /* The step list is the plan when the agent declared one, and the fixed
     fallback otherwise. Both are the same shape — {id, label} — so exactly one
     renderer exists; a plan-less session is not a special case, it is a
     different list. A fallback step carries no label of its own — its wording
     is this page's (copy("phase.<id>")) — while a plan step's label came from
     the agent and is used verbatim. */
  function stepList() {
    if (state.plan && state.plan.length) return state.plan;
    // Recon-first means the rail must not promise a pipeline before one has
    // been decided. While the assessment is the live phase and no plan has
    // arrived, the honest rail is "I am looking, and what follows is next" —
    // showing the full fixed list here is precisely the "it just walked Full
    // setup" complaint that v0.3 exists to answer. The fallback list is for the
    // runs that MOVE PAST assess without ever declaring a plan.
    if (state.phase === "assess") {
      return [{ id: "assess", label: null }, { id: "__pending", label: null, pending: true }];
    }
    return FALLBACK_PHASES.map((id) => ({ id, label: null }));
  }
  function stepLabel(s) { return s.label != null ? s.label : copy("phase." + s.id); }

  function renderSteps() {
    const list = stepList();
    let cur = list.findIndex((s) => s.id === state.phase);
    if (cur < 0) {
      // The live phase is not one of the planned steps — `assess` between the
      // plan landing and the journey being answered is the everyday case. Hold
      // the last step that DID match rather than blanking the rail.
      cur = state.lastStep != null ? state.lastStep : (state.plan ? 0 : -1);
    }
    stepsEl.innerHTML = "";
    dotsEl.innerHTML = "";
    list.forEach((s, i) => {
      const done = state.phaseSeen.has(s.id) && i < cur;
      const active = i === cur;
      const li = el("li", "wz-step" + (done ? " is-done" : "") + (active ? " is-active" : "") +
        (s.isNew ? " is-new" : "") + (s.pending ? " is-pending" : ""));
      li.dataset.step = s.id;
      li.innerHTML =
        `<span class="wz-stepdot">${s.pending ? "?" : done ? "✓" : i + 1}</span>` +
        `<span class="wz-steplabel">${esc(stepLabel(s))}</span>`;
      if (active) li.setAttribute("aria-current", "step");
      stepsEl.appendChild(li);

      const d = el("span", "wz-dot" + (done ? " is-done" : "") + (active ? " is-active" : "") +
        (s.isNew ? " is-new" : "") + (s.pending ? " is-pending" : ""));
      d.dataset.step = s.id;
      dotsEl.appendChild(d);
    });
    dotsEl.setAttribute("aria-hidden", "true");
    dotsEl.title = cur >= 0 && list[cur] ? stepLabel(list[cur]) : "";
  }

  /* A plan may be declared once, or re-declared mid-session when the operator
     adds another group at the end. A re-plan REBUILDS the rail but never resets
     it: `phaseSeen` is keyed on step ids, so every id that survives keeps its
     tick and only the genuinely new steps arrive unvisited. */
  function applyPlan(rawSteps) {
    const list = (Array.isArray(rawSteps) ? rawSteps : [])
      .map((s) => (typeof s === "string" ? { id: s, label: s } : s))
      .filter((s) => s && s.id != null && s.id !== "")
      .map((s) => ({ id: String(s.id), label: String(s.label == null ? s.id : s.label) }));
    if (!list.length) return; // an empty plan is not a plan; keep what we have
    const before = new Set((state.plan || []).map((s) => s.id));
    if (state.plan) list.forEach((s) => { if (!before.has(s.id)) s.isNew = true; });
    state.plan = list;
    const idx = list.findIndex((s) => s.id === state.phase);
    state.lastStep = idx >= 0 ? idx : state.lastStep;
    if (state.lastStep != null && state.lastStep >= list.length) state.lastStep = list.length - 1;
    root.dataset.planned = "true";
    renderSteps();
  }

  /* ---------------------------------------------------------- enforcement */
  /* {mode, skipFlagBlocked} on `hello`. The reassurance is shown ONLY when the
     host affirms that the skip-permissions escape hatch is blocked — an absent
     field is an older host, and a promise this page cannot verify is worse than
     silence on a screen whose whole pitch is "it asks before it writes". */
  function applyEnforcement(enf) {
    const box = $("#wz-enforce", root);
    const on = !!(enf && enf.skipFlagBlocked);
    box.hidden = !on;
    if (!on) return;
    box.textContent = copy("enforce.on");
    if (enf.mode) box.title = "Permission mode: " + String(enf.mode);
  }

  /* --------------------------------------------------------------- status */
  function setStatus(text, isErr) {
    state.status = text;
    statusEl.textContent = text;
    statusEl.classList.toggle("is-err", !!isErr);
  }

  /* ------------------------------------------------------------- activity */
  /* Anything appended to the drawer while it is shut counts against the badge —
     narration and notices alike. A notice the operator never saw a count for is
     a policy decision made silently, which is the whole thing notices exist to
     prevent. */
  function afterAppend() {
    if (state.drawerOpen) { activityBody.scrollTop = activityBody.scrollHeight; return; }
    state.unread += 1;
    unreadEl.hidden = false;
    unreadEl.textContent = String(state.unread);
  }
  function pushNarration(mdText) {
    state.narration.push(mdText);
    const block = el("div", "wz-narr");
    block.innerHTML = md(mdText);
    activityBody.appendChild(block);
    afterAppend();
  }
  /* A host-policy line: one quiet row, never a card, never a status takeover.
     The kind is kept on the node so the drawer can tint the one that matters. */
  function pushNotice(ev) {
    const kind = String(ev.kind || "notice");
    const text = String(ev.text || "");
    state.notices.push({ kind, text });
    const line = el("p", "wz-notice");
    line.dataset.kind = kind;
    line.innerHTML =
      `<span class="wz-notice-k">${esc(NOTICE_LABELS[kind] || kind)}</span>` +
      `<span class="wz-notice-t">${esc(text)}</span>`;
    activityBody.appendChild(line);
    afterAppend();
    // A command that ran without being offered is the one notice the operator
    // must not have to open a drawer to find. Amber, on the stage, once per
    // occurrence — visible, but not a modal and not red: nothing is broken, the
    // asking contract simply did not hold for that command.
    if (kind === "unrequested-run") stageWarning(text);
  }
  function stageWarning(text) {
    const row = el("div", "wz-warn");
    row.setAttribute("role", "status");
    row.innerHTML =
      `<span class="wz-warn-glyph" aria-hidden="true">!</span>` +
      `<span class="wz-warn-t"><strong>${esc(NOTICE_LABELS["unrequested-run"])}.</strong> ${esc(text)}</span>`;
    warnEl.appendChild(row);
  }
  $("#wz-activity-toggle", root).onclick = () => {
    state.drawerOpen = !state.drawerOpen;
    activityBody.hidden = !state.drawerOpen;
    $("#wz-activity", root).classList.toggle("is-open", state.drawerOpen);
    $("#wz-activity-toggle", root).setAttribute("aria-expanded", String(state.drawerOpen));
    if (state.drawerOpen) {
      state.unread = 0;
      unreadEl.hidden = true;
      activityBody.scrollTop = activityBody.scrollHeight;
    }
  };

  /* -------------------------------------------------------------- receipts */
  function addReceipt(label, value) {
    state.receipts.push({ label, value });
    const list = $("#wz-receipt-list", root);
    const li = el("li", "wz-receipt");
    li.innerHTML = `<span class="wz-receipt-k">${esc(label)}</span><span class="wz-receipt-v">${esc(value)}</span>`;
    list.appendChild(li);
    $("#wz-receipts", root).hidden = false;
  }

  /* ---------------------------------------------------------------- cards */
  /* Cards are addressed by their server id. The secret flow needs it: when a
     "save" loses a race with a value that appeared in the file after the card
     was drawn, the server answers {state:"exists"} and RE-EMITS the same id with
     alreadySet:true. That must land as the same card changing its mind, not as a
     second card appearing below the first. */
  const cardsById = new Map();
  function mountCard(node, id) {
    node.classList.add("card");
    if (id != null) {
      node.dataset.cardId = String(id);
      const prev = cardsById.get(String(id));
      if (prev && prev.parentElement === asksEl) {
        asksEl.replaceChild(node, prev);
        cardsById.set(String(id), node);
        focusCard(node);
        return node;
      }
      cardsById.set(String(id), node);
    }
    asksEl.appendChild(node);
    focusCard(node);
    return node;
  }
  // One card at a time; CSS does the hiding, this keeps focus sane.
  function focusCard(node) {
    requestAnimationFrame(() => {
      node.scrollIntoView({ block: "nearest", behavior: prefersReduced() ? "auto" : "smooth" });
      const first = node.querySelector("input, button");
      if (first) first.focus({ preventScroll: true });
    });
  }
  function settleCard(node, text) {
    node.classList.add("is-settled");
    node.querySelectorAll("input, button, select, textarea").forEach((n) => (n.disabled = true));
    // A disabled, empty password box left on a finished card is noise that looks
    // like an unfinished field. The resolution line is the whole record.
    node.querySelectorAll(".field").forEach((n) => (n.hidden = true));
    const foot = node.querySelector(".card-actions");
    if (foot) foot.innerHTML = `<span class="card-resolution">${esc(text)}</span>`;
  }
  function prefersReduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function cardShell(kind, kicker, title) {
    const node = el("article", "card card-" + kind);
    node.innerHTML =
      `<div class="card-kicker">${esc(kicker)}</div>` +
      `<h3 class="card-title">${esc(title)}</h3>` +
      `<div class="card-body"></div>` +
      `<div class="card-actions"></div>`;
    return node;
  }
  function actionBtn(node, cls, copyKey, fallback, fn) {
    const b = el("button", "btn " + cls);
    b.type = "button";
    if (copyKey) setCopy(b, copyKey); else b.textContent = fallback;
    b.onclick = fn;
    node.querySelector(".card-actions").appendChild(b);
    return b;
  }

  /* -- the assessment summary -------------------------------------------- */
  /* When the journey card lands, the live probe list stops being the subject and
     becomes evidence for the decision above it. It collapses to one honest line
     plus the rows that are NOT fine — the ones the journey options are about —
     with the full list one click away. The line is derived from the probes the
     page actually received; if the agent sends its own `summary` on the journey
     card, that wording wins, because it can say things a status count cannot
     ("app runs"). */
  function assessmentHeadline(rows) {
    const ok = rows.filter((r) => r.status === "ok").length;
    const bad = rows.filter((r) => r.status === "fail").length;
    const warn = rows.filter((r) => r.status === "warn").length;
    const parts = [`${ok} of ${rows.length} checks already good`];
    if (bad) parts.push(`${bad} not working`);
    if (warn) parts.push(`${warn} worth a look`);
    return "Found: " + parts.join(" · ");
  }
  function collapseAssessment(summaryText) {
    state.assessing = false;
    const rows = [...state.probes.entries()].map(([name, v]) =>
      ({ name, status: String(v.status || "running"), detail: v.detail || "" }));
    const p = panels.checks;
    if (p) { p.hidden = true; dressProbePanel(); }
    if (!rows.length || state.assessSummary) return;

    const node = el("section", "assess-summary");
    const head = el("p", "assess-line",
      esc(summaryText || assessmentHeadline(rows)));
    node.appendChild(head);

    const notable = rows.filter((r) => r.status !== "ok");
    if (notable.length) {
      const strip = el("ul", "assess-strip");
      notable.forEach((r) => {
        const li = el("li", "assess-item");
        li.dataset.state = r.status;
        li.innerHTML =
          `<span class="probe-glyph" aria-hidden="true">${glyphFor(r.status)}</span>` +
          `<span class="assess-item-n">${esc(r.name)}</span>` +
          (r.detail ? `<span class="assess-item-d">${esc(r.detail)}</span>` : "");
        strip.appendChild(li);
      });
      node.appendChild(strip);
    }

    const all = el("ul", "probe-list assess-all");
    all.hidden = true;
    rows.forEach((r) => {
      const li = el("li", "probe");
      li.dataset.probe = r.name;
      li.dataset.state = r.status;
      li.innerHTML =
        `<span class="probe-glyph" aria-hidden="true">${glyphFor(r.status)}</span>` +
        `<span class="probe-name">${esc(r.name)}</span>` +
        `<span class="probe-detail">${esc(r.detail)}</span>` +
        `<span class="probe-state chip chip-${r.status}">${esc(r.status)}</span>`;
      all.appendChild(li);
    });
    const more = el("button", "btn btn-quiet assess-more");
    more.type = "button";
    setCopy(more, "assess.more");
    more.onclick = () => {
      all.hidden = !all.hidden;
      setCopy(more, all.hidden ? "assess.more" : "assess.less");
    };
    node.appendChild(more);
    node.appendChild(all);

    asksEl.appendChild(node);
    state.assessSummary = node;
    return node;
  }
  function isJourney(ev) {
    return String(ev.header || "").trim().toLowerCase() === "journey";
  }

  /* -- question ---------------------------------------------------------- */
  function questionCard(ev) {
    // The journey card is the pivot of the whole run: it is where the silent
    // assessment turns into a proposal. Everything found so far collapses into
    // the line above it, and the card itself is marked so each variant can give
    // it the weight it deserves.
    if (isJourney(ev)) collapseAssessment(typeof ev.summary === "string" ? ev.summary : null);
    const node = cardShell("question", ev.header || "Choice", ev.question || "");
    if (isJourney(ev)) node.classList.add("card-journey");
    const body = node.querySelector(".card-body");
    const multi = !!ev.multiSelect;
    const type = multi ? "checkbox" : "radio";
    const name = "q" + Math.random().toString(36).slice(2, 8);
    const opts = Array.isArray(ev.options) ? ev.options : [];
    opts.forEach((o, i) => {
      const label = el("label", "opt");
      label.innerHTML =
        `<input type="${type}" name="${name}" value="${esc(o.label)}"${!multi && i === 0 ? " checked" : ""}>` +
        `<span class="opt-text"><span class="opt-label">${esc(o.label)}</span>` +
        (o.description ? `<span class="opt-desc">${esc(o.description)}</span>` : "") + `</span>`;
      body.appendChild(label);
    });
    const other = el("label", "opt opt-other");
    other.innerHTML =
      `<input type="${type}" name="${name}" value="__other__">` +
      `<span class="opt-text"><span class="opt-label">Something else…</span>` +
      `<input type="text" class="opt-free" placeholder="Type your own answer"></span>`;
    body.appendChild(other);
    const free = other.querySelector(".opt-free");
    free.oninput = () => { if (free.value) other.querySelector("input[type]").checked = true; };
    if (multi) free.onfocus = () => { other.querySelector("input[type]").checked = true; };

    actionBtn(node, "btn-primary", "act.continue", "Continue", async () => {
      const picked = [...body.querySelectorAll(`input[name=${name}]:checked`)]
        .map((i) => (i.value === "__other__" ? (free.value.trim() || "Other") : i.value))
        .filter(Boolean);
      if (!picked.length) return;
      settleCard(node, picked.join(", "));
      addReceipt(ev.header || ev.question || "Answer", picked.join(", "));
      // Field-name guess documented in the report: id + both a joined `answer`
      // and the `answers` array, so either server shape finds what it needs.
      // One AskUserQuestion fans out into one card per question (id is
      // `<request_id>#<index>`); each card answers on its own and the host holds
      // the CLI reply until every card of that request is in.
      await post("/answer", { id: ev.id, answer: picked.join(", ") });
    });
    return mountCard(node, ev.id);
  }

  /* -- secret ------------------------------------------------------------ */
  function secretCard(ev) {
    state.sawWork = true;
    const name = ev.name || ev.id || "SECRET";
    const node = cardShell("secret", "Secure value", name);
    const body = node.querySelector(".card-body");
    body.innerHTML =
      (ev.note ? `<p class="card-note">${esc(ev.note)}</p>` : "") +
      `<p class="card-note card-note-quiet">Typed here, written straight into <code>.env.local</code>.
        It is never shown back, never logged, and never reaches the assistant — it is only told whether the value is set.</p>` +
      (ev.alreadySet ? `<p class="card-flag">This variable already has a value in your env file.</p>` : "");

    const field = el("div", "field");
    field.innerHTML = `<input type="password" class="secret-in" placeholder="${esc(name)}" autocomplete="off" spellcheck="false">`;
    const input = field.querySelector("input");

    async function send(action) {
      const value = action === "save" ? input.value : "";
      if (action === "save" && !value) { input.focus(); return; }
      input.value = "";
      settleCard(node,
        action === "keep" ? name + " left as it is."
          : action === "skip" ? name + " skipped."
            : name + " saved to .env.local.");
      const out = await post("/secret", { id: ev.id, action, value });
      // The one answer that is not the end of the story: the value turned up in
      // the file after this card was drawn, so the host refused the overwrite
      // and is re-emitting the card as a three-way. Say so and leave it settled —
      // the incoming `secret` event replaces this node in place.
      if (out && out.state === "exists") {
        settleCard(node, name + " already had a value — asking again below.");
        return;
      }
      addReceipt(name, action === "keep" ? "kept current" : action === "skip" ? "skipped" : "set");
    }

    if (ev.alreadySet) {
      actionBtn(node, "btn-primary", "act.keep", "Keep current", () => send("keep"));
      actionBtn(node, "btn-outline", "act.replace", "Replace", () => {
        body.appendChild(field);
        node.querySelector(".card-actions").innerHTML = "";
        actionBtn(node, "btn-primary", "act.save", "Save", () => send("save"));
        actionBtn(node, "btn-quiet", "act.skip", "Skip", () => send("skip"));
        input.focus();
        input.onkeydown = (e) => { if (e.key === "Enter") send("save"); };
      });
      actionBtn(node, "btn-quiet", "act.skip", "Skip", () => send("skip"));
    } else {
      body.appendChild(field);
      input.onkeydown = (e) => { if (e.key === "Enter") send("save"); };
      actionBtn(node, "btn-primary", "act.save", "Save", () => send("save"));
      actionBtn(node, "btn-quiet", "act.skip", "Skip", () => send("skip"));
    }
    return mountCard(node, ev.id);
  }

  /* -- permission -------------------------------------------------------- */
  function permissionCard(ev) {
    state.sawWork = true;
    const node = cardShell("permission", ev.tool || "Command", copy("perm.title"));
    node.querySelector(".card-title").dataset.copy = "perm.title";
    const body = node.querySelector(".card-body");
    body.innerHTML =
      `<pre class="cmd">${esc(ev.command || "")}</pre>` +
      (ev.description ? `<p class="card-note">${esc(ev.description)}</p>` : "");

    /* TWO buttons, deliberately. The third — "Allow for this run" — was a
       blanket the operator had to grant before they had seen what it would
       cover, and it is gone: the host now decides the repeats itself (an exact
       command already allowed, a safe diagnostic) and SAYS SO with a `notice`.
       That moves the widening of permission from a promise the operator makes
       up front to a fact they are told after, which is the honest order. */
    async function answer(action) {
      settleCard(node, action === "deny" ? "Skipped — nothing ran." : "Allowed.");
      await post("/decision", { id: ev.id, allow: action !== "deny" });
    }
    actionBtn(node, "btn-primary", "act.allow", "Allow", () => answer("allow"));
    actionBtn(node, "btn-danger", "act.deny", "Deny", () => answer("deny"));
    return mountCard(node, ev.id);
  }

  /* ---------------------------------------------------------------- panels */
  const panels = {};
  function panel(id, titleKey) {
    if (panels[id]) { setCurrentPanel(panels[id]); return panels[id]; }
    const node = el("section", "panel panel-" + id);
    node.innerHTML = `<h3 class="panel-title" data-copy="${titleKey}"></h3><div class="panel-body"></div>`;
    node.querySelector(".panel-title").textContent = copy(titleKey);
    panelsEl.appendChild(node);
    panels[id] = node;
    setCurrentPanel(node);
    return node;
  }
  /* One panel at a time. v0.2 keyed that off `data-phase` and a hard-coded list
     of phase ids — which stops working the moment phase ids are plan-declared
     slugs. The panel that is current is now simply the one most recently
     written to, marked here and hidden/shown by CSS alone. */
  function setCurrentPanel(node) {
    panelsEl.querySelectorAll(".panel.is-current").forEach((n) => n.classList.remove("is-current"));
    node.classList.add("is-current");
  }
  function setPanelTitle(node, key) {
    const h = node.querySelector(".panel-title");
    h.dataset.copy = key;
    h.textContent = copy(key);
  }

  /* -- checks / assessment ----------------------------------------------- */
  /* ONE probe panel serves both. During `assess` it wears the assessment's own
     title and note — the difference between the two is register, not machinery,
     and a second panel would split one machine's findings across two lists. */
  function dressProbePanel() {
    const p = panels.checks;
    if (!p) return;
    p.classList.toggle("is-assessing", !!state.assessing);
    setPanelTitle(p, state.assessing ? "assess.title" : "checks.title");
    const note = p.querySelector(".panel-note");
    if (note) setCopy(note, state.assessing ? "assess.note" : "checks.note");
  }
  function beginAssess() {
    state.assessing = true;
    const p = panel("checks", "assess.title");
    p.hidden = false;
    dressProbePanel();
    setCurrentPanel(p);
  }
  function upsertProbe(ev) {
    const p = panel("checks", state.assessing ? "assess.title" : "checks.title");
    let list = p.querySelector(".probe-list");
    if (!list) {
      const note = el("p", "panel-note");
      setCopy(note, state.assessing ? "assess.note" : "checks.note");
      p.querySelector(".panel-body").appendChild(note);
      list = el("ul", "probe-list");
      p.querySelector(".panel-body").appendChild(list);
    }
    // A probe arriving after the assessment collapsed means the run is checking
    // things again — reopen the panel rather than hide new evidence behind a
    // summary written before it existed.
    if (p.hidden) { p.hidden = false; dressProbePanel(); }
    const key = String(ev.name || "");
    state.probes.set(key, { status: ev.status, detail: ev.detail });
    let row = list.querySelector(`[data-probe="${cssEscape(key)}"]`);
    if (!row) {
      row = el("li", "probe");
      row.dataset.probe = key;
      list.appendChild(row);
    }
    const st = String(ev.status || "running");
    row.dataset.state = st;
    row.innerHTML =
      `<span class="probe-glyph" aria-hidden="true">${glyphFor(st)}</span>` +
      `<span class="probe-name">${esc(key)}</span>` +
      `<span class="probe-detail">${esc(ev.detail || "")}</span>` +
      `<span class="probe-state chip chip-${st}">${esc(st)}</span>`;
  }
  function glyphFor(st) {
    return st === "ok" ? "✓" : st === "fail" ? "✗" : st === "warn" ? "!" : "…";
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* -- boot -------------------------------------------------------------- */
  let healthTimer = null;
  function appPanel(ev) {
    state.app = { port: ev.port, alive: null };
    const p = panel("boot", "boot.title");
    const body = p.querySelector(".panel-body");
    body.innerHTML = "";
    // This panel is rebuilt whenever the port is (re)reported — a rejoin's
    // `hello.appPort` followed moments later by the agent's own [[wizard:app]]
    // marker is the ordinary case. Clearing the body takes the hand-off block
    // with it, so the "already offered" flag has to clear with it or the offer
    // would be lost for the rest of the run.
    state.studioOffered = false;
    const url = "http://localhost:" + ev.port;
    const live = el("div", "live");
    live.innerHTML =
      `<span class="live-dot" data-alive="unknown" aria-hidden="true"></span>` +
      `<span class="live-text">Checking <code>${esc(url)}</code>…</span>`;
    body.appendChild(live);
    const open = el("a", "btn btn-primary btn-open", "Open kp");
    open.href = url;
    open.target = "_blank";
    open.rel = "noopener";
    body.appendChild(open);

    const dot = live.querySelector(".live-dot");
    const text = live.querySelector(".live-text");
    /* /app/health always answers 200 with {ok, port, status?, reason?} — the
       liveness fact is in the BODY, not the HTTP status, so a transport-level
       `res.ok` would report every install as running. */
    async function poll() {
      try {
        const r = await getJSON("/app/health");
        const alive = !!(r.json && r.json.ok);
        state.app.alive = alive;
        dot.dataset.alive = alive ? "yes" : "no";
        const reason = r.json && r.json.reason ? " — " + esc(r.json.reason) : "";
        text.innerHTML = alive
          ? `kp is running at <code>${esc(url)}</code>${r.json.status === 401 ? " (password-protected)" : ""}`
          : `Not answering yet on <code>${esc(url)}</code>${reason || " — it may still be compiling."}`;
        // "Confirmed up" is this body saying ok, not the HTTP status of the
        // poll — the same distinction the dot above is careful about.
        if (alive) offerStudio(body, ev.port);
      } catch {
        dot.dataset.alive = "no";
        text.innerHTML = `Could not reach <code>${esc(url)}</code>.`;
      }
    }
    poll();
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(poll, 4000);
  }

  /* -- the hand-off into the studio -------------------------------------- *
     The concept's two-stage split: this page is the BOOTSTRAP face and cannot
     be replaced, because a page served by the app cannot exist before the app
     boots. Once it has booted there is a better face — the studio, inside kp,
     with the design system, both themes and four locales — and this is where
     that is offered.

     Offered, never taken: no auto-redirect. The operator is mid-run on a page
     they trust, and moving them without asking would be the installer deciding
     something on their behalf at exactly the moment it is meant to stop doing
     that. It opens in a new tab for the same reason the offer is an offer: if
     `/setup/studio` is not there (an older app, a failed build), the run they
     are in the middle of is still on screen behind it.

     The token rides in the FRAGMENT. A query string reaches the app's server
     logs, its access logs and any Referer it sends; a fragment never leaves the
     browser. The studio reads it from `location.hash`. */
  function studioUrl(appPort) {
    return `http://localhost:${appPort}/setup/studio` +
      `#wizard=${encodeURIComponent(String(state.selfPort))}&t=${encodeURIComponent(TOKEN)}`;
  }
  function offerStudio(body, appPort) {
    // `studio` is the server's flag (KP_ONBOARD_STUDIO=0 withdraws it) and
    // `selfPort` is how the studio finds its way back to this engine. Without
    // either, there is nothing honest to offer.
    if (!state.studio || !state.selfPort) return;
    // Keyed on the DOM, not on a boolean: the health poll fires every four
    // seconds, and a rebuild of this panel can race the poll that outlived it.
    // "Is the block in THIS body" is the only question that cannot be wrong.
    if (body.querySelector(".wz-studio")) return;
    state.studioOffered = true;
    const box = el("section", "wz-studio");
    box.innerHTML =
      `<p class="wz-studio-k">Continue in the studio</p>` +
      `<p class="wz-studio-note">KP is running now, so the rest of this can happen inside the app itself —
        the same setup session, in KP's own design.</p>`;
    const go = el("a", "btn btn-primary wz-studio-go", "Continue in the studio");
    go.href = studioUrl(appPort);
    go.target = "_blank";
    go.rel = "noopener noreferrer";
    box.appendChild(go);
    const stay = el("p", "wz-studio-stay",
      "Or carry on here — this page keeps working, and both stay on the same run.");
    box.appendChild(stay);
    body.appendChild(box);
  }

  /* -- voice / TTS ------------------------------------------------------- */
  /* The /app/tts body is a passthrough of kp's voice-tts package, so every
     field is read defensively: the shape is probed at runtime, never assumed.
     A provider that cannot be understood is still shown, with its raw JSON —
     an honest "we don't know" beats a fabricated green. */
  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    }
    return null;
  }
  function normalizeProviders(payload) {
    if (!payload) return [];
    let raw = payload.providers != null ? payload.providers : payload;
    if (raw && !Array.isArray(raw) && typeof raw === "object") {
      raw = Object.keys(raw).map((k) => {
        const v = raw[k];
        return v && typeof v === "object" ? Object.assign({ id: k }, v) : { id: k, state: v };
      });
    }
    if (!Array.isArray(raw)) return [];
    return raw.map((p) => {
      if (typeof p === "string") p = { id: p };
      const probe = (p && typeof p.probe === "object" && p.probe) || {};
      const id = pick(p, ["id", "provider", "key", "name"]) || "provider";
      const name = pick(p, ["name", "label", "title"]) || id;
      const rawState = pick(probe, ["state", "status"]) || pick(p, ["state", "status", "probe"]) || "unknown";
      const st = String(rawState).toLowerCase();
      const reason = pick(probe, ["reason", "detail", "message", "error", "hint"]) ||
        pick(p, ["reason", "detail", "message", "error", "hint"]);
      let voices = p.voices || probe.voices || null;
      if (voices && !Array.isArray(voices)) voices = null;
      const languages = pick(p, ["languages", "language", "locales"]) || pick(probe, ["languages", "language"]);
      return {
        id: String(id), name: String(name), state: st, reason: reason ? String(reason) : null,
        ready: st === "ready" || st === "ok" || p.ready === true,
        voices: (voices || []).map((v) => (typeof v === "string" ? { id: v, name: v } : {
          id: String(pick(v, ["id", "voiceId", "voice_id", "key", "name"]) || ""),
          name: String(pick(v, ["name", "label", "title", "id", "voiceId"]) || ""),
          language: pick(v, ["language", "lang", "locale"]),
        })).filter((v) => v.id),
        languages: Array.isArray(languages) ? languages.join(", ") : (languages ? String(languages) : null),
        raw: p,
      };
    });
  }

  async function loadVoice() {
    const p = panel("voice", "voice.title");
    const body = p.querySelector(".panel-body");
    body.innerHTML = `<p class="panel-note">Asking the app which speech engines are installed…</p>`;
    let r;
    try {
      r = await getJSON("/app/tts");
    } catch (e) {
      body.innerHTML = `<p class="panel-note is-err">Could not ask the app about speech engines: ${esc(e.message)}</p>`;
      addSkip(body);
      return;
    }
    if (r.status === 401) {
      body.innerHTML =
        `<p class="panel-note">The app is password-protected, so this page cannot probe its speech engines from out here.
          That is the auth working as designed — open kp and test the voices inside the app
          (Interview lab → compare panel).</p>`;
      addSkip(body);
      return;
    }
    if (!r.ok || !r.json) {
      body.innerHTML = `<p class="panel-note is-err">The app answered ${esc(r.status)} when asked about speech engines.</p>`;
      addSkip(body);
      return;
    }
    const providers = normalizeProviders(r.json);
    state.tts = { providers, preferred: r.json.preferred, allowed: r.json.allowed };
    body.innerHTML = "";
    const note = el("p", "panel-note");
    setCopy(note, "voice.note");
    body.appendChild(note);
    if (r.json.allowed && Array.isArray(r.json.allowed) && r.json.allowed.length) {
      body.appendChild(el("p", "panel-note panel-note-quiet",
        "This install is locked to: " + esc(r.json.allowed.join(", "))));
    }
    if (!providers.length) {
      body.appendChild(el("p", "panel-note", "The app reports no speech engines at all — spoken output stays off, and <code>/api/tts</code> answers an honest 503."));
    }
    const grid = el("div", "voice-grid");
    providers.forEach((pv) => grid.appendChild(voiceCard(pv, r.json.preferred)));
    body.appendChild(grid);
    addSkip(body);
  }

  function voiceCard(pv, preferred) {
    const card = el("div", "voice-card");
    card.dataset.state = pv.ready ? "ready" : pv.state;
    const stateLabel = pv.ready ? "ready" : pv.state;
    card.innerHTML =
      // absent is NOT a failure — it is "you never installed this one", and
      // painting it the same red as `broken` would invent a problem. Only
      // installed-but-failing earns the fail chip.
      `<div class="voice-head"><span class="voice-name">${esc(pv.name)}</span>` +
      `<span class="chip chip-${pv.ready ? "ok" : pv.state === "broken" ? "fail" : "hidden"}">${esc(stateLabel)}</span></div>` +
      (pv.languages ? `<p class="voice-lang">Speaks: ${esc(pv.languages)}</p>` : "") +
      (pv.reason ? `<p class="voice-reason">${esc(pv.reason)}</p>` : "") +
      (preferred === pv.id ? `<p class="voice-lang">Currently the default.</p>` : "");

    const row = el("div", "voice-actions");
    let voiceSel = null;
    if (pv.voices.length > 1) {
      voiceSel = el("select", "voice-pick");
      pv.voices.forEach((v) => {
        const o = el("option", null, esc(v.name + (v.language ? " · " + v.language : "")));
        o.value = v.id;
        voiceSel.appendChild(o);
      });
      row.appendChild(voiceSel);
    }
    if (pv.ready) {
      const play = el("button", "btn btn-outline btn-play", "▶ Play sample");
      play.type = "button";
      play.onclick = async () => {
        play.disabled = true;
        const was = play.textContent;
        play.textContent = "…";
        try {
          const res = await fetch("/app/tts/sample?t=" + encodeURIComponent(TOKEN), {
            method: "POST",
            headers: { "content-type": "application/json", "x-onboard-token": TOKEN },
            body: JSON.stringify({
              provider: pv.id,
              voiceId: voiceSel ? voiceSel.value : (pv.voices[0] && pv.voices[0].id) || undefined,
              language: "en",
            }),
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            card.querySelector(".voice-reason") ||
              card.insertBefore(el("p", "voice-reason"), row);
            card.querySelector(".voice-reason").textContent =
              "Sample failed (" + res.status + "). " + txt.slice(0, 200);
            return;
          }
          // The host says which engine actually spoke. When it had to fall back,
          // that is exactly the fact a "pick your default" screen must not hide.
          const from = res.headers.get("x-tts-fallback-from");
          const spoke = res.headers.get("x-tts-provider");
          if (from && spoke && spoke !== pv.id) {
            card.querySelector(".voice-reason") || card.insertBefore(el("p", "voice-reason"), row);
            card.querySelector(".voice-reason").textContent =
              "That sample was spoken by " + spoke + ", not " + pv.id + " — it fell back.";
          }
          const buf = await res.blob();
          const url = URL.createObjectURL(buf);
          const audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          await audio.play().catch((e) => {
            card.querySelector(".voice-reason") || card.insertBefore(el("p", "voice-reason"), row);
            card.querySelector(".voice-reason").textContent = "Your browser refused to play it: " + e.message;
          });
        } finally {
          play.disabled = false;
          play.textContent = was;
        }
      };
      row.appendChild(play);

      const def = el("button", "btn btn-primary", "Make this the default");
      def.type = "button";
      def.onclick = async () => {
        await post("/choice/tts", { provider: pv.id });
        state.tts && (state.tts.chosen = pv.id);
        panelsEl.querySelectorAll(".voice-card").forEach((c) => c.classList.remove("is-chosen"));
        card.classList.add("is-chosen");
        addReceipt("Spoken output", pv.name);
        setStatus(pv.name + " is now the default speech engine.");
      };
      row.appendChild(def);
    }
    card.appendChild(row);
    return card;
  }

  function addSkip(body) {
    if (body.querySelector(".voice-skip")) return;
    const skip = el("button", "btn btn-quiet voice-skip", "Skip spoken output");
    skip.type = "button";
    skip.onclick = async () => {
      await post("/choice/tts", { skipped: true });
      addReceipt("Spoken output", "skipped");
      setStatus("Spoken output skipped — you can set it up later with /onboarding tts.");
      skip.disabled = true;
      skip.textContent = "Skipped";
    };
    body.appendChild(skip);
  }

  /* -- matrix ------------------------------------------------------------ */
  const STATE_WORDS = [
    ["on", /^(on|works|ready|sending|enabled|configured|yes)\b/i],
    // "open (dev)" is a degraded row, not an off one: auth genuinely works, with
    // a caveat the operator must see. Painting it coral would call a documented
    // dev-mode default a failure.
    ["degraded", /^(degraded|limited|deterministic|queued|fallback|link-based|partial|queued-only|open)\b/i],
    ["hidden", /^(hidden|not shown)\b/i],
    ["off", /^(off|none|not configured|skipped|later|no|absent|disabled)\b/i],
  ];
  function classifyState(text) {
    const t = String(text || "").trim();
    for (const [kind, re] of STATE_WORDS) if (re.test(t)) return kind;
    return "off";
  }
  function matrixPanel(mdText) {
    const p = panel("done", "done.title");
    const body = p.querySelector(".panel-body");
    body.innerHTML = "";
    /* Matrix-first short-circuit: an already-configured machine can reach this
       panel without ever being asked for a key or a command. That run must not
       end looking like it was cut short — the matrix IS the deliverable, so the
       panel says so and leads with it. */
    const short = !state.sawWork;
    root.dataset.reward = String(short);
    p.classList.toggle("is-reward", short);
    // One heading, not two: the panel renames itself rather than growing a
    // second title above its own.
    setPanelTitle(p, short ? "reward.title" : "done.title");
    if (short) {
      const lead = el("p", "reward-lead");
      setCopy(lead, "reward.note");
      body.appendChild(lead);
    }
    const offRows = [];
    const lines = String(mdText || "").replace(/\r/g, "").split("\n");
    let table = null;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        table = readTable(lines, i);
        break;
      }
    }
    if (!table) {
      // No table in the payload — render the prose rather than losing it.
      const raw = el("div", "md");
      raw.innerHTML = md(mdText);
      body.appendChild(raw);
    } else {
      // Column 0 is the feature; the state column is whichever remaining column
      // most often starts with a state word (the config.md matrix puts it at 1,
      // but the assistant writes the table, so it is detected, not assumed).
      let stateCol = 1;
      let best = -1;
      for (let c = 1; c < table.head.length; c++) {
        let hits = 0;
        table.rows.forEach((r) => {
          const cell = (r[c] || "").trim();
          if (STATE_WORDS.some(([, re]) => re.test(cell))) hits++;
        });
        if (hits > best) { best = hits; stateCol = c; }
      }
      const grid = el("div", "matrix-grid");
      table.rows.forEach((r) => {
        if (!r[0]) return;
        const kind = classifyState(r[stateCol]);
        if (kind === "off" || kind === "hidden") offRows.push(String(r[0]).replace(/\*/g, "").trim());
        const cardEl = el("div", "matrix-card");
        cardEl.dataset.state = kind;
        let extra = "";
        for (let c = 1; c < table.head.length; c++) {
          if (c === stateCol || !r[c]) continue;
          extra += `<p class="matrix-extra"><span class="matrix-extra-k">${esc(table.head[c])}</span>${inline(r[c])}</p>`;
        }
        cardEl.innerHTML =
          `<div class="matrix-head"><span class="matrix-name">${inline(r[0])}</span>` +
          `<span class="chip chip-${kind}">${esc((r[stateCol] || kind).trim())}</span></div>` + extra;
        grid.appendChild(cardEl);
      });
      body.appendChild(grid);
    }
    const note = el("p", "panel-note");
    setCopy(note, "done.note");
    body.appendChild(note);
    if (offRows.length) body.appendChild(addonBlock(offRows));
    // On a short-circuit the matrix IS the deliverable, and it arrives while the
    // decision that produced it is still the tallest thing on the page. Put it
    // in view — a reward the operator has to scroll to find is not one.
    if (short) {
      requestAnimationFrame(() => p.scrollIntoView({
        block: "start", behavior: prefersReduced() ? "auto" : "smooth",
      }));
    }
  }

  /* The closing offer. Every row the matrix reports as off or hidden is a group
     the operator could still add, so the end of a short run is an invitation
     rather than a full stop. It injects a user turn — the same channel the free
     text box uses — and the agent answers by declaring a NEW plan, which the
     rail absorbs without losing what is already ticked. */
  function addonBlock(names) {
    const box = el("section", "addons");
    const h = el("p", "addon-title");
    setCopy(h, "addon.title");
    box.appendChild(h);
    const row = el("div", "addon-row");
    names.slice(0, 4).forEach((name) => {
      const b = el("button", "btn btn-outline addon", "Set up " + esc(name));
      b.type = "button";
      b.dataset.addon = name;
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = "Asked for " + name;
        setStatus("Asked the assistant to set up " + name + " as well.");
        await post("/message", { text: "Set up " + name + " as well, before we finish." });
      };
      row.appendChild(b);
    });
    box.appendChild(row);
    return box;
  }

  /* -- terminal ---------------------------------------------------------- */
  function terminal(kind, text) {
    state.finished = { kind, text };
    state.running = false;
    if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
    root.dataset.finished = kind;
    setRunning(false);
    // The add-on offer rides on /message, which only exists while the session
    // does. Once it is over the buttons are dead controls, so they say so.
    panelsEl.querySelectorAll("button.addon:not(:disabled)").forEach((b) => { b.disabled = true; });
    const node = el("section", "panel panel-terminal");
    node.dataset.kind = kind;
    node.innerHTML = `<h3 class="panel-title">${esc(
      kind === "stopped" ? "Setup stopped" : kind === "error" ? "Setup hit an error" : "Setup finished"
    )}</h3><div class="panel-body"><p class="panel-note">${esc(text)}</p></div>`;
    const again = el("button", "btn btn-primary", "Start again");
    again.type = "button";
    again.onclick = () => { resetRun(); start(); };
    node.querySelector(".panel-body").appendChild(again);
    panelsEl.appendChild(node);
    node.scrollIntoView({ block: "nearest", behavior: prefersReduced() ? "auto" : "smooth" });
  }

  function resetRun() {
    asksEl.innerHTML = "";
    warnEl.innerHTML = "";
    cardsById.clear();
    panelsEl.innerHTML = "";
    Object.keys(panels).forEach((k) => delete panels[k]);
    $("#wz-receipt-list", root).innerHTML = "";
    $("#wz-receipts", root).hidden = true;
    activityBody.innerHTML = "";
    state.probes.clear();
    state.receipts = [];
    state.narration = [];
    state.notices = [];
    state.unread = 0;
    unreadEl.hidden = true;
    state.phase = null;
    state.phaseSeen = new Set();
    state.plan = null;
    state.lastStep = null;
    state.assessing = false;
    state.assessSummary = null;
    state.sawWork = false;
    state.finished = null;
    state.app = null;
    state.tts = null;
    state.matrix = null;
    // The boot panel and the studio offer inside it are gone with the panels;
    // the flag that says "already offered" has to go with them.
    state.studioOffered = false;
    delete root.dataset.finished;
    delete root.dataset.planned;
    delete root.dataset.reward;
    delete root.dataset.phase;
    renderSteps();
  }

  /* Guide's stage shows ONE thing, so the free-text box to the assistant is not
     part of it: a chat prompt on an installer invites a question this surface
     cannot promise to answer. It stays in the DOM because /message is a real
     channel — the add-on buttons ride it — and one class away from returning. */

  /* ---------------------------------------------------------------- events */
  /* Machine outcome -> the line a settled card shows. The server sends the
     word, not the copy: it has no business writing this page's English, and a
     second face (the studio, in four locales) needs the word rather than a
     sentence. `answered` is the exception — a question's resolution IS what the
     operator picked, which rides on the event as `answer`. */
  const RESOLUTION = {
    saved: "Saved to .env.local.",
    kept: "Left as it is.",
    skipped: "Skipped.",
    allowed: "Allowed.",
    declined: "Skipped — nothing ran.",
    withdrawn: "Withdrawn — setup was stopped.",
  };

  /* Feed replayed events through the live handler, skipping anything this page
     has already seen (state.maxSeq).

     IN SEQ ORDER, across every list at once. The replay block groups events by
     kind for readability, but the groups interleave in time — a narration block
     is emitted between two probe markers of the same message — so replaying
     group by group would run the stream backwards, and the seq guard would then
     read the older group as "already seen" and drop it. Sorting first is what
     makes "replay is the live stream, again" true rather than nearly true. */
  function replayEvents(...lists) {
    lists
      .flatMap((l) => (Array.isArray(l) ? l : []))
      .filter((ev) => ev && typeof ev === "object")
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
      .forEach((ev) => {
        if (typeof ev.seq === "number" && ev.seq <= state.maxSeq) return;
        handle(ev);
      });
  }

  function handle(ev) {
    if (typeof ev.seq === "number" && ev.seq > state.maxSeq) state.maxSeq = ev.seq;
    switch (ev.type) {
      /* Sent once on connect. A reloaded page rejoins the session where it is
         instead of showing a blank stage and a Start button for a run that is
         already half done. (`seq`/`at` ride on every event and are ignored.) */
      case "hello": {
        if (ev.repo) {
          const meta = $("#wz-meta", root);
          meta.hidden = false;
          meta.innerHTML = `<span class="wz-meta-k">Folder</span><code>${esc(ev.repo)}</code>` +
            `<span class="wz-meta-k">Settings file</span><span>${
              ev.envFileExists ? ".env.local is already there" : ".env.local will be created"}</span>`;
        }
        // Only claim the asking contract when the host says it holds. `mode` is
        // whatever vocabulary the host uses; the flag is the load-bearing half.
        applyEnforcement(ev.enforcement);
        // Where this engine lives and whether it is offering a studio. Both are
        // the server's to say: only it reads KP_ONBOARD_STUDIO, and only it
        // knows which port it actually bound (the listener retries on collision).
        state.selfPort = ev.self && ev.self.port ? ev.self.port : null;
        state.studio = ev.studio === true;
        // A rejoin may carry a plan-declared phase id this page has never seen —
        // and may carry none at all. Both are fine: the phase is taken at face
        // value and the fallback rail holds until a plan arrives (or doesn't).
        if (Array.isArray(ev.plan)) applyPlan(ev.plan);
        if (ev.phase) handle({ type: "phase", id: ev.phase });
        if (ev.appPort) appPanel({ port: ev.appPort });
        if (ev.running) {
          setRunning(true);
          setStatus("Rejoined a setup session that is already running.");
        }
        /* The replay block: everything a face that was not here needs in order
           to render the run as it stands. Every entry is a verbatim event, so
           this page renders a rejoin with exactly the code that renders the
           live stream, replayed in the order it originally happened, and the
           seq guard keeps a reconnect from drawing any of it twice. */
        const rp = ev.replay || {};
        replayEvents(rp.probes, rp.narration, rp.notices, rp.cards);
        // The matrix is carried as markdown, not as an event — it has no seq of
        // its own, so it is guarded on its own content instead.
        if (rp.matrix && rp.matrix !== state.matrix) handle({ type: "matrix", md: rp.matrix });
        if (rp.status) setStatus(rp.status);
        if (rp.terminal) replayEvents([rp.terminal]);
        break;
      }
      /* A card was settled — possibly on the OTHER face. The host has always
         owned the decision; since v0.6 it also says so, which is what lets two
         faces on one run agree instead of one of them holding a live-looking
         control nobody is listening to any more. The face that answered has
         already settled its own copy optimistically, so this is a no-op there. */
      case "resolved": {
        const node = cardsById.get(String(ev.id));
        if (!node || node.classList.contains("is-settled")) break;
        settleCard(node, ev.outcome === "answered"
          ? (ev.answer || "Answered.")
          : (RESOLUTION[ev.outcome] || "Answered."));
        break;
      }
      case "plan": applyPlan(ev.steps); break;
      case "phase": {
        const id = String(ev.id == null ? "" : ev.id);
        if (!id) break;
        state.phase = id;
        state.phaseSeen.add(id);
        const list = stepList();
        const idx = list.findIndex((s) => s.id === id);
        if (idx >= 0) {
          list.slice(0, idx).forEach((s) => state.phaseSeen.add(s.id));
          state.lastStep = idx;
        }
        root.dataset.phase = id;
        renderSteps();
        if (id === "assess") beginAssess();
        if (id === "voice") loadVoice();
        if (panels[id]) setCurrentPanel(panels[id]);
        break;
      }
      case "status": setStatus(ev.text || ""); break;
      case "narration": pushNarration(ev.md || ""); break;
      case "notice": pushNotice(ev); break;
      case "probe": upsertProbe(ev); break;
      case "question": questionCard(ev); break;
      case "secret": secretCard(ev); break;
      case "permission": permissionCard(ev); break;
      case "app": appPanel(ev); break;
      case "matrix": state.matrix = ev.md || ""; matrixPanel(ev.md || ""); break;
      case "done":
        terminal(ev.exitCode ? "error" : "done",
          ev.exitCode ? "The setup session ended with exit code " + ev.exitCode + "."
            : "Setup finished. Everything above is what this install can actually do.");
        break;
      case "stopped":
        // The host denies every open card as it stops, so an unanswered card on
        // screen is a dead control — drop it rather than leave a button that
        // will never be heard.
        asksEl.querySelectorAll(".card:not(.is-settled)").forEach((n) => {
          settleCard(n, "Withdrawn — setup was stopped.");
        });
        terminal("stopped", "Stopped at your request. Nothing further was run; whatever was already written to .env.local is still there.");
        break;
      case "error":
        setStatus(ev.message || "Something went wrong.", true);
        terminal("error", ev.message || "Something went wrong.");
        break;
      default: break; // unknown event types are ignored, never rendered raw
    }
  }

  /* ------------------------------------------------------------------ SSE */
  let es = null;
  function connect() {
    es = new EventSource("/events?t=" + encodeURIComponent(TOKEN));
    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      handle(ev);
    };
    es.onerror = () => {
      if (state.finished) return;
      setStatus("Lost the connection to the installer. Is the terminal process still running?", true);
    };
  }

  /* -------------------------------------------------------------- controls */
  function setRunning(on) {
    state.running = on;
    root.dataset.running = String(on);
    startBtn.disabled = on;
    runSel.disabled = on;
    runBtn.disabled = on;
    // Stop is ALWAYS reachable while a run is live, and never a dead control
    // otherwise: it is disabled only when nothing is running.
    stopBtn.disabled = !on;
    $("#wz-msg", root).disabled = !on;
  }
  /* `run:"start"` is the recon-first entry: the agent assesses the machine and
     then proposes a journey. The page no longer guesses which journey that is —
     which is the whole point of v0.3. */
  async function start(run) {
    setRunning(true);
    setStatus("Starting the setup assistant…");
    const out = await post("/start", { run: run || "start" });
    if (out && out.error) setRunning(false);
  }
  startBtn.onclick = () => start("start");
  runBtn.onclick = () => start(runSel.value);
  advToggle.onclick = () => {
    const open = advPanel.hidden;
    advPanel.hidden = !open;
    advToggle.setAttribute("aria-expanded", String(open));
    root.dataset.advanced = String(open);
  };
  stopBtn.onclick = async () => {
    state.stopPending = true;
    stopBtn.disabled = true;
    setStatus("Stopping…");
    await post("/stop", {});
    // The terminal state waits for {type:"stopped"} — the server confirms, the
    // page does not assume.
  };
  $("#wz-say", root).onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#wz-msg", root);
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    pushNarration("**You:** " + text);
    await post("/message", { text });
  };

  /* ----------------------------------------------------------------- boot */
  setRunning(false);
  renderSteps();
  connect();

  // Exposed for the mock harness / DOM assertions. Read-only by convention.
  window.KPWizard = { state, handle, PHASES, FALLBACK_PHASES, stepList };
})();

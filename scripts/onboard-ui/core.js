/*
 * KP installer wizard — shared core.
 *
 * ONE state machine, ONE SSE reader, ONE set of card logic, three visual
 * variants (variants.js + studio/spark/guide.css). The rule that keeps the
 * prototyping rig honest: nothing below branches on the active variant except
 * `copy()` (word choice) and `decorate()` (a post-build hook). If a behaviour
 * needs to differ per variant, it is not a variant — it is a second product.
 *
 * The primary surface is "what is happening + what I need from you". Agent
 * prose is NOT the UI: every {type:"narration"} goes to the Activity drawer,
 * closed by default, and the stage carries only the stepper, the status line,
 * live decision cards and the phase panels.
 */
(() => {
  "use strict";

  const TOKEN = new URLSearchParams(location.search).get("t") || "";
  const VARIANTS = window.KP_VARIANTS || {};
  const VARIANT_IDS = Object.keys(VARIANTS);
  const STORE_KEY = "kp-onboard-variant";

  /* ---------------------------------------------------------------- phases */
  /* Driven by {type:"phase"} events ONLY — never by sniffing prose. A phase we
     have not seen stays "ahead"; phases are ordered, so an out-of-order event
     still lights everything before it. */
  const PHASES = ["welcome", "mode", "checks", "capabilities", "boot", "voice", "done"];

  const DEFAULT_COPY = {
    "app.title": "Set up KP",
    "app.sub": "This runs KP's own setup assistant on your machine, on your Claude subscription. Nothing happens without your say-so.",
    "phase.welcome": "Welcome",
    "phase.mode": "Install mode",
    "phase.checks": "System checks",
    "phase.capabilities": "Capabilities",
    "phase.boot": "Boot & verify",
    "phase.voice": "Spoken output",
    "phase.done": "Your install",
    "checks.title": "System checks",
    "checks.note": "What this machine already has. Nothing here is changed without asking.",
    "boot.title": "The app",
    "voice.title": "Spoken output",
    "voice.note": "Play a sample from each engine that is ready, then pick the default. Skipping is a complete answer — /api/tts answers an honest 503 and nothing else depends on it.",
    "done.title": "Your install",
    "done.note": "Any group can be re-run on its own later with /onboarding <group> — nothing here is a one-shot.",
    "receipts.title": "Answered",
    "activity.title": "Activity",
    "act.allow": "Allow",
    "act.deny": "Deny",
    "act.always": "Allow for this run",
    "act.continue": "Continue",
    "act.save": "Save",
    "act.skip": "Skip",
    "act.keep": "Keep current",
    "act.replace": "Replace",
    "perm.title": "KP setup wants to run:",
  };

  /* ----------------------------------------------------------------- state */
  const state = {
    variant: null,
    started: false,
    running: false,
    finished: null, // {kind:"done"|"stopped"|"error", text}
    stopPending: false,
    phase: null,
    phaseSeen: new Set(),
    status: "",
    probes: new Map(), // name -> {status, detail}
    cards: [], // live decision cards, newest last
    receipts: [], // {label, value}
    narration: [], // markdown blocks
    unread: 0,
    drawerOpen: false,
    app: null, // {port, alive}
    tts: null, // {loading|error|providers|preferred|allowed|chosen|skipped}
    matrix: null, // parsed rows
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
    const v = state.variant && VARIANTS[state.variant] && VARIANTS[state.variant].copy;
    return (v && v[key]) || DEFAULT_COPY[key] || key;
  }
  function decorate(node, kind, index) {
    const v = state.variant && VARIANTS[state.variant];
    if (v && typeof v.decorate === "function") {
      try { v.decorate(node, kind, index); } catch { /* a decoration must never break the run */ }
    }
  }
  /* Copy is re-applied on every variant switch, so every string that a variant
     may reword is written through a data-copy marker rather than typed in. */
  function setCopy(node, key) {
    node.dataset.copy = key;
    node.textContent = copy(key);
    return node;
  }
  function reapplyCopy(root) {
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
     DOM skeleton — built once. Variants restyle it; they never rebuild it.
     Both steppers (rail + dots) exist in the DOM; CSS picks one, so a live
     variant swap is a class change and not a re-render.
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
        <label class="wz-runwrap">
          <span class="wz-runlabel">Run</span>
          <select class="wz-run" id="wz-run">
            <option value="full">Full setup</option>
            <option value="check">Check only (no questions)</option>
            <option value="llm-engine">Just: LLM engine</option>
            <option value="gemini">Just: CV analysis (Gemini)</option>
            <option value="voice">Just: Voice interviews</option>
            <option value="tts">Just: Spoken output</option>
            <option value="github-signal">Just: GitHub signal</option>
            <option value="kp-secret">Just: Key encryption</option>
            <option value="operator-auth">Just: Operator password</option>
            <option value="comms">Just: Email sending</option>
            <option value="calendar">Just: Calendar</option>
            <option value="edge">Just: Edge relay</option>
            <option value="observability">Just: Observability</option>
          </select>
        </label>
        <button class="btn btn-primary" id="wz-start">Start setup</button>
        <button class="btn btn-quiet" id="wz-stop">Stop</button>
      </div>
    </header>

    <nav class="wz-rail" aria-label="Setup progress">
      <ol class="wz-steps" id="wz-steps"></ol>
      <div class="wz-meta" id="wz-meta" hidden></div>
    </nav>

    <main class="wz-main">
      <div class="wz-dots" id="wz-dots" aria-hidden="true"></div>
      <div class="wz-statusbar">
        <span class="wz-pulse" aria-hidden="true"></span>
        <p class="wz-status" id="wz-status" role="status" aria-live="polite">Ready when you are.</p>
      </div>
      <div class="wz-stage" id="wz-stage">
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

    <div class="wz-switcher" id="wz-switcher" role="group" aria-label="Visual variant"></div>
  `;
  document.body.appendChild(root);

  $(".wz-mark", root).innerHTML = window.KP_MARK || "";

  const stage = $("#wz-stage", root);
  const asksEl = $("#wz-asks", root);
  const panelsEl = $("#wz-panels", root);
  const stepsEl = $("#wz-steps", root);
  const dotsEl = $("#wz-dots", root);
  const statusEl = $("#wz-status", root);
  const activityBody = $("#wz-activity-body", root);
  const unreadEl = $("#wz-unread", root);
  const startBtn = $("#wz-start", root);
  const stopBtn = $("#wz-stop", root);
  const runSel = $("#wz-run", root);

  /* Spark's mascot lives in the DOM for every variant; only spark.css shows it. */
  const mascot = el("div", "wz-mascot", window.KP_MASCOT || "");
  mascot.setAttribute("aria-hidden", "true");
  root.appendChild(mascot);

  /* ------------------------------------------------------------- variants */
  function applyVariant(id) {
    if (!VARIANTS[id]) id = VARIANT_IDS[0];
    state.variant = id;
    root.dataset.variant = id;
    document.documentElement.dataset.variant = id;
    VARIANT_IDS.forEach((v) => {
      const link = document.getElementById("css-" + v);
      if (link) link.disabled = v !== id;
    });
    try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode */ }
    reapplyCopy(root);
    renderSteps();
    // Re-run decoration over everything already on screen: a variant swap must
    // not need a re-render, because a re-render would drop half-typed input.
    let i = 0;
    root.querySelectorAll(".card").forEach((n) => decorate(n, "card", i++));
    let j = 0;
    root.querySelectorAll(".panel").forEach((n) => decorate(n, "panel", j++));
    $("#wz-switcher", root).querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.v === id));
    });
  }
  function buildSwitcher() {
    const box = $("#wz-switcher", root);
    VARIANT_IDS.forEach((v) => {
      const b = el("button", "wz-switch", esc(VARIANTS[v].label));
      b.type = "button";
      b.dataset.v = v;
      b.title = VARIANTS[v].blurb || VARIANTS[v].label;
      b.onclick = () => applyVariant(v);
      box.appendChild(b);
    });
  }

  /* -------------------------------------------------------------- stepper */
  function phaseIndex(id) { return PHASES.indexOf(id); }
  function renderSteps() {
    const cur = phaseIndex(state.phase);
    stepsEl.innerHTML = "";
    dotsEl.innerHTML = "";
    PHASES.forEach((p, i) => {
      const done = state.phaseSeen.has(p) && i < cur;
      const active = i === cur;
      const li = el("li", "wz-step" + (done ? " is-done" : "") + (active ? " is-active" : ""));
      li.innerHTML =
        `<span class="wz-stepdot">${done ? "✓" : i + 1}</span>` +
        `<span class="wz-steplabel">${esc(copy("phase." + p))}</span>`;
      if (active) li.setAttribute("aria-current", "step");
      stepsEl.appendChild(li);

      const d = el("span", "wz-dot" + (done ? " is-done" : "") + (active ? " is-active" : ""));
      dotsEl.appendChild(d);
    });
    const label = cur >= 0 ? copy("phase." + PHASES[cur]) : "";
    dotsEl.setAttribute("aria-hidden", "true");
    dotsEl.title = label;
  }

  /* --------------------------------------------------------------- status */
  function setStatus(text, isErr) {
    state.status = text;
    statusEl.textContent = text;
    statusEl.classList.toggle("is-err", !!isErr);
  }

  /* ------------------------------------------------------------- activity */
  function pushNarration(mdText) {
    state.narration.push(mdText);
    const block = el("div", "wz-narr");
    block.innerHTML = md(mdText);
    activityBody.appendChild(block);
    if (state.drawerOpen) activityBody.scrollTop = activityBody.scrollHeight;
    else {
      state.unread += 1;
      unreadEl.hidden = false;
      unreadEl.textContent = String(state.unread);
    }
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
  let cardSeq = 0;
  /* Cards are addressed by their server id. The secret flow needs it: when a
     "save" loses a race with a value that appeared in the file after the card
     was drawn, the server answers {state:"exists"} and RE-EMITS the same id with
     alreadySet:true. That must land as the same card changing its mind, not as a
     second card appearing below the first. */
  const cardsById = new Map();
  function mountCard(node, id) {
    node.classList.add("card");
    decorate(node, "card", cardSeq++);
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
  // Guide shows one card at a time; CSS does the hiding, this keeps focus sane.
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

  /* -- question ---------------------------------------------------------- */
  function questionCard(ev) {
    const node = cardShell("question", ev.header || "Choice", ev.question || "");
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
    const node = cardShell("permission", ev.tool || "Command", copy("perm.title"));
    node.querySelector(".card-title").dataset.copy = "perm.title";
    const body = node.querySelector(".card-body");
    body.innerHTML =
      `<pre class="cmd">${esc(ev.command || "")}</pre>` +
      (ev.description ? `<p class="card-note">${esc(ev.description)}</p>` : "");

    async function answer(action) {
      settleCard(node,
        action === "deny" ? "Skipped — nothing ran."
          : action === "always" ? "Allowed, and allowed for the rest of this run."
            : "Allowed.");
      await post("/decision", { id: ev.id, allow: action !== "deny", always: action === "always" });
    }
    actionBtn(node, "btn-primary", "act.allow", "Allow", () => answer("allow"));
    const always = actionBtn(node, "btn-outline", "act.always", "Allow for this run", () => answer("always"));
    // `shape` is the family the host would remember (e.g. `npm run *`) — worth a
    // tooltip on the button that commits to it, and nothing more.
    if (ev.shape) always.title = "Won't ask again this run for: " + ev.shape;
    actionBtn(node, "btn-danger", "act.deny", "Deny", () => answer("deny"));
    return mountCard(node, ev.id);
  }

  /* ---------------------------------------------------------------- panels */
  let panelSeq = 0;
  const panels = {};
  function panel(id, titleKey) {
    if (panels[id]) return panels[id];
    const node = el("section", "panel panel-" + id);
    node.innerHTML = `<h3 class="panel-title" data-copy="${titleKey}"></h3><div class="panel-body"></div>`;
    node.querySelector(".panel-title").textContent = copy(titleKey);
    decorate(node, "panel", panelSeq++);
    panelsEl.appendChild(node);
    panels[id] = node;
    return node;
  }

  /* -- checks ------------------------------------------------------------ */
  function upsertProbe(ev) {
    const p = panel("checks", "checks.title");
    let list = p.querySelector(".probe-list");
    if (!list) {
      const note = el("p", "panel-note");
      setCopy(note, "checks.note");
      p.querySelector(".panel-body").appendChild(note);
      list = el("ul", "probe-list");
      p.querySelector(".panel-body").appendChild(list);
    }
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
      } catch {
        dot.dataset.alive = "no";
        text.innerHTML = `Could not reach <code>${esc(url)}</code>.`;
      }
    }
    poll();
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(poll, 4000);
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
  }

  /* -- terminal ---------------------------------------------------------- */
  function terminal(kind, text) {
    state.finished = { kind, text };
    state.running = false;
    if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
    root.dataset.finished = kind;
    setRunning(false);
    const node = el("section", "panel panel-terminal");
    node.dataset.kind = kind;
    node.innerHTML = `<h3 class="panel-title">${esc(
      kind === "stopped" ? "Setup stopped" : kind === "error" ? "Setup hit an error" : "Setup finished"
    )}</h3><div class="panel-body"><p class="panel-note">${esc(text)}</p></div>`;
    const again = el("button", "btn btn-primary", "Start again");
    again.type = "button";
    again.onclick = () => { resetRun(); start(); };
    node.querySelector(".panel-body").appendChild(again);
    decorate(node, "panel", panelSeq++);
    panelsEl.appendChild(node);
    node.scrollIntoView({ block: "nearest", behavior: prefersReduced() ? "auto" : "smooth" });
  }

  function resetRun() {
    asksEl.innerHTML = "";
    cardsById.clear();
    panelsEl.innerHTML = "";
    Object.keys(panels).forEach((k) => delete panels[k]);
    $("#wz-receipt-list", root).innerHTML = "";
    $("#wz-receipts", root).hidden = true;
    activityBody.innerHTML = "";
    state.probes.clear();
    state.receipts = [];
    state.narration = [];
    state.unread = 0;
    unreadEl.hidden = true;
    state.phase = null;
    state.phaseSeen = new Set();
    state.finished = null;
    state.app = null;
    state.tts = null;
    delete root.dataset.finished;
    renderSteps();
  }

  /* ---------------------------------------------------------------- events */
  function handle(ev) {
    switch (ev.type) {
      /* Sent once on connect. A reloaded page rejoins the session where it is
         instead of showing a blank stage and a Start button for a run that is
         already half done. (`seq`/`at` ride on every event and are ignored.) */
      case "hello": {
        if (ev.repo) {
          const meta = $("#wz-meta", root);
          meta.hidden = false;
          meta.innerHTML = `<span class="wz-meta-k">Repo</span><code>${esc(ev.repo)}</code>` +
            (ev.envFileExists ? `<span class="wz-meta-k">.env.local</span><span>already present</span>` : "");
        }
        if (ev.phase && PHASES.includes(ev.phase)) handle({ type: "phase", id: ev.phase });
        if (ev.appPort) appPanel({ port: ev.appPort });
        if (ev.running) {
          setRunning(true);
          setStatus("Rejoined a setup session that is already running.");
        }
        break;
      }
      case "phase": {
        if (PHASES.includes(ev.id)) {
          state.phase = ev.id;
          state.phaseSeen.add(ev.id);
          PHASES.slice(0, PHASES.indexOf(ev.id)).forEach((p) => state.phaseSeen.add(p));
          root.dataset.phase = ev.id;
          renderSteps();
          if (ev.id === "voice") loadVoice();
        }
        break;
      }
      case "status": setStatus(ev.text || ""); break;
      case "narration": pushNarration(ev.md || ""); break;
      case "probe": upsertProbe(ev); break;
      case "question": questionCard(ev); break;
      case "secret": secretCard(ev); break;
      case "permission": permissionCard(ev); break;
      case "app": appPanel(ev); break;
      case "matrix": matrixPanel(ev.md || ""); break;
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
    // Stop is ALWAYS reachable while a run is live, and never a dead control
    // otherwise: it is disabled only when nothing is running.
    stopBtn.disabled = !on;
    $("#wz-msg", root).disabled = !on;
  }
  async function start() {
    setRunning(true);
    setStatus("Starting the setup assistant…");
    const out = await post("/start", { run: runSel.value });
    if (out && out.error) setRunning(false);
  }
  startBtn.onclick = start;
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
  buildSwitcher();
  let stored = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { /* private mode */ }
  applyVariant(stored || VARIANT_IDS[0]);
  setRunning(false);
  renderSteps();
  connect();

  // Exposed for the mock harness / DOM assertions. Read-only by convention.
  window.KPWizard = { state, handle, applyVariant, PHASES };
})();

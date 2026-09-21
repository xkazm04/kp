"use client";

/*
 * The onboarding studio — the app-native face of the installer.
 *
 * The standalone page (scripts/onboard-ui/) proved the mechanics and hit its
 * ceiling: one hand-written stylesheet, no motion, no themes. This is the same
 * engine seen through the product's own design system, and it is deliberately
 * NOT a port of that page's markup — the layout that survived (a calm left rail
 * carrying the plan, ONE card at a time on the stage, everything answered
 * shrinking into a receipt list) is rebuilt out of recipes, tokens and the
 * app's motion language.
 *
 * Three things it must never do, in order of how badly they would hurt:
 *
 *  1. Look broken. No fragment, a wizard that never answers, a session that was
 *     stopped in the terminal — every one of those is a calm, explanatory state
 *     that tells the operator what to type. This page is the first thing a new
 *     install sees.
 *  2. Claim more than the host said. The enforcement line renders only when the
 *     host affirms the flag behind it; a matrix state is read, not inferred;
 *     "queued-only" stays amber rather than being rounded up to green.
 *  3. Put the token anywhere but memory. It arrives in the URL fragment and is
 *     spent only against the wizard's own origin (see useWizardSession).
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Play, Square } from "lucide-react";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_PAD,
  DIVIDER,
  EYEBROW,
  META_LABEL,
  NOTICE,
  PANEL,
  PANEL_SUNKEN,
  SECTION,
} from "@/app/_components/ui/recipes";
import { ActivityDrawer } from "./ActivityDrawer";
import { DecisionCard } from "./DecisionCards";
import { MatrixPanel } from "./MatrixPanel";
import { PlanRail } from "./PlanRail";
import { AssessSummary, ProbePanel } from "./ProbePanel";
import { AppearanceToggle, CommandBlock, ConnectionChip } from "./StudioBits";
import { VoicePanel } from "./VoicePanel";
import { COPY, RUN_OPTIONS, START_COMMAND } from "./copy";
import { useWizardSession, type WizardClient } from "./useWizardSession";

/* ── the app the installer booted ───────────────────────────────────────── */

/**
 * `/app/health` always answers 200 with `{ok, port, status?, reason?}` — the
 * liveness fact is in the BODY, not the HTTP status, so a transport-level
 * `res.ok` would report every install as running.
 */
function BootPanel({ client, port }: { client: WizardClient; port: number }) {
  const [alive, setAlive] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const url = `http://localhost:${port}`;

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const res = await client.getJSON("/app/health");
        if (!live) return;
        const body = res.json as { ok?: boolean; reason?: string; status?: number } | null;
        setAlive(body?.ok === true);
        setReason(body?.status === 401 ? "password-protected — which counts as answering" : (body?.reason ?? null));
      } catch {
        if (live) {
          setAlive(false);
          setReason(null);
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client]);

  return (
    <section className={`${PANEL} ${CARD_PAD}`}>
      <h2 className="font-serif text-h2 text-ink">{COPY.bootTitle}</h2>
      <p className="mt-1 flex items-center gap-2 text-body text-steel">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            alive === null ? "bg-stone-300" : alive ? "bg-moss" : "bg-dial-amber"
          }`}
        />
        {alive === null
          ? `${COPY.bootChecking} ${url}…`
          : alive
            ? `KP is running at ${url}${reason ? ` (${reason})` : ""}`
            : `Not answering yet on ${url}${reason ? ` — ${reason}` : " — it may still be compiling."}`}
      </p>
      <a href={`${url}/`} target="_blank" rel="noopener" className={`${BTN_SECONDARY} mt-3 h-10 px-4`}>
        {COPY.bootOpen}
      </a>
    </section>
  );
}

/* ── nothing attached ───────────────────────────────────────────────────── */

/**
 * Three different things, one calm shape. "No fragment" is a landing; "nothing
 * answered" is a server to restart; "403" is a link to replace. Collapsing them
 * into one message would tell an operator to restart a server that is running
 * fine, so the page finds out which it is (see `Failure`) and says that.
 */
function EmptyState({
  kind,
  onRetry,
}: {
  kind: "none" | "absent" | "denied";
  onRetry: () => void;
}) {
  const title = kind === "denied" ? COPY.deniedTitle : kind === "absent" ? COPY.lostTitle : COPY.emptyTitle;
  const body = kind === "denied" ? COPY.deniedBody : kind === "absent" ? COPY.lostBody : COPY.emptyBody;
  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <p className={EYEBROW}>{COPY.emptyEyebrow}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{title}</h1>
      <p className="mt-2 text-body text-steel">{body}</p>
      <div className={`${DIVIDER} mt-4 pt-4`}>
        <p className={META_LABEL}>{COPY.emptyHowTitle}</p>
        <div className="mt-2">
          <CommandBlock>{START_COMMAND}</CommandBlock>
        </div>
        <p className="mt-2 text-sm text-steel">{COPY.emptyHowNote}</p>
      </div>
      {/* Only offered where retrying can actually work. A refused token is not
          a transient failure and a button that re-refuses it is a lie. */}
      {kind === "absent" ? (
        <button type="button" onClick={onRetry} className={`${BTN_SECONDARY} mt-4 h-10 px-4`}>
          {COPY.emptyRetry}
        </button>
      ) : null}
    </div>
  );
}

/* ── the studio ─────────────────────────────────────────────────────────── */

export function SetupStudio() {
  const session = useWizardSession();
  const { state, client } = session;
  const reduced = useReducedMotion();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [run, setRun] = useState(RUN_OPTIONS[0].value);
  // The card the stage is showing. The host fans one AskUserQuestion into one
  // card per question and holds the CLI reply until every card is in, so
  // answering in arrival order is correct — and one card at a time is what the
  // stage is for.
  const card = state.cards[0] ?? null;
  const queued = Math.max(0, state.cards.length - 1);

  const activity = useMemo(() => state.activity, [state.activity]);

  // The empty state is a VERDICT, not a default: it waits for the client to have
  // read the fragment, so a server render never flashes "no session attached".
  if (!session.resolved) return <div className="min-h-screen bg-paper" aria-hidden />;
  // Never greeted AND we know why (or the browser gave up): there is no session
  // to render, so render the reason instead. `failure` is what makes this fire
  // for a port nothing is listening on — that stream stays in CONNECTING and
  // retries forever, so waiting for `lost` would wait forever with a live-looking
  // page on screen.
  if (!session.target || (!state.greeted && (state.failure !== null || state.connection === "lost"))) {
    const kind = !session.target ? "none" : state.failure === "denied" ? "denied" : "absent";
    return (
      <main className="min-h-screen bg-paper px-4 py-12">
        {/* The brand row and the appearance control ride the empty state too: it
            is a real page a fresh operator can sit on for a while, and a surface
            that cannot be switched to the theme they set everywhere else reads as
            a different product. */}
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
              <span className="font-serif text-h3 text-ink">{COPY.brand}</span>
            </div>
            <AppearanceToggle />
          </div>
          <EmptyState kind={kind} onRetry={session.reconnect} />
        </div>
      </main>
    );
  }

  const busy = state.running && !state.finished;

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-3 lg:hidden">
            <KandidateMark className="h-9 w-9 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
            <div>
              <p className={EYEBROW}>{COPY.emptyEyebrow}</p>
              <h1 className="font-serif text-h2 text-ink">{COPY.title}</h1>
            </div>
          </div>
          <div className="hidden lg:block">
            <p className={EYEBROW}>{COPY.emptyEyebrow}</p>
            <h1 className="mt-1 font-serif text-display text-ink">{COPY.title}</h1>
            <p className="mt-1 max-w-xl text-body text-steel">{COPY.sub}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectionChip state={state.connection} />
            <AppearanceToggle />
            {busy ? (
              <button
                type="button"
                disabled={state.stopPending}
                onClick={() => void session.stop()}
                className={`${BTN_SECONDARY} h-9 px-3`}
              >
                <Square size={14} aria-hidden />
                {state.stopPending ? COPY.stopping : COPY.stop}
              </button>
            ) : (
              <button
                type="button"
                disabled={state.connection === "lost"}
                onClick={() => void session.start("start")}
                className={`${BTN_PRIMARY} h-9 px-4`}
              >
                <Play size={14} aria-hidden />
                {state.finished ? COPY.startAgain : COPY.start}
              </button>
            )}
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`${BTN_GHOST} h-9 px-3`}
            >
              {COPY.advanced}
            </button>
          </div>
        </header>

        {advancedOpen ? (
          <div className={`${PANEL_SUNKEN} mt-4 flex flex-wrap items-end gap-3 p-4`}>
            <label className="flex flex-col gap-1">
              <span className={META_LABEL}>{COPY.runOnly}</span>
              <select
                value={run}
                onChange={(e) => setRun(e.target.value)}
                className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
              >
                {RUN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void session.start(run)}
              className={`${BTN_SECONDARY} h-9 px-4`}
            >
              {COPY.run}
            </button>
            <p className="w-full text-sm text-steel">{COPY.advNote}</p>
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[15rem_1fr]">
          <aside className="hidden lg:flex lg:flex-col">
            <PlanRail state={state} />
          </aside>

          <div className={SECTION}>
            {/* Status. One line of "what is happening now", live-announced. */}
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  busy ? "animate-pulse bg-coral motion-reduce:animate-none" : "bg-stone-300"
                }`}
              />
              <p role="status" aria-live="polite" className={`text-body ${state.statusIsError ? "text-coral" : "text-steel"}`}>
                {state.status}
              </p>
            </div>

            {/* The one claim this page may make about permissions, and only when
                the host affirms the flag behind it. */}
            {state.enforcement?.skipFlagBlocked ? (
              <p
                className={`${NOTICE("info")} px-3 py-1.5 text-sm`}
                title={state.enforcement.autoAllowPolicy ?? undefined}
              >
                {COPY.enforceOn}
                {state.enforcement.mode ? ` · permission mode: ${state.enforcement.mode}` : ""}
              </p>
            ) : null}

            {/* The tripwire. A command that ran without being offered is the one
                notice the operator must not have to open a drawer to find. */}
            {state.warnings.map((text, i) => (
              <p key={`${i}-${text}`} role="status" className={`${NOTICE("amber")} flex gap-2 px-3 py-2 text-sm`}>
                <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  <strong>{COPY.unrequestedTitle}.</strong> {text}
                </span>
              </p>
            ))}

            {/* What just happened to the last card. It matters most when
                `foreign` is true: the standalone page stays open behind the
                hand-off tab, so a card can be answered THERE and disappear from
                under the operator's cursor here. A card that vanishes with no
                explanation reads as a bug; one that says who answered it reads
                as two windows onto one session, which is what it is. */}
            <AnimatePresence initial={false}>
              {state.lastResolved && !card ? (
                <motion.p
                  key={state.lastResolved.id}
                  role="status"
                  initial={reduced ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                  className={`${PANEL_SUNKEN} flex flex-wrap gap-x-2 px-3 py-2 text-sm`}
                  data-resolved={state.lastResolved.foreign ? "elsewhere" : "here"}
                >
                  <Check size={15} aria-hidden className="mt-0.5 shrink-0 text-moss" />
                  <span className="text-ink">{state.lastResolved.text}</span>
                  {state.lastResolved.foreign ? <span className="text-steel">{COPY.resolvedElsewhere}</span> : null}
                </motion.p>
              ) : null}
            </AnimatePresence>

            {state.assessSummary ? (
              <AssessSummary headline={state.assessSummary.headline} rows={state.assessSummary.rows} />
            ) : null}

            {/* ONE card at a time, crossfaded. */}
            <AnimatePresence mode="wait" initial={false}>
              {card ? (
                <motion.div
                  key={card.id}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduced ? 0.12 : 0.22, ease: "easeOut" }}
                >
                  <DecisionCard
                    card={card}
                    onAnswer={(c, picked) => void session.answer(c, picked)}
                    onDecide={(id, allow) => void session.decide(id, allow)}
                    onSecret={(id, name, action, value) => void session.saveSecret(id, name, action, value)}
                  />
                  {queued > 0 ? (
                    <p className="mt-2 text-sm text-steel">
                      {queued} {COPY.cardQueue}
                    </p>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {state.probePanelOpen ? <ProbePanel rows={state.probes} assessing={state.assessing} /> : null}

            {state.appPort && client ? <BootPanel client={client} port={state.appPort} /> : null}

            {state.voiceReached && client ? (
              <VoicePanel
                client={client}
                onChose={(provider) => {
                  session.note("Spoken output", provider.name);
                  session.setStatus(`${provider.name} is now the default speech engine.`);
                  void client.post("/choice/tts", { provider: provider.id });
                }}
                onSkipped={() => {
                  session.note("Spoken output", "skipped");
                  session.setStatus("Spoken output skipped — you can set it up later.");
                  void client.post("/choice/tts", { skipped: true });
                }}
              />
            ) : null}

            {state.matrix ? (
              <MatrixPanel
                matrix={state.matrix}
                reward={!state.sawWork}
                canAddOn={busy}
                appPort={state.appPort}
                onAddOn={(name) => {
                  session.setStatus(`Asked the assistant to set up ${name} as well.`);
                  void session.message(`Set up ${name} as well, before we finish.`, false);
                }}
              />
            ) : null}

            {state.finished ? (
              <section className={`${PANEL} ${CARD_PAD}`} data-terminal={state.finished.kind}>
                <h2 className="font-serif text-h2 text-ink">
                  {state.finished.kind === "stopped"
                    ? COPY.titleStopped
                    : state.finished.kind === "error"
                      ? COPY.titleError
                      : COPY.titleDone}
                </h2>
                <p className="mt-1 text-body text-steel">{state.finished.text}</p>
                <button type="button" onClick={() => void session.start("start")} className={`${BTN_PRIMARY} mt-3 h-10 px-4`}>
                  {COPY.startAgain}
                </button>
              </section>
            ) : null}

            {state.receipts.length ? (
              <section className={`${PANEL_SUNKEN} p-4`}>
                <p className={META_LABEL}>{COPY.receiptsTitle}</p>
                <ul className="mt-2 space-y-1">
                  {state.receipts.map((receipt) => (
                    <li key={receipt.seq} className="flex flex-wrap gap-x-2 text-sm">
                      <span className="font-semibold text-ink">{receipt.label}</span>
                      <span className="text-steel">{receipt.value}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <ActivityDrawer
              entries={activity}
              unread={state.unread}
              open={drawerOpen}
              onToggle={() => {
                setDrawerOpen((v) => {
                  if (!v) session.markActivityRead();
                  return !v;
                });
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

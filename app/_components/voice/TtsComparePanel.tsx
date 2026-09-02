"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTts } from "@/packages/voice-tts/src/react/useTts";
import { LOCALES, type Locale } from "@/i18n/locales";
import type { TtsProviderId, TtsStatus } from "@/packages/voice-tts/src/index";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, FIELD } from "@/app/_components/ui/recipes";

// One sentence per SHIPPED locale, not per locale someone got round to. The
// panel exists to answer "does this engine sound acceptable to our users", and
// two of the four languages the app ships in could not be asked: a German
// operator comparing Piper against ElevenLabs was listening to English, which is
// the one comparison that does not decide anything. Derived from LOCALES below,
// so a fifth locale is a compile error here rather than a silently missing row.
const SAMPLE: Record<Locale, string> = {
  en: "Hi, I'm the AI assistant running a short first-round screen. This call is transcribed. Could you start by telling me about your most recent role?",
  cs: "Dobrý den, jsem asistent umělé inteligence a povedu krátký úvodní rozhovor. Hovor se přepisuje. Můžete mi nejprve říct o své poslední pozici?",
  de: "Guten Tag, ich bin die KI-Assistenz und führe ein kurzes Erstgespräch. Dieses Gespräch wird transkribiert. Erzählen Sie mir zu Beginn bitte von Ihrer letzten Position.",
  fr: "Bonjour, je suis l'assistant IA qui mène ce court entretien de préqualification. Cet appel est transcrit. Pouvez-vous commencer par me parler de votre poste le plus récent ?",
};

/** Each language named in ITSELF — the one label a speaker of it recognises at a
 *  glance, and the reason these are not translation keys. */
const LANGUAGE_ENDONYM: Record<Locale, string> = {
  en: "English",
  cs: "Čeština",
  de: "Deutsch",
  fr: "Français",
};


/** Side-by-side spoken-output compare: every provider the install allows, the
 *  probe state of each, one sentence spoken by whichever the user picks. Lives
 *  in the internal lab only; the candidate surfaces never show a provider. */
export function TtsComparePanel() {
  const t = useTranslations("interview.voice.ttsCompare");
  const tts = useTts({ endpoint: "/api/tts" });
  const probeLabel = (p: TtsStatus): string =>
    p.probe.state === "ready" ? (p.kind === "local" ? t("stateLocalReady") : t("stateCloudReady")) : p.probe.state === "absent" ? t("stateAbsent") : t("stateBroken");
  const [lang, setLang] = useState<Locale>("en");
  const [text, setText] = useState(SAMPLE.en);
  const [picked, setPicked] = useState<TtsProviderId | null>(null);

  useEffect(() => {
    void tts.refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providers = tts.providers ?? [];
  const offered = providers.filter((p) => p.allowed);
  const active = picked ?? offered.find((p) => p.preferred)?.id ?? offered.find((p) => p.probe.state === "ready")?.id ?? null;
  const busy = tts.playback === "synthesizing";

  return (
    <section aria-labelledby="tts-compare-title">
      <p className={EYEBROW}>{t("eyebrow")}</p>
      <h2 id="tts-compare-title" className="mt-1 font-serif text-title text-ink">
        {t("title")}
      </h2>
      <p className="mt-1 max-w-2xl text-body text-steel">
        {t("intro", { preferredVar: "KP_TTS_PROVIDER", allowedVar: "KP_TTS_PROVIDERS" })}
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label={t("providerGroup")}>
        {offered.map((p) => {
          const ready = p.probe.state === "ready";
          const isActive = active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={!ready || busy}
              onClick={() => setPicked(p.id)}
              title={p.probe.state !== "ready" ? `${p.probe.reason}${"setup" in p.probe && p.probe.setup ? ` — ${p.probe.setup}` : ""}` : undefined}
              className={`focus-ring rounded-lg border px-3 py-2 text-left text-base transition-colors ${
                isActive ? "border-ink bg-white text-ink shadow-panel" : "border-stone-200 bg-paper text-steel hover:text-ink"
              } ${!ready ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span className="block">
                {p.label}
                {p.preferred ? <span className="ml-2 text-meta uppercase text-coral">{t("default")}</span> : null}
              </span>
              <span className={`block text-meta ${ready ? "text-moss" : "text-coral"}`}>{probeLabel(p)}</span>
            </button>
          );
        })}
        {tts.providers && offered.length === 0 ? <p className="text-body text-steel">{t("noneAllowed")}</p> : null}
        {!tts.providers ? <p className="text-body text-steel">{t("probing")}</p> : null}
      </div>

      {providers.some((p) => p.allowed && p.probe.state !== "ready") ? (
        <ul className="mt-3 space-y-1 text-meta text-steel">
          {providers
            .filter((p) => p.allowed && p.probe.state !== "ready")
            .map((p) => (
              <li key={p.id}>
                <span className="text-ink">{p.label}</span>: {p.probe.state === "ready" ? null : p.probe.reason}
                {p.probe.state === "absent" && p.probe.setup ? <> — {p.probe.setup}</> : null}
              </li>
            ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border border-stone-200 bg-paper p-1">
          {LOCALES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={lang === v}
              disabled={busy}
              onClick={() => {
                setLang(v);
                if (text === SAMPLE[lang]) setText(SAMPLE[v]);
              }}
              className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${lang === v ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"}`}
            >
              {LANGUAGE_ENDONYM[v]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
          disabled={!active || busy || !text.trim()}
          onClick={() => void tts.speak({ text, language: lang, provider: active, format: "chat" })}
        >
          {busy ? t("synthesizing") : t("speak")}
        </button>
        <button type="button" className={`${BTN_SECONDARY} h-9 px-4 text-sm`} disabled={tts.playback === "idle"} onClick={tts.stop}>
          {t("stop")}
        </button>
        {tts.playback === "blocked" ? (
          <button type="button" className={`${BTN_SECONDARY} h-9 px-4 text-sm`} onClick={() => void tts.resume()}>
            {t("resume")}
          </button>
        ) : null}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1200}
        aria-label={t("textLabel")}
        className={`${FIELD} mt-3 w-full`}
      />

      <p className="mt-2 min-h-5 text-meta text-steel" aria-live="polite">
        {tts.error ? <span className="text-coral">{tts.error}</span> : null}
        {!tts.error && tts.served ? (
          <>
            <span className="text-ink">
              {t("spokenBy", { provider: providers.find((p) => p.id === tts.served?.provider)?.label ?? tts.served.provider, ms: tts.served.firstAudioMs })}
            </span>
            {tts.progress && tts.progress.total > 1 ? <span> · {t("chunks", { spoken: tts.progress.spoken, total: tts.progress.total })}</span> : null}
            {tts.served.fallbackFrom ? <span className="text-coral"> {t("fellBack", { provider: tts.served.fallbackFrom })}</span> : null}
          </>
        ) : null}
        {tts.error && tts.progress && tts.progress.spoken > 0 ? <span> · {t("truncated", { spoken: tts.progress.spoken, total: tts.progress.total })}</span> : null}
      </p>
    </section>
  );
}

"use client";

// Layout-level crash screen. Next swaps this in FOR the root layout when the
// layout itself throws, so nothing layout.tsx provides exists here: no
// NextIntlClientProvider (hence no useTranslations — both languages render
// stacked), no next/font variables (system font stack below), and per the
// App Router contract this file must define its own <html>/<body>.
//
// globals.css is imported directly because on this path the root layout —
// and with it the layout's own CSS import — is gone from the tree; the
// bundler dedupes the second import whenever both are present. That import
// is what makes the brand tokens (--color-paper/--color-ink/--color-steel/
// --color-coral/--color-stone-200/--color-white, --shadow-panel) resolvable,
// so the screen still reads as the product with every provider down. The
// body rule in globals.css also paints the paper canvas + ink text for free.
import "./globals.css";

import { useEffect } from "react";
import { reportBoundaryError } from "@/app/_lib/sentry-client";

// Copy lives in constants rather than JSX literals, one entry per language
// (en first, cs second — no locale resolution exists here, so both show).
// This also keeps eslint clean without an override entry: the
// i18next/no-literal-string rule runs in `jsx-text-only` mode (see
// eslint.config.mjs), which flags literal text NODES but not rendered
// variables — so `{COPY.map(…)}` passes where inline literals would warn.
const COPY = [
  {
    lang: "en",
    title: "Something went wrong",
    body: "An unexpected error took this page down. Reloading usually fixes it.",
  },
  {
    lang: "cs",
    title: "Něco se pokazilo",
    body: "Neočekávaná chyba shodila tuto stránku. Opětovné načtení to obvykle spraví.",
  },
] as const;

const RETRY_LABEL = "Try again · Zkusit znovu";
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // A layout-level crash is the highest-signal error the app has. The report
    // is DSN-gated and no-ops on the default local-first deploy
    // (app/_lib/sentry-client.ts); the console always keeps the stack.
    console.error("Root layout crashed:", error);
    reportBoundaryError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: SANS,
            background: "var(--color-paper)",
            color: "var(--color-ink)",
          }}
        >
          <div
            role="alert"
            style={{
              width: "100%",
              maxWidth: "28rem",
              borderRadius: "12px",
              border: "1px solid var(--color-stone-200)",
              background: "var(--color-white)",
              boxShadow: "var(--shadow-panel)",
              padding: "28px",
              textAlign: "center",
            }}
          >
            {COPY.map((c) => (
              <div key={c.lang} lang={c.lang} style={{ marginBottom: "16px" }}>
                <h1 style={{ margin: 0, fontSize: "22px", lineHeight: 1.3, fontWeight: 600 }}>{c.title}</h1>
                <p style={{ margin: "6px 0 0", fontSize: "15px", lineHeight: 1.5, color: "var(--color-steel)" }}>
                  {c.body}
                </p>
              </div>
            ))}
            {error?.digest ? (
              <p style={{ margin: "0 0 16px", fontFamily: "ui-monospace, monospace", fontSize: "13px", color: "var(--color-steel)" }}>
                {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => reset()}
              style={{
                border: 0,
                borderRadius: "8px",
                padding: "10px 18px",
                fontFamily: SANS,
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
                background: "var(--color-coral)",
                color: "var(--color-white)",
              }}
            >
              {RETRY_LABEL}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

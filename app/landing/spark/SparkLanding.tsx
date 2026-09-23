"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FeatureSpotlight } from "./FeatureSpotlight";
import {
  arrowStep,
  hashAfterClose,
  parseSpotlightHash,
  spotlightHash,
  stepPreview,
  urlWithHash,
  type PreviewKey
} from "./previews/order";
import PricingSection from "./PricingSection";
import SectionRail from "./SectionRail";
import Topbar from "./sections/Topbar";
import Hero from "./sections/Hero";
import Marquee from "./sections/Marquee";
import Proof from "./sections/Proof";
import FeatureGrid from "./sections/FeatureGrid";
import VoiceTeaser from "./sections/VoiceTeaser";
import TrustPillars from "./sections/TrustPillars";
import Cta from "./sections/Cta";
import Footer from "./sections/Footer";

/*
 * Variant A — "Spark". Sticker-sheet maximalism: thick ink outlines, hard
 * offset shadows, rotated badges, a clay mascot and two signature interactions
 * — stamp the CV pile, and peek inside any feature card to pop open its live
 * product spotlight. Fixed art direction → literal hexes (the
 * docs/design/README.md exemption).
 *
 * This file is the page's composition and nothing else. Each band is its own
 * module under ./sections/; the nine product mockups the feature cards open
 * live under ./previews/. What stays here is the one piece of state two of
 * those bands share: which spotlight is open, because the modal renders at the
 * page root while the cards that drive it sit inside FeatureGrid.
 *
 * `signupOpen` is not state — it is deployment policy resolved server-side
 * (KP_SIGNUP_ENABLED, see app/page.tsx) and passed through untouched to the two
 * bands that act on it: the hero's primary CTA and the closing one, which are
 * the page's only two "start here" buttons.
 */
export default function SparkLanding({ signupOpen = false }: { signupOpen?: boolean }) {
  const [preview, setPreview] = useState<PreviewKey | null>(null);
  const [pinned, setPinned] = useState(false);
  // Closing the spotlight while the cursor sits on a card makes the browser
  // re-fire hover on that card the instant the overlay unmounts — which would
  // reopen what the user just dismissed. Ignore hover-opens for a beat.
  const suppressHoverUntil = useRef(0);

  /*
   * A PINNED spotlight is an address: `/#spotlight-<key>` (./previews/order.ts).
   * `priorHash` is undefined while the URL is not ours to restore, and holds
   * the hash that was there before the dialog opened while it is - so closing
   * puts back `#features` (or nothing) instead of leaving a dead spotlight
   * link. Every write is replaceState, never pushState, for the reason
   * SectionRail gives: stepping through nine previews is a scrubber, not nine
   * destinations to Back through. Path and query are kept verbatim, so the
   * canonical URL and `?lang=` never move; hover peeks are never addressed.
   */
  const priorHash = useRef<string | null | undefined>(undefined);

  const writeHash = useCallback((hash: string) => {
    const { pathname, search } = window.location;
    history.replaceState(null, "", urlWithHash(pathname, search, hash));
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
    setPinned(false);
    suppressHoverUntil.current = Date.now() + 350;
    if (priorHash.current !== undefined) {
      writeHash(hashAfterClose(priorHash.current));
      priorHash.current = undefined;
    }
  }, [writeHash]);

  const hoverOpen = useCallback(
    (key: PreviewKey) => {
      if (pinned || Date.now() < suppressHoverUntil.current) return;
      setPreview(key);
    },
    [pinned]
  );

  // Every surface that pins a spotlight (a FeatureGrid card, the VoiceTeaser
  // CTA, a /#spotlight-<key> link) comes through here, so all of them get the
  // address with no per-surface code.
  const pinOpen = useCallback(
    (key: PreviewKey) => {
      setPreview(key);
      setPinned(true);
      if (priorHash.current === undefined) {
        const current = window.location.hash;
        priorHash.current = parseSpotlightHash(current) ? null : current || null;
      }
      writeHash(spotlightHash(key));
    },
    [writeHash]
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!preview || !pinned) return;
      pinOpen(stepPreview(preview, dir));
    },
    [preview, pinned, pinOpen]
  );

  const leave = useCallback(() => setPreview(null), []);

  // Arrive at (or navigate in-page to) `#spotlight-<key>` -> pin that preview.
  // Read after mount, never during render: the server has no hash, and the
  // first client render must match what it sent.
  useEffect(() => {
    const fromHash = () => {
      const key = parseSpotlightHash(window.location.hash);
      if (key) pinOpen(key);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [pinOpen]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePreview();
        return;
      }
      // Arrows walk only a PINNED spotlight; a hover peek has no controls.
      if (!pinned) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const dir = arrowStep(e, el);
      if (dir === null) return;
      e.preventDefault();
      step(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, pinned, closePreview, step]);

  return (
    <main className="min-h-screen overflow-x-clip bg-[#fdf8ee] text-[#17202a] font-[family-name:var(--font-spark-body)]">
      <Topbar />
      <Hero signupOpen={signupOpen} />
      <Marquee />
      {/* The wedge band leads; the nine-card FeatureGrid is demoted below it —
          the verified-work story is the headline, the grid is the inventory.
          A "how it works" band used to sit between them, re-telling the funnel
          in three generic steps; /about tells the same story as a scroll-drawn
          eight-phase timeline (ABOUT_STEP_KEYS), so the landing no longer
          carries the short, worse version. */}
      <Proof />
      <FeatureGrid preview={preview} pinned={pinned} onHoverOpen={hoverOpen} onPin={pinOpen} onLeave={leave} />
      <VoiceTeaser onPreview={() => pinOpen("voice")} />
      <TrustPillars />
      <PricingSection />
      <Cta signupOpen={signupOpen} />
      <Footer />

      <SectionRail />
      <FeatureSpotlight preview={preview} pinned={pinned} onClose={closePreview} onStep={step} />
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FeatureSpotlight } from "./FeatureSpotlight";
import type { PreviewKey } from "./previews";
import PricingSection from "./PricingSection";
import SectionRail from "./SectionRail";
import Topbar from "./sections/Topbar";
import Hero from "./sections/Hero";
import Marquee from "./sections/Marquee";
import Steps from "./sections/Steps";
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
 */
export default function SparkLanding() {
  const [preview, setPreview] = useState<PreviewKey | null>(null);
  const [pinned, setPinned] = useState(false);
  // Closing the spotlight while the cursor sits on a card makes the browser
  // re-fire hover on that card the instant the overlay unmounts — which would
  // reopen what the user just dismissed. Ignore hover-opens for a beat.
  const suppressHoverUntil = useRef(0);

  const closePreview = useCallback(() => {
    setPreview(null);
    setPinned(false);
    suppressHoverUntil.current = Date.now() + 350;
  }, []);

  const hoverOpen = useCallback(
    (key: PreviewKey) => {
      if (pinned || Date.now() < suppressHoverUntil.current) return;
      setPreview(key);
    },
    [pinned]
  );

  const pinOpen = useCallback((key: PreviewKey) => {
    setPreview(key);
    setPinned(true);
  }, []);

  const leave = useCallback(() => setPreview(null), []);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, closePreview]);

  return (
    <main className="min-h-screen overflow-x-clip bg-[#fdf8ee] text-[#17202a] font-[family-name:var(--font-spark-body)]">
      <Topbar />
      <Hero />
      <Marquee />
      <Steps />
      <FeatureGrid preview={preview} pinned={pinned} onHoverOpen={hoverOpen} onPin={pinOpen} onLeave={leave} />
      <VoiceTeaser />
      <TrustPillars />
      <PricingSection />
      <Cta />
      <Footer />

      <SectionRail />
      <FeatureSpotlight preview={preview} pinned={pinned} onClose={closePreview} />
    </main>
  );
}

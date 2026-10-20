"use client";

import type { CSSProperties, RefObject } from "react";
import { useTranslations } from "next-intl";
import { DemoCta, StartCta } from "../../chrome/Ctas";
import { GLYPH } from "../../chrome/glyphs";
import Stepper from "../../chrome/Stepper";
import { headlineFit } from "../headlineFit";
import { FeatureArt } from "./art";
import { FEATURE_COUNT, FEATURES, twoDigits, type FeatureKey } from "./featureData";
import { ScenePanel } from "./panels/ScenePanel";
import { vars } from "./panels/kit";

/*
 * The feature scene (prototype index.html `#scene`, "level 2/3"): a full-screen
 * dialog in the feature's own colour with its medallion, name, one-line pitch,
 * body and the stylised product panel; "Look closer" (level 3) swaps in the
 * panel's detailed view and the three pins. The chrome Stepper walks all nine.
 *
 * Presentational: FeatureRing owns every state and handler and portals this
 * into the site root (a fixed overlay must not sit inside a revealed band, see
 * site/README.md). The open/close circle wipe is the CSS transition on
 * `clip-path` (css/land-scene.css); `clip` is the inline start / end circle.
 */
const LOOK_BACK = "↖";

/** The four floating dots around the scene's art (prototype BITS). */
const BITS: readonly CSSProperties[] = [
  { left: "4%", top: "12%", width: 20, height: 20 },
  { right: "6%", top: "22%", width: 14, height: 14, animationDelay: "-2s" },
  { left: "10%", bottom: "14%", width: 16, height: 16, animationDelay: "-4s" },
  { right: "12%", bottom: "8%", width: 24, height: 24, animationDelay: "-1s" }
];

export type SceneProps = {
  signupOpen: boolean;
  idx: number;
  shown: boolean;
  grown: boolean;
  detail: boolean;
  swapping: boolean;
  dir: 1 | -1;
  center: { cx: string; cy: string };
  clip: string | undefined;
  mobile: boolean;
  sceneRef: RefObject<HTMLDivElement | null>;
  mainRef: RefObject<HTMLDivElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onLook: () => void;
  onGoto: (i: number, dir?: 1 | -1) => void;
};

export default function Scene({
  signupOpen,
  idx,
  shown,
  grown,
  detail,
  swapping,
  dir,
  center,
  clip,
  mobile,
  sceneRef,
  mainRef,
  titleRef,
  onBack,
  onLook,
  onGoto
}: SceneProps) {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  const f = FEATURES[idx];
  const prev = FEATURES[(idx + FEATURE_COUNT - 1) % FEATURE_COUNT];
  const next = FEATURES[(idx + 1) % FEATURE_COUNT];
  const name = (key: FeatureKey) => tl(`features.${key}.title`);
  const backLabel = mobile ? t("scene.backShort") : detail ? t("scene.backToScene") : t("scene.back");
  const classes = ["scene", grown ? "is-open" : null, detail ? "is-detail" : null].filter(Boolean).join(" ");
  const mockClasses = ["sc-mock", f.console ? "is-b3" : null, f.console && detail ? "is-det" : null].filter(Boolean).join(" ");

  return (
    <div
      ref={sceneRef}
      className={classes}
      id="scene"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sceneTitle"
      hidden={!shown}
      style={{ ...vars({ "--g": f.ground, "--d": f.deep, "--s": f.soft, "--cx": center.cx, "--cy": center.cy }), clipPath: clip }}
    >
      <div className="sc-ground" />
      <div className="sc-orb" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <header className="sc-bar">
        <button className="sc-back" type="button" onClick={onBack}>
          <span aria-hidden="true">{GLYPH.prev}</span> <span>{backLabel}</span>
        </button>
        <nav className="sc-crumb" aria-label={t("scene.crumbs")}>
          <span>{tl("nav.features")}</span>
          <span>{name(f.key)}</span>
          <span hidden={!detail}>{t("scene.crumbLook")}</span>
        </nav>
        <div className="sc-cta">
          <StartCta signupOpen={signupOpen} placement="scene" />
          <DemoCta />
        </div>
      </header>
      <div ref={mainRef} className={swapping ? "sc-main is-swapping" : "sc-main"} style={vars({ "--dir": dir })}>
        <div className="sc-art re" key={idx}>
          <FeatureArt feature={f.key} />
          {BITS.map((style, i) => (
            <i key={i} className="bit" style={style} />
          ))}
        </div>
        <div className="sc-copy">
          <p className="sc-count">
            {t.rich("scene.count", { n: twoDigits(f.n), total: twoDigits(FEATURE_COUNT), b: (chunks) => <b>{chunks}</b> })}
          </p>
          <h2 id="sceneTitle" ref={titleRef} tabIndex={-1} style={vars({ "--st-em": headlineFit(name(f.key)).line })}>
            {name(f.key)}
          </h2>
          <p className="sc-line">{t(`items.${f.key}.line`)}</p>
          <p className="sc-body">{tl(`features.${f.key}.body`)}</p>
          <div className="sc-stage">
            <button className="btn btn-sm look" type="button" aria-expanded={detail} onClick={onLook}>
              {detail ? t("scene.lookBack") : t("scene.look")} <span aria-hidden="true">{detail ? LOOK_BACK : GLYPH.look}</span>
            </button>
            <div className={mockClasses}>
              {/* A console panel is a different component under Look closer (remount);
                  B/1's own panels stay as they are, entrance not replayed. */}
              <ScenePanel key={f.console ? `${f.key}-${detail ? "d" : "m"}` : f.key} feature={f} detail={detail} />
            </div>
          </div>
        </div>
        <ol className="sc-pins" aria-label={t("scene.pins")}>
          <li>{t(`items.${f.key}.pin1`)}</li>
          <li>{t(`items.${f.key}.pin2`)}</li>
          <li>{t(`items.${f.key}.pin3`)}</li>
        </ol>
      </div>
      <Stepper
        variant="scene"
        ariaLabel={t("scene.stepper")}
        dotsLabel={t("scene.dots")}
        steps={FEATURES.map((x) => ({ label: t("scene.dot", { name: name(x.key), n: x.n, total: FEATURE_COUNT }) }))}
        active={idx}
        onSelect={(i) => onGoto(i)}
        onPrev={() => onGoto(idx - 1, -1)}
        onNext={() => onGoto(idx + 1, 1)}
        prevLabel={name(prev.key)}
        nextLabel={name(next.key)}
      />
    </div>
  );
}

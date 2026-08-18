import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/app/_lib/og-fonts";
import { PAPER, INK, CORAL } from "@/app/_lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const fonts = await loadOgFonts([{ family: "Fraunces", weight: 700 }]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PAPER,
          color: CORAL,
          fontFamily: "Fraunces, serif",
          fontSize: 110,
          fontWeight: 700,
          letterSpacing: -4,
          border: `6px solid ${INK}`,
          borderRadius: 36,
          boxSizing: "border-box"
        }}
      >
        KD
      </div>
    ),
    {
      ...size,
      fonts
    }
  );
}

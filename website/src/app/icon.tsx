import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Favicon — official XR avatar mark (assets/avatar.svg geometry). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* Tile */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 7,
            background: "#0A0A0F",
            border: "1.5px solid rgba(0,212,255,0.9)",
            boxShadow: "0 0 18px rgba(0,212,255,0.35)",
          }}
        />
        {/* X mark strokes */}
        <svg width="22" height="22" viewBox="0 0 96 96" fill="none">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#00D4FF" />
              <stop offset="1" stopColor="#6048F8" />
            </linearGradient>
          </defs>
          <path d="M30 30 L48 52 L66 30" fill="none" stroke="#00D4FF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M30 66 L43 50" fill="none" stroke="#6048F8" strokeWidth="7" strokeLinecap="round" />
          <path d="M66 66 L53 50" fill="none" stroke="#6048F8" strokeWidth="7" strokeLinecap="round" />
          <circle cx="48" cy="59" r="4.5" fill="#00FF88" />
        </svg>
      </div>
    ),
    { ...size }
  );
}

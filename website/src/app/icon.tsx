import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * Official XR favicon/app icon — uses the repository's official brand mark
 * (assets/logo.svg) colours on the official deep-navy canvas.
 */
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
          background:
            "radial-gradient(circle at 50% 42%, #0b1a2e 0%, #06081a 55%, #05060a 100%)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Orbital rings */}
          <div
            style={{
              position: "absolute",
              width: 62,
              height: 62,
              border: "3px solid #b9c9f4",
              borderRadius: 999,
              transform: "rotate(-18deg) scaleY(0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 62,
              height: 62,
              border: "2px solid rgba(40,226,255,0.5)",
              borderRadius: 999,
              transform: "rotate(-18deg) scaleY(0.55)",
              marginTop: 12,
            }}
          />
          {/* The X blades */}
          <svg
            width={46}
            height={46}
            viewBox="0 0 100 100"
            style={{ position: "absolute" }}
          >
            <path d="M18 22 L50 54 L18 86" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M82 22 L50 54 L82 86" stroke="#dfe6ff" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          {/* Glowing core */}
          <div
            style={{
              position: "absolute",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "radial-gradient(circle, #dff7ff 0%, #79d6ff 45%, #28a8ff 100%)",
              boxShadow: "0 0 26px 8px rgba(40,226,255,0.7)",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "#ffffff",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XR — The AI Agent You Can Actually Trust",
  description:
    "BYOK · local-first · spend-capped · tamper-evident. JARVIS-level computer control, 12 AI providers, zero-cost defaults. Install in 30 seconds.",
  keywords: [
    "AI agent",
    "self-hosted AI",
    "JARVIS",
    "BYOK",
    "local AI",
    "computer control",
    "XR agent",
  ],
  authors: [{ name: "ahmadrrrtx" }],
  openGraph: {
    title: "XR — The AI Agent You Can Actually Trust",
    description:
      "Run AI on YOUR key, YOUR hardware, YOUR rules. JARVIS control, cost ceiling, tamper-evident audit.",
    type: "website",
    siteName: "XR Agent",
  },
  twitter: {
    card: "summary_large_image",
    title: "XR — The AI Agent You Can Actually Trust",
    description: "BYOK · local-first · spend-capped · tamper-evident.",
  },
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="font-jakarta antialiased bg-xr-bg text-xr-text">
        {children}
      </body>
    </html>
  );
}
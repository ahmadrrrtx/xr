import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '⚡ XR — The AI Agent You Can Actually Trust | JARVIS Edition',
  description: 'XR v0.2 JARVIS Edition: 12 AI providers, zero-cost defaults, JARVIS computer control, voice, self-improving, tamper-evident audit. BYOK · local-first · spend-capped · by @ahmadrrrtx',
  keywords: [
    'AI agent',
    'JARVIS',
    'Claude Code alternative',
    'OpenClaw alternative',
    'local LLM',
    'Ollama',
    'self-improving AI',
    'voice control',
    'computer control',
    'tamper-evident',
    'security-first',
    'BYOK',
    'Hermes alternative',
    'autonomous agent',
    'XR agent',
    'ai coding assistant',
    'secure AI agent'
  ],
  authors: [{ name: 'Muhammad Ahmad', url: 'https://github.com/ahmadrrrtx' }],
  creator: '@ahmadrrrtx',
  publisher: 'XR',
  robots: 'index, follow',
  openGraph: {
    title: '⚡ XR — The AI Agent You Can Actually Trust',
    description: '12 AI providers, zero-cost defaults, JARVIS computer control, voice, self-improving, tamper-evident audit.',
    url: 'https://github.com/ahmadrrrtx/xr',
    siteName: 'XR',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: 'https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png',
        width: 512,
        height: 512,
        alt: 'XR Avatar',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '⚡ XR — The AI Agent You Can Actually Trust',
    description: '12 AI providers, zero-cost defaults, JARVIS computer control, voice, self-improving.',
    creator: '@ahmadrrrtx',
    images: ['https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png'],
  },
  alternates: {
    canonical: 'https://github.com/ahmadrrrtx/xr',
  },
  category: 'Technology',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#050507" />
        <meta name="color-scheme" content="dark" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "XR",
              "alternateName": "XR AI Agent",
              "description": "The AI agent you can actually trust. BYOK, local-first, spend-capped, tamper-evident.",
              "url": "https://github.com/ahmadrrrtx/xr",
              "applicationCategory": "DeveloperApplication",
              "operatingSystem": "Linux, macOS, Windows, Android",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD",
                "description": "Free to use with local models or bring your own API key"
              },
              "author": {
                "@type": "Person",
                "name": "Muhammad Ahmad",
                "url": "https://github.com/ahmadrrrtx"
              },
              "keywords": "AI agent, JARVIS, Claude Code, local LLM, security, BYOK",
              "softwareVersion": "0.2.0"
            })
          }}
        />
      </head>
      <body className="antialiased">
        {/* Background effects */}
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="grid-bg" />
        <div className="noise" />
        
        {children}
      </body>
    </html>
  )
}

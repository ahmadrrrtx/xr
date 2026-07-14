import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ 
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter'
})

export const metadata: Metadata = {
  title: 'XR — The AI Operating System',
  description: 'One brain. Infinite capabilities. The future of personal computing.',
  icons: {
    icon: '/avatar.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-[#0A0A0C] text-[#F8FAFC] antialiased">
        {children}
      </body>
    </html>
  )
}

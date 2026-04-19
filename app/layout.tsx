import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AlphaDesk — Professional Trading Analysis Platform',
  description: 'Analisi mercati, playbook istituzionale e revisione sessioni per trader professionisti',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  )
}

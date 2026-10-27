import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = {
  title: 'Gambling about lunch',
  description: 'Let the wheel decide lunch. A shared workplace lunch game.',
  applicationName: 'Gambling about lunch',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script id="theme-initializer" src="/theme-initializer.js" />
      </head>
      <body>{children}</body>
    </html>
  )
}

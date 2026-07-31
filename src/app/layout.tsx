import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Folio", template: "%s — Folio" },
  description: "A private, offline PDF library and reader for your devices.",
  applicationName: "Folio",
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: "Folio", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-startup-image" href="/icons/splash-1179x2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: light)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: light)" />
        <link rel="apple-touch-startup-image" href="/icons/splash-1290x2796-dark.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)" />
      </head>
      <body suppressHydrationWarning>{children}<PwaRegister /></body>
    </html>
  );
}

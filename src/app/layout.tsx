import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const editorial = Newsreader({
  subsets: ["latin"],
  variable: "--font-editorial",
  display: "swap",
});

const measure = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-measure-face",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Signal Enhancer",
    template: "%s · Signal Enhancer",
  },
  description:
    "Hear how two input chains shape the same sound, then make one transparent signal upgrade.",
  applicationName: "Signal Enhancer",
  manifest: "/manifest.webmanifest",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }],
  robots: { index: false, follow: false },
  openGraph: {
    title: "Signal Enhancer",
    description: "One sound. Two input chains. One honest signal upgrade.",
    type: "website",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b0b0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${editorial.variable} ${measure.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

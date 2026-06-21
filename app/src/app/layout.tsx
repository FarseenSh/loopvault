import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

const DESCRIPTION =
  "The consumer DeepBook Predict terminal. One signature opens a Predict position AND delta-hedges it on Spot — sealed by a SafeMint hot-potato, so you land fully hedged inside a fresh-oracle window or never trade at all.";

export const metadata: Metadata = {
  title: "LoopVault — one-tap hedged Predict trades",
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "LoopVault" },
  openGraph: { title: "LoopVault — one-tap hedged Predict", description: DESCRIPTION, type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // allow pinch-zoom (accessibility)
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

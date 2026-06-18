import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "LoopVault — one-tap hedged Predict trades",
  description:
    "The consumer DeepBook Predict terminal. One signature opens a Predict position AND delta-hedges it on Spot — sealed by a SafeMint hot-potato, so you land fully hedged inside a fresh-oracle window or never trade at all.",
};

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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

import type { Metadata } from "next";
import localFont from "next/font/local";
import { Manrope, Syne, Unbounded } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Providers } from "./providers";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/branding";
import MixpanelInitializer from "./MixpanelInitializer";
import ClerkAuthBridge from "@/components/ClerkAuthBridge";
import { Toaster } from "@/components/ui/sonner";
import TailwindBrowserRuntime from "@/components/runtime/TailwindBrowserRuntime";
const inter = localFont({
  src: [
    {
      path: "./fonts/Inter.ttf",
      weight: "400",
      style: "normal",
    },
  ],
  preload: false,
  variable: "--font-inter",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  preload: false,
  variable: "--font-manrope",
});

const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  preload: false,
  variable: "--font-unbounded",
});

export const metadata: Metadata = {
  // White-label build: no upstream product name, no presenton.ai URLs, and no
  // OG/canonical metadata at all. This runs inside an iframe in Broker
  // Marketplace and is never meant to be indexed or shared as its own site.
  title: `${PRODUCT_NAME} - ${PRODUCT_TAGLINE}`,
  description: PRODUCT_TAGLINE,
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${syne.variable} ${manrope.variable} ${unbounded.variable} antialiased`}
      >
        <Providers>
          <ClerkAuthBridge />
          <MixpanelInitializer>

            {children}

          </MixpanelInitializer>
        </Providers>
        <TailwindBrowserRuntime />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}

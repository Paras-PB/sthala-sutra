import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Noto_Serif_Devanagari, Noto_Serif_Gujarati, Playfair_Display } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// next/font self-hosts these at build time, so pages no longer wait on a render-blocking
// Google Fonts @import. Each exposes a CSS variable that globals.css builds font stacks from.
const playfair = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-playfair", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono", display: "swap" });
// Archive transcriptions are often Gujarati or Hindi; these cover the glyphs Playfair lacks.
// Not preloaded: the browser fetches them only when such text is on screen.
const gujarati = Noto_Serif_Gujarati({ subsets: ["gujarati"], variable: "--font-gujarati", display: "swap", preload: false });
const devanagari = Noto_Serif_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "SthalaSutra — Heritage, connected to its place",
  description: "Scan heritage records in Gujarati, Hindi or English; read, translate, search by meaning and place, and explore them on a living map.",
};

export const viewport: Viewport = {
  themeColor: "#314f40",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const fontVariables = [playfair, dmSans, dmMono, gujarati, devanagari].map((font) => font.variable).join(" ");
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}

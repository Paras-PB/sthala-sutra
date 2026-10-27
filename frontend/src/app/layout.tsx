import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map-layers.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SthalaSutra — Heritage, connected to its place",
  description: "Search, explore and map the stories behind India's living heritage archive.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

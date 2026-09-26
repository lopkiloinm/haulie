import type { Metadata, Viewport } from "next";
import { Geist, Manrope, Caveat } from "next/font/google";
import "./globals.css";
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
export const metadata: Metadata = {
  title: "Haulie — Good deliveries. Real humans.",
  description: "Your neighborhood, delivered. A verified human at every handoff. Payment ready at delivery. Explore the Haulie delivery marketplace demo.",
  applicationName: "Haulie",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Haulie" },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#285b40", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${manrope.variable} ${caveat.variable}`}><body>{children}</body></html>;
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bitvia — Digital Asset Markets",
  description: "A real-time digital asset market terminal with public market data and a sandbox trading environment.",
  applicationName: "Bitvia",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

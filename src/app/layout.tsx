import type { Metadata } from "next";
import { Cormorant_Garamond, Outfit } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { CloudProvider } from "@/context/CloudContext";
import { TripProvider } from "@/context/TripContext";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sans = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Trip Ready",
  description:
    "Group trip readiness — extract bookings, check documents, plan leave-by time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full antialiased">
        <CloudProvider>
          <TripProvider>
            <AppShell>{children}</AppShell>
          </TripProvider>
        </CloudProvider>
      </body>
    </html>
  );
}

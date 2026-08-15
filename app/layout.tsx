import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import {
  appearanceToHtmlAttrs,
  effectiveAppearance,
} from "@/lib/dashboard/preferences";
import { resolveInitialAppearance } from "@/lib/dashboard/serverAppearance";
import { NONCE_HEADER } from "@/lib/security/headers";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hermès OS — Centre de commande",
  description:
    "Hermès OS — centre de commande : vue d’ensemble et pilotage en temps réel.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce set by `proxy.ts`; used to authorize the inline anti-FOUC script under
  // the strict, nonce-based CSP (no `'unsafe-inline'` for scripts).
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  // DASH-4A: resolve the canonical appearance SERVER-SIDE and stamp it onto <html>
  // so the first paint on ANY device is already correct (no default-theme flash).
  // The read is cache()-shared with the page, so this costs no extra DB round-trip.
  const { appearance, behavior } = await resolveInitialAppearance();
  const htmlAttrs = appearanceToHtmlAttrs(
    effectiveAppearance(appearance, behavior),
  );

  return (
    <html
      lang="fr"
      suppressHydrationWarning
      {...htmlAttrs}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}

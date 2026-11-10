import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { isRtl, langFromRequest, translate } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const lang = langFromRequest(await headers());
  return {
    title: translate(lang, "title"),
    description: translate(lang, "subtitle"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = langFromRequest(await headers());
  return (
    <html lang={lang} dir={isRtl(lang) ? "rtl" : "ltr"}>
      <head>
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏷️</text></svg>"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

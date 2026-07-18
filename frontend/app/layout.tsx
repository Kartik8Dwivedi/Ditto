import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ditto — Semantic CI",
    template: "%s",
  },
  description:
    "Ditto finds functions that do the same thing written completely differently, then executes them to prove they disagree.",
};

/**
 * Stays server-rendered — client-only concerns live in components/providers.tsx.
 *
 * `data-theme="dark"` is set here rather than sniffed from the OS: dark is the
 * default and the demo mode, and it should not depend on how the machine the
 * demo is recorded on happens to be configured. The toggle flips this attribute.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className="h-full antialiased"
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

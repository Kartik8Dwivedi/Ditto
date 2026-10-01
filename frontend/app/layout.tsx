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
 * Light is the server-rendered fallback. A synchronous script restores a saved
 * theme before first paint so returning users do not see the wrong theme flash.
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
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("ditto-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()',
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

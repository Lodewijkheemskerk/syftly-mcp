import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { SiteHeader } from "@/app/components/SiteHeader";
import { siteUrl } from "@/lib/site";

// Global product chrome is English (Syftly is a broad-global product). The
// answer data itself stays as authored.
export const metadata = {
  // Base for every relative canonical/OG url — swapping to a custom domain
  // later stays one env var (SITE_URL), same contract as lib/site.ts.
  metadataBase: new URL(siteUrl()),
  title: "Syftly",
  description: "The agent-native evaluation layer for the tools and APIs that AI agents buy.",
  // Share-preview defaults; pages with their own openGraph override these.
  openGraph: {
    siteName: "Syftly",
    type: "website",
    title: "Syftly",
    description: "The agent-native evaluation layer for the tools and APIs that AI agents buy.",
  },
  twitter: { card: "summary" },
  // Google Search Console URL-prefix verification (HTML-tag method). Next renders
  // this as <meta name="google-site-verification" content="..."> in <head>.
  verification: { google: "OYSv5A7S53z7LkknDy427rpjI2jjx2tKHsihIfJxOe8" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Skip link: visually hidden until focused (.sr-only + :focus-visible in
            globals.css), lets keyboard users jump past the header nav to the page. */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <div id="main-content" className="page-wrap" tabIndex={-1}>
          {children}
        </div>
        <footer className="site-footer">
          SYFTLY · light estimates from public benchmarks, with sources and dates · MVP
        </footer>
        {/* Page-view telemetry for human traffic; no-ops outside Vercel and
            when Web Analytics is not enabled on the project. */}
        <Analytics />
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The Syftly shell header (ported from the Direction C design). Each nav item is
// a real <Link> once its page exists; an item still being built stays a plain
// label (ready: false) so the shell never ships a dead 404 link. Client component
// so usePathname can drive the active underline. Answer pages (/[query]) light up
// "Answers"; section routes light up their own tab.
const NAV: { href: string; label: string; slash: string; ready: boolean }[] = [
  { href: "/", label: "Answers", slash: "answers", ready: true },
  { href: "/categories", label: "Categories", slash: "categories", ready: true },
  { href: "/methodology", label: "Methodology", slash: "methodology", ready: true },
  { href: "/for-agents", label: "For agents", slash: "for agents", ready: true },
];

// The section routes (everything except the home/Answers surface). A pathname is
// "in" a section when it equals the route or sits under it.
const SECTIONS = NAV.filter((n) => n.href !== "/");

export function SiteHeader() {
  const pathname = usePathname();
  const section = SECTIONS.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/"),
  );
  // No section match → an answer page or the home page → "Answers" is active.
  const isActive = (href: string) =>
    href === "/" ? section === undefined : section?.href === href;

  return (
    <header className="site-header">
      <div className="brand">
        <span className="brand-name">SYFTLY</span>
        <span className="brand-slash">/ {section?.slash ?? "answers"}</span>
      </div>
      <nav className="site-nav">
        {NAV.map((n) =>
          n.ready ? (
            <Link key={n.href} href={n.href} className={isActive(n.href) ? "active" : undefined}>
              {n.label}
            </Link>
          ) : (
            <span key={n.href}>{n.label}</span>
          ),
        )}
      </nav>
    </header>
  );
}

import Link from "next/link";

// Custom 404 (Next file convention: app/not-found.tsx) replacing the bare
// framework default. It renders inside the normal shell (header/footer from the
// root layout) and points at the two real recovery routes, so a dead link keeps
// the visitor in the product instead of on a dead end.
export default function NotFound() {
  return (
    <main className="empty-state">
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          404
        </span>
        <span className="meta-mono">page not found</span>
      </div>
      <h1>This page doesn&apos;t exist</h1>
      <p>
        The address may be mistyped, or the answer you&apos;re after hasn&apos;t been published
        yet.
      </p>
      <p>
        <Link href="/">Back to the answers hub →</Link>
      </p>
      <p>
        <Link href="/categories">Browse all categories →</Link>
      </p>
    </main>
  );
}

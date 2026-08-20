import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminAuthed, adminPinConfigured, adminPinLength } from "@/lib/admin";
import { getEventStore } from "@/lib/event-store";
import { buildDashboard, type DashboardData } from "@/lib/dashboard";
import Dashboard from "@/app/admin/Dashboard";
import AdminLogin from "@/app/admin/AdminLogin";

// Private metrics dashboard. Locked by the admin cookie (a hash of METRICS_SECRET);
// no valid cookie -> show the login form. Never indexed and always rendered fresh
// (it reads live telemetry), so opt out of caching.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Syftly metrics",
  robots: { index: false, follow: false },
};

// Impure data-loading seam (the clock + the event store) kept out of the
// component body so the render stays pure and the window math lives in one place.
async function loadDashboard(windowDays: number): Promise<DashboardData> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const events = await getEventStore().since(since);
  return buildDashboard(events, windowDays);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const cookieStore = await cookies();
  if (!adminAuthed(cookieStore.get(ADMIN_COOKIE)?.value)) {
    // Keypad when an ADMIN_PIN is configured, secret input otherwise. Only the
    // mode flag and the PIN length cross to the client — never the PIN.
    return <AdminLogin pinMode={adminPinConfigured()} pinLength={adminPinLength() ?? 6} />;
  }

  const { days } = await searchParams;
  const requested = Number(days ?? "30");
  const windowDays = Number.isFinite(requested) && requested > 0 ? requested : 30;

  return <Dashboard data={await loadDashboard(windowDays)} />;
}

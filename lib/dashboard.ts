import type { CallEvent } from "@/lib/events";
import { matchCategory } from "@/lib/categories";
import {
  northStar,
  topQueries,
  categoryBreakdown,
  endpointBreakdown,
  gapQueries,
  timeline,
  callsInLastHours,
  usageEvents,
  callersBreakdown,
  type NorthStar,
  type Tally,
  type KeyCount,
  type DayPoint,
  type CallerRow,
} from "@/lib/metrics";

// Pure composition layer for the private /admin dashboard: folds a window of
// events into the panels the page renders. Kept separate from the page so the
// derivation is testable without a database or React. Slice 3 adds gap-queries
// and the trend timeline.
const TOP_QUERIES = 10;
const LIVENESS_HOURS = 24;

export interface DashboardData {
  windowDays: number;
  // Calls in the last LIVENESS_HOURS — a telemetry-liveness readout: a 0 here
  // while the window still holds history means the pipeline has gone silent.
  calls24h: number;
  northStar: NorthStar;
  topQueries: Tally[];
  categories: KeyCount[];
  endpoints: { byEndpoint: KeyCount[]; byFormat: KeyCount[] };
  gaps: Tally[];
  trend: DayPoint[];
  // Every caller in the window, most recently seen first — self test traffic
  // and init-only (scanner-shaped) callers labeled, not hidden.
  callers: CallerRow[];
}

export function buildDashboard(
  events: CallEvent[],
  windowDays: number,
  now: Date = new Date(),
): DashboardData {
  // The usage panels (north-star included) count strangers' questions only:
  // self-tagged test traffic and initialize handshakes are filtered out. The
  // Callers panel and the liveness counter see EVERYTHING, labeled.
  const usage = usageEvents(events);
  return {
    windowDays,
    calls24h: callsInLastHours(events, LIVENESS_HOURS, now),
    northStar: northStar(usage),
    topQueries: topQueries(usage, TOP_QUERIES),
    categories: categoryBreakdown(usage),
    endpoints: endpointBreakdown(usage),
    // A query is "in scope" if it matches a registered category; the rest are gaps.
    gaps: gapQueries(usage, (q) => matchCategory(q) !== null),
    trend: timeline(usage),
    callers: callersBreakdown(events),
  };
}

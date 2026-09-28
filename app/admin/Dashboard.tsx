import type { DashboardData } from "@/lib/dashboard";

// Presentational view for the private dashboard — pure over DashboardData so it
// renders identically in a test and on the server. Shows the north-star (Q6:
// does anyone come back?) plus what agents ask and which channels they use.
export default function Dashboard({ data }: { data: DashboardData }) {
  const {
    northStar: ns,
    calls24h,
    windowDays,
    topQueries,
    categories,
    endpoints,
    gaps,
    trend,
    callers,
    consumers,
  } = data;
  return (
    <main className="admin">
      <header className="admin-head">
        <h1>Syftly metrics</h1>
        <p className="admin-window">Last {windowDays} days</p>
      </header>

      <section className="admin-panel" aria-label="North star">
        <h2>North star — repeat adoption</h2>
        <div className="admin-stats">
          <Stat label="Total calls" value={ns.totalCalls} />
          <Stat label="Unique callers" value={ns.uniqueCallers} />
          <Stat label={`Repeat callers (≥${ns.minCalls}×)`} value={ns.repeatCallers} primary />
          {/* Telemetry-liveness: a 0 here while the window shows history means the
              pipeline has gone silent — a broken north-star, made visible. */}
          <Stat label="Calls (24h)" value={calls24h} />
        </div>
      </section>

      <section className="admin-panel" aria-label="Likely consumers">
        <h2>Likely consumers — grouped</h2>
        <p className="admin-note">
          Usage per self-named x-api-key, else per user-agent. A pipeline rotating cloud IPs is one
          row here but many unique callers above; strangers on the same HTTP library merge here.
          The truth is between the two numbers.
        </p>
        <ConsumerTable rows={consumers} />
      </section>

      <section className="admin-panel" aria-label="Callers">
        <h2>Callers — who is out there</h2>
        <p className="admin-note">
          Strangers first — a row here is the earliest adoption signal. Your own tagged test
          traffic is dimmed as [you]; registry scanners that only shake hands are collapsed below.
        </p>
        <Callers rows={callers} />
      </section>

      <div className="admin-grid-2">
        <section className="admin-panel" aria-label="Trend">
          <h2>Adoption trend (per day)</h2>
          <Trend points={trend} />
        </section>
        <section className="admin-panel" aria-label="Top queries">
          <h2>Top queries</h2>
          <BarList items={topQueries.map((t) => ({ label: t.query, count: t.count }))} />
        </section>
      </div>

      <div className="admin-grid-2">
        <section className="admin-panel" aria-label="Categories">
          <h2>Category demand</h2>
          <BarList items={categories.map((c) => ({ label: c.key, count: c.count }))} />
        </section>
        <section className="admin-panel" aria-label="Endpoints">
          <h2>Endpoint &amp; format</h2>
          <p className="admin-sublabel">By endpoint</p>
          <BarList items={endpoints.byEndpoint.map((e) => ({ label: e.key, count: e.count }))} />
          <p className="admin-sublabel admin-sublabel-gap">By format</p>
          <BarList items={endpoints.byFormat.map((f) => ({ label: f.key, count: f.count }))} />
        </section>
      </div>

      <section className="admin-panel" aria-label="Gap queries">
        <h2>Demand gaps — no category match</h2>
        <p className="admin-note">Queries that matched no category. These pick the next category to build.</p>
        <BarList items={gaps.map((g) => ({ label: g.query, count: g.count }))} />
      </section>
    </main>
  );
}

// Compact "06-30 → 07-02" range; a single date when first and last coincide.
// Full ISO timestamps go in the title so hover still gives precision.
function seenRange(first: string, last: string): string {
  const f = first.slice(5, 10);
  const l = last.slice(5, 10);
  return f === l ? f : `${f} → ${l}`;
}

function ConsumerTable({ rows }: { rows: DashboardData["consumers"] }) {
  if (rows.length === 0) return <p className="admin-empty">No usage yet.</p>;
  return (
    <div className="admin-callers-wrap">
      <table className="admin-callers">
        <thead>
          <tr>
            <th>Consumer</th>
            <th className="admin-num">Calls</th>
            <th className="admin-num">IPs</th>
            <th className="admin-num">Days</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.client}>
              <td className="admin-caller-client">{r.client}</td>
              <td className="admin-num">{r.calls}</td>
              <td className="admin-num">{r.ips}</td>
              <td className="admin-num">{r.days}</td>
              <td className="admin-caller-seen" title={`${r.firstSeen} → ${r.lastSeen}`}>
                {seenRange(r.firstSeen, r.lastSeen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CallerRows = DashboardData["callers"];

function CallerTable({ rows }: { rows: CallerRows }) {
  return (
    <div className="admin-callers-wrap">
      <table className="admin-callers">
        <thead>
          <tr>
            <th>Caller</th>
            <th>Client</th>
            <th className="admin-num">Calls</th>
            <th className="admin-num">Init</th>
            <th>Seen</th>
            <th>Recent queries</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.caller}
              className={
                r.self
                  ? "admin-caller-self"
                  : r.calls > 0 && !r.echoOnly
                    ? "admin-caller-stranger"
                    : undefined
              }
            >
              <td className="admin-caller-id">
                {r.caller.slice(0, 18)}
                {r.self && <span className="admin-caller-badge admin-caller-badge-you">you</span>}
                {r.initOnly && <span className="admin-caller-badge">init-only</span>}
                {r.echoOnly && <span className="admin-caller-badge">example-echo</span>}
              </td>
              <td className="admin-caller-client">
                {r.clients.length > 0 ? r.clients.join(", ") : r.agents.join(", ") || "—"}
              </td>
              <td className="admin-num">{r.calls}</td>
              <td className="admin-num">{r.initCalls}</td>
              <td className="admin-caller-seen" title={`${r.firstSeen} → ${r.lastSeen}`}>
                {seenRange(r.firstSeen, r.lastSeen)}
              </td>
              <td className="admin-caller-queries">{r.queries.join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Strangers and self up top; init-only scanners (they connect but never ask)
// collapsed behind a native <details> so six probe bots don't bury the one
// real caller. No client JS — <details> works server-rendered.
function Callers({ rows }: { rows: CallerRows }) {
  if (rows.length === 0) {
    return <p className="admin-empty">No callers yet.</p>;
  }
  const active = rows.filter((r) => !r.initOnly);
  const scanners = rows.filter((r) => r.initOnly);
  return (
    <>
      {active.length > 0 ? <CallerTable rows={active} /> : <p className="admin-empty">No real callers yet — only scanners so far.</p>}
      {scanners.length > 0 && (
        <details className="admin-scanners">
          <summary>
            {scanners.length} init-only scanner{scanners.length === 1 ? "" : "s"} — connected, never
            asked (last {scanners[0].lastSeen.slice(5, 10)})
          </summary>
          <CallerTable rows={scanners} />
        </details>
      )}
    </>
  );
}

// Per-day adoption bars: calls height + unique-caller count, oldest left.
function Trend({ points }: { points: { date: string; calls: number; uniqueCallers: number }[] }) {
  if (points.length === 0) {
    return <p className="admin-empty">No data yet.</p>;
  }
  const max = Math.max(...points.map((p) => p.calls));
  return (
    <ul className="admin-trend">
      {points.map((p) => (
        <li key={p.date} className="admin-trend-day" title={`${p.date}: ${p.calls} calls, ${p.uniqueCallers} unique`}>
          <span className="admin-trend-bar" style={{ height: `${(p.calls / max) * 100}%` }} />
          <span className="admin-trend-date">{p.date.slice(5)}</span>
          <span className="admin-trend-count">{p.calls}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return (
    <div className={primary ? "admin-stat admin-stat-primary" : "admin-stat"}>
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  );
}

// A ranked list with proportional bars. Empty list -> an honest "no data yet".
function BarList({ items }: { items: { label: string; count: number }[] }) {
  if (items.length === 0) {
    return <p className="admin-empty">No data yet.</p>;
  }
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="admin-bars">
      {items.map((i) => (
        <li key={i.label} className="admin-bar-row">
          <span className="admin-bar-label" title={i.label}>
            {i.label}
          </span>
          <span className="admin-bar-track">
            <span className="admin-bar-fill" style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
          <span className="admin-bar-count">{i.count}</span>
        </li>
      ))}
    </ul>
  );
}

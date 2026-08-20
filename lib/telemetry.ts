import { after } from "next/server";
import { callerFromRequest, callerId } from "@/lib/caller";
import { getEventStore } from "@/lib/event-store";
import type { CallEvent } from "@/lib/events";

export interface CallFields {
  endpoint: string; // "answer" | "mcp"
  format: string; // "json" | "md" | "mcp" | "init"
  category: string | null;
  query: string;
  // MCP client identity from the initialize handshake, when known.
  clientInfo?: string | null;
}

// Record one endpoint call for the north-star metric (Q6), fire-and-forget.
// Telemetry must never break or slow the product, so: the DB write is scheduled
// via Next's after() — it runs after the response is sent but keeps the
// serverless function alive long enough to finish (plain fire-and-forget can be
// frozen on Vercel) — and every failure is swallowed. Outside a request scope
// (unit tests) after() throws synchronously; we catch that and skip telemetry.
export function recordCall(req: Request, fields: CallFields): void {
  let event: CallEvent;
  try {
    const input = callerFromRequest(req);
    event = {
      ts: new Date().toISOString(),
      endpoint: fields.endpoint,
      format: fields.format,
      category: fields.category,
      query: fields.query,
      caller: callerId(input),
      userAgent: input.userAgent ?? null,
      clientInfo: fields.clientInfo ?? null,
    };
  } catch (err) {
    // Building the event failed (e.g. a malformed request) — never break the
    // product, but log it so a systematic failure is visible in Vercel's function
    // logs instead of being silently invisible.
    console.error("[syftly:telemetry] failed to build call event", err);
    return;
  }

  try {
    after(async () => {
      try {
        await getEventStore().record(event);
      } catch (err) {
        // Swallow: measurement must never break the product. But surface it —
        // Vercel captures console output, so this turns a silent north-star gap
        // into a greppable log line (endpoint tags which call was lost).
        console.error(
          `[syftly:telemetry] store.record failed (endpoint=${event.endpoint} format=${event.format})`,
          err,
        );
      }
    });
  } catch {
    // after() throws synchronously outside a request scope (unit tests, non-
    // request contexts). This is expected control flow, not a telemetry failure,
    // so we skip silently — logging it would be noise on every out-of-request call.
  }
}

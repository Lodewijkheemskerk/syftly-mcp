import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/unlock/route";
import { GATE_COOKIE, GATE_TOKEN } from "@/lib/gate";

function post(code: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
}

// The PIN gate has no default anymore (L5): unlocking only matters when a PIN is
// configured, so set one for these tests and restore the env afterwards.
const original = process.env.SITE_PIN;
beforeEach(() => {
  process.env.SITE_PIN = "0303";
});
afterEach(() => {
  if (original === undefined) delete process.env.SITE_PIN;
  else process.env.SITE_PIN = original;
});

describe("POST /api/unlock", () => {
  it("zet de httpOnly gate-cookie bij de juiste code", async () => {
    const res = await post("0303");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${GATE_COOKIE}=${GATE_TOKEN}`);
    expect(cookie).toContain("HttpOnly");
  });

  it("weigert een verkeerde code zonder cookie te zetten (401)", async () => {
    const res = await post("9999");
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

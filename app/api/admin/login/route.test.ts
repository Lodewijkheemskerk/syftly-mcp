import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/admin/login/route";
import { ADMIN_COOKIE, adminAuthed } from "@/lib/admin";

function postBody(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function post(secret: unknown): Promise<Response> {
  return postBody({ secret });
}

const original = process.env.METRICS_SECRET;
const originalPin = process.env.ADMIN_PIN;
beforeEach(() => {
  process.env.METRICS_SECRET = "s3cr3t";
  delete process.env.ADMIN_PIN;
});
afterEach(() => {
  if (original === undefined) delete process.env.METRICS_SECRET;
  else process.env.METRICS_SECRET = original;
  if (originalPin === undefined) delete process.env.ADMIN_PIN;
  else process.env.ADMIN_PIN = originalPin;
});

describe("POST /api/admin/login", () => {
  it("sets an httpOnly admin cookie with a valid signed token on the right secret", async () => {
    const res = await post("s3cr3t");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");

    // The token is signed+expiring (embeds Date.now()), so we verify the cookie
    // authenticates rather than matching a freshly-minted token string.
    const match = cookie.match(new RegExp(`${ADMIN_COOKIE}=([^;]+)`));
    expect(match).not.toBeNull();
    const tokenValue = decodeURIComponent(match![1]);
    expect(tokenValue).not.toBe("s3cr3t"); // never the raw secret
    expect(adminAuthed(tokenValue)).toBe(true);
  });

  it("rejects a wrong secret without setting a cookie (401)", async () => {
    const res = await post("nope");
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/admin/login with a numeric PIN", () => {
  it("sets a valid signed admin cookie on the right PIN", async () => {
    process.env.ADMIN_PIN = "483555";
    const res = await postBody({ pin: "483555" });
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    const match = cookie.match(new RegExp(`${ADMIN_COOKIE}=([^;]+)`));
    expect(match).not.toBeNull();
    const tokenValue = decodeURIComponent(match![1]);
    expect(tokenValue).not.toBe("483555"); // never the raw PIN
    expect(adminAuthed(tokenValue)).toBe(true);
  });

  it("rejects a wrong PIN without setting a cookie (401)", async () => {
    process.env.ADMIN_PIN = "483555";
    const res = await postBody({ pin: "000000" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a PIN attempt when no ADMIN_PIN is configured", async () => {
    const res = await postBody({ pin: "483555" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("secret login keeps working alongside the PIN", async () => {
    process.env.ADMIN_PIN = "483555";
    const res = await post("s3cr3t");
    expect(res.status).toBe(200);
  });

  it("the PIN is not accepted in the secret field", async () => {
    process.env.ADMIN_PIN = "483555";
    const res = await postBody({ secret: "483555" });
    expect(res.status).toBe(401);
  });
});

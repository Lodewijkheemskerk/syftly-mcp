import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/answer/route";

// The machine-endpoint is one of the three views of the same Antwoord-artefact
// (ADR 0002): JSON for agent consumption. It answers by query (ADR 0005).
describe("GET /api/answer", () => {
  it("geeft het antwoord-artefact als JSON voor een bekende query", async () => {
    const req = new Request(
      "http://localhost/api/answer?query=Best%20transcription%20API%20for%20Dutch",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    // The REST JSON is the English public contract (Bevinding ③).
    expect(body.category).toBe("transcription");
    expect(body.confidence).toBe("light estimate");
    expect(body.summary.length).toBeGreaterThan(0);
    // Dutch keys are projected away at the boundary.
    expect(body.zekerheidslabel).toBeUndefined();
    expect(body.hap).toBeUndefined();
  });

  it("beantwoordt een vrije in-categorie query via de engine — geen 404 meer (ADR 0009)", async () => {
    const req = new Request("http://localhost/api/answer?query=transcribe%20my%20podcast");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category).toBe("transcription");
    expect(body.recommendation.default.length).toBeGreaterThan(0);
  });

  it("geeft 404 voor een lege query (geen vraag gesteld)", async () => {
    const req = new Request("http://localhost/api/answer?query=");
    const res = await GET(req);

    expect(res.status).toBe(404);
  });

  it("geeft markdown (text/markdown) bij format=md — vierde weergave, ADR 0002", async () => {
    const req = new Request(
      "http://localhost/api/answer?query=Best%20transcription%20API%20for%20Dutch&format=md",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("# Best transcription API for Dutch");
    expect(body).toMatch(/\|\s*Offering\s*\|/); // the real provider table
  });

  it("geeft markdown voor een vrije in-categorie query via de engine (geen 404)", async () => {
    const req = new Request(
      "http://localhost/api/answer?query=cheapest%20transcription%20API&format=md",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("AssemblyAI Universal-3 Pro"); // the computed cheapest comparable winner
  });

  it("geeft 404 (markdown) voor een lege query", async () => {
    const req = new Request("http://localhost/api/answer?query=&format=md");
    const res = await GET(req);

    expect(res.status).toBe(404);
  });

  it("geeft een eerlijk no-match antwoord (routing:none) voor een out-of-scope query, geen transcriptie (FIX 1)", async () => {
    const req = new Request("http://localhost/api/answer?query=best%20image%20generation%20API");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routing).toBe("none");
    expect(body.category).not.toBe("transcription");
    expect(body.categories.map((c: { category: string }) => c.category)).toContain("transcription");
  });

  it("routeert een natuurlijke web-search vraag naar web-search (FIX 1)", async () => {
    const req = new Request(
      "http://localhost/api/answer?query=API%20to%20get%20data%20from%20the%20web",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routing).toBe("matched");
    expect(body.category).toBe("web-search");
  });

  // Input bounds (Finding 4): reject oversized input before any lookup/telemetry.
  it("weigert een te lange query met 400 (max 512 tekens)", async () => {
    const huge = "a".repeat(513);
    const req = new Request(`http://localhost/api/answer?query=${huge}`);
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/query too long/);
  });

  it("accepteert een query op de grens (512 tekens) zonder 400", async () => {
    const atLimit = "a".repeat(512);
    const req = new Request(`http://localhost/api/answer?query=${atLimit}`);
    const res = await GET(req);

    // No 400 — it gets a normal answer/no-match response, just not rejected.
    expect(res.status).not.toBe(400);
  });

  it("weigert een te lange category met 400 (max 64 tekens)", async () => {
    const longCat = "c".repeat(65);
    const req = new Request(
      `http://localhost/api/answer?query=transcribe&category=${longCat}`,
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/category too long/);
  });
});

import { describe, it, expect } from "vitest";
import { artefactToMarkdown } from "@/lib/markdown";
import type { AntwoordArtefact, Beslisas } from "@/lib/types";

// A small decision-axis registry mirroring a real category's `assen`: a price
// sentinel column, a numeric WER column with a unit, and a filter axis rendered
// as a capability badge. Passing this makes the Markdown table category-rich, the
// same way app/[category]/[query]/page.tsx derives its columns from getRanking.
const ASSEN: Beslisas[] = [
  { key: "goedkoopste", label: "the lowest price", metric: "prijs", richting: "min", keywords: [], kolom: "Price" },
  { key: "hoogste-nauwkeurigheid", label: "highest accuracy", metric: "wer", richting: "min", keywords: [], kolom: "WER", eenheid: "%" },
  { key: "met-diarisatie", label: "diarization", metric: "diarisatie", richting: "filter", keywords: [], kolom: "diarization" },
];

// A small, self-contained fixture so these assertions don't drift when the real
// ranking data changes. The pipe in "sterk" guards table-cell escaping.
const ARTEFACT: AntwoordArtefact = {
  query: "Best transcription API for Dutch",
  slug: "best-transcription-api-for-dutch",
  category: "transcriptie",
  routing: "matched",
  hap: "For Dutch speech-to-text, ElevenLabs Scribe v2 tops the leaderboard. This is a light estimate, not a first-hand Dutch measurement.",
  zekerheidslabel: "light estimate",
  laatst_bijgewerkt: "2026-06-19",
  recommendation: {
    default: "ElevenLabs Scribe v2",
    axes: {
      goedkoopste: "AssemblyAI Universal-2",
      "laagste-latency-realtime": "Deepgram Nova-3",
    },
  },
  providers: [
    {
      naam: "ElevenLabs Scribe v2",
      provider: "ElevenLabs",
      prijs: { waarde: 0.4, eenheid: "$/1000min" },
      metrics: {},
      sterk: "Top accuracy | leaderboard #1",
      zwak: "Pricier than budget options",
      bron: "Artificial Analysis",
      bron_datum: "2026-06-10",
    },
    {
      naam: "AssemblyAI Universal-2",
      provider: "AssemblyAI",
      prijs: { waarde: 0.27, eenheid: "$/1000min" },
      metrics: {},
      sterk: "Cheapest broad-multilingual",
      zwak: "Not the accuracy leader",
      bron: "AssemblyAI pricing",
      bron_datum: "2026-06-12",
    },
  ],
  bronnen: [
    { titel: "Artificial Analysis ASR leaderboard", url: "https://artificialanalysis.ai/asr", datum: "2026-06-10" },
    { titel: "AssemblyAI pricing", url: "https://www.assemblyai.com/pricing", datum: "2026-06-12" },
  ],
};

describe("artefactToMarkdown", () => {
  const md = artefactToMarkdown(ARTEFACT);

  it("renders the question as an H1", () => {
    expect(md).toContain("# Best transcription API for Dutch");
  });

  it("includes the hap verbatim — same citeerbare kern as page and endpoints (ADR 0002)", () => {
    expect(md).toContain(ARTEFACT.hap);
  });

  it("surfaces the trust label and freshness date for the machine reader", () => {
    expect(md).toContain("light estimate");
    expect(md).not.toContain("lichte inschatting");
    expect(md).toContain("2026-06-19");
  });

  it("lists the default recommendation and every axis", () => {
    expect(md).toContain("ElevenLabs Scribe v2");
    expect(md).toContain("AssemblyAI Universal-2");
    expect(md).toContain("Deepgram Nova-3");
  });

  it("renders the providers as a real markdown table with a header separator row", () => {
    expect(md).toMatch(/\|\s*Offering\s*\|/);
    expect(md).toMatch(/\|\s*-+\s*\|/); // the |---|---| separator that makes it a table
  });

  it("keeps each provider's price with its unit on the row", () => {
    expect(md).toContain("0.4 $/1000min");
    expect(md).toContain("0.27 $/1000min");
  });

  it("escapes pipe characters inside cells so the table stays valid", () => {
    const piped: AntwoordArtefact = {
      ...ARTEFACT,
      providers: [{ ...ARTEFACT.providers[0], naam: "Scribe | v2" }],
    };
    const out = artefactToMarkdown(piped);
    expect(out).toContain("Scribe \\| v2");
    expect(out).not.toContain("| Scribe | v2 |");
  });

  it("renders sources as dated markdown links", () => {
    expect(md).toContain("[Artificial Analysis ASR leaderboard](https://artificialanalysis.ai/asr)");
    expect(md).toContain("2026-06-10");
  });
});

// HARDENING FIX 1: the user-controlled query is free text dropped into another
// agent's context. It must be neutralised so it can't inject Markdown structure
// (extra headings, lists) or break out of the H1.
describe("artefactToMarkdown — query is neutralised as untrusted free text (FIX 1)", () => {
  function withQuery(query: string): AntwoordArtefact {
    return { ...ARTEFACT, query };
  }

  it("collapses newlines in the query so a single H1 can't become many lines/headings", () => {
    const md = artefactToMarkdown(withQuery("line one\n# Injected heading\n- bullet"));
    // exactly one H1 line, and the injected '#'/'-' are not at line starts
    const headingLines = md.split("\n").filter((l) => /^#\s/.test(l));
    expect(headingLines).toHaveLength(1);
    expect(md).not.toMatch(/^# Injected heading/m);
    expect(md).not.toMatch(/^- bullet/m);
  });

  it("escapes a leading Markdown control char so the query renders as literal text", () => {
    const md = artefactToMarkdown(withQuery("# pretend I am a heading"));
    // The H1 marker is ours; the query's own '#' is escaped so it can't add a heading.
    expect(md).toContain("# \\# pretend I am a heading");
  });

  it("neutralises a leading pipe/blockquote/backtick in the query", () => {
    // Only the LEADING control char is escaped: Markdown block syntax is
    // line-leading, and an H1 line is not a table row so interior pipes are inert.
    expect(artefactToMarkdown(withQuery("> quote injection"))).toContain("# \\> quote injection");
    expect(artefactToMarkdown(withQuery("`code injection`"))).toContain("# \\`code injection`");
    expect(artefactToMarkdown(withQuery("| table | row |"))).toContain("# \\| table | row |");
  });
});

// HARDENING FIX 2: a newline (or backtick) in any provider cell would split the
// table row / open a code span and corrupt the whole table.
describe("artefactToMarkdown — multiline & backtick cells stay in one valid row (FIX 2)", () => {
  it("collapses newlines and escapes backticks inside a cell", () => {
    const a: AntwoordArtefact = {
      ...ARTEFACT,
      providers: [
        {
          ...ARTEFACT.providers[0],
          naam: "line one\nline two",
          provider: "uses `backticks` inline",
        },
      ],
    };
    const md = artefactToMarkdown(a);
    const rows = md.split("\n").filter((l) => l.startsWith("| line one"));
    // a single table row, no embedded newline split it into two
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("line one line two");
    expect(rows[0]).toContain("uses \\`backticks\\` inline");
    expect(md).not.toContain("line one\nline two");
  });
});

// The Markdown table is category-rich when the caller passes the category's
// decision-axes (ADR 0010): numeric axis columns with units + capability badges,
// mirroring the human page — so an agent reads structured columns, not free text.
describe("artefactToMarkdown — category-rich table from `assen`", () => {
  const rich: AntwoordArtefact = {
    ...ARTEFACT,
    providers: [
      {
        ...ARTEFACT.providers[0],
        prijs: { waarde: 3.67, eenheid: "$/1000 min", vergelijkbaar: true },
        metrics: { wer: 2.2, diarisatie: true },
      },
      {
        ...ARTEFACT.providers[1],
        naam: "Google Gemini 3 Flash",
        provider: "Google",
        prijs: { waarde: 1.92, eenheid: "$/1000 min", vergelijkbaar: false },
        metrics: { wer: 4.1, diarisatie: false },
      },
    ],
  };
  const md = artefactToMarkdown(rich, ASSEN);

  it("puts the price unit in the header and the WER column with its unit on the value", () => {
    expect(md).toContain("Price ($/1000 min)");
    expect(md).toContain("| WER |"); // header cell for the accuracy axis
    expect(md).toContain("2.2%"); // WER value carries its unit
    expect(md).toContain("4.1%");
  });

  it("renders a Capabilities column with the filter-axis badge only when the trait is present", () => {
    const rows = md.split("\n");
    const eleven = rows.find((l) => l.startsWith("| ElevenLabs"))!;
    const google = rows.find((l) => l.startsWith("| Google Gemini"))!;
    expect(eleven).toContain("diarization"); // has diarisatie:true
    expect(google).not.toContain("diarization"); // diarisatie:false → no badge
  });

  it("marks a non-comparable price with a footnote and adds the token-pricing caveat", () => {
    const google = md.split("\n").find((l) => l.startsWith("| Google Gemini"))!;
    expect(google).toContain("1.92 \\*"); // the * marker on the non-comparable price cell
    expect(md).toContain("token-/credit-priced"); // the caveat footnote
  });

  it("degrades to a bare Offering/Provider/Price table when no assen is supplied", () => {
    const bare = artefactToMarkdown(rich);
    expect(bare).toMatch(/\|\s*Offering\s*\|\s*Provider\s*\|\s*Price\s*\|/);
    expect(bare).not.toContain("WER");
    expect(bare).toContain("3.67 $/1000 min"); // price kept on the value in the fallback column
  });
});

// HARDENING FIX 3: source link titles may carry brackets, and URLs may carry a
// non-http scheme (javascript:) that is a clickable injection vector.
describe("artefactToMarkdown — link titles escaped, non-http URLs neutralised (FIX 3)", () => {
  it("drops a javascript: URL to a harmless placeholder", () => {
    const a: AntwoordArtefact = {
      ...ARTEFACT,
      bronnen: [{ titel: "Click me", url: "javascript:alert(1)", datum: "2026-06-10" }],
    };
    const md = artefactToMarkdown(a);
    expect(md).not.toContain("javascript:");
    expect(md).toContain("[Click me](#)");
  });

  it("keeps http(s) URLs intact", () => {
    const md = artefactToMarkdown(ARTEFACT);
    expect(md).toContain("(https://artificialanalysis.ai/asr)");
  });

  it("escapes brackets in a link title so the [title](url) syntax can't break", () => {
    const a: AntwoordArtefact = {
      ...ARTEFACT,
      bronnen: [{ titel: "Report [2026] edition", url: "https://example.com/r", datum: "2026-06-10" }],
    };
    const md = artefactToMarkdown(a);
    expect(md).toContain("[Report \\[2026\\] edition](https://example.com/r)");
  });
});

// FIX 1: a no-match artefact (routing:"none") renders as an honest message that
// names the supported categories — not an empty/broken provider table.
describe("artefactToMarkdown — no-match rendering (FIX 1)", () => {
  const noMatch: AntwoordArtefact = {
    query: "best image generation API",
    slug: "best-image-generation-api",
    category: "",
    routing: "none",
    hap: "Syftly doesn't cover that task yet. It currently ranks tools for five categories — pick one and ask again.",
    zekerheidslabel: "light estimate",
    laatst_bijgewerkt: "2026-06-22",
    recommendation: { default: "", axes: {} },
    providers: [],
    bronnen: [],
    categories: [
      { category: "transcription", label: "Transcription" },
      { category: "tts", label: "Text-to-speech" },
      { category: "web-search", label: "Web search" },
      { category: "scraping", label: "Scraping & browser" },
      { category: "ocr", label: "OCR & document extraction" },
    ],
  };
  const md = artefactToMarkdown(noMatch);

  it("shows the no-match message (the hap) and the question as H1", () => {
    expect(md).toContain("# best image generation API");
    expect(md).toContain(noMatch.hap);
  });

  it("lists every supported category with its label", () => {
    for (const c of noMatch.categories!) expect(md).toContain(c.label);
  });

  it("does NOT render an empty provider table or a default recommendation", () => {
    expect(md).not.toMatch(/\|\s*Offering\s*\|/);
    expect(md).not.toContain("**Default:**");
  });

  it("neutralises a no-match message that echoes an injection (FIX 1)", () => {
    const injected: AntwoordArtefact = {
      ...noMatch,
      hap: "# Injected\n- evil bullet",
    };
    const out = artefactToMarkdown(injected);
    // newlines collapsed (no stray bullet line) and the leading '#' escaped.
    expect(out).not.toMatch(/^- evil bullet/m);
    expect(out).toContain("\\# Injected - evil bullet");
  });
});

// FIX 2: a multi-ordering-axis answer renders the trade-off breakdown — every
// axis and its winner — so the machine reader sees both, not one survivor.
describe("artefactToMarkdown — multi-axis trade-off rendering (FIX 2)", () => {
  const tradeoff: AntwoordArtefact = {
    query: "most accurate and cheapest transcription API",
    slug: "most-accurate-and-cheapest-transcription-api",
    category: "transcription",
    routing: "matched",
    hap: "Cheapest: AssemblyAI Universal-3 Pro. Most accurate: ElevenLabs Scribe v2.",
    zekerheidslabel: "light estimate",
    laatst_bijgewerkt: "2026-06-19",
    recommendation: {
      default: "ElevenLabs Scribe v2",
      primary: "hoogste-nauwkeurigheid",
      axes: {
        goedkoopste: "AssemblyAI Universal-3 Pro",
        "hoogste-nauwkeurigheid": "ElevenLabs Scribe v2",
      },
    },
    providers: ARTEFACT.providers,
    bronnen: ARTEFACT.bronnen,
  };
  const md = artefactToMarkdown(tradeoff);

  it("lists each ordering axis with its own winner", () => {
    expect(md).toContain("AssemblyAI Universal-3 Pro");
    expect(md).toContain("ElevenLabs Scribe v2");
    expect(md).toMatch(/goedkoopste|lowest price/i);
    expect(md).toMatch(/nauwkeurigheid|accuracy/i);
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "@/app/not-found";

// A custom 404 instead of Next's bare default ("404: This page could not be
// found."): it keeps the visitor inside the product by offering the two real
// recovery routes — home (the answers hub) and the category index.
function render(): string {
  return renderToStaticMarkup(NotFound());
}

describe("Not-found page", () => {
  const html = render();

  it("says clearly that the page does not exist", () => {
    expect(html).toContain("404");
  });

  it("offers the two recovery routes: home and categories", () => {
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/categories"');
  });
});

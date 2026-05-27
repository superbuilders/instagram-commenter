import { describe, expect, test } from "vitest";
import { parseBioPageHtml } from "../fetch-page.js";

describe("parseBioPageHtml", () => {
  test("extracts visible text and absolute destination links", () => {
    const page = parseBioPageHtml(
      `
      <html>
        <head><title>Future of Education</title></head>
        <body>
          <a href="/apply">Alpha Anywhere</a>
          <a href="https://alpha.school/guides">Become a Guide</a>
          <a href="mailto:test@example.com">Email</a>
        </body>
      </html>
      `,
      "https://linktr.ee/futureof_education"
    );

    expect(page.title).toBe("Future of Education");
    expect(page.visibleText).toContain("Alpha Anywhere");
    expect(page.links).toEqual([
      {
        title: "Alpha Anywhere",
        url: "https://linktr.ee/apply",
      },
      {
        title: "Become a Guide",
        url: "https://alpha.school/guides",
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { naechsteSeite, repositoryAusImage } from "./registry.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("repositoryAusImage", () => {
  it.each([
    [`ghcr.io/speicherstadt/haben@${DIGEST}`, { registry: "ghcr.io", name: "speicherstadt/haben" }],
    [`docker.io/postgres@${DIGEST}`, { registry: "docker.io", name: "library/postgres" }],
    [
      `docker.io/stalwartlabs/stalwart@${DIGEST}`,
      { registry: "docker.io", name: "stalwartlabs/stalwart" },
    ],
    [`localhost:5000/beispiel@${DIGEST}`, { registry: "localhost:5000", name: "beispiel" }],
  ])("reads %s", (image, repository) => {
    expect(repositoryAusImage(image)).toEqual(repository);
  });

  it.each(["ghcr.io/speicherstadt/haben:1.0.0", "haben", `haben@${DIGEST}`])(
    "has none for %s, which no manifest may name",
    (image) => {
      expect(repositoryAusImage(image)).toBeUndefined();
    },
  );
});

describe("naechsteSeite", () => {
  const seite = "https://ghcr.io/v2/speicherstadt/haben/tags/list?n=100";

  it("follows rel=next relative to the page", () => {
    expect(
      naechsteSeite('</v2/speicherstadt/haben/tags/list?last=1.2.0&n=100>; rel="next"', seite),
    ).toBe("https://ghcr.io/v2/speicherstadt/haben/tags/list?last=1.2.0&n=100");
  });

  it("ends without a link, with another relation or on another origin", () => {
    expect(naechsteSeite(null, seite)).toBeUndefined();
    expect(naechsteSeite('</v2/x/tags/list?last=a>; rel="prev"', seite)).toBeUndefined();
    expect(naechsteSeite('<https://boese.example/v2/x>; rel="next"', seite)).toBeUndefined();
  });
});

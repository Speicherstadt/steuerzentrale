import { describe, expect, it } from "vitest";
import { AUSGELASSEN_AB, inhaltZeigen } from "./audit.ts";

/*
 * BAULISTE.md Z-406: the audit log shows a manifest's text and signature, an encrypted value and
 * other large or secret fields only as left out, whatever an entry holds (an older one too).
 */
describe("inhaltZeigen", () => {
  it("leaves out manifest, signature, a log excerpt's lines and a token's hash", () => {
    const roh = (zeile: Record<string, unknown>) => JSON.stringify({ art: "einfuegen", zeile });
    expect(
      inhaltZeigen("auftraege:a1", roh({ manifest: "schema: 1", signatur: "RWQ", aktion: "x" })),
    ).toEqual({
      art: "einfuegen",
      zeile: { manifest: "[ausgelassen]", signatur: "[ausgelassen]", aktion: "x" },
    });
    expect(
      inhaltZeigen("installationen:i1", roh({ manifest: "m", geheim: "c1", host: "h" })),
    ).toEqual({
      art: "einfuegen",
      zeile: { manifest: "[ausgelassen]", geheim: "[verschlüsselt]", host: "h" },
    });
    expect(inhaltZeigen("logAuszuege:a1", roh({ inhalt: '["zeile"]' }))).toMatchObject({
      zeile: { inhalt: "[ausgelassen]" },
    });
    expect(inhaltZeigen("tokens:t1", roh({ hash: "ab12", zweck: "beitritt" }))).toMatchObject({
      zeile: { hash: "[ausgelassen]", zweck: "beitritt" },
    });
  });

  it("leaves out the values of a change the same way, and any long text", () => {
    const lang = "x".repeat(AUSGELASSEN_AB + 1);
    expect(
      inhaltZeigen(
        "server:s1",
        JSON.stringify({ art: "aendern", werte: { fakten: lang, name: "kurz" } }),
      ),
    ).toEqual({ art: "aendern", werte: { fakten: "[ausgelassen]", name: "kurz" } });
    expect(inhaltZeigen("x", JSON.stringify({ art: "y", frei: lang }))).toEqual({
      art: "y",
      frei: "[ausgelassen]",
    });
    expect(inhaltZeigen("x", "kein json")).toBe("[ausgelassen]");
  });
});

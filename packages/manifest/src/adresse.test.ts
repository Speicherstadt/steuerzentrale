import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  adresseVorschlag,
  freiesKuerzel,
  KUERZEL,
  kuerzelVorschlag,
  unterDomain,
} from "./adresse.ts";
import { HOST } from "./quadlet/eingabe.ts";

// docs/plan.md, "Adresse einer Installation (Z-407)": a customer's short name, the address
// `<app>.<kuerzel>.<domain>` and which hosts lie under the operator's domain

describe("the short name of a customer", () => {
  it("is suggested from the name: lower case, umlauts spelled out, other signs a hyphen", () => {
    expect(kuerzelVorschlag("Praxis Dr. Müller & Söhne GmbH")).toBe(
      "praxis-dr-mueller-soehne-gmbh",
    );
    expect(kuerzelVorschlag("Ärzte–Zentrum Straße")).toBe("aerzte-zentrum-strasse");
    expect(kuerzelVorschlag("Café Élan")).toBe("cafe-elan");
  });

  it("has at most 30 characters and never ends in a hyphen", () => {
    expect(kuerzelVorschlag("Ein sehr sehr langer Kundenname der über dreißig Zeichen geht")).toBe(
      "ein-sehr-sehr-langer-kundennam",
    );
    expect(kuerzelVorschlag("Abcdefghijklmnopqrstuvwxyz abc d")).toBe(
      "abcdefghijklmnopqrstuvwxyz-abc",
    );
  });

  it("falls back to `kunde` for a name without a letter or digit", () => {
    expect(kuerzelVorschlag("!!!")).toBe("kunde");
    expect(kuerzelVorschlag("")).toBe("kunde");
  });

  it("is always a valid short name and a DNS label", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (name) => {
        const k = kuerzelVorschlag(name);
        expect(k).toMatch(KUERZEL);
        expect(`${k}.example.de`).toMatch(HOST);
      }),
    );
  });

  it("accepts only lower-case letters, digits and inner hyphens, up to 30", () => {
    for (const gut of ["a", "kanzlei-west", "k2", "a".repeat(30)]) expect(gut).toMatch(KUERZEL);
    for (const schlecht of ["", "-a", "a-", "Kanzlei", "a_b", "a.b", "a".repeat(31), "ä"])
      expect(schlecht).not.toMatch(KUERZEL);
  });

  it("gets a number when taken, still within 30 characters", () => {
    const vergeben = new Set(["kanzlei", "kanzlei-2"]);
    expect(freiesKuerzel("kanzlei", (k) => vergeben.has(k))).toBe("kanzlei-3");
    expect(freiesKuerzel("frei", (k) => vergeben.has(k))).toBe("frei");
    const lang = "a".repeat(30);
    expect(freiesKuerzel(lang, (k) => k === lang)).toBe(`${"a".repeat(28)}-2`);
  });
});

describe("the address of an installation", () => {
  it("is suggested as <app>.<kuerzel>.<domain>", () => {
    expect(adresseVorschlag("haben", "kanzlei-west", "apps.speicherstadt.de")).toBe(
      "haben.kanzlei-west.apps.speicherstadt.de",
    );
  });

  it("has no suggestion without a domain", () => {
    expect(adresseVorschlag("haben", "kanzlei-west", null)).toBeUndefined();
    expect(adresseVorschlag("haben", "kanzlei-west", "")).toBeUndefined();
  });

  it("lies under the domain only as a name below it, whatever the case", () => {
    expect(unterDomain("haben.k.apps.example.de", "apps.example.de")).toBe(true);
    expect(unterDomain("HABEN.K.apps.example.de", "apps.example.de")).toBe(true);
    expect(unterDomain("apps.example.de", "apps.example.de")).toBe(false);
    expect(unterDomain("haben.k.badapps.example.de", "apps.example.de")).toBe(false);
    expect(unterDomain("apps.example.de.evil.test", "apps.example.de")).toBe(false);
    expect(unterDomain("haben.kunde.test", null)).toBe(false);
  });
});

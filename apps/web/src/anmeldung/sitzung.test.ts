import { describe, expect, it } from "vitest";
import { ohneRahmen, zielFuer } from "./sitzung.ts";

describe("zielFuer", () => {
  it("sends a browser without a session to the sign-in", () => {
    expect(zielFuer("/server", "abgemeldet")).toBe("/anmelden");
  });

  it("sends an account without its second factor to the setup", () => {
    expect(zielFuer("/", "einrichtung")).toBe("/einrichtung");
  });

  it("lets a ready account and an unknown state through, asking nothing after the first owner (Z-1206)", () => {
    expect(zielFuer("/kunden", "bereit")).toBeUndefined();
    expect(zielFuer("/", "bereit")).toBeUndefined();
    expect(zielFuer("/kunden", "unbekannt")).toBeUndefined();
  });

  it("never sends away from the pages outside the shell", () => {
    for (const pfad of ["/anmelden", "/einrichtung", "/einladung", "/erster-inhaber"])
      expect(zielFuer(pfad, "abgemeldet"), pfad).toBeUndefined();
  });
});

describe("ohneRahmen", () => {
  it("knows the pages outside the shell and nothing that only starts like them", () => {
    expect(ohneRahmen("/einladung")).toBe(true);
    expect(ohneRahmen("/einrichtungen")).toBe(false);
    expect(ohneRahmen("/")).toBe(false);
  });
});

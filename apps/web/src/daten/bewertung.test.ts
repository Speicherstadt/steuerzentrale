import { setLocale } from "@steuerzentrale/ui";
import { beforeEach, describe, expect, it } from "vitest";
import { grundText, unitOk } from "./bewertung.ts";

describe("grundText", () => {
  beforeEach(() => setLocale("de", { reload: false }));

  it("says every reason of the Zentrale", () => {
    expect(grundText({ code: "health", werte: { text: "HTTP 503" } })).toBe("Health: HTTP 503");
    expect(grundText({ code: "unit", werte: { unit: "app.service", aktiv: "failed" } })).toBe(
      "Unit app.service: failed",
    );
    expect(grundText({ code: "keine_units", werte: {} })).toBe("Keine Units gemeldet");
    expect(grundText({ code: "nur_units", werte: {} })).toBe(
      "Alle Units aktiv; das Manifest hat keine Health-Prüfung",
    );
    expect(grundText({ code: "keine_meldung", werte: {} })).toBe(
      "Keine Meldung des Agenten seit 90 s",
    );
    expect(grundText({ code: "noch_keine_meldung", werte: {} })).toBe(
      "Noch keine Meldung des Agenten",
    );
  });

  it("speaks English too", () => {
    setLocale("en", { reload: false });
    expect(grundText({ code: "keine_meldung", werte: {} })).toBe(
      "No report from the agent for 90 s",
    );
  });
});

describe("unitOk", () => {
  it("is fine only for active, unknown for a unit the agent could not read", () => {
    expect(["active", "unknown", "failed", "activating"].map(unitOk)).toEqual([
      true,
      null,
      false,
      false,
    ]);
  });
});

import { setLocale } from "@steuerzentrale/ui";
import { beforeEach, describe, expect, it } from "vitest";
import {
  letzterText,
  neustartFehler,
  noetigText,
  planText,
  unattendedText,
} from "./neustart-texte.ts";

/* BAULISTE.md Z-701: the server page says in words what the agent and the plan say */
const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);

describe("the texts of a server's reboot", () => {
  beforeEach(() => setLocale("de", { reload: false }));

  it("say how unattended-upgrades stands, and nothing when the agent could not tell", () => {
    expect(unattendedText(null, JETZT)).toBeNull();
    expect(unattendedText({ installiert: false, aktiv: false, letzterLauf: null }, JETZT)).toBe(
      "nicht installiert",
    );
    expect(unattendedText({ installiert: true, aktiv: false, letzterLauf: null }, JETZT)).toBe(
      "aus",
    );
    expect(unattendedText({ installiert: true, aktiv: true, letzterLauf: null }, JETZT)).toBe(
      "an, noch kein Lauf",
    );
    expect(
      unattendedText({ installiert: true, aktiv: true, letzterLauf: JETZT - 3600_000 }, JETZT),
    ).toMatch(/^an, zuletzt /);
  });

  it("name the kernel a needed reboot is for", () => {
    const k = { laeuft: "6.12.41", installiert: "6.12.48" };
    expect(noetigText(true, k)).toBe("ja, für Kernel 6.12.48");
    expect(noetigText(true, { laeuft: "6.12.48", installiert: "6.12.48" })).toBe("ja");
    expect(noetigText(false, k)).toBe("nein");
    expect(noetigText(null, k)).toBeNull();
  });

  it("say what the plan decides and why it waits", () => {
    expect(planText({ art: "jetzt" }, JETZT)).toBe("jetzt, im Wartungsfenster");
    expect(planText({ art: "warten", grund: "nicht_noetig" }, JETZT)).toBe("keiner geplant");
    expect(planText({ art: "warten", grund: "sperrzeit", ab: JETZT + 86_400_000 }, JETZT)).toMatch(
      /^wartet auf das Ende einer Sperrzeit, dann /,
    );
    expect(planText({ art: "warten", grund: "backup_fehlt" }, JETZT)).toBe(
      "wartet auf eingerichtete Backups",
    );
  });

  it("say how the last reboot ended and by whom", () => {
    expect(letzterText(null, JETZT)).toBeNull();
    const letzter = {
      auftragId: "n-1",
      zustand: "erfolgreich",
      vonHand: true,
      angelegtAm: JETZT - 120_000,
      geaendertAm: JETZT - 60_000,
      fehler: null,
    };
    expect(letzterText(letzter, JETZT)).toMatch(/^erfolgreich \(von Hand, /);
    expect(
      letzterText(
        { ...letzter, zustand: "abgebrochen", vonHand: false, fehler: "Sperrzeit" },
        JETZT,
      ),
    ).toMatch(/^abgebrochen: Sperrzeit \(geplant, /);
  });

  it("explain a refusal, with the freeze window's reason", () => {
    expect(neustartFehler({ fehler: "sperrzeit", detail: "Umsatzsteuer-Voranmeldung" })).toBe(
      "Eine App auf dem Server ist in ihrer Sperrzeit: kein Neustart. (Umsatzsteuer-Voranmeldung)",
    );
    expect(neustartFehler({ fehler: "neu" })).toBe("Der Neustart ging nicht: neu");
  });
});

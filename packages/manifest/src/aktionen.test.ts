import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AKTIONS_AUFTRAEGE,
  aktionAngeboten,
  aktionsAuftragPruefen,
  istAktionsAuftrag,
  nurLesenBefehl,
} from "./aktionen.ts";
import { beispielManifest } from "./quadlet/testeingabe.ts";

/*
 * BAULISTE.md Z-405 (docs/plan.md, "Aktionen einer Installation"): restart and log excerpt are
 * offered by default, "nur lesen" only with a command; what the manifest does not offer is refused.
 */
const ROOT = join(import.meta.dirname, "../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");

const mit = (aktionen: string) =>
  beispielManifest(VORLAGE.replace(/^aktionen:.*(\n {2}.*)*$/m, `aktionen: ${aktionen}`));

const STANDARD = "{ nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }";

describe("aktionAngeboten", () => {
  it("offers restart and log excerpt by default, and nur lesen only with a command", () => {
    const m = mit(STANDARD);
    expect(aktionAngeboten(m, "neustart")).toBe(true);
    expect(aktionAngeboten(m, "log_auszug")).toBe(true);
    expect(aktionAngeboten(m, "nur_lesen")).toBe(false);
    expect(nurLesenBefehl(m)).toBeUndefined();
  });

  it("offers nur lesen with the command the manifest names", () => {
    const m = mit("{ nur_lesen: { befehl: export }, export: nicht_unterstuetzt }");
    expect(aktionAngeboten(m, "nur_lesen")).toBe(true);
    expect(nurLesenBefehl(m)).toBe("export");
  });

  it("does not offer what the manifest marks as not supported", () => {
    const m = mit(
      "{ nur_lesen: { nicht_unterstuetzt: https://example.org/1 }, export: nicht_unterstuetzt, neustart: nicht_unterstuetzt, log_auszug: { nicht_unterstuetzt: https://example.org/2 } }",
    );
    expect(aktionAngeboten(m, "neustart")).toBe(false);
    expect(aktionAngeboten(m, "log_auszug")).toBe(false);
    expect(aktionAngeboten(m, "nur_lesen")).toBe(false);
  });
});

describe("aktionsAuftragPruefen", () => {
  const anfrage = { installationId: "beispiel-x7k2p9", argumente: {} };

  it("accepts a restart and a log excerpt for a named installation", () => {
    const m = mit(STANDARD);
    expect(aktionsAuftragPruefen(m, { ...anfrage, aktion: AKTIONS_AUFTRAEGE.neustart })).toEqual({
      ok: true,
      auftrag: { art: "neustart", name: "beispiel-x7k2p9" },
    });
    expect(istAktionsAuftrag(AKTIONS_AUFTRAEGE.log_auszug)).toBe(true);
    expect(istAktionsAuftrag("migrieren")).toBe(false);
  });

  it.each([
    [
      "an action not offered",
      { aktion: AKTIONS_AUFTRAEGE.neustart },
      "neustart: nicht_unterstuetzt",
    ],
    ["arguments", { aktion: AKTIONS_AUFTRAEGE.neustart, argumente: { x: 1 } }, undefined],
    ["installation data", { aktion: AKTIONS_AUFTRAEGE.log_auszug, einrichtung: {} }, undefined],
    ["no installation", { aktion: AKTIONS_AUFTRAEGE.log_auszug, installationId: null }, undefined],
    ["another job", { aktion: "migrieren" }, undefined],
  ])("refuses %s", (_fall, teil, aktionen) => {
    const m = mit(
      aktionen
        ? `{ nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt, ${aktionen} }`
        : STANDARD,
    );
    expect(aktionsAuftragPruefen(m, { ...anfrage, ...teil }).ok).toBe(false);
  });
});

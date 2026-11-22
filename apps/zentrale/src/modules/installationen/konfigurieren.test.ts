import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  auditLog,
  auftraege,
  installationen,
  installationKonfigurationen,
} from "../../db/schema.ts";
import {
  dateiInhalt,
  installationsUmgebung,
  KENNWORT,
  LIZENZ,
  neueInstallation,
  signiert,
  TEST_SCHLUESSEL,
} from "../../testhilfen/installationen.ts";
import { type AuftragsMeldung, auftragMelden } from "../auftraege/melden.ts";
import { offeneZustellen } from "../auftraege/zustellen.ts";
import { betreiberEinstellungenAendern } from "../einstellungen/index.ts";
import { installationAnlegen } from "./anlegen.ts";
import { installationKonfigurieren } from "./konfigurieren.ts";

/*
 * BAULISTE.md Z-404, the Zentrale's side of "neu konfigurieren": only an installation that runs,
 * never in a freeze window of its manifest, never while a job of it is open; the values are checked
 * against the form, an empty secret keeps the old one, the operator's current values come along,
 * options, ports and generated values stay. The asked values become the installation's only once
 * the agent reports success; no secret stands in plain text in the database file or the audit log.
 */

type U = ReturnType<typeof installationsUmgebung>;
type Nachricht = Record<string, unknown> & {
  aktion?: string;
  auftragId?: string;
  einrichtung?: { installation: unknown; einstellungen: Record<string, Record<string, unknown>> };
};

const NEUES_KENNWORT = "neues-kennwort-der-installation-91d0aa";
const NEUE_LIZENZ = "neue-lizenz-des-betreibers-5be210";

const ergebnis = (auftragId: string, ok: boolean): AuftragsMeldung => ({
  typ: "ergebnis",
  protokoll: 1,
  auftragId,
  zeit: 1,
  ergebnis: ok ? { ok: true, daten: {} } : { ok: false, fehler: "restart: exit 1" },
});

const melden = (u: U, auftragId: string, ok: boolean) => {
  const server = { betreiberId: "b1", serverId: "s1" } as Parameters<typeof auftragMelden>[1];
  auftragMelden(u.deps, server, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
  return auftragMelden(u.deps, server, ergebnis(auftragId, ok), u.uhr.ms);
};

/** Every job the agent got that has not ended, reported done in order */
const allesErledigt = (u: U) => {
  for (const a of u.db.select().from(auftraege).all())
    if (!["erfolgreich", "gescheitert", "abgebrochen"].includes(a.zustand))
      melden(u, a.auftragId, true);
};

/** An installation set up and running, its route set; with what its agent got */
const laufend = (u: U, teil: Parameters<typeof neueInstallation>[0] = {}) => {
  const agent = u.bereit() as Nachricht[];
  const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation(teil));
  if (!a.ok) throw new Error(`${a.grund} ${a.detail ?? ""}`);
  allesErledigt(u);
  allesErledigt(u);
  return { i: a.installation, agent };
};

const zeile = (u: U) => u.db.select().from(installationen).get();
const offen = (u: U) => JSON.parse(zeile(u)?.einstellungen ?? "{}");

const konfigurieren = (u: U, installationId: string, eingabe: Record<string, unknown>) =>
  installationKonfigurieren(
    u.deps,
    { ...u.kontext("b1"), grund: "Wunsch des Kunden" },
    installationId,
    eingabe as Record<string, string>,
  );

describe("configuring an installation anew", () => {
  it("sends the asked values with the operator's current ones, options, ports and generated values staying", () => {
    const u = installationsUmgebung();
    const { i, agent } = laufend(u);
    const einrichten = agent.find((n) => n.aktion === EINRICHTUNG_AKTIONEN.einrichten);
    betreiberEinstellungenAendern(u.deps, u.kontext("b1"), "probe", { PROBE_LIZENZ: NEUE_LIZENZ });
    const r = konfigurieren(u, i.installationId, {
      PROBE_TITEL: "Kanzlei Süd",
      PROBE_KENNWORT: "",
    });
    expect(r).toMatchObject({ ok: true, auftrag: { aktion: EINRICHTUNG_AKTIONEN.konfigurieren } });
    const gesendet = agent.at(-1) as Nachricht;
    expect(gesendet).toMatchObject({
      aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
      installationId: i.installationId,
      argumente: {},
    });
    expect(gesendet.einrichtung).toEqual({
      installation: einrichten?.einrichtung?.installation,
      einstellungen: {
        betreiber: { PROBE_LIZENZ: NEUE_LIZENZ },
        installation: { PROBE_TITEL: "Kanzlei Süd", PROBE_KENNWORT: KENNWORT },
        auto: einrichten?.einrichtung?.einstellungen.auto,
      },
    });
    // sent again on the next connection: the same asked values
    offeneZustellen(u.deps, "b1", "s1");
    expect(agent.at(-1)).toEqual(gesendet);
  });

  it("keeps the installation's values until the agent reports success, then takes the asked ones", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    const r = konfigurieren(u, i.installationId, {
      PROBE_KENNWORT: NEUES_KENNWORT,
      PROBE_TITEL: "Süd",
    });
    if (!r.ok) throw new Error(r.grund);
    expect(offen(u).installation).toEqual({ PROBE_TITEL: "Kanzlei" });
    expect(u.db.select().from(installationKonfigurationen).all()).toHaveLength(1);
    melden(u, r.auftrag.auftragId, true);
    expect(offen(u).installation).toEqual({ PROBE_TITEL: "Süd" });
    expect(zeile(u)?.zustand).toBe("laeuft");
    expect(u.db.select().from(installationKonfigurationen).all()).toEqual([]);
    // the next change starts from the values that now apply: the new secret is kept
    const weiter = konfigurieren(u, i.installationId, { PROBE_KENNWORT: "" });
    expect(weiter.ok).toBe(true);
  });

  it("keeps the installation's values when the agent reports failure", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    const vorher = zeile(u);
    const r = konfigurieren(u, i.installationId, { PROBE_TITEL: "Süd" });
    if (!r.ok) throw new Error(r.grund);
    melden(u, r.auftrag.auftragId, false);
    expect(zeile(u)).toEqual(vorher);
    expect(u.db.select().from(installationKonfigurationen).all()).toEqual([]);
  });

  it("keeps no secret in plain text in the database file or the audit log", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    betreiberEinstellungenAendern(u.deps, u.kontext("b1"), "probe", { PROBE_LIZENZ: NEUE_LIZENZ });
    const r = konfigurieren(u, i.installationId, { PROBE_KENNWORT: NEUES_KENNWORT });
    if (!r.ok) throw new Error(r.grund);
    const pruefen = () => {
      u.sqlite.run("PRAGMA wal_checkpoint(FULL)");
      const datei = dateiInhalt(u.pfad);
      const audit = JSON.stringify(u.db.select().from(auditLog).all());
      for (const g of [LIZENZ, KENNWORT, NEUES_KENNWORT, NEUE_LIZENZ]) {
        expect(datei).not.toContain(g);
        expect(audit).not.toContain(g);
      }
    };
    pruefen();
    melden(u, r.auftrag.auftragId, true);
    pruefen();
  });
});

describe("configuring anew is refused", () => {
  it("for an installation that does not run", () => {
    const u = installationsUmgebung();
    u.bereit();
    const a = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, neueInstallation());
    if (!a.ok) throw new Error(a.grund);
    expect(konfigurieren(u, a.installation.installationId, {})).toEqual({
      ok: false,
      grund: "laeuft_nicht",
    });
  });

  it("while another job of the installation is open", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    expect(konfigurieren(u, i.installationId, { PROBE_TITEL: "A" }).ok).toBe(true);
    const jobs = u.db.select().from(auftraege).all().length;
    expect(konfigurieren(u, i.installationId, { PROBE_TITEL: "B" })).toEqual({
      ok: false,
      grund: "auftrag_offen",
    });
    expect(u.db.select().from(auftraege).all()).toHaveLength(jobs);
  });

  it("in a freeze window of its manifest, and not outside it", () => {
    const u = installationsUmgebung();
    const gesperrt = signiert("gesperrt");
    u.uhr.ms = Date.UTC(2027, 0, 13, 12);
    const { i } = laufend(u, gesperrt);
    u.uhr.ms = Date.UTC(2027, 1, 7, 9);
    expect(konfigurieren(u, i.installationId, { PROBE_TITEL: "A" })).toEqual({
      ok: false,
      grund: "sperrzeit",
      detail: "Umsatzsteuer-Voranmeldung",
    });
    // the 12th ends at midnight in Berlin, an hour before midnight UTC
    u.uhr.ms = Date.UTC(2027, 1, 12, 23, 30);
    expect(konfigurieren(u, i.installationId, { PROBE_TITEL: "A" }).ok).toBe(true);
  });

  it.each([
    ["an unknown name", { UNBEKANNT: "x" }, "UNBEKANNT: the manifest has no such setting"],
    ["a value of the operator", { PROBE_LIZENZ: "x" }, "PROBE_LIZENZ: a setting of another level"],
    [
      "a generated value",
      { PROBE_SCHLUESSEL: "x" },
      "PROBE_SCHLUESSEL: a setting of another level",
    ],
    ["a value of the wrong type", { PROBE_TITEL: 3 }, "PROBE_TITEL: a value of another type"],
  ])("with %s, naming it", (_fall, eingabe, detail) => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    expect(konfigurieren(u, i.installationId, eingabe)).toEqual({
      ok: false,
      grund: "einstellung_ungueltig",
      detail,
    });
  });

  it("for an installation of another operator", () => {
    const u = installationsUmgebung();
    const { i } = laufend(u);
    u.betreiber("b2", "s2");
    expect(
      installationKonfigurieren(u.deps, u.kontext("b2"), i.installationId, { PROBE_TITEL: "x" }),
    ).toEqual({ ok: false, grund: "keine_installation" });
  });
});

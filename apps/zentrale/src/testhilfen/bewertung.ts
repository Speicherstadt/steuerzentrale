import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import type { SchreibDb } from "../db/oeffnen.ts";
import { testDatenbank } from "../db/test-db.ts";
import { schreiben } from "../modules/audit/index.ts";

/*
 * For the tests of ratings (Z-403): operators with a customer, servers and installations written
 * straight through `schreiben`, without the setup that makes them in the Zentrale, and the reports
 * an agent sends about them.
 */
const ORDNER = join(import.meta.dirname, "manifeste");

/** A manifest with a health check (`probe`) and one without (`stumm`, health `keine`) */
export const manifestText = (app: "probe" | "stumm") =>
  readFileSync(join(ORDNER, `${app}.yml`), "utf8");

type Zustand = Extract<NachrichtVomAgenten, { typ: "zustand" }>;
export type ZustandEintrag = Zustand["installationen"][number];

export const zustandNachricht = (installationen: ZustandEintrag[], zeit = 1): Zustand => ({
  typ: "zustand",
  protokoll: 1,
  zeit,
  installationen,
});

/** A report of one installation: its unit `aktiv` and a check of `health` with a reason */
export const eintrag = (
  installationId: string,
  health: ZustandEintrag["health"]["zustand"] = "gruen",
  aktiv: ZustandEintrag["units"][number]["aktiv"] = "active",
  grund = health === "gruen" ? "HTTP 200" : "HTTP 503",
): ZustandEintrag => ({
  installationId,
  units: [{ name: `${installationId}-app.service`, aktiv }],
  health: { zustand: health, grund },
});

/** An operator with customer `k1` and the given servers, written at `jetzt` */
export const betreiberAnlegen = (
  schreibDb: SchreibDb,
  betreiberId: string,
  serverIds: string[],
  jetzt = 1,
) => {
  schreiben(schreibDb, { betreiberId, akteur: "test", jetzt, grund: "Test" }, "test", (w) =>
    w.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: jetzt }),
  );
  kundeUndServer(schreibDb, betreiberId, serverIds, jetzt);
};

/** Customer `k1` and the given servers of an operator that exists */
export const kundeUndServer = (
  schreibDb: SchreibDb,
  betreiberId: string,
  serverIds: string[],
  jetzt = 1,
) =>
  schreiben(schreibDb, { betreiberId, akteur: "test", jetzt, grund: "Test" }, "test", (w) => {
    w.einfuegen("kunden", {
      betreiberId,
      kundeId: "k1",
      name: "Kanzlei",
      kontaktName: "Kim",
      kontaktEmail: "kim@kanzlei.test",
      kuerzel: "kanzlei",
      angelegtAm: jetzt,
    });
    for (const serverId of serverIds)
      w.einfuegen("server", {
        betreiberId,
        serverId,
        name: serverId,
        wartungsfenster: "{}",
        angelegtVon: "test",
        angelegtAm: jetzt,
      });
  });

/** An installation that runs on `serverId`, of the app `probe` unless said otherwise */
export const installationEinfuegen = (
  schreibDb: SchreibDb,
  betreiberId: string,
  installationId: string,
  serverId: string,
  teil: { app?: "probe" | "stumm"; zustand?: "laeuft" | "entfernt" } = {},
) =>
  schreiben(schreibDb, { betreiberId, akteur: "test", jetzt: 1, grund: "Test" }, "test", (w) =>
    w.einfuegen("installationen", {
      betreiberId,
      installationId,
      kundeId: "k1",
      serverId,
      app: teil.app ?? "probe",
      version: "1.0.0",
      manifestHash: "0".repeat(64),
      manifest: manifestText(teil.app ?? "probe"),
      signatur: "-",
      host: `${installationId}.kanzlei.example`,
      ports: "{}",
      optionen: "[]",
      einstellungen: "{}",
      geheim: "-",
      zustand: teil.zustand ?? "laeuft",
      angelegtVon: "test",
      angelegtAm: 1,
      geaendertAm: 1,
    }),
  );

/**
 * Two operators: b1 with servers s1 and s2, b2 with s1; installations i1 (b1, s1), i2 (b1, s2) and
 * i1 (b2, s1), the same name with another operator
 */
export const bewertungsUmgebung = () => {
  const offen = testDatenbank();
  betreiberAnlegen(offen.schreibDb, "b1", ["s1", "s2"]);
  betreiberAnlegen(offen.schreibDb, "b2", ["s1"]);
  installationEinfuegen(offen.schreibDb, "b1", "i1", "s1");
  installationEinfuegen(offen.schreibDb, "b1", "i2", "s2");
  installationEinfuegen(offen.schreibDb, "b2", "i1", "s1");
  return offen;
};

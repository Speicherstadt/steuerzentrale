import type { Antwort } from "../anmeldung/api.ts";
import { suche } from "./ableitungen.ts";
import { appsQuelle, type InstallationsAngebot } from "./apps.ts";
import { type BackupZeile, backupQuelle } from "./backups.ts";
import type { Verlaufseintrag } from "./bewertung.ts";
import {
  type InstallationAnsicht,
  installationAnsicht,
  type Namen,
} from "./installation-ansicht.ts";
import {
  type AuftragDerInstallation,
  type InstallationsAktion,
  type InstallationsFormular,
  installationenQuelle,
} from "./installationen.ts";
import { kundenQuelle } from "./kunden.ts";
import { bestand } from "./quelle.ts";
import { serverQuelle } from "./server.ts";
import { type ServerAnsicht, serverAnsicht } from "./server-ansicht.ts";
import type { Kunde } from "./typen.ts";

/*
 * What the installation pages load (BAULISTE.md Z-402): the installations of the Zentrale with
 * the customers and servers that name them, all three from their sources (src/daten/); the first
 * refusal is the page's error.
 */

const namenLaden = async (): Promise<Antwort<Namen & { serverAnsichten: ServerAnsicht[] }>> => {
  const [kunden, server] = await Promise.all([kundenQuelle().liste(), serverQuelle().liste()]);
  if (!kunden.ok) return kunden;
  if (!server.ok) return server;
  const b = bestand();
  return {
    ok: true,
    status: 200,
    daten: {
      kunden: kunden.daten,
      server: server.daten,
      apps: b.apps,
      demo: b.installationen,
      serverAnsichten: server.daten.map((sv) => serverAnsicht(sv, suche(b.server, sv.serverId))),
    },
  };
};

export type Uebersicht = { installationen: InstallationAnsicht[]; server: ServerAnsicht[] };

export const uebersichtLaden = async (): Promise<Antwort<Uebersicht>> => {
  const [liste, namen] = await Promise.all([installationenQuelle().liste(), namenLaden()]);
  if (!liste.ok) return liste;
  if (!namen.ok) return namen;
  return {
    ok: true,
    status: 200,
    daten: {
      installationen: liste.daten.map((i) => installationAnsicht(i, namen.daten)),
      server: namen.daten.serverAnsichten,
    },
  };
};

export type AppsListe = Uebersicht & {
  backups: BackupZeile[];
  angebote: InstallationsAngebot[];
};

/**
 * The page "Apps": the installations with their servers, and beside them the backups (Z-601) and
 * what each is offered (Z-503); those two only add to a row, so a refusal of them leaves it as the
 * Zentrale's installations have it
 */
export const appsListeLaden = async (): Promise<Antwort<AppsListe>> => {
  const [uebersicht, backups, angebote] = await Promise.all([
    uebersichtLaden(),
    backupQuelle().uebersicht(),
    appsQuelle().angebote(),
  ]);
  if (!uebersicht.ok) return uebersicht;
  return {
    ...uebersicht,
    daten: {
      ...uebersicht.daten,
      backups: backups.ok ? backups.daten : [],
      angebote: angebote.ok ? angebote.daten : [],
    },
  };
};

export type Einzelansicht = InstallationAnsicht & {
  auftraege: AuftragDerInstallation[];
  verlauf: Verlaufseintrag[];
  formular: InstallationsFormular;
  aktionen: Record<InstallationsAktion, boolean>;
  /** Its customer and server, for the cards of the tab "Überblick" */
  kunde: Kunde | undefined;
  server: ServerAnsicht | undefined;
};

export const einzelansichtLaden = async (id: string): Promise<Antwort<Einzelansicht>> => {
  const [eine, namen] = await Promise.all([installationenQuelle().installation(id), namenLaden()]);
  if (!eine.ok) return eine;
  if (!namen.ok) return namen;
  return {
    ok: true,
    status: 200,
    daten: {
      ...installationAnsicht(eine.daten, namen.daten),
      auftraege: eine.daten.auftraege,
      verlauf: eine.daten.verlauf,
      formular: eine.daten.formular,
      aktionen: eine.daten.aktionen,
      kunde: namen.daten.kunden.find((k) => k.id === eine.daten.kundeId),
      server: namen.daten.serverAnsichten.find((sv) => sv.id === eine.daten.serverId),
    },
  };
};

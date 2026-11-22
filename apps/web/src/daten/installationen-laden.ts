import type { Antwort } from "../anmeldung/api.ts";
import { suche } from "./ableitungen.ts";
import type { Verlaufseintrag } from "./bewertung.ts";
import {
  type InstallationAnsicht,
  installationAnsicht,
  type Namen,
} from "./installation-ansicht.ts";
import {
  type AuftragDerInstallation,
  type InstallationsFormular,
  installationenQuelle,
} from "./installationen.ts";
import { kundenQuelle } from "./kunden.ts";
import { bestand } from "./quelle.ts";
import { serverQuelle } from "./server.ts";
import { type ServerAnsicht, serverAnsicht } from "./server-ansicht.ts";

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

export type Einzelansicht = InstallationAnsicht & {
  auftraege: AuftragDerInstallation[];
  verlauf: Verlaufseintrag[];
  formular: InstallationsFormular;
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
    },
  };
};

import type { Platzierung } from "@steuerzentrale/manifest";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demo } from "../demo/index.ts";
import { kundenQuelle } from "./kunden.ts";
import { serverQuelle } from "./server.ts";

/*
 * Where the installation pages and the dialog "Installieren" read and write (BAULISTE.md Z-402):
 * the Zentrale's API once someone is signed in (main.tsx puts it in), else the demo fixtures in
 * memory for `bun run dev:demo` and the component tests. Errors come back as values, a refusal
 * with its reasons as codes (src/anmeldung/api.ts).
 */

/** Where an installation stands (docs/installieren.md, "Zustände") */
export type InstallationsZustand = "wird_eingerichtet" | "laeuft" | "gescheitert" | "entfernt";

/** The states of a job in the Zentrale (packages/protokoll, AUFTRAG_ZUSTAENDE) */
export type AuftragsZustand =
  | "wartend"
  | "bereit"
  | "zugestellt"
  | "bestaetigt"
  | "laeuft"
  | "erfolgreich"
  | "gescheitert"
  | "abgebrochen";

/** A value of an installation's setting; a secret never comes back from the API */
export type Einstellungswert = string | number | boolean;

/** An installation as GET /api/v1/installationen answers it */
export type InstallationDerZentrale = {
  installationId: string;
  kundeId: string;
  serverId: string;
  app: string;
  version: string;
  manifestHash: string;
  host: string;
  httpPort: number | null;
  /** The assigned ports besides HTTP, as "<dienst>:<port>" → host port */
  ports: Record<string, number>;
  optionen: string[];
  /** The values that are not secret, by level */
  einstellungen: {
    betreiber: Record<string, Einstellungswert>;
    installation: Record<string, Einstellungswert>;
  };
  zustand: InstallationsZustand;
  angelegtVon: string;
  angelegtAm: number;
  geaendertAm: number;
};

/** A job of an installation, with its last step and, for a failed one, its reason */
export type AuftragDerInstallation = {
  auftragId: string;
  aktion: string;
  zustand: AuftragsZustand;
  fortschritt: string | null;
  fehler: string | null;
  angelegtAm: number;
  geaendertAm: number;
};

export type InstallationMitAuftraegen = InstallationDerZentrale & {
  auftraege: AuftragDerInstallation[];
};

/** What the dialog asks the placement about: the signed manifest's exact text and signature */
export type PlatzWunsch = {
  kundeId: string;
  serverId: string;
  manifest: string;
  signatur: string;
  optionen: string[];
};

export type NeueInstallation = PlatzWunsch & {
  host: string;
  /** Values of the level `installation`, by name */
  einstellungen: Record<string, Einstellungswert>;
};

export type InstallationenQuelle = {
  liste: () => Promise<Antwort<InstallationDerZentrale[]>>;
  installation: (id: string) => Promise<Antwort<InstallationMitAuftraegen>>;
  /** Whether the app fits the server; writes nothing, needs no reason */
  platzierung: (wunsch: PlatzWunsch) => Promise<Antwort<Platzierung>>;
  anlegen: (neu: NeueInstallation, grund: string) => Promise<Antwort<InstallationDerZentrale>>;
  /** Only an installation whose setup failed (Z-402); answers it with the new removal job */
  entfernen: (id: string, grund: string) => Promise<Antwort<InstallationMitAuftraegen>>;
};

const PFAD = "/api/v1/installationen";
const pfad = (id: string) => `${PFAD}/${encodeURIComponent(id)}`;

export const apiInstallationen: InstallationenQuelle = {
  liste: async () => {
    const antwort = await api<{ installationen: InstallationDerZentrale[] }>(PFAD);
    return antwort.ok ? { ...antwort, daten: antwort.daten.installationen } : antwort;
  },
  installation: (id) => api<InstallationMitAuftraegen>(pfad(id)),
  platzierung: async (wunsch) => {
    const antwort = await api<{ platzierung: Platzierung }>(`${PFAD}/platzierung`, {
      body: wunsch,
    });
    return antwort.ok ? { ...antwort, daten: antwort.daten.platzierung } : antwort;
  },
  anlegen: (neu, grund) => api<InstallationDerZentrale>(PFAD, { body: { ...neu, grund } }),
  entfernen: (id, grund) =>
    api<InstallationMitAuftraegen>(pfad(id), { method: "DELETE", body: { grund } }),
};

/**
 * The demo source, loaded on its first call: it reads manifests with packages/manifest (YAML and
 * Zod), which then stay out of the bundle every page loads when signed in
 */
const spaeterDemo = (): InstallationenQuelle => {
  let geladen: Promise<InstallationenQuelle> | undefined;
  const laden = () => {
    geladen ??= import("../demo/installationen-quelle.ts").then((d) =>
      d.demoInstallationenQuelle({
        jetzt: Date.now,
        kunden: () => kundenQuelle().liste(),
        server: () => serverQuelle().liste(),
        betreiberWerte: [...Object.keys(demo.betreiber.werte), ...demo.betreiber.geheimGesetzt],
      }),
    );
    return geladen;
  };
  return {
    liste: async () => (await laden()).liste(),
    installation: async (id) => (await laden()).installation(id),
    platzierung: async (w) => (await laden()).platzierung(w),
    anlegen: async (neu, grund) => (await laden()).anlegen(neu, grund),
    entfernen: async (id, grund) => (await laden()).entfernen(id, grund),
  };
};

let quelle: InstallationenQuelle = spaeterDemo();

export const installationenQuelle = (): InstallationenQuelle => quelle;

export const installationenQuelleEinsetzen = (neu: InstallationenQuelle): void => {
  quelle = neu;
};

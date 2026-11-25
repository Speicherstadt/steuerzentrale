import { versionAngeboten } from "@steuerzentrale/planung";
import { type Antwort, api } from "../anmeldung/api.ts";

/*
 * Where the pages Apps and Updates and the dialog "App installieren" read the imported manifests
 * and versions (BAULISTE.md Z-501; apps/zentrale, routes/manifeste.ts) and run an update by hand
 * (Z-503; routes/updates.ts): the Zentrale's API once someone is signed in (main.tsx puts it in),
 * else the demo in memory, which answers alike (src/demo/apps-quelle.ts). Errors come back as
 * values (src/anmeldung/api.ts).
 */

/** Available: its manifest is imported; manifest missing: only the registry has it */
export type VersionsZustand = "verfuegbar" | "manifest_fehlt";

/** Who imported a manifest, as the operator may see it */
export type Importiert = {
  am: number;
  durch: "mitglied" | "befehl" | "uebernommen" | "anderer_betreiber";
  nutzerId?: string;
};

export type AppVersion = {
  version: string;
  zustand: VersionsZustand;
  dringend: boolean;
  vorabversion: boolean;
  sha256: string | null;
  importiert: Importiert | null;
};

/** What the registry said last; null before the first query */
export type RegistryStand = {
  abgefragtAm: number;
  /** The repository asked, null while the manifest names no image yet */
  image: string | null;
  versionen: string[];
  fehler: string | null;
};

/** An app with an imported manifest, its versions newest first */
export type AppDerZentrale = {
  app: string;
  versionen: AppVersion[];
  registry: RegistryStand | null;
};

/** One imported manifest with its exact text, which the dialog reads its form from */
export type ManifestDerZentrale = {
  app: string;
  version: string;
  text: string;
  sha256: string;
  dringend: boolean;
  vorabversion: boolean;
  importiert: Importiert;
};

/** What an import answers: whether the version is new, or was there with the same text */
export type ImportAntwort = Omit<ManifestDerZentrale, "text"> & { neu: boolean };

/** A version an installation is offered (packages/planung, angeboteneVersionen) */
export type Angebot = { version: string; dringend: boolean; vorabversion: boolean };

/** Where an update stands: backing up, updating, or how it ended (Z-503) */
export type UpdatePhase =
  | "sichern"
  | "aktualisieren"
  | "aktualisiert"
  | "zurueckgenommen"
  | "ruecknahme_unvollstaendig"
  | "gescheitert"
  | "abgebrochen";

/** The last update of an installation (apps/zentrale, modules/updates/lesen.ts) */
export type LetztesUpdate = {
  vonVersion: string;
  nachVersion: string;
  anlass: "hand" | "welle" | "dringend";
  welle: string | null;
  sperrzeitUebergangen: boolean;
  angefordertAm: number;
  phase: UpdatePhase;
  endeAm: number | null;
  fehler: string | null;
  dauerMs: number | null;
};

export type UpdateStand = { letzter: LetztesUpdate | null; laeuft: boolean };

/** Why the plan holds an installation back (packages/planung, `Wartegrund`) */
export type Wartegrund =
  | "angehalten"
  | "nur_von_hand"
  | "vorabversion"
  | "intern_laeuft"
  | "freigabe_noetig"
  | "kein_termin";

/** Where the plan stands for an installation: its wave and next slot, or why it waits */
export type PlanStand = { welle: "intern" | "alle"; version: string } & (
  | { art: "termin"; ab: number; sperrzeitUebergangen: boolean }
  | { art: "wartet"; grund: Wartegrund }
);

export type InstallationsAngebot = {
  installationId: string;
  kundeId: string;
  app: string;
  version: string;
  intern: boolean;
  angeboten: Angebot[];
  /** Null while it runs the newest version it is offered */
  plan: PlanStand | null;
  update: UpdateStand;
};

/** What an update by hand answers: its two jobs, the backup first */
export type UpdateAngefordert = {
  backup: { auftragId: string; zustand: string };
  update: { auftragId: string; zustand: string };
};

export type AppsQuelle = {
  liste: () => Promise<Antwort<AppDerZentrale[]>>;
  manifest: (app: string, version: string) => Promise<Antwort<ManifestDerZentrale>>;
  /** The owner, with a reason: the manifest's exact text and its .minisig */
  importieren: (
    eingabe: { manifest: string; signatur: string },
    grund: string,
  ) => Promise<Antwort<ImportAntwort>>;
  /** "Registry abfragen": answers once every registry answered */
  abfragen: () => Promise<Antwort<AppDerZentrale[]>>;
  /** What each installation of the operator is offered, its plan and its last update */
  angebote: () => Promise<Antwort<InstallationsAngebot[]>>;
  /** The owner, with a reason: an update to a version the installation is offered (Z-503) */
  update: (
    installationId: string,
    version: string,
    grund: string,
  ) => Promise<Antwort<UpdateAngefordert>>;
};

const appsAus = (a: Antwort<{ apps: AppDerZentrale[] }>): Antwort<AppDerZentrale[]> =>
  a.ok ? { ...a, daten: a.daten.apps } : a;

export const apiApps: AppsQuelle = {
  liste: async () => appsAus(await api<{ apps: AppDerZentrale[] }>("/api/v1/apps")),
  manifest: (app, version) =>
    api<ManifestDerZentrale>(
      `/api/v1/manifeste/${encodeURIComponent(app)}/${encodeURIComponent(version)}`,
    ),
  importieren: (eingabe, grund) =>
    api<ImportAntwort>("/api/v1/manifeste", { body: { ...eingabe, grund } }),
  abfragen: async () =>
    appsAus(await api<{ apps: AppDerZentrale[] }>("/api/v1/versionen/abfragen", { body: {} })),
  angebote: async () => {
    const a = await api<{ installationen: InstallationsAngebot[] }>("/api/v1/updates");
    return a.ok ? { ...a, daten: a.daten.installationen } : a;
  },
  update: (installationId, version, grund) =>
    api<UpdateAngefordert>(`/api/v1/installationen/${encodeURIComponent(installationId)}/update`, {
      body: { version, grund },
    }),
};

/** The demo, loaded on its first call: it reads manifests with packages/manifest (YAML and Zod) */
const spaeterDemo = (): AppsQuelle => {
  let geladen: Promise<AppsQuelle> | undefined;
  const laden = () => {
    geladen ??= import("../demo/apps-quelle.ts").then((d) => d.demoAppsQuelle(d.demoJetzt));
    return geladen;
  };
  return {
    liste: async () => (await laden()).liste(),
    manifest: async (app, version) => (await laden()).manifest(app, version),
    importieren: async (e, grund) => (await laden()).importieren(e, grund),
    abfragen: async () => (await laden()).abfragen(),
    angebote: async () => (await laden()).angebote(),
    update: async (id, version, grund) => (await laden()).update(id, version, grund),
  };
};

let quelle: AppsQuelle = spaeterDemo();

export const appsQuelle = (): AppsQuelle => quelle;

export const appsQuelleEinsetzen = (neu: AppsQuelle): void => {
  quelle = neu;
};

/**
 * The versions of the app the dialog may offer: imported ones, a pre-release only to an internal
 * customer (packages/planung, the rule the Zentrale checks too)
 */
export const installierbar = (a: AppDerZentrale | undefined, intern: boolean): AppVersion[] =>
  (a?.versionen ?? []).filter(
    (v) => v.zustand === "verfuegbar" && versionAngeboten(v.version, intern),
  );

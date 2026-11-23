import { istVorabversion, tagAlsVersion, versionVergleichen } from "@steuerzentrale/planung";
import type { Db } from "../../db/oeffnen.ts";
import { type ManifestKopf, manifesteListe } from "../manifeste/index.ts";

/*
 * What the registries said last (BAULISTE.md Z-501), in memory: the next query comes at the start
 * and every 6 hours (docs/plan.md, "Versionen aus den Registries (Z-501)"), so nothing of it needs
 * to outlive a restart. With the imported manifests it makes the versions of each app: one with a
 * manifest is available, a newer one the registry has without a manifest is new, its manifest
 * missing. The registry is never the release: an imported manifest is offered whatever it lists.
 */

export type RegistryStand = {
  abgefragtAm: number;
  /** The repository asked (`<registry>/<name>`), null when the manifest names no image yet */
  image: string | null;
  /** The tags that are versions (`tagAlsVersion`), newest first */
  versionen: string[];
  fehler: string | null;
};

export type VersionsStand = {
  lesen: (app: string) => RegistryStand | undefined;
  setzen: (app: string, stand: RegistryStand) => void;
};

export const versionsStand = (): VersionsStand => {
  const staende = new Map<string, RegistryStand>();
  return { lesen: (app) => staende.get(app), setzen: (app, s) => staende.set(app, s) };
};

/** The versions among a registry's tags, each once, newest first */
export const versionenAusTags = (tags: readonly string[]): string[] =>
  [...new Set(tags.flatMap((t) => tagAlsVersion(t) ?? []))].sort((a, b) =>
    versionVergleichen(b, a),
  );

export type VersionsZustand = "verfuegbar" | "manifest_fehlt";

export type AppVersion = {
  version: string;
  zustand: VersionsZustand;
  dringend: boolean;
  vorabversion: boolean;
  /** The imported manifest; null while it is missing */
  manifest: Omit<ManifestKopf, "app" | "version" | "dringend"> | null;
};

export type AppUebersicht = {
  app: string;
  versionen: AppVersion[];
  registry: RegistryStand | null;
};

const mitManifest = (k: ManifestKopf): AppVersion => {
  const { app: _, version, dringend, ...manifest } = k;
  return {
    version,
    zustand: "verfuegbar",
    dringend,
    vorabversion: istVorabversion(version),
    manifest,
  };
};

const ohneManifest = (version: string): AppVersion => ({
  version,
  zustand: "manifest_fehlt",
  dringend: false,
  vorabversion: istVorabversion(version),
  manifest: null,
});

/**
 * The registry's versions without a manifest that are new: a release newer than the newest
 * imported release, a pre-release newer than the newest imported version of any kind; an older
 * tag was skipped on purpose and is no news
 */
const neueVersionen = (registry: readonly string[], koepfe: readonly ManifestKopf[]): string[] => {
  const importiert = koepfe.map((k) => k.version);
  const release = importiert.find((v) => !istVorabversion(v)) ?? "0.0.0";
  const jede = importiert[0] ?? "0.0.0";
  return registry.filter(
    (v) =>
      !importiert.includes(v) && versionVergleichen(v, istVorabversion(v) ? jede : release) > 0,
  );
};

/**
 * Every app with an imported manifest and its versions, newest first: the imported ones and the
 * registry's new ones, whose manifest is missing
 */
export const appsUebersicht = (db: Db, stand: VersionsStand): AppUebersicht[] => {
  const nachApp = Map.groupBy(manifesteListe(db), (k) => k.app);
  return [...nachApp].map(([app, koepfe]) => {
    const registry = stand.lesen(app) ?? null;
    const neu = neueVersionen(registry?.versionen ?? [], koepfe);
    const versionen = [...neu.map(ohneManifest), ...koepfe.map(mitManifest)].sort((a, b) =>
      versionVergleichen(b.version, a.version),
    );
    return { app, versionen, registry };
  });
};

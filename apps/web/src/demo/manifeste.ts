import { type Manifest as Echt, manifestPruefen } from "@steuerzentrale/manifest";
import { istVorabversion, versionVergleichen } from "@steuerzentrale/planung";

/*
 * The demo reads its apps from the real manifests in manifeste/<app>/<version>/manifest.yml, as a
 * Zentrale would after their import: the same text, checked with the same schema. Vite puts the
 * files into the demo build. Only an app whose newest manifest names a published image for every
 * container is shown: the demo shows what can be installed, nothing that is still being built.
 */

const DATEIEN = import.meta.glob<string>("../../../../manifeste/*/*/manifest.yml", {
  query: "?raw",
  import: "default",
  eager: true,
});

export type EchtesManifest = { manifest: Echt; text: string };

const lesen = (pfad: string, text: string): EchtesManifest => {
  const g = manifestPruefen(text);
  if (!g.ok) throw new Error(`${pfad}: ${g.fehler.join("; ")}`);
  return { manifest: g.manifest, text };
};

/** Every container (and every option's container) has an image with a digest */
export const veroeffentlicht = (m: Echt): boolean =>
  [...m.container, ...m.optionen.flatMap((o) => o.container)].every(
    (c) => typeof c.image === "string",
  );

/** All manifests in manifeste/, the example app's template aside */
export const alleManifeste = (dateien: Record<string, string> = DATEIEN): EchtesManifest[] =>
  Object.entries(dateien)
    .filter(([pfad]) => !pfad.includes("/beispiel/"))
    .map(([pfad, text]) => lesen(pfad, text));

/**
 * Per app the manifests the demo offers, newest first: published, and pre-releases only below a
 * release (as a Zentrale offers them to internal customers)
 */
export const manifesteJeApp = (liste: EchtesManifest[]): Map<string, EchtesManifest[]> => {
  const jeApp = new Map<string, EchtesManifest[]>();
  for (const e of liste.filter((x) => veroeffentlicht(x.manifest))) {
    jeApp.set(e.manifest.id, [...(jeApp.get(e.manifest.id) ?? []), e]);
  }
  for (const [app, eigene] of jeApp) {
    const sortiert = eigene.sort((a, b) =>
      versionVergleichen(b.manifest.version, a.manifest.version),
    );
    if (sortiert.every((e) => istVorabversion(e.manifest.version))) jeApp.delete(app);
    else jeApp.set(app, sortiert);
  }
  return jeApp;
};

export const MANIFESTE = manifesteJeApp(alleManifeste());

/** The newest released manifest of an app */
export const neuestes = (app: string): EchtesManifest | undefined =>
  MANIFESTE.get(app)?.find((e) => !istVorabversion(e.manifest.version));

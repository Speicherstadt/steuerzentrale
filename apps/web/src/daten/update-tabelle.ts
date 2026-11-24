import { versionVergleichen } from "@steuerzentrale/planung";
import { berlin, isoTag, tageSpaeter } from "../format/zeit.ts";
import type { AppDerZentrale, InstallationsAngebot } from "./apps.ts";
import type { Bestand, Installation } from "./typen.ts";
import { updateMisslungen } from "./update-texte.ts";
import { type Welle, wellen } from "./wellen.ts";

/*
 * The one table of the page "Updates" (BAULISTE.md Z-501 to Z-503), as data: per app a group with
 * its head, the installations in a running wave or able to update, how many more are current, and
 * a newer registry tag without manifest; apps where all is current share one last row. Waves come
 * from the plans of the demo only (Z-503 brings them from the Zentrale); signed in, the rows show
 * the offers.
 */

/** Where an installation stands: in a wave, under way by hand, last update failed, or offered */
export type ZeilenStand =
  /** `ab`: the next maintenance window, for an installation that waits */
  | { art: "welle"; welle: Welle; zustand: "fertig" | "laeuft" | "wartet"; ab: number | null }
  | { art: "laeuft" }
  | { art: "misslungen" }
  | { art: "verfuegbar" };

export type UpdateZeile = {
  installationId: string;
  kunde: string | null;
  gekuendigt: boolean;
  installiert: string;
  neu: string | null;
  stand: ZeilenStand;
  /** The offer, for the update by hand; null in a running wave, where no button belongs */
  angebot: InstallationsAngebot | null;
};

export type GruppenKopf =
  | { art: "welle"; fertig: number; gesamt: number }
  | { art: "von_hand" }
  | { art: "koennen"; n: number; gesamt: number }
  | { art: "aktuell"; n: number };

export type AppGruppe = {
  art: "app";
  app: string;
  name: string;
  neueste: string | null;
  kopf: GruppenKopf | null;
  zeilen: UpdateZeile[];
  weitere: { n: number; version: string } | null;
  /** The newest registry tag without a signed manifest */
  manifestFehlt: string | null;
};

export type Gruppe = AppGruppe | { art: "aktuell"; namen: string[]; n: number };

const neuesteVon = (versionen: string[]): string | null =>
  versionen.reduce<string | null>(
    (a, v) => (a === null || versionVergleichen(v, a) > 0 ? v : a),
    null,
  );

/** The next start of the maintenance window of the installation's server, if the server is known */
const naechstesFenster = (b: Bestand, i: Installation): number | null => {
  const s = b.server.find((x) => x.id === i.server);
  if (!s) return null;
  const heute = berlin(isoTag(b.jetzt), s.wartung.von);
  return heute >= b.jetzt ? heute : berlin(isoTag(tageSpaeter(b.jetzt, 1)), s.wartung.von);
};

const kundeDaten = (b: Bestand, id: string) => {
  const k = b.kunden.find((x) => x.id === id);
  return { kunde: k?.name ?? null, gekuendigt: k ? k.vertrag.ende !== null : false };
};

/** The rows of a wave plan that is still running for the app, or none */
const wellenZeilen = (b: Bestand, app: string): UpdateZeile[] => {
  const plan = b.plaene.find((p) => p.app === app);
  if (!plan) return [];
  const staende = wellen(b, plan);
  if (staende.every((w) => w.zustand === "fertig" || w.zustand === "leer")) return [];
  return staende.flatMap((w) =>
    w.installationen.map((i): UpdateZeile => {
      const fertig = i.version === plan.version;
      const stand: ZeilenStand = fertig
        ? { art: "welle", welle: w.welle, zustand: "fertig", ab: null }
        : i.updateLaeuft
          ? { art: "welle", welle: w.welle, zustand: "laeuft", ab: null }
          : { art: "welle", welle: w.welle, zustand: "wartet", ab: naechstesFenster(b, i) };
      return {
        installationId: i.id,
        ...kundeDaten(b, i.kunde),
        installiert: i.version,
        neu: fertig ? null : plan.version,
        stand,
        angebot: null,
      };
    }),
  );
};

const angebotsStand = (a: InstallationsAngebot): ZeilenStand | null => {
  if (a.update.laeuft) return { art: "laeuft" };
  if (updateMisslungen(a.update)) return { art: "misslungen" };
  return a.angeboten.length > 0 ? { art: "verfuegbar" } : null;
};

const angebotsZeile = (b: Bestand, a: InstallationsAngebot, stand: ZeilenStand): UpdateZeile => ({
  installationId: a.installationId,
  ...kundeDaten(b, a.kundeId),
  installiert: a.version,
  neu: a.angeboten[0]?.version ?? null,
  stand,
  angebot: a,
});

const kopfVon = (
  b: Bestand,
  app: string,
  welle: UpdateZeile[],
  alle: InstallationsAngebot[],
): GruppenKopf | null => {
  if (welle.length > 0) {
    const fertig = welle.filter((z) => z.stand.art === "welle" && z.stand.zustand === "fertig");
    return { art: "welle", fertig: fertig.length, gesamt: welle.length };
  }
  if (alle.length === 0) return null;
  const n = alle.filter((a) => a.angeboten.length > 0).length;
  const ohneHealth = b.apps.some((x) => x.id === app && "keine" in x.health);
  if (n > 0 && ohneHealth) return { art: "von_hand" };
  if (n > 0) return { art: "koennen", n, gesamt: alle.length };
  return { art: "aktuell", n: alle.length };
};

const appGruppe = (
  b: Bestand,
  app: string,
  angebote: InstallationsAngebot[],
  registry: AppDerZentrale | undefined,
): AppGruppe => {
  const alle = angebote.filter((a) => a.app === app);
  const welle = wellenZeilen(b, app);
  const inWelle = new Set(welle.map((z) => z.installationId));
  const rest = alle.filter((a) => !inWelle.has(a.installationId));
  const offen = rest.flatMap((a) => {
    const s = angebotsStand(a);
    return s ? [angebotsZeile(b, a, s)] : [];
  });
  const gezeigt = new Set(offen.map((z) => z.installationId));
  const aktuell = rest.filter((a) => !gezeigt.has(a.installationId));
  const version = neuesteVon(aktuell.map((a) => a.version));
  const zeilen = [...welle, ...offen];
  return {
    art: "app",
    app,
    name: b.apps.find((x) => x.id === app)?.name ?? app,
    neueste: neuesteVon(zeilen.map((z) => z.neu).filter((v): v is string => v !== null)),
    kopf: kopfVon(b, app, welle, alle),
    zeilen,
    weitere: version !== null && zeilen.length > 0 ? { n: aktuell.length, version } : null,
    manifestFehlt: registry?.versionen.find((v) => v.zustand === "manifest_fehlt")?.version ?? null,
  };
};

/** Apps in the order of their descriptions, then those only the Zentrale knows */
const appIds = (b: Bestand, angebote: InstallationsAngebot[], apps: AppDerZentrale[]) => [
  ...new Set([
    ...b.apps.map((a) => a.id),
    ...angebote.map((a) => a.app),
    ...apps.map((a) => a.app),
  ]),
];

const zuVoll = (g: AppGruppe) =>
  g.zeilen.length > 0 || g.manifestFehlt !== null || g.kopf?.art === "welle";

/**
 * The groups of the table: apps with a running wave first, then the others with something to do,
 * then one row for all apps whose installations are all current
 */
export const updateTabelle = (
  b: Bestand,
  angebote: InstallationsAngebot[],
  apps: AppDerZentrale[],
): Gruppe[] => {
  const gruppen = appIds(b, angebote, apps).map((id) =>
    appGruppe(
      b,
      id,
      angebote,
      apps.find((a) => a.app === id),
    ),
  );
  const voll = gruppen.filter(zuVoll);
  const ruhig = gruppen.filter((g) => !zuVoll(g) && g.kopf?.art === "aktuell");
  const welle = (g: AppGruppe) => (g.kopf?.art === "welle" ? 0 : 1);
  const sortiert = [...voll].sort((x, y) => welle(x) - welle(y));
  const n = ruhig.reduce((s, g) => s + (g.kopf?.art === "aktuell" ? g.kopf.n : 0), 0);
  return ruhig.length > 0
    ? [...sortiert, { art: "aktuell", namen: ruhig.map((g) => g.name), n }]
    : sortiert;
};

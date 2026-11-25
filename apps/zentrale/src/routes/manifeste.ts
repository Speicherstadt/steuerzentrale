import { istVorabversion } from "@steuerzentrale/planung";
import type { Context } from "hono";
import { z } from "zod";
import {
  type ManifestKopf,
  manifestImportieren,
  manifestLesen,
} from "../modules/manifeste/index.ts";
import { type AppVersion, appsUebersicht } from "../modules/versionen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Manifests and versions (BAULISTE.md Z-501; docs/plan.md, "Manifeste in der Zentrale (Z-501)",
 * "Versionen aus den Registries (Z-501)"): every role reads the apps with their versions, a
 * manifest's text and what each of its operator's installations is offered; the owner
 * imports a signed manifest with a reason and asks the registries now. Manifests hold for every
 * operator; who imported one is named only to its own operator: a person of another one shows as
 * "anderer Betreiber".
 */

const grund = z.string().trim().min(1).max(500);
const importSchema = z
  .object({
    // the manifest's exact text: never trimmed, its bytes are what the signature signs
    manifest: z
      .string()
      .min(1)
      .max(512 * 1024),
    signatur: z.string().min(1).max(4000),
    grund,
  })
  .strict();

const STATUS = {
  signatur_ungueltig: 422,
  manifest_ungueltig: 422,
  version_vergeben: 409,
} as const;

type Importiert = {
  am: number;
  durch: "mitglied" | "befehl" | "uebernommen" | "anderer_betreiber";
  nutzerId?: string;
};

/** Who imported a manifest, as the asking operator may see it */
const importiertFuer = (
  k: Pick<ManifestKopf, "importiertAm" | "importiertVon" | "importiertVonBetreiber">,
  betreiberId: string,
): Importiert => {
  if (k.importiertVon === "befehl" || k.importiertVon === "uebernommen")
    return { am: k.importiertAm, durch: k.importiertVon };
  return k.importiertVonBetreiber === betreiberId
    ? { am: k.importiertAm, durch: "mitglied", nutzerId: k.importiertVon }
    : { am: k.importiertAm, durch: "anderer_betreiber" };
};

const versionAntwort = (v: AppVersion, betreiberId: string) => ({
  version: v.version,
  zustand: v.zustand,
  dringend: v.dringend,
  vorabversion: v.vorabversion,
  sha256: v.manifest?.sha256 ?? null,
  importiert: v.manifest ? importiertFuer(v.manifest, betreiberId) : null,
});

export const manifesteRouten = (route: Registrar, deps: RoutenDeps): void => {
  const apps = (betreiberId: string) =>
    appsUebersicht(deps.db, deps.versionen.stand).map((a) => ({
      app: a.app,
      versionen: a.versionen.map((v) => versionAntwort(v, betreiberId)),
      registry: a.registry,
    }));

  route("GET /api/v1/apps", (c) => c.json({ apps: apps(c.get("betreiberId")) }));

  route("GET /api/v1/manifeste/:app/:version", (c) => {
    const m = manifestLesen(deps.db, c.req.param("app") ?? "", c.req.param("version") ?? "");
    if (!m) return c.json({ fehler: "kein_manifest" }, 404);
    return c.json({
      app: m.app,
      version: m.version,
      text: m.text,
      sha256: m.sha256,
      dringend: m.dringend,
      vorabversion: istVorabversion(m.version),
      importiert: importiertFuer(m, c.get("betreiberId")),
    });
  });

  route("POST /api/v1/manifeste", async (c: Context<Anfrage>) => {
    const angaben = await eingabe(c, importSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const schluessel = await deps.auslieferung.manifestSchluessel();
    if (!schluessel) return c.json({ fehler: "kein_schluessel" }, 503);
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    const r = manifestImportieren(deps, kontext, schluessel, angaben, "betreiber");
    if (!r.ok)
      return c.json(
        { fehler: r.grund, ...(r.detail === undefined ? {} : { detail: r.detail }) },
        STATUS[r.grund],
      );
    const { text: _, signatur: __, ...kopf } = r.eintrag;
    return c.json(
      {
        neu: r.neu,
        app: kopf.app,
        version: kopf.version,
        dringend: kopf.dringend,
        vorabversion: istVorabversion(kopf.version),
        sha256: kopf.sha256,
        importiert: importiertFuer(kopf, kontext.betreiberId),
      },
      r.neu ? 201 : 200,
    );
  });

  // "Registry abfragen": answers once every registry answered; writes no data, only events
  route("POST /api/v1/versionen/abfragen", async (c) => {
    await deps.versionen.abfragen();
    return c.json({ apps: apps(c.get("betreiberId")) });
  });
};

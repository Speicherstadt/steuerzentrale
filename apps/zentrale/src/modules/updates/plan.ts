import { type Manifest, manifestPruefen } from "@steuerzentrale/manifest";
import {
  angeboteneVersionen,
  type Planeintrag,
  type PlanInstallation,
  updatePlan,
  type Wartungsfenster,
  type Wellenstand,
} from "@steuerzentrale/planung";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen, kunden, server } from "../../db/schema.ts";
import { manifesteDerApp, manifestLesen } from "../manifeste/index.ts";
import { wellenstandLesen } from "./lesen.ts";

/*
 * The update plan of one operator (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale
 * (Z-503)"): each running installation is planned towards the newest imported version it is
 * offered (a pre-release only to an internal customer, packages/planung `angeboteneVersionen`),
 * those of one version together with `updatePlan` (Z-502): its waves, the freeze windows of the old
 * and the new manifest, the maintenance window of the installation's server, urgency, and the
 * waves' state from the updates made so far (lesen.ts). An app whose new version has no health
 * (`health: keine`) is never updated by the plan. Reads only; the loop (schleife.ts) starts what is
 * due, the page "Updates" shows the rest.
 */

/** The window when a server's own cannot be read: daily 02:00–05:00 Europe/Berlin */
export const WARTUNGSFENSTER_VORGABE: Wartungsfenster = {
  tage: [0, 1, 2, 3, 4, 5, 6],
  von: "02:00",
  bis: "05:00",
};

const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The server's maintenance window (JSON `{ tage, von, bis }`), or the default for one unreadable */
export const wartungsfensterLesen = (json: string): Wartungsfenster => {
  try {
    const f = JSON.parse(json) as Partial<Wartungsfenster>;
    const tage = Array.isArray(f.tage) ? f.tage : [];
    const gueltig =
      tage.length > 0 &&
      tage.every((t) => Number.isInteger(t) && t >= 0 && t <= 6) &&
      UHRZEIT.test(String(f.von)) &&
      UHRZEIT.test(String(f.bis));
    return gueltig ? { tage, von: String(f.von), bis: String(f.bis) } : WARTUNGSFENSTER_VORGABE;
  } catch {
    return WARTUNGSFENSTER_VORGABE;
  }
};

export type PlanZeile = Planeintrag & {
  serverId: string;
  app: string;
  version: string;
  dringend: boolean;
};

type Laufend = {
  installationId: string;
  serverId: string;
  app: string;
  version: string;
  manifest: string;
  intern: boolean;
  wartungsfenster: string;
};

const laufende = (db: Db, betreiberId: string): Laufend[] =>
  db
    .select({
      installationId: installationen.installationId,
      serverId: installationen.serverId,
      app: installationen.app,
      version: installationen.version,
      manifest: installationen.manifest,
      intern: kunden.intern,
      wartungsfenster: server.wartungsfenster,
    })
    .from(installationen)
    .innerJoin(
      kunden,
      and(
        eq(kunden.betreiberId, installationen.betreiberId),
        eq(kunden.kundeId, installationen.kundeId),
      ),
    )
    .innerJoin(
      server,
      and(
        eq(server.betreiberId, installationen.betreiberId),
        eq(server.serverId, installationen.serverId),
      ),
    )
    .where(and(eq(installationen.betreiberId, betreiberId), eq(installationen.zustand, "laeuft")))
    .all();

/** Each installation with the newest version it is offered, if any */
const ziele = (db: Db, liste: readonly Laufend[]) => {
  const manifeste = new Map<string, ReturnType<typeof manifesteDerApp>>();
  return liste.flatMap((i) => {
    if (!manifeste.has(i.app)) manifeste.set(i.app, manifesteDerApp(db, i.app));
    const ziel = angeboteneVersionen(i, manifeste.get(i.app) ?? [])[0];
    return ziel ? [{ i, ziel }] : [];
  });
};

const gelesen = (text: string | undefined): Manifest | undefined => {
  const m = text === undefined ? undefined : manifestPruefen(text);
  return m?.ok ? m.manifest : undefined;
};

const planInstallation = (i: Laufend, neu: Manifest): PlanInstallation => ({
  id: i.installationId,
  intern: i.intern,
  automatisch: neu.health.art !== "keine",
  sperrzeiten: [...(gelesen(i.manifest)?.sperrzeiten ?? []), ...neu.sperrzeiten],
  wartungsfenster: [wartungsfensterLesen(i.wartungsfenster)],
});

/** The waves' state of the version; "intern" counts as done only once none of it is left */
const stand = (
  db: Db,
  betreiberId: string,
  gruppe: readonly Laufend[],
  alle: readonly Laufend[],
  app: string,
  version: string,
): Wellenstand => {
  const intern = new Set(
    alle.filter((i) => i.app === app && i.intern).map((i) => i.installationId),
  );
  const w = wellenstandLesen(db, betreiberId, app, version, intern);
  const internOffen = gruppe.some((i) => i.intern);
  return {
    ...(w.stoerungAm === undefined ? {} : { stoerungAm: w.stoerungAm }),
    ...(w.internGelungenAm === undefined || internOffen
      ? {}
      : { internFertigAm: w.internGelungenAm }),
  };
};

/** The plan of every running installation of the operator that is offered a newer version */
export const updatePlanLesen = (db: Db, betreiberId: string, jetzt: number): PlanZeile[] => {
  const alle = laufende(db, betreiberId);
  const gruppen = Map.groupBy(ziele(db, alle), (x) => `${x.i.app}\n${x.ziel.version}`);
  return [...gruppen.values()].flatMap((gruppe) => {
    const { ziel } = gruppe[0] as (typeof gruppe)[number];
    const app = (gruppe[0] as (typeof gruppe)[number]).i.app;
    const neu = gelesen(manifestLesen(db, app, ziel.version)?.text);
    if (!neu) return [];
    const liste = gruppe.map((x) => x.i);
    const eintraege = updatePlan(
      liste.map((i) => planInstallation(i, neu)),
      ziel,
      stand(db, betreiberId, liste, alle, app, ziel.version),
      [],
      jetzt,
    );
    return eintraege.map((e) => {
      const i = liste.find((x) => x.installationId === e.installationId) as Laufend;
      return { ...e, serverId: i.serverId, app, version: ziel.version, dringend: ziel.dringend };
    });
  });
};

/** Whether the entry's update is due now */
export const faellig = (z: PlanZeile, jetzt: number): boolean =>
  z.ergebnis.art === "termin" && z.ergebnis.ab <= jetzt;

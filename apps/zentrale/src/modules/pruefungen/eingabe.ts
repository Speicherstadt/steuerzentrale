import { manifestPruefen, veroeffentlichtePorts } from "@steuerzentrale/manifest";
import type { BackupInstallation, Port, PruefEingabe, PruefFakten } from "@steuerzentrale/planung";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { kunden } from "../../db/schema.ts";
import { backupEingerichtetAm, letzterErfolg } from "../backups/index.ts";
import { type Installation, installationenAufServer } from "../installationen/lesen.ts";
import { type Server, serverFakten } from "../server/index.ts";

/*
 * What the checks of a server read (BAULISTE.md Z-702; docs/plan.md, "Prüfungen eines Servers"),
 * always within the server's operator: its newest facts, the hosts and the published ports of its
 * installations not removed, from their signed manifests, and the backups of those that run.
 */

/** The facts the checks read, with the instant the Zentrale got them; null before the first */
export const pruefFakten = (sv: Server): PruefFakten | null => {
  const f = serverFakten(sv);
  if (!f || sv.faktenAm === null) return null;
  return {
    am: sv.faktenAm,
    platten: f.platten,
    portsOffen: f.portsOffen ?? null,
    nurBeobachten: f.nurBeobachten === true,
    zertifikate: f.zertifikate ?? null,
    uhrzeitAbweichungMs: f.uhrzeitAbweichungMs,
    uhrSynchron: f.uhrSynchron ?? null,
    ramMb: f.ramMb,
    ramBelegtMb: f.last?.ramBelegtMb ?? null,
  };
};

const json = <T>(text: string, sonst: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return sonst;
  }
};

/** The ports the installation's Quadlets publish; none from a manifest that no longer reads */
const portsDer = (i: Installation): Port[] => {
  const m = manifestPruefen(i.manifest);
  if (!m.ok) return [];
  return veroeffentlichtePorts(
    m.manifest,
    json<string[]>(i.optionen, []),
    json<Record<string, number>>(i.ports, {}),
  );
};

/** A running installation whose backups are set up, with its last good run */
const backupDer = (db: Db, i: Installation): BackupInstallation[] => {
  if (i.zustand !== "laeuft") return [];
  const eingerichtetAm = backupEingerichtetAm(db, i.betreiberId, i.installationId);
  if (eingerichtetAm === undefined) return [];
  const kunde =
    db
      .select({ name: kunden.name })
      .from(kunden)
      .where(and(eq(kunden.betreiberId, i.betreiberId), eq(kunden.kundeId, i.kundeId)))
      .get()?.name ?? i.kundeId;
  return [
    {
      installationId: i.installationId,
      name: `${kunde} · ${i.app}`,
      letzterErfolg: letzterErfolg(db, i),
      eingerichtetAm,
    },
  ];
};

export const pruefEingabe = (db: Db, sv: Server, jetzt: number): PruefEingabe => {
  const installationen = installationenAufServer(db, sv.betreiberId, sv.serverId);
  return {
    jetzt,
    fakten: pruefFakten(sv),
    hosts: installationen.map((i) => i.host),
    erlaubtePorts: installationen.flatMap(portsDer),
    backups: installationen.flatMap((i) => backupDer(db, i)),
  };
};

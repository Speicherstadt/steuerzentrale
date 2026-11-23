import { type Einrichtung, PRUEF_RESTORE_AKTION } from "@steuerzentrale/manifest";
import { and, eq, like } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationsPorts } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { Schreiber } from "../audit/index.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import { einrichtungFuer } from "../installationen/einrichtung.ts";
import { installationLesen } from "../installationen/lesen.ts";
import type { Vergeben } from "../installationen/vergabe.ts";

/*
 * The copy of a test restore (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore (Z-602)"): its ports
 * are rows of `installations_ports` under the original installation, their purpose prefixed with the
 * copy's name (`restore-a1b2c3:http`), so the primary key keeps them from every other installation
 * on the server until the job ends; then they are free again. The field `einrichtung` of the job is
 * put together only when it is sent (modules/auftraege, zustellen.ts): the original's settings,
 * secrets decrypted, with the copy's ports; only to the server the original stands on.
 */

/** The copy's name from the job's arguments */
export const kopieVon = (a: Pick<Auftrag, "argumente">): string | undefined => {
  const kopie = (JSON.parse(a.argumente) as { kopie?: unknown }).kopie;
  return typeof kopie === "string" ? kopie : undefined;
};

const zweckPraefix = (kopie: string) => `${kopie}:`;

/** Within the transaction that makes the job: the copy's ports, kept for it */
export const portsVormerken = (
  w: Schreiber,
  ort: { betreiberId: string; serverId: string; installationId: string },
  kopie: string,
  vergeben: Vergeben,
): void => {
  for (const v of vergeben)
    for (let port = v.von; port < v.von + v.anzahl; port++)
      w.einfuegen("installationsPorts", {
        ...ort,
        port,
        zweck: `${zweckPraefix(kopie)}${v.zweck}`,
      });
};

/** The rows of the copy's ports */
const portZeilen = (db: Db, betreiberId: string, installationId: string, kopie: string) =>
  db
    .select()
    .from(installationsPorts)
    .where(
      and(
        eq(installationsPorts.betreiberId, betreiberId),
        eq(installationsPorts.installationId, installationId),
        like(installationsPorts.zweck, `${zweckPraefix(kopie)}%`),
      ),
    )
    .all();

/** Whether a copy of this name holds ports of the operator now */
export const kopieVergeben = (db: Db, betreiberId: string, kopie: string): boolean =>
  db
    .select({ port: installationsPorts.port })
    .from(installationsPorts)
    .where(
      and(
        eq(installationsPorts.betreiberId, betreiberId),
        like(installationsPorts.zweck, `${zweckPraefix(kopie)}%`),
      ),
    )
    .get() !== undefined;

/** Within the transaction that records the job's end: the copy's ports are free again */
export const portsFreigeben = (
  w: Schreiber,
  db: Db,
  a: { betreiberId: string; installationId: string; kopie: string },
): void => {
  for (const p of portZeilen(db, a.betreiberId, a.installationId, a.kopie))
    w.loeschen("installationsPorts", { serverId: p.serverId, port: p.port });
};

type Ports = Pick<Einrichtung["installation"], "httpPort" | "ports">;

/** The HTTP port and the others as a setup job carries them, a range by its first port */
export const portsAus = (vergeben: Vergeben): Ports => ({
  httpPort: vergeben.find((v) => v.zweck === "http")?.von ?? null,
  ports: Object.fromEntries(
    vergeben.filter((v) => v.zweck !== "http").map((v) => [v.zweck, v.von]),
  ),
});

/** The copy's ports as kept in `installations_ports` */
export const kopiePorts = (
  db: Db,
  betreiberId: string,
  installationId: string,
  kopie: string,
): Ports => {
  const vergeben = portZeilen(db, betreiberId, installationId, kopie)
    .sort((a, b) => b.port - a.port)
    .map((z) => ({ zweck: z.zweck.slice(zweckPraefix(kopie).length), von: z.port, anzahl: 1 }));
  // highest first, so the lowest port of a range is the one Object.fromEntries keeps
  return portsAus(vergeben);
};

export type KopieGelesen = { ok: true; einrichtung: Einrichtung } | { ok: false; grund: string };

/** The field `einrichtung` of a test restore, only for the server its installation stands on */
export const kopieEinrichtungFuer = (
  deps: { db: Db; schluessel: Schluesselbund },
  a: Pick<Auftrag, "betreiberId" | "installationId" | "serverId" | "argumente" | "aktion">,
): KopieGelesen => {
  if (a.aktion !== PRUEF_RESTORE_AKTION)
    return { ok: false, grund: `${a.aktion}: no test restore` };
  const kopie = kopieVon(a);
  if (!kopie) return { ok: false, grund: "the job names no copy" };
  const i =
    a.installationId === null
      ? undefined
      : installationLesen(deps.db, a.betreiberId, a.installationId);
  if (!i) return { ok: false, grund: `no installation ${a.installationId}` };
  if (i.serverId !== a.serverId)
    return { ok: false, grund: `${i.installationId} does not stand on server ${a.serverId}` };
  const e = einrichtungFuer(deps, a.betreiberId, i.installationId);
  if (!e.ok) return e;
  const ports = kopiePorts(deps.db, a.betreiberId, i.installationId, kopie);
  return {
    ok: true,
    einrichtung: { ...e.einrichtung, installation: { ...e.einrichtung.installation, ...ports } },
  };
};

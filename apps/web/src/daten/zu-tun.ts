import type { AppDerZentrale } from "./apps.ts";
import type { Dringlichkeit, UebersichtEintrag } from "./betrieb.ts";

/*
 * "Zu tun" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): the entries of GET
 * /api/v1/uebersicht as one row per thing that needs someone, an installation or a server, in the
 * Zentrale's order (worst first). A silent or disconnected agent and a full disk are the cause of
 * what the installations on that server report, so those stand in the server's row; any other
 * finding of a server is not, and its installations keep their own rows. A row of notes only can
 * wait: it goes to "Ohne Eile" and does not count.
 */

export type ZuTunZeile = {
  /** The entry the row is named by: the first, which is the worst */
  haupt: UebersichtEintrag;
  /** What else stands in it, in the Zentrale's order */
  weitere: UebersichtEintrag[];
  schwere: Dringlichkeit;
};

export type ZuTun = { zeilen: ZuTunZeile[]; ohneEile: ZuTunZeile[] };

/** The installation an entry is about, with its server */
const installationVon = (e: UebersichtEintrag) => {
  if (e.art === "stoerung" || e.art === "installation" || e.art === "pruef_restore")
    return e.installation;
  return e.art === "auftrag" ? e.installation : null;
};

/** Whether an entry of a server makes it the cause of its installations' entries */
const istUrsache = (e: UebersichtEintrag): boolean =>
  e.art === "agent" || (e.art === "pruefung" && e.pruefung.pruefung === "platte");

/** The servers whose own entries are the cause of their installations' entries */
const ursachen = (eintraege: UebersichtEintrag[]): Set<string> =>
  new Set(eintraege.flatMap((e) => (istUrsache(e) && "server" in e ? [e.server.serverId] : [])));

/** The row an entry belongs to: its server's, its installation's, or its own */
const schluessel = (e: UebersichtEintrag, server: Set<string>): string => {
  const i = installationVon(e);
  if (i) return server.has(i.serverId) ? `s:${i.serverId}` : `i:${i.installationId}`;
  if (e.art === "agent" || e.art === "pruefung" || e.art === "auftrag")
    return `s:${e.server.serverId}`;
  if (e.verweis.art === "installation" || e.verweis.art === "server")
    return `${e.verweis.art[0]}:${e.verweis.id}`;
  return `e:${e.art === "ereignis" ? e.ereignisId : JSON.stringify(e.verweis)}`;
};

export const zuTun = (eintraege: UebersichtEintrag[]): ZuTun => {
  const server = ursachen(eintraege);
  const zeilen = new Map<string, ZuTunZeile>();
  for (const e of eintraege) {
    const s = schluessel(e, server);
    const zeile = zeilen.get(s);
    if (zeile) zeile.weitere.push(e);
    else zeilen.set(s, { haupt: e, weitere: [], schwere: e.schwere });
  }
  const alle = [...zeilen.values()];
  return {
    zeilen: alle.filter((z) => z.schwere !== "hinweis"),
    ohneEile: alle.filter((z) => z.schwere === "hinweis"),
  };
};

/** How many rows of "Zu tun" there are: the number beside "Übersicht" in the sidebar */
export const brauchtAufmerksamkeit = (eintraege: UebersichtEintrag[]): number =>
  zuTun(eintraege).zeilen.length;

/** A tag the registry shows whose manifest is not imported yet (Z-501): no hurry, worth knowing */
export type NeueVersion = { app: string; version: string };

/** Per app the newest such tag; the versions come newest first (GET /api/v1/apps) */
export const ohneManifest = (katalog: Pick<AppDerZentrale, "app" | "versionen">[]): NeueVersion[] =>
  katalog.flatMap((a) => {
    const fehlt = a.versionen.find((x) => x.zustand === "manifest_fehlt");
    return fehlt ? [{ app: a.app, version: fehlt.version }] : [];
  });

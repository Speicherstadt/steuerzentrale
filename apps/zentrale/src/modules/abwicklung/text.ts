import { type Abwicklung, protokollVon } from "./lesen.ts";

/*
 * The deletion log as the text of the event `installation_geloescht` (BAULISTE.md Z-604), which the
 * notifications send by mail and as a signed webhook (Z-703): every step with its time in UTC.
 */

const zeit = (ms: number) => new Date(ms).toISOString();

export const loeschText = (a: Pick<Abwicklung, "installationId" | "vertragsende" | "protokoll">) =>
  [
    `Löschprotokoll ${a.installationId} (Vertragsende ${zeit(a.vertragsende)})`,
    ...protokollVon(a).map((e) => `${zeit(e.zeitpunkt)} ${e.schritt}: ${e.detail}`),
  ].join("\n");

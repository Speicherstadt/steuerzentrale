import type { SupportQuelle } from "../daten/support.ts";
import type { Zugang } from "../daten/typen.ts";

/**
 * The support accesses of the demo in memory, answering as the Zentrale's API does
 * (routes/support.ts in apps/zentrale): the demo account starts one for itself, 15 minutes to
 * 4 hours, one per installation at a time; a change lasts until the page reloads
 */
export const demoSupport = (
  start: Zugang[],
  jetzt: () => number,
  wer: { name: string; kundeVon: (installationId: string) => string | undefined } = {
    name: "Demo",
    kundeVon: () => undefined,
  },
): SupportQuelle => {
  let liste = structuredClone(start);
  const stand = (z: Zugang): Zugang => {
    const endetAm = z.beendetAm === null ? z.ende : Math.min(z.ende, z.beendetAm);
    const t = jetzt();
    return { ...z, endetAm, aktiv: z.beginn <= t && t < endetAm };
  };
  const ok = <T>(daten: T, status = 200) => ({ ok: true, status, daten }) as const;
  return {
    liste: async (filter = {}) =>
      ok(
        liste
          .map(stand)
          .filter((z) => filter.kundeId === undefined || z.kundeId === filter.kundeId)
          .filter(
            (z) =>
              filter.installationId === undefined || z.installationId === filter.installationId,
          )
          .sort((a, b) => b.beginn - a.beginn),
      ),
    starten: async (installationId, dauerMinuten, grund) => {
      const kundeId = wer.kundeVon(installationId);
      if (kundeId === undefined) return { ok: false, status: 404, fehler: "keine_installation" };
      if (liste.map(stand).some((z) => z.eigen && z.aktiv && z.installationId === installationId))
        return { ok: false, status: 409, fehler: "zugang_aktiv" };
      const beginn = jetzt();
      const z: Zugang = {
        zugangId: crypto.randomUUID(),
        installationId,
        kundeId,
        nutzer: { id: wer.name, name: wer.name },
        grund,
        beginn,
        ende: beginn + dauerMinuten * 60_000,
        beendetAm: null,
        beendetVon: null,
        endetAm: beginn + dauerMinuten * 60_000,
        aktiv: true,
        eigen: true,
        aktionen: [],
      };
      liste = [z, ...liste];
      return ok(z, 201);
    },
    beenden: async (zugangId) => {
      const z = liste.map(stand).find((x) => x.zugangId === zugangId);
      if (!z) return { ok: false, status: 404, fehler: "kein_zugang" };
      if (!z.aktiv) return { ok: false, status: 409, fehler: "zugang_beendet" };
      const beendet = stand({ ...z, beendetAm: jetzt(), beendetVon: wer.name });
      liste = liste.map((x) => (x.zugangId === zugangId ? beendet : x));
      return ok(beendet);
    },
  };
};

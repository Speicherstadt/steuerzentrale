import type { Dienst, DienstAngaben, DiensteQuelle } from "../daten/dienste.ts";
import { dienste } from "./dienste.ts";

/**
 * The observed services of the demo in memory, answering as the Zentrale's API would
 * (routes/dienste.ts in apps/zentrale): a new one is not checked yet; a change lasts until the
 * page reloads
 */
export const demoDienste = (start: Dienst[] = dienste): DiensteQuelle => {
  let liste = structuredClone(start);
  const fehlt = { ok: false, status: 404, fehler: "kein_dienst" } as const;
  const ungueltig = { ok: false, status: 400, fehler: "ungueltig" } as const;
  const host = (adresse: string) =>
    /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/?$/i.exec(adresse.trim())?.[1]?.toLowerCase();
  const werte = (a: DienstAngaben) => {
    const h = host(a.adresse);
    return h && a.name.trim() && a.pfad.startsWith("/")
      ? { name: a.name.trim(), adresse: `https://${h}`, host: h, pfad: a.pfad, kundeId: a.kundeId }
      : undefined;
  };
  return {
    liste: async () => ({
      ok: true,
      status: 200,
      daten: [...liste].sort((a, b) => a.name.localeCompare(b.name, "de")),
    }),
    anlegen: async (angaben) => {
      const w = werte(angaben);
      if (!w) return ungueltig;
      const jetzt = Date.now();
      const neu: Dienst = {
        id: crypto.randomUUID(),
        ...w,
        angelegtAm: jetzt,
        aussen: null,
        verfuegbarkeit: { jahr: 2026, monat: 11, minuten: 0, gemessen: 0, rot: 0, anteil: null },
      };
      liste = [...liste, neu];
      return { ok: true, status: 201, daten: neu };
    },
    aendern: async (id, angaben) => {
      const alt = liste.find((d) => d.id === id);
      if (!alt) return fehlt;
      const w = werte(angaben);
      if (!w) return ungueltig;
      const neu = { ...alt, ...w };
      liste = liste.map((d) => (d.id === id ? neu : d));
      return { ok: true, status: 200, daten: neu };
    },
    entfernen: async (id) => {
      if (!liste.some((d) => d.id === id)) return fehlt;
      liste = liste.filter((d) => d.id !== id);
      return { ok: true, status: 204, daten: null };
    },
  };
};

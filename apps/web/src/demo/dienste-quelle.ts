import { healthPfadGueltig, linuxNutzerGueltig, unitGueltig } from "@steuerzentrale/protokoll";
import {
  type Dienst,
  type DienstAngaben,
  type DiensteQuelle,
  type InnenAngaben,
  innenHealth,
} from "../daten/dienste.ts";
import { dienste } from "./dienste.ts";
import { server } from "./server.ts";

/**
 * The observed services of the demo in memory, answering as the Zentrale's API would
 * (routes/dienste.ts in apps/zentrale): a new one is not checked yet; units only on the demo's
 * server that is only observed, their names checked with the protocol's patterns (Z-1103); a
 * change lasts until the page reloads
 */

/** The rating inside of units the agent has not reported yet */
const NOCH_KEINE: Dienst["innenStand"] = {
  bewertung: "unbekannt",
  grund: { code: "noch_keine_meldung", werte: {} },
  seit: null,
  gemeldetAm: null,
};

const innenFehler = (
  i: InnenAngaben | null,
): "ungueltig" | "kein_server" | "server_verwaltet" | undefined => {
  if (i === null) return undefined;
  const namen =
    (i.nutzer === null || linuxNutzerGueltig(i.nutzer)) &&
    i.units.length > 0 &&
    i.units.every(unitGueltig) &&
    (i.pfad === null || healthPfadGueltig(i.pfad));
  if (!namen) return "ungueltig";
  const sv = server.find((s) => s.id === i.serverId);
  if (!sv) return "kein_server";
  return sv.nurBeobachten ? undefined : "server_verwaltet";
};
export const demoDienste = (start: Dienst[] = dienste): DiensteQuelle => {
  let liste = structuredClone(start);
  const fehlt = { ok: false, status: 404, fehler: "kein_dienst" } as const;
  const ungueltig = { ok: false, status: 400, fehler: "ungueltig" } as const;
  const host = (adresse: string) =>
    /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/?$/i.exec(adresse.trim())?.[1]?.toLowerCase();
  const werte = (a: DienstAngaben) => {
    const h = host(a.adresse);
    return h && a.name.trim() && a.pfad.startsWith("/")
      ? {
          name: a.name.trim(),
          adresse: `https://${h}`,
          host: h,
          pfad: a.pfad,
          kundeId: a.kundeId,
          innen: a.innen && { ...a.innen, health: innenHealth(a.innen) },
        }
      : undefined;
  };
  const nein = (fehler: string) =>
    ({
      ok: false,
      status: fehler === "ungueltig" ? 400 : fehler === "kein_server" ? 404 : 409,
      fehler,
    }) as const;
  return {
    liste: async () => ({
      ok: true,
      status: 200,
      daten: [...liste].sort((a, b) => a.name.localeCompare(b.name, "de")),
    }),
    anlegen: async (angaben) => {
      const w = werte(angaben);
      if (!w) return ungueltig;
      const f = innenFehler(angaben.innen);
      if (f) return nein(f);
      const jetzt = Date.now();
      const neu: Dienst = {
        id: crypto.randomUUID(),
        ...w,
        angelegtAm: jetzt,
        aussen: null,
        innenStand: w.innen ? NOCH_KEINE : null,
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
      const f = innenFehler(angaben.innen);
      if (f) return nein(f);
      const gleich = JSON.stringify(alt.innen) === JSON.stringify(w.innen);
      const neu = {
        ...alt,
        ...w,
        innenStand: gleich ? alt.innenStand : w.innen && NOCH_KEINE,
      };
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

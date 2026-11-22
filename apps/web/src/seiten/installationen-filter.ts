import { anzeige, type InstallationAnsicht, titelVon } from "../daten/installation-ansicht.ts";

/**
 * The filters of the installations page: by state, cancelled apart, and a search. A failed setup
 * counts as red, one on its way as without state; a removed installation is no longer listed.
 */

export type Filter = "alle" | "rot" | "gelb" | "unbekannt" | "gekuendigt";

export const FILTER: Filter[] = ["alle", "rot", "gelb", "unbekannt", "gekuendigt"];

const IN_FILTER: Record<ReturnType<typeof anzeige>, Filter | undefined> = {
  gruen: undefined,
  gelb: "gelb",
  rot: "rot",
  gescheitert: "rot",
  unbekannt: "unbekannt",
  wird_eingerichtet: "unbekannt",
  entfernt: undefined,
};

export const passt = (a: InstallationAnsicht, filter: Filter) => {
  if (filter === "alle") return true;
  const gekuendigt = a.vertragsende !== null;
  if (filter === "gekuendigt") return gekuendigt;
  return IN_FILTER[anzeige(a)] === filter && !gekuendigt;
};

/** Customer, app, address or server contains the query, ignoring case */
export const gefunden = (a: InstallationAnsicht, frage: string) => {
  const q = frage.trim().toLowerCase();
  if (!q) return true;
  return [titelVon(a), a.host, a.serverName].some((text) => text.toLowerCase().includes(q));
};

/** The installations the page lists: not removed */
export const gelistet = (liste: InstallationAnsicht[]) =>
  liste.filter((a) => a.zustand !== "entfernt");

export const gefiltert = (liste: InstallationAnsicht[], filter: Filter, frage: string) =>
  gelistet(liste).filter((a) => passt(a, filter) && gefunden(a, frage));

/** The installations grouped by server, in the order of the servers, servers without one left out */
export const nachServer = <S extends { id: string }>(server: S[], liste: InstallationAnsicht[]) =>
  server
    .map((s) => ({ server: s, installationen: liste.filter((a) => a.serverId === s.id) }))
    .filter((gruppe) => gruppe.installationen.length > 0);

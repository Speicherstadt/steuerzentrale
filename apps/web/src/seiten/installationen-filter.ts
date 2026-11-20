import { istGekuendigt, kundeVon, serverVon, titel } from "../daten/ableitungen.ts";
import type { Bestand, Installation } from "../daten/typen.ts";

/** The filters of the installations page: by state, cancelled apart, and a search */

export type Filter = "alle" | "rot" | "gelb" | "unbekannt" | "gekuendigt";

export const FILTER: Filter[] = ["alle", "rot", "gelb", "unbekannt", "gekuendigt"];

export const passt = (b: Bestand, i: Installation, filter: Filter) => {
  if (filter === "alle") return true;
  if (filter === "gekuendigt") return istGekuendigt(b, i);
  return i.health === filter && !istGekuendigt(b, i);
};

/** Customer, app, address or server contains the query, ignoring case */
export const gefunden = (b: Bestand, i: Installation, frage: string) => {
  const q = frage.trim().toLowerCase();
  if (!q) return true;
  return [titel(b, i), i.adresse, serverVon(b, i.server).name, kundeVon(b, i.kunde).kontakt].some(
    (text) => text.toLowerCase().includes(q),
  );
};

export const gefiltert = (b: Bestand, filter: Filter, frage: string) =>
  b.installationen.filter((i) => passt(b, i, filter) && gefunden(b, i, frage));

/** The filtered installations grouped by server, servers without a match left out */
export const nachServer = (b: Bestand, liste: Installation[]) =>
  b.server
    .map((server) => ({ server, installationen: liste.filter((i) => i.server === server.id) }))
    .filter((gruppe) => gruppe.installationen.length > 0);

import { type Antwort, api } from "../anmeldung/api.ts";
import { demoAbwicklung } from "../demo/abwicklung.ts";

/*
 * What follows a contract's end for an installation (BAULISTE.md Z-604; docs/plan.md, "Kündigung
 * und Löschung"), as the Zentrale's API answers (apps/zentrale, routes/abwicklung.ts): the phase,
 * the deadlines, the archive for the customer and the deletion log, and the link to the archive,
 * made with a reason and shown once. Signed in the API, else the demo in memory.
 */

export type Phase = "laeuft" | "nur_lesen" | "wartet" | "loeschen";

export type Schritt =
  | "archiv"
  | "warten"
  | "loeschen"
  | "repository"
  | "zugang"
  | "dns"
  | "geloescht";

export type ArchivDatei = { tag: string; datei: string; bytes: number };

export type Abwicklung = {
  phase: Phase;
  vertragsende: number | null;
  nurLesenBis: number | null;
  loeschenAb: number | null;
  schritt: Schritt | null;
  archiv: { am: number; objekte: ArchivDatei[] } | null;
  linkBis: number | null;
  geloeschtAm: number | null;
  protokoll: { schritt: string; zeitpunkt: number; detail: string }[];
};

export type ArchivLinks = { gueltigBis: number; links: (ArchivDatei & { url: string })[] };

export type AbwicklungQuelle = {
  lesen: (id: string) => Promise<Antwort<Abwicklung>>;
  link: (id: string, grund: string) => Promise<Antwort<ArchivLinks>>;
};

const pfad = (id: string) => `/api/v1/installationen/${encodeURIComponent(id)}`;

export const apiAbwicklung: AbwicklungQuelle = {
  lesen: (id) => api<Abwicklung>(`${pfad(id)}/abwicklung`),
  link: (id, grund) => api<ArchivLinks>(`${pfad(id)}/archiv-link`, { body: { grund } }),
};

let quelle: AbwicklungQuelle = demoAbwicklung();

export const abwicklungQuelle = (): AbwicklungQuelle => quelle;

export const abwicklungQuelleEinsetzen = (neu: AbwicklungQuelle): void => {
  quelle = neu;
};

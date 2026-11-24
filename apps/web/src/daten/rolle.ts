import { type Antwort, api } from "../anmeldung/api.ts";
import { demo } from "../demo/index.ts";
import type { Rolle } from "./typen.ts";

/*
 * The role of the signed-in account (GET /api/v1/ich), so a page offers a write only to a role that
 * has it (docs/plan.md, "Rollen für Installationen"); the Zentrale checks every write anyway. In
 * `dev:demo` and the component tests it is the demo account's.
 */
export type RollenQuelle = () => Promise<Antwort<Rolle>>;

export const apiRolle: RollenQuelle = async () => {
  const antwort = await api<{ rolle: Rolle }>("/api/v1/ich");
  return antwort.ok ? { ...antwort, daten: antwort.daten.rolle } : antwort;
};

/** Owner and technik make and remove installations; support only reads */
export const darfInstallieren = (rolle: Rolle): boolean =>
  rolle === "inhaber" || rolle === "technik";

/** Owner and technik read the audit log; the Zentrale refuses it to support (Z-102) */
export const darfAuditLesen = (rolle: Rolle): boolean => rolle === "inhaber" || rolle === "technik";

/** Only the owner marks a customer as internal (Z-501) */
export const darfInternMarkieren = (rolle: Rolle): boolean => rolle === "inhaber";

let quelle: RollenQuelle = async () => ({ ok: true, status: 200, daten: demo.konto.rolle });

export const rolleLesen = (): Promise<Antwort<Rolle>> => quelle();

export const rollenQuelleEinsetzen = (neu: RollenQuelle): void => {
  quelle = neu;
};

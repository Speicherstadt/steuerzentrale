import { api } from "./api.ts";

/**
 * Where a page sends the browser before it shows anything: the shell needs an account with its
 * second factor (docs/plan.md, "Anmeldung an der Zentrale"). The server checks every route itself;
 * this only spares a page that would answer 401 or 403 everywhere.
 */
export type Zustand = "bereit" | "abgemeldet" | "einrichtung" | "unbekannt";

/** Pages outside the shell: they work without a session or set one up */
export const OHNE_RAHMEN = ["/anmelden", "/einrichtung", "/einladung", "/erster-inhaber"] as const;

export const ohneRahmen = (pfad: string): boolean =>
  OHNE_RAHMEN.some((frei) => pfad === frei || pfad.startsWith(`${frei}/`));

/** The page to go to instead, or nothing; without an answer the page loads and shows its error */
export const zielFuer = (pfad: string, zustand: Zustand): string | undefined => {
  if (ohneRahmen(pfad)) return undefined;
  if (zustand === "abgemeldet") return "/anmelden";
  if (zustand === "einrichtung") return "/einrichtung";
  return undefined;
};

export type Einrichtung = {
  passwort: boolean;
  totp: boolean;
  passkeys: number;
  zweiterFaktor: boolean;
};

export const einrichtungLesen = () => api<Einrichtung>("/api/v1/einrichtung");

export const sitzungsZustand = async (): Promise<Zustand> => {
  const antwort = await einrichtungLesen();
  if (antwort.ok) return antwort.daten.zweiterFaktor ? "bereit" : "einrichtung";
  return antwort.status === 401 ? "abgemeldet" : "unbekannt";
};

/**
 * The check the root route asks before a page of the shell; main.tsx puts it in. Without one (the
 * component tests, the demo mode) every page loads.
 */
let pruefen: (() => Promise<Zustand>) | undefined;

export const waechterEinsetzen = (pruefung: () => Promise<Zustand>): void => {
  pruefen = pruefung;
};

export const zielVor = async (pfad: string): Promise<string | undefined> =>
  pruefen && !ohneRahmen(pfad) ? zielFuer(pfad, await pruefen()) : undefined;

export const abmelden = () => api("/api/auth/sign-out", { body: {} });

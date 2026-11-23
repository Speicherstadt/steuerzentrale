import { type Antwort, api } from "../anmeldung/api.ts";
import { demo } from "../demo/index.ts";
import type { Rolle } from "./typen.ts";

/*
 * The members of the operator as GET /api/v1/mitglieder lists them (BAULISTE.md Z-406), for the
 * settings' tab "Konten"; in `dev:demo` and the component tests the demo's accounts (main.tsx puts
 * in the API).
 */

export type Mitglied = {
  nutzerId: string;
  name: string;
  email: string;
  rolle: Rolle;
  angelegtAm: number;
};

export type MitgliederQuelle = () => Promise<Antwort<Mitglied[]>>;

export const apiMitglieder: MitgliederQuelle = async () => {
  const a = await api<{ mitglieder: Mitglied[] }>("/api/v1/mitglieder");
  return a.ok ? { ...a, daten: a.daten.mitglieder } : a;
};

const demoMitglieder: MitgliederQuelle = async () => ({
  ok: true,
  status: 200,
  daten: demo.konten.map((k, n) => ({
    nutzerId: `konto-${n}`,
    name: k.name,
    email: `${k.name.split(" ")[0]?.toLowerCase()}@${demo.betreiber.domain}`,
    rolle: k.rolle,
    angelegtAm: k.zuletzt,
  })),
});

let quelle: MitgliederQuelle = demoMitglieder;

export const mitgliederLesen = (): Promise<Antwort<Mitglied[]>> => quelle();

export const mitgliederQuelleEinsetzen = (neu: MitgliederQuelle): void => {
  quelle = neu;
};

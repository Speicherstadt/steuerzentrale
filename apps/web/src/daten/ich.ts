import { type Antwort, api } from "../anmeldung/api.ts";
import { demo } from "../demo/index.ts";
import type { Rolle } from "./typen.ts";

/*
 * The signed-in account and its operator as GET /api/v1/ich names them (BAULISTE.md Z-406), for the
 * sidebar: the operator's name and the own account. In `dev:demo` and the component tests the demo
 * account's (main.tsx puts in the API).
 */

export type Ich = {
  name: string;
  email: string;
  rolle: Rolle;
  faktor: "passkey" | "totp";
  betreiber: { betreiberId: string; name: string };
};

export type IchQuelle = () => Promise<Antwort<Ich>>;

export const apiIch: IchQuelle = () => api<Ich>("/api/v1/ich");

const demoIch: IchQuelle = async () => ({
  ok: true,
  status: 200,
  daten: {
    name: demo.konto.name,
    email: "",
    rolle: demo.konto.rolle,
    faktor: demo.konto.faktor,
    betreiber: { betreiberId: "demo", name: demo.betreiber.name },
  },
});

let quelle: IchQuelle = demoIch;

export const ichLesen = (): Promise<Antwort<Ich>> => quelle();

export const ichQuelleEinsetzen = (neu: IchQuelle): void => {
  quelle = neu;
};

import { createSignal } from "solid-js";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demoBetriebsart } from "../demo/betriebsart.ts";

/*
 * The operator's Betriebsart (BAULISTE.md Z-805; docs/einstellungen.md): `selbst` ("Nur für mich")
 * hides customers and contracts, and every installation goes to the
 * fixed internal customer; `kunden` ("Für Kunden") shows everything; null until the owner answered.
 * Read from GET /api/v1/ich, set with PUT /api/v1/betriebsart; in the demo in memory.
 */

export type Betriebsart = "selbst" | "kunden";

export type BetriebsartStand = { betriebsart: Betriebsart | null; eigenerKundeId: string | null };

export type BetriebsartQuelle = {
  lesen: () => Promise<Antwort<BetriebsartStand>>;
  /** `grund` may be left out only for the first answer */
  setzen: (art: Betriebsart, grund?: string) => Promise<Antwort<BetriebsartStand>>;
};

export const apiBetriebsart: BetriebsartQuelle = {
  lesen: async () => {
    const a = await api<{ betreiber: BetriebsartStand }>("/api/v1/ich");
    return a.ok
      ? {
          ...a,
          daten: {
            betriebsart: a.daten.betreiber.betriebsart,
            eigenerKundeId: a.daten.betreiber.eigenerKundeId,
          },
        }
      : a;
  },
  setzen: (betriebsart, grund) =>
    api<BetriebsartStand>("/api/v1/betriebsart", {
      method: "PUT",
      body: { betriebsart, ...(grund === undefined ? {} : { grund }) },
    }),
};

let quelle: BetriebsartQuelle = demoBetriebsart();

export const betriebsartQuelleEinsetzen = (neu: BetriebsartQuelle): void => {
  quelle = neu;
};

// Every reader reads anew once a change is saved: menu, settings and dialogs follow at once
const [stand, setStand] = createSignal(0);

/** The current Betriebsart; read inside a memo, it is read again after every change */
export const betriebsartLesen = (): Promise<Antwort<BetriebsartStand>> => {
  stand();
  return quelle.lesen();
};

/** Saves a change; on success every reader reads again */
export const betriebsartSetzen = async (
  art: Betriebsart,
  grund?: string,
): Promise<Antwort<BetriebsartStand>> => {
  const antwort = await quelle.setzen(art, grund);
  if (antwort.ok) setStand((n) => n + 1);
  return antwort;
};

/** Whether the interface hides what is only for customers; unknown counts as "Für Kunden" */
export const nurFuerMich = (a: Antwort<BetriebsartStand> | undefined): boolean =>
  a?.ok === true && a.daten.betriebsart === "selbst";

/** The internal customer that owns every installation in "Nur für mich" */
export const eigenerKunde = (a: Antwort<BetriebsartStand> | undefined): string | undefined =>
  a?.ok === true && a.daten.betriebsart === "selbst"
    ? (a.daten.eigenerKundeId ?? undefined)
    : undefined;

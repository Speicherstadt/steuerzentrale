import { m } from "@steuerzentrale/ui";
import type { Manifest, Rolle } from "../daten/typen.ts";
import type { Welle } from "../daten/wellen.ts";

/** Names of the values the data carries as codes, in the interface language */

const ROLLEN: Record<Rolle, () => string> = {
  inhaber: () => m.rolle_inhaber(),
  mitglied: () => m.rolle_mitglied(),
};

export const rolleName = (rolle: Rolle): string => ROLLEN[rolle]();

const STAND: Record<Manifest["stand"], () => string> = {
  stabil: () => m.app_stand_stabil(),
  vorschau: () => m.app_stand_vorschau(),
  entwicklung: () => m.app_stand_entwicklung(),
};

export const standName = (stand: Manifest["stand"]): string => STAND[stand]();

/** Singular or plural by count, for the few texts that need it */
export const anzahl = (
  n: number,
  eins: () => string,
  viele: (p: { n: number }) => string,
): string => (n === 1 ? eins() : viele({ n }));

const WELLEN: Record<Welle, () => string> = {
  intern: () => m.welle_intern(),
  alle: () => m.welle_alle(),
};

export const welleName = (welle: Welle): string => WELLEN[welle]();

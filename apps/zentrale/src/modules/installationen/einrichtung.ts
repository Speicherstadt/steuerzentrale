import type { Einrichtung, Wert } from "@steuerzentrale/manifest";
import type { Db } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { spalteEntschluesseln, spalteVerschluesseln } from "../geheim/spalten.ts";
import { type Installation, installationLesen } from "./lesen.ts";

/*
 * The installation's data in its setup job (docs/plan.md, "Einrichtungsaufträge"): put together
 * from its row when the job is sent, with the secret values and the `auto` values decrypted from
 * the encrypted column `geheim`. Nothing of it is stored with the job.
 */

type Werte = Record<string, Wert>;

/** The settings that may be shown, as the column `einstellungen` keeps them */
export type OffeneEinstellungen = { betreiber: Werte; installation: Werte };
/** The secret values and the generated ones, as the encrypted column `geheim` keeps them */
export type GeheimeEinstellungen = { betreiber: Werte; installation: Werte; auto: Werte };

/** The encrypted column of an installation's row */
export const geheimVerschluesseln = (
  bund: Schluesselbund,
  betreiberId: string,
  installationId: string,
  geheim: GeheimeEinstellungen,
): string =>
  spalteVerschluesseln(
    bund,
    "installationen",
    betreiberId,
    { installationId },
    JSON.stringify(geheim),
  );

/** The setup job's data from the row and its decrypted secrets */
export const einrichtungAus = (i: Installation, geheim: GeheimeEinstellungen): Einrichtung => {
  const offen = JSON.parse(i.einstellungen) as OffeneEinstellungen;
  return {
    installation: {
      kundeId: i.kundeId,
      optionen: JSON.parse(i.optionen) as string[],
      httpPort: i.httpPort,
      ports: JSON.parse(i.ports) as Record<string, number>,
      host: i.host,
      ipv4: i.ipv4,
    },
    einstellungen: {
      betreiber: { ...offen.betreiber, ...geheim.betreiber },
      installation: { ...offen.installation, ...geheim.installation },
      auto: geheim.auto,
    },
  };
};

export type EinrichtungGelesen =
  | { ok: true; einrichtung: Einrichtung }
  | { ok: false; grund: string };

/** The data for the setup job of an installation of the operator, or why there is none */
export const einrichtungFuer = (
  deps: { db: Db; schluessel: Schluesselbund },
  betreiberId: string,
  installationId: string | null,
): EinrichtungGelesen => {
  const i =
    installationId === null ? undefined : installationLesen(deps.db, betreiberId, installationId);
  if (!i) return { ok: false, grund: `no installation ${installationId}` };
  const klar = spalteEntschluesseln(deps.schluessel, "installationen", betreiberId, i, i.geheim);
  if (!klar.ok) return { ok: false, grund: `the secrets of ${i.installationId}: ${klar.grund}` };
  return {
    ok: true,
    einrichtung: einrichtungAus(i, JSON.parse(klar.wert) as GeheimeEinstellungen),
  };
};

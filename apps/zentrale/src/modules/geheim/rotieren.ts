import type { Datenbank } from "../../db/oeffnen.ts";
import { betreiber, geheimnisse } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import { geheimnisZweck } from "./geheimnisse.ts";
import { entschluesseln, schluesselIdVon, verschluesseln } from "./verschluesseln.ts";

type Neuverschluesselt = { betreiberId: string; geheimnisId: string; wert: string };

/**
 * Encrypts every secret anew with the current key (`steuerzentrale schluessel-rotieren`, the old key
 * in STEUERZENTRALE_SECRET_KEY_ALT). All values are decrypted first: one that no key opens stops the
 * rotation before anything is written. Returns how many values were encrypted anew.
 */
export const rotieren = (datenbank: Datenbank, jetzt: number): number => {
  const { db, schreibDb, schluessel } = datenbank;
  const alle = [schluessel.aktuell, ...schluessel.alt];
  const betreiberIds = new Set(
    db
      .select({ id: betreiber.betreiberId })
      .from(betreiber)
      .all()
      .map((zeile) => zeile.id),
  );
  const offen = db
    .select()
    .from(geheimnisse)
    .all()
    .filter((zeile) => schluesselIdVon(zeile.wert) !== schluessel.aktuell.id);
  // A secret of an operator that no longer exists could not be written through the audit log and
  // would stay with the old key, unreadable once that key is gone
  const verwaist = offen.find((zeile) => !betreiberIds.has(zeile.betreiberId));
  if (verwaist)
    throw new Error(`secret ${verwaist.betreiberId}/${verwaist.geheimnisId} has no operator`);
  const neu: Neuverschluesselt[] = offen.map((zeile) => {
    const zweck = geheimnisZweck(zeile.betreiberId, zeile.geheimnisId);
    const klar = entschluesseln(alle, zweck, zeile.wert);
    if (!klar.ok)
      throw new Error(
        `secret ${zeile.betreiberId}/${zeile.geheimnisId} cannot be decrypted: ${klar.grund}`,
      );
    return { ...zeile, wert: verschluesseln(schluessel.aktuell, zweck, klar.wert) };
  });
  for (const betreiberId of betreiberIds) {
    const eigene = neu.filter((zeile) => zeile.betreiberId === betreiberId);
    if (eigene.length === 0) continue;
    const kontext = { betreiberId, akteur: "system", jetzt, grund: "Schlüssel rotiert" };
    schreiben(schreibDb, kontext, "schluessel.rotieren", (s) => {
      for (const zeile of eigene)
        s.aendern(
          "geheimnisse",
          { geheimnisId: zeile.geheimnisId },
          { wert: zeile.wert, geaendertAm: jetzt },
        );
    });
  }
  datenbank.rotationAbschliessen();
  return neu.length;
};

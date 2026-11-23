import { randomUUID } from "node:crypto";
import {
  type AussenStand,
  aussenMeldungPruefen,
  type Bewertungsstand,
  nachFrist,
} from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { schreiben } from "../audit/index.ts";
import type { Installation } from "../installationen/index.ts";
import { AUSSEN_GRUEN_ART, AUSSEN_ROT_ART, letzteAussenMeldung } from "./lesen.ts";
import { aussenGrundText } from "./text.ts";

/*
 * Reporting a change from outside (BAULISTE.md Z-704: "Agent grün, außen rot"): once a second check
 * in a row was red, the event `aussen_rot` (severity `warn`) names the reason outside and what the
 * agent reports inside; once green again after it, `aussen_gruen` (`info`). One event per change,
 * not per check, both through `schreiben`; which was last the events themselves tell.
 */

const INNEN: Record<Bewertungsstand["bewertung"], string> = {
  gruen: "grün",
  gelb: "gelb",
  rot: "rot",
  unbekannt: "unbekannt",
};

const innenText = (innen: Bewertungsstand | null, jetzt: number) =>
  `Agent meldet ${innen ? INNEN[nachFrist(innen, jetzt).bewertung] : "nichts"}`;

/** Writes the event a change from outside calls for; returns which, if any */
export const aussenMelden = (
  deps: { db: Db; schreibDb: SchreibDb; neueId?: () => string },
  i: Installation,
  stand: AussenStand,
  innen: Bewertungsstand | null,
  jetzt: number,
): "rot" | "gruen" | undefined => {
  const letzte = letzteAussenMeldung(deps.db, i.betreiberId, i.installationId);
  const meldung = aussenMeldungPruefen(stand, letzte, jetzt);
  if (!meldung) return undefined;
  const rot = meldung === "rot";
  const kontext = {
    betreiberId: i.betreiberId,
    akteur: "system",
    jetzt,
    grund: rot ? "von außen rot" : "von außen wieder grün",
  };
  schreiben(deps.schreibDb, kontext, `ereignis.${rot ? "aussen-rot" : "aussen-gruen"}`, (s) =>
    s.einfuegen("ereignisse", {
      betreiberId: i.betreiberId,
      ereignisId: (deps.neueId ?? randomUUID)(),
      zeitpunkt: jetzt,
      art: rot ? AUSSEN_ROT_ART : AUSSEN_GRUEN_ART,
      schwere: rot ? "warn" : "info",
      ziel: `installation:${i.installationId}`,
      text: rot
        ? `Von außen rot: ${i.installationId} (${i.host}): ${aussenGrundText(stand.grund)}; ${innenText(innen, jetzt)}`
        : `Von außen wieder grün: ${i.installationId} (${i.host})`,
    }),
  );
  return meldung;
};

import { type AussenStand, aussenJetzt } from "./aussen.ts";
import { type Bewertungsstand, nachFrist, STOERUNG_NACH_MS } from "./bewertung.ts";

/*
 * A fault of an installation (docs/plan.md, "Störung"): health inside or outside red for longer
 * than five minutes. Inside is the agent's rating (bewertung.ts, Z-403), outside the Zentrale's own
 * check (aussen.ts, Z-704); one fault covers both, so the events and everything that reads them
 * (overview, notifications) know one kind.
 */

export type Seite = "innen" | "aussen";

/** Which side has been red for five minutes with its reports or checks coming, inside first */
export const rotSeit5Min = (
  innen: Bewertungsstand | null,
  aussen: AussenStand | null,
  jetzt: number,
): Seite | undefined => {
  const i = innen && nachFrist(innen, jetzt);
  if (i?.bewertung === "rot" && jetzt - i.seit >= STOERUNG_NACH_MS) return "innen";
  const a = aussen && aussenJetzt(aussen, jetzt);
  if (a?.zustand === "rot" && jetzt - a.seit >= STOERUNG_NACH_MS) return "aussen";
  return undefined;
};

/**
 * Whether a fault begins or ends now: red for five minutes inside or outside makes one, unless one
 * is open (`offen`); it ends once each side is green or never measured (`null`: an installation
 * without a public HTTP service is not checked from outside, one the agent never reported has no
 * rating); yellow and unknown end none
 */
export const stoerungPruefen = (
  innen: Bewertungsstand | null,
  offen: boolean,
  jetzt: number,
  aussen: AussenStand | null = null,
): "stoerung" | "behoben" | undefined => {
  if (!offen) return rotSeit5Min(innen, aussen, jetzt) ? "stoerung" : undefined;
  const innenGruen = innen === null || nachFrist(innen, jetzt).bewertung === "gruen";
  const aussenGruen = aussen === null || aussenJetzt(aussen, jetzt).zustand === "gruen";
  return innenGruen && aussenGruen ? "behoben" : undefined;
};

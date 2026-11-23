import { randomUUID } from "node:crypto";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { aktiverZugang, laeuft, nameVon, zugangLesen } from "./lesen.ts";
import { ENDE_ART, START_ART, startText, vonHandText } from "./texte.ts";

/*
 * Starting and ending support accesses (BAULISTE.md Z-802; docs/plan.md, "Support-Zugang"): a member
 * starts one for itself on one installation of its operator, with a reason and a duration from 15
 * minutes to 4 hours (2 hours unless named). The row and the event of the installation go into
 * one transaction through `schreiben`, so start and end stand in the audit log with their reason.
 * Its holder ends it early, owner and technik also another's (`support:verwalten`).
 */

export const DAUER_VORGABE_MIN = 120;
export const DAUER_MIN = 15;
export const DAUER_MAX = 240;

export type SupportDeps = { db: Db; schreibDb: SchreibDb; neueId?: () => string };

export type Start = { installationId: string; dauerMinuten?: number | undefined };

export type Gestartet =
  | { ok: true; zugangId: string }
  | { ok: false; grund: "grund_fehlt" | "dauer" | "keine_installation" | "zugang_aktiv" };

export const zugangStarten = (deps: SupportDeps, kontext: Kontext, start: Start): Gestartet => {
  const dauer = start.dauerMinuten ?? DAUER_VORGABE_MIN;
  if (kontext.grund.trim() === "") return { ok: false, grund: "grund_fehlt" };
  if (!Number.isInteger(dauer) || dauer < DAUER_MIN || dauer > DAUER_MAX)
    return { ok: false, grund: "dauer" };
  const { betreiberId, akteur, jetzt } = kontext;
  const i = installationLesen(deps.db, betreiberId, start.installationId);
  if (!i || i.zustand === "entfernt") return { ok: false, grund: "keine_installation" };
  if (aktiverZugang(deps.db, betreiberId, akteur, i.installationId, jetzt))
    return { ok: false, grund: "zugang_aktiv" };
  const neueId = deps.neueId ?? randomUUID;
  const zugangId = neueId();
  const name = nameVon(deps.db, akteur);
  schreiben(deps.schreibDb, kontext, "support.starten", (w) => {
    w.einfuegen("supportZugaenge", {
      betreiberId,
      zugangId,
      installationId: i.installationId,
      nutzerId: akteur,
      grund: kontext.grund,
      beginn: jetzt,
      ende: jetzt + dauer * 60_000,
      beendetAm: null,
      beendetVon: null,
      endeGemeldetAm: null,
    });
    w.einfuegen("ereignisse", {
      betreiberId,
      ereignisId: neueId(),
      zeitpunkt: jetzt,
      art: START_ART,
      schwere: "info",
      ziel: `installation:${i.installationId}`,
      text: startText(name, dauer * 60_000, kontext.grund),
    });
  });
  return { ok: true, zugangId };
};

export type Beendet =
  | { ok: true }
  | { ok: false; grund: "kein_zugang" | "keine_berechtigung" | "zugang_beendet" };

/** Ends a running access now; `alle`: the caller may end another member's (owner and technik) */
export const zugangBeenden = (
  deps: SupportDeps,
  kontext: Kontext,
  zugangId: string,
  alle: boolean,
): Beendet => {
  const { betreiberId, akteur, jetzt } = kontext;
  const z = zugangLesen(deps.db, betreiberId, zugangId);
  if (!z) return { ok: false, grund: "kein_zugang" };
  if (z.nutzerId !== akteur && !alle) return { ok: false, grund: "keine_berechtigung" };
  if (!laeuft(z, jetzt)) return { ok: false, grund: "zugang_beendet" };
  const name = nameVon(deps.db, z.nutzerId);
  const neueId = deps.neueId ?? randomUUID;
  schreiben(deps.schreibDb, kontext, "support.beenden", (w) => {
    w.aendern(
      "supportZugaenge",
      { zugangId },
      { beendetAm: jetzt, beendetVon: akteur, endeGemeldetAm: jetzt },
    );
    w.einfuegen("ereignisse", {
      betreiberId,
      ereignisId: neueId(),
      zeitpunkt: jetzt,
      art: ENDE_ART,
      schwere: "info",
      ziel: `installation:${z.installationId}`,
      text: vonHandText(name, jetzt - z.beginn),
    });
  });
  return { ok: true };
};

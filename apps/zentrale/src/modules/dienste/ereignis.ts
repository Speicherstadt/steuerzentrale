import { randomUUID } from "node:crypto";
import type { AussenGrund } from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { schreiben } from "../audit/index.ts";
import { aussenGrundText } from "../aussen/text.ts";
import { type DienstZeile, dienstZiel } from "./lesen.ts";

/*
 * An event of an observed service (BAULISTE.md Z-1101, Z-1103): written through `schreiben` by the
 * system, with the target `dienst:<id>`, so the recipients get it like any other.
 */

export type DienstDeps = { db: Db; schreibDb: SchreibDb; neueId?: () => string };

/** The reason in German for an event; there is no Pforte in front of an observed service */
export const grundText = (g: AussenGrund): string =>
  g.code === "pforte" ? `Verbindung: ${g.werte.fehler ?? ""}` : aussenGrundText(g);

export const ereignis = (
  deps: DienstDeps,
  d: Pick<DienstZeile, "betreiberId" | "dienstId">,
  jetzt: number,
  e: {
    aktion: string;
    grund: string;
    art: string;
    schwere: "info" | "warn" | "fehler";
    text: string;
  },
) =>
  schreiben(
    deps.schreibDb,
    { betreiberId: d.betreiberId, akteur: "system", jetzt, grund: e.grund },
    `ereignis.${e.aktion}`,
    (s) =>
      s.einfuegen("ereignisse", {
        betreiberId: d.betreiberId,
        ereignisId: (deps.neueId ?? randomUUID)(),
        zeitpunkt: jetzt,
        art: e.art,
        schwere: e.schwere,
        ziel: dienstZiel(d.dienstId),
        text: e.text,
      }),
  );

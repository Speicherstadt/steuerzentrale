import type { OeffentlicherSchluessel } from "@steuerzentrale/manifest";
import { betreiber } from "../../db/schema.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { type UpdateDeps, updateAnlegen } from "./anlegen.ts";
import { updateAufServer } from "./lesen.ts";
import { faellig, type PlanZeile, updatePlanLesen } from "./plan.ts";

/*
 * The planning of updates (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale (Z-503)"):
 * every 5 minutes each operator's plan (plan.ts), and every update that is due is made as by hand
 * (updateAnlegen), with the reason naming its wave, at most one per server at a time: a server
 * with an update under way, or one already started in this round, waits for the next. Urgent ones
 * first. An update that cannot be made now (an open job, backups not set up) is tried again in the
 * next round; any other refusal is logged. Like the test restores (modules/pruef-restore) the jobs
 * and rows themselves are the state, so a restart of the Zentrale changes nothing.
 */

export const UPDATE_PLANUNG_MS = 5 * 60_000;

export type PlanungsDeps = UpdateDeps & {
  /** The public key the agents check manifests with; without it no update is made */
  manifestSchluessel: () => Promise<OeffentlicherSchluessel | undefined>;
};

/** Refusals that pass by themselves; they are not logged every 5 minutes */
const SPAETER: ReadonlySet<string> = new Set([
  "auftrag_offen",
  "server_belegt",
  "nicht_eingerichtet",
  "laeuft_nicht",
]);

const grundVon = (z: PlanZeile): string =>
  z.dringend
    ? `Dringendes Update auf ${z.app} ${z.version}`
    : `Welle ${z.welle}: ${z.app} ${z.version}`;

export type Runde = { angelegt: string[] };

/** One round over every operator; returns the installations it started an update of */
export const updatesPlanen = async (deps: PlanungsDeps): Promise<Runde> => {
  const schluessel = await deps.manifestSchluessel();
  if (!schluessel) return { angelegt: [] };
  const jetzt = deps.now();
  const angelegt: string[] = [];
  for (const { id: betreiberId } of deps.db
    .select({ id: betreiber.betreiberId })
    .from(betreiber)
    .all()) {
    const belegt = new Set<string>();
    const zeilen = updatePlanLesen(deps.db, betreiberId, jetzt)
      .filter((z) => faellig(z, jetzt))
      .sort((a, b) => Number(b.dringend) - Number(a.dringend));
    for (const z of zeilen) {
      if (belegt.has(z.serverId) || updateAufServer(deps.db, betreiberId, z.serverId)) continue;
      const kontext = { betreiberId, akteur: "system", jetzt, grund: grundVon(z) };
      const r = updateAnlegen(deps, kontext, schluessel, z.installationId, {
        version: z.version,
        anlass: z.dringend ? "dringend" : "welle",
        welle: z.welle,
        sperrzeitUebergehen: false,
      });
      if (r.ok) {
        belegt.add(z.serverId);
        angelegt.push(z.installationId);
      } else if (!SPAETER.has(r.grund))
        deps.log(
          JSON.stringify({
            msg: "update not made",
            installationId: z.installationId,
            version: z.version,
            grund: r.grund,
            detail: r.detail,
          }),
        );
    }
  }
  return { angelegt };
};

/** Every 5 minutes, from now on */
export const updateSchleife = (deps: PlanungsDeps, planen: Planer): void => {
  planen(() => {
    updatesPlanen(deps)
      .then((r) => {
        if (r.angelegt.length > 0) deps.log(JSON.stringify({ msg: "updates started", ...r }));
      })
      .catch((fehler) =>
        deps.log(JSON.stringify({ msg: "update planning failed", fehler: String(fehler) })),
      );
  }, UPDATE_PLANUNG_MS);
};

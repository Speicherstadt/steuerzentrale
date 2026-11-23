import { manifestPruefen, SERVER_NEUSTART_AKTION, UPDATE_AKTION } from "@steuerzentrale/manifest";
import { neustartZustellbar, type Sperrzeit } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, server } from "../../db/schema.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import { installationenAufServer } from "../installationen/lesen.ts";
import { wartungsfensterLesen } from "../updates/plan.ts";

/*
 * The freeze windows that hold a reboot of a server (BAULISTE.md Z-701; docs/plan.md, "Wann ein
 * Server neu startet", "Neustart beim Zustellen"): those of every app on it, from the manifest of
 * each installation that is not removed and from the new manifest of an open update, and whether a
 * reboot the agent has not acknowledged may go out now.
 */

const ausManifest = (text: string): Sperrzeit[] => {
  const m = manifestPruefen(text);
  return m.ok ? m.manifest.sperrzeiten : [];
};

export const sperrzeitenAufServer = (
  db: Db,
  betreiberId: string,
  serverId: string,
): Sperrzeit[] => {
  const installiert = installationenAufServer(db, betreiberId, serverId).flatMap((i) =>
    ausManifest(i.manifest),
  );
  const neu = db
    .select({ manifest: auftraege.manifest, zustand: auftraege.zustand })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.serverId, serverId),
        eq(auftraege.aktion, UPDATE_AKTION),
      ),
    )
    .all()
    .filter((a) => !ENDZUSTAENDE.has(a.zustand))
    .flatMap((a) => ausManifest(a.manifest));
  return [...installiert, ...neu];
};

/** Made by the plan (docs/plan.md, "Wann ein Server neu startet"), not by a person */
export const VON_DER_PLANUNG = "system";

/**
 * Whether the job may go out now: anything but a reboot not yet acknowledged may; such a reboot
 * never in a freeze window of an app on its server, and one of the plan only in the window
 */
export const neustartDarfHinaus = (
  db: Db,
  a: Pick<Auftrag, "betreiberId" | "serverId" | "aktion" | "zustand" | "angelegtVon">,
  jetzt: number,
): boolean => {
  if (a.aktion !== SERVER_NEUSTART_AKTION) return true;
  if (a.zustand !== "bereit" && a.zustand !== "zugestellt") return true;
  const zeile = db
    .select({ wartungsfenster: server.wartungsfenster })
    .from(server)
    .where(and(eq(server.betreiberId, a.betreiberId), eq(server.serverId, a.serverId)))
    .get();
  if (!zeile) return false;
  const fenster =
    a.angelegtVon === VON_DER_PLANUNG ? wartungsfensterLesen(zeile.wartungsfenster) : undefined;
  return neustartZustellbar(sperrzeitenAufServer(db, a.betreiberId, a.serverId), fenster, jetzt);
};

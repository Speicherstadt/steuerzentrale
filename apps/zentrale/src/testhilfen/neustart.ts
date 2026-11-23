import { SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import { and, asc, eq } from "drizzle-orm";
import { auftraege, ereignisse } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { neustartAnlegen, neustartsPlanen } from "../modules/neustart/index.ts";
import { FAKTEN } from "./installationen.ts";
import { pruefUmgebung } from "./pruef-restore.ts";

/*
 * For the tests of reboots (Z-701): the environment of test restores (testhilfen/pruef-restore.ts),
 * its server `s1` joined with a daily window 03:00–04:00 Europe/Berlin and facts that ask for a
 * reboot of the boot BOOT, the planning round, reboots by hand, and the agent's reports.
 */

type Nachbau = Parameters<typeof pruefUmgebung>[0];

/** The boot of the facts (packages/protokoll, beispiele-v1.ts) and the one after the reboot */
export const BOOT = FAKTEN.bootId as string;
export const NEUER_BOOT = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";

/** Saturday 16.01.2027, 03:30 CET: inside the window */
export const IM_FENSTER = Date.UTC(2027, 0, 16, 2, 30);
/** The same day, 04:30 CET: after it */
export const NACH_FENSTER = Date.UTC(2027, 0, 16, 3, 30);
/** Monday 08.02.2027, 03:30 CET: inside the window and inside the freeze window 7th–12th */
export const IN_SPERRZEIT = Date.UTC(2027, 1, 8, 2, 30);

export const neustartUmgebung = (minio: Nachbau, betreiberId = "b1") => {
  const u = pruefUmgebung(minio, betreiberId);

  const beitreten = (b = betreiberId, serverId = "s1") =>
    schreiben(u.schreibDb, u.kontext(b), "test", (w) =>
      w.aendern(
        "server",
        { serverId },
        {
          beigetretenAm: u.uhr.ms,
          wartungsfenster: JSON.stringify({
            tage: [0, 1, 2, 3, 4, 5, 6],
            von: "03:00",
            bis: "04:00",
          }),
        },
      ),
    );
  beitreten();

  const planen = () => neustartsPlanen(u.deps);

  const vonHand = (serverId = "s1", b = betreiberId) =>
    neustartAnlegen(
      u.deps,
      { ...u.kontext(b), jetzt: u.uhr.ms, grund: "Kernel-Update von Hand" },
      serverId,
    );

  const neustarts = (b = betreiberId) =>
    u.db
      .select()
      .from(auftraege)
      .where(and(eq(auftraege.betreiberId, b), eq(auftraege.aktion, SERVER_NEUSTART_AKTION)))
      .orderBy(asc(auftraege.angelegtAm))
      .all();

  const ereignisseVon = (b = betreiberId, serverId = "s1") =>
    u.db
      .select()
      .from(ereignisse)
      .where(and(eq(ereignisse.betreiberId, b), eq(ereignisse.ziel, `server:${serverId}`)))
      .orderBy(asc(ereignisse.zeitpunkt))
      .all();

  /** The agent reports the reboot: back on a new boot, or failed */
  const neustartMelden = (auftragId: string, ok: boolean) =>
    u.pruefMelden(
      auftragId,
      u.ergebnis(
        auftragId,
        ok
          ? { ok: true, daten: { bootId: NEUER_BOOT } }
          : { ok: false, fehler: "Neustart nicht erfolgt: Agent neu gestartet" },
      ),
    );

  return { ...u, beitreten, planen, vonHand, neustarts, ereignisseVon, neustartMelden };
};

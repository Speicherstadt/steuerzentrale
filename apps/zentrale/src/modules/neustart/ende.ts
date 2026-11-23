import { BACKUP_AKTIONEN, SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import {
  type AuftragZustand,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
} from "@steuerzentrale/protokoll";
import type { Db } from "../../db/oeffnen.ts";
import type { Schreiber } from "../audit/index.ts";
import { type Auftrag, auftraegeImZustand, vorgaengerVon } from "../auftraege/lesen.ts";

/*
 * What the Zentrale writes about a reboot of a server (BAULISTE.md Z-701; docs/plan.md, "Ende des
 * Neustarts"), each as an event of the server within the transaction that ends a job: the reboot
 * succeeded (the agent came back on a new boot), failed, or was cancelled; and a reboot waiting for
 * the backup of an installation that did not succeed is cancelled with it (abhaengigkeiten.ts) and
 * says why.
 */

export const NEUSTART_ARTEN = {
  erfolgreich: "server_neu_gestartet",
  gescheitert: "server_neustart_gescheitert",
  abgebrochen: "server_neustart_abgebrochen",
} as const;

type Ergebnis = Extract<NachrichtVomAgenten, { typ: "ergebnis" }>["ergebnis"];
type Ende = { betreiberId: string; auftragId: string; serverId: string };

const ereignis = (
  w: Schreiber,
  a: Ende,
  art: keyof typeof NEUSTART_ARTEN,
  text: string,
  jetzt: number,
) =>
  w.einfuegen("ereignisse", {
    betreiberId: a.betreiberId,
    ereignisId: `neustart-${a.auftragId}`,
    zeitpunkt: jetzt,
    art: NEUSTART_ARTEN[art],
    schwere: art === "erfolgreich" ? "info" : art === "gescheitert" ? "fehler" : "warn",
    ziel: `server:${a.serverId}`,
    text,
  });

const grundVon = (zustand: AuftragZustand, ergebnis: Ergebnis | undefined): string =>
  ergebnis && !ergebnis.ok ? ergebnis.fehler : `Auftrag ${zustand}`;

/** At the end of a reboot job: its event */
const neustartBeenden = (
  w: Schreiber,
  a: Pick<Auftrag, "betreiberId" | "auftragId" | "serverId">,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
  jetzt: number,
): void => {
  if (zustand === "erfolgreich") {
    const boot = ergebnis?.ok ? ergebnis.daten.bootId : undefined;
    const text = typeof boot === "string" ? `Server neu gestartet (Boot ${boot})` : "Server neu gestartet";
    return void ereignis(w, a, "erfolgreich", text, jetzt);
  }
  const art = zustand === "abgebrochen" ? "abgebrochen" : "gescheitert";
  const was = art === "abgebrochen" ? "abgebrochen" : "gescheitert";
  ereignis(w, a, art, `Neustart des Servers ${was}: ${grundVon(zustand, ergebnis)}`, jetzt);
};

/** A backup before a reboot that did not succeed: the reboots waiting for it, cancelled with it */
const backupGescheitert = (
  w: Schreiber,
  db: Db,
  a: Pick<Auftrag, "betreiberId" | "auftragId" | "installationId">,
  jetzt: number,
): void => {
  for (const n of auftraegeImZustand(db, a.betreiberId, "wartend"))
    if (n.aktion === SERVER_NEUSTART_AKTION && vorgaengerVon(n).includes(a.auftragId))
      ereignis(
        w,
        n,
        "abgebrochen",
        `Neustart des Servers abgebrochen: das Backup von ${a.installationId} davor ging nicht`,
        jetzt,
      );
};

export const neustartFortschreiben = (
  w: Schreiber,
  db: Db,
  a: Pick<Auftrag, "betreiberId" | "auftragId" | "serverId" | "installationId" | "aktion">,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
  jetzt: number,
): void => {
  if (!ENDZUSTAENDE.has(zustand)) return;
  if (a.aktion === SERVER_NEUSTART_AKTION) return neustartBeenden(w, a, zustand, ergebnis, jetzt);
  if (a.aktion === BACKUP_AKTIONEN.jetzt && zustand !== "erfolgreich")
    backupGescheitert(w, db, a, jetzt);
};

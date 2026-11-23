import { join } from "node:path";

/**
 * Where the agent keeps what it needs on its server (install/install.sh lays it out): the manifest
 * key and its settings under /etc, its key and certificates under /var/lib, root only for the key
 */
export const KONFIG = "/etc/steuerzentrale";
export const ZUSTAND = "/var/lib/steuerzentrale";

export type Pfade = {
  manifestSchluessel: string;
  einstellungen: string;
  schluessel: string;
  zertifikat: string;
  ca: string;
  /** A rotated key and certificate until both are in place (src/verbindung/rotieren.ts) */
  schluesselNeu: string;
  zertifikatNeu: string;
  /** journald's cursor after the last SSH login reported (src/ssh/anmeldungen.ts) */
  sshCursor: string;
  /** The record of jobs, by id (src/auftraege/zustand.ts) */
  auftraege: string;
  /** The record of the installations the agent made (src/einrichtung/gedaechtnis.ts) */
  installationen: string;
  /** The backup runs the agent has reported (src/backup/melden.ts) */
  backupGemeldet: string;
};

export const pfadeIn = (konfig = KONFIG, zustand = ZUSTAND): Pfade => ({
  manifestSchluessel: join(konfig, "manifest.pub"),
  einstellungen: join(konfig, "agent.json"),
  schluessel: join(zustand, "agent.key"),
  zertifikat: join(zustand, "agent.pem"),
  ca: join(zustand, "ca.pem"),
  schluesselNeu: join(zustand, "agent.key.rotiert"),
  zertifikatNeu: join(zustand, "agent.pem.rotiert"),
  sshCursor: join(zustand, "ssh-cursor"),
  auftraege: join(zustand, "auftraege.json"),
  installationen: join(zustand, "installationen.json"),
  backupGemeldet: join(zustand, "backup-gemeldet.json"),
});

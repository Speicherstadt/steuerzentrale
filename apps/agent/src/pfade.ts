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
});

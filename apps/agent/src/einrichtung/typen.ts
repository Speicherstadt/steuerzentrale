import type { Quadlets } from "@steuerzentrale/manifest";
import type { Spawn } from "../auftraege/ausfuehren.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import type { PruefZiel } from "../zustand/ziel.ts";
import type { HausDateien } from "./haus.ts";
import type { NutzerLesen } from "./nutzer.ts";

/** A command of `schritte.einrichten`, filled from the signed manifest (auftraege/pruefen.ts) */
export type Schritt = { name: string; container: string; argv: string[]; zeitlimitMs: number };

/** A checked setup job: everything rendered from the signed manifest, nothing from the job itself */
export type Einrichten = {
  art: "einrichten";
  name: string;
  quadlets: Quadlets;
  /** The systemd services of the containers that run */
  units: string[];
  schritte: Schritt[];
  /** What the health check checks (Z-403, src/zustand/ziel.ts), kept once the setup is done */
  ziel: PruefZiel;
};

export type Entfernen = { art: "entfernen"; name: string };

/** What setting up and tearing down need of the server, passed in so it is tested without one */
export type SystemDeps = {
  /** Runs a fixed argv as root, without a shell; `eingabe` goes to its standard input */
  spawn: Spawn;
  planen: Planer;
  haus: HausDateien;
  nutzer: NutzerLesen;
  warten: (ms: number) => Promise<void>;
};

export type Schrittergebnis = { ok: true } | { ok: false; grund: string };

export const gelungen: Schrittergebnis = { ok: true };
export const gescheitert = (grund: string): Schrittergebnis => ({ ok: false, grund });

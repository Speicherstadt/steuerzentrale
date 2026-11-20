import type { Befund } from "../pruefungen.ts";
import type { Manifest } from "../schema.ts";
import type { PforteRoute } from "./pforte.ts";

/** What the Zentrale knows of an installation when it renders its units (docs/plan.md, "Ablauf: App installieren") */
export type QuadletInstallation = {
  /**
   * The prefix of every name the installation owns (units, containers, network, volumes, secrets);
   * its Linux user is `sz-<name>`, so at most 29 characters
   */
  name: string;
  kundeId: string;
  optionen: string[];
  /** The port on 127.0.0.1 the Zentrale assigned to `netz.http`; null without `netz.http` */
  httpPort: number | null;
  /** The host port the Zentrale assigned to each port of `netz.ports` with `fest: false`, as "<dienst>:<port>" */
  ports: Record<string, number>;
  /** e.g. https://haben.kunde.example */
  adresse: string;
  /** e.g. haben.kunde.example */
  host: string;
  /** The server's public IPv4, for `${ipv4}` */
  ipv4: string | null;
};

export type Wert = string | number | boolean;

/**
 * The values of the settings by level. `auto` holds what the Zentrale generated once and keeps
 * encrypted (`erzeugen`, Z-103) and what an OIDC provider gave (`aus: oidc-anbieter`): rendering
 * generates nothing, so the same input renders the same output
 */
export type QuadletEinstellungen = {
  betreiber: Record<string, Wert>;
  installation: Record<string, Wert>;
  auto: Record<string, Wert>;
};

export type QuadletAnfrage = {
  manifest: Manifest;
  installation: QuadletInstallation;
  einstellungen: QuadletEinstellungen;
};

/** The files of an installation, each map by file name relative to its folder */
export type Quadlets = {
  /** ~/.config/containers/systemd/ of `sz-<name>`: .container, .volume, .network */
  units: Record<string, string>;
  /** ~/.config/systemd/user/: the slice that limits the installation's RAM */
  systemd: Record<string, string>;
  /** ~/.config/steuerzentrale/dateien/ (`dateien` of the containers, mounted read-only) */
  dateien: Record<string, string>;
  /** Podman secrets: name → value, created before the units start */
  secrets: Record<string, string>;
  /** The route for the Pforte's admin API; null for an app with a proxy of its own */
  pforte: PforteRoute | null;
};

export type Gerendert = { ok: true; quadlets: Quadlets } | { ok: false; gruende: Befund[] };

/** Where `dateien` are written, relative to the home of `sz-<name>` (%h in a unit) */
export const DATEIEN_VERZEICHNIS = ".config/steuerzentrale/dateien";

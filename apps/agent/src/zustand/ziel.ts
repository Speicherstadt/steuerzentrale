import {
  befehlFuellen,
  befehlZurAktion,
  type Einrichtung,
  type Manifest,
  STANDARD_ZEITLIMIT_S,
} from "@steuerzentrale/manifest";
import { z } from "zod";

/*
 * What the health check of an installation checks (BAULISTE.md Z-403; docs/plan.md, "Health auf
 * dem Server"), rendered once when the installation is set up, from its signed manifest and the
 * host ports the setup job assigned, and kept in the record of installations: `http` and `tcp` go to
 * 127.0.0.1 on the host port of the manifest's service port, `befehl` runs the named command's argv
 * in its container. Nothing a later message of the Zentrale says can change it. Pure, no I/O.
 */

/** The longest a health command may take, however long its `zeitlimit_s` */
export const BEFEHL_HOECHSTENS_MS = 30_000;

const port = z.number().int().min(1).max(65535);

export const PruefZiel = z.discriminatedUnion("art", [
  z.object({ art: z.literal("http"), port, pfad: z.string().startsWith("/") }),
  z.object({ art: z.literal("tcp"), port }),
  z.object({
    art: z.literal("befehl"),
    container: z.string().min(1),
    argv: z.array(z.string()).min(1),
    zeitlimitMs: z.number().int().positive(),
  }),
  z.object({ art: z.literal("keine") }),
  /** The manifest names a check the agent cannot make, e.g. on a port not published on the host */
  z.object({ art: z.literal("nicht_pruefbar"), grund: z.string() }),
]);

export type PruefZiel = z.output<typeof PruefZiel>;

type Installation = Einrichtung["installation"];

/**
 * The host port on 127.0.0.1 behind a service's port: that of `netz.http`, or one of `netz.ports`
 * (tcp), assigned by the Zentrale or fixed; a range maps port by port. Undefined when the port is not
 * published on the host
 */
export const hostPort = (
  m: Manifest,
  i: Installation,
  dienst: string,
  containerPort: number,
): number | undefined => {
  const http = m.netz.http;
  if (http && http.dienst === dienst && http.port === containerPort) return i.httpPort ?? undefined;
  for (const p of m.netz.ports) {
    if (p.dienst !== dienst || p.proto !== "tcp") continue;
    if (containerPort < p.port || containerPort > (p.bis ?? p.port)) continue;
    const erster = p.fest ? p.port : i.ports[`${p.dienst}:${p.port}`];
    return erster === undefined ? undefined : erster + containerPort - p.port;
  }
  return undefined;
};

const nichtPruefbar = (grund: string): PruefZiel => ({ art: "nicht_pruefbar", grund });

const auf = (m: Manifest, i: Installation, dienst: string, p: number | undefined) => {
  const host = p === undefined ? undefined : hostPort(m, i, dienst, p);
  return host === undefined
    ? nichtPruefbar(`${dienst}:${p ?? "?"} ist auf dem Host nicht veröffentlicht`)
    : host;
};

const befehlZiel = (m: Manifest, name: string): PruefZiel => {
  const befehl = befehlZurAktion(m, name);
  if (!befehl) return nichtPruefbar(`${name} ist kein Befehl des Manifests`);
  const gefuellt = befehlFuellen(befehl, {});
  if (!gefuellt.ok) return nichtPruefbar(`der Befehl ${name} braucht Argumente`);
  const eigenesMs = (befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S) * 1000;
  return {
    art: "befehl",
    container: befehl.container,
    argv: gefuellt.argv,
    zeitlimitMs: Math.min(BEFEHL_HOECHSTENS_MS, eigenesMs),
  };
};

export const pruefZiel = (m: Manifest, i: Installation): PruefZiel => {
  const h = m.health;
  switch (h.art) {
    case "http": {
      // without its own port, the health route is on the port of netz.http
      const p = h.port ?? (m.netz.http?.dienst === h.dienst ? m.netz.http.port : undefined);
      const host = auf(m, i, h.dienst, p);
      return typeof host === "number" ? { art: "http", port: host, pfad: h.pfad } : host;
    }
    case "tcp": {
      const host = auf(m, i, h.dienst, h.port);
      return typeof host === "number" ? { art: "tcp", port: host } : host;
    }
    case "befehl":
      return befehlZiel(m, h.befehl);
    case "keine":
      return { art: "keine" };
  }
};

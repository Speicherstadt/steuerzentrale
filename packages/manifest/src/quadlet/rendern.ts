import { ramBedarf } from "../platzierung.ts";
import type { Befund } from "../pruefungen.ts";
import { type ContainerKontext, containerAbschnitte, name, secretName } from "./container.ts";
import { type AktiverContainer, aktiveContainer, eingabeBefunde } from "./eingabe.ts";
import { pforteRoute } from "./pforte.ts";
import { hatSteuerzeichen, unitText } from "./systemd.ts";
import type { Gerendert, QuadletAnfrage, Quadlets } from "./typen.ts";
import { type Werte, werteAufloesen } from "./werte.ts";

/*
 * Manifest, installation and settings → the Quadlet units, Podman secrets, files and the Pforte's
 * route of one installation (BAULISTE.md, Z-205; docs/manifest.md, "Quadlets"). A pure function:
 * the same input renders the same output, it generates nothing and reads nothing.
 */

const kopf = (a: QuadletAnfrage): string =>
  `${a.manifest.id} ${a.manifest.version} for the installation ${a.installation.name}, rendered by the Steuerzentrale; do not edit`;

/** A value that would go into Environment= must fit one unit line; a secret goes to Podman */
const umgebungBefunde = (container: AktiverContainer[], werte: Werte): Befund[] =>
  container.flatMap(({ c, pfad }) => [
    ...Object.entries(c.feste_env).flatMap(([n, w]) =>
      hatSteuerzeichen(w)
        ? [{ pfad: [...pfad, "feste_env", n], grund: "a control character" }]
        : [],
    ),
    ...c.env.flatMap((n, i) => {
      const w = werte.get(n);
      return w && !w.geheim && hatSteuerzeichen(w.wert)
        ? [{ pfad: [...pfad, "env", i], grund: `the value of ${n} has a control character` }]
        : [];
    }),
  ]);

const secrets = (a: QuadletAnfrage, container: AktiverContainer[], werte: Werte) =>
  Object.fromEntries(
    [...new Set(container.flatMap(({ c }) => c.env))].flatMap((n) => {
      const w = werte.get(n);
      return w?.geheim ? [[secretName(a.installation, n), w.wert]] : [];
    }),
  );

const units = (a: QuadletAnfrage, container: AktiverContainer[], werte: Werte) => {
  const i = a.installation;
  const k: ContainerKontext = {
    manifest: a.manifest,
    installation: i,
    werte,
    laufen: new Set(container.map(({ c }) => c.name)),
  };
  const volumes = [...new Set(container.flatMap(({ c }) => c.volumes.map((v) => v.name)))];
  return Object.fromEntries([
    [
      `${i.name}.network`,
      unitText(kopf(a), [{ name: "Network", zeilen: [["NetworkName", i.name]] }]),
    ],
    ...volumes.map((v) => [
      `${name(i, v)}.volume`,
      unitText(kopf(a), [{ name: "Volume", zeilen: [["VolumeName", name(i, v)]] }]),
    ]),
    ...container.map(({ c }) => [
      `${name(i, c.name)}.container`,
      unitText(kopf(a), containerAbschnitte(k, c)),
    ]),
  ]);
};

/** The slice all containers of the installation run in: its RAM limit (docs/plan.md, "Ressourcen") */
const slice = (a: QuadletAnfrage) => ({
  [`${a.installation.name}.slice`]: unitText(kopf(a), [
    {
      name: "Slice",
      zeilen: [["MemoryMax", `${ramBedarf(a.manifest, a.installation.optionen)}M`]],
    },
  ]),
});

const dateien = (container: AktiverContainer[]) =>
  Object.fromEntries(
    container.flatMap(({ c }) => c.dateien.map((d) => [`${c.name}${d.pfad}`, d.inhalt])),
  );

export const quadletsRendern = (a: QuadletAnfrage): Gerendert => {
  const container = aktiveContainer(a.manifest, a.installation.optionen);
  const eingabe = eingabeBefunde(a.manifest, a.installation);
  const { werte, befunde } = werteAufloesen(a);
  const gruende = [...eingabe, ...befunde, ...umgebungBefunde(container, werte)];
  if (gruende.length > 0) return { ok: false, gruende };
  const { netz, proxy } = a.manifest;
  const quadlets: Quadlets = {
    units: units(a, container, werte),
    systemd: slice(a),
    dateien: dateien(container),
    secrets: secrets(a, container, werte),
    pforte:
      proxy === "geteilt" && netz.http && a.installation.httpPort !== null
        ? pforteRoute(netz.http, { ...a.installation, httpPort: a.installation.httpPort })
        : null,
  };
  return { ok: true, quadlets };
};

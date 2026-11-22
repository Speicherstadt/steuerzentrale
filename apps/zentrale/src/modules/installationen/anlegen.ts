import { createHash } from "node:crypto";
import {
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  istOeffentlicheIpv4,
  type Manifest,
  manifestPruefen,
  type OeffentlicherSchluessel,
  PFORTE_AKTIONEN,
  type PlatzBefund,
  type PlatzServer,
  signaturPruefen,
  type Wert,
} from "@steuerzentrale/manifest";
import { type Kontext, schreiben } from "../audit/index.ts";
import {
  type AnlageFehler,
  auftragEinfuegen,
  auftragVorbereiten,
  type Vorbereitet,
} from "../auftraege/anlegen.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import {
  type GeheimeEinstellungen,
  geheimVerschluesseln,
  type OffeneEinstellungen,
} from "./einrichtung.ts";
import { hostVergeben, type Installation, installationLesen, vergebenePorts } from "./lesen.ts";
import { platzPruefen } from "./platz.ts";
import { nameErzeugen, portbedarf, portsVergeben, type Vergeben } from "./vergabe.ts";
import { autoWerteErzeugen, betreiberWerteFuer, installationsWerte, type Zufall } from "./werte.ts";

/*
 * Making an installation (BAULISTE.md Z-402; docs/plan.md, "Installationen in der Zentrale",
 * "Manifest beim Installieren", "Einrichtungsaufträge"): the uploaded manifest must carry a valid
 * signature of the key install.sh hands the agents; it must fit the server (placement with the
 * server's facts, the operator's required values included) and render with the installation's
 * values (`einrichtungAuftragPruefen`). Then, in one transaction with the audit log, the row with
 * its secrets encrypted, its ports, the job `installation_einrichten` and, for an app with a route,
 * `pforte_route_setzen` that waits for it.
 */

export type InstallationsDeps = AuftragDeps & {
  zufall: Zufall;
  verbunden: (betreiberId: string, serverId: string) => boolean;
};

export type NeueInstallation = {
  kundeId: string;
  serverId: string;
  /** The manifest's exact text and its minisign signature (`.minisig`) */
  manifest: string;
  signatur: string;
  optionen: string[];
  host: string;
  /** Values of the level `installation`, by name */
  einstellungen: Record<string, Wert>;
};

export type InstallationsFehler =
  | "signatur_ungueltig"
  | "manifest_ungueltig"
  | "kein_kunde"
  | "kein_server"
  | "server_gesperrt"
  | "werte_unlesbar"
  | "passt_nicht"
  | "host_vergeben"
  | "einstellung_ungueltig"
  | "keine_ports"
  | "kein_name"
  | "nicht_einrichtbar"
  | AnlageFehler;

export type InstallationAngelegt =
  | { ok: true; installation: Installation }
  | { ok: false; grund: InstallationsFehler; detail?: string; gruende?: PlatzBefund[] };

type Fehler = Extract<InstallationAngelegt, { ok: false }>;

export type ManifestGeprueft = { ok: true; manifest: Manifest } | Fehler;

/** The uploaded manifest, only with a valid signature over its exact bytes */
export const hochgeladenesManifest = (
  schluessel: OeffentlicherSchluessel,
  text: string,
  signatur: string,
): ManifestGeprueft => {
  const signiert = signaturPruefen(new TextEncoder().encode(text), signatur, schluessel);
  if (!signiert.ok) return { ok: false, grund: "signatur_ungueltig", detail: signiert.grund };
  const geprueft = manifestPruefen(text);
  return geprueft.ok
    ? geprueft
    : { ok: false, grund: "manifest_ungueltig", detail: geprueft.fehler.join("; ") };
};

/** The installation's host ports: HTTP on its own, the others as "<dienst>:<port>" */
const portsAus = (vergeben: Vergeben) => ({
  httpPort: vergeben.find((v) => v.zweck === "http")?.von ?? null,
  ports: Object.fromEntries(
    vergeben.filter((v) => v.zweck !== "http").map((v) => [v.zweck, v.von]),
  ),
});

type Plan = {
  manifest: Manifest;
  name: string;
  vergeben: Vergeben;
  einrichtung: Einrichtung;
  /** What the column `einstellungen` keeps: the values that are not secret */
  offen: OffeneEinstellungen;
  /** What the encrypted column `geheim` keeps */
  geheim: GeheimeEinstellungen;
};

/** Everything the installation gets before anything is written, or why it cannot be made */
const planen = (
  deps: InstallationsDeps,
  betreiberId: string,
  m: Manifest,
  neu: NeueInstallation,
): ({ ok: true } & Plan) | Fehler => {
  const optionen = [...new Set(neu.optionen)];
  const platz = platzPruefen(deps, betreiberId, { ...neu, manifest: m, optionen });
  if (!platz.ok) return platz;
  if (platz.platzierung.art === "passt_nicht")
    return { ok: false, grund: "passt_nicht", gruende: platz.platzierung.gruende };
  const server = platz.platzServer as PlatzServer;
  if (hostVergeben(deps.db, betreiberId, neu.host)) return { ok: false, grund: "host_vergeben" };
  const iw = installationsWerte(m, optionen, neu.einstellungen);
  if (!iw.ok) return { ok: false, grund: "einstellung_ungueltig", detail: iw.grund };
  const bw = betreiberWerteFuer(m, platz.betreiberWerte);
  const name = nameErzeugen(m.id, deps.zufall, (n) => !!installationLesen(deps.db, betreiberId, n));
  if (!name) return { ok: false, grund: "kein_name" };
  const belegt = new Set([
    ...vergebenePorts(deps.db, betreiberId, neu.serverId),
    ...server.portsBelegt.map((p) => p.port),
  ]);
  const vergeben = portsVergeben(portbedarf(m, optionen), belegt);
  if (!vergeben) return { ok: false, grund: "keine_ports" };
  const offen = { betreiber: bw.offen, installation: iw.werte.offen };
  const geheim = {
    betreiber: bw.geheim,
    installation: iw.werte.geheim,
    auto: autoWerteErzeugen(m, optionen, deps.zufall),
  };
  const einrichtung: Einrichtung = {
    installation: {
      kundeId: neu.kundeId,
      optionen,
      ...portsAus(vergeben),
      host: neu.host,
      ipv4: server.ipv4.find(istOeffentlicheIpv4) ?? null,
    },
    einstellungen: {
      betreiber: { ...offen.betreiber, ...geheim.betreiber },
      installation: { ...offen.installation, ...geheim.installation },
      auto: geheim.auto,
    },
  };
  return { ok: true, manifest: m, name, vergeben, einrichtung, offen, geheim };
};

/** The setup job and, for an app with a route, the Pforte's job that waits for it */
const auftraegeVorbereiten = (
  deps: InstallationsDeps,
  kontext: Kontext,
  neu: NeueInstallation,
  plan: Plan,
): { ok: true; zeilen: Auftrag[] } | Fehler => {
  const gemeinsam = {
    serverId: neu.serverId,
    installationId: plan.name,
    manifest: neu.manifest,
    signatur: neu.signatur,
  };
  const einrichten: Vorbereitet = auftragVorbereiten(deps, kontext, {
    ...gemeinsam,
    aktion: EINRICHTUNG_AKTIONEN.einrichten,
    argumente: {},
    einrichtung: plan.einrichtung,
  });
  if (!einrichten.ok)
    return { ok: false, grund: "nicht_einrichtbar", detail: einrichten.detail ?? einrichten.grund };
  const { httpPort } = plan.einrichtung.installation;
  const mitRoute =
    plan.manifest.proxy === "geteilt" && plan.manifest.netz.http && httpPort !== null;
  if (!mitRoute) return { ok: true, zeilen: [einrichten.zeile] };
  const route = auftragVorbereiten(
    deps,
    kontext,
    {
      ...gemeinsam,
      aktion: PFORTE_AKTIONEN.setzen,
      argumente: { host: neu.host, port: httpPort },
      wartetAuf: [einrichten.zeile.auftragId],
    },
    [einrichten.zeile],
  );
  if (!route.ok) return { ok: false, grund: route.grund, detail: route.detail ?? route.grund };
  return { ok: true, zeilen: [einrichten.zeile, route.zeile] };
};

const zeileAus = (kontext: Kontext, deps: InstallationsDeps, neu: NeueInstallation, plan: Plan) => {
  const { betreiberId, jetzt } = kontext;
  const i = plan.einrichtung.installation;
  return {
    betreiberId,
    installationId: plan.name,
    kundeId: neu.kundeId,
    serverId: neu.serverId,
    app: plan.manifest.id,
    version: plan.manifest.version,
    manifestHash: createHash("sha256").update(neu.manifest, "utf8").digest("hex"),
    manifest: neu.manifest,
    signatur: neu.signatur,
    host: neu.host,
    ipv4: i.ipv4,
    httpPort: i.httpPort,
    ports: JSON.stringify(i.ports),
    optionen: JSON.stringify(i.optionen),
    einstellungen: JSON.stringify(plan.offen),
    geheim: geheimVerschluesseln(deps.schluessel, betreiberId, plan.name, plan.geheim),
    zustand: "wird_eingerichtet" as const,
    angelegtVon: kontext.akteur,
    angelegtAm: jetzt,
    geaendertAm: jetzt,
  };
};

export const installationAnlegen = (
  deps: InstallationsDeps,
  kontext: Kontext,
  schluessel: OeffentlicherSchluessel,
  neu: NeueInstallation,
): InstallationAngelegt => {
  const { betreiberId } = kontext;
  const geprueft = hochgeladenesManifest(schluessel, neu.manifest, neu.signatur);
  if (!geprueft.ok) return geprueft;
  const plan = planen(deps, betreiberId, geprueft.manifest, neu);
  if (!plan.ok) return plan;
  const auftraege = auftraegeVorbereiten(deps, kontext, neu, plan);
  if (!auftraege.ok) return auftraege;
  const [einrichten] = schreiben(deps.schreibDb, kontext, "installation.anlegen", (w) => {
    w.einfuegen("installationen", zeileAus(kontext, deps, neu, plan));
    for (const v of plan.vergeben)
      for (let port = v.von; port < v.von + v.anzahl; port++)
        w.einfuegen("installationsPorts", {
          betreiberId,
          serverId: neu.serverId,
          port,
          installationId: plan.name,
          zweck: v.zweck,
        });
    return auftraege.zeilen.map((z) => auftragEinfuegen(w, z));
  });
  if (einrichten) zustellen(deps, [einrichten]);
  return {
    ok: true,
    installation: installationLesen(deps.db, betreiberId, plan.name) as Installation,
  };
};

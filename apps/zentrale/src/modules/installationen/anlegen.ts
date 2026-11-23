import {
  alleOptionen,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  type EinstellungsFeld,
  einstellungsFormular,
  istOeffentlicheIpv4,
  type Manifest,
  type OeffentlicherSchluessel,
  PFORTE_AKTIONEN,
  type PlatzBefund,
  type PlatzServer,
  type Wert,
} from "@steuerzentrale/manifest";
import { versionAngeboten } from "@steuerzentrale/planung";
import type { Db } from "../../db/oeffnen.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import {
  type AnlageFehler,
  auftragEinfuegen,
  auftragVorbereiten,
  type Vorbereitet,
} from "../auftraege/anlegen.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { dnsFuerNeueInstallation } from "../dns/index.ts";
import { betreiberWerteSchreiben } from "../einstellungen/betreiber.ts";
import { kundeLesen } from "../kunden/index.ts";
import { manifestLesen, sha256, signiertesManifestPruefen } from "../manifeste/index.ts";
import {
  type GeheimeEinstellungen,
  geheimVerschluesseln,
  type OffeneEinstellungen,
} from "./einrichtung.ts";
import {
  hostVergeben,
  type Installation,
  installationLesen,
  vergebenePorts,
  type Werte,
} from "./lesen.ts";
import { platzPruefen } from "./platz.ts";
import { nameErzeugen, portbedarf, portsVergeben, type Vergeben } from "./vergabe.ts";
import { autoWerteErzeugen, betreiberWerteFuer, installationsWerte, type Zufall } from "./werte.ts";

/*
 * Making an installation (BAULISTE.md Z-402; docs/plan.md, "Installationen in der Zentrale",
 * "Manifeste in der Zentrale (Z-501)", "Einrichtungsaufträge"): app and version name an imported
 * manifest (Z-501), offered to the customer (a pre-release only to an internal one) and still
 * signed by the key install.sh hands the agents; the installation keeps its text. It must fit the
 * server (placement with the
 * server's facts, the operator's required values included) and render with the installation's
 * values (`einrichtungAuftragPruefen`). Then, in one transaction with the audit log, the row with
 * its secrets encrypted, its ports, the operator's values the dialog added (Z-404), the job
 * `installation_einrichten` and, for an app with a route, `pforte_route_setzen` that waits for it.
 * A host below the operator's domain gets its DNS records after that (modules/dns, Z-407).
 */

export type InstallationsDeps = AuftragDeps & {
  zufall: Zufall;
  verbunden: (betreiberId: string, serverId: string) => boolean;
};

export type NeueInstallation = {
  kundeId: string;
  serverId: string;
  /** App and version of an imported manifest (Z-501) */
  app: string;
  version: string;
  optionen: string[];
  host: string;
  /** Values of the level `installation`, by name */
  einstellungen: Record<string, Wert>;
  /** Values of the level `betreiber` the dialog adds to the operator's, stored with it (Z-404) */
  betreiberWerte?: Record<string, Wert>;
};

export type InstallationsFehler =
  | "kein_manifest"
  | "nur_intern"
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

export type ManifestGewaehlt =
  | { ok: true; manifest: Manifest; text: string; signatur: string }
  | Fehler;

/**
 * The imported manifest of app and version, when it is offered to the customer (a pre-release only
 * to an internal one, also by hand: docs/plan.md, "Interne Kunden und Vorabversionen (Z-501)") and
 * its signature holds with the key the agents have now; it was checked on import, a changed key
 * would only fail on the server
 */
export const gewaehltesManifest = (
  db: Db,
  schluessel: OeffentlicherSchluessel,
  betreiberId: string,
  wahl: { kundeId: string; app: string; version: string },
): ManifestGewaehlt => {
  const eintrag = manifestLesen(db, wahl.app, wahl.version);
  if (!eintrag) return { ok: false, grund: "kein_manifest" };
  const kunde = kundeLesen(db, betreiberId, wahl.kundeId);
  if (!kunde) return { ok: false, grund: "kein_kunde" };
  if (!versionAngeboten(eintrag.version, kunde.intern)) return { ok: false, grund: "nur_intern" };
  const geprueft = signiertesManifestPruefen(schluessel, {
    manifest: eintrag.text,
    signatur: eintrag.signatur,
  });
  if (!geprueft.ok) return geprueft;
  return { ok: true, manifest: geprueft.manifest, text: eintrag.text, signatur: eintrag.signatur };
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
  /** The manifest's exact text and signature, as imported */
  text: string;
  signatur: string;
  name: string;
  vergeben: Vergeben;
  einrichtung: Einrichtung;
  /** What the column `einstellungen` keeps: the values that are not secret */
  offen: OffeneEinstellungen;
  /** What the encrypted column `geheim` keeps */
  geheim: GeheimeEinstellungen;
  /** The operator's values as stored and with what the dialog adds, to write the change */
  betreiber: { felder: EinstellungsFeld[]; bisher: Werte; neu: Werte };
};

/** Everything the installation gets before anything is written, or why it cannot be made */
const planen = (
  deps: InstallationsDeps,
  betreiberId: string,
  gewaehlt: Extract<ManifestGewaehlt, { ok: true }>,
  neu: NeueInstallation,
): ({ ok: true } & Plan) | Fehler => {
  const m = gewaehlt.manifest;
  const optionen = [...new Set(neu.optionen)];
  const platz = platzPruefen(deps, betreiberId, {
    ...neu,
    manifest: m,
    optionen,
    betreiberEingabe: neu.betreiberWerte ?? {},
  });
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
  const betreiber = {
    felder: einstellungsFormular(m, "betreiber", alleOptionen(m)),
    bisher: platz.betreiberGespeichert,
    neu: platz.betreiberNeu,
  };
  const { text, signatur } = gewaehlt;
  return {
    ok: true,
    manifest: m,
    text,
    signatur,
    name,
    vergeben,
    einrichtung,
    offen,
    geheim,
    betreiber,
  };
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
    manifest: plan.text,
    signatur: plan.signatur,
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
    manifestHash: sha256(plan.text),
    manifest: plan.text,
    signatur: plan.signatur,
    host: neu.host,
    ipv4: i.ipv4,
    httpPort: i.httpPort,
    ports: JSON.stringify(i.ports),
    optionen: JSON.stringify(i.optionen),
    einstellungen: JSON.stringify(plan.offen),
    geheim: geheimVerschluesseln(deps.schluessel, betreiberId, plan.name, plan.geheim),
    zustand: "wird_eingerichtet" as const,
    ...dnsFuerNeueInstallation(deps.db, betreiberId, neu.host, jetzt),
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
  const gewaehlt = gewaehltesManifest(deps.db, schluessel, betreiberId, neu);
  if (!gewaehlt.ok) return gewaehlt;
  const plan = planen(deps, betreiberId, gewaehlt, neu);
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
    if (neu.betreiberWerte && Object.keys(neu.betreiberWerte).length > 0)
      betreiberWerteSchreiben(
        w,
        deps.schluessel,
        { betreiberId, app: plan.manifest.id, jetzt: kontext.jetzt },
        plan.betreiber.felder,
        plan.betreiber.bisher,
        plan.betreiber.neu,
      );
    return auftraege.zeilen.map((z) => auftragEinfuegen(w, z));
  });
  if (einrichten) zustellen(deps, [einrichten]);
  deps.dnsAnstossen?.();
  return {
    ok: true,
    installation: installationLesen(deps.db, betreiberId, plan.name) as Installation,
  };
};

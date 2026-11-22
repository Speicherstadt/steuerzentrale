import {
  EINRICHTUNG_AKTIONEN,
  HOST,
  type Manifest,
  manifestPruefen,
  PFORTE_AKTIONEN,
} from "@steuerzentrale/manifest";
import type { Antwort, Fehlschlag } from "../anmeldung/api.ts";
import type {
  AuftragDerInstallation,
  InstallationDerZentrale,
  InstallationenQuelle,
  NeueInstallation,
  PlatzWunsch,
} from "../daten/installationen.ts";
import type { ServerDerZentrale } from "../daten/server.ts";
import type { Kunde } from "../daten/typen.ts";
import { type Eintrag, nachAuftrag, startbestand } from "./installationen-bestand.ts";
import { ohneMeldung } from "./installationen-health.ts";
import { ausManifest, demoPlatzieren } from "./platz.ts";

/*
 * The installations of the demo in memory, answering as the Zentrale's API would
 * (apps/zentrale, routes/installationen.ts): placement, making, reading and removing a failed one.
 * The demo has no public key, so it checks only that a signature came along; the manifest itself it
 * reads with the same function as the Zentrale. Without an agent a new installation stays
 * "wird_eingerichtet", as in the Zentrale; a change lasts until the page reloads.
 */

export type DemoQuellen = {
  jetzt: () => number;
  kunden: () => Promise<Antwort<Kunde[]>>;
  server: () => Promise<Antwort<ServerDerZentrale[]>>;
  /** The names of the operator's values, set or not (level `betreiber`) */
  betreiberWerte: string[];
};

const ok = <T>(daten: T, status = 200) => ({ ok: true, status, daten }) as const;
const nein = (status: number, fehler: string, mehr: Partial<Fehlschlag> = {}): Fehlschlag => ({
  ok: false,
  status,
  fehler,
  ...mehr,
});

/** An installation as the list answers it: without its jobs and history */
const ohneAuftraege = (e: Eintrag): InstallationDerZentrale => {
  const { auftraege: _, verlauf: __, ...i } = e.i;
  return i;
};

const ZEICHEN = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `<app>-<6 characters a–z, 0–9>`, as the Zentrale names an installation */
const name = (app: string) =>
  `${app}-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ZEICHEN[b % 36]).join("")}`;

const ENDE = ["erfolgreich", "gescheitert", "abgebrochen"];

const entfernenOffen = (a: AuftragDerInstallation) =>
  a.aktion === EINRICHTUNG_AKTIONEN.entfernen && !ENDE.includes(a.zustand);

/** The setup job and, for an app behind the Pforte, the route that waits for it */
const auftraegeFuer = (id: string, m: Manifest, mitHttp: boolean, t: number) => {
  const einrichten = nachAuftrag(id, EINRICHTUNG_AKTIONEN.einrichten, "zugestellt", t);
  return m.proxy === "geteilt" && mitHttp
    ? [einrichten, nachAuftrag(id, PFORTE_AKTIONEN.setzen, "wartend", t)]
    : [einrichten];
};

/** The new installation; a secret value is not kept, as the API never answers one */
const neuerEintrag = (neu: NeueInstallation, m: Manifest, httpPort: number | null, t: number) => {
  const id = name(m.id);
  const geheim = new Set(m.env.filter((e) => e.typ === "geheim").map((e) => e.name));
  const offen = Object.fromEntries(
    Object.entries(neu.einstellungen).filter(([n]) => !geheim.has(n)),
  );
  const optionen = [...new Set(neu.optionen)];
  const eintrag: Eintrag = {
    i: {
      installationId: id,
      kundeId: neu.kundeId,
      serverId: neu.serverId,
      app: m.id,
      version: m.version,
      manifestHash: "0".repeat(64),
      host: neu.host,
      httpPort,
      ports: {},
      optionen,
      einstellungen: { betreiber: {}, installation: offen },
      zustand: "wird_eingerichtet",
      health: ohneMeldung(),
      verlauf: [],
      angelegtVon: "demo",
      angelegtAm: t,
      geaendertAm: t,
      auftraege: auftraegeFuer(id, m, httpPort !== null, t),
    },
    platz: ausManifest(neu.kundeId, m, optionen),
    bietet: m.bietet,
  };
  return eintrag;
};

/** A name entered that is no setting of the level installation */
const fremderWert = (m: Manifest, neu: NeueInstallation) =>
  Object.keys(neu.einstellungen).find(
    (n) => !m.env.some((e) => e.name === n && e.ebene === "installation"),
  );

export const demoInstallationenQuelle = (q: DemoQuellen): InstallationenQuelle => {
  let liste: Eintrag[] = startbestand(q.jetzt());
  const aktiv = () => liste.filter((e) => e.i.zustand !== "entfernt");

  /** The checked manifest and the placement, or why the question has no answer */
  const pruefen = async (
    w: PlatzWunsch,
  ): Promise<
    { ok: true; manifest: Manifest; platzierung: ReturnType<typeof demoPlatzieren> } | Fehlschlag
  > => {
    if (!w.signatur.trim()) return nein(422, "signatur_ungueltig");
    const geprueft = manifestPruefen(w.manifest);
    if (!geprueft.ok)
      return nein(422, "manifest_ungueltig", { detail: geprueft.fehler.join("; ") });
    const [kunden, server] = await Promise.all([q.kunden(), q.server()]);
    if (!kunden.ok || !kunden.daten.some((k) => k.id === w.kundeId)) return nein(404, "kein_kunde");
    const sv = server.ok ? server.daten.find((s) => s.serverId === w.serverId) : undefined;
    if (!sv) return nein(404, "kein_server");
    if (sv.gesperrtAm !== null) return nein(409, "server_gesperrt");
    const platzierung = demoPlatzieren({
      manifest: geprueft.manifest,
      optionen: w.optionen,
      server: sv,
      kundeId: w.kundeId,
      installationen: aktiv()
        .filter((e) => e.i.serverId === sv.serverId)
        .map((e) => e.platz),
      bietet: aktiv()
        .filter((e) => e.i.kundeId === w.kundeId && e.i.zustand !== "gescheitert")
        .flatMap((e) => e.bietet),
      betreiberWerte: q.betreiberWerte,
    });
    return { ok: true, manifest: geprueft.manifest, platzierung };
  };

  const naechsterPort = (serverId: string) =>
    Math.max(
      19999,
      ...aktiv()
        .filter((e) => e.i.serverId === serverId)
        .map((e) => e.i.httpPort ?? 0),
    ) + 1;

  return {
    liste: async () => ok(liste.map(ohneAuftraege)),
    installation: async (id) => {
      const e = liste.find((x) => x.i.installationId === id);
      return e ? ok(e.i) : nein(404, "keine_installation");
    },
    platzierung: async (w) => {
      const p = await pruefen(w);
      return p.ok ? ok(p.platzierung) : p;
    },
    anlegen: async (neu) => {
      const p = await pruefen(neu);
      if (!p.ok) return p;
      if (p.platzierung.art === "passt_nicht")
        return nein(409, "passt_nicht", { gruende: p.platzierung.gruende });
      if (!HOST.test(neu.host)) return nein(400, "ungueltig");
      if (aktiv().some((e) => e.i.host === neu.host)) return nein(409, "host_vergeben");
      const fremd = fremderWert(p.manifest, neu);
      if (fremd)
        return nein(400, "einstellung_ungueltig", {
          detail: `${fremd}: no setting of the level installation`,
        });
      const port = p.manifest.netz.http ? naechsterPort(neu.serverId) : null;
      const eintrag = neuerEintrag(neu, p.manifest, port, q.jetzt());
      liste = [...liste, eintrag];
      return ok(ohneAuftraege(eintrag), 201);
    },
    entfernen: async (id) => {
      const e = liste.find((x) => x.i.installationId === id);
      if (!e) return nein(404, "keine_installation");
      if (e.i.zustand !== "gescheitert") return nein(409, "nicht_gescheitert");
      if (e.i.auftraege.some(entfernenOffen)) return nein(409, "entfernen_laeuft");
      const job = nachAuftrag(id, EINRICHTUNG_AKTIONEN.entfernen, "zugestellt", q.jetzt());
      const neu: Eintrag = { ...e, i: { ...e.i, auftraege: [...e.i.auftraege, job] } };
      liste = liste.map((x) => (x === e ? neu : x));
      return ok(neu.i);
    },
  };
};

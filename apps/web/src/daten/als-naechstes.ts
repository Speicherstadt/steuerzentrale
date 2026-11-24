import {
  FRIST_TAGE,
  fristen,
  sperrzeitBeginne,
  tagesbeginn,
  VORSCHAU_TAGE,
  ZERTIFIKAT_FRIST_MS,
} from "@steuerzentrale/planung";
import type { InstallationsAngebot } from "./apps.ts";
import type { InstallationAnsicht } from "./installation-ansicht.ts";
import type { ServerAnsicht } from "./server-ansicht.ts";
import type { Manifest } from "./typen.ts";

/*
 * "Als Nächstes" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): what the Zentrale
 * does by itself in the next 7 days (the planned steps of update waves, reboots of servers in their
 * maintenance window, freeze windows that begin) and the deadlines of the next 30 days (certificates
 * that run out, contracts that end, data deleted after an end), soonest first. Only from what the
 * API returns: what has no source is left out. Pure: the page loads, this orders.
 */

const TAG_MS = 86_400_000;

export type VorschauEingabe = {
  installationen: Pick<
    InstallationAnsicht,
    "id" | "app" | "appName" | "kundeId" | "kundeName" | "vertragsende" | "zustand"
  >[];
  server: Pick<ServerAnsicht, "id" | "name" | "kernel" | "neustartStand" | "zertifikate">[];
  angebote: Pick<InstallationsAngebot, "installationId" | "plan">[];
  apps: Pick<Manifest, "id" | "name" | "sperrzeiten">[];
  /** "Für Kunden" (Z-805): only then are there contracts */
  fuerKunden: boolean;
};

/** `zeit` the instant it happens; `warn` when it needs an eye on it */
export type Termin = { zeit: number; warn: boolean } & (
  | {
      art: "update";
      installationId: string;
      appName: string;
      version: string;
      welle: "intern" | "alle";
      kunden: string[];
    }
  | { art: "neustart"; serverId: string; name: string; kernel: string | null }
  | { art: "zertifikat"; hosts: string[] }
  | { art: "sperrzeit"; bis: number; appName: string; grund: string }
  | { art: "vertrag"; kundeId: string; kundeName: string; loeschenAb: number }
  | { art: "loeschung"; kundeId: string; kundeName: string }
);

type Fenster = { jetzt: number; woche: number; frist: number };

const imFenster = (zeit: number, jetzt: number, bis: number) => zeit >= jetzt && zeit <= bis;

/** One step per app version and slot, with the customers it reaches */
const updates = (e: VorschauEingabe, f: Fenster): Termin[] => {
  const schritte = new Map<string, Extract<Termin, { art: "update" }>>();
  for (const a of e.angebote) {
    const p = a.plan;
    const i = e.installationen.find((x) => x.id === a.installationId);
    if (!i || p?.art !== "termin" || !imFenster(p.ab, f.jetzt, f.woche)) continue;
    const schluessel = `${i.app} ${p.version} ${p.ab}`;
    const da = schritte.get(schluessel);
    if (da) da.kunden.push(i.kundeName);
    else
      schritte.set(schluessel, {
        art: "update",
        zeit: p.ab,
        warn: false,
        installationId: i.id,
        appName: i.appName,
        version: p.version,
        welle: p.welle,
        kunden: [i.kundeName],
      });
  }
  return [...schritte.values()];
};

/** Reboots the plan makes once the window opens; one waiting for a person is not "by itself" */
const WARTET_NUR_AUF_ZEIT = new Set(["fenster", "sperrzeit", "versucht"]);

const neustarts = (e: VorschauEingabe, f: Fenster): Termin[] =>
  e.server.flatMap((s): Termin[] => {
    const p = s.neustartStand.plan;
    const zeit = p.art === "jetzt" ? f.jetzt : WARTET_NUR_AUF_ZEIT.has(p.grund) ? p.ab : undefined;
    if (zeit === undefined || !imFenster(zeit, f.jetzt, f.woche)) return [];
    const { laeuft, installiert } = s.kernel;
    const kernel = installiert && installiert !== laeuft ? installiert : null;
    return [{ art: "neustart", zeit, warn: false, serverId: s.id, name: s.name, kernel }];
  });

/** Each host once, by its certificate that runs out last; the hosts of one Berlin day together */
const zertifikate = (e: VorschauEingabe, f: Fenster): Termin[] => {
  const neueste = new Map<string, number>();
  for (const z of e.server.flatMap((s) => s.zertifikate ?? []))
    neueste.set(z.host, Math.max(neueste.get(z.host) ?? 0, z.gueltigBis));
  const tage = new Map<number, Extract<Termin, { art: "zertifikat" }>>();
  for (const [host, zeit] of [...neueste].sort((a, b) => a[1] - b[1])) {
    if (!imFenster(zeit, f.jetzt, f.frist)) continue;
    const tag = tagesbeginn(zeit);
    const da = tage.get(tag);
    if (da) da.hosts.push(host);
    else
      tage.set(tag, {
        art: "zertifikat",
        zeit,
        warn: zeit - f.jetzt < ZERTIFIKAT_FRIST_MS,
        hosts: [host],
      });
  }
  return [...tage.values()];
};

/** The freeze windows of the apps that run, from their manifests */
const sperrzeiten = (e: VorschauEingabe, f: Fenster): Termin[] => {
  const laufend = new Set(
    e.installationen.filter((i) => i.zustand !== "entfernt").map((i) => i.app),
  );
  return e.apps
    .filter((a) => laufend.has(a.id))
    .flatMap((a) =>
      sperrzeitBeginne(
        a.sperrzeiten.map((s) => ({ monatlich: `${s.von}-${s.bis}`, grund: s.grund })),
        f.jetzt,
        f.woche,
      ).map((b) => ({
        art: "sperrzeit" as const,
        zeit: b.beginn,
        warn: false,
        bis: b.ende,
        appName: a.name,
        grund: b.grund,
      })),
    );
};

/** Each customer once: its contract's end ahead, or the deletion after an end */
const vertraege = (e: VorschauEingabe, f: Fenster): Termin[] => {
  if (!e.fuerKunden) return [];
  const kunden = new Map(
    e.installationen.flatMap((i) => (i.vertragsende === null ? [] : [[i.kundeId, i] as const])),
  );
  return [...kunden.values()].flatMap((i): Termin[] => {
    const ende = i.vertragsende ?? 0;
    const { loeschenAb } = fristen(ende);
    const kunde = { kundeId: i.kundeId, kundeName: i.kundeName };
    if (imFenster(ende, f.jetzt, f.frist))
      return [{ art: "vertrag", zeit: ende, warn: false, loeschenAb, ...kunde }];
    if (imFenster(loeschenAb, f.jetzt, f.frist))
      return [{ art: "loeschung", zeit: loeschenAb, warn: true, ...kunde }];
    return [];
  });
};

export const alsNaechstes = (e: VorschauEingabe, jetzt: number): Termin[] => {
  const f = { jetzt, woche: jetzt + VORSCHAU_TAGE * TAG_MS, frist: jetzt + FRIST_TAGE * TAG_MS };
  return [
    ...neustarts(e, f),
    ...updates(e, f),
    ...zertifikate(e, f),
    ...sperrzeiten(e, f),
    ...vertraege(e, f),
  ].sort((a, b) => a.zeit - b.zeit);
};

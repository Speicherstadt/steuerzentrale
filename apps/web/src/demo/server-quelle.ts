import {
  neustartPruefen,
  type PlattenStunde,
  plattenVon,
  STUNDE_MS,
  stundeVon,
} from "@steuerzentrale/planung";
import type {
  NeustartStand,
  ServerDerZentrale,
  ServerFakten,
  ServerLastStunde,
  ServerQuelle,
} from "../daten/server.ts";
import type { Server } from "../daten/typen.ts";
import { pruefungenDerDemo } from "../daten/zustand.ts";
import { demo } from "./index.ts";

/**
 * The demo's servers, answering as the Zentrale's API would (routes/server.ts in apps/zentrale), a
 * server's own page with its checks (Z-702) as packages/planung rates the demo's values; a
 * revocation lasts until the page reloads
 */
const STILL_AB_MS = 75_000;
const MIB_200_GB = 200 * 1024;
const TAG_MS = 24 * 3600_000;

/** A boot id of the demo server, made from its name: the same on every load */
const bootIdVon = (id: string) => {
  const hex = [...id]
    .map((z) => z.charCodeAt(0).toString(16))
    .join("")
    .padEnd(32, "0")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * The demo server's values as its agent would report them (Z-304); the disk is a 200 GB root with
 * the demo's share in use, the host name its PTR
 */
export const demoFakten = (sv: Server, jetzt: number): ServerFakten => {
  const [name = sv.os, version = ""] = sv.os.split(" ");
  return {
    zeit: jetzt,
    cpuKerne: null,
    ramMb: sv.ramGb * 1024,
    platten: [
      {
        mount: "/",
        gesamtMb: MIB_200_GB,
        freiMb: Math.round((MIB_200_GB * (100 - sv.platte)) / 100),
      },
    ],
    architektur: sv.arch === "arm64" ? "arm64" : "amd64",
    os: { name, version },
    kernel: sv.kernel,
    neustartNoetig: sv.neustart !== undefined || sv.kernel.laeuft !== sv.kernel.installiert,
    updatesAusstehend: sv.sicherheitsupdates,
    podman: sv.podman || null,
    ipv4: sv.ipv4 ? [sv.ipv4] : [],
    ipv6: sv.ipv6 ? [sv.ipv6] : [],
    ptr: sv.ipv4 ? { [sv.ipv4]: sv.host } : {},
    portsBelegt: [
      { port: 22, proto: "tcp" },
      { port: 80, proto: "tcp" },
      { port: 443, proto: "tcp" },
    ],
    port25Ausgehend: null,
    uhrzeitAbweichungMs: sv.uhrAbweichungMs,
    bootId: bootIdVon(sv.id),
    gestartetAm: jetzt - sv.laufzeitTage * TAG_MS,
    // unattended-upgrades ran last night at 02:10 (mockup, events)
    unattendedUpgrades: { installiert: true, aktiv: true, letzterLauf: jetzt - 8 * 3600_000 },
    // the Pforte's certificate of each installation's host, as the checks of the demo count them
    zertifikate: demo.installationen
      .filter((i) => i.server === sv.id)
      .map((i) => ({ host: i.adresse, gueltigBis: jetzt + sv.zertifikatTage * TAG_MS })),
    ...(sv.nurBeobachten ? { nurBeobachten: true } : {}),
    // Z-1106: the demo's load as the agent reports it, each installation's user a share of it
    last: {
      cpuProzent: sv.cpu,
      last1: Math.round((sv.cpu / 25) * 100) / 100,
      ramBelegtMb: Math.round((sv.ramGb * 1024 * sv.ram) / 100),
      nutzer: demo.installationen
        .filter((i) => i.server === sv.id)
        .map((i, n) => ({
          name: `sz-${i.id}`,
          cpuProzent: Math.round(sv.cpu / (n + 3)),
          ramMb: 180 + ((n * 137) % 600),
        })),
    },
  };
};

/**
 * How full the demo server's disk was, hour by hour up to its last report: it grew by a twelfth
 * of today's share over 30 days, a little up and down with the day
 */
export const demoPlatten = (sv: Server, tage: number, bis: number): PlattenStunde[] => {
  const ende = stundeVon(bis);
  const dauer = 30 * 24 * STUNDE_MS;
  const stunden: PlattenStunde[] = [];
  for (let stunde = plattenVon(tage, bis); stunde <= ende; stunde += STUNDE_MS) {
    const rest = (ende - stunde) / dauer;
    const tag = Math.sin(((ende - stunde) / (24 * STUNDE_MS)) * 2 * Math.PI) * 0.3;
    const prozent = Math.round((sv.platte * (1 - rest / 12) + tag) * 10) / 10;
    stunden.push({ stunde, platten: [{ mount: "/", prozent: Math.min(100, prozent) }] });
  }
  return stunden;
};

/** A value of the demo that moves with the time of day: up by day, down at night */
const tagesgang = (wert: number, stunde: number, ende: number) =>
  wert * (0.75 + 0.25 * Math.sin(((stunde - ende) / (24 * STUNDE_MS)) * 2 * Math.PI));

/** CPU, load and memory of the demo server per hour up to its last report (Z-1106) */
export const demoLast = (sv: Server, tage: number, bis: number): ServerLastStunde[] => {
  const ende = stundeVon(bis);
  const stunden: ServerLastStunde[] = [];
  for (let stunde = plattenVon(tage, bis); stunde <= ende; stunde += STUNDE_MS) {
    const cpu = Math.round(tagesgang(sv.cpu, stunde, ende) * 10) / 10;
    stunden.push({
      stunde,
      cpuProzent: cpu,
      last1: Math.round((cpu / 25) * 100) / 100,
      ramProzent: Math.round(tagesgang(sv.ram, stunde, ende) * 0.2 + sv.ram * 0.8),
    });
  }
  return stunden;
};

/** Where the demo server's reboot stands, as the Zentrale's plan would decide it now */
const demoNeustart = (sv: Omit<ServerDerZentrale, "neustart">, jetzt: number): NeustartStand => ({
  noetig: sv.fakten?.neustartNoetig ?? null,
  plan: neustartPruefen(
    {
      neustartNoetig: sv.fakten?.neustartNoetig ?? null,
      bootId: sv.fakten?.bootId ?? null,
      wartungsfenster: sv.wartungsfenster,
      sperrzeiten: [],
      verbunden: sv.agent.zustand !== "getrennt",
      offeneAuftraege: 0,
      ohneBackup: 0,
    },
    jetzt,
  ),
  letzter: null,
});

const ohneNeustart = (sv: Server, jetzt: number): Omit<ServerDerZentrale, "neustart"> => {
  const letzterHeartbeat = sv.agent.letzteMeldung;
  const faktenAm = sv.agent.zustand === "verbunden" ? jetzt : letzterHeartbeat;
  const agent: ServerDerZentrale["agent"] =
    sv.agent.zustand === "still"
      ? {
          zustand: "still",
          letzterHeartbeat,
          stillSeitMin: Math.floor(Math.max(jetzt - letzterHeartbeat, STILL_AB_MS) / 60_000),
        }
      : { zustand: sv.agent.zustand, letzterHeartbeat };
  return {
    serverId: sv.id,
    name: sv.name,
    wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], ...sv.wartung },
    angelegtAm: jetzt - sv.laufzeitTage * 24 * 3600_000,
    beigetretenAm: jetzt - sv.laufzeitTage * 24 * 3600_000,
    architektur: sv.arch === "arm64" ? "arm64" : "amd64",
    agentVersion: sv.agent.version,
    zertifikatGueltigBis: jetzt + sv.zertifikatTage * 24 * 3600_000,
    gesperrtAm: null,
    agent,
    // a silent agent's facts are those of its last report
    fakten: demoFakten(sv, faktenAm),
    faktenAm,
  };
};

export const alsServerDerZentrale = (sv: Server, jetzt: number): ServerDerZentrale => {
  const ohne = ohneNeustart(sv, jetzt);
  return { ...ohne, neustart: demoNeustart(ohne, jetzt) };
};

export const demoServerQuelle = (start: Server[], jetzt: () => number): ServerQuelle => {
  let liste = start.map((sv) => alsServerDerZentrale(sv, jetzt()));
  const fehlt = { ok: false, status: 404, fehler: "kein_server" } as const;
  const ok = <T>(daten: T) => ({ ok: true, status: 200, daten }) as const;
  return {
    liste: async () => ok([...liste].sort((a, b) => a.name.localeCompare(b.name, "de"))),
    server: async (id) => {
      const sv = liste.find((s) => s.serverId === id);
      const roh = start.find((s) => s.id === id);
      if (!sv || !roh) return fehlt;
      // at the demo's own morning, which its backups and certificates are written against
      const pruefungen = pruefungenDerDemo({ ...demo, server: start }, roh).map((p) => ({
        ...p,
        seit: null,
      }));
      return ok({ ...sv, pruefungen });
    },
    last: async (id, tage) => {
      const sv = liste.find((s) => s.serverId === id);
      const roh = start.find((s) => s.id === id);
      if (!sv || !roh) return fehlt;
      return ok(demoLast(roh, tage, sv.faktenAm ?? jetzt()));
    },
    platten: async (id, tage) => {
      const sv = liste.find((s) => s.serverId === id);
      const roh = start.find((s) => s.id === id);
      if (!sv || !roh) return fehlt;
      return ok(demoPlatten(roh, tage, sv.faktenAm ?? jetzt()));
    },
    neustart: async (id) => {
      const sv = liste.find((s) => s.serverId === id);
      if (!sv) return fehlt;
      if (
        sv.neustart.letzter &&
        !["erfolgreich", "gescheitert", "abgebrochen"].includes(sv.neustart.letzter.zustand)
      )
        return { ok: false, status: 409, fehler: "auftrag_offen" };
      const auftragId = crypto.randomUUID();
      const neustart: NeustartStand = {
        ...sv.neustart,
        plan: { art: "warten", grund: "auftraege" },
        letzter: {
          auftragId,
          zustand: "zugestellt",
          vonHand: true,
          angelegtAm: jetzt(),
          geaendertAm: jetzt(),
          fehler: null,
        },
      };
      liste = liste.map((s) => (s.serverId === id ? { ...s, neustart } : s));
      return {
        ok: true,
        status: 201,
        daten: { backups: [], neustart: { auftragId, zustand: "zugestellt" } },
      };
    },
    sperren: async (id) => {
      const sv = liste.find((s) => s.serverId === id);
      if (!sv) return fehlt;
      if (sv.gesperrtAm !== null) return { ok: false, status: 409, fehler: "schon_gesperrt" };
      const neu: ServerDerZentrale = {
        ...sv,
        gesperrtAm: jetzt(),
        agent: { zustand: "getrennt", letzterHeartbeat: sv.agent.letzterHeartbeat },
      };
      liste = liste.map((s) => (s.serverId === id ? neu : s));
      return ok(neu);
    },
  };
};

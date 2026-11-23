import {
  FAKTEN_MS,
  HEARTBEAT_MS,
  PROTOKOLL_VERSION,
  ROTIEREN_VOR_MS,
} from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { pfadeIn } from "../pfade.ts";
import { wartezeit } from "./backoff.ts";
import type { Ereignisse, Tls } from "./sockel.ts";
import { type VerbindenDeps, verbindungsSchleife, verbindungsUrl } from "./verbinden.ts";

/*
 * BAULISTE.md Z-303: the agent's side of the connection against a Zentrale in memory, with a clock
 * the test moves: hallo, heartbeats every 30 seconds, reconnecting with backoff after a drop.
 */
const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);
const TAG = 24 * 3600_000;
const pfade = pfadeIn("/k", "/z");
const PEM = (art: string, wer = "a") => `-----BEGIN ${art}-----\n${wer}\n-----END ${art}-----\n`;

const aufgebaut = (
  zufall = 0,
  meldungen?: VerbindenDeps["meldungen"],
  auftraege?: VerbindenDeps["auftraege"],
) => {
  const uhr = { ms: JETZT };
  const plaene: { wann: number; lauf: () => void; aktiv: boolean }[] = [];
  const fs = speicher({ "/z/agent.key": PEM("PRIVATE KEY"), "/z/agent.pem": PEM("CERTIFICATE") });
  const verbindungen: {
    url: string;
    tls: Tls;
    e: Ereignisse;
    gesendet: Record<string, unknown>[];
    geschlossen: [number, string][];
  }[] = [];
  const zeilen: Record<string, unknown>[] = [];
  const schleife = verbindungsSchleife(
    {
      oeffnen: (url, tls, e) => {
        const v = {
          url,
          tls,
          e,
          gesendet: [] as Record<string, unknown>[],
          geschlossen: [] as [number, string][],
        };
        verbindungen.push(v);
        return {
          senden: (text) => v.gesendet.push(JSON.parse(text)),
          schliessen: (code, grund) => v.geschlossen.push([code, grund]),
        };
      },
      planen: (lauf, ms) => {
        const plan = { wann: uhr.ms + ms, lauf, aktiv: true };
        plaene.push(plan);
        return () => {
          plan.aktiv = false;
        };
      },
      jetzt: () => uhr.ms,
      zufall: () => zufall,
      log: (z) => zeilen.push(JSON.parse(z)),
      dateien: fs.dateien,
      pfade,
      architektur: "arm64",
      anfrage: async () => ({
        schluessel: PEM("PRIVATE KEY", "neu"),
        csr: PEM("CERTIFICATE REQUEST"),
      }),
      ...(meldungen ? { meldungen } : {}),
      ...(auftraege ? { auftraege } : {}),
    },
    "https://agent.example.de",
  );
  /** Moves the clock, running what was planned until then, in order */
  const vergehen = async (ms: number) => {
    const ziel = uhr.ms + ms;
    for (;;) {
      await new Promise((r) => setTimeout(r, 0));
      const naechster = plaene
        .filter((p) => p.aktiv && p.wann <= ziel)
        .sort((a, b) => a.wann - b.wann)[0];
      if (!naechster) break;
      uhr.ms = naechster.wann;
      naechster.aktiv = false;
      naechster.lauf();
    }
    uhr.ms = ziel;
    await new Promise((r) => setTimeout(r, 0));
  };
  const letzte = () => verbindungen.at(-1);
  const willkommen = (zertifikatGueltigBis = JETZT + 365 * TAG, zeit = uhr.ms) =>
    letzte()?.e.nachricht(
      JSON.stringify({
        typ: "willkommen",
        protokoll: PROTOKOLL_VERSION,
        zeit,
        zertifikatGueltigBis,
      }),
    );
  return { uhr, fs, verbindungen, zeilen, schleife, vergehen, letzte, willkommen };
};

describe("the agent's connection", () => {
  it("opens wss to agent.<domain> with its certificate and says hallo", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    expect(a.verbindungen).toHaveLength(1);
    expect(a.letzte()?.url).toBe("wss://agent.example.de/api/v1/agent/verbindung");
    expect(a.letzte()?.tls).toEqual({ cert: PEM("CERTIFICATE"), key: PEM("PRIVATE KEY") });
    a.letzte()?.e.offen();
    expect(a.letzte()?.gesendet).toEqual([
      {
        typ: "hallo",
        protokoll: PROTOKOLL_VERSION,
        agentVersion: expect.any(String),
        architektur: "arm64",
        zeit: JETZT,
      },
    ]);
  });

  it("sends a heartbeat every 30 seconds after willkommen", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    await a.vergehen(60_000);
    expect(a.letzte()?.gesendet.map((n) => n.typ)).toEqual(["hallo"]);
    a.willkommen();
    await a.vergehen(3 * HEARTBEAT_MS);
    const herzschlaege = a.letzte()?.gesendet.filter((n) => n.typ === "heartbeat") ?? [];
    expect(herzschlaege.map((n) => n.zeit)).toEqual(
      [1, 2, 3].map((i) => JETZT + 60_000 + i * HEARTBEAT_MS),
    );
  });

  it("reconnects after a drop with a backoff that grows, and starts the count anew once welcomed", async () => {
    const a = aufgebaut(0.5);
    await a.vergehen(0);
    // the Zentrale is gone: every attempt ends at once
    const versuche: number[] = [];
    for (let i = 0; i < 4; i++) {
      versuche.push(a.uhr.ms);
      a.letzte()?.e.zu(1006, "");
      await a.vergehen(wartezeit(i, 0.5) - 1);
      expect(a.verbindungen, `attempt ${i}`).toHaveLength(i + 1);
      await a.vergehen(1);
      expect(a.verbindungen).toHaveLength(i + 2);
    }
    expect(versuche.slice(1).map((t, i) => t - (versuche[i] ?? 0))).toEqual([750, 1500, 3000]);
    // back: welcomed, no heartbeat of the dead connection, the next drop waits the shortest time
    a.letzte()?.e.offen();
    a.willkommen();
    await a.vergehen(HEARTBEAT_MS);
    a.letzte()?.e.zu(1006, "");
    const vorher = a.verbindungen.length;
    await a.vergehen(wartezeit(0, 0.5));
    expect(a.verbindungen).toHaveLength(vorher + 1);
    expect(a.zeilen.filter((z) => z.msg === "disconnected").at(-1)).toMatchObject({
      code: 1006,
      wiederIn: 750,
    });
  });

  it("sends no heartbeat over a connection that ended", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    const erste = a.letzte();
    erste?.e.offen();
    a.willkommen();
    erste?.e.zu(4403, "certificate revoked");
    await a.vergehen(10 * HEARTBEAT_MS);
    expect(erste?.gesendet.filter((n) => n.typ === "heartbeat")).toEqual([]);
  });

  it("keeps trying after its certificate was revoked, never more often than the backoff allows", async () => {
    const a = aufgebaut(0);
    await a.vergehen(0);
    for (let i = 0; i < 20; i++) {
      a.letzte()?.e.zu(4403, "certificate revoked");
      await a.vergehen(5 * 60_000);
    }
    expect(a.verbindungen).toHaveLength(21);
    expect(a.zeilen.filter((z) => z.msg === "disconnected").at(-1)).toMatchObject({
      wiederIn: 150_000,
    });
  });

  it("stops: closes the connection and tries no more", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    a.schleife.stoppen();
    expect(a.letzte()?.geschlossen).toEqual([[1000, "agent stops"]]);
    a.letzte()?.e.zu(1000, "agent stops");
    await a.vergehen(10 * 60_000);
    expect(a.verbindungen).toHaveLength(1);
  });
});

describe("rotating the certificate", () => {
  it("asks for a new one in the last 30 days, keeps it and reconnects with it at once", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    a.willkommen(JETZT + ROTIEREN_VOR_MS);
    await a.vergehen(0);
    expect(a.letzte()?.gesendet.at(-1)).toEqual({
      typ: "zertifikat_anfrage",
      protokoll: PROTOKOLL_VERSION,
      csr: PEM("CERTIFICATE REQUEST"),
    });
    a.letzte()?.e.nachricht(
      JSON.stringify({
        typ: "zertifikat",
        protokoll: PROTOKOLL_VERSION,
        zertifikat: PEM("CERTIFICATE", "neu"),
        ca: PEM("CERTIFICATE", "ca"),
        gueltigBis: JETZT + 365 * TAG,
      }),
    );
    await a.vergehen(0);
    expect(a.fs.inhalt.get("/z/agent.key")?.text).toBe(PEM("PRIVATE KEY", "neu"));
    expect(a.fs.inhalt.get("/z/agent.pem")?.text).toBe(PEM("CERTIFICATE", "neu"));
    expect(a.letzte()?.geschlossen).toEqual([[1000, "certificate rotated"]]);
    a.letzte()?.e.zu(1000, "certificate rotated");
    await a.vergehen(0);
    expect(a.verbindungen).toHaveLength(2);
    expect(a.letzte()?.tls.cert).toBe(PEM("CERTIFICATE", "neu"));
  });

  it("asks over a connection that stays open into the last 30 days, not only at willkommen", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    // welcomed just before the last 30 days; the connection then simply stays open
    a.willkommen(JETZT + ROTIEREN_VOR_MS + 2 * HEARTBEAT_MS);
    await a.vergehen(0);
    expect(a.letzte()?.gesendet.map((n) => n.typ)).toEqual(["hallo"]);
    await a.vergehen(3 * HEARTBEAT_MS);
    expect(a.verbindungen).toHaveLength(1);
    expect(a.letzte()?.gesendet.map((n) => n.typ)).toContain("zertifikat_anfrage");
  });

  it("does not ask earlier, and ignores a certificate it did not ask for", async () => {
    const a = aufgebaut();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    a.willkommen(JETZT + ROTIEREN_VOR_MS + 1);
    a.letzte()?.e.nachricht(
      JSON.stringify({
        typ: "zertifikat",
        protokoll: PROTOKOLL_VERSION,
        zertifikat: PEM("CERTIFICATE", "fremd"),
        ca: PEM("CERTIFICATE", "ca"),
        gueltigBis: JETZT + 365 * TAG,
      }),
    );
    await a.vergehen(0);
    expect(a.letzte()?.gesendet.map((n) => n.typ)).toEqual(["hallo"]);
    expect(a.fs.inhalt.get("/z/agent.pem")?.text).toBe(PEM("CERTIFICATE"));
  });
});

describe("facts and SSH logins (Z-304)", () => {
  const FAKTEN = {
    typ: "fakten" as const,
    protokoll: PROTOKOLL_VERSION,
    zeit: JETZT,
    cpuKerne: 2,
    ramMb: 2048,
    platten: [],
    architektur: "arm64" as const,
    os: null,
    kernel: { laeuft: null, installiert: null },
    neustartNoetig: false,
    updatesAusstehend: null,
    podman: null,
    ipv4: [],
    ipv6: [],
    ptr: {},
    portsBelegt: null,
    port25Ausgehend: null,
    bootId: null,
    gestartetAm: null,
    unattendedUpgrades: null,
  };
  const mitMeldungen = () => {
    const abweichungen: (number | null)[] = [];
    const ssh: {
      melden?: (a: { zeit: number; nutzer: string; von: string; methode: string }) => void;
      gestoppt: number;
    } = { gestoppt: 0 };
    const a = aufgebaut(0, {
      fakten: async (uhrzeitAbweichungMs) => {
        abweichungen.push(uhrzeitAbweichungMs);
        return { ...FAKTEN, uhrzeitAbweichungMs };
      },
      anmeldungen: (melden) => {
        ssh.melden = melden;
        return { stoppen: () => (ssh.gestoppt += 1) };
      },
    });
    return { a, abweichungen, ssh };
  };

  it("sends the facts after willkommen and then every 15 minutes, with the clock offset", async () => {
    const { a, abweichungen } = mitMeldungen();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    await a.vergehen(400);
    // the Zentrale's clock says JETZT + 500 when the agent's says JETZT + 400: 300 ms behind
    a.willkommen(undefined, JETZT + 500);
    await a.vergehen(0);
    expect(a.letzte()?.gesendet.map((n) => n.typ)).toEqual(["hallo", "fakten"]);
    expect(abweichungen).toEqual([-300]);
    await a.vergehen(FAKTEN_MS);
    const typen = a.letzte()?.gesendet.map((n) => n.typ) ?? [];
    expect(typen.filter((t) => t === "fakten")).toHaveLength(2);
    expect(typen.filter((t) => t === "heartbeat")).toHaveLength(FAKTEN_MS / HEARTBEAT_MS);
  });

  it("sends an SSH login as ssh_anmeldung", async () => {
    const { a, ssh } = mitMeldungen();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    a.willkommen();
    await a.vergehen(0);
    ssh.melden?.({ zeit: 7, nutzer: "tristan", von: "10.8.0.2", methode: "publickey" });
    expect(a.letzte()?.gesendet.at(-1)).toEqual({
      typ: "ssh_anmeldung",
      protokoll: PROTOKOLL_VERSION,
      zeit: 7,
      nutzer: "tristan",
      von: "10.8.0.2",
      methode: "publickey",
    });
  });

  it("stops both when the connection ends, and starts them again with the next", async () => {
    const { a, ssh } = mitMeldungen();
    await a.vergehen(0);
    a.letzte()?.e.offen();
    a.willkommen();
    await a.vergehen(0);
    const erste = a.letzte();
    erste?.e.zu(1006, "");
    expect(ssh.gestoppt).toBe(1);
    ssh.melden?.({ zeit: 7, nutzer: "x", von: "y", methode: "z" });
    await a.vergehen(FAKTEN_MS);
    expect(erste?.gesendet.map((n) => n.typ)).toEqual(["hallo", "fakten"]);
    a.letzte()?.e.offen();
    a.willkommen();
    await a.vergehen(0);
    expect(a.letzte()?.gesendet.map((n) => n.typ)).toEqual(["hallo", "fakten"]);
  });
});

describe("jobs (Z-305)", () => {
  it("hands a job to its handler, whose later reports go over the connection open then", async () => {
    const erhalten: { auftragId: string; senden: (text: string) => void }[] = [];
    const a = aufgebaut(0, undefined, {
      empfangen: async (n, senden) => {
        erhalten.push({ auftragId: n.auftragId, senden });
      },
    });
    await a.vergehen(0);
    a.letzte()?.e.offen();
    a.willkommen();
    const erste = a.letzte();
    erste?.e.nachricht(
      JSON.stringify({
        typ: "auftrag",
        protokoll: PROTOKOLL_VERSION,
        auftragId: "a1",
        installationId: "i",
        aktion: "migrieren",
        argumente: {},
        manifest: "m",
        signatur: "s",
        zeitlimitS: 60,
      }),
    );
    await a.vergehen(0);
    expect(erhalten.map((e) => e.auftragId)).toEqual(["a1"]);
    // the connection drops while the job runs; its result goes over the next one
    erste?.e.zu(1006, "weg");
    await a.vergehen(60_000);
    a.letzte()?.e.offen();
    expect(a.letzte()).not.toBe(erste);
    erhalten[0]?.senden(JSON.stringify({ typ: "ergebnis" }));
    expect(a.letzte()?.gesendet.at(-1)).toEqual({ typ: "ergebnis" });
    expect(erste?.gesendet.some((n) => n.typ === "ergebnis")).toBe(false);
  });
});

describe("verbindungsUrl", () => {
  it("speaks wss to an https Zentrale and ws only to an http one (test mode)", () => {
    expect(verbindungsUrl("https://agent.example.de")).toBe(
      "wss://agent.example.de/api/v1/agent/verbindung",
    );
    expect(verbindungsUrl("http://10.0.0.1:28300")).toBe(
      "ws://10.0.0.1:28300/api/v1/agent/verbindung",
    );
  });
});

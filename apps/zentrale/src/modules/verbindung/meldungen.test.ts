import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { VOM_AGENTEN_V1 } from "../../../../../packages/protokoll/src/beispiele-v1.ts";
import {
  auditLog,
  ereignisse,
  fakten,
  installationen,
  installationVerlauf,
  server as serverTabelle,
} from "../../db/schema.ts";
import { serverHinzufuegen } from "../../testhilfen/agent.ts";
import { installationEinfuegen } from "../../testhilfen/bewertung.ts";
import { testServer } from "../../testhilfen/server.ts";
import { agentBeitreten, fingerabdruckVon } from "../../testhilfen/tls.ts";
import { schreiben } from "../audit/index.ts";
import { serverZumFingerabdruck } from "../server/index.ts";
import { sitzung } from "./sitzung.ts";

/*
 * BAULISTE.md Z-304: the Zentrale keeps what the agent reports on its own: facts as measurements
 * (the newest at the server, the history in `fakten`) and every SSH login as an event.
 */
const FAKTEN = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") ?? {};
const ANMELDUNG = VOM_AGENTEN_V1.find((n) => n.typ === "ssh_anmeldung") ?? {};

const verbunden = async () => {
  const zentrale = testServer();
  const inhaber = await zentrale.inhaber();
  const { token } = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(zentrale, token);
  const gefunden = serverZumFingerabdruck(zentrale.db, await fingerabdruckVon(agent.zertifikat));
  if (!gefunden) throw new Error("not found");
  const geschlossen: number[] = [];
  const s = sitzung(zentrale.deps, gefunden);
  s.offen({ senden: () => {}, schliessen: (code) => geschlossen.push(code) });
  const hallo = { typ: "hallo", protokoll: PROTOKOLL_VERSION, agentVersion: "0.0.0", zeit: 1 };
  await s.nachricht(JSON.stringify({ ...hallo, architektur: "amd64" }));
  return { zentrale, s, geschlossen, server: gefunden.server };
};

describe("facts from the agent", () => {
  it("land at the server and in the history, at the Zentrale's time, without audit entries", async () => {
    const { zentrale, s, geschlossen, server } = await verbunden();
    const audit = zentrale.db.select().from(auditLog).all().length;
    await s.nachricht(JSON.stringify(FAKTEN));
    zentrale.stelleUhr(zentrale.jetzt() + 15 * 60_000);
    await s.nachricht(JSON.stringify({ ...FAKTEN, updatesAusstehend: 0 }));
    expect(geschlossen).toEqual([]);
    const verlauf = zentrale.db.select().from(fakten).all();
    expect(verlauf.map((z) => [z.serverId, JSON.parse(z.daten).updatesAusstehend])).toEqual([
      [server.serverId, 3],
      [server.serverId, 0],
    ]);
    const zeile = zentrale.db.select().from(serverTabelle).get();
    expect(zeile?.faktenAm).toBe(zentrale.jetzt());
    expect(JSON.parse(zeile?.fakten ?? "{}")).toEqual({ ...FAKTEN, updatesAusstehend: 0 });
    expect(zentrale.db.select().from(auditLog).all()).toHaveLength(audit);
  });

  it("are dropped when they come closer than a minute, so an agent cannot fill the table", async () => {
    const { zentrale, s } = await verbunden();
    await s.nachricht(JSON.stringify(FAKTEN));
    zentrale.stelleUhr(zentrale.jetzt() + 59_999);
    await s.nachricht(JSON.stringify(FAKTEN));
    zentrale.stelleUhr(zentrale.jetzt() + 1);
    await s.nachricht(JSON.stringify(FAKTEN));
    expect(zentrale.db.select().from(fakten).all()).toHaveLength(2);
  });
});

describe("an SSH login", () => {
  it("becomes one event of the server through the audit log", async () => {
    const { zentrale, s, server } = await verbunden();
    await s.nachricht(JSON.stringify(ANMELDUNG));
    const [ereignis, ...mehr] = zentrale.db.select().from(ereignisse).all();
    expect(mehr).toEqual([]);
    expect(ereignis).toMatchObject({
      betreiberId: server.betreiberId,
      art: "ssh_anmeldung",
      schwere: "warn",
      ziel: `server:${server.serverId}`,
      zeitpunkt: 1_795_000_000_000,
      text: `SSH-Anmeldung auf ${server.name}: tristan von 10.8.0.2 (publickey)`,
    });
    expect(zentrale.db.select().from(auditLog).all().at(-1)).toMatchObject({
      aktion: "ereignis.ssh-anmeldung",
      akteur: `server:${server.serverId}`,
    });
  });

  it("reported twice stays one event", async () => {
    const { zentrale, s } = await verbunden();
    await s.nachricht(JSON.stringify(ANMELDUNG));
    await s.nachricht(JSON.stringify(ANMELDUNG));
    expect(zentrale.db.select().from(ereignisse).all()).toHaveLength(1);
  });

  it("cannot flood the events and the audit log: a backlog of 100 passes, then one a minute", async () => {
    const { zentrale, s } = await verbunden();
    const audit = zentrale.db.select().from(auditLog).all().length;
    for (let i = 0; i < 1000; i++)
      await s.nachricht(JSON.stringify({ ...ANMELDUNG, zeit: 1_795_000_000_000 + i }));
    expect(zentrale.db.select().from(ereignisse).all()).toHaveLength(100);
    expect(zentrale.db.select().from(auditLog).all()).toHaveLength(audit + 100);
    zentrale.stelleUhr(zentrale.jetzt() + 60_000);
    await s.nachricht(JSON.stringify({ ...ANMELDUNG, zeit: 1_795_000_001_000 }));
    await s.nachricht(JSON.stringify({ ...ANMELDUNG, zeit: 1_795_000_001_001 }));
    expect(zentrale.db.select().from(ereignisse).all()).toHaveLength(101);
  });

  it("never stands later than now, whatever the agent's clock says", async () => {
    const { zentrale, s } = await verbunden();
    await s.nachricht(JSON.stringify({ ...ANMELDUNG, zeit: zentrale.jetzt() + 3600_000 }));
    expect(zentrale.db.select().from(ereignisse).get()?.zeitpunkt).toBe(zentrale.jetzt());
  });
});

// BAULISTE.md Z-403: the state of the installations every 30 s, rated at the Zentrale's time
describe("the state of the installations", () => {
  const ZUSTAND = VOM_AGENTEN_V1.find((n) => n.typ === "zustand") ?? {};

  const mitInstallation = async () => {
    const v = await verbunden();
    const { betreiberId, serverId } = v.server;
    schreiben(
      v.zentrale.schreibDb,
      { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
      "test",
      (w) =>
        w.einfuegen("kunden", {
          betreiberId,
          kundeId: "k1",
          name: "Kanzlei",
          kontaktName: "Kim",
          kontaktEmail: "kim@kanzlei.test",
          kuerzel: "kanzlei",
          angelegtAm: 1,
        }),
    );
    installationEinfuegen(v.zentrale.schreibDb, betreiberId, "haben-mueller", serverId);
    return v;
  };
  const bewertung = (z: Awaited<ReturnType<typeof verbunden>>["zentrale"]) =>
    z.db.select().from(installationen).get();

  it("rates the installations of the server, without an audit entry", async () => {
    const { zentrale, s, geschlossen } = await mitInstallation();
    const audit = zentrale.db.select().from(auditLog).all().length;
    await s.nachricht(JSON.stringify(ZUSTAND));
    expect(geschlossen).toEqual([]);
    expect(bewertung(zentrale)).toMatchObject({
      bewertung: "gruen",
      bewertungSeit: zentrale.jetzt(),
      gemeldetAm: zentrale.jetzt(),
    });
    expect(zentrale.db.select().from(installationVerlauf).all()).toHaveLength(1);
    expect(zentrale.db.select().from(auditLog).all()).toHaveLength(audit);
  });

  it("is dropped when it comes closer than 5 s, so an agent cannot hammer the table", async () => {
    const { zentrale, s } = await mitInstallation();
    await s.nachricht(JSON.stringify(ZUSTAND));
    const erste = zentrale.jetzt();
    zentrale.stelleUhr(erste + 4_999);
    await s.nachricht(JSON.stringify(ZUSTAND));
    expect(bewertung(zentrale)?.gemeldetAm).toBe(erste);
    zentrale.stelleUhr(erste + 5_000);
    await s.nachricht(JSON.stringify(ZUSTAND));
    expect(bewertung(zentrale)?.gemeldetAm).toBe(erste + 5_000);
  });
});
